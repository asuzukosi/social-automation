# Account Portability — Export, Migrate & Diff

> Export your full X/Twitter account, migrate to Bluesky/Mastodon, and track changes over time — no API fees.

## Overview

XActions Portability is a complete data ownership toolkit:

- **Export** — Download your entire account (profile, tweets, followers, following, bookmarks, likes) in JSON, CSV, and Markdown
- **Archive Viewer** — Self-contained offline HTML file to browse your data with search, pagination, and dark theme
- **Migrate** — Move your social graph to Bluesky (AT Protocol) or Mastodon (ActivityPub) with user matching
- **Diff** — Compare two exports to see what changed: new followers, lost followers, deleted tweets, engagement shifts

Available via: **CLI**, **API**, **MCP tools** (for AI agents).

---

## Quick Start

### Export your account (CLI)

```bash
# Full export — all data, all formats
unfollowx export @yourname --auth-token YOUR_TOKEN

# Export only tweets and followers in JSON
unfollowx export @yourname --only tweets,followers --formats json --auth-token YOUR_TOKEN

# Limit to 100 items per category
unfollowx export @yourname --limit 100 --auth-token YOUR_TOKEN
```

### Migrate to another platform (CLI)

```bash
# Dry-run migration to Bluesky (shows what would happen)
unfollowx migrate @yourname --platform bluesky --dry-run --auth-token YOUR_TOKEN

# Migrate to Mastodon
unfollowx migrate @yourname --platform mastodon \
  --instance mastodon.social --mastodon-token YOUR_MASTODON_TOKEN \
  --auth-token YOUR_TOKEN
```

### Compare two exports (CLI)

```bash
# Diff two export directories
unfollowx diff exports/user_jan2026 exports/user_feb2026

# Generates a Markdown report showing gained/lost followers, new/deleted tweets, etc.
```

---

## Architecture

```
src/portability/
├── exporter.js        → Full account export orchestrator with checkpoint resume
├── archive-viewer.js  → Self-contained HTML archive generator
├── importer.js        → Bluesky & Mastodon migration (user matching via Dice coefficient)
├── twitter-archive.js → Official X data export (zip or folder) importer, summary, export bridge
├── differ.js          → Export comparison engine (followers, tweets, engagement)
└── index.js           → Barrel re-exports

api/routes/portability.js  → REST API endpoints
```

### Export Flow

```
exportAccount({ username, formats, only, limit })
   ├── Phase 1: Scrape profile
   ├── Phase 2: Scrape tweets
   ├── Phase 3: Scrape followers
   ├── Phase 4: Scrape following
   ├── Phase 5: Scrape bookmarks
   └── Phase 6: Scrape likes
         ↓
   Write JSON / CSV / Markdown to exports/<username>_<date>/
         ↓
   Generate archive.html (self-contained offline viewer)
         ↓
   Checkpoint saved after each phase (resume on failure)
```

### Diff Flow

```
diffExports(dirA, dirB)
   ├── Compare followers → gained[], lost[]
   ├── Compare following → added[], removed[]
   ├── Compare tweets → new[], deleted[]
   └── Compare engagement → changes per tweet
         ↓
generateReport(diff) → Markdown summary
```

---

## API Reference

### Export

```http
POST /api/portability/export
Content-Type: application/json

{
  "username": "elonmusk",
  "formats": ["json", "csv"],
  "only": ["profile", "tweets", "followers"],
  "limit": 500,
  "authToken": "your_auth_token"
}
```

**Response:** `{ id: "export_abc123", status: "started" }`

```http
GET /api/portability/export/:id           # Check progress
GET /api/portability/export/:id/download  # Download archive
GET /api/portability/exports              # List all exports
```

### Migrate

```http
POST /api/portability/migrate
Content-Type: application/json

{
  "username": "yourname",
  "platform": "bluesky",
  "dryRun": true,
  "authToken": "your_auth_token"
}
```

### Diff

```http
POST /api/portability/diff
Content-Type: application/json

{
  "dirA": "exports/user_jan2026",
  "dirB": "exports/user_feb2026"
}
```

**Response:** Full diff object with `gained`, `lost`, `added`, `removed`, `newTweets`, `deletedTweets`, `engagementChanges`.

---

## MCP Tools (AI Agents)

| Tool | Description |
|------|-------------|
| `x_export_account` | Export a full X/Twitter account to JSON/CSV/Markdown |
| `x_migrate_account` | Migrate social graph to Bluesky or Mastodon |

### Example (Claude Desktop)

> "Export @nichxbt's full account to JSON and generate an HTML archive"

The AI agent calls `x_export_account` with `{ username: "nichxbt", formats: ["json"], authToken: "..." }`.

---

## Import your X archive

You do not need to scrape your own account. X will hand you everything as a zip (**Settings > Your account > Download an archive of your data**; it arrives a day or so later). `importTwitterArchive` reads that download, either the `.zip` itself or the folder you extracted it to, and returns the same normalised records the rest of the portability toolkit works with. Zips are streamed entry by entry, so a multi-gigabyte archive with years of media is fine on a laptop: only one `data/*.js` section file is held in memory at a time, and media files are indexed, not read.

```js
import {
  importTwitterArchive,
  summarizeArchive,
  formatArchiveReport,
  exportArchive,
  openArchiveMedia,
} from './src/portability/index.js';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

const archive = await importTwitterArchive('twitter-2026-01-01-abc123.zip', {
  onProgress: (p) => process.stderr.write(`${p.phase} ${p.file}\n`),
});

console.log(formatArchiveReport(summarizeArchive(archive)));

// tweets, likes, following, followers, blocks, mutes, dms, lists, media, account, profile
const replies = archive.tweets.filter((t) => t.inReplyTo);
console.log(`${replies.length} of ${archive.tweets.length} tweets are replies`);

// Write it out in the same layout `export` produces (JSON, CSV, Markdown, HTML viewer)
const { dir } = await exportArchive(archive, { outputDir: 'exports/me_archive' });
console.log(`open ${dir}/index.html`);

// Pull a photo straight out of the zip
const first = archive.media[0];
await pipeline(await openArchiveMedia(archive, first.path), createWriteStream(first.file));
```

Save that as `archive.mjs` in the repo root and run `node archive.mjs` (from an installed package, import from `xactions/src/portability/index.js`).

### What you get

| Field | Shape |
|-------|-------|
| `account` | `{ id, username, name, email, createdAt, createdVia }` |
| `profile` | `{ username, name, bio, website, location, avatarUrl, headerUrl }` |
| `tweets[]` | `{ id, text, createdAt, url, inReplyTo: { tweetId, userId, username } \| null, retweeted, media: [{ id, type, url, previewUrl, file }], metrics: { likes, retweets }, hashtags, mentions, links, lang, source }` plus the flat `timestamp`, `likes`, `retweets` fields the exporter and differ read |
| `likes[]` | `{ id, text, url }` |
| `following[]`, `followers[]`, `blocks[]`, `mutes[]` | `{ id, url }` (the archive only carries account ids) |
| `dms[]` | one entry per conversation: `{ id, kind: 'direct' \| 'group', participants, messageCount, firstMessageAt, lastMessageAt, messages: [{ id, senderId, recipientId, text, createdAt, media, links, reactions }], events }` |
| `lists[]` | `{ kind: 'created' \| 'member' \| 'subscribed', name, url, description }` |
| `media[]` | `{ path, file, dir, size, tweetId, kind }` for every file under `data/*_media/` |
| `sections` | `{ present, missing }` so you can tell an empty section from one the archive does not include |

Multi-part files (`tweets.js`, `tweets-part1.js`, ...) are merged in part order. Pass `sections: ['tweets', 'likes']` to skip everything else, which is the fast path on a large archive.

### Summary report

`summarizeArchive(archive)` returns counts per section, the tweet date range, tweets per year, the busiest year, top hashtags and mentions, and likes and retweets received. `formatArchiveReport(summary)` renders it as terminal text:

```
X archive for @nichxbt (zip)
Account created: 2019-03-01
Tweets span:     2024-01-01 to 2025-03-16

Tweets       5 (3 original, 1 replies, 1 retweets, 2 with media)
Likes        2
Following    3
...
Top hashtags
  #xactions  3
```

### Migrate straight from the archive

`migrate` accepts `source: 'twitterArchive'`; it imports the archive, writes `tweets.json` and `following.json` to `exportDir`, then runs the normal dry-run or live flow:

```js
import { migrate } from './src/portability/index.js';

const summary = await migrate({
  platform: 'bluesky',
  source: 'twitterArchive',
  archivePath: 'twitter-2026-01-01-abc123.zip',
  exportDir: 'exports/me_archive',
  dryRun: true,
});
```

### From the command line

All three flows are on the CLI as `xactions archive`, with no code to write:

```bash
xactions archive summary twitter-2026-01-01-abc123.zip            # the report above, or --json
xactions archive export twitter-2026-01-01-abc123.zip --out exports/me --formats json,csv,md,html
xactions archive migrate twitter-2026-01-01-abc123.zip --to bluesky # dry run; add --execute --handle --password to post
```

`export` writes the same layout `xactions export` produces, so `xactions diff` and `xactions migrate` accept the directory. A spinner reports each section as it is scanned; under `--json` on a pipe it stays silent. Flags and sample output: [cli-reference.md](cli-reference.md#archive-the-x-data-export-without-scraping).

---

## Export Formats

| Format | Contents |
|--------|----------|
| **JSON** | `profile.json`, `tweets.json`, `followers.json`, `following.json`, `bookmarks.json`, `likes.json` |
| **CSV** | Same data in spreadsheet-friendly format |
| **Markdown** | Human-readable summaries per category |
| **HTML** | `archive.html` — self-contained dark-theme viewer with search, tabs, and pagination |

### Archive Viewer Features

- **Tabs:** Profile, Tweets, Followers, Following, Bookmarks, Likes
- **Search:** Full-text search across all sections
- **Pagination:** 50 items per page with navigation
- **Dark theme:** Matches X's aesthetic
- **Offline:** No external dependencies, works without internet

---

## Checkpoint Resume

Exports save a `.checkpoint.json` file after each phase. If the browser crashes or the script is interrupted, re-running the export will resume from the last completed phase — no duplicate work.

---

## Migration Details

### Bluesky

- Connects via AT Protocol (`bsky.social`)
- Finds matching accounts using Dice-coefficient string similarity on display names
- Dry-run shows all planned actions before executing
- Requires Bluesky credentials (`handle` + `password`)

### Mastodon

- Connects via Mastodon REST API
- Searches for matching accounts on the target instance
- Supports any Mastodon-compatible instance (Pleroma, Akkoma, etc.)
- Requires instance URL + API token

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `formats` | `['json', 'csv', 'md']` | Output formats |
| `only` | all | Subset: `profile`, `tweets`, `followers`, `following`, `bookmarks`, `likes` |
| `limit` | unlimited | Max items per category |
| `outputDir` | `exports/<user>_<date>` | Output directory |
| `dryRun` | `false` | Preview migration without making changes |
