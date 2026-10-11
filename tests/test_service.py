from unittest.mock import AsyncMock

import pytest
from conftest import FakeAdapter

from social_automation.core.models import ActionName, ActionRequest, Platform
from social_automation.service import SocialService


async def test_search_preserves_platform_identity(service: SocialService) -> None:
    result = await service.search("agents", [Platform.X, Platform.REDDIT], 10)

    assert result["results"]["x"]["items"][0]["platform"] == "x"
    assert result["results"]["reddit"]["items"][0]["platform"] == "reddit"


async def test_search_deduplicates_platforms(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    adapter.search = AsyncMock(wraps=adapter.search)

    await service.search("agents", [Platform.X, Platform.X], 10)

    adapter.search.assert_awaited_once_with("agents", 10)


async def test_read_failure_returns_blocked_result(service: SocialService) -> None:
    adapter = service.adapters[Platform.REDDIT]
    adapter.get_feed = AsyncMock(side_effect=RuntimeError("HTTP 403 Blocked"))

    result = await service.get_feed(Platform.REDDIT, "python", 1)

    assert result.completeness.value == "blocked"
    assert result.reason == "HTTP 403 Blocked"


async def test_feed_cursor_is_forwarded_unchanged(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    adapter.get_feed = AsyncMock(return_value=await adapter.get_feed("home", 10))

    await service.get_feed(Platform.X, "home", 10, "next-page")

    adapter.get_feed.assert_awaited_once_with("home", 10, "next-page")


async def test_inspection_does_not_create_state(tmp_path) -> None:
    state_path = tmp_path / "state" / "actions.db"
    adapters = {platform: FakeAdapter(platform) for platform in Platform}
    service = SocialService(state_path, adapters=adapters)

    await service.status()
    service.capabilities()
    service.accounts()

    assert not state_path.exists()
    assert not state_path.parent.exists()


async def test_service_closes_every_adapter(service: SocialService) -> None:
    await service.close()

    assert all(
        isinstance(adapter, FakeAdapter) and adapter.closed == 1
        for adapter in service.adapters.values()
    )


async def test_service_closes_remaining_adapters_after_one_close_fails(
    service: SocialService,
) -> None:
    failed = service.adapters[Platform.X]
    failed.close = AsyncMock(side_effect=RuntimeError("close failed"))

    await service.close()

    assert all(
        isinstance(service.adapters[platform], FakeAdapter)
        and service.adapters[platform].closed == 1
        for platform in (Platform.REDDIT, Platform.LINKEDIN)
    )


def test_accounts_never_require_developer_credentials(service: SocialService) -> None:
    accounts = service.accounts()

    assert {account["authentication"] for account in accounts} == {
        "session_cookie",
        "browser_profile",
    }
    assert all(account["developer_credentials_required"] is False for account in accounts)


async def test_preview_performs_no_write(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.X, action=ActionName.CREATE_POST, account="primary", text="hello"
        )
    )

    assert preview.action.rendered_text == "hello"
    assert preview.policy == "explicit_confirmation_only"
    assert preview.remaining_writes == 1
    assert isinstance(adapter, FakeAdapter)
    assert adapter.executions == 0


async def test_draft_builds_distinct_variants_without_writing(
    service: SocialService,
) -> None:
    draft = service.create_draft(
        "A shared launch note",
        [Platform.X, Platform.REDDIT, Platform.LINKEDIN],
        "primary",
        {"reddit": "r/automation"},
        {"x": "A short launch note", "linkedin": "A professional launch note"},
        {"reddit": "What we shipped"},
    )

    previews = await service.preview_draft(draft.draft_id)

    assert [variant.text for variant in draft.variants] == [
        "A short launch note",
        "A shared launch note",
        "A professional launch note",
    ]
    assert previews[1].action.request.target == "r/automation"
    assert previews[1].action.request.title == "What we shipped"
    assert all(
        isinstance(adapter, FakeAdapter) and adapter.executions == 0
        for adapter in service.adapters.values()
    )


def test_draft_rejects_invalid_platform_variants(service: SocialService) -> None:
    with pytest.raises(ValueError, match="X draft exceeds 280"):
        service.create_draft(
            "x" * 281,
            [Platform.X],
            "primary",
            {},
            {},
            {},
        )

    with pytest.raises(ValueError, match="Reddit drafts require"):
        service.create_draft(
            "hello",
            [Platform.REDDIT],
            "primary",
            {"reddit": "r/automation"},
            {},
            {},
        )

    with pytest.raises(ValueError, match="unselected platforms"):
        service.create_draft(
            "hello",
            [Platform.X],
            "primary",
            {},
            {"linkedin": "not selected"},
            {},
        )


async def test_preview_rejects_an_ambiguous_account(service: SocialService) -> None:
    with pytest.raises(ValueError, match="configured 'primary'"):
        await service.preview_action(
            ActionRequest(
                platform=Platform.X,
                action=ActionName.CREATE_POST,
                account="another-account",
                text="hello",
            )
        )


async def test_preview_rejects_an_unsupported_capability(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    adapter.render_action = AsyncMock()

    with pytest.raises(ValueError, match="does not support comment"):
        await service.preview_action(
            ActionRequest(
                platform=Platform.X,
                action=ActionName.COMMENT,
                account="primary",
                target="123",
                text="hello",
            )
        )

    adapter.render_action.assert_not_awaited()


def test_write_request_requires_action_fields() -> None:
    with pytest.raises(ValueError, match="comment requires text"):
        ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.COMMENT,
            account="primary",
            target="https://www.linkedin.com/posts/example",
        )

    with pytest.raises(ValueError, match="react requires a target"):
        ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.REACT,
            account="primary",
        )

    with pytest.raises(ValueError, match="react requires a reaction"):
        ActionRequest(
            platform=Platform.X,
            action=ActionName.REACT,
            account="primary",
            target="123",
        )
