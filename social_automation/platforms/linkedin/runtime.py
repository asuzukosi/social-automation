"""Direct Python integration with the imported LinkedIn browser runtime."""

import asyncio
import sys
from dataclasses import asdict
from typing import Any, cast

from linkedin_mcp_server.authentication import clear_auth_state, get_authentication_source
from linkedin_mcp_server.dependencies import get_ready_extractor
from linkedin_mcp_server.drivers.browser import close_browser, get_or_create_browser
from linkedin_mcp_server.exceptions import CredentialsNotFoundError
from linkedin_mcp_server.linkedin.navigation import PageNavigator
from linkedin_mcp_server.linkedin.session import PageSession

from social_automation.platforms.linkedin.browser_actions import LinkedInBrowserActions


class LinkedInRuntime:
    """Serialize LinkedIn operations in the shared Python process."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()

    async def status(self) -> dict[str, object]:
        """Report whether a LinkedIn browser profile has been configured."""
        try:
            get_authentication_source()
        except Exception:
            return {"available": True, "authenticated": False}
        return {"available": True, "authenticated": True}

    async def close(self) -> None:
        async with self._lock:
            await close_browser()

    async def authenticate(self, force: bool = False) -> dict[str, object]:
        """Run LinkedIn's supported interactive profile login."""
        async with self._lock:
            if not force:
                try:
                    get_authentication_source()
                    return {"platform": "linkedin", "authenticated": True}
                except CredentialsNotFoundError:
                    pass
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
        async with self._lock:
            await close_browser()
            await asyncio.to_thread(clear_auth_state)
        return {"platform": "linkedin", "authenticated": False}

    async def call(self, name: str, arguments: dict[str, object]) -> dict[str, Any]:
        async with self._lock:
            extractor = await get_ready_extractor(None, tool_name=f"social_{name}")
            if name == "search_posts":
                result = await extractor.search_posts(
                    str(arguments["keywords"]),
                    max_pages=self._integer(arguments, "max_pages"),
                )
                return cast(dict[str, Any], result)
            if name == "get_feed":
                return asdict(await extractor.extract_feed(self._integer(arguments, "num_posts")))
            if name == "get_person_profile":
                result = await extractor.read_person(
                    str(arguments["linkedin_username"]), {"main_profile"}
                )
                return cast(dict[str, Any], result)
            if name == "get_company_profile":
                result = await extractor.read_company(str(arguments["company_name"]), {"about"})
                return cast(dict[str, Any], result)
            if name == "read_post":
                url = str(arguments["post_url"])
                return {"url": url, **asdict(await extractor.extract_page(url, "post", 5))}
            if name == "connect_with_person":
                result = await extractor.connect_with_person(
                    str(arguments["linkedin_username"]), note=self._optional(arguments, "note")
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
                return await actions.create_post(str(arguments["text"]))
            if name == "comment_on_post":
                return await actions.comment(str(arguments["post_url"]), str(arguments["text"]))
            if name == "react_to_post":
                return await actions.react(str(arguments["post_url"]))
            raise ValueError(f"Unknown LinkedIn operation: {name}")

    @staticmethod
    async def _actions() -> LinkedInBrowserActions:
        browser = await get_or_create_browser()
        session = PageSession(browser.page)
        return LinkedInBrowserActions(session, PageNavigator(session))

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
