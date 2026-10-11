"""Normalize LinkedIn's reference-heavy browser results."""

from typing import Any

from social_automation.core.models import AccountRef, Platform, Post
from social_automation.platforms.linkedin.urls import normalize_linkedin_url, validate_post_url


def reference_post(reference: dict[str, Any]) -> Post:
    """Normalize one stable post reference from a browser capture."""
    url = normalize_linkedin_url(str(reference.get("url", "")))
    native_id = str(reference.get("value") or url.rstrip("/").rsplit("/", 1)[-1])
    return Post(
        platform=Platform.LINKEDIN,
        native_id=native_id,
        canonical_url=url,
        account=AccountRef(platform=Platform.LINKEDIN),
        text=str(reference.get("text") or ""),
        provider_metadata={"reference": reference},
    )


def post_page(data: dict[str, Any], fallback_url: str) -> Post:
    """Normalize one captured LinkedIn post page."""
    url = validate_post_url(str(data.get("url") or fallback_url))
    return Post(
        platform=Platform.LINKEDIN,
        native_id=url.rstrip("/").rsplit("/", 1)[-1],
        canonical_url=url,
        account=AccountRef(platform=Platform.LINKEDIN),
        text=str(data.get("text") or ""),
        provider_metadata={
            "references": data.get("references", []),
            "error": data.get("error"),
        },
    )
