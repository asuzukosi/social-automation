# `src/media` - bulk media downloading

Turns a target (`@user`, `@user:all`, a tweet, `search:<query>`, `community:<id>`) into files on disk, with filename templates, an incremental archive, resume, retries and cross-URL deduplication.

Full guide, including every template key and flag: **[docs/media-archive.md](../../docs/media-archive.md)**.

## Layout

| File | Responsibility |
|---|---|
| `index.js` | `downloadMediaFor(target, options)`, the one call that does everything, plus re-exports |
| `sources.js` | Target parsing and resolution into media items (`parseTarget`, `collectItems`, `itemsFromTweet`) |
| `template.js` | Filename templates and the path-traversal guard (`renderTemplate`, `resolveWithin`) |
| `archive.js` | The JSONL archive: identity keys and content hashes (`openArchive`) |
| `download.js` | The engine: worker pool, resume, retries, hard-linking (`downloadAll`, `downloadItem`) |

## Example

```js
import { createHttpScraper } from '../scrapers/twitter/http/index.js';
import { downloadMediaFor } from './index.js';

const scrapers = await createHttpScraper({ cookies: process.env.X_COOKIES });

const { summary } = await downloadMediaFor('@nichxbt:all', {
  scrapers,
  outputDir: './archive',
  template: '{username}/{kind}/{date}_{media_filename}.{ext}',
  archivePath: './archive/.xactions-archive.jsonl',
});

console.log(summary); // { downloaded, skipped, deduped, failed, planned, bytes }
```

This module never constructs a client of its own: pass in whatever `createHttpScraper()` gave you and it inherits that session, account pool and checkpoint configuration.

## Tests

```bash
npx vitest run tests/media
```

Driven against a real local HTTP server, because Range resume, 429 retries and mid-stream failures only exist at the protocol level.
