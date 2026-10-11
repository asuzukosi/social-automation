"""Reddit's integration remains keyless and browser-gated."""

from typing import Any, cast
from unittest.mock import AsyncMock

import httpx
import pytest

from social_automation.core.models import ActionName, ActionRequest, Platform, RenderedAction
from social_automation.platforms.reddit.adapter import RedditAdapter
from social_automation.platforms.reddit.browser import RedditBrowser
from social_automation.platforms.reddit.urls import (
    stop_if_account_attention_required,
    validate_reddit_url,
)


class FakeRedditBrowser:
    def __init__(self) -> None:
        self.action: RenderedAction | None = None
        self.read_result: Any = None

    async def status(self) -> dict[str, object]:
        return {"available": True, "authenticated": True}

    async def execute(self, action: RenderedAction) -> dict[str, Any]:
        self.action = action
        return {
            "status": "confirmed",
            "confirmed": True,
            "retry_safe": False,
            "url": "https://www.reddit.com/r/example/comments/abc123/title/",
        }

    async def request_json(self, url: str, params=None) -> Any:
        del url, params
        return self.read_result


def adapter_with(browser: FakeRedditBrowser) -> RedditAdapter:
    return RedditAdapter(browser=cast(RedditBrowser, browser))


async def test_reddit_writes_use_browser_without_oauth() -> None:
    browser = FakeRedditBrowser()
    adapter = adapter_with(browser)
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.CREATE_POST,
            account="primary",
            target="example",
            text="body",
            title="title",
        )
    )

    rendered = await adapter.render_action(action)
    result = await adapter.execute_action(rendered, "idempotency-key")

    assert browser.action == rendered
    assert result.native_id == "abc123"
    assert result.confirmed is True
    create = next(item for item in adapter.capabilities() if item.operation == "create_post")
    assert create.authentication == "Local Reddit browser profile"
    assert create.access.value == "browser"


async def test_unverified_reddit_create_does_not_return_the_subreddit_as_a_url() -> None:
    browser = FakeRedditBrowser()
    browser.execute = AsyncMock(
        return_value={"status": "outcome_unknown", "confirmed": False, "retry_safe": False}
    )
    adapter = adapter_with(browser)
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.CREATE_POST,
            account="primary",
            target="example",
            text="body",
            title="title",
        ),
        rendered_text="body",
    )

    result = await adapter.execute_action(action, "idempotency-key")

    assert result.canonical_url is None


async def test_reddit_status_does_not_start_browser_session(tmp_path) -> None:
    browser = RedditBrowser(profile=tmp_path / "profile")
    browser._start = AsyncMock()

    status = await browser.status()

    assert status == {"available": True, "authenticated": None}
    browser._start.assert_not_awaited()
    assert not (tmp_path / "profile").exists()


async def test_reddit_post_requires_subreddit_and_title() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    request = ActionRequest(
        platform=Platform.REDDIT,
        action=ActionName.CREATE_POST,
        account="primary",
        text="body",
    )

    with pytest.raises(ValueError, match="subreddit"):
        await adapter.render_action(RenderedAction(request=request))


def test_reddit_reports_confirmation_gated_nested_replies() -> None:
    capabilities = {item.operation: item for item in RedditAdapter().capabilities()}

    assert capabilities["reply"].supported is True
    assert capabilities["reply"].approval_required is True
    assert capabilities["reply"].reliably_confirmed is False


async def test_reddit_reply_requires_comment_permalink() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    request = ActionRequest(
        platform=Platform.REDDIT,
        action=ActionName.REPLY,
        account="primary",
        target="https://www.reddit.com/r/python/comments/abc123/title/",
        text="nested reply",
    )

    with pytest.raises(ValueError, match="comment permalink"):
        await adapter.render_action(RenderedAction(request=request))


def test_reddit_browser_refuses_other_origins() -> None:
    with pytest.raises(ValueError, match="HTTPS Reddit URL"):
        validate_reddit_url("https://reddit.com.evil.example/post")


async def test_reddit_write_preview_refuses_non_post_urls() -> None:
    adapter = adapter_with(FakeRedditBrowser())

    with pytest.raises(ValueError, match="Reddit post URL"):
        await adapter.render_action(
            RenderedAction(
                request=ActionRequest(
                    platform=Platform.REDDIT,
                    action=ActionName.REACT,
                    account="primary",
                    target="https://www.reddit.com/login/",
                    reaction="up",
                )
            )
        )


@pytest.mark.parametrize(
    "url",
    [
        "https://www.reddit.com/login/",
        "https://www.reddit.com/account/suspended",
        "https://www.reddit.com/verify/email",
    ],
)
def test_reddit_browser_stops_at_account_attention_pages(url: str) -> None:
    with pytest.raises(RuntimeError, match="manual account attention"):
        stop_if_account_attention_required(url)


async def test_reddit_profile_uses_public_json_without_credentials() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    adapter._reader.json = AsyncMock(
        return_value={
            "data": {
                "id": "user-id",
                "name": "reader",
                "subreddit": {"public_description": "A public bio"},
            }
        }
    )

    result = await adapter.get_profile("u/reader")

    adapter._reader.json.assert_awaited_once_with("/user/reader/about")
    assert result.profiles[0].account.handle == "reader"
    assert result.profiles[0].bio == "A public bio"


@pytest.mark.parametrize("value", ["../login", "r/python/new", "bad?sort=new"])
async def test_reddit_names_reject_path_syntax(value: str) -> None:
    adapter = adapter_with(FakeRedditBrowser())
    adapter._reader.json = AsyncMock()

    with pytest.raises(ValueError, match="Reddit"):
        await adapter.get_profile(value)
    with pytest.raises(ValueError, match="Reddit"):
        await adapter.get_feed(value, 10)

    adapter._reader.json.assert_not_awaited()


async def test_reddit_profile_allows_missing_public_profile_metadata() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    adapter._reader.json = AsyncMock(
        return_value={"data": {"id": "user-id", "name": "reader", "subreddit": None}}
    )

    result = await adapter.get_profile("reader")

    assert result.profiles[0].bio is None


async def test_reddit_feed_falls_back_to_bounded_rss_on_json_block() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    request = httpx.Request("GET", "https://www.reddit.com/r/python/hot.json")
    response = httpx.Response(403, request=request)
    adapter._reader.json = AsyncMock(
        side_effect=httpx.HTTPStatusError("blocked", request=request, response=response)
    )
    adapter._reader.rss = AsyncMock(
        return_value="""<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>t3_abc123</id>
            <title>Python release</title>
            <author><name>/u/reader</name></author>
            <published>2026-10-11T12:00:00Z</published>
            <link href="https://www.reddit.com/r/python/comments/abc123/python_release/" />
            <content type="html">&lt;div&gt;Release notes&lt;/div&gt;</content>
          </entry>
        </feed>"""
    )

    result = await adapter.get_feed("python", 1)
    again = await adapter.get_feed("python", 1)

    assert result.completeness.value == "partial"
    assert again.completeness.value == "partial"
    assert result.items[0].native_id == "abc123"
    assert result.items[0].account.handle == "reader"
    adapter._reader.json.assert_awaited_once()
    assert adapter._reader.rss.await_count == 2


async def test_reddit_feed_resumes_from_after_cursor() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    adapter._reader.json = AsyncMock(return_value={"data": {"children": [], "after": "next-page"}})

    result = await adapter.get_feed("python", 10, "current-page")

    adapter._reader.json.assert_awaited_once_with(
        "/r/python/hot",
        {"limit": 10, "after": "current-page"},
        browser_fallback=True,
    )
    assert result.cursor == "next-page"


async def test_reddit_json_uses_browser_session_on_public_403() -> None:
    browser = FakeRedditBrowser()
    browser.read_result = {"data": {"name": "reader"}}
    adapter = adapter_with(browser)
    request = httpx.Request("GET", "https://www.reddit.com/user/reader/about.json")
    response = httpx.Response(403, request=request)
    adapter._reader._get = AsyncMock(
        side_effect=httpx.HTTPStatusError("blocked", request=request, response=response)
    )

    result = await adapter._reader.json("/user/reader/about")

    assert result == browser.read_result


async def test_reddit_post_url_is_normalized_before_public_read() -> None:
    adapter = adapter_with(FakeRedditBrowser())
    adapter._reader.json = AsyncMock(
        return_value=[{"data": {"children": []}}, {"data": {"children": []}}]
    )

    await adapter._post_listing("https://www.reddit.com/r/example/comments/abc123/title/", limit=10)

    adapter._reader.json.assert_awaited_once_with("/comments/abc123", {"limit": 10, "depth": 10})
