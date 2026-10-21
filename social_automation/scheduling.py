"""Bounded, independent execution queues for each social platform."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from typing import Any, TypeVar, cast

T = TypeVar("T")


class PlatformQueueFullError(RuntimeError):
    """Raised when a platform already has its maximum queued work."""


class PlatformQueueTimeoutError(TimeoutError):
    """Raised when a platform operation exceeds its execution deadline."""


class _AccessGate:
    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._readers = 0
        self._writer = False
        self._waiting_writers = 0

    @asynccontextmanager
    async def shared(self) -> AsyncIterator[None]:
        async with self._condition:
            await self._condition.wait_for(
                lambda: not self._writer and self._waiting_writers == 0
            )
            self._readers += 1
        try:
            yield
        finally:
            async with self._condition:
                self._readers -= 1
                self._condition.notify_all()

    @asynccontextmanager
    async def exclusive(self) -> AsyncIterator[None]:
        async with self._condition:
            self._waiting_writers += 1
            try:
                await self._condition.wait_for(
                    lambda: not self._writer and self._readers == 0
                )
                self._writer = True
            finally:
                self._waiting_writers -= 1
        try:
            yield
        finally:
            async with self._condition:
                self._writer = False
                self._condition.notify_all()


@dataclass(slots=True)
class _Job:
    call: Callable[[], Awaitable[Any]]
    future: asyncio.Future[Any]
    exclusive: bool
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Future[Any] | None = None
    started: bool = False
    counted: bool = True


class PlatformQueue:
    """Run one platform independently with bounded FIFO admission."""

    def __init__(
        self,
        name: str,
        concurrency: int = 5,
        capacity: int = 12,
        timeout_seconds: float | None = None,
        on_abort: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.name = name
        self.concurrency = concurrency
        self.capacity = capacity
        self.timeout_seconds = timeout_seconds
        self._on_abort = on_abort
        self._jobs: asyncio.Queue[_Job] = asyncio.Queue()
        self._gate = _AccessGate()
        self._workers: list[asyncio.Task[None]] = []
        self._waiting = 0
        self._active = 0
        self._closed = False

    async def run(self, call: Callable[[], Awaitable[T]], *, exclusive: bool = False) -> T:
        if self._closed:
            raise RuntimeError(f"{self.name} queue is closed")
        self._start()
        if self._waiting >= self.capacity:
            raise PlatformQueueFullError(
                f"{self.name} queue is full ({self.capacity} waiting jobs)"
            )
        future = asyncio.get_running_loop().create_future()
        job = _Job(call=call, future=future, exclusive=exclusive)
        self._waiting += 1
        self._jobs.put_nowait(job)
        try:
            return cast(T, await future)
        except asyncio.CancelledError:
            self._cancel(job)
            raise

    def snapshot(self) -> dict[str, object]:
        return {
            "capacity": self.capacity,
            "concurrency": self.concurrency,
            "queued": self._waiting,
            "active": self._active,
        }

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._jobs.join()
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    def _start(self) -> None:
        if self._workers:
            return
        self._workers = [
            asyncio.create_task(self._work(), name=f"{self.name}-queue-{index}")
            for index in range(self.concurrency)
        ]

    async def _work(self) -> None:
        while True:
            job = await self._jobs.get()
            self._start_job(job)
            self._active += 1
            try:
                if job.future.cancelled():
                    continue
                gate = self._gate.exclusive() if job.exclusive else self._gate.shared()
                async with gate:
                    if job.future.cancelled():
                        continue
                    result = await self._execute(job)
                if not job.future.done():
                    job.future.set_result(result)
            except asyncio.CancelledError as error:
                if not job.future.done():
                    job.future.set_exception(error)
                if self._closed:
                    raise
            except BaseException as error:
                if not job.future.done():
                    job.future.set_exception(error)
            finally:
                self._active -= 1
                self._jobs.task_done()

    def _start_job(self, job: _Job) -> None:
        job.started = True
        if job.counted:
            job.counted = False
            self._waiting -= 1

    def _cancel(self, job: _Job) -> None:
        job.future.cancel()
        job.cancelled.set()
        if job.task is not None:
            job.task.cancel()
        if not job.started and job.counted:
            job.counted = False
            self._waiting -= 1

    async def _execute(self, job: _Job) -> Any:
        operation: asyncio.Future[Any] = asyncio.ensure_future(job.call())
        cancelled = asyncio.create_task(job.cancelled.wait())
        job.task = operation
        try:
            done, _ = await asyncio.wait(
                {operation, cancelled},
                timeout=self.timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if job.cancelled.is_set():
                await self._abort(operation)
                raise asyncio.CancelledError
            if operation in done:
                return operation.result()
            await self._abort(operation)
            raise PlatformQueueTimeoutError(
                f"{self.name} operation timed out after {self.timeout_seconds:g} seconds"
            )
        finally:
            job.task = None
            cancelled.cancel()
            self._silence(cancelled)

    async def _abort(self, operation: asyncio.Future[Any]) -> None:
        operation.cancel()
        self._silence(operation)
        await asyncio.sleep(0)
        if self._on_abort is None:
            return
        recovery: asyncio.Future[None] = asyncio.ensure_future(self._on_abort())
        done, _ = await asyncio.wait({recovery}, timeout=10)
        if recovery not in done:
            recovery.cancel()
        self._silence(recovery)

    @staticmethod
    def _silence(task: asyncio.Future[Any]) -> None:
        def consume(done: asyncio.Future[Any]) -> None:
            with suppress(BaseException):
                done.exception()

        task.add_done_callback(consume)
