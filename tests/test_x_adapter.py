"""X adapter contract tests that do not make network requests."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from social_automation.core.models import (
    ActionName,
    ActionRequest,
    Platform,
    ReactionName,
    RenderedAction,
)
from social_automation.platforms.x.adapter import XAdapter
from social_automation.platforms.x.mapping import thread_nodes
from social_automation.platforms.x.runtime import XRuntime


async def test_x_worker_timeout_stops_desynchronized_process(monkeypatch) -> None:
    process = SimpleNamespace(
        stdin=SimpleNamespace(write=MagicMock(), drain=AsyncMock()),
        stdout=SimpleNamespace(readline=MagicMock(return_value=object())),
        terminate=MagicMock(),
        wait=AsyncMock(),
        returncode=None,
    )
    runtime = XRuntime()
    runtime._start = AsyncMock(return_value=process)

    async def time_out(awaitable, timeout):
        del awaitable, timeout
        raise TimeoutError

    monkeypatch.setattr("social_automation.platforms.x.runtime.asyncio.wait_for", time_out)

    with pytest.raises(RuntimeError, match="outcome may be unknown"):
        await runtime.call("search", {"query": "agents", "limit": 1})

    process.terminate.assert_called_once()
    process.wait.assert_awaited_once()
    assert runtime._process is None


async def test_x_runtime_closes_worker() -> None:
    runtime = XRuntime()
    process = SimpleNamespace(returncode=None, terminate=MagicMock(), wait=AsyncMock())
    runtime._process = process

    await runtime.close()

    process.terminate.assert_called_once()
    process.wait.assert_awaited_once()
    assert runtime._process is None


def test_x_capabilities_report_personal_feeds() -> None:
    capabilities = {item.operation: item for item in XAdapter().capabilities()}

    assert capabilities["get_feed"].supported is True
    assert any("home, following" in item for item in capabilities["get_feed"].restrictions)


async def test_x_named_feed_uses_bounded_account_search() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"items": [], "cursor": None, "hasMore": False})

    result = await adapter.get_feed("@reader", 10)

    adapter._call.assert_awaited_once_with(
        "get_feed", {"kind": "account", "target": "reader", "limit": 10}
    )
    assert result.completeness.value == "complete"


async def test_x_home_feed_uses_authenticated_timeline() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(
        return_value={
            "items": [{"id": "123", "text": "hello", "author": {"username": "reader"}}],
            "cursor": "next-page",
            "hasMore": True,
        }
    )

    result = await adapter.get_feed(None, 10)

    adapter._call.assert_awaited_once_with(
        "get_feed", {"kind": "home", "target": None, "limit": 10}
    )
    assert result.completeness.value == "partial"
    assert result.cursor == "next-page"
    assert result.items[0].native_id == "123"


async def test_x_following_feed_uses_latest_timeline() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"items": [], "cursor": None, "hasMore": False})

    result = await adapter.get_feed("following", 10)

    adapter._call.assert_awaited_once_with(
        "get_feed", {"kind": "following", "target": None, "limit": 10}
    )
    assert result.completeness.value == "complete"


async def test_x_list_feed_accepts_url() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"items": [], "cursor": None, "hasMore": False})

    await adapter.get_feed("https://x.com/i/lists/12345", 10)

    adapter._call.assert_awaited_once_with(
        "get_feed", {"kind": "list", "target": "12345", "limit": 10}
    )


async def test_x_list_feed_resumes_from_cursor() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"items": [], "cursor": None, "hasMore": False})

    await adapter.get_feed("list:12345", 10, "next-page")

    adapter._call.assert_awaited_once_with(
        "get_feed",
        {"kind": "list", "target": "12345", "limit": 10, "cursor": "next-page"},
    )


async def test_x_named_feed_resumes_search_cursor() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"items": [], "cursor": None, "hasMore": False})

    await adapter.get_feed("reader", 10, "next-page")

    adapter._call.assert_awaited_once_with(
        "get_feed",
        {"kind": "account", "target": "reader", "limit": 10, "cursor": "next-page"},
    )


async def test_x_named_feed_rejects_search_syntax() -> None:
    with pytest.raises(ValueError, match="account handles"):
        await XAdapter().get_feed("reader OR from:other", 10)


async def test_x_search_reports_partial_at_the_limit() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(
        return_value=[{"id": "123", "text": "hello", "author": {"username": "reader"}}]
    )

    result = await adapter.search("agents", 1)

    assert result.completeness.value == "partial"
    assert result.reason == "X search reached the requested limit"


async def test_x_unsupported_reaction_fails_before_worker_call() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock()
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.REACT,
            account="primary",
            target="123",
            reaction=ReactionName.DOWN,
        )
    )

    try:
        await adapter.render_action(action)
    except ValueError as error:
        assert "support only like or remove" in str(error)
    else:
        raise AssertionError("unsupported reaction was accepted")
    adapter._call.assert_not_awaited()


async def test_x_write_preview_normalizes_and_validates_targets() -> None:
    adapter = XAdapter()
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.REPLY,
            account="primary",
            target="https://x.com/reader/status/123",
            text="hello",
        )
    )

    rendered = await adapter.render_action(action)

    assert rendered.request.target == "123"
    with pytest.raises(ValueError, match="only digits"):
        await adapter.render_action(
            RenderedAction(
                request=ActionRequest(
                    platform=Platform.X,
                    action=ActionName.REACT,
                    account="primary",
                    target="123 OR 456",
                    reaction=ReactionName.LIKE,
                )
            )
        )


async def test_x_post_url_is_normalized_before_worker_call() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(
        return_value={"id": "123", "text": "hello", "author": {"username": "reader"}}
    )

    result = await adapter.get_post("https://x.com/reader/status/123")

    adapter._call.assert_awaited_once_with("get_post", {"post_id": "123"})
    assert result.items[0].native_id == "123"
    assert result.items[0].canonical_url == "https://x.com/reader/status/123"


async def test_x_post_without_identifier_is_rejected() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"text": "hello"})

    with pytest.raises(ValueError, match="without an identifier"):
        await adapter.get_post("123")


async def test_x_success_without_new_identifier_is_confirmed() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"success": True})
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.REACT,
            account="primary",
            target="123",
            reaction=ReactionName.LIKE,
        )
    )

    result = await adapter.execute_action(action, "idempotency-key")

    assert result.confirmed is True
    assert result.status == "confirmed"
    assert result.canonical_url == "https://x.com/i/status/123"


async def test_x_target_action_returns_canonical_post_url() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"success": True})
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.REACT,
            account="primary",
            target="456",
            reaction=ReactionName.LIKE,
        )
    )

    result = await adapter.execute_action(action, "idempotency-key")

    assert result.canonical_url == "https://x.com/i/status/456"


async def test_x_message_identifier_is_preserved() -> None:
    adapter = XAdapter()
    adapter._call = AsyncMock(return_value={"messageId": "message-123"})
    action = RenderedAction(
        request=ActionRequest(
            platform=Platform.X,
            action=ActionName.SEND_MESSAGE,
            account="primary",
            target="recipient",
            text="hello",
        )
    )

    result = await adapter.execute_action(action, "idempotency-key")

    assert result.confirmed is True
    assert result.native_id == "message-123"


def test_x_thread_deduplicates_repeated_timeline_rows() -> None:
    root = {"id": "root", "text": "Root", "author": {"username": "one"}}
    reply = {
        "id": "reply",
        "text": "Reply",
        "author": {"username": "two"},
        "inReplyTo": {"tweetId": "root"},
    }

    nodes = thread_nodes([root, root, reply, reply])

    assert [node.post.native_id for node in nodes] == ["root"]
    assert [node.post.native_id for node in nodes[0].children] == ["reply"]
