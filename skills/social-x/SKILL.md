---
name: social-x
description: Research, publish, and engage on X through the unified social MCP using X-native identifiers and session authentication.
---

# X through social

Use only the unified `social_*` tools. X reads and writes use the retained HTTP
client internally and a user session cookie, never an X developer API key.
Check `social_authentication_status` first. If X is unauthenticated, call
`social_authenticate` and let the user complete the visible login. Use forced
authentication only when the user requests a fresh session or the existing
session is rejected.

Use tweet IDs for reply, reaction, reshare, and delete targets; use usernames
for follow and direct-message targets. Check `social_capabilities` before the
action. `social_get_feed` accepts `home`, `following`, `list:<id>`, an X list
URL, or a named account handle. Home and list feeds require the signed-in X
session and remain bounded. Preserve canonical `https://x.com/.../status/...`
URLs and report feed or thread cursors and partial results. To continue a feed,
pass its returned cursor back to `social_get_feed` with the same selector.

All writes follow preview then explicit confirmation. X's web interfaces may
change, so never treat an empty result as proof that nothing exists and never
retry an uncertain write.

Apply `social-engage` to every reply, reaction, reshare, follow, or message. For
outreach sourced from the Search infrastructure for agentic commerce project,
use the Notion contact list as the source of truth. Use the X handle as the
identity key. Check `Kosi's engagement` before profile research, skip contacts
already checked, and check the selected contacts immediately so another agent
does not take them. Do not use `Status`, `Last contact`, or `Next action` to
infer completed X outreach. Release a check only when work ends before any
action. Never act on a contact marked `Do not contact` or `Not a fit`.

Research ten contacts in parallel and present one compact review containing
the full source post and exact proposed reply for each useful candidate. This
batch is for selection and copy approval only. The MCP still requires one
preview and confirmation per write, and execution stays serial. Continue
researching other contacts when one account has no useful accessible post or
its messages are closed.

Aim for three meaningful engagements per contact when three relevant posts or
conversations exist. One engagement is the like, reshare, and reply on one
post; those actions are not three separate engagements. Read the full post,
thread, and replies. Like one to three replies only when they add context, ask
a strong question, or move the discussion forward. Those likes do not count
towards the three engagements. Never manufacture activity to reach the target.

Replies should usually be one sentence or fragment, 3-14 words and no more
than 20. Add one thought instead of restating the post. Use a question only
when its answer would teach us something specific about the product, user
behaviour, or commerce infrastructure. Across a ten-contact review, normally
use no more than three question replies. Avoid generic praise and phrases such
as "great insight", "this is fascinating", "what stands out", "the key here",
"game changer", "this really resonates", or "would love to pick your brain".

After the public engagement, follow if needed. When messages are available,
describe the work as "commerce search infra for personal agents" and do not
suggest that the contact has purchase intent. Open with the person's product or
work, say only what matters about what Kosi is building, and end with a light,
specific reason to talk. Keep each message distinct. Casual openers are fine
only when they fit the person's tone and the familiarity already established.
Show the complete message and get separate approval before previewing it. If
the account has no accessible posts, follow it and stop unless the user later
approves a message.

Do not bulk follow, message, react, reshare, or reply. Review candidates in a
bounded read, then execute one approved target at a time. Stop immediately on
rate limits, spam warnings, authentication changes, or account restrictions.
These safeguards reduce risk but cannot guarantee that X will not restrict an
account.
