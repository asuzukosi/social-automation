"""The internal LinkedIn bridge matches the pinned package contract."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from linkedin_mcp_server.linkedin.contracts import ExtractedSection

from social_automation.platforms.linkedin.runtime import LinkedInRuntime


def prepare_read_runtime(monkeypatch, extractor: object) -> SimpleNamespace:
    page = SimpleNamespace(
        is_closed=lambda: False,
        evaluate=AsyncMock(return_value=True),
    )
    context = SimpleNamespace(new_page=AsyncMock(return_value=page))
    browser = SimpleNamespace(
        context=context,
        page=SimpleNamespace(evaluate=AsyncMock(return_value=True)),
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_ready_extractor",
        AsyncMock(return_value=extractor),
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_or_create_browser",
        AsyncMock(return_value=browser),
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.LinkedInExtractor",
        lambda selected_page: extractor,
    )
    return page


async def test_linkedin_runtime_recycles_a_detached_browser(monkeypatch) -> None:
    first = SimpleNamespace()
    replacement = SimpleNamespace()
    browser = SimpleNamespace(
        page=SimpleNamespace(
            evaluate=AsyncMock(side_effect=RuntimeError("Frame was detached"))
        )
    )
    ready = AsyncMock(side_effect=[first, replacement])
    close = AsyncMock()
    runtime = LinkedInRuntime()
    runtime._pages.close = AsyncMock()
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_ready_extractor",
        ready,
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_or_create_browser",
        AsyncMock(return_value=browser),
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.close_browser",
        close,
    )

    extractor = await runtime._ready_extractor("get_person_profile")

    assert extractor is replacement
    runtime._pages.close.assert_awaited_once()
    close.assert_awaited_once()
    assert ready.await_count == 2


async def test_linkedin_runtime_recovery_closes_pages_and_browser(monkeypatch) -> None:
    runtime = LinkedInRuntime()
    runtime._pages.close = AsyncMock()
    close = AsyncMock()
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.close_browser",
        close,
    )

    await runtime.recover()

    runtime._pages.close.assert_awaited_once()
    close.assert_awaited_once()


def test_linkedin_activity_boost_url_yields_stable_post_url() -> None:
    url = LinkedInRuntime._post_url(
        "https://www.linkedin.com/campaignmanager/boost/?content=urn%3Ali%3Ashare%3A123"
    )

    assert url == "https://www.linkedin.com/feed/update/urn:li:share:123/"


def test_linkedin_profile_url_yields_activity_url() -> None:
    url = LinkedInRuntime._activity_url("https://www.linkedin.com/in/reader/?tracking=ignored")

    assert url == "https://www.linkedin.com/in/reader/recent-activity/all/"


@pytest.mark.parametrize(
    ("name", "arguments", "method_name", "expected_args", "expected_kwargs"),
    [
        (
            "search_posts",
            {"keywords": "agents", "max_pages": 2},
            "search_posts",
            ("agents",),
            {"max_pages": 2},
        ),
        (
            "get_person_profile",
            {"linkedin_username": "reader"},
            "read_person",
            ("reader", {"main_profile"}),
            {},
        ),
        (
            "get_company_profile",
            {"company_name": "example"},
            "read_company",
            ("example", {"about"}),
            {},
        ),
        (
            "get_inbox",
            {"limit": 20},
            "get_inbox",
            (),
            {"limit": 20},
        ),
        (
            "get_conversation",
            {"linkedin_username": "reader", "thread_id": None, "index": 0},
            "get_conversation",
            (),
            {"linkedin_username": "reader", "thread_id": None, "index": 0},
        ),
        (
            "connect_with_person",
            {"linkedin_username": "reader", "note": "hello"},
            "connect_with_person",
            ("reader",),
            {"note": "hello"},
        ),
        (
            "send_message",
            {"linkedin_username": "reader", "message": "hello", "confirm_send": True},
            "send_message",
            ("reader", "hello"),
            {"confirm_send": True},
        ),
    ],
)
async def test_linkedin_runtime_routes_imported_operations(
    monkeypatch,
    name: str,
    arguments: dict[str, object],
    method_name: str,
    expected_args: tuple[object, ...],
    expected_kwargs: dict[str, object],
) -> None:
    method = AsyncMock(return_value={"status": "ok"})
    extractor = SimpleNamespace(**{method_name: method})
    prepare_read_runtime(monkeypatch, extractor)

    result = await LinkedInRuntime().call(name, arguments)

    assert result == {"status": "ok"}
    method.assert_awaited_once_with(*expected_args, **expected_kwargs)


async def test_linkedin_runtime_uses_more_menu_connect_fallback(monkeypatch) -> None:
    unavailable = {"status": "connect_unavailable"}
    connect = AsyncMock(return_value=unavailable)
    extractor = SimpleNamespace(connect_with_person=connect)
    actions = SimpleNamespace(
        connect_from_more=AsyncMock(return_value={"status": "connected"})
    )
    prepare_read_runtime(monkeypatch, extractor)
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.LinkedInRuntime._actions",
        AsyncMock(return_value=actions),
    )

    result = await LinkedInRuntime().call(
        "connect_with_person",
        {"linkedin_username": "reader", "note": "hello"},
    )

    assert result == {"status": "connected"}
    connect.assert_awaited_once_with("reader", note="hello")
    actions.connect_from_more.assert_awaited_once_with(
        extractor,
        "reader",
        "hello",
        unavailable,
    )


@pytest.mark.parametrize(
    ("name", "arguments", "method_name", "expected_args"),
    [
        ("get_feed", {"num_posts": 10}, "extract_feed", (10,)),
        (
            "read_post",
            {"post_url": "https://www.linkedin.com/posts/example"},
            "extract_page",
            ("https://www.linkedin.com/posts/example", "post", 5),
        ),
    ],
)
async def test_linkedin_runtime_serializes_extracted_sections(
    monkeypatch,
    name: str,
    arguments: dict[str, object],
    method_name: str,
    expected_args: tuple[object, ...],
) -> None:
    method = AsyncMock(return_value=ExtractedSection(text="content", references=[]))
    extractor = SimpleNamespace(**{method_name: method})
    prepare_read_runtime(monkeypatch, extractor)

    result = await LinkedInRuntime().call(name, arguments)

    assert result["text"] == "content"
    method.assert_awaited_once_with(*expected_args)


@pytest.mark.parametrize(
    ("name", "arguments", "method_name", "expected_args"),
    [
        ("create_post", {"text": "hello"}, "create_post", ("hello",)),
        (
            "comment_on_post",
            {"post_url": "https://www.linkedin.com/posts/example", "text": "hello"},
            "comment",
            ("https://www.linkedin.com/posts/example", "hello"),
        ),
        (
            "react_to_post",
            {"post_url": "https://www.linkedin.com/posts/example"},
            "react",
            ("https://www.linkedin.com/posts/example",),
        ),
        (
            "delete_post",
            {"post_url": "https://www.linkedin.com/posts/example"},
            "delete",
            ("https://www.linkedin.com/posts/example",),
        ),
    ],
)
async def test_linkedin_runtime_routes_local_browser_writes(
    monkeypatch,
    name: str,
    arguments: dict[str, object],
    method_name: str,
    expected_args: tuple[object, ...],
) -> None:
    method = AsyncMock(return_value={"status": "outcome_unknown"})
    actions = SimpleNamespace(**{method_name: method})
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.LinkedInRuntime._ready_extractor",
        AsyncMock(return_value=SimpleNamespace()),
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.LinkedInRuntime._actions",
        AsyncMock(return_value=actions),
    )

    result = await LinkedInRuntime().call(name, arguments)

    assert result["status"] == "outcome_unknown"
    method.assert_awaited_once_with(*expected_args)
