---
name: social-publish
description: Adapt one approved message for X, Reddit, and LinkedIn, preview each final platform version, and publish only after explicit confirmation.
---

# Publish across social platforms

Start with one source message, intended audience, selected platforms, links,
account labels, and any Reddit community. Produce a separate final
variant for every platform; do not send identical text blindly.
The current MCP publishing contract is text-only; if media is requested,
report that limitation instead of implying the attachment will be published.

Check `social_capabilities` before promising an operation. Account for X's
short format, Reddit's required community and `title`, and LinkedIn's
professional context. Present every final variant and target to the user.

Call `social_preview_action` once for each final platform variant. A preview is
not approval. Show every rendered text, target, side effect, expiry, operation
ID, policy, and remaining-write budget, then obtain explicit user confirmation
before calling `social_confirm_action` for each approved variant.
Confirmation is per platform; the set is not atomic.
Respect `max_writes_per_confirmation`; publishing is never an autonomous
capability even when several variants were reviewed together.

Publish at most one post per selected platform in a run. Confirm and execute
platforms serially so a restriction, warning, or unexpected result stops the
remaining writes. Do not rapidly repost failed content or use this workflow as
a scheduler for repeated posts.

Never retry `outcome_unknown` or any result with `retry_safe: false`. Use
`social_list_actions` to reconcile what the system observed.
