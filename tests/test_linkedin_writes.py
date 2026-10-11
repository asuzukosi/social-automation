"""LinkedIn write results preserve conservative confirmation semantics."""

from unittest.mock import AsyncMock

import pytest

from social_automation.core.models import (
    ActionName,
    ActionRequest,
    Platform,
    ReactionName,
    RenderedAction,
)
from social_automation.platforms.linkedin.adapter import LinkedInAdapter


@pytest.mark.parametrize(
    ("action_request", "response", "method", "arguments", "confirmed"),
    [
        (
            ActionRequest(
                platform=Platform.LINKEDIN,
                action=ActionName.COMMENT,
                account="primary",
                target="https://www.linkedin.com/posts/example",
                text="hello",
            ),
            {"status": "outcome_unknown", "message": "submitted"},
            "comment_on_post",
            {"post_url": "https://www.linkedin.com/posts/example", "text": "hello"},
            False,
        ),
        (
            ActionRequest(
                platform=Platform.LINKEDIN,
                action=ActionName.REACT,
                account="primary",
                target="https://www.linkedin.com/posts/example",
                reaction=ReactionName.LIKE,
            ),
            {"status": "confirmed", "confirmed": True},
            "react_to_post",
            {"post_url": "https://www.linkedin.com/posts/example"},
            True,
        ),
        (
            ActionRequest(
                platform=Platform.LINKEDIN,
                action=ActionName.DELETE_POST,
                account="primary",
                target="https://www.linkedin.com/posts/example",
            ),
            {"status": "confirmed", "confirmed": True},
            "delete_post",
            {"post_url": "https://www.linkedin.com/posts/example"},
            True,
        ),
        (
            ActionRequest(
                platform=Platform.LINKEDIN,
                action=ActionName.CONNECT,
                account="primary",
                target="reader",
                text="hello",
            ),
            {"status": "connected", "url": "https://www.linkedin.com/in/reader/"},
            "connect_with_person",
            {"linkedin_username": "reader", "note": "hello"},
            True,
        ),
        (
            ActionRequest(
                platform=Platform.LINKEDIN,
                action=ActionName.SEND_MESSAGE,
                account="primary",
                target="reader",
                text="hello",
            ),
            {"status": "sent", "sent": True},
            "send_message",
            {"linkedin_username": "reader", "message": "hello", "confirm_send": True},
            True,
        ),
    ],
)
async def test_linkedin_write_result_and_runtime_route(
    action_request: ActionRequest,
    response: dict[str, object],
    method: str,
    arguments: dict[str, object],
    confirmed: bool,
) -> None:
    adapter = LinkedInAdapter()
    adapter._call = AsyncMock(return_value=response)
    action = RenderedAction(request=action_request, rendered_text=action_request.text)

    result = await adapter.execute_action(action, "idempotency-key")

    adapter._call.assert_awaited_once_with(method, arguments)
    assert result.confirmed is confirmed
    assert result.retry_safe is False
