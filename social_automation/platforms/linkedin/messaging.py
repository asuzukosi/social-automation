"""Normalize and dispatch LinkedIn messaging reads."""

from typing import Any, cast
from urllib.parse import urlsplit

from social_automation.core.models import Completeness, Conversation, Platform, ReadResult
from social_automation.platforms.linkedin.urls import normalize_linkedin_url


async def read_operation(
    extractor: Any, name: str, arguments: dict[str, object]
) -> dict[str, Any]:
    if name == "get_inbox":
        return cast(
            dict[str, Any], await extractor.get_inbox(limit=_integer(arguments, "limit"))
        )
    return cast(
        dict[str, Any],
        await extractor.get_conversation(
            linkedin_username=_optional(arguments, "linkedin_username"),
            thread_id=_optional(arguments, "thread_id"),
            index=_integer(arguments, "index"),
        ),
    )


def inbox_result(data: dict[str, Any]) -> ReadResult:
    sections = data.get("sections", {})
    errors = data.get("section_errors", {})
    references = data.get("references", {}).get("inbox", [])
    conversations = [
        _reference(reference)
        for reference in references
        if reference.get("kind") == "conversation"
    ]
    blocked = bool(errors and not sections.get("inbox") and not conversations)
    return ReadResult(
        completeness=Completeness.BLOCKED if blocked else Completeness.PARTIAL,
        reason=str(errors) if errors else "LinkedIn inbox capture is bounded by visible rows",
        conversations=conversations,
        provider_metadata={"inbox_text": sections.get("inbox", ""), "section_errors": errors},
    )


def conversation_result(
    data: dict[str, Any], participant_id: str | None, requested_thread_id: str | None
) -> ReadResult:
    url = normalize_linkedin_url(str(data.get("url") or "https://www.linkedin.com/messaging/"))
    transcript = data.get("sections", {}).get("conversation")
    conversation = Conversation(
        platform=Platform.LINKEDIN,
        thread_id=requested_thread_id or _thread_id(url),
        canonical_url=url,
        participant_id=participant_id,
        transcript=transcript,
        provider_metadata={"references": data.get("references", {}).get("conversation", [])},
    )
    return ReadResult(
        completeness=Completeness.PARTIAL if transcript else Completeness.BLOCKED,
        reason=(
            "LinkedIn conversation history is bounded by visible scrolling"
            if transcript
            else "LinkedIn did not expose visible conversation text"
        ),
        conversations=[conversation] if transcript else [],
    )


def _reference(reference: dict[str, Any]) -> Conversation:
    url = normalize_linkedin_url(str(reference.get("url", "")))
    return Conversation(
        platform=Platform.LINKEDIN,
        thread_id=_thread_id(url),
        canonical_url=url,
        participant_name=reference.get("text"),
        provider_metadata={"reference": reference},
    )


def _thread_id(url: str) -> str | None:
    parts = urlsplit(url).path.strip("/").split("/")
    return parts[2] if len(parts) >= 3 and parts[:2] == ["messaging", "thread"] else None


def _optional(arguments: dict[str, object], key: str) -> str | None:
    value = arguments.get(key)
    return str(value) if value is not None else None


def _integer(arguments: dict[str, object], key: str) -> int:
    value = arguments[key]
    if not isinstance(value, int):
        raise ValueError(f"{key} must be an integer")
    return value
