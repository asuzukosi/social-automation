"""Direct Python integration with the imported LinkedIn browser runtime."""

import asyncio
import sys
from dataclasses import asdict
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

from linkedin_mcp_server.authentication import clear_auth_state, get_authentication_source
from linkedin_mcp_server.dependencies import get_ready_extractor
from linkedin_mcp_server.drivers.browser import close_browser, get_or_create_browser
from linkedin_mcp_server.exceptions import CredentialsNotFoundError
from linkedin_mcp_server.linkedin import LinkedInExtractor
from linkedin_mcp_server.linkedin.navigation import PageNavigator
from linkedin_mcp_server.linkedin.session import PageSession

from social_automation.platforms.linkedin.browser_actions import LinkedInBrowserActions
from social_automation.platforms.linkedin.page_pool import LinkedInPagePool
from social_automation.platforms.linkedin.urls import normalize_linkedin_url

_READ_OPERATIONS = {
    "search_posts",
    "get_feed",
    "get_person_profile",
    "get_company_profile",
    "read_post",
}


class LinkedInRuntime:
    """Run LinkedIn operations through one authenticated browser page."""

    def __init__(self) -> None:
        self._lifecycle_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._pages = LinkedInPagePool(size=1)

    async def status(self) -> dict[str, object]:
        """Report whether a LinkedIn browser profile has been configured."""
        try:
            get_authentication_source()
        except Exception:
            return {"available": True, "authenticated": False}
        return {"available": True, "authenticated": True}

    async def close(self) -> None:
        await self.recover()

    async def recover(self) -> None:
        async with self._lifecycle_lock:
            await self._pages.close()
            await close_browser()

    async def authenticate(self, force: bool = False) -> dict[str, object]:
        """Run LinkedIn's supported interactive profile login."""
        async with self._lifecycle_lock:
            if not force:
                try:
                    get_authentication_source()
                    return {"platform": "linkedin", "authenticated": True}
                except CredentialsNotFoundError:
                    pass
            await self._pages.close()
            await close_browser()
            if force:
                await asyncio.to_thread(clear_auth_state)
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "linkedin_mcp_server",
                "--login",
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            await process.communicate()
            if process.returncode != 0:
                raise RuntimeError("LinkedIn login did not complete")
            get_authentication_source()
            return {"platform": "linkedin", "authenticated": True}

    async def authentication_status(self) -> dict[str, object]:
        """Check whether LinkedIn has a saved local session."""
        try:
            get_authentication_source()
            authenticated = True
        except CredentialsNotFoundError:
            authenticated = False
        return {"authenticated": authenticated}

    async def logout(self) -> dict[str, object]:
        """Clear the LinkedIn package's saved browser session."""
        async with self._lifecycle_lock:
            await self._pages.close()
            await close_browser()
            await asyncio.to_thread(clear_auth_state)
        return {"platform": "linkedin", "authenticated": False}

    async def call(self, name: str, arguments: dict[str, object]) -> dict[str, Any]:
        if name in _READ_OPERATIONS:
            return await self._read(name, arguments)
        async with self._write_lock:
            extractor = await self._ready_extractor(name)
            if name == "connect_with_person":
                result = await extractor.connect_with_person(
                    str(arguments["linkedin_username"]), note=self._optional(arguments, "note")
                )
                if result.get("status") == "connect_unavailable":
                    actions = await self._actions()
                    return await actions.connect_from_more(
                        extractor,
                        str(arguments["linkedin_username"]),
                        self._optional(arguments, "note"),
                        cast(dict[str, Any], result),
                    )
                return cast(dict[str, Any], result)
            if name == "send_message":
                result = await extractor.send_message(
                    str(arguments["linkedin_username"]),
                    str(arguments["message"]),
                    confirm_send=bool(arguments["confirm_send"]),
                )
                return cast(dict[str, Any], result)
            actions = await self._actions()
            if name == "create_post":
                text = str(arguments["text"])
                result = await actions.create_post(text)
                if result.get("status") == "submitted":
                    return await self._confirm_created_post(text, result)
                return result
            if name == "delete_post":
                return await actions.delete(str(arguments["post_url"]))
            if name == "comment_on_post":
                return await actions.comment(str(arguments["post_url"]), str(arguments["text"]))
            if name == "react_to_post":
                return await actions.react(str(arguments["post_url"]))
            raise ValueError(f"Unknown LinkedIn operation: {name}")

    async def _read(self, name: str, arguments: dict[str, object]) -> dict[str, Any]:
        await self._ready_extractor(name)
        browser = await get_or_create_browser()
        async with self._pages.lease(browser.context) as page:
            extractor = LinkedInExtractor(page)
            if name == "search_posts":
                result = await extractor.search_posts(
                    str(arguments["keywords"]),
                    max_pages=self._integer(arguments, "max_pages"),
                )
                return cast(dict[str, Any], result)
            if name == "get_feed":
                return await self._feed(
                    extractor, page, self._integer(arguments, "num_posts")
                )
            if name == "get_person_profile":
                result = await extractor.read_person(
                    str(arguments["linkedin_username"]), {"main_profile"}
                )
                return cast(dict[str, Any], result)
            if name == "get_company_profile":
                result = await extractor.read_company(str(arguments["company_name"]), {"about"})
                return cast(dict[str, Any], result)
            url = str(arguments["post_url"])
            return {"url": url, **asdict(await extractor.extract_page(url, "post", 5))}

    async def _ready_extractor(self, name: str) -> LinkedInExtractor:
        extractor = await get_ready_extractor(None, tool_name=f"social_{name}")
        browser = await get_or_create_browser()
        try:
            await browser.page.evaluate("() => true")
        except Exception:
            await self._pages.close()
            await close_browser()
            extractor = await get_ready_extractor(None, tool_name=f"social_{name}")
        return extractor

    @staticmethod
    async def _actions() -> LinkedInBrowserActions:
        browser = await get_or_create_browser()
        session = PageSession(browser.page)
        return LinkedInBrowserActions(session, PageNavigator(session))

    @staticmethod
    async def _feed(extractor: Any, page: Any, limit: int) -> dict[str, Any]:
        data = asdict(await extractor.extract_feed(limit))
        references = data.get("references", [])
        if not references:
            return data
        posts = page.locator("main [data-testid='mainFeed'] [role='listitem']").filter(
            has_text="Feed post"
        )
        texts = [await posts.nth(index).inner_text() for index in range(await posts.count())]
        for reference, text in zip(references, texts, strict=False):
            reference["text"] = text
        return data

    async def _confirm_created_post(self, text: str, fallback: dict[str, Any]) -> dict[str, Any]:
        browser = await get_or_create_browser()
        page = browser.page
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
        profile_url = await page.locator(
            "main [data-testid='mainFeed'] [role='listitem'] a[href*='/in/']"
        ).first.get_attribute("href")
        await page.goto(self._activity_url(profile_url), wait_until="domcontentloaded")
        item = page.locator("main [role='listitem']").filter(has_text=text).first
        try:
            await item.wait_for(state="visible", timeout=10_000)
            boost_url = await item.locator("a[href*='content=urn%3Ali%3A']").first.get_attribute(
                "href"
            )
            post_url = self._post_url(boost_url)
        except Exception:
            return fallback
        return {
            "status": "confirmed",
            "confirmed": True,
            "retry_safe": False,
            "url": post_url,
            "message": "Created post observed in the account activity",
        }

    @staticmethod
    def _post_url(boost_url: str | None) -> str:
        values = parse_qs(urlsplit(boost_url or "").query).get("content", [])
        if not values or not values[0].startswith("urn:li:"):
            raise ValueError("LinkedIn activity did not expose a stable post ID")
        return normalize_linkedin_url(f"/feed/update/{values[0]}/")

    @staticmethod
    def _activity_url(profile_url: str | None) -> str:
        profile = urlsplit(normalize_linkedin_url(profile_url or ""))
        if not profile.path.startswith("/in/"):
            raise ValueError("LinkedIn feed did not expose the signed-in profile")
        return f"https://www.linkedin.com{profile.path.rstrip('/')}/recent-activity/all/"

    @staticmethod
    def _optional(arguments: dict[str, object], key: str) -> str | None:
        value = arguments.get(key)
        return str(value) if value is not None else None

    @staticmethod
    def _integer(arguments: dict[str, object], key: str) -> int:
        value = arguments[key]
        if not isinstance(value, int):
            raise ValueError(f"{key} must be an integer")
        return value
