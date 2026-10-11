"""Write-gate persistence tests."""

import stat
from pathlib import Path

import pytest

from social_automation.core.models import (
    ActionName,
    ActionRequest,
    ActionResult,
    Platform,
    RenderedAction,
)
from social_automation.storage import ActionStore


def test_state_database_is_private_to_current_user(tmp_path: Path) -> None:
    path = tmp_path / "private" / "state.db"

    ActionStore(path)

    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700


def action() -> RenderedAction:
    """Return one exact rendered action."""
    return RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.CREATE_POST,
            account="primary",
            text="hello",
        ),
        rendered_text="hello",
    )


def test_preview_does_not_create_execution_event(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    assert preview.action.rendered_text == "hello"
    assert [event["event"] for event in store.list_actions()] == ["previewed"]


def test_changed_hash_is_rejected(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    with pytest.raises(ValueError, match="changed"):
        store.consume_preview(
            preview.operation_id,
            preview.preview_token,
            "different",
            "unique-key",
        )


def test_invalid_preview_token_is_rejected(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    with pytest.raises(ValueError, match="Invalid preview token"):
        store.consume_preview(
            preview.operation_id,
            "wrong-token",
            preview.input_hash,
            "unique-key",
        )


def test_expired_preview_is_rejected(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action(), ttl_seconds=-1)

    with pytest.raises(ValueError, match="Preview has expired"):
        store.consume_preview(
            preview.operation_id,
            preview.preview_token,
            preview.input_hash,
            "unique-key",
        )


def test_consumed_preview_is_audited_before_external_execution(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    store.consume_preview(
        preview.operation_id,
        preview.preview_token,
        preview.input_hash,
        "unique-key",
    )

    assert [event["event"] for event in store.get_action(preview.operation_id)] == [
        "previewed",
        "execution_started",
    ]


def test_confirmation_replay_returns_recorded_result(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())
    rendered = store.consume_preview(
        preview.operation_id,
        preview.preview_token,
        preview.input_hash,
        "unique-key",
    )
    assert isinstance(rendered, RenderedAction)
    result = ActionResult(
        operation_id=preview.operation_id,
        platform=Platform.X,
        action=ActionName.CREATE_POST,
        status="confirmed",
        confirmed=True,
        retry_safe=False,
        native_id="123",
    )
    store.record_result("unique-key", result)

    replay = store.consume_preview(
        preview.operation_id,
        preview.preview_token,
        preview.input_hash,
        "unique-key",
    )

    assert replay == result


def test_idempotency_key_cannot_cross_operations(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    first = store.create_preview(action())
    store.consume_preview(first.operation_id, first.preview_token, first.input_hash, "shared-key")
    store.record_result(
        "shared-key",
        ActionResult(
            operation_id=first.operation_id,
            platform=Platform.X,
            action=ActionName.CREATE_POST,
            status="confirmed",
            confirmed=True,
            retry_safe=False,
        ),
    )
    second = store.create_preview(action())

    with pytest.raises(ValueError, match="another operation"):
        store.consume_preview(
            second.operation_id,
            second.preview_token,
            second.input_hash,
            "shared-key",
        )
