"""Normalize X posts and discussion trees."""

from typing import Any

from social_automation.core.models import AccountRef, Platform, Post, ThreadNode


def post_from_row(row: dict[str, Any]) -> Post:
    raw_author = row.get("author") or {}
    author = raw_author if isinstance(raw_author, dict) else {}
    handle = author.get("username") or (str(raw_author) if raw_author else None)
    native_id = str(row.get("id", ""))
    if not native_id:
        raise ValueError("X returned a post without an identifier")
    canonical_url = (
        f"https://x.com/{handle}/status/{native_id}"
        if handle
        else f"https://x.com/i/status/{native_id}"
    )
    return Post(
        platform=Platform.X,
        native_id=native_id,
        canonical_url=canonical_url,
        account=AccountRef(platform=Platform.X, native_id=author.get("id"), handle=handle),
        author_name=author.get("name"),
        text=row.get("text", ""),
        created_at=row.get("createdAt"),
        engagement={"likes": row.get("likes"), "replies": row.get("replies")},
        provider_metadata=row,
    )


def thread_nodes(rows: list[dict[str, Any]]) -> list[ThreadNode]:
    nodes = {str(row["id"]): ThreadNode(post=post_from_row(row)) for row in rows if row.get("id")}
    roots: list[ThreadNode] = []
    linked: set[str] = set()
    for row in rows:
        native_id = str(row.get("id", ""))
        if native_id not in nodes or native_id in linked:
            continue
        reply = row.get("inReplyTo") or {}
        parent_id = str(reply.get("tweetId")) if reply.get("tweetId") else None
        node = nodes[native_id]
        node.parent_native_id = parent_id
        if parent_id and parent_id in nodes:
            nodes[parent_id].children.append(node)
        else:
            roots.append(node)
        linked.add(native_id)
    return roots
