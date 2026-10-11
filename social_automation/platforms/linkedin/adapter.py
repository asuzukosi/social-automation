import json
from typing import Any

from social_automation.core.models import (
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
from social_automation.platforms.base import READ_OPERATIONS
from social_automation.platforms.linkedin.capabilities import capability
from social_automation.platforms.linkedin.mapping import post_page, reference_post
from social_automation.platforms.linkedin.runtime import LinkedInRuntime
from social_automation.platforms.linkedin.urls import (
    normalize_profile_id,
    normalize_profile_target,
    validate_post_url,
)

_SUPPORTED_WRITES = {
    ActionName.CREATE_POST,
    ActionName.COMMENT,
    ActionName.DELETE_POST,
    ActionName.REACT,
    ActionName.CONNECT,
    ActionName.SEND_MESSAGE,
}


class LinkedInAdapter:
    def __init__(self) -> None:
        self._runtime = LinkedInRuntime()

    async def status(self) -> dict[str, object]:
        return {**await self._runtime.status(), "browser": "visible by default"}

    async def close(self) -> None:
        await self._runtime.close()

    async def authenticate(self, force: bool = False) -> dict[str, object]:
        return await self._runtime.authenticate(force)

    async def authentication_status(self) -> dict[str, object]:
        return await self._runtime.authentication_status()

    async def logout(self) -> dict[str, object]:
        return await self._runtime.logout()

    def capabilities(self) -> list[Capability]:
        supported_reads = {"search", "get_feed", "get_profile", "get_post"}
        return [capability(name, False, name in supported_reads) for name in READ_OPERATIONS] + [
            capability(name.value, True, name in _SUPPORTED_WRITES) for name in ActionName
        ]

    async def search(self, query: str, limit: int) -> ReadResult:
        data = await self._call(
            "search_posts", {"keywords": query, "max_pages": min(10, (limit + 9) // 10)}
        )
        references = [
            reference
            for reference in data.get("references", {}).get("search_results", [])
            if reference.get("kind") == "feed_post"
        ]
        items = [reference_post(reference) for reference in references]
        errors = data.get("section_errors", {})
        return ReadResult(
            completeness=Completeness.BLOCKED if errors and not items else Completeness.PARTIAL,
            reason=json.dumps(errors)
            if errors
            else "LinkedIn search is bounded by visible scrolling",
            items=items[:limit],
        )

    async def get_feed(self, feed: str | None, limit: int, cursor: str | None = None) -> ReadResult:
        if feed not in {None, "home"}:
            return self._unsupported("LinkedIn currently exposes only the signed-in home feed")
        if cursor:
            return self._unsupported("LinkedIn does not expose a stable feed cursor")
        data = await self._call("get_feed", {"num_posts": limit})
        references = data.get("references", [])
        items = [reference_post(reference) for reference in references]
        error = data.get("error")
        return ReadResult(
            completeness=Completeness.BLOCKED if error and not items else Completeness.PARTIAL,
            reason=json.dumps(error) if error else "LinkedIn feed is bounded by visible scrolling",
            items=items[:limit],
        )

    async def get_profile(self, profile_id: str) -> ReadResult:
        kind, profile_id = normalize_profile_target(profile_id)
        name = "get_company_profile" if kind == "company" else "get_person_profile"
        key = "company_name" if kind == "company" else "linkedin_username"
        section = "about" if kind == "company" else "main_profile"
        data = await self._call(name, {key: profile_id})
        sections = data.get("sections", {})
        errors = data.get("section_errors", {})
        blocked = bool(errors and not sections.get(section))
        path = "company" if kind == "company" else "in"
        fallback = f"https://www.linkedin.com/{path}/{profile_id}/"
        profile = Profile(
            platform=Platform.LINKEDIN,
            native_id=profile_id,
            canonical_url=str(data.get("url") or fallback),
            account=AccountRef(platform=Platform.LINKEDIN, handle=profile_id),
            bio=sections.get(section),
            provider_metadata={
                "profile_kind": kind,
                "references": data.get("references", {}),
                "section_errors": errors,
            },
        )
        return ReadResult(
            completeness=(Completeness.BLOCKED if blocked else Completeness.PARTIAL),
            reason=(
                json.dumps(errors)
                if errors
                else "LinkedIn profile capture is limited to the visible main section"
            ),
            profiles=[] if blocked else [profile],
        )

    async def get_post(self, post_id: str) -> ReadResult:
        post_url = validate_post_url(post_id)
        data = await self._call("read_post", {"post_url": post_url})
        error = data.get("error")
        post = post_page(data, post_url)
        blocked = bool(error and not post.text)
        return ReadResult(
            completeness=Completeness.BLOCKED if blocked else Completeness.PARTIAL,
            reason=(
                json.dumps(error)
                if error
                else "LinkedIn post capture is bounded and does not expand complete discussions"
            ),
            items=[] if blocked else [post],
        )

    async def get_thread(self, post_id: str, limit: int) -> ReadResult:
        del post_id, limit
        return self._unsupported("LinkedIn nested comments are not yet structurally extractable")

    async def render_action(self, action: RenderedAction) -> RenderedAction:
        if action.request.action not in _SUPPORTED_WRITES:
            raise ValueError(f"LinkedIn {action.request.action.value} has not migrated yet")
        if action.request.title is not None or (
            action.request.action is ActionName.CREATE_POST and action.request.target is not None
        ):
            raise ValueError("LinkedIn posts do not accept a title or publishing target")
        if action.request.action in {
            ActionName.COMMENT,
            ActionName.DELETE_POST,
            ActionName.REACT,
        }:
            action.request.target = validate_post_url(str(action.request.target))
        if action.request.action in {ActionName.CONNECT, ActionName.SEND_MESSAGE}:
            action.request.target = normalize_profile_id(str(action.request.target))
        if (
            action.request.action is ActionName.REACT
            and action.request.reaction is not ReactionName.LIKE
        ):
            raise ValueError("LinkedIn reactions currently support only like")
        action.rendered_text = action.request.text
        action.expected_side_effects = [
            f"A visible LinkedIn browser will perform {action.request.action.value}"
        ]
        return action

    async def execute_action(self, action: RenderedAction, idempotency_key: str) -> ActionResult:
        del idempotency_key
        request = action.request
        if request.action is ActionName.CREATE_POST:
            data = await self._call("create_post", {"text": action.rendered_text})
        elif request.action is ActionName.COMMENT:
            data = await self._call(
                "comment_on_post",
                {"post_url": request.target, "text": action.rendered_text},
            )
        elif request.action is ActionName.REACT:
            data = await self._call("react_to_post", {"post_url": request.target})
        elif request.action is ActionName.DELETE_POST:
            data = await self._call("delete_post", {"post_url": request.target})
        elif request.action is ActionName.CONNECT:
            data = await self._call(
                "connect_with_person",
                {"linkedin_username": request.target, "note": action.rendered_text},
            )
        elif request.action is ActionName.SEND_MESSAGE:
            data = await self._call(
                "send_message",
                {
                    "linkedin_username": request.target,
                    "message": action.rendered_text,
                    "confirm_send": True,
                },
            )
        else:
            raise ValueError(f"Unsupported LinkedIn action: {request.action.value}")
        status = str(data.get("status", "outcome_unknown"))
        confirmed = (
            status in {"connected", "accepted", "sent", "confirmed"}
            or bool(data.get("sent"))
            or bool(data.get("confirmed"))
        )
        return ActionResult(
            operation_id="",
            platform=Platform.LINKEDIN,
            action=request.action,
            status=status,
            confirmed=confirmed,
            retry_safe=False,
            canonical_url=data.get("url") or request.target,
            detail=data.get("message"),
        )

    async def _call(self, name: str, arguments: dict[str, object]) -> dict[str, Any]:
        return await self._runtime.call(name, arguments)

    @staticmethod
    def _unsupported(reason: str) -> ReadResult:
        return ReadResult(completeness=Completeness.BLOCKED, reason=reason)
