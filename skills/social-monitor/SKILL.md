---
name: social-monitor
description: Run bounded read-only social checks and report meaningful changes without enabling engagement or writes implicitly.
---

# Monitor social activity

Define the platforms, query or native targets, cadence, result limit, expiry,
and what counts as a meaningful change. Check capabilities, then use
`social_search` or `social_get_thread`. Store native IDs and cursors in the
host task so repeated checks can distinguish new items from old ones and
report where a bounded result stopped. Use
`social_get_feed` only when the user names the home or community feed to watch.
Proceed only when the read capability reports `automation_allowed: true`, and
never request more than its `max_items_per_call` value.

Report completeness and platform failures independently. Stay quiet when
nothing meaningful changed unless the user requested periodic status.

Platform queues are independent. LinkedIn runs one browser operation at a
time, so do not overlap LinkedIn checks; let later checks wait in its queue.
An active LinkedIn check does not prevent X or Reddit checks from proceeding.

Request 10 results per platform first and never more than 25 in one check.
Resume X and Reddit feeds only by passing the returned cursor back with the same
feed selector. Deduplicate stored native IDs between bounded checks. LinkedIn
feeds do not expose a stable continuation cursor. Do not overlap checks or poll
faster than every 15 minutes unless the user explicitly asks and the platform
capability supports it. Stop on rate limits, checkpoints, authentication changes,
or risk warnings; do not retry immediately.

The MCP workflow scheduler is not available yet. Until it is, use only the
host's explicit recurring-task mechanism for read checks. Do not call preview
or confirmation tools and never turn a monitoring request into engagement.
These are conservative project limits, not a promise that an account cannot
be restricted.
