"""Write-state persistence tests."""

import sqlite3
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


def action() -> RenderedAction:
    return RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.CREATE_POST,
            account="primary",
            text="hello",
        ),
        rendered_text="hello",
    )


def test_database_is_private_and_contains_one_table(tmp_path: Path) -> None:
    path = tmp_path / "private" / "state.db"

    ActionStore(path)

    with sqlite3.connect(path) as db:
        tables = {
            row[0]
            for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
        }
    assert tables == {"actions"}
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700


def test_preview_stores_one_safe_operation(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    stored = store.get_action(preview.operation_id)

    assert stored["status"] == "previewed"
    assert stored["action"]["rendered_text"] == "hello"
    assert "preview_token" not in stored


def test_invalid_or_expired_preview_is_rejected(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    with pytest.raises(ValueError, match="Invalid preview token"):
        store.consume_preview(preview.operation_id, "wrong-token")

    expired = store.create_preview(action(), ttl_seconds=-1)
    with pytest.raises(ValueError, match="Preview has expired"):
        store.consume_preview(expired.operation_id, expired.preview_token)


def test_confirmation_replay_returns_recorded_result(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())
    rendered = store.consume_preview(preview.operation_id, preview.preview_token)
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
    store.record_result(result)

    replay = store.consume_preview(preview.operation_id, preview.preview_token)

    assert replay == result
    with sqlite3.connect(tmp_path / "state.db") as db:
        retained = db.execute(
            "SELECT token_hash, action_json FROM actions WHERE operation_id = ?",
            (preview.operation_id,),
        ).fetchone()
    stored = store.get_action(preview.operation_id)
    assert retained == (None, None)
    assert stored["action"] is None
    assert stored["expires_at"] is None
    assert stored["result"]["native_id"] == "123"


def test_cancelled_preview_cannot_be_consumed(tmp_path: Path) -> None:
    store = ActionStore(tmp_path / "state.db")
    preview = store.create_preview(action())

    store.cancel_action(preview.operation_id)

    assert store.get_action(preview.operation_id)["action"] is None
    with pytest.raises(ValueError, match="no longer confirmable"):
        store.consume_preview(preview.operation_id, preview.preview_token)
