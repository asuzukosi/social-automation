import pytest

from social_automation.platforms.x.urls import normalize_list_id


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("list:123", "123"),
        ("https://x.com/i/lists/456", "456"),
        ("https://twitter.com/reader/lists/789", "789"),
    ],
)
def test_x_list_identifiers_are_normalized(value: str, expected: str) -> None:
    assert normalize_list_id(value) == expected


@pytest.mark.parametrize(
    "value",
    ["list:abc", "https://example.com/i/lists/123", "http://x.com/i/lists/123"],
)
def test_x_list_identifiers_reject_ambiguous_targets(value: str) -> None:
    with pytest.raises(ValueError):
        normalize_list_id(value)
