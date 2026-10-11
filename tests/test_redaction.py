import pytest
from conftest import FakeAdapter

from social_automation.core.models import Platform
from social_automation.service import SocialService


async def test_read_errors_redact_session_material(
    service: SocialService, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret = "auth_token=private-session-value"
    monkeypatch.setenv("X_COOKIES", secret)
    adapter = service.adapters[Platform.X]
    assert isinstance(adapter, FakeAdapter)

    async def fail(post_id: str):
        raise RuntimeError(f"Cookie: {secret}\nfailed to read {post_id}")

    adapter.get_post = fail
    result = await service.get_post(Platform.X, "123")

    assert result.reason == "Cookie=[redacted]\nfailed to read 123"
    assert secret not in result.reason
