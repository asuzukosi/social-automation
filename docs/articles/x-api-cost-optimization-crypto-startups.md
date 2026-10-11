# X API Cost Optimization Strategies for Crypto Startups

**Meta description:** Reduce X API costs for crypto data pipelines with practical strategies including request batching, smart caching, tiered polling, and filtered stream optimization to avoid unnecessary spend.

---

## Introduction

The X API is expensive if you use it naively. For crypto startups monitoring dozens of accounts and keywords, costs can climb fast on the Basic or Pro tier. The good news: most waste comes from a handful of architectural mistakes that are straightforward to fix.

This guide covers the concrete techniques crypto teams use to cut X API spend by 60-80% without losing data coverage.

---

## Understand What You're Actually Paying For

X API pricing (as of 2025) charges on two dimensions: read requests and the number of tweets returned per month. Before optimizing, baseline your actual usage:

```javascript
// Log every API call with its cost weight
const API_COSTS = {
  'GET /2/tweets/search/recent': { requestCost: 1, tweetCost: true },
  'GET /2/users/:id/tweets': { requestCost: 1, tweetCost: true },
  'GET /2/tweets/:id': { requestCost: 1, tweetCost: false },
  'POST /2/tweets/search/stream/rules': { requestCost: 1, tweetCost: false }
};

function trackApiCall(endpoint, tweetsReturned = 0) {
  console.log(`API_USAGE endpoint=${endpoint} tweets=${tweetsReturned} ts=${Date.now()}`);
  // Send to metrics aggregator (DataDog, Prometheus, etc.)
}
```

Most teams discover that 70% of their tweet budget is consumed by a handful of high-volume searches they run too frequently.

---

## Mistake 1: Polling When You Should Stream

The single biggest waste: polling search endpoints every 5-15 minutes for accounts you could monitor with filtered streams. Each poll costs requests regardless of whether anything new exists.

**Before (expensive):**
```javascript
// Polls 20 accounts every 2 minutes = 14,400 requests/day
setInterval(async () => {
  for (const accountId of MONITORED_ACCOUNTS) {
    const tweets = await client.v2.userTimeline(accountId, { max_results: 10 });
    processTweets(tweets.data);
  }
}, 2 * 60 * 1000);
```

**After (cheap):**
```javascript
// One persistent stream connection, zero polling
const stream = await client.v2.searchStream({ 'tweet.fields': ['author_id', 'created_at'] });
stream.on('data', tweet => processTweet(tweet));
// Costs: 0 requests per tweet received after connection
```

Use filtered streams for any account or keyword you check more than once per hour.

---

## Mistake 2: Not Batching User Lookups

Each individual user lookup costs a request. The users endpoint accepts up to 100 IDs per request.

**Before:**
```javascript
// 100 requests for 100 users
for (const id of userIds) {
  const user = await client.v2.user(id);
}
```

**After:**
```javascript
// 1 request for 100 users
async function batchUserLookup(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) {
    chunks.push(ids.slice(i, i + 100));
  }

  const results = [];
  for (const chunk of chunks) {
    const { data } = await client.v2.users(chunk, {
      'user.fields': ['public_metrics', 'description', 'created_at']
    });
    results.push(...data);
    await new Promise(r => setTimeout(r, 1000)); // rate limit padding
  }
  return results;
}
```

---

## Mistake 3: Re-fetching Stable Data

User profiles, bio text, and follower counts change infrequently. Cache them aggressively.

```javascript
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });

async function getCachedUser(userId) {
  const cacheKey = `x:user:${userId}`;
  const cached = await redis.get(cacheKey);

  if (cached) return JSON.parse(cached);

  const { data } = await client.v2.user(userId, {
    'user.fields': ['public_metrics', 'description', 'entities']
  });

  // Cache for 6 hours — profiles don't change often
  await redis.setEx(cacheKey, 6 * 3600, JSON.stringify(data));
  return data;
}
```

Apply the same pattern to tweet lookups. If you need the same tweet ID for engagement tracking, cache the base data and only re-fetch metrics.

---

## Tiered Polling for Cost Control

Not all accounts deserve the same polling frequency. Tier them by signal value:

```javascript
const POLLING_TIERS = {
  CRITICAL: {
    accounts: ['tether_to', 'circle', 'coinbase'],
    intervalMs: 60_000,         // 1 min (high value)
    maxResults: 10
  },
  STANDARD: {
    accounts: ['defi_protocols', 'layer2_projects'],
    intervalMs: 15 * 60_000,   // 15 min
    maxResults: 5
  },
  BACKGROUND: {
    accounts: ['crypto_media', 'influencers'],
    intervalMs: 60 * 60_000,   // 1 hour
    maxResults: 3
  }
};

function startTieredPolling() {
  for (const [tier, config] of Object.entries(POLLING_TIERS)) {
    setInterval(async () => {
      for (const handle of config.accounts) {
        await pollAccount(handle, config.maxResults);
        await new Promise(r => setTimeout(r, 2000));
      }
    }, config.intervalMs);
  }
}
```

---

## Optimize Field Selection

Every field you request adds response payload. Only request fields you use:

```javascript
// Wasteful — fetches everything
const tweets = await client.v2.search(query, {
  expansions: ['author_id', 'attachments.media_keys', 'referenced_tweets.id'],
  'tweet.fields': ['created_at', 'public_metrics', 'entities', 'context_annotations', 'geo'],
  'user.fields': ['public_metrics', 'description', 'entities', 'location', 'pinned_tweet_id'],
  'media.fields': ['url', 'preview_image_url', 'duration_ms', 'public_metrics']
});

// Optimized — fetch only what the processing pipeline needs
const tweets = await client.v2.search(query, {
  'tweet.fields': ['created_at', 'author_id'],
  max_results: 10
});
```

Field selection doesn't reduce tweet count costs, but it reduces bandwidth and downstream processing time.

---

## Deduplication Before Storage

Avoid processing and storing the same tweet twice, which wastes downstream compute:

```javascript
const processedTweets = new Set();

async function deduplicateAndStore(tweet) {
  if (processedTweets.has(tweet.id)) return;
  processedTweets.add(tweet.id);

  // Also check DB for tweets that survived process restart
  const exists = await db.query(
    'SELECT 1 FROM tweets WHERE tweet_id = $1', [tweet.id]
  );
  if (exists.rows.length > 0) return;

  await storeTweet(tweet);
}
```

---

## Monthly Budget Alerts

Set up a hard stop before you hit your tier limit:

```javascript
async function checkMonthlyBudget() {
  const count = await redis.get('x:monthly_tweet_count');
  const TIER_LIMIT = parseInt(process.env.X_MONTHLY_TWEET_LIMIT || '500000');
  const WARNING_THRESHOLD = 0.8;

  if (parseInt(count) > TIER_LIMIT * WARNING_THRESHOLD) {
    await sendAlert(`X API at ${Math.round(count/TIER_LIMIT*100)}% of monthly budget`);
  }
}
```

---

## Conclusion

X API cost optimization for crypto startups follows a clear priority order: replace polling with streams wherever possible, batch all lookups to the maximum allowed count, cache stable data aggressively, and tier polling frequency by account importance. Most teams can cut costs by half without any loss of data coverage just by fixing the polling-vs-streaming mistake alone.
