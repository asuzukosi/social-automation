import asyncio
from unittest.mock import AsyncMock

import pytest
from conftest import FakeAdapter

from social_automation.core.models import (
    ActionName,
    ActionRequest,
    Completeness,
    Platform,
    ReadResult,
)
from social_automation.scheduling import PlatformQueue, PlatformQueueFullError
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


async def test_full_platform_queue_does_not_consume_preview(service: SocialService) -> None:
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.X,
            action=ActionName.CREATE_POST,
            account="primary",
            text="hello",
        )
    )
    await service.queues[Platform.X].close()
    service.queues[Platform.X] = PlatformQueue("x", concurrency=1, capacity=1)
    release = asyncio.Event()
    started = asyncio.Event()

    async def blocker() -> None:
        started.set()
        await release.wait()

    active = asyncio.create_task(service.queues[Platform.X].run(blocker))
    await started.wait()
    queued = asyncio.create_task(service.queues[Platform.X].run(blocker))
    await asyncio.sleep(0)

    with pytest.raises(PlatformQueueFullError):
        await service.confirm_action(
            preview.operation_id,
            preview.preview_token,
            True,
        )

    assert service.get_action(preview.operation_id)["status"] == "previewed"
    release.set()
    await asyncio.gather(active, queued)


async def test_linkedin_read_retries_once_after_timeout(service: SocialService) -> None:
    adapter = service.adapters[Platform.LINKEDIN]
    attempts = 0
    recovered = 0

    async def get_profile(profile_id: str) -> ReadResult:
        nonlocal attempts
        del profile_id
        attempts += 1
        if attempts == 1:
            await asyncio.Event().wait()
        return ReadResult(completeness=Completeness.COMPLETE)

    async def recover() -> None:
        nonlocal recovered
        recovered += 1

    adapter.get_profile = get_profile  # type: ignore[method-assign]
    await service.queues[Platform.LINKEDIN].close()
    service.queues[Platform.LINKEDIN] = PlatformQueue(
        "linkedin",
        concurrency=1,
        capacity=12,
        timeout_seconds=0.01,
        on_abort=recover,
    )

    result = await service.get_profile(Platform.LINKEDIN, "reader")

    assert result.completeness is Completeness.COMPLETE
    assert attempts == 2
    assert recovered == 1


async def test_linkedin_write_timeout_is_not_retried(service: SocialService) -> None:
    adapter = service.adapters[Platform.LINKEDIN]
    attempts = 0

    async def execute(*args: object) -> None:
        nonlocal attempts
        del args
        attempts += 1
        await asyncio.Event().wait()

    adapter.execute_action = execute  # type: ignore[method-assign]
    await service.queues[Platform.LINKEDIN].close()
    service.queues[Platform.LINKEDIN] = PlatformQueue(
        "linkedin",
        concurrency=1,
        capacity=12,
        timeout_seconds=0.01,
    )
    preview = await service.preview_action(
        ActionRequest(
            platform=Platform.LINKEDIN,
            action=ActionName.CREATE_POST,
            account="primary",
            text="hello",
        )
    )

    result = await service.confirm_action(
        preview.operation_id,
        preview.preview_token,
        True,
    )

    assert attempts == 1
    assert result.status == "outcome_unknown"
    assert result.retry_safe is False
    assert service.get_action(preview.operation_id)["status"] == "completed"
