from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import quote

from patchright.async_api import Locator, Page
from patchright.async_api import TimeoutError as PlaywrightTimeoutError

from social_automation.core.models import ActionName, RenderedAction
from social_automation.platforms.reddit.urls import (
    normalize_comment_url,
    normalize_post_id,
    stop_if_account_attention_required,
    validate_reddit_url,
)


class RedditBrowserActions:
    async def execute(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        name = action.request.action
        if name is ActionName.CREATE_POST:
            return await self._create_post(page, action)
        if name is ActionName.COMMENT:
            return await self._comment(page, action)
        if name is ActionName.REPLY:
            return await self._reply(page, action)
        if name is ActionName.REACT:
            return await self._react(page, action)
        if name is ActionName.DELETE_POST:
            return await self._delete(page, action)
        if name is ActionName.FOLLOW:
            return await self._follow(page, action)
        raise ValueError(f"Unsupported Reddit action: {name.value}")

    async def _create_post(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        subreddit = str(action.request.target).removeprefix("r/").strip("/")
        await self._navigate(page, f"https://www.reddit.com/r/{quote(subreddit)}/submit?type=TEXT")
        title = await self._visible(
            page, ["textarea[name='title']", "textarea[placeholder*='title' i]"]
        )
        await title.fill(str(action.request.title))
        body = await self._visible(
            page,
            [
                "div[contenteditable='true'][role='textbox']",
                "textarea[name='body']",
                "textarea[placeholder*='body' i]",
            ],
        )
        await body.fill(action.rendered_text or "")
        await (await self._button(page, "Post")).click()
        try:
            await page.wait_for_url(re.compile(r"/comments/"), timeout=12_000)
        except Exception:
            return self._unknown("Post submission was attempted but could not be verified")
        return self._confirmed(page.url, "Reddit opened the created post")

    async def _comment(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        await self._navigate(page, str(action.request.target))
        editor = await self._visible(
            page,
            [
                "textarea[placeholder*='comment' i]",
                "div[contenteditable='true'][role='textbox']",
                "textarea[name='comment']",
            ],
        )
        await editor.fill(action.rendered_text or "")
        await (await self._button(page, "Comment")).click()
        return self._unknown("Comment submission was attempted without a stable response ID")

    async def _reply(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        target, comment_id = normalize_comment_url(str(action.request.target))
        await self._navigate(page, target)
        comment = await self._visible(
            page,
            [
                f"shreddit-comment[thingid='t1_{comment_id}']",
                f"[data-fullname='t1_{comment_id}']",
                f"#t1_{comment_id}",
            ],
        )
        await (await self._button(comment, "Reply")).click()
        editor = await self._visible(
            comment,
            [
                "textarea[placeholder*='reply' i]",
                "textarea[placeholder*='comment' i]",
                "div[contenteditable='true'][role='textbox']",
            ],
        )
        await editor.fill(action.rendered_text or "")
        await (await self._button(comment, "Reply")).click()
        stop_if_account_attention_required(page.url)
        return self._unknown("Reply submission was attempted without a stable response ID")

    async def _react(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        await self._navigate(page, str(action.request.target))
        post = await self._post(page, str(action.request.target))
        reaction = action.request.reaction or "up"
        if reaction == "remove":
            selected = post.locator("button[aria-pressed='true'][aria-label*='vote' i]").first
            if await selected.count() == 0:
                return self._confirmed(page.url, "No vote was present")
            await selected.click()
            if await self._attribute_becomes(selected, "aria-pressed", "false"):
                return self._confirmed(page.url, "Vote removal was observed")
            return self._unknown("Vote removal was clicked but could not be verified")
        label = "downvote" if reaction == "down" else "upvote"
        button = await self._visible(
            post,
            [f"button[aria-label*='{label}' i]", f"button[data-click-id='{label}']"],
        )
        if await button.get_attribute("aria-pressed") == "true":
            return self._confirmed(page.url, f"{label} was already present")
        await button.click()
        if await self._attribute_becomes(button, "aria-pressed", "true"):
            return self._confirmed(page.url, f"{label} was observed")
        return self._unknown(f"{label} was clicked but could not be verified")

    async def _delete(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        await self._navigate(page, str(action.request.target))
        post = await self._post(page, str(action.request.target))
        await (await self._button(post, "More options")).click()
        await (await self._button(page, "Delete")).click()
        await (await self._button(page, "Delete")).click()
        return self._unknown("Delete was submitted but final removal could not be verified")

    async def _post(self, page: Page, target: str) -> Locator:
        post_id = normalize_post_id(target)
        fullname = f"t3_{post_id}"
        return await self._visible(
            page,
            [
                f"shreddit-post[id='{fullname}']",
                f"shreddit-post[thingid='{fullname}']",
                f"[data-fullname='{fullname}']",
                f"[data-post-id='{post_id}']",
            ],
        )

    async def _follow(self, page: Page, action: RenderedAction) -> dict[str, Any]:
        subreddit = str(action.request.target).removeprefix("r/").strip("/")
        await self._navigate(page, f"https://www.reddit.com/r/{quote(subreddit)}")
        joined = page.get_by_role("button", name=re.compile(r"^Joined$", re.I)).first
        if await joined.count() > 0:
            return self._confirmed(page.url, "Subreddit was already joined")
        await (await self._button(page, "Join")).click()
        return self._unknown("Join was clicked but could not be verified reliably")

    @staticmethod
    async def _navigate(page: Page, url: str) -> None:
        validate_reddit_url(url)
        await page.goto(url, wait_until="domcontentloaded")
        validate_reddit_url(page.url)
        stop_if_account_attention_required(page.url)

    @staticmethod
    async def _visible(page: Page | Locator, selectors: list[str]) -> Locator:
        for selector in selectors:
            locator = page.locator(selector).first
            try:
                await locator.wait_for(state="visible", timeout=2_500)
                return locator
            except PlaywrightTimeoutError:
                continue
        raise RuntimeError("Reddit's expected control was not visible")

    @staticmethod
    async def _button(page: Page | Locator, name: str) -> Locator:
        button = page.get_by_role("button", name=re.compile(rf"^{re.escape(name)}$", re.I)).first
        await button.wait_for(state="visible", timeout=8_000)
        return button

    @staticmethod
    async def _attribute_becomes(
        locator: Locator, name: str, expected: str, attempts: int = 10
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
    def _confirmed(url: str, message: str) -> dict[str, Any]:
        return {
            "status": "confirmed",
            "confirmed": True,
            "retry_safe": False,
            "url": url,
            "message": message,
        }
