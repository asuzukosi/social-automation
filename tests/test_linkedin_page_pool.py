import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from social_automation.platforms.linkedin.page_pool import LinkedInPagePool


async def test_page_pool_limits_concurrent_page_leases() -> None:
    pages = [
        SimpleNamespace(is_closed=lambda: False, close=AsyncMock())
        for _ in range(5)
    ]
    context = SimpleNamespace(new_page=AsyncMock(side_effect=pages))
    pool = LinkedInPagePool(size=5)
    release = asyncio.Event()
    all_started = asyncio.Event()
    active = 0
    most_active = 0

    async def use_page() -> None:
        nonlocal active, most_active
        async with pool.lease(context):
            active += 1
            most_active = max(most_active, active)
            if active == 5:
                all_started.set()
            await release.wait()
            active -= 1

    tasks = [asyncio.create_task(use_page()) for _ in range(12)]
    await asyncio.wait_for(all_started.wait(), timeout=1)

    assert most_active == 5
    assert context.new_page.await_count == 5

    release.set()
    await asyncio.gather(*tasks)
    await pool.close()

    assert all(page.close.await_count == 1 for page in pages)
