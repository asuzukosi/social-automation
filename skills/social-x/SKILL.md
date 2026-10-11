---
name: social-x
description: Research, publish, and engage on X through the unified social MCP using X-native identifiers and session authentication.
---

# X through social

Use only the unified `social_*` tools. X reads and writes use the retained HTTP
client internally and a user session cookie, never an X developer API key.

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

Do not bulk follow, message, react, reshare, or reply. Review candidates in a
bounded read, then execute one approved target at a time. Stop immediately on
rate limits, spam warnings, authentication changes, or account restrictions.
These safeguards reduce risk but cannot guarantee that X will not restrict an
account.
