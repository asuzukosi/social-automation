"""Capability-aware adapter interface."""

from __future__ import annotations

from typing import Protocol

from social_automation.core.models import (
    ActionResult,
    Capability,
    ReadResult,
    RenderedAction,
)

READ_OPERATIONS = ("search", "get_feed", "get_profile", "get_post", "get_thread")


class PlatformAdapter(Protocol):
    """The operations the unified service can request from a platform."""

    async def status(self) -> dict[str, object]: ...

    async def close(self) -> None: ...

    async def authenticate(self, force: bool = False) -> dict[str, object]: ...

    async def authentication_status(self) -> dict[str, object]: ...

    async def logout(self) -> dict[str, object]: ...

    def capabilities(self) -> list[Capability]: ...

    async def search(self, query: str, limit: int) -> ReadResult: ...

    async def get_feed(
        self, feed: str | None, limit: int, cursor: str | None = None
    ) -> ReadResult: ...

    async def get_profile(self, profile_id: str) -> ReadResult: ...

    async def get_post(self, post_id: str) -> ReadResult: ...

    async def get_thread(self, post_id: str, limit: int) -> ReadResult: ...

    async def render_action(self, action: RenderedAction) -> RenderedAction: ...

    async def execute_action(
        self, action: RenderedAction, idempotency_key: str
    ) -> ActionResult: ...
