# Social Automation

One local MCP server named `social` for X, Reddit, and LinkedIn.

The server, policy layer, Reddit adapter, and LinkedIn adapter are Python. X
temporarily uses one self-contained Node worker; replacing that worker is the
remaining single-language migration. Its only purpose is to retain the tested
X HTTP client while the Python adapters stabilize. Replace it with a Python X
HTTP client, then delete the worker and Node requirement once the same read,
cursor, and confirmed-write contract passes the adapter suite. Reddit uses public JSON endpoints for
reads and a visible browser for writes. LinkedIn uses the pinned
`mcp-server-linkedin` Python package internally without exposing its MCP tools.

Current write support:

- X: posts, replies, reactions, reshares, deletes, follows, and direct messages.
- Reddit: posts, top-level comments, nested replies, votes, deletes, and
  subreddit follows through a dedicated visible browser profile.
- LinkedIn: posts, comments, reactions, connections, and direct messages.

The current publishing contract is text-only. Media attachments are not
exposed until their platform limits and confirmation behavior are tested.

Nested replies are supported on X and Reddit. Reddit requires an exact comment
permalink so the visible browser can bind the editor to that comment. LinkedIn
reports nested replies as unsupported until correct comment targeting is tested.

Current read boundaries:

- X supports search, signed-in home/following feeds, accessible lists,
  named-account feeds, profiles, posts, and threads.
- Reddit supports bounded search, community feeds, profiles, posts, and
  comment trees, including `more` expansion where Reddit returns it.
- LinkedIn supports bounded search, home feed, person/company profiles, and single-post
  capture. Single-post results are partial and nested discussion trees remain
  unsupported.

`social_get_feed` accepts an optional cursor. Pass the returned cursor back to
resume X home, following, list, or account feeds and Reddit community feeds.
LinkedIn explicitly blocks cursor resume because its visible feed does not
provide a stable continuation token.

LinkedIn publishing is deliberately conservative. If the visible UI accepts a
submission but does not expose a stable server identifier, the result is
`outcome_unknown` and `retry_safe: false`; the server will not risk a duplicate.

```bash
uv sync --group dev
uv run social
```

See [SETUP.md](SETUP.md) for the complete agent and account connection guide.

Node 22 or newer is required only for the bundled X worker. No npm install is
needed.

Codex configuration:

```json
{
  "mcpServers": {
    "social": {
      "command": "uv",
      "args": ["run", "--project", "/absolute/path/to/social-automation", "social"]
    }
  }
}
```

No integration requires a developer API key or registered API application.
Call `social_authenticate` with `x`, `reddit`, or `linkedin` to open that
platform's visible login window. Pass `force=true` to discard that platform's
existing local session first. Call `social_logout` to clear one saved session.
Passwords, cookies, and verification codes never cross the MCP interface.
Call `social_authentication_status` to see which platforms have a saved login.
It reads local session state without opening a browser or making a network
request. `false` means login is needed; `null` means the local state could not
be inspected.

X stores its browser profile and worker session under `~/.social-automation/x`.
Reddit uses `~/.social-automation/reddit-profile`; public JSON and RSS reads can
still work without login. LinkedIn uses the installed package's profile under
`~/.linkedin-mcp`. The legacy `X_COOKIES` environment variable remains
supported when interactive login is not desired. If it is configured by the
MCP host, `social_logout` clears it only for the running server; remove the host
configuration to keep X logged out after a restart.

Set `SOCIAL_BROWSER_CHANNEL` only when Chrome is exposed under a different
Patchright channel name. It is browser configuration, not a credential.
`social_status` reports adapter availability. Use
`social_authentication_status` for the passive login inventory.

Install the repository's Codex skills:

```bash
mkdir -p ~/.codex/skills && cp -R skills/* ~/.codex/skills/
```

The shared research, discussion, publishing, engagement, and monitoring skills
are complemented by focused X, Reddit, and LinkedIn skills. They use only the
unified `social_*` MCP tools; upstream provider tools remain internal.

Copied upstream repositories are not part of the runtime. The X worker contains
only the required XActions 3.5.0 HTTP modules; its provenance and licensing are
retained under `third_party/xactions`. The installed LinkedIn package carries
its own license and notice files.

Every platform variant is passed directly to `social_preview_action`, then to
`social_confirm_action` after approval. Drafts stay in the active conversation
instead of being copied into SQLite. A failed or uncertain write is never
automatically retried.

The server is deliberately unsuitable for mass scraping or bot campaigns.
Search and feed reads return at most 25 items, thread reads at most 200, and
only one external write can run at a time across all platforms. There is no
bulk-write tool. The skills batch candidate review but require a separate
preview and confirmation for every write, and tell the agent to stop on rate
limits, checkpoints, CAPTCHA, spam warnings, or unexpected redirects.

Run one `social` server instance per local account profile. Write serialization
is process-local; starting multiple server processes against the same browser
profiles would bypass that protection.

These controls reduce avoidable account risk; no browser or unofficial HTTP
automation can guarantee that a platform will never restrict an account.
