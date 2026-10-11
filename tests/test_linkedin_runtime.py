"""The internal LinkedIn bridge matches the pinned package contract."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from linkedin_mcp_server.linkedin.contracts import ExtractedSection

from social_automation.platforms.linkedin.runtime import LinkedInRuntime


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
    ready = AsyncMock(return_value=extractor)
    monkeypatch.setattr("social_automation.platforms.linkedin.runtime.get_ready_extractor", ready)

    result = await LinkedInRuntime().call(name, arguments)

    assert result == {"status": "ok"}
    method.assert_awaited_once_with(*expected_args, **expected_kwargs)


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
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_ready_extractor",
        AsyncMock(return_value=extractor),
    )

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
        "social_automation.platforms.linkedin.runtime.get_ready_extractor",
        AsyncMock(return_value=SimpleNamespace()),
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.LinkedInRuntime._actions",
        AsyncMock(return_value=actions),
    )

    result = await LinkedInRuntime().call(name, arguments)

    assert result["status"] == "outcome_unknown"
    method.assert_awaited_once_with(*expected_args)
