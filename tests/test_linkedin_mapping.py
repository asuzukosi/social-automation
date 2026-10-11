"""LinkedIn normalization does not duplicate captured page text."""

from social_automation.platforms.linkedin.mapping import post_page


def test_linkedin_post_metadata_keeps_only_diagnostics_and_references() -> None:
    post = post_page(
        {
            "url": "https://www.linkedin.com/posts/example/",
            "text": "Visible post text",
            "references": [{"kind": "person", "url": "/in/reader/"}],
            "error": None,
        },
        "https://www.linkedin.com/posts/example/",
    )

    assert post.text == "Visible post text"
    assert post.provider_metadata == {
        "references": [{"kind": "person", "url": "/in/reader/"}],
        "error": None,
    }
    assert "text" not in post.provider_metadata
