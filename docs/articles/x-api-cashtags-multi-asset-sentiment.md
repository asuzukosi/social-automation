# How to Use X API Cashtags for Multi-Asset Sentiment Analysis

**Meta description:** Learn how crypto developers can leverage X API cashtag filtering to build a multi-asset sentiment analysis pipeline with real-time scoring and PostgreSQL storage.

---

## Introduction

Cashtags — `$BTC`, `$ETH`, `$SOL` — are the most reliable signal identifiers in crypto social data. Unlike free-text keyword search, cashtags are intentional: users choose to reference a specific asset. X API v2's `has:cashtags` operator lets you filter streams and search results to only tweets where the author explicitly tagged a financial instrument. This guide builds a multi-asset sentiment pipeline on top of that operator.

---

## Why Cashtags Beat Keywords for Crypto Sentiment

A tweet mentioning "bitcoin" might be news, satire, or spam. A tweet with `$BTC` signals deliberate financial commentary. The signal-to-noise ratio for cashtag queries is significantly higher. Additionally, X API returns the cashtag entities in the response payload, so you know exactly which assets are referenced in each tweet without regex parsing.

---

## Requesting Cashtag Entities

When calling the search or stream endpoint, request the `entities` field to get structured cashtag data:

```js
// search.js
import axios from 'axios';

export async function searchCashtagTweets(cashtag, maxResults = 100) {
  const res = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
    headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
    params: {
      query: `$${cashtag} has:cashtags -is:retweet lang:en`,
      max_results: maxResults,
      'tweet.fields': 'created_at,author_id,public_metrics,entities',
      'user.fields': 'username,verified,public_metrics',
      expansions: 'author_id',
    },
  });

  return res.data;
}
```

The `entities.cashtags` array in each tweet response contains `{ start, end, tag }` objects — you get the asset ticker directly from the API.

---

## Multi-Asset Stream Rules

For real-time sentiment across a basket of assets:

```js
export const MULTI_ASSET_RULES = [
  { value: '$BTC has:cashtags -is:retweet lang:en', tag: 'sentiment_BTC' },
  { value: '$ETH has:cashtags -is:retweet lang:en', tag: 'sentiment_ETH' },
  { value: '$SOL has:cashtags -is:retweet lang:en', tag: 'sentiment_SOL' },
  { value: '$BNB has:cashtags -is:retweet lang:en', tag: 'sentiment_BNB' },
  { value: '$XRP has:cashtags -is:retweet lang:en', tag: 'sentiment_XRP' },
  { value: '$AVAX has:cashtags -is:retweet lang:en', tag: 'sentiment_AVAX' },
  { value: '$LINK has:cashtags -is:retweet lang:en', tag: 'sentiment_LINK' },
];
```

Each rule tag encodes the asset ticker, so routing is deterministic in the stream handler.

---

## Sentiment Scoring Without an LLM

For high-throughput streams, a lexicon-based scorer runs in microseconds and handles thousands of tweets per second without API calls:

```js
// sentiment.js
const BULL = ['bullish', 'moon', 'pump', 'breakout', 'accumulate', 'buy', 'long',
              'ath', 'rally', 'undervalued', 'gem', 'hold', 'hodl'];
const BEAR = ['bearish', 'dump', 'crash', 'sell', 'short', 'overvalued', 'rug',
              'scam', 'ponzi', 'dead', 'rekt', 'exit', 'capitulate'];

export function scoreSentiment(text) {
  const words = text.toLowerCase().split(/\s+/);
  let score = 0;
  for (const word of words) {
    if (BULL.includes(word)) score++;
    if (BEAR.includes(word)) score--;
  }
  if (score > 0) return 'BULLISH';
  if (score < 0) return 'BEARISH';
  return 'NEUTRAL';
}

export function scoreNumeric(text) {
  const words = text.toLowerCase().split(/\s+/);
  let score = 0;
  for (const word of words) {
    if (BULL.includes(word)) score += 1;
    if (BEAR.includes(word)) score -= 1;
  }
  return Math.max(-5, Math.min(5, score)); // clamp to [-5, 5]
}
```

---

## Weighted Sentiment by Account Authority

Not all voices carry equal weight. Weight sentiment scores by follower count and verification status:

```js
export function weightedScore(numericScore, user) {
  const followers = user?.public_metrics?.followers_count || 0;
  const verified = user?.verified ? 1.5 : 1.0;

  let multiplier = 1;
  if (followers > 100000) multiplier = 3;
  else if (followers > 10000) multiplier = 2;
  else if (followers > 1000) multiplier = 1.5;

  return numericScore * multiplier * verified;
}
```

---

## PostgreSQL Schema for Sentiment Data

```sql
CREATE TABLE asset_sentiment (
  id              BIGSERIAL PRIMARY KEY,
  tweet_id        TEXT UNIQUE NOT NULL,
  asset           TEXT NOT NULL,
  author_id       TEXT NOT NULL,
  username        TEXT,
  text            TEXT NOT NULL,
  sentiment       TEXT NOT NULL,       -- BULLISH | BEARISH | NEUTRAL
  score           FLOAT NOT NULL,      -- raw numeric
  weighted_score  FLOAT NOT NULL,
  followers       INT DEFAULT 0,
  likes           INT DEFAULT 0,
  retweets        INT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL,
  captured_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sentiment_asset ON asset_sentiment(asset, created_at DESC);
CREATE INDEX idx_sentiment_score ON asset_sentiment(asset, weighted_score DESC);
```

---

## Aggregating Sentiment Signals

Query rolling sentiment averages per asset:

```sql
SELECT
  asset,
  AVG(weighted_score)                          AS avg_sentiment,
  COUNT(*) FILTER (WHERE sentiment = 'BULLISH') AS bullish_count,
  COUNT(*) FILTER (WHERE sentiment = 'BEARISH') AS bearish_count,
  COUNT(*)                                     AS total_tweets
FROM asset_sentiment
WHERE created_at > now() - interval '1 hour'
GROUP BY asset
ORDER BY avg_sentiment DESC;
```

This query gives you a ranked list of assets by social sentiment in the last hour — a useful input for trading signal generation.

---

## Conclusion

X API cashtag filtering is the most reliable entry point for crypto sentiment data. Combining `has:cashtags` stream rules with lexicon scoring, authority weighting, and PostgreSQL aggregation gives you a low-latency, high-signal sentiment pipeline. Start with seven major assets, validate the scoring output against price action, and extend coverage once the core pipeline is stable.
