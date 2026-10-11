"""The bundled X bridge remains self-contained and keyless."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock

from social_automation.platforms.x.adapter import XAdapter

WORKER = Path(__file__).parents[1] / "social_automation/platforms/x/worker.mjs"


async def test_x_worker_starts_without_an_api_key(monkeypatch) -> None:
    monkeypatch.delenv("X_COOKIES", raising=False)
    monkeypatch.delenv("XACTIONS_SESSION_COOKIE", raising=False)
    process = await asyncio.create_subprocess_exec(
        "node",
        str(WORKER),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )

    stdout, _ = await process.communicate(b'{"id":1,"method":"status","params":{}}\n')
    response = json.loads(stdout)

    assert process.returncode == 0
    assert response == {"id": 1, "result": {"authenticated": False}}


async def test_every_x_write_stops_at_authentication_without_a_session(monkeypatch) -> None:
    monkeypatch.delenv("X_COOKIES", raising=False)
    monkeypatch.delenv("XACTIONS_SESSION_COOKIE", raising=False)
    actions = [
        {"action": "create_post", "text": "hello"},
        {"action": "reply", "target": "123", "text": "hello"},
        {"action": "react", "target": "123", "reaction": "like"},
        {"action": "reshare", "target": "123"},
        {"action": "delete_post", "target": "123"},
        {"action": "follow", "target": "reader"},
        {"action": "send_message", "target": "reader", "text": "hello"},
    ]
    requests = [
        {
            "id": index,
            "method": "execute",
            "params": {
                "action": {"request": action, "rendered_text": action.get("text")},
                "idempotency_key": f"test-{index}",
            },
        }
        for index, action in enumerate(actions, start=1)
    ]
    process = await asyncio.create_subprocess_exec(
        "node",
        str(WORKER),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )

    payload = "".join(f"{json.dumps(request)}\n" for request in requests).encode()
    stdout, _ = await process.communicate(payload)
    responses = [json.loads(line) for line in stdout.splitlines()]

    assert [response["id"] for response in responses] == list(range(1, 8))
    assert all("uthentication required" in response["error"] for response in responses)


async def test_personal_x_feeds_stop_at_authentication_without_a_session(monkeypatch) -> None:
    monkeypatch.delenv("X_COOKIES", raising=False)
    monkeypatch.delenv("XACTIONS_SESSION_COOKIE", raising=False)
    process = await asyncio.create_subprocess_exec(
        "node",
        str(WORKER),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    requests = [
        {"id": 1, "method": "get_feed", "params": {"kind": "home", "limit": 10}},
        {
            "id": 2,
            "method": "get_feed",
            "params": {"kind": "list", "list_id": "123", "limit": 10},
        },
    ]

    payload = "".join(f"{json.dumps(request)}\n" for request in requests).encode()
    stdout, _ = await process.communicate(payload)
    responses = [json.loads(line) for line in stdout.splitlines()]

    assert [response["id"] for response in responses] == [1, 2]
    assert all("uthentication required" in response["error"] for response in responses)


async def test_x_status_does_not_start_worker(monkeypatch) -> None:
    adapter = XAdapter()
    call = AsyncMock()
    monkeypatch.setattr(adapter._runtime, "call", call)
    monkeypatch.setattr("social_automation.platforms.x.runtime.shutil.which", lambda _: "/node")
    monkeypatch.setenv("X_COOKIES", "configured-session")

    status = await adapter.status()

    assert status == {"available": True, "authenticated": True}
    call.assert_not_awaited()


async def test_x_status_accepts_legacy_session_cookie_name(monkeypatch) -> None:
    adapter = XAdapter()
    monkeypatch.delenv("X_COOKIES", raising=False)
    monkeypatch.setenv("XACTIONS_SESSION_COOKIE", "configured-session")
    monkeypatch.setattr("social_automation.platforms.x.runtime.shutil.which", lambda _: "/node")

    status = await adapter.status()

    assert status["authenticated"] is True


def test_x_worker_fails_closed_instead_of_retrying() -> None:
    worker = WORKER.read_text()

    assert 'rateLimitStrategy:"error",maxRetries:0,autoRefreshQueryIds:!1' in worker
