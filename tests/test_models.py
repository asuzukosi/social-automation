import pytest

from social_automation.core.models import ActionName, ActionRequest, DraftVariant, Platform
from social_automation.service import SocialService


def test_draft_reddit_title_has_a_shared_length_limit(service: SocialService) -> None:
    with pytest.raises(ValueError, match="at most 300 characters"):
        service.create_draft(
            "hello",
            [Platform.REDDIT],
            "primary",
            {"reddit": "r/automation"},
            {},
            {"reddit": "x" * 301},
        )


def test_direct_action_text_has_a_shared_length_limit() -> None:
    with pytest.raises(ValueError, match="at most 25000 characters"):
        ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.COMMENT,
            account="primary",
            target="https://www.reddit.com/comments/example",
            text="x" * 25_001,
        )


def test_draft_rejects_fields_that_the_platform_would_ignore() -> None:
    with pytest.raises(ValueError, match="Only Reddit"):
        DraftVariant(platform=Platform.X, account="primary", text="hello", target="elsewhere")


def test_action_rejects_fields_that_the_operation_would_ignore() -> None:
    with pytest.raises(ValueError, match="does not accept text"):
        ActionRequest(
            platform=Platform.REDDIT,
            action=ActionName.REACT,
            account="primary",
            target="123",
            text="ignored",
            reaction="up",
        )


def test_optional_action_text_cannot_be_blank() -> None:
    with pytest.raises(ValueError, match="cannot be blank"):
        ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.CONNECT,
            account="primary",
            target="reader",
            text="   ",
        )
