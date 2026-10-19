import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from social_automation.platforms.x.runtime import XRuntimePool


async def test_x_pool_runs_five_workers_concurrently() -> None:
    release = asyncio.Event()
    started = asyncio.Event()
    active = 0
    most_active = 0

    async def call(method: str, params: dict[str, object]) -> str:
        nonlocal active, most_active
        del method, params
        active += 1
        most_active = max(most_active, active)
        if active == 5:
            started.set()
        await release.wait()
        active -= 1
        return "ok"

    runtimes = [
        SimpleNamespace(call=AsyncMock(side_effect=call), close=AsyncMock())
        for _ in range(5)
    ]
    pool = XRuntimePool(runtimes=runtimes)
    tasks = [asyncio.create_task(pool.call("search", {})) for _ in range(12)]
    await asyncio.wait_for(started.wait(), timeout=1)

    assert most_active == 5

    release.set()
    assert await asyncio.gather(*tasks) == ["ok"] * 12
    await pool.close()
    assert all(runtime.close.await_count == 1 for runtime in runtimes)
