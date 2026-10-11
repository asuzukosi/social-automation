"""Python owner for the temporary XActions Node worker."""

from typing import Any

from social_automation.core.models import (
    AccessMode,
    AccountRef,
    ActionName,
    ActionResult,
    Capability,
    Completeness,
    Platform,
    Profile,
    ReactionName,
    ReadResult,
    RenderedAction,
)
from social_automation.core.redaction import redact_error
from social_automation.platforms.base import READ_OPERATIONS
from social_automation.platforms.x.mapping import post_from_row, thread_nodes
from social_automation.platforms.x.runtime import XRuntime
from social_automation.platforms.x.urls import (
    action_result_url,
    normalize_handle,
    normalize_list_id,
    normalize_post_id,
)

_SUPPORTED_WRITES = {
    ActionName.CREATE_POST,
    ActionName.REPLY,
    ActionName.REACT,
    ActionName.RESHARE,
    ActionName.DELETE_POST,
    ActionName.FOLLOW,
    ActionName.SEND_MESSAGE,
}


class XAdapter:
    """Expose XActions' proven HTTP client through a narrow internal bridge."""

    def __init__(self) -> None:
        self._runtime = XRuntime()

    async def status(self) -> dict[str, object]:
        return self._runtime.status()

    async def close(self) -> None:
        await self._runtime.close()

    def capabilities(self) -> list[Capability]:
        reads = [self._capability(name, False) for name in READ_OPERATIONS]
        writes = [
            self._capability(action.value, True, action in _SUPPORTED_WRITES)
            for action in ActionName
        ]
        return reads + writes

    async def search(self, query: str, limit: int) -> ReadResult:
        return await self._search(query, limit, None)

    async def _search(self, query: str, limit: int, cursor: str | None) -> ReadResult:
        params: dict[str, object] = {"query": query, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        rows = await self._call("search", params)
        posts = {post.native_id: post for post in (post_from_row(row) for row in rows)}
        items = list(posts.values())
        return ReadResult(
            completeness=Completeness.PARTIAL if len(rows) >= limit else Completeness.COMPLETE,
            reason="X search reached the requested limit" if len(rows) >= limit else None,
            items=items,
        )

    async def get_feed(self, feed: str | None, limit: int, cursor: str | None = None) -> ReadResult:
        if not feed or not feed.strip():
            return await self._timeline_feed("home", None, limit, cursor)
        selector = feed.strip().lower()
        if selector in {"home", "for-you", "following"}:
            return await self._timeline_feed(selector, None, limit, cursor)
        if selector.startswith("list:") or "/lists/" in selector:
            return await self._timeline_feed("list", normalize_list_id(selector), limit, cursor)
        handle = normalize_handle(feed)
        return await self._timeline_feed("account", handle, limit, cursor)

    async def _timeline_feed(
        self, kind: str, target: str | None, limit: int, cursor: str | None
    ) -> ReadResult:
        params: dict[str, object] = {"kind": kind, "target": target, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        data = await self._call("get_feed", params)
        rows = data.get("items", [])
        posts = {post.native_id: post for post in (post_from_row(row) for row in rows)}
        cursor = data.get("cursor")
        partial = bool(data.get("hasMore")) or len(rows) >= limit
        return ReadResult(
            completeness=Completeness.PARTIAL if partial else Completeness.COMPLETE,
            reason="X feed has more items" if partial else None,
            cursor=str(cursor) if cursor else None,
            items=list(posts.values()),
        )

    async def get_profile(self, profile_id: str) -> ReadResult:
        requested_handle = normalize_handle(profile_id)
        row = await self._call("get_profile", {"profile_id": requested_handle})
        handle = normalize_handle(str(row.get("username") or requested_handle))
        profile = Profile(
            platform=Platform.X,
            native_id=str(row.get("id") or handle),
            canonical_url=f"https://x.com/{handle}",
            account=AccountRef(platform=Platform.X, native_id=row.get("id"), handle=handle),
            display_name=row.get("name"),
            bio=row.get("bio") or row.get("description"),
            provider_metadata=row,
        )
        return ReadResult(completeness=Completeness.COMPLETE, profiles=[profile])

    async def get_post(self, post_id: str) -> ReadResult:
        row = await self._call("get_post", {"post_id": normalize_post_id(post_id)})
        return ReadResult(completeness=Completeness.COMPLETE, items=[post_from_row(row)])

    async def get_thread(self, post_id: str, limit: int) -> ReadResult:
        data = await self._call(
            "get_thread", {"post_id": normalize_post_id(post_id), "limit": limit}
        )
        rows = [data.get("rootTweet"), *data.get("conversation", [])]
        nodes = thread_nodes([row for row in rows if row])
        completeness = Completeness.PARTIAL if data.get("hasMore") else Completeness.COMPLETE
        return ReadResult(completeness=completeness, cursor=data.get("cursor"), thread=nodes)

    async def render_action(self, action: RenderedAction) -> RenderedAction:
        request = action.request
        if request.action not in _SUPPORTED_WRITES:
            raise ValueError(f"X does not support {request.action.value}")
        if request.title is not None or (
            request.action is ActionName.CREATE_POST and request.target is not None
        ):
            raise ValueError("X posts do not accept a title or publishing target")
        if request.action in {
            ActionName.REPLY,
            ActionName.REACT,
            ActionName.RESHARE,
            ActionName.DELETE_POST,
        }:
            request.target = normalize_post_id(str(request.target))
        if request.action in {ActionName.FOLLOW, ActionName.SEND_MESSAGE}:
            request.target = normalize_handle(str(request.target))
        if request.action is ActionName.REACT and request.reaction not in {
            ReactionName.LIKE,
            ReactionName.REMOVE,
        }:
            raise ValueError("X reactions support only like or remove")
        if request.action is ActionName.RESHARE and request.reaction not in {
            None,
            ReactionName.REMOVE,
        }:
            raise ValueError("X reshares accept only the remove reaction")
        if request.text and len(request.text) > 280:
            raise ValueError("X text exceeds 280 characters")
        action.rendered_text = action.request.text
        action.expected_side_effects = [f"X will perform {action.request.action.value}"]
        return action

    async def execute_action(self, action: RenderedAction, idempotency_key: str) -> ActionResult:
        try:
            data = await self._call(
                "execute",
                {"action": action.model_dump(mode="json"), "idempotency_key": idempotency_key},
            )
        except Exception as error:
            return self._unknown(action, redact_error(error))
        native_id = self._find_id(data)
        confirmed = native_id is not None or (
            isinstance(data, dict) and data.get("success") is True
        )
        return ActionResult(
            operation_id="",
            platform=Platform.X,
            action=action.request.action,
            status="confirmed" if confirmed else "outcome_unknown",
            confirmed=confirmed,
            retry_safe=False,
            native_id=native_id,
            canonical_url=action_result_url(action, native_id),
            detail=None if confirmed else "X did not return a reliably confirmed result",
        )

    async def _call(self, method: str, params: dict[str, object]) -> Any:
        return await self._runtime.call(method, params)

    @staticmethod
    def _capability(operation: str, write: bool, supported: bool = True) -> Capability:
        restrictions = [
            "Uses X's web HTTP interfaces, which may change without notice",
            "Bulk automation is not supported" if write else "Reads are bounded",
        ]
        if operation == "get_feed":
            restrictions.append(
                "Supports home, following, list:<id>, X list URLs, and named account feeds"
            )
        return Capability(
            operation=operation,
            supported=supported,
            write=write,
            authentication="X cookies required for writes and some reads",
            access=AccessMode.UNOFFICIAL_HTTP,
            automation_allowed=supported and not write,
            approval_required=supported and write,
            reliably_confirmed=supported,
            max_items_per_call=XAdapter._read_limit(operation) if not write else None,
            max_writes_per_confirmation=1 if supported and write else None,
            restrictions=restrictions,
        )

    @staticmethod
    def _read_limit(operation: str) -> int:
        if operation == "get_thread":
            return 200
        if operation in {"search", "get_feed"}:
            return 25
        return 1

    @staticmethod
    def _find_id(data: object) -> str | None:
        if not isinstance(data, dict):
            return None
        for key in ("id", "rest_id", "tweet_id", "id_str", "messageId"):
            if data.get(key):
                return str(data[key])
        nested = data.get("data")
        return XAdapter._find_id(nested)

    @staticmethod
    def _unknown(action: RenderedAction, detail: str) -> ActionResult:
        return ActionResult(
            operation_id="",
            platform=Platform.X,
            action=action.request.action,
            status="outcome_unknown",
            confirmed=False,
            retry_safe=False,
            detail=detail,
        )
