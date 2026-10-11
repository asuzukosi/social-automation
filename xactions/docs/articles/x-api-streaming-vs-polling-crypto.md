# X API Streaming vs Polling: Best Approach for Crypto Data

**Meta description:** Compare X API filtered streaming versus polling for crypto data pipelines — understand latency trade-offs, cost implications, reliability patterns, and when to use each approach for maximum efficiency.

---

## Introduction

Every crypto data pipeline built on X API faces the same architectural decision: stream or poll? The wrong choice costs money, introduces latency, or both. For crypto use cases — where a tweet about a protocol exploit or a stablecoin depeg can move markets in seconds — the stakes are higher than most domains.

This guide breaks down exactly when to use filtered streaming versus search polling, with concrete cost and latency comparisons for common crypto monitoring scenarios.

---

## How Each Approach Works

### Filtered Streaming

The X API v2 filtered stream (`/2/tweets/search/stream`) maintains a persistent HTTP connection. Matching tweets are pushed to your client as they're published — typically within 1-3 seconds of posting.

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

// Persistent connection — tweets arrive as they're posted
const stream = await client.v2.searchStream({
  'tweet.fields': ['author_id', 'created_at', 'entities'],
  expansions: ['author_id']
});

stream.on('data', (tweet) => {
  // ~1-3 second latency from post to receipt
  handleTweet(tweet.data);
});
```

### Search Polling

The search endpoint (`/2/tweets/search/recent`) lets you query the last 7 days of tweets. You call it on a schedule and track the `newest_id` to avoid re-processing.

```javascript
let sinceId = null;

async function poll() {
  const params = {
    query: 'from:tether_to -is:retweet',
    max_results: 100,
    'tweet.fields': ['created_at', 'author_id'],
    ...(sinceId && { since_id: sinceId })
  };

  const response = await client.v2.search(params.query, params);

  if (response.data?.length) {
    sinceId = response.data[0].id; // newest tweet becomes next cursor
    response.data.forEach(handleTweet);
  }
}

// Poll every 5 minutes
setInterval(poll, 5 * 60 * 1000);
```

---

## Head-to-Head Comparison

| Dimension | Filtered Streaming | Search Polling |
|---|---|---|
| Latency | 1-3 seconds | Polling interval (60s - 15min) |
| Cost per tweet | Near-zero after connection | Counts against monthly tweet cap |
| Scalability | Up to 25 concurrent rules (Basic), 1000 (Pro) | Unlimited queries, capped by tweet budget |
| Backfill | No (only live tweets) | Yes (last 7 days) |
| Reliability | Requires reconnect logic | Stateless — just retry |
| Complexity | Higher (connection management) | Lower (simple HTTP calls) |
| Rate limits | 50 req/15min for rule management | 1 req/15sec (Basic), 1 req/1sec (Pro) |

---

## Decision Framework for Crypto Use Cases

### Use Streaming When:

**1. Latency is critical**

Exploit announcements, depeg alerts, exchange outages — anything where a 10-minute delay makes the data useless.

```javascript
// Good streaming use case: security incident monitoring
const CRITICAL_STREAM_RULES = [
  {
    value: '(hack OR exploit OR drain OR attack OR vulnerability) (defi OR protocol OR bridge) -is:retweet',
    tag: 'security-critical'
  },
  {
    value: '(depeg OR "bank run" OR "peg lost" OR "peg broken") (USDT OR USDC OR DAI) -is:retweet',
    tag: 'stablecoin-critical'
  }
];
```

**2. You're monitoring specific accounts continuously**

Monitoring Tether, Circle, or exchange status accounts works best as a stream — you don't want to miss any tweet.

**3. Volume is unpredictable**

Keyword-based crypto monitoring can produce bursts (during market events) or silence (quiet markets). Streaming handles both without wasted polling requests.

### Use Polling When:

**1. You need historical backfill**

Starting a new monitoring system and need the last 7 days of data:

```javascript
async function backfillHistory(query, days = 7) {
  let nextToken;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const results = [];

  do {
    const response = await client.v2.search(query, {
      max_results: 100,
      start_time: cutoff,
      'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
      ...(nextToken && { next_token: nextToken })
    });

    if (response.data) results.push(...response.data);
    nextToken = response.meta?.next_token;

    await new Promise(r => setTimeout(r, 1000)); // rate limit padding
  } while (nextToken);

  return results;
}
```

**2. You need complex query logic beyond stream rule limits**

Stream rules support a subset of search operators. For queries with many OR conditions, complex boolean logic, or operator combinations not supported in streams, polling is the only option.

**3. Sporadic monitoring is acceptable**

Checking daily digest data, weekly reporting, or batch analysis jobs don't need streaming latency.

---

## Hybrid Architecture

The production-grade approach uses both:

```javascript
class CryptoMonitor {
  constructor() {
    this.streamRules = [];
    this.pollJobs = [];
  }

  // High-priority signals go to streaming
  addStreamRule(query, tag, handler) {
    this.streamRules.push({ query, tag, handler });
  }

  // Lower-priority or complex queries go to polling
  addPollJob(query, intervalMs, handler) {
    this.pollJobs.push({ query, intervalMs, handler, sinceId: null });
  }

  async start() {
    await this.initStream();
    this.initPolling();
  }

  async initStream() {
    await client.v2.updateStreamRules({
      add: this.streamRules.map(r => ({ value: r.query, tag: r.tag }))
    });

    const stream = await client.v2.searchStream({ 'tweet.fields': ['author_id', 'created_at'] });

    stream.on('data', tweet => {
      const matchedRule = this.streamRules.find(r => r.tag === tweet.matching_rules?.[0]?.tag);
      matchedRule?.handler(tweet.data);
    });

    stream.on('error', err => {
      console.error('Stream error:', err);
      setTimeout(() => this.initStream(), 5000); // reconnect
    });
  }

  initPolling() {
    for (const job of this.pollJobs) {
      setInterval(async () => {
        const response = await client.v2.search(job.query, {
          max_results: 100,
          ...(job.sinceId && { since_id: job.sinceId })
        });

        if (response.data?.length) {
          job.sinceId = response.data[0].id;
          response.data.forEach(job.handler);
        }
      }, job.intervalMs);
    }
  }
}

// Usage
const monitor = new CryptoMonitor();

// Stream: critical real-time signals
monitor.addStreamRule(
  '(hack OR exploit OR depeg) -is:retweet lang:en',
  'security', handleSecurityAlert
);

// Poll: engagement metrics (don't need real-time)
monitor.addPollJob(
  '#ethereum developer ecosystem -is:retweet min_faves:100',
  15 * 60 * 1000,
  handleEngagementData
);
```

---

## Reconnection and Reliability for Streams

Streams disconnect. Handle it:

```javascript
async function connectStreamWithBackoff(maxAttempts = 10) {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      const stream = await client.v2.searchStream({ autoConnect: false });

      await stream.connect({ autoReconnect: true, autoReconnectRetries: Infinity });

      stream.on('connected', () => {
        attempt = 0; // reset on successful connection
        console.log('Stream connected');
      });

      return stream;
    } catch (err) {
      const backoff = Math.min(1000 * Math.pow(2, attempt), 120_000);
      console.error(`Connection failed (attempt ${attempt + 1}), retry in ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
      attempt++;
    }
  }

  throw new Error('Max reconnection attempts reached');
}
```

---

## Cost Comparison Example

For monitoring 20 crypto accounts, assuming average 5 tweets/hour per account = 100 tweets/hour:

| Approach | Monthly tweets consumed | Notes |
|---|---|---|
| Stream (all accounts) | ~72,000 | Tweets pushed to you |
| Poll every 5 min (20 accounts) | ~72,000 + ~576,000 empty requests | Most polls return nothing |
| Poll every hour (20 accounts) | ~72,000 + ~14,400 requests | Higher latency, fewer wasted calls |

For high-frequency monitoring, streaming is cheaper per tweet received. For infrequent checks where most polls return nothing, polling burns request quota on empty responses.

---

## Conclusion

For crypto applications where timing matters — security incidents, depeg events, governance announcements — filtered streaming is the correct architecture. For backfill, complex boolean queries, and batch analytics, polling is the right tool. Most production systems use both: a streaming layer for critical real-time signals and a polling layer for periodic, lower-priority data collection. The key constraint to design around is your monthly tweet budget — streaming is dramatically more efficient when the expected tweet volume is high relative to polling frequency.
