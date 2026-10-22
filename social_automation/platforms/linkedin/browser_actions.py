"""Conservative LinkedIn writes through the imported visible browser."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import linkedin_mcp_server.linkedin.connection as connection
from linkedin_mcp_server.core.destination import linkedin_element
from linkedin_mcp_server.core.exceptions import OffLinkedInLandingError
from linkedin_mcp_server.linkedin.identifiers import (
    normalize_person_identifier,
    person_profile_url,
)
from linkedin_mcp_server.linkedin.navigation import PageNavigator
from linkedin_mcp_server.linkedin.session import PageSession

from social_automation.platforms.linkedin.urls import validate_post_url


class LinkedInBrowserActions:
    """Perform writes and report only outcomes visible in the page."""

    def __init__(self, session: PageSession, navigator: PageNavigator):
        self._session = session
        self._navigator = navigator

    async def create_post(self, text: str) -> dict[str, Any]:
        content = self._validate_text(text)
        await self._navigator._navigate_to_page("https://www.linkedin.com/preload/sharebox/")
        async with self._element(
            "[role='dialog'] [contenteditable='true'][role='textbox']"
            "[aria-label='Text editor for creating content']"
        ) as editor:
            await editor.fill(content)
        async with self._role("button", "Post") as button:
            await button.click()
        return self._submitted("LinkedIn accepted the post for submission")

    async def delete(self, post_url: str) -> dict[str, Any]:
        validate_post_url(post_url)
        await self._navigator._navigate_to_page(post_url)
        await self._click("button[aria-label^='Open control menu for post by']")
        async with self._role("menuitem", "Delete post") as item:
            await item.click()
        async with self._role("button", "Delete") as button:
            await button.click()
        try:
            await self._session.page.get_by_role("dialog").wait_for(state="hidden", timeout=8000)
        except Exception:
            return self._unknown("Delete was submitted but could not be verified")
        return self._confirmed(post_url, "LinkedIn removed the post")

    async def comment(self, post_url: str, text: str) -> dict[str, Any]:
        validate_post_url(post_url)
        content = self._validate_text(text)
        await self._navigator._navigate_to_page(post_url)
        await self._click("article button[data-view-name='comment-action']")
        async with self._element(
            "article [data-view-name='comment-box'] [contenteditable='true'][role='textbox'], "
            "article form [contenteditable='true'][role='textbox']"
        ) as editor:
            await editor.fill(content)
        return await self._submit(
            "article button[data-view-name='comment-submit'], article form button[type='submit']",
            "article form",
        )

    async def react(self, post_url: str) -> dict[str, Any]:
        validate_post_url(post_url)
        await self._navigator._navigate_to_page(post_url)
        async with self._element("article button[data-view-name='react-button']") as button:
            if await button.get_attribute("aria-pressed") == "true":
                return self._confirmed(post_url, "Reaction was already present")
            await button.click()
            if not await self._attribute_becomes(button, "aria-pressed", "true"):
                return self._unknown("Reaction click was submitted but could not be verified")
        return self._confirmed(post_url, "Reaction observed on the post")

    async def connect_from_more(
        self,
        extractor: Any,
        username: str,
        note: str | None,
        fallback: dict[str, Any],
    ) -> dict[str, Any]:
        username = normalize_person_identifier(username)
        workflow = extractor._connection
        if not await self._open_more_connect(workflow, username):
            return fallback

        submitted, note_sent, limit_message = await workflow._submit_invite_dialog(note)
        if limit_message is not None:
            return {
                **fallback,
                "status": "custom_note_limit_reached",
                "message": limit_message,
                "note_sent": False,
            }
        if not submitted:
            return fallback

        await workflow._read_main_profile(username)
        signals = await workflow._read_action_signals(username)
        state = connection.detect_connection_state(signals)
        if state in {"pending", "already_connected"}:
            return {
                **fallback,
                "status": "connected",
                "message": f"Connection request sent. State after send: {state}.",
                "note_sent": note_sent,
            }
        return self._unknown(
            "Submitted the invite dialog, but the updated connection state could not be verified"
        )

    async def _open_more_connect(self, workflow: Any, username: str) -> bool:
        await self._navigator._navigate_to_page(person_profile_url(username, "/"))
        try:
            if not await workflow._open_more_menu():
                return False
            return await self._click_visible_connect()
        except OffLinkedInLandingError:
            raise
        except Exception:
            return False

    async def _click_visible_connect(self) -> bool:
        for role in ("menuitem", "button", "link"):
            locator = self._session.page.get_by_role(role, name="Connect", exact=True)
            for index in range(await locator.count()):
                candidate = locator.nth(index)
                if await candidate.is_visible():
                    async with linkedin_element(candidate, timeout=8000) as connect:
                        await connect.click()
                    return True
        return False

    async def _submit(self, selector: str, closed_selector: str) -> dict[str, Any]:
        async with self._element(selector) as button:
            await button.click()
        try:
            await self._session.page.locator(closed_selector).first.wait_for(
                state="hidden", timeout=8000
            )
        except Exception:
            return self._unknown("Submission attempted; the final server outcome is unknown")
        return self._unknown("Submission accepted without a stable server identifier")

    async def _click(self, selector: str) -> None:
        async with self._element(selector) as target:
            await target.click()

    @asynccontextmanager
    async def _element(self, selector: str) -> AsyncIterator[Any]:
        locator = self._session.page.locator(selector).first
        async with linkedin_element(locator, timeout=8000) as element:
            yield element

    @asynccontextmanager
    async def _role(self, role: str, name: str) -> AsyncIterator[Any]:
        locator = self._session.page.get_by_role(role, name=name, exact=True).first
        async with linkedin_element(locator, timeout=8000) as element:
            yield element

    @staticmethod
    def _validate_text(text: str) -> str:
        content = text.strip()
        if not content:
            raise ValueError("LinkedIn text cannot be empty")
        return content

    @staticmethod
    async def _attribute_becomes(
        locator: Any, name: str, expected: str, attempts: int = 10
    ) -> bool:
        for _ in range(attempts):
            if await locator.get_attribute(name) == expected:
                return True
            await asyncio.sleep(0.25)
        return False

    @staticmethod
    def _unknown(message: str) -> dict[str, Any]:
        return {
            "status": "outcome_unknown",
            "confirmed": False,
            "retry_safe": False,
            "message": message,
        }

    @staticmethod
    def _submitted(message: str) -> dict[str, Any]:
        return {
            "status": "submitted",
            "confirmed": False,
            "retry_safe": False,
            "message": message,
        }

    @staticmethod
    def _confirmed(url: str, message: str) -> dict[str, Any]:
        return {
            "status": "confirmed",
            "confirmed": True,
            "retry_safe": False,
            "url": url,
            "message": message,
        }
