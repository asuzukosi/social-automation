"""Reddit write targets distinguish posts from nested comments."""

import pytest

from social_automation.platforms.reddit.urls import (
    normalize_comment_url,
    normalize_post_id,
    validate_post_url,
)


def test_reddit_post_urls_accept_supported_canonical_shapes() -> None:
    validate_post_url("https://www.reddit.com/comments/abc123/title/")
    validate_post_url("https://www.reddit.com/r/python/comments/abc123/title/")
    assert normalize_post_id("https://www.reddit.com/r/python/comments/abc123/title/") == "abc123"


def test_reddit_post_url_rejects_nested_comment_permalink() -> None:
    with pytest.raises(ValueError, match="Reddit post URL"):
        validate_post_url("https://www.reddit.com/r/python/comments/abc123/title/comment456/")


def test_reddit_comment_permalink_preserves_target_and_identity() -> None:
    url = "https://www.reddit.com/r/python/comments/abc123/title/comment456/"

    assert normalize_comment_url(url) == (url, "comment456")


@pytest.mark.parametrize(
    "url",
    [
        "https://www.reddit.com/r/python/comments/abc123/title/",
        "https://www.reddit.com/user/reader/comments/abc123/title/comment456/",
        "https://example.com/r/python/comments/abc123/title/comment456/",
    ],
)
def test_reddit_comment_permalink_rejects_non_comment_targets(url: str) -> None:
    with pytest.raises(ValueError, match="comment permalink|HTTPS Reddit URL"):
        normalize_comment_url(url)


def test_reddit_post_url_rejects_unrelated_comments_path() -> None:
    with pytest.raises(ValueError, match="Reddit post URL"):
        validate_post_url("https://www.reddit.com/user/reader/comments/abc123/title/")
