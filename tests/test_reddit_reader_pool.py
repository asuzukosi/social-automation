from types import SimpleNamespace
from unittest.mock import AsyncMock

from social_automation.platforms.reddit.reader import RedditReader


async def test_reddit_reader_reuses_and_closes_http_client(monkeypatch) -> None:
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {"ok": True},
        text="ok",
    )
    client = SimpleNamespace(get=AsyncMock(return_value=response), aclose=AsyncMock())

    def create_client(**kwargs):
        del kwargs
        return client

    monkeypatch.setattr(
        "social_automation.platforms.reddit.reader.httpx.AsyncClient", create_client
    )
    reader = RedditReader("test-agent", SimpleNamespace())

    await reader._get("https://www.reddit.com/a.json", None, parse_json=True)
    await reader._get("https://www.reddit.com/b.json", None, parse_json=True)
    await reader.close()

    assert client.get.await_count == 2
    client.aclose.assert_awaited_once()
