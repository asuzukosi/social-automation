"""Reusable LinkedIn pages within one authenticated browser context."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any


class LinkedInPagePool:
    def __init__(self, size: int = 5) -> None:
        self.size = size
        self._available: asyncio.LifoQueue[Any] = asyncio.LifoQueue()
        self._lock = asyncio.Lock()
        self._created = 0

    @asynccontextmanager
    async def lease(self, context: Any) -> AsyncIterator[Any]:
        page = await self._acquire(context)
        try:
            yield page
        finally:
            if page.is_closed():
                async with self._lock:
                    self._created -= 1
            else:
                self._available.put_nowait(page)

    async def close(self) -> None:
        pages = []
        while not self._available.empty():
            pages.append(self._available.get_nowait())
        await asyncio.gather(*(page.close() for page in pages), return_exceptions=True)
        async with self._lock:
            self._created = 0

    async def _acquire(self, context: Any) -> Any:
        try:
            return self._available.get_nowait()
        except asyncio.QueueEmpty:
            pass
        async with self._lock:
            if self._created < self.size:
                self._created += 1
                create = True
            else:
                create = False
        if not create:
            return await self._available.get()
        try:
            return await context.new_page()
        except BaseException:
            async with self._lock:
                self._created -= 1
            raise
