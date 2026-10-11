"""Normalized models shared by every supported social platform."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Platform(StrEnum):
    """A social network supported by this product."""

    X = "x"
    REDDIT = "reddit"
    LINKEDIN = "linkedin"


class Completeness(StrEnum):
    """Whether a read exhausted the provider's available data."""

    COMPLETE = "complete"
    PARTIAL = "partial"
    BLOCKED = "blocked"


class AccessMode(StrEnum):
    """How an adapter reaches a platform."""

    UNOFFICIAL_HTTP = "unofficial_http"
    BROWSER = "browser"


class ActionName(StrEnum):
    """Normalized write operations."""

    CREATE_POST = "create_post"
    REPLY = "reply"
    COMMENT = "comment"
    REACT = "react"
    RESHARE = "reshare"
    DELETE_POST = "delete_post"
    FOLLOW = "follow"
    CONNECT = "connect"
    SEND_MESSAGE = "send_message"


class ReactionName(StrEnum):
    """Normalized reactions understood by at least one supported platform."""

    LIKE = "like"
    UP = "up"
    DOWN = "down"
    REMOVE = "remove"


class Capability(BaseModel):
    """One platform operation and its relevant restrictions."""

    model_config = ConfigDict(extra="forbid")

    operation: str
    supported: bool
    write: bool = False
    authentication: str
    access: AccessMode
    automation_allowed: bool = False
    approval_required: bool = False
    reliably_confirmed: bool = True
    max_items_per_call: int | None = Field(default=None, ge=1)
    max_writes_per_confirmation: int | None = Field(default=None, ge=1)
    restrictions: list[str] = Field(default_factory=list)


class AccountRef(BaseModel):
    """The account identity associated with an entity or action."""

    platform: Platform
    native_id: str | None = None
    handle: str | None = None


class Post(BaseModel):
    """A normalized social post."""

    platform: Platform
    native_id: str
    canonical_url: str
    account: AccountRef
    author_name: str | None = None
    text: str
    created_at: datetime | None = None
    engagement: dict[str, int | None] = Field(default_factory=dict)
    provider_metadata: dict[str, Any] = Field(default_factory=dict)


class Profile(BaseModel):
    """A normalized social profile."""

    platform: Platform
    native_id: str
    canonical_url: str
    account: AccountRef
    display_name: str | None = None
    bio: str | None = None
    provider_metadata: dict[str, Any] = Field(default_factory=dict)


class DraftVariant(BaseModel):
    """One final platform-specific version of a source message."""

    platform: Platform
    account: str
    text: str = Field(min_length=1, max_length=25_000)
    target: str | None = Field(default=None, max_length=2_048)
    title: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_platform_fields(self) -> DraftVariant:
        if self.platform is Platform.REDDIT:
            if not (self.target and self.target.strip() and self.title and self.title.strip()):
                raise ValueError("Reddit drafts require a target community and title")
        elif self.target is not None or self.title is not None:
            raise ValueError("Only Reddit post drafts accept a target or title")
        return self


class Draft(BaseModel):
    """One source message and all selected platform variants."""

    draft_id: str
    message: str = Field(min_length=1, max_length=25_000)
    variants: list[DraftVariant] = Field(min_length=1)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class ThreadNode(BaseModel):
    """One post or comment in a discussion tree."""

    post: Post
    parent_native_id: str | None = None
    children: list[ThreadNode] = Field(default_factory=list)


class ReadResult(BaseModel):
    """A normalized read with an explicit completeness claim."""

    completeness: Completeness
    reason: str | None = None
    cursor: str | None = None
    items: list[Post] = Field(default_factory=list)
    profiles: list[Profile] = Field(default_factory=list)
    thread: list[ThreadNode] = Field(default_factory=list)


class ActionRequest(BaseModel):
    """A requested write before platform rendering."""

    platform: Platform
    action: ActionName
    account: str = Field(min_length=1, max_length=100)
    target: str | None = Field(default=None, max_length=2_048)
    text: str | None = Field(default=None, max_length=25_000)
    reaction: ReactionName | None = None
    title: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_action_fields(self) -> ActionRequest:
        text_actions = {
            ActionName.CREATE_POST,
            ActionName.REPLY,
            ActionName.COMMENT,
            ActionName.SEND_MESSAGE,
        }
        optional_text_actions = {ActionName.RESHARE, ActionName.CONNECT}
        target_actions = {
            ActionName.REPLY,
            ActionName.COMMENT,
            ActionName.REACT,
            ActionName.RESHARE,
            ActionName.DELETE_POST,
            ActionName.FOLLOW,
            ActionName.CONNECT,
            ActionName.SEND_MESSAGE,
        }
        if self.action in text_actions and not (self.text and self.text.strip()):
            raise ValueError(f"{self.action.value} requires text")
        if self.text is not None and not self.text.strip():
            raise ValueError(f"{self.action.value} text cannot be blank")
        if self.action in target_actions and not (self.target and self.target.strip()):
            raise ValueError(f"{self.action.value} requires a target")
        if self.action is ActionName.REACT and self.reaction is None:
            raise ValueError("react requires a reaction")
        if self.text is not None and self.action not in text_actions | optional_text_actions:
            raise ValueError(f"{self.action.value} does not accept text")
        if self.reaction is not None and self.action not in {
            ActionName.REACT,
            ActionName.RESHARE,
        }:
            raise ValueError(f"{self.action.value} does not accept a reaction")
        if self.title is not None and self.action is not ActionName.CREATE_POST:
            raise ValueError(f"{self.action.value} does not accept a title")
        return self


class RenderedAction(BaseModel):
    """The exact provider-specific action shown in a preview."""

    request: ActionRequest
    rendered_text: str | None = None
    expected_side_effects: list[str] = Field(default_factory=list)


class ActionPreview(BaseModel):
    """A short-lived, non-writing action preview."""

    operation_id: str
    preview_token: str
    input_hash: str
    expires_at: datetime
    action: RenderedAction
    policy: str = "explicit_confirmation_only"
    remaining_writes: int = Field(default=1, ge=1, le=1)


class ActionResult(BaseModel):
    """The observed outcome of a confirmed write."""

    operation_id: str
    platform: Platform
    action: ActionName
    status: str
    confirmed: bool
    retry_safe: bool
    native_id: str | None = None
    canonical_url: str | None = None
    detail: str | None = None
    completed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
