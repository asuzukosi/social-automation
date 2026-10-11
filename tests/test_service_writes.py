from unittest.mock import AsyncMock

import pytest
from conftest import FakeAdapter

from social_automation.core.models import ActionName, ActionRequest, Platform
from social_automation.service import SocialService


async def test_confirmation_executes_once(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.X, action=ActionName.CREATE_POST, account="primary", text="hello"
        )
    )
    arguments = (
        preview.operation_id,
        preview.preview_token,
        True,
    )

    first = await service.confirm_action(*arguments)
    second = await service.confirm_action(*arguments)

    assert first == second
    assert isinstance(adapter, FakeAdapter)
    assert adapter.executions == 1


async def test_confirmation_requires_explicit_true(service: SocialService) -> None:
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.X, action=ActionName.CREATE_POST, account="primary", text="hello"
        )
    )

    with pytest.raises(ValueError, match="Explicit confirmation"):
        await service.confirm_action(
            preview.operation_id,
            preview.preview_token,
            False,
        )


async def test_cancelled_preview_cannot_execute(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.X,
            action=ActionName.CREATE_POST,
            account="primary",
            text="hello",
        )
    )

    cancelled = service.cancel_action(preview.operation_id)
    stored = service.get_action(preview.operation_id)

    assert cancelled["status"] == "cancelled"
    assert stored["status"] == "cancelled"
    with pytest.raises(ValueError, match="no longer confirmable"):
        await service.confirm_action(
            preview.operation_id,
            preview.preview_token,
            True,
        )
    assert isinstance(adapter, FakeAdapter)
    assert adapter.executions == 0


async def test_unexpected_write_failure_is_durable(service: SocialService) -> None:
    adapter = service.adapters[Platform.X]
    assert isinstance(adapter, FakeAdapter)
    adapter.execute_action = AsyncMock(side_effect=RuntimeError("browser exited"))
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.X,
            action=ActionName.CREATE_POST,
            account="primary",
            text="hello",
        )
    )
    arguments = (
        preview.operation_id,
        preview.preview_token,
        True,
    )

    first = await service.confirm_action(*arguments)
    second = await service.confirm_action(*arguments)

    assert first == second
    assert first.status == "outcome_unknown"
    assert first.retry_safe is False
    adapter.execute_action.assert_awaited_once()
