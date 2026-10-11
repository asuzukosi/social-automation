"""Durable state for previewed social writes."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from social_automation.core.models import ActionPreview, ActionResult, RenderedAction


class ActionStore:
    """Store each write from preview through completion."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._initialize()
        self._path.chmod(0o600)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS actions (
                    operation_id TEXT PRIMARY KEY,
                    token_hash TEXT,
                    expires_at TEXT,
                    action_json TEXT,
                    status TEXT NOT NULL,
                    result_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                DROP TABLE IF EXISTS drafts;
                DROP TABLE IF EXISTS previews;
                DROP TABLE IF EXISTS idempotency;
                DROP TABLE IF EXISTS audit;
                """
            )

    def create_preview(self, action: RenderedAction, ttl_seconds: int = 600) -> ActionPreview:
        """Store the exact action until it is confirmed or expires."""
        operation_id = secrets.token_urlsafe(18)
        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=ttl_seconds)
        with self._connect() as db:
            db.execute(
                "INSERT INTO actions (operation_id, token_hash, expires_at, action_json, status, "
                "result_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'previewed', NULL, ?, ?)",
                (
                    operation_id,
                    self._token_hash(token),
                    expires_at.isoformat(),
                    action.model_dump_json(),
                    now.isoformat(),
                    now.isoformat(),
                ),
            )
        return ActionPreview(
            operation_id=operation_id,
            preview_token=token,
            expires_at=expires_at,
            action=action,
        )

    def consume_preview(self, operation_id: str, token: str) -> RenderedAction | ActionResult:
        """Claim one preview or return the result of an earlier claim."""
        with self._connect() as db:
            row = self._row(db, operation_id)
            if row["status"] in {"in_progress", "completed"}:
                return ActionResult.model_validate_json(row["result_json"])
            if row["status"] != "previewed":
                raise ValueError("Action is no longer confirmable")
            self._validate_preview(row, token)
            action = RenderedAction.model_validate_json(row["action_json"])
            pending = ActionResult(
                operation_id=operation_id,
                platform=action.request.platform,
                action=action.request.action,
                status="in_progress",
                confirmed=False,
                retry_safe=False,
                detail="Execution started; query this operation for the final result",
            )
            updated = db.execute(
                "UPDATE actions SET status = 'in_progress', result_json = ?, updated_at = ?, "
                "token_hash = NULL, expires_at = NULL, action_json = NULL "
                "WHERE operation_id = ? AND status = 'previewed'",
                (pending.model_dump_json(), datetime.now(UTC).isoformat(), operation_id),
            )
            if updated.rowcount != 1:
                return ActionResult.model_validate_json(self._row(db, operation_id)["result_json"])
        return action

    def record_result(self, result: ActionResult) -> None:
        """Store the observed outcome before returning it to the caller."""
        with self._connect() as db:
            updated = db.execute(
                "UPDATE actions SET status = 'completed', result_json = ?, updated_at = ? "
                "WHERE operation_id = ? AND status = 'in_progress'",
                (
                    result.model_dump_json(),
                    datetime.now(UTC).isoformat(),
                    result.operation_id,
                ),
            )
            if updated.rowcount != 1:
                raise ValueError("Operation is not awaiting a result")

    def list_actions(self, limit: int = 50) -> list[dict[str, object]]:
        """Return recent operations without confirmation secrets."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM actions ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._public_action(row) for row in rows]

    def get_action(self, operation_id: str) -> dict[str, object]:
        """Return one operation without its confirmation secret."""
        with self._connect() as db:
            return self._public_action(self._row(db, operation_id))

    def cancel_action(self, operation_id: str) -> dict[str, object]:
        """Cancel a preview that has not started executing."""
        now = datetime.now(UTC).isoformat()
        with self._connect() as db:
            updated = db.execute(
                "UPDATE actions SET status = 'cancelled', updated_at = ?, token_hash = NULL, "
                "expires_at = NULL, action_json = NULL "
                "WHERE operation_id = ? AND status = 'previewed'",
                (now, operation_id),
            )
            if updated.rowcount != 1:
                row = self._row(db, operation_id)
                raise ValueError(f"Action is already {row['status']}")
        return {"operation_id": operation_id, "status": "cancelled"}

    @staticmethod
    def _row(db: sqlite3.Connection, operation_id: str) -> sqlite3.Row:
        row: sqlite3.Row | None = db.execute(
            "SELECT * FROM actions WHERE operation_id = ?", (operation_id,)
        ).fetchone()
        if row is None:
            raise ValueError("Unknown operation ID")
        return row

    @classmethod
    def _validate_preview(cls, row: sqlite3.Row, token: str) -> None:
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(UTC):
            raise ValueError("Preview has expired")
        if not secrets.compare_digest(row["token_hash"], cls._token_hash(token)):
            raise ValueError("Invalid preview token")

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def _public_action(row: sqlite3.Row) -> dict[str, object]:
        result = json.loads(row["result_json"]) if row["result_json"] else None
        action = json.loads(row["action_json"]) if row["action_json"] else None
        return {
            "operation_id": row["operation_id"],
            "status": row["status"],
            "action": action,
            "result": result,
            "expires_at": row["expires_at"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
