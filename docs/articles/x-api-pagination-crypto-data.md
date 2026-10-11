# How to Use X API Pagination for Large-Scale Crypto Data Collection

**Meta description:** Master X API v2 pagination with next_token and max_results to collect large-scale crypto tweet datasets efficiently without hitting rate limits.

---

## Introduction

Collecting thousands of tweets about a token launch, a protocol exploit, or a governance vote requires understanding how X API v2 pagination works. The API caps results per request, so you'll need to page through results using cursor tokens. Get this wrong and you miss data, double-collect, or burn your rate limit quota in minutes. This guide covers the mechanics and shows you production patterns for bulk crypto data collection.

## How X API v2 Pagination Works

X API v2 uses cursor-based pagination. Every list response that has more results includes a `next_token` in the `meta` object. You pass that token as a query parameter to fetch the next page. There is no page number — each token encodes position in the result set.

Key parameters:

- `max_results` — number of results per request (10–100 for search, 1–1000 for timelines)
- `next_token` — cursor for the next page
- `pagination_token` — alias for `next_token` in some endpoints
- `start_time` / `end_time` — ISO 8601 timestamps to bound the collection window

## Basic Pagination Loop

```javascript
async function collectTweets(query, bearerToken, options = {}) {
  const { maxPages = 50, maxResults = 100, startTime, endTime } = options;
  const allTweets = [];
  let nextToken = null;
  let page = 0;

  do {
    const params = new URLSearchParams({
      query,
      max_results: maxResults,
      'tweet.fields': 'created_at,public_metrics,author_id,entities',
      expansions: 'author_id',
      ...(startTime && { start_time: startTime }),
      ...(endTime && { end_time: endTime }),
      ...(nextToken && { next_token: nextToken }),
    });

    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?${params}`,
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );

    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const data = await res.json();
    if (data.data) allTweets.push(...data.data);

    nextToken = data.meta?.next_token ?? null;
    page++;

    console.log(`🔄 Page ${page}: collected ${data.data?.length ?? 0} tweets (total: ${allTweets.length})`);

    // Respect rate limits — search endpoint allows ~1 req/sec for basic access
    if (nextToken) await new Promise(r => setTimeout(r, 1100));

  } while (nextToken && page < maxPages);

  return allTweets;
}
```

## Collecting Historical Data with Full-Archive Search

The recent search endpoint only covers the last 7 days. For historical crypto events — a previous exploit, a token's launch week — you need the full-archive search endpoint (requires Academic/Pro access):

```javascript
async function collectHistoricalTweets(query, bearerToken, startTime, endTime) {
  const allTweets = [];
  let nextToken = null;

  do {
    const params = new URLSearchParams({
      query,
      max_results: 500,
      'tweet.fields': 'created_at,public_metrics,author_id,lang',
      ...(nextToken && { next_token: nextToken }),
      start_time: startTime,
      end_time: endTime,
    });

    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/all?${params}`,
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );

    const data = await res.json();
    if (data.data) allTweets.push(...data.data);
    nextToken = data.meta?.next_token ?? null;

    // Full-archive: 1 request per second
    if (nextToken) await new Promise(r => setTimeout(r, 1000));

  } while (nextToken);

  return allTweets;
}
```

## Parallel Pagination Across Multiple Tokens

For sentiment analysis across a portfolio, paginate multiple token queries concurrently while staying within rate limits:

```javascript
async function collectMultiTokenData(tokens, bearerToken) {
  const CONCURRENCY = 3; // stay under rate limit
  const results = {};

  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const batch = tokens.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(token =>
        collectTweets(`${token} lang:en -is:retweet`, bearerToken, {
          maxPages: 10,
          maxResults: 100,
        })
      )
    );

    batch.forEach((token, idx) => {
      results[token] = batchResults[idx];
    });

    // Gap between batches
    if (i + CONCURRENCY < tokens.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  return results;
}
```

## Deduplication and Checkpoint Storage

Large collections run for minutes. Store progress so you can resume after failures:

```javascript
import { writeFileSync, readFileSync, existsSync } from 'fs';

function saveCheckpoint(query, nextToken, collectedIds) {
  const checkpoint = { query, nextToken, collectedIds: [...collectedIds], savedAt: Date.now() };
  writeFileSync(`./checkpoints/${Buffer.from(query).toString('base64')}.json`, JSON.stringify(checkpoint));
}

function loadCheckpoint(query) {
  const path = `./checkpoints/${Buffer.from(query).toString('base64')}.json`;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function resumableCollect(query, bearerToken) {
  const checkpoint = loadCheckpoint(query);
  let nextToken = checkpoint?.nextToken ?? null;
  const seenIds = new Set(checkpoint?.collectedIds ?? []);
  const allTweets = [];

  do {
    const params = new URLSearchParams({
      query,
      max_results: 100,
      ...(nextToken && { next_token: nextToken }),
    });

    const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    const data = await res.json();
    const newTweets = (data.data ?? []).filter(t => !seenIds.has(t.id));
    newTweets.forEach(t => seenIds.add(t.id));
    allTweets.push(...newTweets);

    nextToken = data.meta?.next_token ?? null;
    saveCheckpoint(query, nextToken, seenIds);

    if (nextToken) await new Promise(r => setTimeout(r, 1100));
  } while (nextToken);

  return allTweets;
}
```

## Handling `oldest_id` and `newest_id` for Timeline Sync

For follower timelines, use `since_id` to only fetch new tweets since your last sync:

```javascript
async function syncUserTimeline(userId, bearerToken, sinceId = null) {
  const params = new URLSearchParams({
    max_results: 100,
    'tweet.fields': 'created_at,public_metrics',
    ...(sinceId && { since_id: sinceId }),
  });

  const res = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?${params}`,
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );

  const data = await res.json();
  return {
    tweets: data.data ?? [],
    newestId: data.meta?.newest_id,
  };
}
```

Store `newestId` after each sync and pass it as `sinceId` on the next run. This prevents re-processing tweets you've already seen.

## Conclusion

X API pagination is cursor-based, stateless, and straightforward — but bulk crypto data collection demands discipline around rate limits, checkpointing, and deduplication. Build pagination as a reusable module with checkpoint support from the start. When markets move fast, you need your collection pipeline to be the least of your worries.
