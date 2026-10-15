---
name: social-reddit
description: Read Reddit discussions and perform approved Reddit actions through public reads and a dedicated visible browser profile.
---

# Reddit through social

Reddit reads use public JSON or RSS first. When Reddit blocks anonymous JSON,
reads fall back to the dedicated visible browser profile and its first-party
session. Writes use that same profile, never OAuth client credentials or an API
key. Check `social_authentication_status` without opening the browser. Ask the
user to sign in when it reports Reddit as unauthenticated. When login is needed,
call `social_authenticate` for Reddit. Force a fresh login only at the user's
request or after Reddit rejects the saved session.

For a new post, target the subreddit name and include `title`. For top-level
comments, votes, and deletes, use a Reddit canonical URL or native `t3_`
identifier. For a nested reply, use `reply` with the exact Reddit comment
permalink; the browser refuses a post URL because it cannot identify the parent
comment from that target. Preserve subreddit, fullname, nesting, `more`
placeholders, and completeness in read results. Resume a community feed by
passing its returned cursor back to `social_get_feed` with the same community.

Preview every write and obtain explicit confirmation. Browser writes without
a stable response ID may return `outcome_unknown`; never retry them blindly.

Apply `social-engage` before replying to or messaging a person. Read the full
available discussion and community rules, respond to the actual point, and do
not use generic praise or repeat what the author said. Approval of a vote or
public comment never approves a direct message; show and confirm the exact
message separately.

Work in one community and on one approved target at a time. Do not mass-read
communities, cross-post the same content, or rapidly submit comments, votes, or
messages. Follow each community's rules and stop when Reddit presents login,
verification, suspension, rate-limit, or other account-attention UI. These
guardrails reduce risk but cannot guarantee that Reddit will not restrict an
account.
