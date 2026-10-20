from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from functools import cached_property, partial
from pathlib import Path
from typing import TypeVar

from social_automation.core.models import (
    ActionPreview,
    ActionRequest,
    ActionResult,
    Completeness,
    Platform,
    ReadResult,
    RenderedAction,
)
from social_automation.core.redaction import redact_error
from social_automation.platforms.base import PlatformAdapter
from social_automation.platforms.linkedin.adapter import LinkedInAdapter
from social_automation.platforms.reddit.adapter import RedditAdapter
from social_automation.platforms.x.adapter import XAdapter
from social_automation.scheduling import PlatformQueue
from social_automation.storage import ActionStore

T = TypeVar("T")


class SocialService:
    def __init__(
        self,
        state_path: Path,
        adapters: dict[Platform, PlatformAdapter] | None = None,
    ) -> None:
        self.adapters: dict[Platform, PlatformAdapter] = (
            adapters
            if adapters is not None
            else {
                Platform.X: XAdapter(),
                Platform.REDDIT: RedditAdapter(),
                Platform.LINKEDIN: LinkedInAdapter(),
            }
        )
        self._state_path = state_path
        self.queues = {
            platform: PlatformQueue(
                platform.value,
                1 if platform is Platform.LINKEDIN else 5,
                12,
            )
            for platform in self.adapters
        }

    @cached_property
    def store(self) -> ActionStore:
        return ActionStore(self._state_path)

    async def status(self) -> dict[str, object]:
        calls = [
            self._run(platform, adapter.status)
            for platform, adapter in self.adapters.items()
        ]
        results = await asyncio.gather(*calls, return_exceptions=True)
        platforms: dict[str, object] = {}
        for platform, result in zip(self.adapters, results, strict=True):
            platforms[platform.value] = (
                {"available": False, "error": redact_error(result)}
                if isinstance(result, BaseException)
                else result
            )
        return {
            "name": "social",
            "platforms": platforms,
            "queues": {
                platform.value: queue.snapshot() for platform, queue in self.queues.items()
            },
        }

    async def close(self) -> None:
        queues = asyncio.gather(*(queue.close() for queue in self.queues.values()))
        try:
            await asyncio.shield(queues)
        except asyncio.CancelledError:
            await queues
        await asyncio.gather(
            *(adapter.close() for adapter in self.adapters.values()), return_exceptions=True
        )

    async def authenticate(self, platform: Platform, force: bool = False) -> dict[str, object]:
        adapter = self._adapter(platform)
        return await self._run(platform, lambda: adapter.authenticate(force), exclusive=True)

    async def authentication_status(self) -> dict[str, object]:
        calls = [
            self._run(platform, adapter.authentication_status)
            for platform, adapter in self.adapters.items()
        ]
        results = await asyncio.gather(*calls, return_exceptions=True)
        platforms: dict[str, object] = {}
        for platform, result in zip(self.adapters, results, strict=True):
            platforms[platform.value] = (
                {
                    "authenticated": None,
                    "error": redact_error(result),
                }
                if isinstance(result, BaseException)
                else result
            )
        return {"platforms": platforms}

    async def logout(self, platform: Platform) -> dict[str, object]:
        adapter = self._adapter(platform)
        return await self._run(platform, adapter.logout, exclusive=True)

    def capabilities(self) -> dict[str, list[dict[str, object]]]:
        return {
            platform.value: [item.model_dump(mode="json") for item in adapter.capabilities()]
            for platform, adapter in self.adapters.items()
        }

    def accounts(self) -> list[dict[str, object]]:
        return [
            {
                "platform": platform.value,
                "account": "primary",
                "authentication": "browser_profile",
                "developer_credentials_required": False,
            }
            for platform in self.adapters
        ]

    async def search(self, query: str, platforms: list[Platform], limit: int) -> dict[str, object]:
        selected = list(dict.fromkeys(platforms))

        async def search_platform(platform: Platform) -> ReadResult:
            return await self._read(self._adapter(platform).search(query, limit))

        calls = [
            self._run(platform, partial(search_platform, platform))
            for platform in selected
        ]
        results = await asyncio.gather(*calls)
        data: dict[str, object] = {}
        for platform, result in zip(selected, results, strict=True):
            data[platform.value] = result.model_dump(mode="json")
        return {"query": query, "results": data}

    async def get_post(self, platform: Platform, post_id: str) -> ReadResult:
        return await self._run(
            platform, lambda: self._read(self._adapter(platform).get_post(post_id))
        )

    async def get_feed(
        self, platform: Platform, feed: str | None, limit: int, cursor: str | None = None
    ) -> ReadResult:
        return await self._run(
            platform,
            lambda: self._read(self._adapter(platform).get_feed(feed, limit, cursor)),
        )

    async def get_profile(self, platform: Platform, profile_id: str) -> ReadResult:
        return await self._run(
            platform, lambda: self._read(self._adapter(platform).get_profile(profile_id))
        )

    async def get_thread(self, platform: Platform, post_id: str, limit: int) -> ReadResult:
        return await self._run(
            platform, lambda: self._read(self._adapter(platform).get_thread(post_id, limit))
        )

    async def preview_action(self, request: ActionRequest) -> ActionPreview:
        if request.account != "primary":
            raise ValueError("Only the configured 'primary' account is available")
        adapter = self._adapter(request.platform)
        capability = next(
            (item for item in adapter.capabilities() if item.operation == request.action.value),
            None,
        )
        if capability is None or not capability.supported or not capability.write:
            raise ValueError(f"{request.platform.value} does not support {request.action.value}")
        rendered = await self._run(
            request.platform,
            lambda: adapter.render_action(RenderedAction(request=request)),
        )
        return self.store.create_preview(rendered)

    async def confirm_action(
        self,
        operation_id: str,
        preview_token: str,
        confirmed: bool,
    ) -> ActionResult:
        if not confirmed:
            raise ValueError("Explicit confirmation is required")
        platform = self.store.operation_platform(operation_id)
        return await self._run(
            platform,
            lambda: self._consume_and_execute(operation_id, preview_token),
            exclusive=True,
        )

    def list_actions(self, limit: int) -> list[dict[str, object]]:
        return self.store.list_actions(limit)

    def get_action(self, operation_id: str) -> dict[str, object]:
        return self.store.get_action(operation_id)

    def cancel_action(self, operation_id: str) -> dict[str, object]:
        return self.store.cancel_action(operation_id)

    def _adapter(self, platform: Platform) -> PlatformAdapter:
        try:
            return self.adapters[platform]
        except KeyError as error:
            raise ValueError(f"Unsupported platform: {platform.value}") from error

    async def _run(
        self,
        platform: Platform,
        call: Callable[[], Awaitable[T]],
        *,
        exclusive: bool = False,
    ) -> T:
        return await self.queues[platform].run(call, exclusive=exclusive)

    async def _execute_action(self, action: RenderedAction, operation_id: str) -> ActionResult:
        adapter = self._adapter(action.request.platform)
        try:
            result = await adapter.execute_action(action, operation_id)
            result.operation_id = operation_id
        except Exception as error:
            result = ActionResult(
                operation_id=operation_id,
                platform=action.request.platform,
                action=action.request.action,
                status="outcome_unknown",
                confirmed=False,
                retry_safe=False,
                detail=redact_error(error),
            )
        self.store.record_result(result)
        return result

    async def _consume_and_execute(self, operation_id: str, preview_token: str) -> ActionResult:
        consumed = self.store.consume_preview(operation_id, preview_token)
        if isinstance(consumed, ActionResult):
            return consumed
        return await self._execute_action(consumed, operation_id)

    @staticmethod
    async def _read(call: Awaitable[ReadResult]) -> ReadResult:
        try:
            return await call
        except Exception as error:
            return ReadResult(completeness=Completeness.BLOCKED, reason=redact_error(error))
