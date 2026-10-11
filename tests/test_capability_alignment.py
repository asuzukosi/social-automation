"""Capability declarations stay aligned with adapter behavior."""

from unittest.mock import AsyncMock

import pytest

from social_automation.core.models import (
    ActionName,
    ActionRequest,
    Platform,
    ReactionName,
    RenderedAction,
)
from social_automation.platforms.linkedin.adapter import LinkedInAdapter
from social_automation.platforms.reddit.adapter import RedditAdapter
from social_automation.platforms.x.adapter import XAdapter


@pytest.mark.parametrize(
    ("adapter", "platform", "action_name"),
    [
        (XAdapter(), Platform.X, ActionName.COMMENT),
        (RedditAdapter(), Platform.REDDIT, ActionName.CONNECT),
        (LinkedInAdapter(), Platform.LINKEDIN, ActionName.REPLY),
    ],
)
async def test_unsupported_writes_are_rejected_by_adapters(
    adapter, platform: Platform, action_name: ActionName
) -> None:
    action = RenderedAction(
        request=ActionRequest(
            platform=platform,
            action=action_name,
            account="primary",
            target="123",
            text="hello",
        )
    )

    with pytest.raises(ValueError, match="support|migrated"):
        await adapter.render_action(action)


async def test_x_profile_handle_is_validated_before_worker_call() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock()

    with pytest.raises(ValueError, match="account handles"):
        await adapter.get_profile("https://x.com/reader")

    adapter._call.assert_not_awaited()


async def test_x_reshare_rejects_an_ignored_reaction() -> None:
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.RESHARE,
            account="primary",
            target="123",
            reaction=ReactionName.LIKE,
        )
    )

    with pytest.raises(ValueError, match="remove reaction"):
        await XAdapter().render_action(action)


async def test_linkedin_person_profile_uses_main_profile_section() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/in/reader/",
            "sections": {"main_profile": "Reader profile"},
        }
    )

    result = await adapter.get_profile("reader")

    assert result.profiles[0].bio == "Reader profile"
    assert "sections" not in result.profiles[0].provider_metadata


async def test_linkedin_search_rounds_page_budget_up() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(return_value={"references": {"search_results": []}})

    await adapter.search("agents", 19)

    adapter._call.assert_awaited_once_with("search_posts", {"keywords": "agents", "max_pages": 2})
