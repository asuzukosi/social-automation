"""Interactive X authentication through a dedicated browser profile."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from patchright.async_api import BrowserContext, async_playwright


class XAuthentication:
    """Manage the browser profile and worker cookie for X."""

    def __init__(self, home: Path | None = None) -> None:
        self._home = home or Path.home() / ".social-automation" / "x"
        self._profile = self._home / "browser-profile"
        self._cookie_file = self._home / "session.cookies"
        self._lock = asyncio.Lock()

    def cookie_header(self) -> str:
        if self._cookie_file.is_file():
            return self._cookie_file.read_text().strip()
        return os.getenv("X_COOKIES") or os.getenv("XACTIONS_SESSION_COOKIE") or ""

    def has_saved_session(self) -> bool:
        names = {part.partition("=")[0].strip() for part in self.cookie_header().split(";")}
        return {"auth_token", "ct0"} <= names

    async def authenticate(self, force: bool = False) -> dict[str, object]:
        """Open X login and wait for an authenticated browser session."""
        async with self._lock:
            self._home.mkdir(parents=True, exist_ok=True, mode=0o700)
            playwright = await async_playwright().start()
            context = await playwright.chromium.launch_persistent_context(
                str(self._profile),
                channel=os.getenv("SOCIAL_BROWSER_CHANNEL", "chrome"),
                headless=False,
            )
            try:
                if force:
                    await context.clear_cookies()
                    self._remove_cookie_file()
                if force or not await self._authenticated(context):
                    page = context.pages[0] if context.pages else await context.new_page()
                    await page.goto("https://x.com/i/flow/login", wait_until="domcontentloaded")
                    try:
                        async with asyncio.timeout(600):
                            while not await self._authenticated(context):
                                await asyncio.sleep(1)
                    except TimeoutError as error:
                        raise RuntimeError("X login was not completed within 10 minutes") from error
                header = await self._cookie_header(context)
                self._cookie_file.touch(mode=0o600, exist_ok=True)
                self._cookie_file.chmod(0o600)
                self._cookie_file.write_text(header)
                os.environ["X_COOKIES"] = header
                return {"platform": "x", "authenticated": True}
            finally:
                await context.close()
                await playwright.stop()

    async def logout(self) -> dict[str, object]:
        """Clear X cookies from the dedicated profile and worker environment."""
        async with self._lock:
            if self._profile.exists():
                playwright = await async_playwright().start()
                context = await playwright.chromium.launch_persistent_context(
                    str(self._profile),
                    channel=os.getenv("SOCIAL_BROWSER_CHANNEL", "chrome"),
                    headless=False,
                )
                try:
                    await context.clear_cookies()
                finally:
                    await context.close()
                    await playwright.stop()
            self._remove_cookie_file()
            os.environ.pop("X_COOKIES", None)
            os.environ.pop("XACTIONS_SESSION_COOKIE", None)
        return {"platform": "x", "authenticated": False}

    def _remove_cookie_file(self) -> None:
        self._cookie_file.unlink(missing_ok=True)

    @staticmethod
    async def _authenticated(context: BrowserContext) -> bool:
        cookies = await context.cookies("https://x.com")
        names = {str(cookie.get("name")) for cookie in cookies}
        return {"auth_token", "ct0"} <= names

    @staticmethod
    async def _cookie_header(context: BrowserContext) -> str:
        cookies = await context.cookies("https://x.com")
        return "; ".join(
            f"{cookie['name']}={cookie['value']}"
            for cookie in cookies
            if cookie.get("name") and cookie.get("value")
        )
