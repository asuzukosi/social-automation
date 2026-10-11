"""Persistent previews, idempotency records, and action audit events."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from social_automation.core.models import (
    ActionPreview,
    ActionResult,
    Draft,
    DraftVariant,
    RenderedAction,
)


class ActionStore:
    """Store the write gate's durable state in one SQLite database."""

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
                CREATE TABLE IF NOT EXISTS previews (
                    operation_id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    action_json TEXT NOT NULL,
                    consumed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                    key TEXT PRIMARY KEY,
                    operation_id TEXT NOT NULL,
                    result_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT NOT NULL,
                    event TEXT NOT NULL,
                    data_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS drafts (
                    draft_id TEXT PRIMARY KEY,
                    draft_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    def create_draft(self, message: str, variants: list[DraftVariant]) -> Draft:
        """Persist a source message and its exact platform variants."""
        draft = Draft(
            draft_id=secrets.token_urlsafe(18),
            message=message,
            variants=variants,
        )
        with self._connect() as db:
            db.execute(
                "INSERT INTO drafts VALUES (?, ?, ?)",
                (draft.draft_id, draft.model_dump_json(), draft.created_at.isoformat()),
            )
        return draft

    def get_draft(self, draft_id: str) -> Draft:
        """Load one stored draft by identifier."""
        with self._connect() as db:
            row = db.execute(
                "SELECT draft_json FROM drafts WHERE draft_id = ?", (draft_id,)
            ).fetchone()
        if row is None:
            raise ValueError("Unknown draft ID")
        return Draft.model_validate_json(row["draft_json"])

    def create_preview(self, action: RenderedAction, ttl_seconds: int = 600) -> ActionPreview:
        """Persist and return a preview without performing an external write."""
        operation_id = secrets.token_urlsafe(18)
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(UTC) + timedelta(seconds=ttl_seconds)
        action_json = action.model_dump_json()
        input_hash = hashlib.sha256(action_json.encode()).hexdigest()
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self._connect() as db:
            db.execute(
                "INSERT INTO previews VALUES (?, ?, ?, ?, ?, NULL)",
                (operation_id, token_hash, input_hash, expires_at.isoformat(), action_json),
            )
            self._audit(db, operation_id, "previewed", action.model_dump(mode="json"))
        return ActionPreview(
            operation_id=operation_id,
            preview_token=token,
            input_hash=input_hash,
            expires_at=expires_at,
            action=action,
        )

    def consume_preview(
        self,
        operation_id: str,
        token: str,
        input_hash: str,
        idempotency_key: str,
    ) -> RenderedAction | ActionResult:
        """Atomically validate a preview or return the prior idempotent result."""
        with self._connect() as db:
            prior = db.execute(
                "SELECT operation_id, result_json FROM idempotency WHERE key = ?",
                (idempotency_key,),
            ).fetchone()
            if prior:
                if prior["operation_id"] != operation_id:
                    raise ValueError("Idempotency key belongs to another operation")
                return ActionResult.model_validate_json(prior["result_json"])
            row = db.execute(
                "SELECT * FROM previews WHERE operation_id = ?", (operation_id,)
            ).fetchone()
            self._validate_preview(row, token, input_hash)
            consumed_at = datetime.now(UTC).isoformat()
            updated = db.execute(
                "UPDATE previews SET consumed_at = ? "
                "WHERE operation_id = ? AND consumed_at IS NULL",
                (consumed_at, operation_id),
            )
            if updated.rowcount != 1:
                raise ValueError("Preview has already been consumed")
            action = RenderedAction.model_validate_json(row["action_json"])
            pending = ActionResult(
                operation_id=operation_id,
                platform=action.request.platform,
                action=action.request.action,
                status="in_progress",
                confirmed=False,
                retry_safe=False,
                detail="Execution started; query this idempotency key for the final result",
            )
            db.execute(
                "INSERT INTO idempotency VALUES (?, ?, ?)",
                (idempotency_key, operation_id, pending.model_dump_json()),
            )
            self._audit(db, operation_id, "execution_started", pending.model_dump(mode="json"))
            return action

    def record_result(self, key: str, result: ActionResult) -> None:
        """Record the result before returning it to the caller."""
        with self._connect() as db:
            updated = db.execute(
                "UPDATE idempotency SET result_json = ? WHERE key = ? AND operation_id = ?",
                (result.model_dump_json(), key, result.operation_id),
            )
            if updated.rowcount != 1:
                raise ValueError("Idempotency reservation is missing")
            self._audit(db, result.operation_id, "executed", result.model_dump(mode="json"))

    def list_actions(self, limit: int = 50) -> list[dict[str, object]]:
        """Return recent audit events without secrets or preview tokens."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT operation_id, event, data_json, created_at "
                "FROM audit ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "operation_id": row["operation_id"],
                "event": row["event"],
                "data": json.loads(row["data_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def get_action(self, operation_id: str) -> list[dict[str, object]]:
        """Return the complete audit trail for one operation."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT operation_id, event, data_json, created_at "
                "FROM audit WHERE operation_id = ? ORDER BY id",
                (operation_id,),
            ).fetchall()
        if not rows:
            raise ValueError("Unknown operation ID")
        return [
            {
                "operation_id": row["operation_id"],
                "event": row["event"],
                "data": json.loads(row["data_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def cancel_action(self, operation_id: str) -> dict[str, object]:
        """Cancel an unused preview so it can never be confirmed."""
        with self._connect() as db:
            updated = db.execute(
                "UPDATE previews SET consumed_at = ? "
                "WHERE operation_id = ? AND consumed_at IS NULL",
                (datetime.now(UTC).isoformat(), operation_id),
            )
            if updated.rowcount != 1:
                exists = db.execute(
                    "SELECT 1 FROM previews WHERE operation_id = ?", (operation_id,)
                ).fetchone()
                if exists is None:
                    raise ValueError("Unknown operation ID")
                raise ValueError("Action is no longer cancellable")
            data: dict[str, object] = {"status": "cancelled"}
            self._audit(db, operation_id, "cancelled", data)
        return {"operation_id": operation_id, **data}

    @staticmethod
    def _validate_preview(row: sqlite3.Row | None, token: str, input_hash: str) -> None:
        if row is None:
            raise ValueError("Unknown operation ID")
        if row["consumed_at"] is not None:
            raise ValueError("Preview has already been consumed")
        if datetime.fromisoformat(row["expires_at"]) <= datetime.now(UTC):
            raise ValueError("Preview has expired")
        if not secrets.compare_digest(
            row["token_hash"], hashlib.sha256(token.encode()).hexdigest()
        ):
            raise ValueError("Invalid preview token")
        if not secrets.compare_digest(row["input_hash"], input_hash):
            raise ValueError("Action content or target has changed")

    @staticmethod
    def _audit(
        db: sqlite3.Connection, operation_id: str, event: str, data: dict[str, object]
    ) -> None:
        db.execute(
            "INSERT INTO audit (operation_id, event, data_json, created_at) VALUES (?, ?, ?, ?)",
            (operation_id, event, json.dumps(data, sort_keys=True), datetime.now(UTC).isoformat()),
        )
