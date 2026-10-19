"""Interactive authentication stays local to each platform."""

import sqlite3
import stat
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from social_automation.platforms.linkedin.runtime import LinkedInRuntime
from social_automation.platforms.reddit.browser import RedditBrowser
from social_automation.platforms.x.auth import XAuthentication


async def test_x_authentication_saves_worker_cookie_privately(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("X_COOKIES", raising=False)
    cookies = [
        {"name": "auth_token", "value": "secret"},
        {"name": "ct0", "value": "csrf"},
    ]
    context = SimpleNamespace(cookies=AsyncMock(return_value=cookies), close=AsyncMock())
    browser = SimpleNamespace(launch_persistent_context=AsyncMock(return_value=context))
    playwright = SimpleNamespace(chromium=browser, stop=AsyncMock())
    manager = SimpleNamespace(start=AsyncMock(return_value=playwright))
    monkeypatch.setattr("social_automation.platforms.x.auth.async_playwright", lambda: manager)
    authentication = XAuthentication(tmp_path / "x")

    result = await authentication.authenticate()

    cookie_file = tmp_path / "x" / "session.cookies"
    assert result == {"platform": "x", "authenticated": True}
    assert cookie_file.read_text() == "auth_token=secret; ct0=csrf"
    assert stat.S_IMODE(cookie_file.stat().st_mode) == 0o600
    assert "secret" not in str(result)


def test_x_authentication_status_requires_complete_saved_session(tmp_path: Path) -> None:
    authentication = XAuthentication(tmp_path / "x")
    authentication._home.mkdir(parents=True)
    authentication._cookie_file.write_text("auth_token=secret")

    assert authentication.has_saved_session() is False

    authentication._cookie_file.write_text("auth_token=secret; ct0=csrf")

    assert authentication.has_saved_session() is True


async def test_reddit_force_authentication_clears_then_opens_login(tmp_path: Path) -> None:
    page = SimpleNamespace(goto=AsyncMock())
    context = SimpleNamespace(
        clear_cookies=AsyncMock(),
        cookies=AsyncMock(return_value=[{"name": "reddit_session"}]),
        pages=[page],
    )
    browser = RedditBrowser(tmp_path / "profile")
    browser._start = AsyncMock(return_value=context)

    result = await browser.authenticate(force=True)

    assert result == {"platform": "reddit", "authenticated": True}
    context.clear_cookies.assert_awaited_once()
    page.goto.assert_awaited_once_with(
        "https://www.reddit.com/login/", wait_until="domcontentloaded"
    )


async def test_reddit_authentication_status_reads_saved_session_without_browser(
    tmp_path: Path,
) -> None:
    cookie_database = tmp_path / "profile" / "Default" / "Network" / "Cookies"
    cookie_database.parent.mkdir(parents=True)
    with sqlite3.connect(cookie_database) as database:
        database.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER)")
        database.execute(
            "INSERT INTO cookies VALUES (?, ?, ?)",
            (".reddit.com", "reddit_session", 99_999_999_999_999_999),
        )
    browser = RedditBrowser(tmp_path / "profile")
    browser._start = AsyncMock()

    result = await browser.authentication_status()

    assert result == {"authenticated": True}
    browser._start.assert_not_awaited()


async def test_linkedin_force_authentication_uses_supported_login(monkeypatch) -> None:
    process = SimpleNamespace(returncode=0, communicate=AsyncMock(return_value=(b"", b"")))
    clear = Mock()
    source = Mock(return_value=True)
    monkeypatch.setattr("social_automation.platforms.linkedin.runtime.close_browser", AsyncMock())
    monkeypatch.setattr("social_automation.platforms.linkedin.runtime.clear_auth_state", clear)
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_authentication_source", source
    )
    spawn = AsyncMock(return_value=process)
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.asyncio.create_subprocess_exec", spawn
    )

    runtime = LinkedInRuntime()
    runtime._pages.close = AsyncMock()

    result = await runtime.authenticate(force=True)

    assert result == {"platform": "linkedin", "authenticated": True}
    clear.assert_called_once_with()
    runtime._pages.close.assert_awaited_once()
    spawn.assert_awaited_once()
    assert spawn.await_args.args[1:] == ("-m", "linkedin_mcp_server", "--login")


async def test_linkedin_authentication_status_does_not_start_browser(monkeypatch) -> None:
    source = Mock(return_value=True)
    start_browser = AsyncMock()
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_authentication_source", source
    )
    monkeypatch.setattr(
        "social_automation.platforms.linkedin.runtime.get_or_create_browser", start_browser
    )

    result = await LinkedInRuntime().authentication_status()

    assert result == {"authenticated": True}
    source.assert_called_once_with()
    start_browser.assert_not_awaited()
