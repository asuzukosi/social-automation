"""Shared credential-free test adapters."""

from pathlib import Path

import pytest

from social_automation.core.models import (
    AccessMode,
    AccountRef,
    ActionName,
    ActionResult,
    Capability,
    Completeness,
    Platform,
    Post,
    ReadResult,
    RenderedAction,
)
from social_automation.service import SocialService


class FakeAdapter:
    """Observable adapter used to prove routing and gating."""

    def __init__(self, platform: Platform) -> None:
        self.platform = platform
        self.executions = 0
        self.closed = 0

    async def status(self) -> dict[str, object]:
        return {"available": True}

    async def close(self) -> None:
        self.closed += 1

    def capabilities(self) -> list[Capability]:
        return [
            Capability(
                operation="search",
                supported=True,
                authentication="none",
                access=AccessMode.UNOFFICIAL_HTTP,
            ),
            Capability(
                operation=ActionName.CREATE_POST.value,
                supported=True,
                write=True,
                authentication="test",
                access=AccessMode.UNOFFICIAL_HTTP,
                approval_required=True,
            ),
        ]

    async def search(self, query: str, limit: int) -> ReadResult:
        del limit
        post = Post(
            platform=self.platform,
            native_id="1",
            canonical_url="https://example.test/1",
            account=AccountRef(platform=self.platform),
            text=query,
        )
        return ReadResult(completeness=Completeness.COMPLETE, items=[post])

    async def get_post(self, post_id: str) -> ReadResult:
        del post_id
        return ReadResult(completeness=Completeness.COMPLETE)

    async def get_feed(self, feed: str | None, limit: int, cursor: str | None = None) -> ReadResult:
        del feed, limit, cursor
        return ReadResult(completeness=Completeness.COMPLETE)

    async def get_profile(self, profile_id: str) -> ReadResult:
        del profile_id
        return ReadResult(completeness=Completeness.COMPLETE)

    async def get_thread(self, post_id: str, limit: int) -> ReadResult:
        del post_id, limit
        return ReadResult(completeness=Completeness.COMPLETE)

    async def render_action(self, action: RenderedAction) -> RenderedAction:
        action.rendered_text = action.request.text
        return action

    async def execute_action(self, action: RenderedAction, idempotency_key: str) -> ActionResult:
        del idempotency_key
        self.executions += 1
        return ActionResult(
            operation_id="",
            platform=self.platform,
            action=action.request.action,
            status="confirmed",
            confirmed=True,
            retry_safe=False,
            native_id="new",
        )


@pytest.fixture
def service(tmp_path: Path) -> SocialService:
    """Create a service with no external network dependencies."""
    adapters = {platform: FakeAdapter(platform) for platform in Platform}
    return SocialService(tmp_path / "state.db", adapters=adapters)
