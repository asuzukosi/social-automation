from unittest.mock import MagicMock

import pytest

from social_automation.server import http_main, mcp


def test_http_broker_uses_loopback_defaults(monkeypatch) -> None:
    run = MagicMock()
    monkeypatch.setattr(mcp, "run", run)
    monkeypatch.delenv("SOCIAL_HTTP_HOST", raising=False)
    monkeypatch.delenv("SOCIAL_HTTP_PORT", raising=False)

    http_main()

    run.assert_called_once_with(
        transport="http", host="127.0.0.1", port=8765, path="/mcp"
    )


def test_http_broker_rejects_non_loopback_binding(monkeypatch) -> None:
    monkeypatch.setenv("SOCIAL_HTTP_HOST", "0.0.0.0")

    with pytest.raises(ValueError, match="must bind to loopback"):
        http_main()


def test_http_broker_exits_cleanly_on_keyboard_interrupt(monkeypatch) -> None:
    monkeypatch.setattr(mcp, "run", MagicMock(side_effect=KeyboardInterrupt))
    monkeypatch.delenv("SOCIAL_HTTP_HOST", raising=False)

    http_main()
