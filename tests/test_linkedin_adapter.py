"""LinkedIn routing tests that never open a browser."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from social_automation.core.models import ActionName, ActionRequest, Platform, RenderedAction
from social_automation.platforms.linkedin.adapter import LinkedInAdapter
from social_automation.platforms.linkedin.browser_actions import LinkedInBrowserActions
from social_automation.platforms.linkedin.runtime import LinkedInRuntime


async def test_linkedin_runtime_closes_managed_browser(monkeypatch) -> None:
    close = AsyncMock()
    monkeypatch.setattr("social_automation.platforms.linkedin.runtime.close_browser", close)

    await LinkedInRuntime().close()

    close.assert_awaited_once()


async def test_linkedin_reaction_confirmation_requires_observed_state(monkeypatch) -> None:
    locator = SimpleNamespace(get_attribute=AsyncMock(side_effect=["false", "true"]))
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.browser_actions.asyncio.sleep", AsyncMock()
    )

    observed = await LinkedInBrowserActions._attribute_becomes(locator, "aria-pressed", "true")

    assert observed is True


async def test_create_post_routes_to_imported_runtime() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "status": "outcome_unknown",
            "confirmed": False,
            "retry_safe": False,
            "message": "submitted",
        }
    )
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.CREATE_POST,
            account="primary",
            text="A carefully previewed post",
        ),
        rendered_text="A carefully previewed post",
    )

    result = await adapter.execute_action(action, "idempotency-key")

    adapter._call.assert_awaited_once_with("create_post", {"text": "A carefully previewed post"})
    assert result.status == "outcome_unknown"
    assert result.retry_safe is False


async def test_linkedin_never_marks_write_retry_safe() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={"status": "send_failed", "retry_safe": True, "message": "uncertain"}
    )
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.CONNECT,
            account="primary",
            target="reader",
        )
    )

    result = await adapter.execute_action(action, "idempotency-key")

    assert result.retry_safe is False


def test_linkedin_write_capabilities_are_truthful() -> None:
    capabilities = {item.operation: item for item in LinkedInAdapter().capabilities()}

    assert capabilities["create_post"].supported is True
    assert capabilities["create_post"].reliably_confirmed is False
    assert capabilities["comment"].supported is True
    assert capabilities["react"].reliably_confirmed is True
    assert capabilities["delete_post"].supported is True
    assert capabilities["reply"].supported is False


async def test_linkedin_feed_stays_behind_normalized_contract() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "text": "Visible feed text",
            "references": [{"kind": "feed_post", "url": "/posts/post-1/"}],
            "error": None,
        }
    )

    result = await adapter.get_feed(None, 10)

    adapter._call.assert_awaited_once_with("get_feed", {"num_posts": 10})
    assert result.items[0].native_id == "post-1"
    assert result.items[0].canonical_url == "https://www.linkedin.com/posts/post-1/"
    assert result.items[0].provider_metadata == {
        "reference": {"kind": "feed_post", "url": "/posts/post-1/"}
    }


async def test_linkedin_home_feed_uses_the_signed_in_feed() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(return_value={"references": [], "error": None})

    result = await adapter.get_feed("home", 3)

    adapter._call.assert_awaited_once_with("get_feed", {"num_posts": 3})
    assert result.completeness.value == "partial"


async def test_linkedin_feed_rejects_unstable_cursor() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock()

    result = await adapter.get_feed(None, 10, "unstable-page")

    assert result.completeness.value == "blocked"
    assert "stable feed cursor" in str(result.reason)
    adapter._call.assert_not_awaited()


async def test_linkedin_search_keeps_only_post_references() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "sections": {"search_results": "Visible results"},
            "references": {
                "search_results": [
                    {"kind": "person", "url": "/in/reader/", "text": "Reader"},
                    {"kind": "feed_post", "url": "/posts/post-1/", "text": "Post"},
                ]
            },
        }
    )

    result = await adapter.search("agents", 10)

    assert [item.native_id for item in result.items] == ["post-1"]
    assert result.items[0].text == "Post"


async def test_linkedin_thread_returns_blocked_without_opening_browser() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock()

    result = await adapter.get_thread("https://www.linkedin.com/posts/example-123/", 10)

    assert result.completeness.value == "blocked"
    adapter._call.assert_not_awaited()


async def test_linkedin_post_read_reports_bounded_page_content() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/posts/example-123/",
            "text": "Post body and visible comments",
            "references": [],
            "error": None,
        }
    )

    result = await adapter.get_post("https://www.linkedin.com/posts/example-123/")

    assert result.completeness.value == "partial"
    assert "bounded" in str(result.reason)
    assert result.items[0].text == "Post body and visible comments"


async def test_linkedin_post_read_refuses_other_origins() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock()

    with pytest.raises(ValueError, match="HTTPS LinkedIn post URL"):
        await adapter.get_post("https://linkedin.com.evil.example/posts/example")

    adapter._call.assert_not_awaited()


async def test_linkedin_write_preview_canonicalizes_targets() -> None:
    adapter = LinkedInAdapter()
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.COMMENT,
            account="primary",
            target="https://linkedin.com/posts/example-123/",
            text="hello",
        )
    )

    rendered = await adapter.render_action(action)

    assert rendered.request.target == "https://linkedin.com/posts/example-123/"
    with pytest.raises(ValueError, match="profile IDs"):
        await adapter.render_action(
            RenderedAction(
                request=ActionRequest(
                    platform=Platform.LINKEDIN,
                    action=ActionName.CONNECT,
                    account="primary",
                    target="reader?trk=unsafe",
                )
            )
        )


async def test_linkedin_post_error_without_content_is_blocked() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/posts/example-123/",
            "text": "",
            "error": {"error_type": "checkpoint"},
        }
    )

    result = await adapter.get_post("https://www.linkedin.com/posts/example-123/")

    assert result.completeness.value == "blocked"
    assert result.items == []


async def test_linkedin_profile_error_without_content_is_blocked() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "sections": {},
            "section_errors": {"main_profile": {"error_type": "checkpoint"}},
        }
    )

    result = await adapter.get_profile("reader")

    assert result.completeness.value == "blocked"
    assert result.profiles == []


async def test_linkedin_company_url_routes_to_company_reader() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/company/example/",
            "sections": {"about": "Example company"},
        }
    )

    result = await adapter.get_profile("https://www.linkedin.com/company/example/")

    adapter._call.assert_awaited_once_with("get_company_profile", {"company_name": "example"})
    assert result.completeness.value == "partial"
    assert result.profiles[0].bio == "Example company"
    assert result.profiles[0].provider_metadata["profile_kind"] == "company"
