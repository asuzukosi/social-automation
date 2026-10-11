# How to Build a Crypto Twitter Analytics Dashboard

**Meta description:** Learn how to build a crypto Twitter analytics dashboard that tracks mentions, sentiment, and influencer activity using the X API and Node.js.

---

## Introduction

Crypto markets move on social signals. A token can surge 30% in an hour because one account with 200k followers posted a thread. Building a real-time Twitter analytics dashboard gives you an information edge — you see the signal before it hits price charts.

This guide walks through building a production-ready crypto Twitter analytics dashboard using the X API v2, Node.js, and a PostgreSQL backend. No third-party analytics SaaS. No black-box sentiment scores. You own the pipeline.

---

## Architecture Overview

The dashboard has four components:

1. **Ingest layer** — X API filtered stream + search endpoints
2. **Processing layer** — sentiment scoring, entity extraction, deduplication
3. **Storage layer** — PostgreSQL for time-series data, Redis for real-time counts
4. **Frontend** — WebSocket-fed dashboard (Chart.js or similar)

Keep each layer independently deployable. The ingest layer gets rate-limited or banned; you want to swap it without touching storage.

---

## Setting Up the X API Ingest Layer

Use the filtered stream endpoint for real-time ingestion. Add rules targeting your tokens:

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);
const stream = client.v2.searchStream;

// Add rules before connecting
await client.v2.updateStreamRules({
  add: [
    { value: '#BTC OR #ETH OR bitcoin lang:en', tag: 'crypto-main' },
    { value: 'from:vitalikbuterin OR from:saylor', tag: 'influencers' },
  ],
});

const streamInstance = await client.v2.searchStream({
  'tweet.fields': ['created_at', 'author_id', 'public_metrics', 'entities'],
  'user.fields': ['public_metrics', 'verified'],
  expansions: ['author_id'],
});

streamInstance.on('data', (tweet) => processTweet(tweet));
streamInstance.on('error', (err) => reconnect(err));
```

Handle disconnections aggressively. The filtered stream drops connections every few hours. Implement exponential backoff with jitter, not a fixed retry interval.

---

## Sentiment Scoring Without External APIs

Simple lexicon-based scoring is fast and free. Maintain a domain-specific crypto wordlist:

```js
const BULLISH_TERMS = new Set([
  'moon', 'pump', 'breakout', 'accumulate', 'bullish',
  'ath', 'buy', 'long', 'dip', 'hodl',
]);
const BEARISH_TERMS = new Set([
  'dump', 'crash', 'rugpull', 'scam', 'bearish',
  'sell', 'short', 'dead', 'rekt', 'fud',
]);

function scoreTweet(text) {
  const words = text.toLowerCase().split(/\s+/);
  let score = 0;
  for (const word of words) {
    if (BULLISH_TERMS.has(word)) score += 1;
    if (BEARISH_TERMS.has(word)) score -= 1;
  }
  return Math.max(-5, Math.min(5, score)); // clamp to [-5, 5]
}
```

For higher accuracy, chain this with a lightweight LLM call (local Llama or OpenAI) only for high-engagement tweets (likes + retweets > threshold). That way you spend inference budget on tweets that actually matter.

---

## Storing Time-Series Data

Use PostgreSQL with a partitioned table for tweet volume:

```sql
CREATE TABLE tweet_metrics (
  id BIGSERIAL,
  token VARCHAR(20) NOT NULL,
  sentiment SMALLINT NOT NULL,
  author_followers INT NOT NULL,
  engagement INT NOT NULL,  -- likes + retweets + replies
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE tweet_metrics_2026_03
  PARTITION OF tweet_metrics
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE INDEX ON tweet_metrics (token, created_at DESC);
```

Aggregate into 5-minute buckets for the dashboard view. Running aggregates on raw tweet rows at query time kills performance once you hit millions of rows.

---

## Real-Time Dashboard with WebSockets

Push aggregated metrics to connected clients via Socket.io:

```js
import { Server } from 'socket.io';

const io = new Server(httpServer);

// Every 30 seconds, push fresh aggregates
setInterval(async () => {
  const metrics = await db.query(`
    SELECT
      token,
      COUNT(*) as tweet_count,
      AVG(sentiment) as avg_sentiment,
      SUM(engagement) as total_engagement
    FROM tweet_metrics
    WHERE created_at > NOW() - INTERVAL '5 minutes'
    GROUP BY token
    ORDER BY total_engagement DESC
  `);
  io.emit('metrics:update', metrics.rows);
}, 30_000);
```

On the frontend, Chart.js works well for time-series sentiment charts. Use a rolling 24-hour window as your default view. Add an "influencer alert" panel that highlights any tweet from accounts with >50k followers that scores above 3 sentiment.

---

## Influencer Detection and Weighting

Not all tweets carry equal weight. Weight engagement score by follower count:

```js
function weightedEngagement(tweet, authorMetrics) {
  const base = tweet.public_metrics.like_count
    + tweet.public_metrics.retweet_count * 3
    + tweet.public_metrics.reply_count;

  const followerMultiplier = Math.log10(
    Math.max(1, authorMetrics.followers_count)
  ) / 5;

  return Math.round(base * (1 + followerMultiplier));
}
```

Track which accounts consistently drive price-correlated volume. Build a leaderboard of accounts by weighted influence per token. This becomes your early-warning system.

---

## Conclusion

A crypto Twitter analytics dashboard gives you structured signal from an unstructured firehose. The architecture described here — filtered stream ingest, lexicon sentiment scoring, PostgreSQL time-series storage, WebSocket frontend — is deployable on a single $10/month VPS. Start with two or three tokens, validate that your sentiment scores correlate with price moves, then scale the ruleset. Own your data pipeline and you own your edge.
