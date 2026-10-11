# Building a DeFi News Aggregator with X Streaming API

**Meta description:** How to build a DeFi news aggregator using the X Streaming API — designing filter rules for DeFi protocols, classifying tweet types (news vs. alpha vs. FUD), deduplicating content, and delivering a ranked feed.

---

## Introduction

DeFi moves fast. Protocol exploits, yield opportunity launches, governance votes, airdrop announcements, and regulatory news all break on X before they reach any structured news source. A DeFi news aggregator built on the X Streaming API can surface these events in real time, filter out noise, and deliver ranked, categorized alerts to your team or users.

This guide builds a complete aggregator: stream rules targeting DeFi content, tweet classification, deduplication, and a ranked feed output.

---

## What You're Building

```
X Filtered Stream ──→ Rule-based ingestion
                            │
                     Classification layer
                     (news / alpha / FUD / announcement)
                            │
                     Deduplication engine
                            │
                     Relevance ranking
                            │
                     Output: feed API / Slack / Discord
```

The aggregator doesn't require an LLM for basic classification — a combination of keyword rules, account allowlists, and engagement thresholds gets you most of the way there.

---

## Step 1: Define DeFi Stream Rules

DeFi covers a wide surface area. Organize rules by category:

```javascript
const DEFI_STREAM_RULES = [
  // Protocol-specific
  { value: 'Uniswap (exploit OR hack OR upgrade OR governance) lang:en -is:retweet', tag: 'uniswap-event' },
  { value: 'Aave (exploit OR hack OR upgrade OR governance) lang:en -is:retweet', tag: 'aave-event' },
  { value: 'Curve Finance (exploit OR hack OR upgrade) lang:en -is:retweet', tag: 'curve-event' },
  { value: 'Compound (exploit OR hack OR upgrade OR governance) lang:en -is:retweet', tag: 'compound-event' },

  // Category-level
  { value: '(DeFi OR "decentralized finance") exploit OR hack OR "security issue" lang:en -is:retweet', tag: 'defi-security' },
  { value: '(DeFi OR defi) airdrop (claim OR live OR announced) lang:en -is:retweet', tag: 'defi-airdrop' },
  { value: '(yield OR APY OR APR) (new OR launched OR live) DeFi lang:en -is:retweet', tag: 'defi-yield' },
  { value: '"TVL" (surpassed OR milestone OR dropped) lang:en -is:retweet', tag: 'tvl-change' },

  // On-chain event correlation
  { value: '"smart contract" (paused OR upgrade OR exploit) lang:en -is:retweet', tag: 'contract-event' },
  { value: '$ETH OR $ARB OR $OP (gas OR bridge OR L2) -is:retweet lang:en', tag: 'l2-news' }
];
```

Basic tier supports 50 concurrent rules. You can cover the major DeFi protocols individually plus category-level sweeps within that limit.

---

## Step 2: Set Up the Stream

```javascript
import fetch from 'node-fetch';

const BEARER = process.env.X_BEARER_TOKEN;
const BASE = 'https://api.twitter.com/2';

async function applyRules(rules) {
  // Clear existing
  const existing = await (await fetch(`${BASE}/tweets/search/stream/rules`, {
    headers: { Authorization: `Bearer ${BEARER}` }
  })).json();

  if (existing.data?.length) {
    await fetch(`${BASE}/tweets/search/stream/rules`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BEARER}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: { ids: existing.data.map(r => r.id) } })
    });
  }

  // Add new rules
  await fetch(`${BASE}/tweets/search/stream/rules`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BEARER}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: rules })
  });
}

async function openStream(onTweet) {
  const params = new URLSearchParams({
    'tweet.fields': 'created_at,author_id,public_metrics,entities,referenced_tweets',
    'user.fields': 'name,username,verified,public_metrics',
    'expansions': 'author_id,referenced_tweets.id'
  });

  const res = await fetch(`${BASE}/tweets/search/stream?${params}`, {
    headers: { Authorization: `Bearer ${BEARER}` }
  });

  for await (const chunk of res.body) {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const payload = JSON.parse(line);
        if (payload.data) onTweet(payload);
      } catch { /* heartbeat */ }
    }
  }
}
```

---

## Step 3: Classify Incoming Tweets

Assign each tweet a category and confidence level:

```javascript
const CATEGORIES = {
  EXPLOIT: {
    keywords: ['exploit', 'hack', 'hacked', 'drained', 'stolen', 'vulnerability', 'rugpull', 'rug pull', 'phishing'],
    priority: 1 // highest
  },
  GOVERNANCE: {
    keywords: ['vote', 'proposal', 'governance', 'snapshot', 'dao', 'passed', 'rejected'],
    priority: 3
  },
  AIRDROP: {
    keywords: ['airdrop', 'claim', 'eligible', 'snapshot taken', 'retroactive'],
    priority: 2
  },
  YIELD: {
    keywords: ['apy', 'apr', 'yield', 'farm', 'liquidity mining', 'incentive', 'rewards'],
    priority: 4
  },
  LAUNCH: {
    keywords: ['launched', 'live', 'mainnet', 'goes live', 'now live', 'available now', 'v2', 'v3'],
    priority: 3
  },
  FUD: {
    keywords: ['scam', 'avoid', 'warning', 'do not', 'fake', 'impersonator'],
    priority: 2
  }
};

function classifyTweet(text) {
  const lower = text.toLowerCase();
  const matches = [];

  for (const [category, config] of Object.entries(CATEGORIES)) {
    const hits = config.keywords.filter(kw => lower.includes(kw));
    if (hits.length > 0) {
      matches.push({ category, hits: hits.length, priority: config.priority });
    }
  }

  if (!matches.length) return { category: 'GENERAL', priority: 5, confidence: 0.3 };

  // Take highest priority (lowest number) match
  const best = matches.sort((a, b) => a.priority - b.priority)[0];
  return {
    category: best.category,
    priority: best.priority,
    confidence: Math.min(best.hits / 3, 1)
  };
}
```

---

## Step 4: Source Credibility Scoring

Not all accounts are equal. Weight content by source quality:

```javascript
// Known credible DeFi accounts — build this list manually
const TRUSTED_ACCOUNTS = new Set([
  'PeckShieldAlert',    // Security monitoring
  'BlockSecTeam',       // Security audits
  'CertiKAlert',        // Security
  'bantg',              // Yearn Finance dev
  'StaniKulechov',      // Aave founder
  'haydenzadams',       // Uniswap founder
  'rleshner',           // Compound founder
  'samczsun',           // Security researcher
  'tayvano_',           // MetaMask security
  'CoinDesk',           // News outlet
  'TheBlock__'          // News outlet
]);

function scoreSource(username, followerCount, verified) {
  let score = 0;

  if (TRUSTED_ACCOUNTS.has(username)) score += 50;
  if (verified) score += 20;
  if (followerCount > 100_000) score += 20;
  else if (followerCount > 10_000) score += 10;
  else if (followerCount > 1_000) score += 5;

  return score;
}
```

---

## Step 5: Deduplicate Content

The same news event triggers multiple tweets. Deduplicate using content similarity:

```javascript
import crypto from 'crypto';

const recentHashes = new Map(); // hash → timestamp
const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function isDuplicate(text) {
  // Normalize: lowercase, remove URLs, collapse whitespace
  const normalized = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Hash first 100 chars (captures the substance, ignores trailing hashtags)
  const hash = crypto.createHash('md5').update(normalized.slice(0, 100)).digest('hex');

  const now = Date.now();

  // Clean old entries
  for (const [h, ts] of recentHashes) {
    if (now - ts > DEDUP_WINDOW_MS) recentHashes.delete(h);
  }

  if (recentHashes.has(hash)) return true;
  recentHashes.set(hash, now);
  return false;
}
```

---

## Step 6: Rank and Route

Compute a final relevance score and route to output channels:

```javascript
function rankTweet(tweet, author, classification, sourceScore) {
  const engagement = tweet.public_metrics;
  const engagementScore = Math.log10(
    engagement.like_count + engagement.retweet_count * 3 + engagement.quote_count * 2 + 1
  );

  const relevanceScore =
    (sourceScore * 0.4) +
    (engagementScore * 10 * 0.3) +
    ((6 - classification.priority) * 10 * 0.2) +
    (classification.confidence * 10 * 0.1);

  return {
    score: Math.round(relevanceScore),
    category: classification.category,
    priority: classification.priority,
    tweet: tweet.text,
    author: author.username,
    url: `https://x.com/${author.username}/status/${tweet.id}`,
    createdAt: tweet.created_at
  };
}

async function routeAlert(ranked) {
  if (ranked.priority <= 2 && ranked.score >= 40) {
    await postToSlack(ranked);   // High priority: exploits, airdrops
  }
  if (ranked.score >= 25) {
    await addToFeed(ranked);     // Feed: anything above threshold
  }
}
```

---

## Output Options

- **Slack/Discord webhook** — immediate delivery to your team channel
- **REST API** — expose `/feed?category=EXPLOIT&limit=20` for a frontend
- **Email digest** — batch high-priority items hourly via SendGrid
- **Telegram bot** — common in the DeFi community, low friction for end users

---

## Conclusion

A DeFi news aggregator on the X Streaming API is a practical, buildable project that delivers real value. The stream handles volume; your classification layer handles relevance. The key investment is in curating your trusted source list and refining your rule set over time — both improve accuracy more than any ML model upgrade. Start with 10 trusted accounts and 5 protocol rules, validate the output quality manually for a week, then expand.

---

*Related: [X API Filtered Stream: Real-Time Crypto Sentiment Monitoring](./x-api-filtered-stream-crypto-sentiment.md)*
