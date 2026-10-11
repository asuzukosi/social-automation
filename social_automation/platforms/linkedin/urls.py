"""Validate and canonicalize LinkedIn URLs."""

import re
from urllib.parse import urljoin, urlsplit

_PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,99}$")


def normalize_linkedin_url(value: str) -> str:
    absolute = urljoin("https://www.linkedin.com", value)
    parsed = urlsplit(absolute)
    host = (parsed.hostname or "").lower().removesuffix(".")
    linkedin_host = host == "linkedin.com" or host.endswith(".linkedin.com")
    if parsed.scheme != "https" or not linkedin_host:
        raise ValueError("URL must use HTTPS on LinkedIn")
    return absolute


def validate_post_url(value: str) -> str:
    parsed_input = urlsplit(value)
    try:
        url = normalize_linkedin_url(value)
    except ValueError as error:
        raise ValueError("Target must be an HTTPS LinkedIn post URL") from error
    path = urlsplit(url).path
    if parsed_input.scheme != "https" or not any(
        marker in path for marker in ("/posts/", "/feed/update/")
    ):
        raise ValueError("Target must be an HTTPS LinkedIn post URL")
    return url


def normalize_profile_id(value: str) -> str:
    kind, profile_id = normalize_profile_target(value)
    if kind != "person":
        raise ValueError("Target must identify a LinkedIn person profile")
    return profile_id


def normalize_profile_target(value: str) -> tuple[str, str]:
    profile_id = value.strip().removeprefix("@").strip("/")
    kind = "person"
    if "://" in profile_id:
        url = normalize_linkedin_url(profile_id)
        parts = [part for part in urlsplit(url).path.split("/") if part]
        if len(parts) != 2 or parts[0] not in {"in", "company"}:
            raise ValueError("Target must be a LinkedIn person or company URL")
        kind = "company" if parts[0] == "company" else "person"
        profile_id = parts[1]
    if not _PROFILE_ID.fullmatch(profile_id):
        raise ValueError("LinkedIn profile IDs contain letters, numbers, or hyphens")
    return kind, profile_id
