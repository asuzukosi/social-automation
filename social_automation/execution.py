"""Result handling for social reads and confirmed writes."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable

from social_automation.core.models import (
    ActionResult,
    Completeness,
    ReadResult,
    RenderedAction,
)
from social_automation.core.redaction import redact_error
from social_automation.platforms.base import PlatformAdapter
from social_automation.storage import ActionStore


async def read_result(call: Awaitable[ReadResult]) -> ReadResult:
    try:
        return await call
    except Exception as error:
        return ReadResult(completeness=Completeness.BLOCKED, reason=redact_error(error))


async def execute_action(
    store: ActionStore,
    adapter: PlatformAdapter,
    action: RenderedAction,
    operation_id: str,
) -> ActionResult:
    try:
        result = await adapter.execute_action(action, operation_id)
        result.operation_id = operation_id
    except asyncio.CancelledError as error:
        result = unknown_result(action, operation_id, error)
        store.record_result(result)
        raise
    except Exception as error:
        result = unknown_result(action, operation_id, error)
    store.record_result(result)
    return result


def record_timeout(
    store: ActionStore, operation_id: str, error: BaseException
) -> ActionResult:
    stored = store.get_action(operation_id)
    result = ActionResult.model_validate(stored["result"])
    if stored["status"] == "completed":
        return result
    result.status = "outcome_unknown"
    result.detail = redact_error(error)
    store.record_result(result)
    return result


def unknown_result(
    action: RenderedAction, operation_id: str, error: BaseException
) -> ActionResult:
    return ActionResult(
        operation_id=operation_id,
        platform=action.request.platform,
        action=action.request.action,
        status="outcome_unknown",
        confirmed=False,
        retry_safe=False,
        detail=redact_error(error),
    )
