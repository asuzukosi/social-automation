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
from social_automation.platforms.reddit import mapping
from social_automation.platforms.reddit.browser import RedditBrowser
from social_automation.platforms.reddit.reader import RedditReader
from social_automation.platforms.reddit.urls import (
    normalize_comment_url,
    normalize_post_id,
    normalize_subreddit,
    normalize_username,
    post_id_from_url,
    validate_post_url,
)

_SUPPORTED_WRITES = {
    ActionName.CREATE_POST,
    ActionName.REPLY,
    ActionName.COMMENT,
    ActionName.REACT,
    ActionName.DELETE_POST,
    ActionName.FOLLOW,
}


class RedditAdapter:
    def __init__(self, browser: RedditBrowser | None = None) -> None:
        self._browser = browser or RedditBrowser()
        self._reader = RedditReader("social-automation/0.1", self._browser)

    async def status(self) -> dict[str, object]:
        return await self._browser.status()

    async def close(self) -> None:
        await self._reader.close()
        await self._browser.close()

    async def authenticate(self, force: bool = False) -> dict[str, object]:
        return await self._browser.authenticate(force)

    async def authentication_status(self) -> dict[str, object]:
        return await self._browser.authentication_status()

    async def logout(self) -> dict[str, object]:
        return await self._browser.logout()

    def capabilities(self) -> list[Capability]:
        return [self._capability(name, False, True) for name in READ_OPERATIONS] + [
            self._capability(item.value, True, item in _SUPPORTED_WRITES) for item in ActionName
        ]

    async def search(self, query: str, limit: int) -> ReadResult:
        data = await self._reader.json("/search", {"q": query, "limit": limit})
        children = data.get("data", {}).get("children", [])
        return ReadResult(
            completeness=Completeness.PARTIAL
            if data.get("data", {}).get("after")
            else Completeness.COMPLETE,
            cursor=data.get("data", {}).get("after"),
            items=[
                mapping.post_from_row(child["data"])
                for child in children
                if child.get("kind") == "t3"
            ],
        )

    async def get_feed(self, feed: str | None, limit: int, cursor: str | None = None) -> ReadResult:
        community = normalize_subreddit(feed) if feed else ""
        path = f"/r/{community}" if community else ""
        return await self._reader.feed(path, community, limit, cursor)

    async def get_profile(self, profile_id: str) -> ReadResult:
        handle = normalize_username(profile_id)
        data = await self._reader.json(f"/user/{handle}/about")
        row = data.get("data", {})
        profile_data = row.get("subreddit") or {}
        profile = Profile(
            platform=Platform.REDDIT,
            native_id=str(row.get("id") or handle),
            canonical_url=f"https://www.reddit.com/user/{handle}/",
            account=AccountRef(platform=Platform.REDDIT, native_id=row.get("id"), handle=handle),
            display_name=row.get("name") or handle,
            bio=profile_data.get("public_description"),
            provider_metadata=row,
        )
        return ReadResult(completeness=Completeness.COMPLETE, profiles=[profile])

    async def get_post(self, post_id: str) -> ReadResult:
        listing = await self._post_listing(post_id, limit=1)
        post = listing[0]["data"]["children"][0]["data"]
        return ReadResult(completeness=Completeness.COMPLETE, items=[mapping.post_from_row(post)])

    async def get_thread(self, post_id: str, limit: int) -> ReadResult:
        native_id = normalize_post_id(post_id)
        post_listing, comments = await self._post_listing(native_id, limit=limit)
        post = mapping.post_from_row(post_listing["data"]["children"][0]["data"])
        rows, more_ids = mapping.comment_rows(comments["data"]["children"])
        expansion_error: str | None = None
        try:
            rows, more_ids = await self._expand_comments(native_id, rows, more_ids, limit)
        except Exception as error:
            expansion_error = redact_error(error)
        limit_reached = len(rows) >= limit
        has_more = limit_reached or bool(more_ids) or expansion_error is not None
        return ReadResult(
            completeness=Completeness.PARTIAL if has_more else Completeness.COMPLETE,
            reason=(
                f"Reddit comment expansion stopped: {expansion_error}"
                if expansion_error
                else "The requested comment limit was reached"
                if limit_reached or more_ids
                else None
            ),
            items=[post],
            thread=mapping.comment_nodes(rows[:limit]),
        )

    async def _expand_comments(
        self,
        post_id: str,
        rows: list[dict[str, Any]],
        more_ids: list[str],
        limit: int,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        seen = {str(row.get("id")) for row in rows}
        pending = list(dict.fromkeys(more_ids))
        expanded_placeholders: set[str] = set()
        while pending and len(rows) < limit:
            batch, pending = pending[:100], pending[100:]
            expanded_placeholders.update(batch)
            data = await self._reader.json(
                "/api/morechildren",
                {
                    "api_type": "json",
                    "link_id": f"t3_{post_id.removeprefix('t3_')}",
                    "children": ",".join(batch),
                    "raw_json": 1,
                },
            )
            things = data.get("json", {}).get("data", {}).get("things", [])
            expanded, nested_more = mapping.comment_rows(things)
            for row in expanded:
                native_id = str(row.get("id"))
                if native_id and native_id not in seen:
                    rows.append(row)
                    seen.add(native_id)
            repeated = [item for item in nested_more if item in expanded_placeholders]
            if repeated:
                return rows, list(dict.fromkeys([*repeated, *pending]))
            pending.extend(item for item in nested_more if item not in pending)
        return rows, pending

    async def render_action(self, action: RenderedAction) -> RenderedAction:
        request = action.request
        if request.action not in _SUPPORTED_WRITES:
            raise ValueError(f"Reddit does not support {request.action.value}")
        if request.action is ActionName.REACT and request.reaction not in {
            ReactionName.UP,
            ReactionName.DOWN,
            ReactionName.REMOVE,
        }:
            raise ValueError("Reddit reactions support only up, down, or remove")
        if request.action is ActionName.CREATE_POST:
            if not request.target:
                raise ValueError("Reddit create_post requires a subreddit target")
            request.target = normalize_subreddit(request.target)
            if not (request.title and request.title.strip()):
                raise ValueError("Reddit create_post requires a title")
        elif request.action is ActionName.FOLLOW:
            request.target = normalize_subreddit(str(request.target))
        elif request.action is ActionName.REPLY:
            request.target = normalize_comment_url(str(request.target))[0]
        elif request.action in {
            ActionName.COMMENT,
            ActionName.REACT,
            ActionName.DELETE_POST,
        }:
            request.target = await self._target_url(str(request.target))
        action.rendered_text = request.text
        action.expected_side_effects = [
            f"The local Reddit browser profile will perform {request.action.value}"
        ]
        return action

    async def execute_action(self, action: RenderedAction, idempotency_key: str) -> ActionResult:
        del idempotency_key
        data = await self._browser.execute(action)
        request = action.request
        return ActionResult(
            operation_id="",
            platform=Platform.REDDIT,
            action=request.action,
            status=str(data.get("status", "outcome_unknown")),
            confirmed=bool(data.get("confirmed")),
            retry_safe=bool(data.get("retry_safe", False)),
            native_id=post_id_from_url(data.get("url")),
            canonical_url=data.get("url")
            or (None if request.action is ActionName.CREATE_POST else request.target),
            detail=data.get("message"),
        )

    async def _target_url(self, target: str) -> str:
        if target.startswith("https://"):
            validate_post_url(target)
            return target
        result = await self.get_post(normalize_post_id(target))
        return result.items[0].canonical_url

    async def _post_listing(self, post_id: str, limit: int) -> list[dict[str, Any]]:
        normalized = normalize_post_id(post_id)
        data = await self._reader.json(f"/comments/{normalized}", {"limit": limit, "depth": 10})
        if not isinstance(data, list) or len(data) < 2:
            raise ValueError(f"Reddit post not found: {post_id}")
        return data

    @staticmethod
    def _capability(operation: str, write: bool, supported: bool) -> Capability:
        restrictions = ["Bulk automation is not supported" if write else "Reads are bounded"]
        if write:
            restrictions.insert(0, "Visible browser required for writes")
        return Capability(
            operation=operation,
            supported=supported,
            write=write,
            authentication="Local Reddit browser profile" if write else "None",
            access=AccessMode.BROWSER if write else AccessMode.UNOFFICIAL_HTTP,
            automation_allowed=supported and not write,
            approval_required=supported and write,
            reliably_confirmed=supported and (not write or operation in {"create_post", "react"}),
            max_items_per_call=(
                {"get_thread": 200, "search": 25, "get_feed": 25}.get(operation, 1)
                if not write
                else None
            ),
            max_writes_per_confirmation=1 if supported and write else None,
            restrictions=restrictions,
        )
