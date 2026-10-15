from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from functools import cached_property
from pathlib import Path

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
from social_automation.storage import ActionStore


class SocialService:
    """Route unified operations to capability-aware platform adapters."""

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
        self._write_lock = asyncio.Lock()

    @cached_property
    def store(self) -> ActionStore:
        return ActionStore(self._state_path)

    async def status(self) -> dict[str, object]:
        calls = [adapter.status() for adapter in self.adapters.values()]
        results = await asyncio.gather(*calls, return_exceptions=True)
        platforms: dict[str, object] = {}
        for platform, result in zip(self.adapters, results, strict=True):
            platforms[platform.value] = (
                {"available": False, "error": redact_error(result)}
                if isinstance(result, BaseException)
                else result
            )
        return {"name": "social", "platforms": platforms}

    async def close(self) -> None:
        await asyncio.gather(
            *(adapter.close() for adapter in self.adapters.values()), return_exceptions=True
        )

    async def authenticate(self, platform: Platform, force: bool = False) -> dict[str, object]:
        """Open the platform's interactive login flow."""
        return await self._adapter(platform).authenticate(force)

    async def authentication_status(self) -> dict[str, object]:
        """Inspect every platform's saved session without opening browsers."""
        calls = [adapter.authentication_status() for adapter in self.adapters.values()]
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
        """Clear the platform's local authentication state."""
        return await self._adapter(platform).logout()

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
        calls = [self._read(self._adapter(platform).search(query, limit)) for platform in selected]
        results = await asyncio.gather(*calls)
        data: dict[str, object] = {}
        for platform, result in zip(selected, results, strict=True):
            data[platform.value] = result.model_dump(mode="json")
        return {"query": query, "results": data}

    async def get_post(self, platform: Platform, post_id: str) -> ReadResult:
        return await self._read(self._adapter(platform).get_post(post_id))

    async def get_feed(
        self, platform: Platform, feed: str | None, limit: int, cursor: str | None = None
    ) -> ReadResult:
        return await self._read(self._adapter(platform).get_feed(feed, limit, cursor))

    async def get_profile(self, platform: Platform, profile_id: str) -> ReadResult:
        return await self._read(self._adapter(platform).get_profile(profile_id))

    async def get_thread(self, platform: Platform, post_id: str, limit: int) -> ReadResult:
        """Read a bounded discussion and report whether it is complete."""
        return await self._read(self._adapter(platform).get_thread(post_id, limit))

    async def preview_action(self, request: ActionRequest) -> ActionPreview:
        """Render and persist a write preview without executing it."""
        if request.account != "primary":
            raise ValueError("Only the configured 'primary' account is available")
        adapter = self._adapter(request.platform)
        capability = next(
            (item for item in adapter.capabilities() if item.operation == request.action.value),
            None,
        )
        if capability is None or not capability.supported or not capability.write:
            raise ValueError(f"{request.platform.value} does not support {request.action.value}")
        rendered = await adapter.render_action(RenderedAction(request=request))
        return self.store.create_preview(rendered)

    async def confirm_action(
        self,
        operation_id: str,
        preview_token: str,
        confirmed: bool,
    ) -> ActionResult:
        """Execute one exact preview once after explicit confirmation."""
        if not confirmed:
            raise ValueError("Explicit confirmation is required")
        async with self._write_lock:
            consumed = self.store.consume_preview(operation_id, preview_token)
            if isinstance(consumed, ActionResult):
                return consumed
            adapter = self._adapter(consumed.request.platform)
            try:
                result = await adapter.execute_action(consumed, operation_id)
                result.operation_id = operation_id
            except Exception as error:
                result = ActionResult(
                    operation_id=operation_id,
                    platform=consumed.request.platform,
                    action=consumed.request.action,
                    status="outcome_unknown",
                    confirmed=False,
                    retry_safe=False,
                    detail=redact_error(error),
                )
            self.store.record_result(result)
            return result

    def list_actions(self, limit: int) -> list[dict[str, object]]:
        """Return recent write operations."""
        return self.store.list_actions(limit)

    def get_action(self, operation_id: str) -> dict[str, object]:
        """Return one write operation."""
        return self.store.get_action(operation_id)

    def cancel_action(self, operation_id: str) -> dict[str, object]:
        """Cancel an unused action preview."""
        return self.store.cancel_action(operation_id)

    def _adapter(self, platform: Platform) -> PlatformAdapter:
        try:
            return self.adapters[platform]
        except KeyError as error:
            raise ValueError(f"Unsupported platform: {platform.value}") from error

    @staticmethod
    async def _read(call: Awaitable[ReadResult]) -> ReadResult:
        try:
            return await call
        except Exception as error:
            return ReadResult(completeness=Completeness.BLOCKED, reason=redact_error(error))
