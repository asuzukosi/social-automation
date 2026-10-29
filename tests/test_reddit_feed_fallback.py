from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import httpx

from social_automation.platforms.reddit.browser import RedditBrowser
from social_automation.platforms.reddit.reader import RedditReader

RSS_FEED = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_rss123</id>
    <title>RSS post</title>
    <author><name>/u/reader</name></author>
    <published>2026-10-11T12:00:00Z</published>
    <link href="https://www.reddit.com/r/shoebots/comments/rss123/rss_post/" />
  </entry>
</feed>"""

BROWSER_FEED = {
    "data": {
        "after": None,
        "children": [
            {
                "kind": "t3",
                "data": {
                    "id": "browser123",
                    "author": "reader",
                    "created_utc": 1_760_184_000,
                    "num_comments": 7,
                    "permalink": "/r/shoebots/comments/browser123/browser_post/",
                    "score": 42,
                    "selftext": "Authenticated body",
                    "subreddit": "shoebots",
                    "title": "Authenticated post",
                },
            }
        ],
    }
}


def blocked_public_json() -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://www.reddit.com/r/shoebots/hot.json")
    response = httpx.Response(403, request=request)
    return httpx.HTTPStatusError("blocked", request=request, response=response)


async def test_feed_uses_browser_json_when_public_json_is_blocked() -> None:
    browser = SimpleNamespace(request_json=AsyncMock(return_value=BROWSER_FEED))
    reader = RedditReader("test-agent", cast(RedditBrowser, browser))
    reader._get = AsyncMock(side_effect=blocked_public_json())
    reader.rss = AsyncMock(return_value=RSS_FEED)

    result = await reader.feed("/r/shoebots", "shoebots", 5)

    assert result.items[0].native_id == "browser123"
    assert result.items[0].engagement == {"score": 42, "comments": 7}


async def test_feed_uses_rss_when_browser_json_is_also_blocked() -> None:
    browser = SimpleNamespace(request_json=AsyncMock(side_effect=RuntimeError("blocked")))
    reader = RedditReader("test-agent", cast(RedditBrowser, browser))
    reader._get = AsyncMock(side_effect=blocked_public_json())
    reader.rss = AsyncMock(return_value=RSS_FEED)

    result = await reader.feed("/r/shoebots", "shoebots", 5)

    assert result.items[0].native_id == "rss123"
