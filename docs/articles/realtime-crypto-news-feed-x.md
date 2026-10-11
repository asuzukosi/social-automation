# Building a Real-Time Crypto News Feed from X

**Meta description:** Build a real-time crypto news feed from X using filtered streams, Socket.io, and a React frontend — covering stream setup, deduplication, relevance scoring, and live updates.

---

## Introduction

Crypto moves on information, and X is where information appears first. A real-time news feed that aggregates X posts from key accounts, filters for signal, and delivers updates to users as they happen is a foundational tool for any crypto application. This guide covers the full pipeline: X filtered stream on the backend, Socket.io for real-time delivery, and a minimal frontend integration.

---

## Architecture

```
X Filtered Stream → Node.js Backend → Socket.io → Browser Client
                          ↓
                    Deduplication
                    Relevance Score
                    PostgreSQL (history)
```

The backend processes and filters the raw stream, scores each item for relevance, deduplicates, stores to database, and broadcasts to connected clients via Socket.io.

---

## Setting Up the Filtered Stream

X API v2 filtered stream requires Basic tier access. Define rules targeting crypto news sources and keywords:

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

const STREAM_RULES = [
  // Top crypto media accounts
  {
    value: 'from:Cointelegraph OR from:CoinDesk OR from:TheBlock__ OR from:decrypt_co -is:retweet',
    tag: 'crypto-media',
  },
  // Breaking news keywords from high-follower accounts
  {
    value: '(bitcoin OR ethereum OR crypto) (SEC OR hack OR "hard fork" OR ETF OR regulatory) -is:retweet lang:en',
    tag: 'crypto-news-keywords',
  },
  // DeFi protocol announcements
  {
    value: 'from:Uniswap OR from:aave OR from:MakerDAO OR from:compoundfinance -is:retweet',
    tag: 'defi-protocols',
  },
];

async function initStreamRules() {
  const existing = await client.v2.streamRules();
  if (existing.data?.length) {
    await client.v2.updateStreamRules({
      delete: { ids: existing.data.map(r => r.id) },
    });
  }
  await client.v2.updateStreamRules({ add: STREAM_RULES });
  console.log('Stream rules set');
}
```

---

## Connecting to the Stream

```js
let activeStream = null;

async function startStream(onItem) {
  await initStreamRules();

  activeStream = await client.v2.searchStream({
    'tweet.fields': ['created_at', 'author_id', 'entities', 'public_metrics'],
    'user.fields': ['username', 'name', 'verified', 'profile_image_url'],
    expansions: ['author_id', 'entities.urls.unwound_url'],
  });

  activeStream.on('data', (rawTweet) => {
    const item = processStreamItem(rawTweet);
    if (item) onItem(item);
  });

  activeStream.on('error', (err) => {
    console.error('Stream error:', err);
    reconnectStream(onItem);
  });
}

async function reconnectStream(onItem) {
  if (activeStream) activeStream.close();
  await new Promise(r => setTimeout(r, 5000));
  await startStream(onItem);
}
```

---

## Processing and Scoring Stream Items

Score each item for news relevance before broadcasting:

```js
const HIGH_SIGNAL_KEYWORDS = [
  'breaking', 'just in', 'alert', 'hack', 'exploit', 'SEC', 'ETF',
  'approved', 'rejected', 'launched', 'partnership', 'listing',
];

function scoreRelevance(tweet) {
  const text = tweet.text.toLowerCase();
  const metrics = tweet.public_metrics;

  let score = 0;
  score += HIGH_SIGNAL_KEYWORDS.filter(k => text.includes(k)).length * 10;
  score += Math.log1p(metrics.retweet_count ?? 0) * 5;
  score += Math.log1p(metrics.like_count ?? 0) * 2;

  return Math.min(100, score);
}

function processStreamItem(raw) {
  const tweet = raw.data;
  const author = raw.includes?.users?.[0];

  const score = scoreRelevance(tweet);
  if (score < 5) return null; // filter low-signal items

  return {
    id: tweet.id,
    text: tweet.text,
    createdAt: tweet.created_at,
    score,
    author: {
      id: tweet.author_id,
      username: author?.username,
      name: author?.name,
      verified: author?.verified ?? false,
      avatar: author?.profile_image_url,
    },
    urls: tweet.entities?.urls?.map(u => u.expanded_url) ?? [],
    metrics: tweet.public_metrics,
    tags: raw.matching_rules?.map(r => r.tag) ?? [],
  };
}
```

---

## Deduplication

Stories break across multiple accounts simultaneously. Deduplicate by URL domain and approximate content similarity:

```js
const recentItems = new Map(); // itemId -> item
const DEDUP_WINDOW = 30 * 60 * 1000; // 30 minutes

function isDuplicate(item) {
  const now = Date.now();

  // Clean old entries
  for (const [id, stored] of recentItems) {
    if (now - stored.ts > DEDUP_WINDOW) recentItems.delete(id);
  }

  // Check for same URL
  for (const url of item.urls) {
    const domain = new URL(url).hostname;
    for (const stored of recentItems.values()) {
      if (stored.domains.has(domain)) return true;
    }
  }

  recentItems.set(item.id, {
    ts: now,
    domains: new Set(item.urls.map(u => new URL(u).hostname)),
  });

  return false;
}
```

---

## Broadcasting with Socket.io

```js
import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL },
});

const newsQueue = [];
const MAX_QUEUE = 100;

io.on('connection', (socket) => {
  // Send recent items on connect
  socket.emit('history', newsQueue.slice(-20));
});

function broadcastItem(item) {
  newsQueue.push(item);
  if (newsQueue.length > MAX_QUEUE) newsQueue.shift();
  io.emit('news-item', item);
}

// Start the stream
startStream((item) => {
  if (!isDuplicate(item)) {
    broadcastItem(item);
    saveToDatabase(item);
  }
});
```

---

## Frontend Integration

Minimal client-side integration with the Socket.io client:

```js
import { io } from 'socket.io-client';

const socket = io(process.env.API_URL);

socket.on('history', (items) => {
  renderFeed(items.reverse()); // most recent first
});

socket.on('news-item', (item) => {
  prependToFeed(item);
});

function prependToFeed(item) {
  const container = document.getElementById('news-feed');
  const el = document.createElement('div');
  el.className = 'news-item';
  el.innerHTML = `
    <span class="score">${item.score}</span>
    <a href="https://x.com/i/web/status/${item.id}" target="_blank">
      <strong>@${item.author.username}</strong>: ${item.text.slice(0, 200)}
    </a>
    <time>${new Date(item.createdAt).toLocaleTimeString()}</time>
  `;
  container.prepend(el);

  // Cap feed length
  while (container.children.length > 50) {
    container.lastChild.remove();
  }
}
```

---

## Conclusion

A real-time crypto news feed from X is a filtered stream pipeline, not a polling system. Define precise stream rules targeting known news accounts and high-signal keywords, score items on ingest to filter noise, deduplicate by URL to avoid story repetition, and deliver via Socket.io for true real-time updates. This architecture scales to hundreds of concurrent users with a single Node.js process and delivers news within seconds of posting.
