# X API and Bull Queue: Processing High-Volume Crypto Social Data

**Meta description:** Learn how to build a Bull queue-based pipeline to process high-volume X API crypto data at scale, with rate limit management, job prioritization, and failure recovery.

---

## Introduction

At scale, X API data for crypto applications arrives faster than your downstream processing can handle it. A filtered stream for DeFi protocol mentions might deliver 500 to 5,000 tweets per hour during peak market activity. If you process each tweet synchronously inline, a single slow operation — an on-chain RPC call, a database write, an LLM enrichment — can cause your stream consumer to fall behind, triggering reconnects and data loss. Bull, the Redis-backed job queue, solves this by decoupling ingestion from processing and giving you durable, retriable, prioritized job execution.

This guide shows you how to build a production-grade Bull pipeline for high-volume X API crypto data.

---

## Architecture Overview

```
X API Filtered Stream
        │
        ▼
  Stream Consumer (fast, stateless)
        │  enqueue job
        ▼
   Bull Queue (Redis-backed)
        │
        ├── Worker: Sentiment Analysis
        ├── Worker: Contract Address Extraction
        ├── Worker: On-Chain Enrichment
        └── Worker: Alert Routing
```

The stream consumer does one thing: parse the tweet and push a job. All processing happens asynchronously in workers that can be scaled independently.

---

## Setting Up the Queue Infrastructure

```javascript
// api/services/cryptoDataQueue.js
import Bull from 'bull';

const REDIS_CONFIG = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379')
};

export const tweetIngestQueue = new Bull('tweet-ingest', { redis: REDIS_CONFIG });
export const enrichmentQueue = new Bull('tweet-enrichment', { redis: REDIS_CONFIG });
export const alertQueue = new Bull('crypto-alerts', { redis: REDIS_CONFIG });

// Global error handling for all queues
[tweetIngestQueue, enrichmentQueue, alertQueue].forEach(queue => {
  queue.on('failed', (job, err) => {
    console.error(`❌ Job ${job.id} in ${queue.name} failed: ${err.message}`);
  });
  queue.on('stalled', (job) => {
    console.warn(`⚠️ Job ${job.id} in ${queue.name} stalled`);
  });
});
```

---

## Stream Consumer: Fast Enqueue, Nothing Else

The stream consumer should be a thin layer that deserializes the tweet and immediately pushes to the queue:

```javascript
// src/stream/cryptoStreamConsumer.js
import fetch from 'node-fetch';
import { tweetIngestQueue } from '../../api/services/cryptoDataQueue.js';

const BEARER = process.env.X_BEARER_TOKEN;

export async function runCryptoStream() {
  const stream = await fetch(
    'https://api.twitter.com/2/tweets/search/stream?tweet.fields=created_at,author_id,entities,public_metrics&expansions=author_id',
    { headers: { Authorization: `Bearer ${BEARER}` } }
  );

  console.log('✅ Stream connected');

  for await (const chunk of stream.body) {
    const lines = chunk.toString().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (!event.data) continue;

        // Prioritize: tweets from high-authority accounts get higher Bull priority
        const priority = event.includes?.users?.[0]?.verified ? 1 : 5;

        await tweetIngestQueue.add(
          { tweet: event.data, matchingRules: event.matching_rules, author: event.includes?.users?.[0] },
          { priority, attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
        );
      } catch (_) {}
    }
  }
}
```

---

## Processing Workers

Define separate workers per processing concern. This lets you scale each independently based on load and rate limit constraints.

### Ingest Worker: First-Pass Processing

```javascript
// api/workers/ingestWorker.js
import { tweetIngestQueue, enrichmentQueue } from '../services/cryptoDataQueue.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ETH_ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;

tweetIngestQueue.process(5, async (job) => { // 5 concurrent
  const { tweet, matchingRules, author } = job.data;

  // Persist raw tweet
  await prisma.rawTweet.upsert({
    where: { tweetId: tweet.id },
    create: {
      tweetId: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      createdAt: new Date(tweet.created_at),
      ruleTag: matchingRules?.[0]?.tag ?? 'unknown'
    },
    update: {}
  });

  // Extract contract addresses for enrichment
  const addresses = tweet.text.match(ETH_ADDRESS_RE) ?? [];
  if (addresses.length) {
    await enrichmentQueue.add(
      { tweetId: tweet.id, addresses, text: tweet.text },
      { attempts: 5, backoff: { type: 'exponential', delay: 5000 } }
    );
  }
});
```

### Enrichment Worker: On-Chain Data with Rate Limiting

The enrichment worker hits external APIs (Etherscan, Alchemy), so it needs careful rate limit management:

```javascript
// api/workers/enrichmentWorker.js
import { enrichmentQueue, alertQueue } from '../services/cryptoDataQueue.js';
import { Throttle } from 'promise-throttle';

// Limit to 5 enrichment calls per second to respect API rate limits
const throttle = new Throttle({ requestsPerSecond: 5, promiseImplementation: Promise });

enrichmentQueue.process(3, async (job) => { // 3 concurrent max
  const { tweetId, addresses } = job.data;

  const enrichments = await Promise.all(
    addresses.map(addr =>
      throttle.add(() => enrichAddress(addr))
    )
  );

  const flagged = enrichments.filter(e => e.isContract && e.txCount < 10);
  if (flagged.length) {
    await alertQueue.add({ tweetId, flaggedAddresses: flagged }, { priority: 1 });
  }
});

async function enrichAddress(address) {
  const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}&page=1&offset=10`;
  const res = await fetch(url);
  const json = await res.json();
  return {
    address,
    isContract: json.result === 'Max rate limit reached' ? false : Array.isArray(json.result),
    txCount: Array.isArray(json.result) ? json.result.length : 0
  };
}
```

---

## Monitoring Queue Health

Bull exposes queue metrics that you can surface in your dashboard:

```javascript
// api/routes/queueHealth.js
import express from 'express';
import { tweetIngestQueue, enrichmentQueue, alertQueue } from '../services/cryptoDataQueue.js';

const router = express.Router();

router.get('/queues/health', async (req, res) => {
  const stats = await Promise.all([
    tweetIngestQueue, enrichmentQueue, alertQueue
  ].map(async queue => ({
    name: queue.name,
    waiting: await queue.getWaitingCount(),
    active: await queue.getActiveCount(),
    completed: await queue.getCompletedCount(),
    failed: await queue.getFailedCount(),
    delayed: await queue.getDelayedCount()
  })));

  res.json({ queues: stats, timestamp: new Date().toISOString() });
});

export default router;
```

Alert when `failed` count grows faster than `completed` or when `waiting` exceeds 10,000 — both indicate processing is falling behind ingestion.

---

## Handling X API Rate Limits in Workers

X's API enforces per-endpoint rate limits. When a worker hits a 429, Bull's exponential backoff handles the retry, but you should also surface the reset time:

```javascript
async function callXApi(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } });

  if (res.status === 429) {
    const resetAt = res.headers.get('x-rate-limit-reset');
    const waitMs = resetAt ? (parseInt(resetAt) * 1000 - Date.now()) : 60_000;
    throw new Error(`X rate limit hit. Reset in ${Math.ceil(waitMs / 1000)}s`);
  }

  return res.json();
}
```

Bull will respect the `backoff` configuration and retry after the delay, without blocking other concurrent jobs.

---

## Conclusion

Bull queues transform a fragile synchronous stream processing pipeline into a scalable, fault-tolerant system. The key architectural decision is keeping the stream consumer as thin as possible — its only job is to read bytes and push jobs. All enrichment, analysis, and alerting happens in workers that can be scaled, paused, and monitored independently. For high-volume crypto social data where missing a drainer alert or a liquidation signal has real consequences, this architecture provides the durability and observability that inline processing cannot.
