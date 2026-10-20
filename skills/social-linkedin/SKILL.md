---
name: social-linkedin
description: Read, publish, connect, react, and message on LinkedIn through the unified social MCP and its dedicated visible browser.
---

# LinkedIn through social

Use the dedicated visible browser profile and only the unified `social_*`
tools. LinkedIn browser automation carries account-restriction risk; safeguards
do not make it risk-free or guarantee platform compliance.
Check `social_authentication_status` first. Call `social_authenticate` for
LinkedIn when no saved session is available. Force a fresh login only at the
user's request or after LinkedIn rejects the saved session.

LinkedIn has one dedicated queue and runs one read or write at a time through
one authenticated browser page. Do not launch overlapping LinkedIn calls or
try to parallelize them with multiple pages in the same profile; allow later
calls to wait in the queue. This queue is separate from X and Reddit, which may
continue concurrently while LinkedIn is busy.

Check capabilities first. Search, post creation, comments, default reactions,
connections, and messages are available. Single-post reads are bounded and
partial; full discussion reads and nested reply writes remain unsupported. Use
canonical LinkedIn post URLs for comment and reaction targets and usernames for
connection or message targets.
`social_get_profile` accepts person identifiers and canonical `/company/` URLs;
use the URL form when reading a company page.

Preview every write. Confirm only after the user approves the exact account,
target, and text. Stop on checkpoints, CAPTCHA, restrictions, or uncertain
state, and never retry an uncertain browser write.

Apply `social-engage` before commenting, reacting, connecting, or messaging.
Verify that the profile belongs to the intended contact, honour contact
exclusions and locks, read the full available context, and add one useful
thought instead of generic praise or a summary. Public-action approval never
approves a connection note or message; show and confirm its exact text
separately.

Do not scrape people or search pages in bulk. Review a bounded set of
candidates, then handle connections, messages, comments, and reactions one at
a time with fresh approval for each target. Leave the browser visible and stop
after any warning or unexpected redirect. These safeguards reduce risk but
cannot guarantee that LinkedIn will not restrict an account.
