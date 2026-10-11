# XActions audit: competitive gaps and repo health (2026-08-27)

Scope: the whole repo at `e6dada7` (v3.5.0) plus a survey of 24 comparable open-source projects. Nothing was removed. Items marked **shipped** landed in the same change set as this document; everything else is the backlog, ordered by impact.

## 1. Where XActions already wins

No other project combines these:

- 145 MCP tools plus an A2A server, persona engine, workflow engine, plugin system and an x402 paid API. Nearest rivals: x-use (33 tools, browser-native) and the official xmcp (140 tools, API key and metered).
- An AI voice agent that joins and speaks in Spaces. Competitors at most capture audio.
- 93 browser console scripts and an MV3 extension: a zero-install path nobody else offers.
- Normalised scrapers for Bluesky, Mastodon and Threads, plus the Python twin (`python/xeepy`).
- Guest-token public reads with no Chromium, chunked media upload with alt text, DM inbox and send, scheduled posts, `--json` everywhere, tab completion, `doctor`, a docs link gate, issue templates, CITATION.cff, llms.txt.

## 2. Competitor landscape

| Repo | Stars | What to learn from it |
|---|---|---|
| Panniantong/agent-reach | 75.7k | One `install` wires free X/Reddit/YouTube reads into Claude Code, Cursor, Codex |
| gitroomhq/postiz-app | 35.2k | Public API, Node SDK, media library, templates, n8n and Zapier lanes |
| mikf/gallery-dl | 19.3k | `--cookies-from-browser`, avatars/banners/likes/lists/communities download, dedup archive DB |
| zedeus/nitter | 13.6k | Archived 2026-08-26 after an X cease-and-desist. Category risk; warn users to use a dedicated account |
| d60/twikit | 4.6k | Broadest write surface: communities, group DMs, DM reactions, polls, bookmark folders, live_pipeline WebSocket, CAPTCHA unlock |
| vladkens/twscrape | 2.7k | Account pool with SQLite sessions and auto rotation on rate limit, JSONL output |
| public-clis/twitter-cli | 2.9k | Browser cookie extraction, curl_cffi TLS impersonation, `--compact`, SKILL.md with output schema |
| trevorhobenshield/twitter-api-client | 1.9k | Spaces HLS audio capture and live transcript, email verification solver |
| Altimis/Scweet | 1.6k | Resume from cursor, "last verified on DATE" banner |
| xdevplatform/xurl | 1.3k | OAuth2 PKCE official lane, chunked media, `xurl mcp` bridge |
| Rishikant181/Rettiwt-API | 888 | Typed models, response middleware, error-handler interface, Jobs, cursor resume |
| xdevplatform/xmcp | 853 | Tool allowlist, Streamable HTTP at `/mcp`, tools generated from an OpenAPI spec |
| mahrtayyab/tweety | 672 | Grok via web session, notifications timeline, docs site |
| the-convocation/twitter-scraper | 640 | Edge/Workers build, AsyncGenerator API, Conventional Commits |
| ihuzaifashoukat/x-use | 158 | Draft-approval gate on every write, per-account daily caps that survive restarts, 599 offline tests, `x-use init` installs skills |
| steipete/bird | n/a | Reads cookies from Safari/Chrome/Firefox, auto-refreshes GraphQL query IDs |
| alkihis/twitter-archive-reader | 61 | Parses the official GDPR archive zip |
| Xquik-dev/x-twitter-scraper | 189 | OpenAPI with 128 ops, 8 generated SDKs, signed webhooks, free cost estimates |

## 3. Gap list

### A. Scraper and data coverage
1. GraphQL operation coverage is thin (about 30 ops in `src/scrapers/twitter/http/endpoints.js`). Missing: Communities (search, tweets, members, join/leave), Highlights, VerifiedFollowers, FollowersYouKnow, Notifications timeline, Trends by WOEID, Community Notes, Articles, Jobs, Space by id.
2. No live WebSocket stream (`/1.1/live_pipeline`); `src/streaming/` polls.
3. No Spaces audio capture or transcript download (no m3u8 handling anywhere).
4. **shipped** Twitter archive (GDPR zip) import into `src/portability/`.
5. No account pool with lock-and-rotate on `x-rate-limit-remaining: 0`; `ProxyManager` and `multiAccount.js` exist but do not cooperate.
6. No persisted resume checkpoint for long scrapes (`paginationEngine.js` has cursors in memory only).
7. Media downloader below gallery-dl: no avatars/banners, no dedup archive, no filename templates, no bulk from likes/lists/bookmarks.
8. No TLS fingerprint impersonation option (`cycletls` / `node-tls-client`).
9. No fetch-only edge build for Cloudflare Workers.

### B. Automation and actions
1. **shipped** Draft-approval gate for MCP writes (`XACTIONS_MCP_REQUIRE_APPROVAL`, `x_list_drafts`, `x_approve_draft`, `x_discard_draft`).
2. Per-account daily caps and a durable action queue that survive restarts (`quotaSupervisor.js` is in-process only).
3. Group DMs, DM reactions, DM media, DM search over HTTP (only DOM scripts today).
4. Poll voting, tweet edit, list banner edit, list mute, list subscribers over HTTP.
5. CAPTCHA unlock and email-code solver for locked accounts.
6. Content calendar parity with Postiz/Mixpost: media library, template variables, hashtag groups, per-network versions.
7. Optional official-API write lane (OAuth2 PKCE) so users survive cookie breakage.
8. Long-form Articles publish/read as Markdown over HTTP.

### C. Agent, MCP and AI
1. **shipped** `xactions skills list|install|uninstall|show` for Claude Code, Cursor, Codex and Windsurf.
2. **shipped** Tool allowlist and groups (`XACTIONS_MCP_TOOLS`, `XACTIONS_MCP_EXCLUDE`, `--tools`).
3. **shipped** Streamable HTTP transport (`xactions-mcp --http`).
4. mcp-eval style harness and more offline tool-parsing tests.
5. Grok via web session exposed as an HTTP client method and MCP tool.
6. Reddit, YouTube and Hacker News adapters so XActions is the single "eyes for agents" package.
7. **shipped** `--compact` and `--fields` CLI output for token-efficient agent use.

### D. DX, SDK, docs and structure
1. **shipped** Cookie import from `cookies.txt`, Cookie-Editor JSON, Playwright storageState, header strings, and installed browsers.
2. **shipped** GraphQL query-ID auto-discovery from x.com bundles with a local cache and retry-once on stale id.
3. Typed SDK: `types/index.d.ts` declares 88 names, 28 runtime exports have no type and about 50 declared names do not exist at runtime; subpath exports have no `types` condition. Generate from JSDoc or add a diff test.
4. OpenAPI spec for the REST and x402 API, then generated clients.
5. n8n exists; Zapier, Make and Pipedream do not.
6. Outbound webhooks are unsigned and not replayable.
7. Cost and size estimates before paid bulk jobs.
8. Distribution beyond npm and Docker: Homebrew tap, `pipx` for xeepy, release binaries.
9. Docs site with search and versioning for the JS package (the Python side has mkdocs; the JS side renders markdown to 168 static HTML pages by hand).
10. JSONL and Parquet output for large exports.
11. Conventional Commits and changelog automation; **shipped** ESLint flat config and `npm run lint`.
12. Root clutter: about 50 root entries including five hosting configs, `humans.txt`, `metadata.json` (dead ChatGPT plugin manifest), `GEMINI.md` (tracked while gitignored). **shipped** `AUDIT_REPORT.md` moved under `docs/audits/`. Deploy configs should move under `deploy/<platform>/` in a later change.
13. A "last verified against x.com on DATE" badge produced by CI.

### E. Community and growth
1. List on skills registries (LobeHub, Tessl, the Claude Code marketplace) in addition to Smithery, the MCP Registry and glama.
2. A Discord or Matrix community; today only GitHub Discussions.
3. **shipped** README comparison table now names the projects people actually search for in 2026 (twikit, twscrape, x-use, xmcp, bird, twitter-cli, agent-reach).
4. An Apify actor or hosted no-code lane next to xactions.app.
5. A listed plugin ecosystem (`xactions-plugin-*`); only excel and google-sheets exist in-tree.
6. A security posture section: cookie storage permissions, no telemetry, threat model.
7. A visible "dedicated account, not your main" warning now that Nitter is gone.

## 4. Repo health findings

### Fixed in this change set
- `api/config/x402-config.js` and `.env.example` shipped a real wallet address as the fallback payee. Removed; the server now fails fast when `X402_PAY_TO_ADDRESS` is unset.
- `api/server.js` had no `unhandledRejection` / `uncaughtException` handlers.
- `dashboard-server.js` was CommonJS inside an ESM package and crashed on `node dashboard-server.js`, which is what `docs/dashboard.md` told users to run.
- Registry drift: `.claude-plugin/plugin.json` said 87 tools at 3.1.0, `marketplace.json` said 68 at 3.0.42, README said 140+, `server.json` said 145. `scripts/sync-registry.mjs --check` now derives every count and version from the source and runs inside `npm run docs:check`; `smithery.yaml` exists to back the Smithery badge.
- Stale numbers in CONTRIBUTING.md, docs/README.md, README.md and llms.txt (tests, skills, routes, scripts, tools); two corrupted emoji headings in README; the Firefox extension promise.
- `ioredis` was imported but undeclared while `redis` was declared and unused; the five optional scraper adapters are now declared as optional peers so `doctor` and `npm ls` can see them.
- `engines.node` said `>=18` while CI and the Dockerfile test 20.
- Vitest forks crashed under load ("Worker exited unexpectedly"); the pool is now capped.
- No Dependabot, no ESLint. Both added.
- Seventeen directories had no README.
- `x_list_platforms` was declared in the MCP tool table with no handler.

### Found and fixed by the new API contract test

`tests/api/contract.test.js` boots the real Express app and walks every path in `api/openapi.js`. It found four drifts on its first run, all now fixed:

- **Twenty handlers under `api/routes/ai/` imported `getJobStatus` from `api/services/jobQueue.js`, which never exported it.** Every one threw `getJobStatus is not a function` on the first status poll, so no long-running AI operation could be polled at all. `getJob` is the function they meant and is now exported under both names.
- **`/api/workflows`, `/api/streams`, `/api/schedule` and `/api/notifications` answered unauthenticated** while their siblings `/api/crm` and `/api/automations` require a token. The repo ships Railway, Fly, Render and Docker configs, so a public deployment let anyone list and trigger the owner's automations. All four now use the same `authMiddleware`.
- **`GET /api/twitter/status`, `GET /api/admin/stats` and `GET /api/notifications` were documented in the spec and never implemented.** All three now serve real state: session presence, instance and payment stats, and configured channels plus recent signed webhook deliveries.
- **`api/routes/ai.js` and `api/routes/x402-discovery.js` are dead files.** `routes/ai/index.js` superseded the first; `server.js` serves `/openapi.json` and `/.well-known/x402` inline, superseding the second. Both are left in place per the no-removals rule, and the contract test records them as deliberately superseded so a genuinely orphaned module still fails the build. Deleting them is a one-line change whenever the owner wants it.

The walk runs 300+ requests eight at a time with a per-request deadline, so the whole contract suite finishes in about seven seconds.

### Still open
- Browser scripts live twice: `src/*.js` (131) and `scripts/*.js` (139) share 78 basenames and every sampled pair has diverged; `archive/` holds a third generation. Pick `browser-scripts/` as the single home, keep `scripts/` for tooling, keep `src/` for the library. This is a move, not a deletion, but it touches docs and the dashboard generator, so it is its own change.
- `dashboard/docs`, `dashboard/scripts` and `dashboard/blog` (665 generated files) are committed, and `deploy-cloudflare.yml` deploys them without running `site:build`. Build in the workflow and gitignore the output.
- `python/` (735 files) and `xspace-agents/` (988 files) are full vendored sibling repos while the root already depends on the published `xspace-agent` package. Submodules or removal.
- `scripts/gen3.js`, `scripts/generate-seo-articles*.js` (6,642 lines) import about 30 packages that are not installed and cannot run.
- `docs/` mixes user docs with internal strategy (`GROWTH_STRATEGY.md`, `seo/`, `launch/`, `pr-reviews/`, `research/`) and has near-duplicate pairs (agents x3, scheduler x2, scraping x4, streaming x2, graph x3, extension x3).
- README is 1,401 lines with the table of contents at line 145, two comparison sections, and a "Live HTTP Deployment" section documenting a third-party host.
- `src/mcp/server.js` is 4,152 lines with the tool table and three dispatch paths in one file; split into `src/mcp/tools/<domain>.js`.
- Tests: 0 for `api/` (198 handlers, supertest installed and unused), none for streaming, workflows, plugins, graph, analytics, notifications, spaces, the non-Twitter scrapers, the extension, or the dashboard JS. `ci.yml` starts Postgres and Redis that no test uses.
- Only one git tag (`v3.1.0`) while npm is at 3.5.0, so `release.yml` and `docker-publish.yml` have never produced a semver release.
- `public/demo.mp4` (23 MB) and `dashboard/data/tweet-price/` (33 MB of JSON) are in git history.
- Tracked-but-ignored `GEMINI.md`; four agent-instruction files restating the same table.
