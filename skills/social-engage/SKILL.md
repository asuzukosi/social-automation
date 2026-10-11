---
name: social-engage
description: Prepare and safely execute replies, comments, reactions, follows, connections, reshares, or messages through the unified social MCP.
---

# Engage on social platforms

Read the target post or discussion before drafting. Check
`social_capabilities`; unsupported operations stay unsupported and must not be
approximated by a different action.

State the account, platform, target, exact content, and expected side effects.
Call `social_preview_action` and show the returned preview. Only call
`social_confirm_action` after the user explicitly approves that exact preview.
Show the preview's policy and remaining-write budget with the exact action.
Write capabilities report `automation_allowed: false` and permit one write per
confirmation; do not reinterpret those limits as a batch allowance.

Treat direct messages, connection requests, follows, deletes, and replies to
individuals as high risk. Never infer approval from an earlier read request or
from approval of a different platform variant. Never retry an uncertain write.

Batch only the review of possible targets. Never automatically act on every
search result, follower, or community member. Execute one target per preview
and confirmation. For direct messages, connections, follows, and individual
replies, obtain fresh approval for each target and stop after each result so
the user can assess it. For reactions or comments, a user may review a small
set together, but each write still needs its own confirmation and runs
serially. Stop the session on any rate limit, checkpoint, CAPTCHA, spam
warning, authentication change, or uncertain outcome.

These are conservative project guardrails, not a guarantee against account
restrictions. Do not describe any volume or timing pattern as platform-safe.
