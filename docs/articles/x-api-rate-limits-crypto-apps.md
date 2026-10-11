# X API Rate Limits: A Guide for High-Volume Crypto Apps

**Meta description:** X API rate limits explained for crypto developers — per-endpoint limits by tier, handling 429 errors, implementing exponential backoff, request queuing strategies, and how to stay within limits during high-volatility events.

---

## Introduction

Rate limits are the wall every crypto developer hits eventually. During a Bitcoin breakout or a major token listing, X activity spikes dramatically — and your app's API consumption spikes with it. Without proper rate limit handling, your crypto intelligence tool goes dark at exactly the moment it's most needed.

This guide covers X API v2 rate limits in detail: what they are per tier and endpoint, how to detect and handle them programmatically, and how to architect your app to stay operational during high-volume events.

---

## Rate Limit Structure

X API v2 rate limits operate on two dimensions:

1. **Time windows** — most limits reset every 15 minutes
2. **Request counts** — maximum calls allowed within that window

Limits apply per:
- **App** — shared across all users of your application
- **User** — per authenticated user (for user-context endpoints)

---

## Limits by Tier and Endpoint

### Free Tier ($0/month)

| Endpoint | Limit | Window |
|---|---|---|
| `POST /2/tweets` | 17 posts | 24 hours |
| `GET /2/tweets/search/recent` | 1 request | 15 minutes |
| `GET /2/users/:id/tweets` | 1 request | 15 minutes |
| Filtered Stream | Not available | — |

Free is non-functional for any real crypto app.

### Basic Tier ($100/month)

| Endpoint | Limit | Window |
|---|---|---|
| `POST /2/tweets` | 100 posts | 24 hours |
| `GET /2/tweets/search/recent` | 60 requests | 15 minutes |
| `GET /2/users/by` | 300 requests | 15 minutes |
| `GET /2/users/:id/tweets` | 15 requests | 15 minutes |
| Filtered Stream rules | 50 concurrent | — |
| Stream connections | 1 | — |

### Pro Tier ($5,000/month)

| Endpoint | Limit | Window |
|---|---|---|
| `POST /2/tweets` | 300 posts | 3 hours |
| `GET /2/tweets/search/recent` | 300 requests | 15 minutes |
| `GET /2/users/:id/tweets` | 900 requests | 15 minutes |
| Filtered Stream rules | 1,000 concurrent | — |
| Stream connections | 2 | — |

---

## Reading Rate Limit Headers

Every X API response includes rate limit information in headers:

```javascript
async function callWithLimitTracking(url, options) {
  const res = await fetch(url, options);

  const limits = {
    limit: parseInt(res.headers.get('x-rate-limit-limit') ?? '0'),
    remaining: parseInt(res.headers.get('x-rate-limit-remaining') ?? '0'),
    reset: parseInt(res.headers.get('x-rate-limit-reset') ?? '0') * 1000 // to ms
  };

  if (limits.remaining < 5) {
    const resetIn = limits.reset - Date.now();
    console.warn(`⚠️ Rate limit low: ${limits.remaining} remaining, resets in ${Math.ceil(resetIn / 1000)}s`);
  }

  return { response: res, limits };
}
```

Track these headers across all API calls. Build a rate limit state tracker that knows when each endpoint's window resets before hitting a 429.

---

## Handling 429 Errors

When you exceed a rate limit, X returns HTTP 429 with a `Retry-After` header:

```javascript
class RateLimitError extends Error {
  constructor(retryAfter) {
    super('Rate limit exceeded');
    this.retryAfter = retryAfter;
  }
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '60') * 1000;
        console.log(`🔄 Rate limited. Waiting ${retryAfter / 1000}s before retry ${attempt + 1}/${maxRetries}`);
        await sleep(retryAfter);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res;

    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 1000;
        await sleep(backoff);
      }
    }
  }

  throw lastError;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
```

---

## Proactive Rate Limit Management

Don't wait for 429s — track your own usage and throttle proactively:

```javascript
class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  init(endpoint, limit, windowMs) {
    this.buckets.set(endpoint, {
      limit,
      remaining: limit,
      resetAt: Date.now() + windowMs,
      windowMs
    });
  }

  async throttle(endpoint) {
    const bucket = this.buckets.get(endpoint);
    if (!bucket) return; // Unknown endpoint — proceed

    // Reset if window has passed
    if (Date.now() > bucket.resetAt) {
      bucket.remaining = bucket.limit;
      bucket.resetAt = Date.now() + bucket.windowMs;
    }

    if (bucket.remaining <= 1) {
      const waitMs = bucket.resetAt - Date.now();
      console.log(`⏳ Throttling ${endpoint} for ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs + 100); // 100ms buffer
      bucket.remaining = bucket.limit;
      bucket.resetAt = Date.now() + bucket.windowMs;
    }

    bucket.remaining--;
  }
}

// Usage
const limiter = new RateLimiter();
limiter.init('search', 60, 15 * 60 * 1000); // Basic: 60 req / 15 min

async function rateLimitedSearch(query) {
  await limiter.throttle('search');
  return callAPI(`/2/tweets/search/recent?query=${encodeURIComponent(query)}`);
}
```

---

## Request Queue for High-Volume Periods

During high-volatility events (BTC ATH, major token listing), queue API requests rather than dropping them:

```javascript
import PQueue from 'p-queue';

// Basic tier: 60 search requests / 15 min = 4 per minute
const searchQueue = new PQueue({
  interval: 60_000,
  intervalCap: 4
});

// Pro tier: 300 search requests / 15 min = 20 per minute
// const searchQueue = new PQueue({ interval: 60_000, intervalCap: 20 });

export async function queuedSearch(query, priority = 0) {
  return searchQueue.add(
    () => performSearch(query),
    { priority }
  );
}

// High-priority searches jump the queue
queuedSearch('$BTC exploit', 10);     // Priority 10 — runs first
queuedSearch('$ETH price', 1);        // Priority 1 — runs later
```

---

## Caching to Reduce API Consumption

Cache responses aggressively. User profiles don't change minute-to-minute:

```javascript
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });

async function cachedUserLookup(username) {
  const cacheKey = `x:user:${username}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const user = await client.v2.userByUsername(username, {
    'user.fields': ['public_metrics', 'description', 'verified']
  });

  // Cache for 1 hour
  await redis.setEx(cacheKey, 3600, JSON.stringify(user.data));
  return user.data;
}
```

Cache TTLs by data type:
- User profiles: 1-6 hours
- Timeline snapshots: 15 minutes
- Search results: 5 minutes (cashtag volume changes fast)
- Stream rules: don't cache — manage state locally

---

## Architecture for High-Volume Events

When you know a high-volume event is coming (major exchange listing, Fed announcement), preemptively switch to streaming rather than search polling:

```javascript
// Polling: hits rate limits during high-volume periods
// setInterval(() => searchCashtag('$BTC'), 60_000);

// Streaming: single persistent connection, no per-request limits
// Switch to this before high-volume events
await connectFilteredStream(['$BTC lang:en -is:retweet']);
```

The Filtered Stream has volume caps (tweets/month) but no per-request rate limit — it's a persistent connection. This makes it dramatically more resilient during market events.

---

## Monitoring Your Usage

Build a simple usage dashboard:

```javascript
const usageLog = [];

function logAPICall(endpoint, remaining, resetAt) {
  usageLog.push({
    endpoint,
    timestamp: new Date().toISOString(),
    remaining,
    resetAt: new Date(resetAt).toISOString()
  });

  // Alert if any endpoint is critically low
  if (remaining < 3) {
    console.error(`❌ CRITICAL: ${endpoint} has only ${remaining} calls remaining`);
  }
}

// Summary report
function getUsageSummary() {
  const last15min = usageLog.filter(l => Date.now() - new Date(l.timestamp) < 900_000);
  const byEndpoint = {};

  for (const log of last15min) {
    byEndpoint[log.endpoint] = (byEndpoint[log.endpoint] ?? 0) + 1;
  }

  return byEndpoint;
}
```

---

## Conclusion

Rate limits are a design constraint, not a failure condition. Build proactive tracking, request queuing, and response caching into your architecture from the start rather than bolting on retry logic after you hit your first 429. During high-volatility crypto events — the moments your app matters most — the difference between streaming (rate-limit-resilient) and polling (rate-limit-fragile) is often the difference between your tool working or going dark.

---

*Related: [X Developer API in 2026: The Complete Guide for Crypto Builders](../x-developer-api-crypto-guide-2026.md)*
