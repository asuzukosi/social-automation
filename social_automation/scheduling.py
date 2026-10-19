"""Bounded, independent execution queues for each social platform."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, TypeVar, cast

T = TypeVar("T")


class PlatformQueueFullError(RuntimeError):
    """Raised when a platform already has its maximum queued work."""


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


class PlatformQueue:
    """Run one platform independently with bounded FIFO admission."""

    def __init__(self, name: str, concurrency: int = 5, capacity: int = 12) -> None:
        self.name = name
        self.concurrency = concurrency
        self.capacity = capacity
        self._jobs: asyncio.Queue[_Job] = asyncio.Queue(maxsize=capacity)
        self._gate = _AccessGate()
        self._workers: list[asyncio.Task[None]] = []
        self._active = 0
        self._closed = False

    async def run(self, call: Callable[[], Awaitable[T]], *, exclusive: bool = False) -> T:
        if self._closed:
            raise RuntimeError(f"{self.name} queue is closed")
        self._start()
        future = asyncio.get_running_loop().create_future()
        try:
            self._jobs.put_nowait(_Job(call=call, future=future, exclusive=exclusive))
        except asyncio.QueueFull as error:
            raise PlatformQueueFullError(
                f"{self.name} queue is full ({self.capacity} waiting jobs)"
            ) from error
        try:
            return cast(T, await future)
        except asyncio.CancelledError:
            future.cancel()
            raise

    def snapshot(self) -> dict[str, object]:
        return {
            "capacity": self.capacity,
            "concurrency": self.concurrency,
            "queued": self._jobs.qsize(),
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
            self._active += 1
            try:
                if job.future.cancelled():
                    continue
                gate = self._gate.exclusive() if job.exclusive else self._gate.shared()
                async with gate:
                    if job.future.cancelled():
                        continue
                    result = await job.call()
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
