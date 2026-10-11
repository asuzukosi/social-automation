# Building a Bitcoin Sentiment Tracker with X API v2

**Meta description:** How to build a Bitcoin sentiment tracker using X API v2 — collecting tweets, scoring sentiment with LLMs or NLP, aggregating time-series data, and visualizing the bullish/bearish ratio against BTC price.

---

## Introduction

Bitcoin price doesn't move in a vacuum. On-chain activity, macro events, and — critically — social sentiment on X drive short-term price action. A Bitcoin sentiment tracker turns raw X data into a quantified signal: a bullish/bearish ratio that you can plot against price and use to inform trading or research decisions.

This guide builds a complete tracker: tweet collection via X API v2, LLM-based sentiment scoring, time-series aggregation, and a simple charting output.

---

## System Architecture

```
X API v2 (Recent Search + Filtered Stream)
      │
      ▼
Tweet collector — filters $BTC, bitcoin, #bitcoin
      │
      ▼
Deduplication + spam filter
      │
      ▼
Sentiment scorer (LLM or NLP model)
      │
      ▼
Time-series DB (InfluxDB / TimescaleDB / Redis sorted sets)
      │
      ▼
Dashboard or alert layer
```

Each layer is independent. You can swap the sentiment scorer or storage backend without touching collection.

---

## Step 1: Collect Bitcoin Tweets

Use the Recent Search endpoint for historical backfill and the Filtered Stream for real-time ingestion.

### Historical backfill with Recent Search

```javascript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.BEARER_TOKEN);

async function fetchBitcoinTweets(startTime, endTime) {
  const tweets = [];
  let nextToken;

  do {
    const res = await client.v2.search('$BTC OR bitcoin OR #bitcoin lang:en -is:retweet -is:nullcast', {
      start_time: startTime,
      end_time: endTime,
      max_results: 100,
      next_token: nextToken,
      'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'text'],
      'user.fields': ['public_metrics'],
      'expansions': ['author_id']
    });

    tweets.push(...(res.data.data ?? []));
    nextToken = res.data.meta?.next_token;
  } while (nextToken);

  return tweets;
}
```

Recent Search covers 7 days. For anything older, you need Enterprise full-archive access.

### Real-time ingestion with Filtered Stream

```javascript
async function startRealtimeCollection(onTweet) {
  // Set stream rules (see Filtered Stream guide)
  await setStreamRules([
    { value: '$BTC lang:en -is:retweet', tag: 'btc-cashtag' },
    { value: 'bitcoin price lang:en -is:retweet', tag: 'btc-price' },
    { value: 'bitcoin bullish OR bearish lang:en -is:retweet', tag: 'btc-sentiment' }
  ]);

  await connectStream(onTweet);
}
```

---

## Step 2: Filter Out Noise

Raw Bitcoin tweet volume is massive and full of bots, spam, and duplicate content. Apply aggressive filtering before scoring:

```javascript
function isQualityTweet(tweet, author) {
  const followers = author?.public_metrics?.followers_count ?? 0;
  const text = tweet.text.toLowerCase();

  // Minimum follower threshold
  if (followers < 50) return false;

  // Skip tweets that are mostly URLs or hashtags
  const wordCount = text.split(/\s+/).filter(w => !w.startsWith('#') && !w.startsWith('http')).length;
  if (wordCount < 5) return false;

  // Skip obvious bot patterns
  const botPatterns = [/follow.*for.*free.*btc/i, /giveaway/i, /dm.*profit/i];
  if (botPatterns.some(p => p.test(text))) return false;

  return true;
}
```

Influencer weight — scale sentiment scores by follower count to give KOL opinions more weight than anonymous accounts.

---

## Step 3: Score Sentiment

### Option A: Keyword heuristics (fast, free)

```javascript
const BULLISH_TERMS = ['moon', 'pump', 'bullish', 'buy', 'hodl', 'accumulate', 'breakout', 'ath', 'green', 'long'];
const BEARISH_TERMS = ['crash', 'dump', 'bearish', 'sell', 'rekt', 'fear', 'capitulate', 'short', 'red', 'drop'];

function keywordSentiment(text) {
  const lower = text.toLowerCase();
  const b = BULLISH_TERMS.filter(w => lower.includes(w)).length;
  const s = BEARISH_TERMS.filter(w => lower.includes(w)).length;
  if (b === s) return { label: 'neutral', score: 0 };
  return b > s
    ? { label: 'bullish', score: b / (b + s) }
    : { label: 'bearish', score: -s / (b + s) };
}
```

### Option B: LLM classification (accurate, costs money)

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function llmSentiment(text) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Classify this tweet's sentiment toward Bitcoin as "bullish", "bearish", or "neutral". Reply with only the label.\n\nTweet: "${text}"`
    }],
    max_tokens: 10
  });

  return res.choices[0].message.content.trim().toLowerCase();
}
```

Batch LLM calls to reduce API cost — process 20 tweets per request using a structured prompt.

### Option C: Fine-tuned model

HuggingFace hosts pre-trained crypto sentiment models. `ElKulako/cryptobert` is trained on crypto Twitter specifically:

```javascript
import { pipeline } from '@huggingface/transformers';

const classifier = await pipeline('text-classification', 'ElKulako/cryptobert');

async function bertSentiment(text) {
  const result = await classifier(text);
  return result[0]; // { label: 'Bullish', score: 0.89 }
}
```

---

## Step 4: Aggregate into Time Buckets

Group scored tweets into 5-minute or hourly windows:

```javascript
function aggregateBucket(tweets) {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let totalWeight = 0;

  for (const tweet of tweets) {
    const weight = Math.log10((tweet.followers ?? 1) + 1); // follower-weighted
    if (tweet.sentiment === 'bullish') bullish += weight;
    else if (tweet.sentiment === 'bearish') bearish += weight;
    else neutral += weight;
    totalWeight += weight;
  }

  return {
    timestamp: new Date().toISOString(),
    count: tweets.length,
    bullishRatio: bullish / totalWeight,
    bearishRatio: bearish / totalWeight,
    sentimentScore: (bullish - bearish) / totalWeight // -1 to +1
  };
}
```

The `sentimentScore` is your primary signal: positive means bullish majority, negative means bearish, magnitude indicates conviction strength.

---

## Step 5: Store and Visualize

Store aggregated buckets in a time-series database:

```javascript
// Redis sorted set — simple, fast, built-in TTL
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });

async function storeBucket(bucket) {
  const score = Date.now();
  await redis.zAdd('btc:sentiment', { score, value: JSON.stringify(bucket) });
  // Trim to last 30 days
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  await redis.zRemRangeByScore('btc:sentiment', '-inf', cutoff);
}

async function getSentimentHistory(hours = 24) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  const raw = await redis.zRangeByScore('btc:sentiment', cutoff, '+inf');
  return raw.map(r => JSON.parse(r));
}
```

Plot sentiment score alongside BTC price using Recharts, Chart.js, or Grafana. The correlation between sentiment spikes and price moves is the deliverable — track it for 30 days before drawing conclusions.

---

## Signal Quality Notes

- **Lag**: X sentiment typically lags price moves by 15-45 minutes, not leads them
- **Sarcasm**: keyword classifiers misread sarcasm consistently; LLMs handle it better
- **Bot manipulation**: during pumps, bot accounts flood cashtags with bullish terms — weight by verified accounts or established follower ratios
- **Retweet filtering**: always exclude retweets to avoid counting the same sentiment multiple times

---

## Conclusion

A Bitcoin sentiment tracker built on X API v2 gives you a quantified social signal that complements on-chain and technical analysis. The collection and aggregation layers are straightforward. The hard part is building a classifier that handles crypto slang, sarcasm, and bot traffic. Start with keyword scoring to validate the pipeline, then upgrade to LLM classification when signal quality matters more than cost.

---

*Related: [X API Filtered Stream: Real-Time Crypto Sentiment Monitoring](./x-api-filtered-stream-crypto-sentiment.md)*
