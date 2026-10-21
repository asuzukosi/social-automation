import asyncio

import pytest

from social_automation.scheduling import (
    PlatformQueue,
    PlatformQueueFullError,
    PlatformQueueTimeoutError,
)


async def test_queue_runs_up_to_five_jobs_concurrently() -> None:
    queue = PlatformQueue("linkedin", concurrency=5, capacity=12)
    release = asyncio.Event()
    started = asyncio.Event()
    active = 0
    most_active = 0

    async def work() -> None:
        nonlocal active, most_active
        active += 1
        most_active = max(most_active, active)
        if active == 5:
            started.set()
        await release.wait()
        active -= 1

    tasks = [asyncio.create_task(queue.run(work)) for _ in range(12)]
    await asyncio.wait_for(started.wait(), timeout=1)

    assert most_active == 5
    assert queue.snapshot() == {
        "capacity": 12,
        "concurrency": 5,
        "queued": 7,
        "active": 5,
    }

    release.set()
    await asyncio.gather(*tasks)
    await queue.close()


async def test_exclusive_job_drains_reads_and_blocks_later_reads() -> None:
    queue = PlatformQueue("linkedin", concurrency=3, capacity=12)
    first_reads_release = asyncio.Event()
    first_reads_started = asyncio.Event()
    events: list[str] = []
    active_reads = 0

    async def first_read() -> None:
        nonlocal active_reads
        active_reads += 1
        if active_reads == 2:
            first_reads_started.set()
        await first_reads_release.wait()
        active_reads -= 1

    async def write() -> None:
        events.append("write")

    async def later_read() -> None:
        events.append("read")

    reads = [asyncio.create_task(queue.run(first_read)) for _ in range(2)]
    await first_reads_started.wait()
    writer = asyncio.create_task(queue.run(write, exclusive=True))
    reader = asyncio.create_task(queue.run(later_read))
    await asyncio.sleep(0)
    first_reads_release.set()
    await asyncio.gather(*reads, writer, reader)

    assert events == ["write", "read"]
    await queue.close()


async def test_full_queue_rejects_more_work() -> None:
    queue = PlatformQueue("x", concurrency=1, capacity=1)
    release = asyncio.Event()
    started = asyncio.Event()

    async def work() -> None:
        started.set()
        await release.wait()

    active = asyncio.create_task(queue.run(work))
    await started.wait()
    queued = asyncio.create_task(queue.run(work))
    await asyncio.sleep(0)

    with pytest.raises(PlatformQueueFullError, match="x queue is full"):
        await queue.run(work)

    release.set()
    await asyncio.gather(active, queued)
    await queue.close()


async def test_cancelled_queued_job_never_starts() -> None:
    queue = PlatformQueue("reddit", concurrency=1, capacity=2)
    release = asyncio.Event()
    started = asyncio.Event()
    cancelled_started = False

    async def active_work() -> None:
        started.set()
        await release.wait()

    async def cancelled_work() -> None:
        nonlocal cancelled_started
        cancelled_started = True

    active = asyncio.create_task(queue.run(active_work))
    await started.wait()
    cancelled = asyncio.create_task(queue.run(cancelled_work))
    await asyncio.sleep(0)
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    release.set()
    await active
    await queue.close()

    assert cancelled_started is False


async def test_cancelled_operation_does_not_remove_worker() -> None:
    queue = PlatformQueue("x", concurrency=1, capacity=2)

    async def cancelled_work() -> None:
        raise asyncio.CancelledError

    async def next_work() -> str:
        return "completed"

    with pytest.raises(asyncio.CancelledError):
        await queue.run(cancelled_work)

    assert await queue.run(next_work) == "completed"
    await queue.close()


async def test_timed_out_operation_recovers_and_releases_worker() -> None:
    release = asyncio.Event()
    recovered = asyncio.Event()

    async def stuck_work() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            await release.wait()

    async def recover() -> None:
        release.set()
        recovered.set()

    queue = PlatformQueue(
        "linkedin",
        concurrency=1,
        capacity=2,
        timeout_seconds=0.01,
        on_abort=recover,
    )

    with pytest.raises(PlatformQueueTimeoutError, match="linkedin operation timed out"):
        await queue.run(stuck_work)

    assert recovered.is_set()
    assert await queue.run(lambda: asyncio.sleep(0, result="completed")) == "completed"
    await queue.close()


async def test_cancelling_active_request_stops_work_and_releases_worker() -> None:
    started = asyncio.Event()
    cancelled = asyncio.Event()
    queue = PlatformQueue("linkedin", concurrency=1, capacity=2)

    async def work() -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    request = asyncio.create_task(queue.run(work))
    await started.wait()
    request.cancel()

    with pytest.raises(asyncio.CancelledError):
        await request

    await asyncio.wait_for(cancelled.wait(), timeout=1)
    assert await queue.run(lambda: asyncio.sleep(0, result="completed")) == "completed"
    await queue.close()


async def test_cancelled_waiting_request_releases_queue_capacity() -> None:
    release = asyncio.Event()
    started = asyncio.Event()
    queue = PlatformQueue("linkedin", concurrency=1, capacity=1)

    async def blocker() -> None:
        started.set()
        await release.wait()

    active = asyncio.create_task(queue.run(blocker))
    await started.wait()
    waiting = asyncio.create_task(queue.run(blocker))
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting

    replacement = asyncio.create_task(queue.run(lambda: asyncio.sleep(0)))
    await asyncio.sleep(0)
    assert queue.snapshot()["queued"] == 1

    release.set()
    await asyncio.gather(active, replacement)
    await queue.close()
