from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from social_automation.core.models import ActionName, ActionRequest, Platform, RenderedAction
from social_automation.platforms.reddit.browser import RedditBrowser
from social_automation.platforms.reddit.browser_actions import RedditBrowserActions


def browser_with_response(tmp_path: Path, response: object) -> RedditBrowser:
    browser = RedditBrowser(tmp_path / "profile")
    request = SimpleNamespace(get=AsyncMock(return_value=response))
    browser._start = AsyncMock(return_value=SimpleNamespace(request=request))
    return browser


async def test_reddit_browser_json_refuses_cross_origin_redirect(tmp_path: Path) -> None:
    response = SimpleNamespace(
        url="https://evil.example/login",
        ok=True,
        status=200,
        headers={"content-type": "application/json"},
    )
    browser = browser_with_response(tmp_path, response)

    with pytest.raises(ValueError, match="HTTPS Reddit URL"):
        await browser.request_json("https://www.reddit.com/user/reader/about.json")


async def test_reddit_browser_json_refuses_html_response(tmp_path: Path) -> None:
    response = SimpleNamespace(
        url="https://www.reddit.com/r/python/",
        ok=True,
        status=200,
        headers={"content-type": "text/html"},
    )
    browser = browser_with_response(tmp_path, response)

    with pytest.raises(RuntimeError, match="did not return JSON"):
        await browser.request_json("https://www.reddit.com/user/reader/about.json")


async def test_reddit_browser_json_stops_on_account_attention_redirect(tmp_path: Path) -> None:
    response = SimpleNamespace(
        url="https://www.reddit.com/verify/email",
        ok=True,
        status=200,
        headers={"content-type": "application/json"},
    )
    browser = browser_with_response(tmp_path, response)

    with pytest.raises(RuntimeError, match="manual account attention"):
        await browser.request_json("https://www.reddit.com/user/reader/about.json")


async def test_reddit_browser_confirms_only_observed_attribute_change(monkeypatch) -> None:
    locator = SimpleNamespace(get_attribute=AsyncMock(side_effect=["false", "true"]))
    monkeypatch.setattr("social_automation.platforms.reddit.browser.asyncio.sleep", AsyncMock())

    observed = await RedditBrowserActions._attribute_becomes(locator, "aria-pressed", "true")

    assert observed is True


async def test_reddit_browser_leaves_unobserved_click_uncertain(monkeypatch) -> None:
    locator = SimpleNamespace(get_attribute=AsyncMock(return_value="false"))
    monkeypatch.setattr("social_automation.platforms.reddit.browser.asyncio.sleep", AsyncMock())

    observed = await RedditBrowserActions._attribute_becomes(
        locator, "aria-pressed", "true", attempts=2
    )

    assert observed is False


async def test_reddit_browser_closes_context_and_driver(tmp_path: Path) -> None:
    browser = RedditBrowser(tmp_path / "profile")
    browser._context = SimpleNamespace(close=AsyncMock())
    browser._playwright = SimpleNamespace(stop=AsyncMock())

    await browser.close()

    assert browser._context is None
    assert browser._playwright is None


async def test_reddit_reply_scopes_editor_to_exact_comment(tmp_path: Path) -> None:
    target = "https://www.reddit.com/r/python/comments/abc/title/def/"
    page = SimpleNamespace(url=target)
    comment = object()
    editor = SimpleNamespace(fill=AsyncMock())
    open_reply = SimpleNamespace(click=AsyncMock())
    submit = SimpleNamespace(click=AsyncMock())
    actions = RedditBrowserActions()
    actions._navigate = AsyncMock()
    actions._visible = AsyncMock(side_effect=[comment, editor])
    actions._button = AsyncMock(side_effect=[open_reply, submit])
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.REPLY,
            account="primary",
            target=target,
            text="nested reply",
        ),
        rendered_text="nested reply",
    )

    result = await actions._reply(page, action)

    first_root, selectors = actions._visible.await_args_list[0].args
    assert first_root is page
    assert all("t1_def" in selector for selector in selectors)
    assert actions._visible.await_args_list[1].args[0] is comment
    assert actions._button.await_args_list[0].args == (comment, "Reply")
    assert actions._button.await_args_list[1].args == (comment, "Reply")
    editor.fill.assert_awaited_once_with("nested reply")
    assert result["status"] == "outcome_unknown"
    assert result["retry_safe"] is False


async def test_reddit_create_post_selects_the_named_visible_body() -> None:
    page = SimpleNamespace(url="https://www.reddit.com/r/test/submit?type=TEXT")
    title = SimpleNamespace(fill=AsyncMock())
    body = SimpleNamespace(fill=AsyncMock())
    submit = SimpleNamespace(click=AsyncMock())
    actions = RedditBrowserActions()
    actions._navigate = AsyncMock()
    actions._visible = AsyncMock(side_effect=[title, body])
    actions._button = AsyncMock(return_value=submit)
    page.wait_for_url = AsyncMock()
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.CREATE_POST,
            account="primary",
            target="r/test",
            title="Connection test",
            text="hello",
        ),
        rendered_text="hello",
    )

    await actions._create_post(page, action)

    body_selectors = actions._visible.await_args_list[1].args[1]
    assert body_selectors[0] == "[contenteditable='true'][role='textbox'][name='body']"


async def test_reddit_delete_uses_current_user_actions_menu() -> None:
    page = SimpleNamespace(url="https://www.reddit.com/r/test/comments/abc/title/")
    post = object()
    open_menu = SimpleNamespace(click=AsyncMock())
    delete_item = SimpleNamespace(click=AsyncMock())
    confirm = SimpleNamespace(click=AsyncMock())
    actions = RedditBrowserActions()
    actions._navigate = AsyncMock()
    actions._post = AsyncMock(return_value=post)
    actions._visible = AsyncMock(return_value=open_menu)
    actions._menuitem = AsyncMock(return_value=delete_item)
    actions._button = AsyncMock(return_value=confirm)
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.DELETE_POST,
            account="primary",
            target=page.url,
        )
    )

    await actions._delete(page, action)

    actions._visible.assert_awaited_once_with(post, ["button[aria-label='Open user actions']"])
    actions._menuitem.assert_awaited_once_with(page, "Delete")
    actions._button.assert_awaited_once_with(page, "Yes, Delete")
