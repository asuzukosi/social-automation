"""X read normalization preserves identity and completeness."""

from unittest.mock import AsyncMock

from social_automation.platforms.x.adapter import XAdapter


async def test_x_profile_normalizes_handle_and_identity() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(
        return_value={
            "id": "42",
            "username": "reader",
            "name": "Reader",
            "description": "A public profile",
        }
    )

    result = await adapter.get_profile("@reader")

    adapter._call.assert_awaited_once_with("get_profile", {"profile_id": "reader"})
    assert result.profiles[0].native_id == "42"
    assert result.profiles[0].canonical_url == "https://x.com/reader"
    assert result.profiles[0].bio == "A public profile"


async def test_x_thread_reports_provider_continuation() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(
        return_value={
            "rootTweet": {
                "id": "123",
                "text": "root",
                "author": {"username": "reader"},
            },
            "conversation": [],
            "hasMore": True,
            "cursor": "next-page",
        }
    )

    result = await adapter.get_thread("https://x.com/reader/status/123", 10)

    assert result.completeness.value == "partial"
    assert result.cursor == "next-page"
    assert result.thread[0].post.native_id == "123"
