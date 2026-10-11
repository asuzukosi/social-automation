"""Validate Reddit targets before browser navigation."""

import re
from urllib.parse import urlsplit

_POST_ID = re.compile(r"^[A-Za-z0-9]+$")
_SUBREDDIT = re.compile(r"^[A-Za-z0-9_]{3,21}$")
_USERNAME = re.compile(r"^[A-Za-z0-9_-]{3,20}$")


def normalize_subreddit(value: str) -> str:
    name = value.removeprefix("r/").strip("/")
    if not _SUBREDDIT.fullmatch(name):
        raise ValueError("Reddit community names contain 3-21 letters, numbers, or underscores")
    return name


def normalize_username(value: str) -> str:
    name = value.removeprefix("u/").strip("/")
    if not _USERNAME.fullmatch(name):
        raise ValueError("Reddit usernames contain 3-20 letters, numbers, underscores, or hyphens")
    return name


def validate_reddit_url(url: str) -> None:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").removesuffix(".")
    if parsed.scheme != "https" or not (host == "reddit.com" or host.endswith(".reddit.com")):
        raise ValueError("Target must be an HTTPS Reddit URL")


def validate_post_url(url: str) -> None:
    validate_reddit_url(url)
    parts = [part for part in urlsplit(url).path.split("/") if part]
    if "comments" not in parts:
        raise ValueError("Target must be a Reddit post URL or post ID")
    index = parts.index("comments")
    prefix_is_post = index == 0 or (index == 2 and parts[0] == "r")
    tail = parts[index + 1 :]
    if not prefix_is_post or not 1 <= len(tail) <= 2:
        raise ValueError("Target must be a Reddit post URL or post ID")


def normalize_comment_url(url: str) -> tuple[str, str]:
    validate_reddit_url(url)
    parts = [part for part in urlsplit(url).path.split("/") if part]
    if "comments" not in parts:
        raise ValueError("Target must be a Reddit comment permalink")
    index = parts.index("comments")
    prefix_is_post = index == 0 or (index == 2 and parts[0] == "r")
    tail = parts[index + 1 :]
    if not prefix_is_post or len(tail) != 3 or not _POST_ID.fullmatch(tail[-1]):
        raise ValueError("Target must be a Reddit comment permalink")
    return url, tail[-1]


def normalize_post_id(value: str) -> str:
    if value.startswith("https://"):
        validate_post_url(value)
        parts = [part for part in urlsplit(value).path.split("/") if part]
        post_id = parts[parts.index("comments") + 1]
    else:
        post_id = value.removeprefix("t3_")
    if not _POST_ID.fullmatch(post_id):
        raise ValueError("Reddit post IDs must contain only letters and numbers")
    return post_id


def post_id_from_url(url: object) -> str | None:
    if not isinstance(url, str) or "/comments/" not in url:
        return None
    return url.split("/comments/", 1)[1].split("/", 1)[0] or None


def stop_if_account_attention_required(url: str) -> None:
    path = urlsplit(url).path.lower().rstrip("/")
    blocked = ("/login", "/register", "/account/suspended", "/appeals", "/verify")
    if any(path == marker or path.startswith(f"{marker}/") for marker in blocked):
        raise RuntimeError("Reddit requires manual account attention; automation stopped")
