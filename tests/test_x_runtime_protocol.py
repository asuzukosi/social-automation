"""The X line protocol fails closed when worker state is ambiguous."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from social_automation.platforms.x.runtime import XRuntime


def process_with(line: bytes) -> SimpleNamespace:
    return SimpleNamespace(
        stdout=SimpleNamespace(readline=AsyncMock(return_value=line)),
        terminate=MagicMock(),
        kill=MagicMock(),
        wait=AsyncMock(),
        returncode=None,
    )


@pytest.mark.parametrize(
    "line",
    [
        b"not-json\n",
        b"[]\n",
        b'{"id":1}\n',
        b'{"id":99,"result":{}}\n',
    ],
)
async def test_invalid_worker_response_stops_process(line: bytes) -> None:
    runtime = XRuntime()
    runtime._request_id = 1
    process = process_with(line)
    runtime._process = process

    with pytest.raises(RuntimeError, match="invalid|unexpected"):
        await runtime._response(process)

    process.terminate.assert_called_once()
    process.wait.assert_awaited_once()
    assert runtime._process is None


async def test_worker_shutdown_kills_process_after_timeout(monkeypatch) -> None:
    process = process_with(b"")
    waits = 0

    async def wait() -> None:
        nonlocal waits
        waits += 1
        if waits == 1:
            raise TimeoutError

    process.wait = AsyncMock(side_effect=wait)

    class ImmediateTimeout:
        def __init__(self, delay: float) -> None:
            del delay

        async def __aenter__(self) -> None:
            return None

        async def __aexit__(self, *args: object) -> bool:
            raise TimeoutError

    monkeypatch.setattr("social_automation.platforms.x.runtime.asyncio.timeout", ImmediateTimeout)

    await XRuntime._stop(process)

    process.kill.assert_called_once()
    assert process.wait.await_count == 2
