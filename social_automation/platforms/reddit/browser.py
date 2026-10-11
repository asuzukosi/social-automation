"""Reddit writes through a user-owned local browser profile."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from patchright.async_api import (
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

from social_automation.core.models import RenderedAction
from social_automation.platforms.reddit.browser_actions import RedditBrowserActions
from social_automation.platforms.reddit.urls import (
    stop_if_account_attention_required,
    validate_reddit_url,
)


class RedditBrowser:
    """Drive Reddit's visible UI without developer credentials."""

    def __init__(self, profile: Path | None = None) -> None:
        self._profile = profile or Path.home() / ".social-automation" / "reddit-profile"
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self._actions = RedditBrowserActions()
        self._lock = asyncio.Lock()

    async def status(self) -> dict[str, object]:
        if self._context is None:
            return {
                "available": True,
                "authenticated": None,
            }
        async with self._lock:
            cookies = await self._context.cookies("https://www.reddit.com")
        names = {str(cookie.get("name")) for cookie in cookies}
        authenticated = bool({"reddit_session", "token_v2"} & names)
        return {
            "available": True,
            "authenticated": authenticated,
        }

    async def execute(self, action: RenderedAction) -> dict[str, Any]:
        async with self._lock:
            page = await self._page()
            return await self._actions.execute(page, action)

    async def close(self) -> None:
        async with self._lock:
            try:
                if self._context is not None:
                    await self._context.close()
            finally:
                self._context = None
                if self._playwright is not None:
                    await self._playwright.stop()
                self._playwright = None

    async def request_json(
        self,
        url: str,
        params: dict[str, str | float | bool] | None = None,
    ) -> Any:
        validate_reddit_url(url)
        async with self._lock:
            context = await self._start()
            response = await context.request.get(url, params=params)
        validate_reddit_url(response.url)
        stop_if_account_attention_required(response.url)
        if not response.ok:
            raise RuntimeError(
                f"Reddit browser session returned HTTP {response.status}; sign in and retry later"
            )
        if "json" not in response.headers.get("content-type", ""):
            raise RuntimeError("Reddit browser session did not return JSON; sign in manually")
        return await response.json()

    async def _start(self) -> BrowserContext:
        if self._context is not None:
            return self._context
        self._profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._playwright = await async_playwright().start()
        self._context = await self._playwright.chromium.launch_persistent_context(
            str(self._profile),
            channel=os.getenv("SOCIAL_BROWSER_CHANNEL", "chrome"),
            headless=False,
        )
        return self._context

    async def _page(self) -> Page:
        context = await self._start()
        return context.pages[0] if context.pages else await context.new_page()
