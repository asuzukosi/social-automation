"""Reddit writes through a user-owned local browser profile."""

from __future__ import annotations

import asyncio
import os
import sqlite3
import time
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
            authenticated = await self._authenticated(self._context)
        return {
            "available": True,
            "authenticated": authenticated,
        }

    async def authenticate(self, force: bool = False) -> dict[str, object]:
        """Open Reddit login and wait for the dedicated profile to authenticate."""
        async with self._lock:
            context = await self._start()
            if force:
                await context.clear_cookies()
            if not force and await self._authenticated(context):
                return {"platform": "reddit", "authenticated": True}
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto("https://www.reddit.com/login/", wait_until="domcontentloaded")
            try:
                async with asyncio.timeout(600):
                    while not await self._authenticated(context):
                        await asyncio.sleep(1)
            except TimeoutError as error:
                raise RuntimeError("Reddit login was not completed within 10 minutes") from error
            return {"platform": "reddit", "authenticated": True}

    async def authentication_status(self) -> dict[str, object]:
        """Inspect Reddit session cookies without starting a browser."""
        if self._context is not None:
            async with self._lock:
                authenticated: bool | None = await self._authenticated(self._context)
        else:
            authenticated = await asyncio.to_thread(self._saved_authentication)
        return {"authenticated": authenticated}

    async def logout(self) -> dict[str, object]:
        """Clear Reddit cookies from the dedicated profile."""
        async with self._lock:
            context = await self._start()
            await context.clear_cookies()
        return {"platform": "reddit", "authenticated": False}

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

    @staticmethod
    async def _authenticated(context: BrowserContext) -> bool:
        cookies = await context.cookies("https://www.reddit.com")
        names = {str(cookie.get("name")) for cookie in cookies}
        return bool({"reddit_session", "token_v2"} & names)

    def _saved_authentication(self) -> bool | None:
        databases = (
            self._profile / "Default" / "Network" / "Cookies",
            self._profile / "Default" / "Cookies",
            self._profile / "Network" / "Cookies",
            self._profile / "Cookies",
        )
        database = next((path for path in databases if path.is_file()), None)
        if database is None:
            return False
        try:
            with sqlite3.connect(f"{database.as_uri()}?mode=ro", uri=True, timeout=0.1) as db:
                rows = db.execute(
                    "SELECT expires_utc FROM cookies "
                    "WHERE host_key LIKE '%reddit.com' "
                    "AND name IN ('reddit_session', 'token_v2')"
                ).fetchall()
        except sqlite3.Error:
            return None
        chrome_now = int((time.time() + 11_644_473_600) * 1_000_000)
        return any(not expires or int(expires) > chrome_now for (expires,) in rows)

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
