# Scraping Infrastructure

Low-level scraping modules for anti-detection browsing, smart pagination with
resume, and proxy rotation. They are building blocks for scrapers you write, not
a layer the built-in scrapers sit on: the CLI, the MCP server and the library
read X over the HTTP client, which needs no browser at all. The one piece of
this file that is wired into the product is `DatasetStore`, which backs
`xactions dataset` and `/api/datasets`.

> **Import paths.** `package.json` does not publish `src/scraping/` as a package
> subpath, so `import ... from 'xactions/scraping/...'` throws
> `ERR_PACKAGE_PATH_NOT_EXPORTED`. Every path below is relative to the root of a
> clone of the repository. For a deeper treatment of the same modules, plus the
> account pool and query-ID discovery, see
> [scraping-infrastructure.md](scraping-infrastructure.md).

## Architecture

```
src/scraping/
├── stealthBrowser.js     # Anti-detection Puppeteer with fingerprint randomization
├── paginationEngine.js   # Smart scroll-and-extract with checkpoints
└── proxyManager.js       # Proxy rotation with health tracking
```

## Stealth Browser

Anti-detection Puppeteer wrapper. Tries `puppeteer-extra` + stealth plugin first, falls back to vanilla Puppeteer.

```javascript
import { launchStealthBrowser, createStealthPage } from './src/scraping/stealthBrowser.js';

const browser = await launchStealthBrowser({
  proxy: 'http://user:pass@proxy.example.com:8080',
  headless: true,
  userDataDir: '/tmp/xactions-browser',
  viewport: { width: 1920, height: 1080 },
  userAgent: 'custom-ua-string'  // or omit for random selection
});

const page = await createStealthPage(browser);
```

`stealthClick(page, selector)` and `stealthType(page, selector, text)` are
exported alongside them, for interactions that should not look scripted.

### Anti-Detection Features

- Randomized user-agent from a pool of 20 realistic strings (Chrome, Firefox, Safari on Win/Mac/Linux)
- Fingerprint randomization (canvas, WebGL, audio context)
- Stealth plugin patches (navigator.webdriver, chrome.runtime, etc.)
- Randomized viewport within realistic ranges
- Configurable proxy support

## Pagination Engine

Smart scroll-and-extract loop with deduplication, retries, checkpoint/resume, and progress tracking.

```javascript
import { PaginationEngine } from './src/scraping/paginationEngine.js';

const engine = new PaginationEngine({
  maxPages: 50,
  maxItems: 1000,
  scrollDelay: 1500,     // 1.5s between scrolls
  deduplicateBy: 'id',   // Field, or a function, to deduplicate on
  onProgress: (stats) => console.log(`${stats.total} items scraped`)
});

const { items, stats } = await engine.scrapeWithPagination(page, extractFn, {
  checkpoint: '/tmp/checkpoint.json'  // Resume from a file saved earlier
});
```

`scrapeWithPagination` resolves to `{ items, stats }`.

### Options

Constructor options:

| Option | Default | Description |
|--------|---------|-------------|
| `maxPages` | `Infinity` | Maximum scroll pages |
| `maxItems` | `Infinity` | Stop after N items collected |
| `scrollDelay` | `1500` | Delay between scroll actions (ms) |
| `deduplicateBy` | none | Field name, or a function, for dedup (e.g. `'id'`, `'username'`) |
| `onProgress` | none | Called with `stats` as items accumulate |

At least one of `maxPages` and `maxItems` must be set, or the loop only ends
when the page stops producing new items.

Per-call options, the second argument to `scrapeWithPagination`:

| Option | Description |
|--------|-------------|
| `checkpoint` | Path to a checkpoint file written earlier by `saveCheckpoint()`. Its seen-keys set and page count are loaded before the scroll loop starts. |

### Stats

After scraping, `engine.stats` contains:

```javascript
{
  total: 847,
  duplicatesRemoved: 23,
  pagesScrolled: 42,
  errorsRecovered: 2,
  duration: 63000
}
```

### Checkpoint / Resume

Checkpointing is explicit, not automatic: call `engine.saveCheckpoint(id)`
yourself, from `onProgress` or after each batch. It writes
`~/.xactions/scrape-checkpoints/<id>.json` and returns the path. Passing that
path back as `checkpoint` on the next run restores the seen-keys set, so already
collected items are skipped.

```javascript
const engine = new PaginationEngine({
  deduplicateBy: 'username',
  onProgress: async () => { await engine.saveCheckpoint('followers-nasa'); },
});

await engine.scrapeWithPagination(page, extractFn, {
  checkpoint: `${process.env.HOME}/.xactions/scrape-checkpoints/followers-nasa.json`,
});
```

`engine.resume(path)` does the same load without starting a scrape.

For the HTTP scraper there is a separate, fully automatic cursor checkpoint
(`createCheckpoint`), which writes after every page and needs no callback. That
is the one to use for follower and timeline scrapes:
[scraping-infrastructure.md](scraping-infrastructure.md#resumable-scrapes).

## Proxy Manager

Proxy rotation with health tracking, auto-blacklisting of failing proxies, and load balancing.

```javascript
import { ProxyManager } from './src/scraping/proxyManager.js';

// The constructor takes an array of proxy URLs.
const manager = new ProxyManager(['http://user:pass@proxy1.example.com:8080']);

// Or load them from elsewhere
manager.loadFromEnv();                            // XACTIONS_PROXIES or XACTIONS_PROXY_FILE
await manager.loadFromFile('/path/to/proxies.txt');

// Get a healthy proxy. getNext() is round-robin, getRandom() is not.
const proxy = manager.getNext();
console.log(proxy.url);

// Report the outcome so health tracking works
manager.markSuccess(proxy.url, 240);   // url, response time in ms
manager.markFailed(proxy.url);

// Inspect the pool
manager.getHealthy();   // proxies not currently blacklisted
manager.getStats();     // per-proxy counters, see below
```

`getNext()` returns `null` when every proxy is blacklisted, so check the result
before using it.

### Proxy Format

One proxy per line in text files:

```
http://user:pass@proxy1.example.com:8080
socks5://user:pass@proxy2.example.com:1080
http://proxy3.example.com:3128
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `XACTIONS_PROXIES` | Comma-separated proxy URLs |
| `XACTIONS_PROXY_FILE` | Path to a proxy list file |

### Health Tracking

`getStats()` returns one row per proxy:

| Field | Description |
|--------|-------------|
| `url` | The normalised proxy URL |
| `successes` | Total successful requests |
| `failures` | Total failed requests |
| `avgResponseTime` | Mean response time in ms, over the calls you reported |
| `blacklisted` | Whether it is out of rotation right now |

Three consecutive `markFailed` calls blacklist a proxy for 10 minutes;
`markSuccess` resets the streak. Blacklisted proxies are skipped by `getNext()`
and `getRandom()`, and excluded from `getHealthy()`.

## What uses what

| Module | Used by |
|---|---|
| `DatasetStore`, `listDatasets` (in `paginationEngine.js`) | `xactions dataset`, the `x_dataset_*` MCP tools, `/api/datasets`, the job queue |
| `PaginationEngine`, `RetryPolicy` | Nothing in the tree. They exist for scrapers you write. |
| `ProxyManager` | Nothing in the tree. Wire it into your own launch options. |
| `launchStealthBrowser`, `createStealthPage` | Nothing in the tree. `src/streaming/browserPool.js` builds its pages with `createBrowser` / `createPage` from `src/scrapers/`. |

That is the honest picture, and it is worth knowing before you assume a setting
here changes what `xactions followers` does. It does not. For the anti-detection
work that *is* on the live request path (per-session browser identity, request
signing, query-ID discovery, the account pool), see
[scraping-infrastructure.md](scraping-infrastructure.md).
