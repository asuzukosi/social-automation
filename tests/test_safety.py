"""Low-volume and fail-closed operation safeguards."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from conftest import FakeAdapter

from social_automation.core.models import ActionName, ActionRequest, Platform
from social_automation.platforms.linkedin.adapter import LinkedInAdapter
from social_automation.platforms.reddit.adapter import RedditAdapter
from social_automation.platforms.x.adapter import XAdapter
from social_automation.service import SocialService

EXPECTED_OPERATIONS = {
    "search",
    "get_feed",
    "get_profile",
    "get_post",
    "get_thread",
    *(action.value for action in ActionName),
}


@pytest.mark.parametrize("adapter", [XAdapter(), RedditAdapter(), LinkedInAdapter()])
def test_capabilities_expose_automation_and_interaction_bounds(adapter) -> None:
    capabilities = adapter.capabilities()
    assert {capability.operation for capability in capabilities} == EXPECTED_OPERATIONS
    for capability in capabilities:
        if not capability.supported:
            assert capability.automation_allowed is False
            assert capability.max_items_per_call is None
            assert capability.max_writes_per_confirmation is None
        elif capability.write:
            assert capability.automation_allowed is False
            assert capability.approval_required is True
            assert capability.max_writes_per_confirmation == 1
        else:
            assert capability.automation_allowed is True
            assert capability.max_items_per_call in {1, 25, 200}


async def test_confirmations_run_independently_across_platforms(service: SocialService) -> None:
    active = 0
    most_active = 0

    async def execute(platform, action, key):
        nonlocal active, most_active
        active += 1
        most_active = max(most_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        adapter = service.adapters[platform]
        assert isinstance(adapter, FakeAdapter)
        return await FakeAdapter.execute_action(adapter, action, key)

    previews = []
    for platform in (Platform.X, Platform.REDDIT):
        adapter = service.adapters[platform]
        assert isinstance(adapter, FakeAdapter)

        async def execute_for(action, key, selected=platform):
            return await execute(selected, action, key)

        adapter.execute_action = AsyncMock(side_effect=execute_for)
        previews.append(
            await service.preview_action(
                ActionRequest(
                    platform=platform,
                    action=ActionName.CREATE_POST,
                    account="primary",
                    text="hello",
                )
            )
        )

    await asyncio.gather(
        *(
            service.confirm_action(
                preview.operation_id,
                preview.preview_token,
                True,
            )
            for preview in previews
        )
    )

    assert most_active == 2


async def test_confirmations_remain_serialized_within_one_platform(
    service: SocialService,
) -> None:
    adapter = service.adapters[Platform.X]
    assert isinstance(adapter, FakeAdapter)
    active = 0
    most_active = 0

    async def execute(action, key):
        nonlocal active, most_active
        active += 1
        most_active = max(most_active, active)
        await asyncio.sleep(0.01)
        active -= 1
        return await FakeAdapter.execute_action(adapter, action, key)

    adapter.execute_action = AsyncMock(side_effect=execute)
    previews = [
        await service.preview_action(
            ActionRequest(
                platform=Platform.X,
                action=ActionName.CREATE_POST,
                account="primary",
                text=f"hello {index}",
            )
        )
        for index in range(2)
    ]

    await asyncio.gather(
        *(
            service.confirm_action(preview.operation_id, preview.preview_token, True)
            for preview in previews
        )
    )

    assert most_active == 1
