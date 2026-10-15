---
name: social-engage
description: Prepare and safely execute replies, comments, reactions, follows, connections, reshares, or messages through the unified social MCP.
---

# Engage on social platforms

Read the target post or discussion before drafting. Check
`social_capabilities`; unsupported operations stay unsupported and must not be
approximated by a different action.

Before researching a person, verify that the account belongs to the intended
contact and check the available contact record for `Do not contact` or `Not a
fit`. Do not engage when either applies. If the contact system has an
engagement lock, claim the contact before research, keep the claim through all
approved actions, and release it when the work is abandoned without an action.

Read the full source post, its surrounding thread, and useful replies before
drafting. Choose posts where there is something relevant to add. Do not use
adjacent, weak, or unrelated posts to meet an activity target. Research and
copy review may cover up to ten contacts at once, but writes remain individual.

State the account, platform, target, exact content, and expected side effects.
Call `social_preview_action` and show the returned preview. Only call
`social_confirm_action` after the user explicitly approves that exact preview.
Show the preview's policy and remaining-write budget with the exact action.
Write capabilities report `automation_allowed: false` and permit one write per
confirmation; do not reinterpret those limits as a batch allowance.

Treat direct messages, connection requests, follows, deletes, and replies to
individuals as high risk. Never infer approval from an earlier read request or
from approval of a different platform variant. Never retry an uncertain write.
Approval of public engagement never approves a direct message. Show the exact
message and get separate approval; any edit after approval requires a new
preview and confirmation.

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

## Writing to people

Use one short thought that adds a concrete observation, implication, joke, or
specific question. Do not summarise the source, lead with generic praise, or
turn every reply into a question. Match the person's language, energy, and
technical detail without forcing slang or familiarity. Preserve copy supplied
by the user unchanged. For a non-English reply, show its English meaning and
the exact reply before previewing the action.

Write outreach in Kosi's voice: use plain words, name the person's work early,
and keep the reason to talk light and specific. Avoid polished agent phrases,
formal scene-setting, mini-essays, and generic requests for someone's thoughts.
Record routine likes, reshares, or replies only when asked. Otherwise, update
the contact record only for a substantive reply, conversation, meeting, or
commitment.
