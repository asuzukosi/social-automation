from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from functools import cached_property, partial
from pathlib import Path
from typing import TypeVar, cast

from social_automation.core.models import (
    ActionPreview,
    ActionRequest,
    ActionResult,
    Platform,
    ReadResult,
    RenderedAction,
)
from social_automation.execution import execute_action, read_result, record_timeout
from social_automation.inspection import authentication_status, service_status
from social_automation.platforms.base import MessagingAdapter, PlatformAdapter
from social_automation.platforms.linkedin.adapter import LinkedInAdapter
from social_automation.platforms.reddit.adapter import RedditAdapter
from social_automation.platforms.x.adapter import XAdapter
from social_automation.scheduling import PlatformQueue, PlatformQueueTimeoutError
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
                timeout_seconds=90 if platform is Platform.LINKEDIN else 60,
                on_abort=(adapter.recover if isinstance(adapter, LinkedInAdapter) else None),
            )
            for platform, adapter in self.adapters.items()
        }

    @cached_property
    def store(self) -> ActionStore:
        return ActionStore(self._state_path)

    async def status(self) -> dict[str, object]:
        calls = [self._run(platform, adapter.status) for platform, adapter in self.adapters.items()]
        results = await asyncio.gather(*calls, return_exceptions=True)
        return service_status(self.adapters, self.queues, results)

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
        return authentication_status(self.adapters, results)

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
            return await read_result(self._adapter(platform).search(query, limit))

        calls = [
            self._run(platform, partial(search_platform, platform), retry_on_timeout=True)
            for platform in selected
        ]
        results = await asyncio.gather(*calls)
        data: dict[str, object] = {}
        for platform, result in zip(selected, results, strict=True):
            data[platform.value] = result.model_dump(mode="json")
        return {"query": query, "results": data}

    async def get_post(self, platform: Platform, post_id: str) -> ReadResult:
        return await self._read(platform, lambda: self._adapter(platform).get_post(post_id))

    async def get_feed(
        self, platform: Platform, feed: str | None, limit: int, cursor: str | None = None
    ) -> ReadResult:
        return await self._read(
            platform, lambda: self._adapter(platform).get_feed(feed, limit, cursor)
        )

    async def get_profile(self, platform: Platform, profile_id: str) -> ReadResult:
        return await self._read(platform, lambda: self._adapter(platform).get_profile(profile_id))

    async def get_thread(self, platform: Platform, post_id: str, limit: int) -> ReadResult:
        return await self._read(
            platform, lambda: self._adapter(platform).get_thread(post_id, limit)
        )

    async def get_inbox(self, platform: Platform, limit: int) -> ReadResult:
        adapter = self._messaging_adapter(platform, "get_inbox")
        return await self._read(platform, lambda: adapter.get_inbox(limit))

    async def get_conversation(
        self, platform: Platform, profile_id: str | None, thread_id: str | None, index: int
    ) -> ReadResult:
        adapter = self._messaging_adapter(platform, "get_conversation")
        return await self._read(
            platform,
            lambda: adapter.get_conversation(profile_id, thread_id, index),
            retry_on_timeout=False,
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
        try:
            return await self._run(
                platform,
                lambda: self._consume_and_execute(operation_id, preview_token),
                exclusive=True,
            )
        except PlatformQueueTimeoutError as error:
            return record_timeout(self.store, operation_id, error)

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

    def _messaging_adapter(self, platform: Platform, operation: str) -> MessagingAdapter:
        adapter = self._adapter(platform)
        supported = any(
            item.operation == operation and item.supported for item in adapter.capabilities()
        )
        if not supported:
            raise ValueError(f"{platform.value} does not support {operation}")
        return cast(MessagingAdapter, adapter)

    async def _read(
        self,
        platform: Platform,
        call: Callable[[], Awaitable[ReadResult]],
        *,
        retry_on_timeout: bool = True,
    ) -> ReadResult:
        return await self._run(
            platform, lambda: read_result(call()), retry_on_timeout=retry_on_timeout
        )

    async def _run(
        self,
        platform: Platform,
        call: Callable[[], Awaitable[T]],
        *,
        exclusive: bool = False,
        retry_on_timeout: bool = False,
    ) -> T:
        try:
            return await self.queues[platform].run(call, exclusive=exclusive)
        except PlatformQueueTimeoutError:
            if not retry_on_timeout:
                raise
            return await self.queues[platform].run(call, exclusive=exclusive)

    async def _consume_and_execute(self, operation_id: str, preview_token: str) -> ActionResult:
        consumed = self.store.consume_preview(operation_id, preview_token)
        if isinstance(consumed, ActionResult):
            return consumed
        adapter = self._adapter(consumed.request.platform)
        return await execute_action(self.store, adapter, consumed, operation_id)
