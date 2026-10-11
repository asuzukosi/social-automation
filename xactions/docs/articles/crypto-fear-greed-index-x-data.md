# How to Build a Crypto Fear & Greed Index from X Data

**Meta description:** Build a custom crypto fear and greed index using X social data — sentiment analysis, keyword scoring, volume normalization, and index calculation in Node.js.

---

## Introduction

The widely-cited Fear & Greed Index from Alternative.me aggregates multiple signals, but it treats social media as a black box. Building your own index from raw X data gives you full control over the signal mix, real-time updates, and the ability to tune weights for specific market conditions or asset classes. This guide walks through collecting X sentiment data, scoring it, and computing a 0–100 fear/greed index.

---

## Index Design

A useful fear/greed index needs multiple independent signals to avoid being fooled by single-metric manipulation. Design the index around four X-derived signals:

| Signal | Weight | Description |
|---|---|---|
| Sentiment polarity | 35% | Positive vs. negative language ratio |
| Keyword frequency | 25% | Fear vs. greed keyword counts |
| Post volume | 20% | Abnormal tweet volume indicates extremes |
| Engagement ratio | 20% | Like/retweet ratios on fear vs. greed posts |

---

## Collecting Raw X Data

Use the X API v2 search endpoint to pull recent posts about Bitcoin (or your target asset):

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

async function collectSentimentData(asset = 'bitcoin', hours = 24) {
  const query = `${asset} -is:retweet lang:en`;

  const response = await client.v2.search(query, {
    max_results: 100,
    'tweet.fields': ['created_at', 'public_metrics', 'text'],
  });

  return response.data ?? [];
}
```

Run this every hour and accumulate results in a rolling 24-hour window.

---

## Keyword Scoring

Define fear and greed keyword lists and score each post:

```js
const FEAR_KEYWORDS = [
  'crash', 'dump', 'bear', 'sell', 'panic', 'down', 'lost',
  'rekt', 'scam', 'dead', 'collapse', 'liquidated', 'fear',
  'avoid', 'warning', 'bubble', 'worthless', 'capitulation',
];

const GREED_KEYWORDS = [
  'moon', 'bull', 'pump', 'buy', 'hold', 'hodl', 'ath',
  'breakout', 'rally', 'accumulate', 'dip', 'opportunity',
  'undervalued', 'profit', 'gains', 'up only', 'lambo',
];

function scoreKeywords(text) {
  const lower = text.toLowerCase();
  const fearCount = FEAR_KEYWORDS.filter(w => lower.includes(w)).length;
  const greedCount = GREED_KEYWORDS.filter(w => lower.includes(w)).length;

  if (fearCount === 0 && greedCount === 0) return 0; // neutral
  const total = fearCount + greedCount;
  // Returns -1 (pure fear) to +1 (pure greed)
  return (greedCount - fearCount) / total;
}
```

---

## Sentiment Polarity Analysis

Use a lightweight NLP library for sentence-level sentiment without calling an LLM API on every tweet:

```bash
npm install sentiment
```

```js
import Sentiment from 'sentiment';

const sentimentAnalyzer = new Sentiment();

function analyzeSentiment(text) {
  const result = sentimentAnalyzer.analyze(text);
  // Normalize to -1 to +1
  const normalized = Math.max(-1, Math.min(1, result.comparative));
  return normalized;
}
```

The `sentiment` library uses AFINN word lists — fast, no API calls, appropriate for short social posts.

---

## Volume Signal

Abnormal tweet volume signals extremes — high volume during price drops = fear, high volume during rallies = greed. Use a rolling baseline:

```js
class VolumeBaseline {
  constructor(windowSize = 24) {
    this.window = [];
    this.windowSize = windowSize;
  }

  add(count) {
    this.window.push(count);
    if (this.window.length > this.windowSize) this.window.shift();
  }

  getScore(currentCount) {
    if (this.window.length < 3) return 0; // not enough data
    const avg = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    const ratio = currentCount / avg;
    // 2x normal volume = extreme signal (0.5 for volume alone, direction from sentiment)
    return Math.min(1, (ratio - 1) / 2);
  }
}
```

---

## Engagement Ratio Signal

Posts with high engagement amplify sentiment. Weight sentiment scores by post engagement:

```js
function weightedSentimentScore(tweets) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const tweet of tweets) {
    const metrics = tweet.public_metrics;
    const engagement = (metrics.like_count ?? 0) + (metrics.retweet_count ?? 0) * 2;
    const weight = Math.log1p(engagement) + 1; // log scale to prevent whale domination
    const sentiment = analyzeSentiment(tweet.text);

    weightedSum += sentiment * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
```

---

## Computing the Final Index

Combine signals into a 0–100 score:

```js
function computeFearGreedIndex({ sentimentScore, keywordScore, volumeScore, engagementScore }) {
  const WEIGHTS = { sentiment: 0.35, keywords: 0.25, volume: 0.20, engagement: 0.20 };

  const composite =
    sentimentScore * WEIGHTS.sentiment +
    keywordScore * WEIGHTS.keywords +
    volumeScore * WEIGHTS.volume +
    engagementScore * WEIGHTS.engagement;

  // Normalize from [-1, 1] to [0, 100]
  const index = Math.round((composite + 1) * 50);
  return Math.max(0, Math.min(100, index));
}

function classifyIndex(score) {
  if (score <= 20) return 'Extreme Fear';
  if (score <= 40) return 'Fear';
  if (score <= 60) return 'Neutral';
  if (score <= 80) return 'Greed';
  return 'Extreme Greed';
}
```

---

## Automating Index Posts to X

Post the index score hourly:

```js
async function postIndexUpdate(score) {
  const label = classifyIndex(score);
  const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));

  const text = `Crypto Fear & Greed Index (X Data)\n\n${bar} ${score}/100\n${label}\n\nBased on real-time X sentiment analysis\n\n#crypto #bitcoin #fearandgreed`;

  await xClient.v2.tweet(text);
}
```

---

## Conclusion

A custom fear/greed index from X data gives you real-time, tunable sentiment that no third-party service provides. The four-signal design — keyword scoring, sentiment polarity, volume baseline, and weighted engagement — creates a composite measure that's resistant to single-vector manipulation. Store hourly scores in a time-series database and correlate against price data to validate and refine your weights over time.
