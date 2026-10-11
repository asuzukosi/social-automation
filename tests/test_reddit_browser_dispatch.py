"""Every declared Reddit write reaches one visible-browser operation."""

from unittest.mock import AsyncMock

import pytest

from social_automation.core.models import (
    ActionName,
    ActionRequest,
    Platform,
    ReactionName,
    RenderedAction,
)
from social_automation.platforms.reddit.browser_actions import RedditBrowserActions


@pytest.mark.parametrize(
    ("action_request", "method_name"),
    [
        (
            ActionRequest(
                platform=Platform.REDDIT,
                action=ActionName.CREATE_POST,
                account="primary",
                target="python",
                text="body",
                title="title",
            ),
            "_create_post",
        ),
        (
            ActionRequest(
                platform=Platform.REDDIT,
                action=ActionName.COMMENT,
                account="primary",
                target="https://www.reddit.com/comments/abc",
                text="hello",
            ),
            "_comment",
        ),
        (
            ActionRequest(
                platform=Platform.REDDIT,
                action=ActionName.REPLY,
                account="primary",
                target="https://www.reddit.com/r/python/comments/abc/title/def/",
                text="hello",
            ),
            "_reply",
        ),
        (
            ActionRequest(
                platform=Platform.REDDIT,
                action=ActionName.REACT,
                account="primary",
                target="https://www.reddit.com/comments/abc",
                reaction=ReactionName.UP,
            ),
            "_react",
        ),
        (
            ActionRequest(
                platform=Platform.REDDIT,
                action=ActionName.DELETE_POST,
                account="primary",
                target="https://www.reddit.com/comments/abc",
            ),
            "_delete",
        ),
        (
            ActionRequest(
                platform=Platform.REDDIT,
                action=ActionName.FOLLOW,
                account="primary",
                target="python",
            ),
            "_follow",
        ),
    ],
)
async def test_reddit_browser_dispatches_supported_write(
    monkeypatch,
    action_request: ActionRequest,
    method_name: str,
) -> None:
    actions = RedditBrowserActions()
    page = object()
    selected = AsyncMock(return_value={"status": "outcome_unknown"})
    monkeypatch.setattr(actions, method_name, selected)
    action = RenderedAction(request=action_request, rendered_text=action_request.text)

    result = await actions.execute(page, action)

    assert result["status"] == "outcome_unknown"
    selected.assert_awaited_once_with(page, action)


async def test_reddit_post_controls_are_scoped_to_exact_native_id(monkeypatch) -> None:
    actions = RedditBrowserActions()
    expected = object()
    visible = AsyncMock(return_value=expected)
    monkeypatch.setattr(actions, "_visible", visible)
    page = object()

    result = await actions._post(page, "https://www.reddit.com/r/python/comments/abc/title/")

    assert result is expected
    selectors = visible.await_args.args[1]
    assert "shreddit-post[id='t3_abc']" in selectors
    assert "[data-fullname='t3_abc']" in selectors
