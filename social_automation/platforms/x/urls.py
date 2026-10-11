"""Canonical X identifiers and URLs."""

import re
from urllib.parse import urlsplit

from social_automation.core.models import ActionName, RenderedAction

_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
_POST_ID = re.compile(r"^[0-9]{1,30}$")
_LIST_ID = _POST_ID


def normalize_handle(value: str) -> str:
    handle = value.removeprefix("@").strip()
    if not _HANDLE.fullmatch(handle):
        raise ValueError("X account handles contain 1-15 letters, numbers, or underscores")
    return handle


def normalize_post_id(value: str) -> str:
    post_id = value.strip()
    if "://" in post_id:
        parsed = urlsplit(post_id)
        host = (parsed.hostname or "").lower().removesuffix(".")
        allowed_hosts = {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}
        parts = [part for part in parsed.path.split("/") if part]
        if (
            parsed.scheme != "https"
            or host not in allowed_hosts
            or "status" not in parts
            or parts.index("status") + 1 >= len(parts)
        ):
            raise ValueError("Target must be an HTTPS X post URL or post ID")
        post_id = parts[parts.index("status") + 1]
    if not _POST_ID.fullmatch(post_id):
        raise ValueError("X post IDs must contain only digits")
    return post_id


def normalize_list_id(value: str) -> str:
    list_id = value.strip().removeprefix("list:")
    if "://" in list_id:
        parsed = urlsplit(list_id)
        host = (parsed.hostname or "").lower().removesuffix(".")
        allowed_hosts = {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}
        parts = [part for part in parsed.path.split("/") if part]
        if (
            parsed.scheme != "https"
            or host not in allowed_hosts
            or "lists" not in parts
            or parts.index("lists") + 1 >= len(parts)
        ):
            raise ValueError("Feed must be an HTTPS X list URL or list:<id>")
        list_id = parts[parts.index("lists") + 1]
    if not _LIST_ID.fullmatch(list_id):
        raise ValueError("X list IDs must contain only digits")
    return list_id


def action_result_url(action: RenderedAction, native_id: str | None) -> str | None:
    request = action.request
    if native_id and request.action in {
        ActionName.CREATE_POST,
        ActionName.REPLY,
        ActionName.RESHARE,
    }:
        return f"https://x.com/i/status/{native_id}"
    if request.target and request.action in {
        ActionName.REACT,
        ActionName.RESHARE,
        ActionName.DELETE_POST,
    }:
        return f"https://x.com/i/status/{normalize_post_id(request.target)}"
    if request.target and request.action is ActionName.FOLLOW:
        return f"https://x.com/{request.target.lstrip('@')}"
    return None
