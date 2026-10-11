"""Translate Reddit listings into the shared social model."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from html import unescape
from typing import Any

from defusedxml.ElementTree import fromstring

from social_automation.core.models import AccountRef, Platform, Post, ThreadNode

ATOM = "{http://www.w3.org/2005/Atom}"


def post_from_row(row: dict[str, Any]) -> Post:
    native_id = str(row["id"])
    return Post(
        platform=Platform.REDDIT,
        native_id=native_id,
        canonical_url=f"https://reddit.com{row.get('permalink', '')}",
        account=AccountRef(platform=Platform.REDDIT, handle=row.get("author")),
        text="\n\n".join(part for part in (row.get("title"), row.get("selftext")) if part),
        created_at=datetime.fromtimestamp(row["created_utc"], UTC),
        engagement={"score": row.get("score"), "comments": row.get("num_comments")},
        provider_metadata={"subreddit": row.get("subreddit"), "name": row.get("name")},
    )


def comment_rows(children: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Flatten loaded comments and collect Reddit's expansion identifiers."""
    rows: list[dict[str, Any]] = []
    more_ids: list[str] = []
    for child in children:
        if child.get("kind") == "more":
            more_ids.extend(str(item) for item in child.get("data", {}).get("children", []))
            continue
        if child.get("kind") != "t1" or not child.get("data"):
            continue
        row = child["data"]
        rows.append(row)
        replies = row.get("replies")
        if isinstance(replies, dict):
            nested_rows, nested_more = comment_rows(replies["data"]["children"])
            rows.extend(nested_rows)
            more_ids.extend(nested_more)
    return rows, more_ids


def comment_nodes(rows: list[dict[str, Any]]) -> list[ThreadNode]:
    """Deduplicate flat comments and restore their parent-child hierarchy."""
    nodes = {
        str(row["id"]): ThreadNode(
            post=_comment_from_row(row),
            parent_native_id=row.get("parent_id"),
        )
        for row in rows
        if row.get("id")
    }
    roots: list[ThreadNode] = []
    for native_id, node in nodes.items():
        parent = str(node.parent_native_id or "").removeprefix("t1_")
        if parent in nodes and parent != native_id:
            nodes[parent].children.append(node)
        else:
            roots.append(node)
    return roots


def posts_from_atom(xml: str, fallback_subreddit: str) -> list[Post]:
    """Normalize Reddit's credential-free Atom feed."""
    root = fromstring(xml)
    posts: list[Post] = []
    for entry in root.findall(f"{ATOM}entry"):
        link = entry.find(f"{ATOM}link")
        url = str(link.get("href", "")) if link is not None else ""
        raw_id = entry.findtext(f"{ATOM}id", "")
        native_id = raw_id.removeprefix("t3_") or _post_id_from_url(url)
        if not native_id or not url:
            continue
        author = entry.findtext(f"{ATOM}author/{ATOM}name", "").removeprefix("/u/")
        title = unescape(entry.findtext(f"{ATOM}title", ""))
        body = _plain_text(entry.findtext(f"{ATOM}content", ""))
        published = entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated")
        posts.append(
            Post(
                platform=Platform.REDDIT,
                native_id=native_id,
                canonical_url=url,
                account=AccountRef(platform=Platform.REDDIT, handle=author or None),
                text=f"{title}\n\n{body}".strip(),
                created_at=_published_at(published),
                provider_metadata={
                    "subreddit": _subreddit_from_url(url, fallback_subreddit),
                    "source": "rss",
                },
            )
        )
    return posts


def _comment_from_row(row: dict[str, Any]) -> Post:
    post = post_from_row({**row, "title": "", "selftext": row.get("body", ""), "num_comments": 0})
    post.canonical_url = f"https://reddit.com{row.get('permalink', '')}"
    return post


def _plain_text(value: str) -> str:
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", value)).split())


def _post_id_from_url(url: str) -> str:
    parts = [part for part in url.split("/") if part]
    return parts[parts.index("comments") + 1] if "comments" in parts else ""


def _subreddit_from_url(url: str, fallback: str) -> str:
    parts = [part for part in url.split("/") if part]
    return parts[parts.index("r") + 1] if "r" in parts else fallback


def _published_at(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
