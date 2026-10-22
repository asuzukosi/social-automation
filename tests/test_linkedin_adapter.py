"""LinkedIn routing tests that never open a browser."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

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


async def test_linkedin_more_menu_connect_opens_invite_dialog(monkeypatch) -> None:
    page = SimpleNamespace()
    navigator = SimpleNamespace(_navigate_to_page=AsyncMock())
    workflow = SimpleNamespace(_open_more_menu=AsyncMock(return_value=True))
    actions = LinkedInBrowserActions(SimpleNamespace(page=page), navigator)
    monkeypatch.setattr(actions, "_click_visible_connect", AsyncMock(return_value=True))

    opened = await actions._open_more_connect(workflow, "reader")

    assert opened is True
    navigator._navigate_to_page.assert_awaited_once_with(
        "https://www.linkedin.com/in/reader/"
    )
    workflow._open_more_menu.assert_awaited_once_with()


async def test_linkedin_more_menu_accepts_connect_button_role(monkeypatch) -> None:
    missing_menuitem = SimpleNamespace(count=AsyncMock(return_value=0))
    connect = SimpleNamespace(
        count=AsyncMock(return_value=1),
        nth=Mock(),
        is_visible=AsyncMock(return_value=True),
        click=AsyncMock(),
    )
    connect.nth.return_value = connect
    page = SimpleNamespace(
        get_by_role=Mock(side_effect=[missing_menuitem, connect])
    )

    @asynccontextmanager
    async def available(element, timeout=8000):
        del timeout
        yield element

    monkeypatch.setattr(
        "social_automation.platforms.linkedin.browser_actions.linkedin_element",
        available,
    )
    actions = LinkedInBrowserActions(SimpleNamespace(page=page), SimpleNamespace())

    clicked = await actions._click_visible_connect()

    assert clicked is True
    page.get_by_role.assert_any_call("button", name="Connect", exact=True)
    connect.click.assert_awaited_once()


async def test_linkedin_more_menu_connect_verifies_pending_state(monkeypatch) -> None:
    submit = AsyncMock(return_value=(True, True, None))
    signals = SimpleNamespace()
    read_profile = AsyncMock(return_value={"sections": {"main_profile": "Reader"}})
    read_signals = AsyncMock(return_value=signals)
    extractor = SimpleNamespace(
        _connection=SimpleNamespace(
            _submit_invite_dialog=submit,
            _read_main_profile=read_profile,
            _read_action_signals=read_signals,
        ),
    )
    actions = LinkedInBrowserActions(
        SimpleNamespace(page=SimpleNamespace()),
        SimpleNamespace(),
    )
    monkeypatch.setattr(actions, "_open_more_connect", AsyncMock(return_value=True))
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.browser_actions.connection.detect_connection_state",
        Mock(return_value="pending"),
    )

    result = await actions.connect_from_more(
        extractor,
        "reader",
        "hello",
        {"status": "connect_unavailable"},
    )

    assert result["status"] == "connected"
    assert result["note_sent"] is True
    submit.assert_awaited_once_with("hello")
    read_profile.assert_awaited_once_with("reader")
    read_signals.assert_awaited_once_with("reader")


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


async def test_linkedin_inbox_returns_conversation_references() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/messaging/",
            "sections": {"inbox": "Reader\nLatest message"},
            "references": {
                "inbox": [
                    {
                        "kind": "conversation",
                        "url": "/messaging/thread/thread-123/",
                        "text": "Reader",
                        "context": "inbox",
                    }
                ]
            },
        }
    )

    result = await adapter.get_inbox(20)

    assert result.completeness.value == "partial"
    assert result.conversations[0].thread_id == "thread-123"
    assert result.conversations[0].participant_name == "Reader"
    assert result.conversations[0].canonical_url == (
        "https://www.linkedin.com/messaging/thread/thread-123/"
    )
    assert result.provider_metadata["inbox_text"] == "Reader\nLatest message"


async def test_linkedin_conversation_returns_visible_transcript() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/messaging/thread/thread-123/",
            "sections": {"conversation": "Reader\nHello\nYou\nHi"},
            "references": {"conversation": []},
        }
    )

    result = await adapter.get_conversation(thread_id="thread-123")

    adapter._call.assert_awaited_once_with(
        "get_conversation",
        {"linkedin_username": None, "thread_id": "thread-123", "index": 0},
    )
    assert result.completeness.value == "partial"
    assert result.conversations[0].thread_id == "thread-123"
    assert result.conversations[0].transcript == "Reader\nHello\nYou\nHi"


async def test_linkedin_conversation_keeps_profile_handle_separate_from_name() -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(
        return_value={
            "url": "https://www.linkedin.com/messaging/thread/thread-123/",
            "sections": {"conversation": "Reader\nHello"},
            "references": {"conversation": []},
        }
    )

    result = await adapter.get_conversation(profile_id="https://linkedin.com/in/reader")

    assert result.conversations[0].participant_id == "reader"
    assert result.conversations[0].participant_name is None


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
