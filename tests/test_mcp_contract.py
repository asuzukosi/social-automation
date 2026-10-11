"""Public MCP contract tests independent of platform credentials."""

import json
from unittest.mock import AsyncMock

from fastmcp import Client

from social_automation.server import get_service, lifespan, mcp

EXPECTED_TOOLS = {
    "social_status",
    "social_capabilities",
    "social_accounts",
    "social_authenticate",
    "social_authentication_status",
    "social_logout",
    "social_search",
    "social_get_feed",
    "social_get_profile",
    "social_get_post",
    "social_get_thread",
    "social_preview_action",
    "social_confirm_action",
    "social_cancel_action",
    "social_list_actions",
    "social_get_action",
}


async def test_public_surface_is_small_and_social_only() -> None:
    async with Client(mcp) as client:
        tools = await client.list_tools()

    assert {tool.name for tool in tools} == EXPECTED_TOOLS
    assert len(json.dumps([tool.model_dump(mode="json") for tool in tools])) < 30_000


async def test_preview_schema_has_no_untyped_provider_bag() -> None:
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}

    properties = tools["social_preview_action"].input_schema["properties"]
    assert "metadata" not in properties
    assert "title" in properties
    assert properties["reaction"]["anyOf"][0]["enum"] == ["like", "up", "down", "remove"]
    assert tools["social_preview_action"].annotations.read_only_hint is False
    assert tools["social_authenticate"].input_schema["properties"]["force"]["default"] is False
    assert tools["social_authentication_status"].annotations.read_only_hint is True
    confirm_properties = tools["social_confirm_action"].input_schema["properties"]
    assert set(confirm_properties) == {"operation_id", "preview_token", "confirmed"}


async def test_read_tools_enforce_conservative_result_limits() -> None:
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}

    assert tools["social_search"].input_schema["properties"]["limit"]["maximum"] == 25
    assert tools["social_search"].input_schema["properties"]["limit"]["default"] == 10
    assert tools["social_get_feed"].input_schema["properties"]["limit"]["maximum"] == 25
    assert (
        tools["social_get_feed"].input_schema["properties"]["cursor"]["anyOf"][0]["maxLength"]
        == 2_048
    )
    assert tools["social_get_thread"].input_schema["properties"]["limit"]["maximum"] == 200


async def test_public_platform_enum_contains_only_selected_networks() -> None:
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}

    platforms = tools["social_search"].input_schema["properties"]["platforms"]
    assert platforms["items"]["enum"] == ["x", "reddit", "linkedin"]
    assert tools["social_authenticate"].input_schema["properties"]["platform"]["enum"] == [
        "x",
        "reddit",
        "linkedin",
    ]


async def test_social_content_is_marked_as_untrusted_data() -> None:
    async with Client(mcp) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}

    for name in {
        "social_search",
        "social_get_feed",
        "social_get_profile",
        "social_get_post",
        "social_get_thread",
    }:
        assert "untrusted data" in str(tools[name].description)


async def test_server_lifespan_closes_started_service() -> None:
    get_service.cache_clear()
    service = get_service()
    service.close = AsyncMock()

    async with lifespan(mcp):
        pass

    service.close.assert_awaited_once()
    get_service.cache_clear()
