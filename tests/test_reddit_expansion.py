from typing import cast
from unittest.mock import AsyncMock

from social_automation.platforms.reddit.adapter import RedditAdapter
from social_automation.platforms.reddit.browser import RedditBrowser


class BrowserStub:
    pass


async def test_reddit_stops_when_more_placeholder_repeats() -> None:
    adapter = RedditAdapter(browser=cast(RedditBrowser, BrowserStub()))
    adapter._reader.json = AsyncMock(
        return_value={
            "json": {"data": {"things": [{"kind": "more", "data": {"children": ["same"]}}]}}
        }
    )

    rows, remaining = await adapter._expand_comments("post", [], ["same"], 20)

    assert rows == []
    assert remaining == ["same"]
    adapter._reader.json.assert_awaited_once()


async def test_reddit_redacts_expansion_errors(monkeypatch) -> None:
    adapter = RedditAdapter(browser=cast(RedditBrowser, BrowserStub()))
    monkeypatch.setenv("X_COOKIES", "private-cookie")
    adapter._post_listing = AsyncMock(
        return_value=[
            {
                "data": {
                    "children": [
                        {
                            "kind": "t3",
                            "data": {
                                "id": "post",
                                "permalink": "/comments/post/title/",
                                "title": "Title",
                                "selftext": "Body",
                                "created_utc": 1,
                                "author": "poster",
                            },
                        }
                    ]
                }
            },
            {"data": {"children": [{"kind": "more", "data": {"children": ["next"]}}]}},
        ]
    )
    adapter._expand_comments = AsyncMock(side_effect=RuntimeError("Cookie: private-cookie"))

    result = await adapter.get_thread("post", 20)

    assert "private-cookie" not in str(result.reason)
    assert "[redacted]" in str(result.reason)


async def test_reddit_thread_reports_partial_when_loaded_rows_meet_limit() -> None:
    adapter = RedditAdapter(browser=cast(RedditBrowser, BrowserStub()))
    post = {
        "id": "post",
        "permalink": "/r/example/comments/post/title/",
        "title": "Title",
        "selftext": "Body",
        "created_utc": 1,
        "author": "poster",
    }

    def comment(comment_id: str) -> dict[str, object]:
        return {
            "id": comment_id,
            "parent_id": "t3_post",
            "permalink": f"/r/example/comments/post/title/{comment_id}/",
            "body": comment_id,
            "created_utc": 2,
            "author": "reader",
            "replies": "",
        }

    adapter._post_listing = AsyncMock(
        return_value=[
            {"data": {"children": [{"kind": "t3", "data": post}]}},
            {
                "data": {
                    "children": [
                        {"kind": "t1", "data": comment("one")},
                        {"kind": "t1", "data": comment("two")},
                    ]
                }
            },
        ]
    )

    result = await adapter.get_thread("post", 2)

    assert result.completeness.value == "partial"
    assert result.reason == "The requested comment limit was reached"
    assert len(result.thread) == 2


async def test_reddit_expands_more_comments_and_restores_nesting() -> None:
    adapter = RedditAdapter(browser=cast(RedditBrowser, BrowserStub()))
    post = {
        "id": "post",
        "permalink": "/r/example/comments/post/title/",
        "title": "Title",
        "selftext": "Body",
        "created_utc": 1,
        "author": "poster",
    }
    parent = {
        "id": "parent",
        "parent_id": "t3_post",
        "permalink": "/r/example/comments/post/title/parent/",
        "body": "Parent",
        "created_utc": 2,
        "author": "one",
        "replies": "",
    }
    child = {
        "id": "child",
        "parent_id": "t1_parent",
        "permalink": "/r/example/comments/post/title/child/",
        "body": "Child",
        "created_utc": 3,
        "author": "two",
        "replies": "",
    }
    adapter._post_listing = AsyncMock(
        return_value=[
            {"data": {"children": [{"kind": "t3", "data": post}]}},
            {
                "data": {
                    "children": [
                        {"kind": "t1", "data": parent},
                        {"kind": "more", "data": {"children": ["child"]}},
                    ]
                }
            },
        ]
    )
    adapter._reader.json = AsyncMock(
        return_value={"json": {"data": {"things": [{"kind": "t1", "data": child}]}}}
    )

    result = await adapter.get_thread("post", 20)

    assert result.completeness.value == "complete"
    assert result.thread[0].post.native_id == "parent"
    assert result.thread[0].children[0].post.native_id == "child"
    assert adapter._reader.json.await_args.args[1]["link_id"] == "t3_post"
