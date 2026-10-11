# Media archive

> Download every photo, video and GIF from a profile, tweet, search or community, with filename templates and an archive that makes re-runs incremental. `xactions download @nichxbt`, the `xactions/media` module, or the `x_download_media` MCP tool.

XActions could always *find* media. It could not save it. Anyone who wanted a local archive reached for [gallery-dl](https://github.com/mikf/gallery-dl), which is excellent at exactly this and knows nothing about the rest of the toolkit. This closes that gap, with the two things gallery-dl users have been asking it for.

## Quick start

```bash
xactions download @nichxbt                       # the media tab into ./media
xactions download @nichxbt:all --archive         # media, avatar and banner, incrementally
xactions download "search:from:nichxbt filter:videos" --type video
xactions download https://x.com/nichxbt/status/123 --dry-run
```

`dl` is an alias, so `xactions dl @nichxbt` works too.

## Targets

| Target | What it downloads |
|---|---|
| `@user` or `user` | The media tab |
| `@user:avatar` | Profile picture, at original resolution |
| `@user:banner` | Header image, at 1500x500 |
| `@user:all` | Media tab plus avatar and banner |
| `1234567890` or a status URL | One tweet's media |
| `search:<query>` | Everything matching a search (full X search syntax) |
| `community:<id>` | A community's media |

Avatars are requested at their original size. X serves a 48px `_normal` thumbnail by default, and an archive full of 48px avatars is not an archive.

## Filename templates

The default is `{username}/{tweet_id}_{num}.{ext}`. Override with `--filename`:

```bash
xactions download @nichxbt -f '{username}/{year}/{month}/{datetime}_{tweet_id}_{num}.{ext}'
xactions download @nichxbt -f '{date}_{media_filename}.{ext}'
```

| Key | Value |
|---|---|
| `{username}` | Author's handle, without the @ |
| `{user_id}` | Author's numeric id |
| `{tweet_id}` | Id of the tweet the media belongs to |
| `{num}` | Position within the tweet, starting at 1 |
| `{ext}` | File extension without the dot |
| `{type}` | `photo`, `video` or `animated_gif` |
| `{kind}` | `media`, `avatar` or `banner` |
| `{date}` | Tweet date as `YYYY-MM-DD` |
| `{datetime}` | Tweet date as `YYYYMMDD_HHMMSS` |
| `{year}` `{month}` `{day}` | Date parts, zero padded |
| `{width}` `{height}` | Pixel dimensions, 0 when unknown |
| `{bitrate}` | Video bitrate, 0 for photos |
| `{media_filename}` | **X's own CDN filename** (`Go6lFkVWsAAQwOo`) |
| `{cdn_basename}` | Alias of `{media_filename}` |
| `{hash}` | First 16 hex characters of the sha256 of the bytes |

`{media_filename}` is the key [gallery-dl issue #7695](https://github.com/mikf/gallery-dl/issues/7695) asks for and does not have. Naming files after X's own CDN name keeps an archive diffable against the names X uses, and makes a file identifiable from its name alone after it has been moved.

A misspelled key is an error, not an empty string. `{tweetid}` would otherwise collapse every file in a run onto the same name, which you would notice only after the run finished.

Templates cannot escape the output directory. A handle, a template and a tweet's own text are all attacker-controlled in the general case, so path separators are stripped from every substituted value and the resolved path is checked against the output directory before anything is written.

## The archive

`--archive` records what was downloaded in a JSONL file (`.xactions-archive.jsonl` beside the files, or a path you name), so a re-run only fetches what is new. A nightly sync costs one timeline walk instead of a full re-download.

It works on two independent layers:

- **Identity.** `{kind}:{tweet_id}:{num}` per item, the same key gallery-dl records. Skips work before a byte is requested, and is independent of the template, so changing `--filename` does not re-download everything.
- **Content.** The sha256 of the bytes. gallery-dl's archive [prevents re-downloading but does not deduplicate across different source URLs pointing to the same image](https://github.com/mikf/gallery-dl), so one photo reached through a retweet, a quote and the author's media tab lands three times. Here the second copy is recognised and **hard-linked** to the first: it still appears at every path you expect, while occupying the space of one file.

The store is append-only JSONL, so an interrupted run leaves a readable file, a truncated final line costs one re-download rather than the whole archive, and the thing greps.

## Reliability

- **Resume.** Bytes land in `<name>.part` and are renamed only once the file is whole, so an interrupted run never leaves a truncated JPEG that looks complete. A retry sends `Range:` and continues from what is on disk instead of restarting a 40 MB video. Ctrl-C keeps the partial file and picks up next run.
- **Retries.** 408, 425, 429 and 5xx are retried with exponential backoff. A 404 is not, because it will not become a 200.
- **Concurrency.** A fixed pool, default 4. X rate limits per account, and an unbounded fan-out is how a scrape gets an account locked.
- **Honest summaries.** Every item ends as `downloaded`, `skipped`, `deduped`, `planned` or `failed` with the reason attached, and the exit code is non-zero if anything failed.

## Options

| Flag | Description |
|---|---|
| `-o, --output <dir>` | Where files land (default `./media`) |
| `-f, --filename <template>` | Filename template |
| `-a, --archive [path]` | Record downloads so re-runs are incremental |
| `-l, --limit <n>` | How many source items to walk (default 100) |
| `-c, --concurrency <n>` | Parallel downloads (default 4) |
| `-t, --type <type...>` | Only `photo`, `video` or `gif` |
| `--since <date>` / `--until <date>` | Date range, `YYYY-MM-DD` |
| `--overwrite` | Re-download even when the file or archive entry exists |
| `--dry-run` | List what would be downloaded, write nothing |
| `--json` | Print the plan and results as JSON |
| `-q, --quiet` | Summary only, no per-file lines |

## From Node

```js
import { createHttpScraper } from 'xactions/scrapers/twitter/http';
import { downloadMediaFor } from 'xactions/media';

const scrapers = await createHttpScraper({ cookies: process.env.X_COOKIES });

const { summary, results } = await downloadMediaFor('@nichxbt:all', {
  scrapers,
  outputDir: './archive',
  template: '{username}/{kind}/{date}_{media_filename}.{ext}',
  archivePath: './archive/.xactions-archive.jsonl',
  concurrency: 4,
  onResult: (r) => console.log(r.outcome, r.relativePath),
});

console.log(`${summary.downloaded} new, ${summary.deduped} deduped, ${summary.skipped} already had`);
```

The module also exports the pieces on their own, so you can drive them from your own pipeline: `parseTarget`, `collectItems`, `itemsFromTweet`, `downloadAll`, `downloadItem`, `openArchive`, `renderTemplate`, `resolveWithin`.

## As an MCP tool

`x_download_media` gives an agent the same capability:

```json
{
  "name": "x_download_media",
  "arguments": { "target": "@nichxbt:all", "outputDir": "./archive", "types": ["photo"] }
}
```

It returns the summary, the list of files, and every failure with its reason. The write is to the caller's own disk, never to their X account, so it needs no approval gate. Use `x_get_media` instead when you only want to *list* media without saving it.

## Development

```bash
npx vitest run tests/media   # templates, archive, engine and the full pipeline
```

The engine is tested against a real local HTTP server rather than a stubbed `fetch`, because the behaviours worth testing (Range resume, a 429 retry, a stream that dies mid-file) only exist at the protocol level.

Related: [CLI reference](cli-reference.md), [Scrapers](scrapers.md), [MCP setup](mcp-setup.md), [Video downloader](video-downloader.md).
