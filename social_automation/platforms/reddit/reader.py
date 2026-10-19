"""Credential-free Reddit read transport with a narrow RSS fallback."""

import asyncio
import time
from collections.abc import Mapping
from typing import Any

import httpx

from social_automation.core.models import Completeness, ReadResult
from social_automation.platforms.reddit.browser import RedditBrowser
from social_automation.platforms.reddit.mapping import post_from_row, posts_from_atom


class RedditReader:
    def __init__(self, user_agent: str, browser: RedditBrowser) -> None:
        self._user_agent = user_agent
        self._browser = browser
        self._json_blocked_until = 0.0
        self._client: httpx.AsyncClient | None = None
        self._client_lock = asyncio.Lock()

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def feed(
        self, path: str, subreddit: str, limit: int, cursor: str | None = None
    ) -> ReadResult:
        if cursor is None and time.monotonic() < self._json_blocked_until:
            return await self._rss_feed(path, subreddit, limit)
        params: dict[str, str | int] = {"limit": limit}
        if cursor:
            params["after"] = cursor
        try:
            data = await self.json(f"{path}/hot", params, browser_fallback=cursor is not None)
        except httpx.HTTPStatusError as error:
            if error.response.status_code != 403:
                raise
            self._json_blocked_until = time.monotonic() + 15 * 60
            return await self._rss_feed(path, subreddit, limit)
        children = data.get("data", {}).get("children", [])
        return ReadResult(
            completeness=Completeness.PARTIAL
            if data.get("data", {}).get("after")
            else Completeness.COMPLETE,
            cursor=data.get("data", {}).get("after"),
            items=[post_from_row(row["data"]) for row in children if row.get("kind") == "t3"],
        )

    async def _rss_feed(self, path: str, subreddit: str, limit: int) -> ReadResult:
        xml = await self.rss(f"{path}/.rss", {"limit": limit})
        return ReadResult(
            completeness=Completeness.PARTIAL,
            reason="Reddit blocked anonymous JSON; RSS omits engagement and pagination",
            items=posts_from_atom(xml, subreddit)[:limit],
        )

    async def json(
        self,
        path: str,
        params: dict[str, str | int] | None = None,
        *,
        browser_fallback: bool = True,
    ) -> Any:
        url = f"https://www.reddit.com{path}.json"
        try:
            return await self._get(url, params, parse_json=True)
        except httpx.HTTPStatusError as error:
            if error.response.status_code != 403 or not browser_fallback:
                raise
            browser_params: dict[str, str | float | bool] | None = (
                {key: value for key, value in params.items()} if params else None
            )
            return await self._browser.request_json(url, browser_params)

    async def rss(self, path: str, params: dict[str, int]) -> str:
        value = await self._get(f"https://www.reddit.com{path}", params, parse_json=False)
        if not isinstance(value, str):
            raise ValueError("Reddit RSS response was not text")
        return value

    async def _get(
        self,
        url: str,
        params: Mapping[str, str | int] | None,
        *,
        parse_json: bool,
    ) -> Any:
        client = await self._get_client()
        response = await client.get(
            url,
            params=params,
            headers={"User-Agent": self._user_agent},
        )
        response.raise_for_status()
        return response.json() if parse_json else response.text

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        async with self._client_lock:
            if self._client is None:
                self._client = httpx.AsyncClient(timeout=30)
        return self._client
