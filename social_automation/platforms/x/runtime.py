"""Lifecycle and line protocol for the bundled X worker."""

import asyncio
import json
import os
import shutil
from pathlib import Path
from typing import Any

from social_automation.platforms.x.auth import XAuthentication


class XRuntime:
    def __init__(self, authentication: XAuthentication | None = None) -> None:
        self._authentication = authentication or XAuthentication()
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._request_id = 0

    def status(self) -> dict[str, object]:
        return {
            "available": shutil.which("node") is not None and self._worker.is_file(),
            "authenticated": bool(self._authentication.cookie_header()),
        }

    async def call(self, method: str, params: dict[str, object]) -> Any:
        async with self._lock:
            process = await self._start()
            self._request_id += 1
            request = {"id": self._request_id, "method": method, "params": params}
            if process.stdin is None or process.stdout is None:
                raise RuntimeError("X worker pipes are unavailable")
            process.stdin.write((json.dumps(request) + "\n").encode())
            await process.stdin.drain()
            response = await self._response(process)
            if "error" in response:
                raise RuntimeError(str(response["error"]))
            return response["result"]

    async def close(self) -> None:
        async with self._lock:
            if self._process is not None:
                await self._stop(self._process)
                self._process = None

    async def _response(self, process: asyncio.subprocess.Process) -> dict[str, Any]:
        stdout = process.stdout
        if stdout is None:
            raise RuntimeError("X worker output pipe is unavailable")
        try:
            line = await asyncio.wait_for(stdout.readline(), timeout=60)
        except TimeoutError as error:
            await self._stop(process)
            self._process = None
            raise RuntimeError("X worker timed out; write outcome may be unknown") from error
        if not line:
            await self._stop(process)
            self._process = None
            raise RuntimeError("X worker exited without a response")
        try:
            decoded = json.loads(line.decode())
            if not isinstance(decoded, dict):
                raise TypeError("response is not an object")
            response: dict[str, Any] = decoded
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as error:
            await self._stop(process)
            self._process = None
            raise RuntimeError("X worker returned an invalid response") from error
        if response.get("id") != self._request_id:
            await self._stop(process)
            self._process = None
            raise RuntimeError("X worker returned an unexpected response")
        if ("result" in response) == ("error" in response):
            await self._stop(process)
            self._process = None
            raise RuntimeError("X worker returned an invalid response")
        return response

    async def _start(self) -> asyncio.subprocess.Process:
        if self._process and self._process.returncode is None:
            return self._process
        environment = {**os.environ, "XACTIONS_HOME": str(Path.home() / ".social-automation" / "x")}
        environment["X_COOKIES"] = self._authentication.cookie_header()
        self._process = await asyncio.create_subprocess_exec(
            "node",
            str(self._worker),
            env=environment,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=None,
        )
        return self._process

    @staticmethod
    async def _stop(process: asyncio.subprocess.Process) -> None:
        if process.returncode is None:
            process.terminate()
        try:
            async with asyncio.timeout(5):
                await process.wait()
        except TimeoutError:
            process.kill()
            await process.wait()

    @property
    def _worker(self) -> Path:
        return Path(__file__).with_name("worker.mjs")
