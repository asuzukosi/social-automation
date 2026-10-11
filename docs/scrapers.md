# Scrapers

Multi-platform, multi-framework scraping system. Supports Twitter/X, Bluesky, Threads, and Mastodon with pluggable browser backends.

> **Reach for the HTTP client first.** Everything on this page that says `page`
> drives Chromium and needs a logged-in session, because X serves a logged-out
> browser an empty page. `Scraper` from `xactions/client` reads profiles and
> public timelines over X's internal GraphQL API with no browser and no login.
> See [api-reference.md](api-reference.md#http-client-no-browser).

---

## Quick Start

### Node.js

```js
import {
  createBrowser,
  createPage,
  loginWithCookie,
  scrapeProfile,
  scrapeFollowers,
  scrapeTweets,
  searchTweets,
} from 'xactions/scrapers';

const browser = await createBrowser();
const page = await createPage(browser);
await loginWithCookie(page, process.env.X_AUTH_TOKEN);

// Scrape a profile
const profile = await scrapeProfile(page, 'elonmusk');

// Scrape followers (paginated)
const followers = await scrapeFollowers(page, 'nichxbt', { limit: 500 });

// Scrape recent tweets
const tweets = await scrapeTweets(page, 'nichxbt', { limit: 100 });

// Search tweets
const results = await searchTweets(page, 'XActions', { limit: 50 });

await browser.close();
```

The option is `limit` everywhere. There is no `max`.

### CLI

```bash
xactions scrape profile elonmusk
xactions scrape followers nichxbt --limit 500
xactions scrape tweets nichxbt --limit 100
xactions search "AI agents" --limit 50
```

### Browser Script

Paste [`scripts/scrapeFollowers.js`](../scripts/scrapeFollowers.js) into the
DevTools console while you are on `x.com/USERNAME/followers`. The full catalog,
with the page each script expects, is in
[browser-scripts.md](browser-scripts.md).

---

## Platforms

Each platform is its own package subpath, with a default export and named
exports. `xactions/scrapers` re-exports the Twitter functions at the top level;
the other platforms are only reachable through their own subpath.

### Twitter/X (Primary)

Full support for all scraping operations via browser automation on x.com.

```js
import twitter from 'xactions/scrapers/twitter';

const profile = await twitter.scrapeProfile(page, 'elonmusk');
const followers = await twitter.scrapeFollowers(page, 'nichxbt');
const tweets = await twitter.scrapeTweets(page, 'nichxbt');
```

### Bluesky

Bluesky and Mastodon speak public HTTP APIs, so they need a client rather than a
Puppeteer page, and public reads need no credentials.

```js
import bluesky from 'xactions/scrapers/bluesky';

const agent = await bluesky.createAgent();
const profile = await bluesky.scrapeProfile(agent, 'bsky.app');
```

### Threads

Threads is browser-driven like X, so it takes a `page`.

```js
import threads from 'xactions/scrapers/threads';

const profile = await threads.scrapeProfile(page, 'zuck');
```

### Mastodon

```js
import mastodon from 'xactions/scrapers/mastodon';

const client = mastodon.createClient({ instance: 'https://mastodon.social' });
const profile = await mastodon.scrapeProfile(client, 'Gargron');
```

### One call for any of them

`scrape(platform, action, options)` builds the page or client for you, runs the
action, and tears down whatever it created. The third argument is always an
options object.

```js
import { scrape } from 'xactions/scrapers';

const bsky = await scrape('bluesky', 'profile', { username: 'bsky.app' });
const masto = await scrape('mastodon', 'profile', {
  username: 'Gargron',
  instance: 'https://mastodon.social',
});
const x = await scrape('twitter', 'tweets', {
  username: 'nasa',
  limit: 50,
  authToken: process.env.X_AUTH_TOKEN,
});
```

Actions: `profile`, `followers`, `following`, `tweets` (alias `posts`),
`search`, `hashtag`, `trending`, `thread`, `likes`, `media`, `listMembers`,
`bookmarks`, `notifications`, `communityMembers`, `spaces`, `feed`. Not every
platform implements every action; an unsupported one throws with the list of
what that platform does support. `xactions platforms` prints the same matrix
from the CLI.

---

## Scraper Functions (Twitter/X)

| Function | Description |
|----------|-------------|
| `scrapeProfile(page, username)` | Name, bio, followers, following, verified status |
| `scrapeFollowers(page, username, opts)` | Paginated follower list with profiles |
| `scrapeFollowing(page, username, opts)` | Paginated following list |
| `scrapeTweets(page, username, opts)` | User's tweets with engagement counts |
| `searchTweets(page, query, opts)` | Search results |
| `scrapeThread(page, tweetUrl)` | Full thread (all replies in chain) |
| `scrapeLikes(page, username, opts)` | User's liked tweets |
| `scrapeHashtag(page, hashtag, opts)` | Tweets containing a hashtag |
| `scrapeMedia(page, username, opts)` | User's media tweets (images/video) |
| `scrapeListMembers(page, listId, opts)` | Members of a Twitter list |
| `scrapeBookmarks(page, opts)` | Your bookmarked tweets |
| `scrapeNotifications(page, opts)` | Your notification feed |
| `scrapeTrending(page)` | Current trending topics |
| `scrapeCommunityMembers(page, communityId, opts)` | Community members |

### Options

Most scraper functions accept an options object. The one that matters is
`limit`; the rest are per-function.

```js
const opts = {
  limit: 500,                       // Maximum items to scrape
  onProgress: (n) => console.log(n), // Called as items accumulate
};
```

Writing results out is a separate step, with `exportToJSON` and `exportToCSV`
from the same module:

```js
import { exportToJSON, exportToCSV } from 'xactions/scrapers';

await exportToJSON(followers, 'followers.json');
await exportToCSV(followers, 'followers.csv');
```

---

## Communities, notifications, trends and Spaces (HTTP client)

These run on the HTTP client, not Puppeteer: no browser starts, and each call is
one GraphQL request. Import them from `xactions/scrapers/twitter/http`, or reach
them as methods on the object `createHttpScraper()` returns. Every read here
needs a logged-in session (`xactions login`); trends by place are the exception
and work on the guest tier.

```js
import { createHttpScraper } from 'xactions/scrapers/twitter/http';

// `cookies` is a cookie header string: "auth_token=...; ct0=...".
const x = await createHttpScraper({ cookies: process.env.X_COOKIES });

const community = await x.scrapeCommunity('1493446837214187523');
const posts = await x.scrapeCommunityTweets(community.id, { limit: 100 });
const mine = await x.scrapeMyCommunities();
```

`createHttpScraper` does not fall back to a guest token: with no `cookies` it
authenticates as nobody and X answers `403`. For guest-tier reads use `Scraper`
from `xactions/client`, which acquires a guest token on its own.

### Communities

| Function | Description |
|----------|-------------|
| `scrapeCommunity(id)` | Community details: name, description, member count, rules, moderators |
| `scrapeCommunityTweets(id, opts)` | Community timeline, `{ ranking: 'latest' \| 'top' }` |
| `scrapeCommunityMedia(id, opts)` | Media posts from a community |
| `searchCommunityTweets(query, opts)` | Search within communities |
| `scrapeMyCommunities(opts)` | Communities the logged-in account belongs to |
| `scrapeCommunityDiscovery(opts)` | Communities X suggests |
| `joinCommunity(id)` / `leaveCommunity(id)` | Membership mutations |
| `requestToJoinCommunity(id, opts)` | Ask to join a restricted community |

### Notifications

| Function | Description |
|----------|-------------|
| `scrapeNotifications(opts)` | The full notifications timeline as typed events |
| `scrapeMentions(opts)` | The Mentions tab only |
| `scrapeVerifiedNotifications(opts)` | The Verified tab only |

Each entry is normalised to `{ id, type, users, tweet, timestamp }`, where
`type` is one of `follow`, `like`, `retweet`, `reply`, `mention`, `quote` or
`generic`, so a notification handler can switch on it without reading X's raw
entry shapes.

### Trends, highlights and Spaces

| Function | Description |
|----------|-------------|
| `scrapeTrends(opts)` | Trends for the account's own location |
| `scrapeTrendsByWoeid(woeid)` | Trends for a place; `1` is worldwide |
| `scrapeTrendLocations()` | Every place X publishes trends for, with WOEIDs |
| `scrapeExplorePage(opts)` | The Explore tab, tab by tab |
| `scrapeHighlights(user, opts)` | Posts an account pinned to its Highlights tab |
| `scrapeArticles(user, opts)` | Long-form Articles by an account |
| `scrapeVerifiedFollowers(user, opts)` | Verified followers only |
| `scrapeFollowersYouKnow(user, opts)` | Followers the logged-in account also follows |
| `scrapeAudioSpace(spaceId)` | Space details: title, state, host, speakers, listener count |

```js
// What is trending in Japan right now (woeid 23424856)
const jp = await x.scrapeTrendsByWoeid(23424856);
console.log(jp.map((t) => `${t.name} (${t.postCount ?? 'n/a'})`).join('\n'));
```

The query IDs behind all of these are discovered from x.com at runtime and
cached, so they keep working when X rotates them. See
[Scraping infrastructure](scraping-infrastructure.md#graphql-query-id-discovery).

---

## Adapter System

Swap browser backends without changing scraper code.

### Available Adapters

| Adapter | Package | Description |
|---------|---------|-------------|
| `puppeteer` | puppeteer | Default. Chromium headless browser |
| `playwright` | playwright | Multi-browser (Chromium, Firefox, WebKit) |
| `cheerio` | cheerio | HTTP-only, no browser (limited to public pages) |
| `got-jsdom` | got + jsdom | HTTP + DOM parsing |
| `selenium` | selenium-webdriver | Selenium WebDriver |
| `crawlee` | crawlee | Apify's crawling framework |
| `http` | none | X's internal GraphQL API directly, no browser |

`listAdapters()` also returns the aliases `pptr`, `pw`, `got`, `jsdom` and
`apify`, which resolve to the rows above.

### Switching Adapters

```js
import { setDefaultAdapter, getAdapter, listAdapters, checkAvailability } from 'xactions/scrapers';

console.log(listAdapters());          // every registered name and alias
console.log(await checkAvailability()); // which ones have their package installed

setDefaultAdapter('playwright');      // for the whole process
const adapter = await getAdapter('cheerio');  // one adapter, right now
```

`getAdapter` is async: it lazy-imports the backend so an uninstalled optional
dependency costs nothing. `getAvailableAdapter(preferred)` walks a fallback
chain (your choice, then the default, then puppeteer, playwright, crawlee,
got-jsdom, selenium, cheerio) and returns the first one whose package is
present. `XACTIONS_SCRAPER_ADAPTER` sets the default without a code change.

### Custom Adapters

An adapter extends `BaseAdapter` and overrides the methods it needs. The
interface is `launch` / `newPage` / `goto` / `evaluate` / `closePage` /
`closeBrowser`, plus the optional `queryAll`, `getContent`, `setCookie`,
`scroll`, `screenshot`, `waitForSelector` and `checkDependencies`.

```js
import { BaseAdapter, registerAdapter, getAdapter } from 'xactions/scrapers';

class MyAdapter extends BaseAdapter {
  name = 'my-adapter';
  requiresBrowser = true;
  supportsJavaScript = true;

  async launch(options = {}) { /* return a browser handle */ }
  async newPage(browser, options = {}) { /* return a page handle */ }
  async goto(page, url, options = {}) { /* navigate */ }
  async evaluate(page, fn, ...args) { /* run fn in the page */ }
  async closePage(page) { /* ... */ }
  async closeBrowser(browser) { /* ... */ }
}

registerAdapter('my-adapter', MyAdapter);
const mine = await getAdapter('my-adapter');
```

---

## Browser Scripts

Standalone scripts for DevTools console. Copy from `scripts/` and paste on x.com:

| Script | Description |
|--------|-------------|
| `scrapeFollowers.js` | Export follower list |
| `scrapeFollowing.js` | Export following list |
| `scrapeProfile.js` | Extract profile data |
| `scrapeLikes.js` | Export liked tweets |
| `scrapeMedia.js` | Export media tweets |
| `scrapeHashtag.js` | Scrape tweets by hashtag |
| `scrapeSearch.js` | Scrape search results |
| `scrapeBookmarks.js` | Export bookmarks |
| `scrapeDMs.js` | Export DM conversations |
| `scrapeList.js` | Scrape list members |
| `scrapeReplies.js` | Scrape reply threads |
| `scrapeQuoteRetweets.js` | Scrape quote retweets |
| `scrapeNotifications.js` | Export notification feed |
| `scrapeSpaces.js` | Scrape Spaces metadata |
| `scrapeExplore.js` | Scrape Explore/trending |
| `scrapeAnalytics.js` | Scrape analytics data |
| `bookmarkExporter.js` | Advanced bookmark export with folders |
| `threadUnroller.js` | Unroll a thread into JSON/text |
| `viralTweetsScraper.js` | Find viral tweets in a niche |
| `videoDownloader.js` | Download Twitter/X videos |

These are a sample. The full catalog of 95 console scripts, each with the page
it expects, is [browser-scripts.md](browser-scripts.md).

### Output Formats

Browser scripts export data as:

- **JSON**: downloaded as a `.json` file
- **CSV**: downloadable spreadsheet
- **Console**: printed to the DevTools console as a table

---

## API Endpoints

These belong to the self-hosted API server (`api/server.js`), not to the
library. Everything under `/api/profile`, `/api/discovery` and
`/api/unfollowers` requires a logged-in XActions account (`Authorization:
Bearer <jwt>` from `/api/auth/login`). `/api/twitter/*` is the X OAuth
connect flow, not a scraping surface.

| Route | Method | Description |
|-------|--------|-------------|
| `/api/profile/:username` | GET | Queue a profile scrape; returns an operation id |
| `/api/discovery/search` | GET | Search posts (`?q=query`) |
| `/api/discovery/trends` | GET | Current trends |
| `/api/discovery/explore` | GET | The Explore tab |
| `/api/unfollowers/scan` | POST | Snapshot followers and diff against the last one |
| `/api/unfollowers/changes` | GET | Follow and unfollow events since a date |
| `/api/operations/status/:operationId` | GET | Poll a queued scrape |

The scraping routes are queue-backed: they return an operation id immediately
and you poll `/api/operations/status/:operationId` for the result. Full list:
[rest-api.md](rest-api.md).

---

## Rate Limits & Best Practices

X enforces aggressive rate limits. Follow these guidelines:

1. **Add delays.** Minimum 1-3 seconds between actions.
2. **Batch operations.** Scrape in chunks of 100-500, pause between batches.
3. **Respect pagination.** Do not skip the built-in scroll delays.
4. **Rotate sessions.** At scale, use an account pool rather than one token.
5. **Use proxies.** `ProxyManager` handles rotation and health tracking.

The modules under `src/scraping/` are internal: `package.json` does not publish
them as subpaths, so they are imported by relative path from a clone of the
repo, not as `xactions/scraping/...`.

```js
import { ProxyManager } from './src/scraping/proxyManager.js';

// The constructor takes an array of proxy URLs.
const proxies = new ProxyManager(['http://proxy1:8080', 'http://proxy2:8080']);
proxies.loadFromEnv();               // or XACTIONS_PROXIES / XACTIONS_PROXY_FILE
const proxy = proxies.getNext();     // round-robin over the healthy ones
proxies.markSuccess(proxy.url, 240); // url, response time in ms
proxies.markFailed(proxy.url);       // three strikes and it is blacklisted
```

For X specifically, the account pool is the better answer than proxies alone:
it tracks each session's rate-limit window per GraphQL operation and rotates on
a 429. See
[scraping-infrastructure.md](scraping-infrastructure.md#account-pool-and-resumable-scrapes-http-scraper).

---

## Pagination Engine

For large scroll-based scrapes, `PaginationEngine` handles the scroll loop,
deduplication, and error recovery.

```js
import { PaginationEngine } from './src/scraping/paginationEngine.js';

const engine = new PaginationEngine({
  maxPages: 100,
  maxItems: 5000,
  scrollDelay: 2000,
  deduplicateBy: 'id',
  onProgress: (stats) => console.log(`${stats.total} items`),
});

const { items, stats } = await engine.scrapeWithPagination(page, async (p) =>
  p.evaluate(() => [...document.querySelectorAll('[data-testid="UserCell"]')].map(/* ... */)),
);

await engine.saveCheckpoint('followers-nasa'); // resume later with { checkpoint: <path> }
```

Full options and the checkpoint contract:
[scraping-infrastructure.md](scraping-infrastructure.md#pagination-engine).

---

## Stealth Mode

The stealth browser is a function, not a class, and it falls back to vanilla
Puppeteer when `puppeteer-extra` is not installed.

```js
import { launchStealthBrowser, createStealthPage } from './src/scraping/stealthBrowser.js';

const browser = await launchStealthBrowser({ headless: true });
const page = await createStealthPage(browser);
```

It randomises the User-Agent, viewport and fingerprint surface on each launch.
For the request-level identity the HTTP client sends (one browser profile held
for the life of the process, with matching client hints), see
[scraping-infrastructure.md](scraping-infrastructure.md#browser-identity).
