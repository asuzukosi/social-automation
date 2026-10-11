# X API and Node.js: Building Crypto Data Pipelines

**Meta description:** Learn how to build production-grade crypto data pipelines with the X API and Node.js, covering streaming, batching, transformation, storage, and rate limit management.

---

## Introduction

The X API is one of the richest real-time data sources available to crypto developers. Price signals, project announcements, exploit alerts, sentiment shifts — all of it flows through X before it hits any structured data provider. But raw tweet streams are noisy, unstructured, and rate-limited. Building a production pipeline that turns X data into usable crypto intelligence requires careful architecture decisions across streaming, parsing, storage, and rate limit management.

This guide covers the complete Node.js stack for building crypto data pipelines on top of the X API v2.

---

## Pipeline Architecture Overview

A production crypto X pipeline has five layers:

1. **Ingestion** — filtered stream or polling timeline endpoints
2. **Validation** — deduplicate, filter spam, verify format
3. **Transformation** — extract entities, classify content, score signals
4. **Storage** — time-series DB, relational DB, or message queue
5. **Delivery** — webhook, WebSocket push, REST query layer

Each layer should be independently scalable and failure-isolated. Use Bull queues between stages so a slow transformation layer doesn't back-pressure your stream reader.

---

## Setting Up the Ingestion Layer

```javascript
// src/pipelines/ingestion/streamReader.js
import { EventEmitter } from 'events';

export class XStreamReader extends EventEmitter {
  constructor({ bearerToken, rules, fields }) {
    super();
    this.bearerToken = bearerToken;
    this.rules = rules;
    this.fields = fields ?? 'created_at,author_id,entities,public_metrics';
    this.running = false;
    this.reconnectDelay = 1000;
  }

  async start() {
    await this._applyRules();
    this.running = true;
    this._connect();
  }

  async _connect() {
    while (this.running) {
      try {
        const response = await fetch(
          `https://api.twitter.com/2/tweets/search/stream?tweet.fields=${this.fields}&expansions=author_id&user.fields=username,public_metrics`,
          {
            headers: { Authorization: `Bearer ${this.bearerToken}` },
            signal: AbortSignal.timeout(90_000), // reconnect every 90s max
          }
        );

        if (!response.ok) {
          this.emit('error', new Error(`Stream HTTP ${response.status}`));
          await this._backoff();
          continue;
        }

        this.reconnectDelay = 1000; // reset on success

        for await (const chunk of response.body) {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              this.emit('tweet', JSON.parse(line));
            } catch {} // heartbeat empty lines
          }
        }
      } catch (err) {
        if (this.running) {
          this.emit('reconnect', err);
          await this._backoff();
        }
      }
    }
  }

  async _backoff() {
    await new Promise(r => setTimeout(r, this.reconnectDelay));
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
  }

  stop() { this.running = false; }
}
```

---

## The Transformation Layer

Parse, enrich, and classify raw tweets before storage:

```javascript
// src/pipelines/transform/cryptoTransformer.js
export function transformTweet(raw) {
  const { data: tweet, includes, matching_rules } = raw;
  const author = includes?.users?.find(u => u.id === tweet.author_id);

  return {
    id: tweet.id,
    text: tweet.text,
    createdAt: new Date(tweet.created_at),
    authorId: tweet.author_id,
    authorUsername: author?.username,
    authorFollowers: author?.public_metrics?.followers_count ?? 0,
    authorVerified: author?.verified ?? false,
    matchedRules: matching_rules?.map(r => r.tag) ?? [],
    entities: extractCryptoEntities(tweet.text),
    sentiment: classifySentiment(tweet.text),
    category: categorize(matching_rules),
    engagementScore: computeEngagement(tweet.public_metrics, author?.public_metrics),
    raw: tweet.text,
  };
}

function extractCryptoEntities(text) {
  const tickers = [...text.matchAll(/\$([A-Z]{2,6})\b/g)].map(m => m[1]);
  const addresses = [...text.matchAll(/0x[a-fA-F0-9]{40}/g)].map(m => m[0]);
  const prices = [...text.matchAll(/\$?([\d,]+(?:\.\d+)?)\s*(?:USD|USDC|USDT)?/g)]
    .map(m => parseFloat(m[1].replace(',', '')))
    .filter(p => p > 0);
  const amounts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ETH|BTC|SOL|MATIC)/gi)]
    .map(m => ({ amount: parseFloat(m[1]), token: m[2].toUpperCase() }));

  return { tickers: [...new Set(tickers)], addresses, prices, amounts };
}

function classifySentiment(text) {
  const bullish = ['moon', 'bullish', 'breakout', 'ath', 'buy', 'long', 'pump', 'surge'];
  const bearish = ['bearish', 'dump', 'crash', 'rekt', 'sell', 'short', 'collapse', 'rug'];
  const lower = text.toLowerCase();
  const bullScore = bullish.filter(w => lower.includes(w)).length;
  const bearScore = bearish.filter(w => lower.includes(w)).length;
  if (bullScore > bearScore) return 'bullish';
  if (bearScore > bullScore) return 'bearish';
  return 'neutral';
}

function computeEngagement(tweetMetrics, authorMetrics) {
  if (!tweetMetrics || !authorMetrics?.followers_count) return 0;
  const engagements = (tweetMetrics.like_count ?? 0) + (tweetMetrics.retweet_count ?? 0) * 2;
  return Math.round((engagements / Math.max(authorMetrics.followers_count, 1)) * 10000) / 100;
}
```

---

## Rate Limit Management

The X API enforces strict rate limits. Build a rate limit manager:

```javascript
// src/pipelines/utils/rateLimiter.js
export class RateLimiter {
  constructor(requestsPerWindow, windowMs) {
    this.limit = requestsPerWindow;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async throttle() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);

    if (this.requests.length >= this.limit) {
      const oldest = this.requests[0];
      const waitMs = this.windowMs - (now - oldest) + 100;
      await new Promise(r => setTimeout(r, waitMs));
    }

    this.requests.push(Date.now());
  }
}

// Usage: 15 requests per 15-minute window for user timeline
const timelineLimiter = new RateLimiter(15, 15 * 60 * 1000);

async function fetchUserTimeline(userId) {
  await timelineLimiter.throttle();
  return fetch(`https://api.twitter.com/2/users/${userId}/tweets`, {
    headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` }
  }).then(r => r.json());
}
```

---

## Storage: TimescaleDB for Time-Series Tweet Data

For crypto data pipelines, time-series storage is often more useful than relational:

```sql
-- TimescaleDB hypertable for tweet signals
CREATE TABLE crypto_signals (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  author_username TEXT,
  author_followers INTEGER,
  matched_rules TEXT[],
  tickers TEXT[],
  sentiment TEXT,
  engagement_score DECIMAL,
  category TEXT,
  raw_text TEXT
);

SELECT create_hypertable('crypto_signals', 'created_at');
CREATE INDEX ON crypto_signals (tickers, created_at DESC);
CREATE INDEX ON crypto_signals (category, created_at DESC);
```

Insert via the `pg` client in your Node.js pipeline:

```javascript
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function storeSignal(signal) {
  await pool.query(
    `INSERT INTO crypto_signals (id, created_at, author_username, author_followers,
     matched_rules, tickers, sentiment, engagement_score, category, raw_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [signal.id, signal.createdAt, signal.authorUsername, signal.authorFollowers,
     signal.matchedRules, signal.entities.tickers, signal.sentiment,
     signal.engagementScore, signal.category, signal.raw]
  );
}
```

---

## Conclusion

A production crypto X pipeline is built in layers: a resilient stream reader with exponential backoff reconnection, a transformation layer that extracts structured entities and computes engagement scores, rate limit management for polling endpoints, and a time-series store optimized for time-range queries across tickers and categories. This architecture handles the full lifecycle from raw tweet to queryable intelligence, and each layer can be scaled independently as your data volume grows.
