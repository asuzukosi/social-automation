# X API Filtered Stream: Real-Time Crypto Sentiment Monitoring

**Meta description:** How to use the X API v2 Filtered Stream endpoint for real-time crypto sentiment monitoring — setting filter rules, handling backpressure, parsing tweet fields, and feeding data into a sentiment pipeline.

---

## Introduction

The X API Filtered Stream is the closest thing to a firehose for crypto discourse. While search endpoints retrieve historical data, the Filtered Stream delivers matching tweets as they're published — with sub-second latency on high-volume cashtags like `$BTC` or `$ETH`.

For crypto sentiment pipelines, this is the foundational data source. This guide covers the complete setup: creating stream rules, opening a persistent connection, handling reconnects, and piping raw tweet data into a sentiment analysis layer.

---

## Access Requirements

The Filtered Stream endpoint (`/2/tweets/search/stream`) is available on:

- **Basic** ($100/month) — 50 concurrent rules, 500k tweet cap/month
- **Pro** ($5,000/month) — 1,000 concurrent rules, 1M tweets/month
- **Enterprise** — custom volume, redundant connections

For most crypto sentiment projects, Basic is the minimum viable tier. Monitor 5-10 cashtags within the 50-rule cap.

---

## Step 1: Authenticate

The Filtered Stream uses App-Only authentication — a Bearer Token is sufficient since you're reading, not writing.

```bash
export BEARER_TOKEN="your_bearer_token_here"
```

```javascript
const BEARER_TOKEN = process.env.BEARER_TOKEN;

const headers = {
  'Authorization': `Bearer ${BEARER_TOKEN}`,
  'User-Agent': 'crypto-sentiment-bot/1.0'
};
```

---

## Step 2: Create Filter Rules

Rules define what tweets enter your stream. Add them via a POST request before connecting:

```javascript
async function setStreamRules() {
  const rules = [
    { value: '$BTC lang:en -is:retweet', tag: 'bitcoin-en' },
    { value: '$ETH lang:en -is:retweet', tag: 'ethereum-en' },
    { value: '$SOL lang:en -is:retweet', tag: 'solana-en' },
    { value: '(bitcoin OR btc) bullish OR bearish lang:en -is:retweet', tag: 'btc-sentiment' },
    { value: 'crypto rug pull OR scam -is:retweet', tag: 'rug-alert' }
  ];

  // Delete existing rules first
  const existing = await fetch('https://api.twitter.com/2/tweets/search/stream/rules', { headers });
  const existingData = await existing.json();

  if (existingData.data?.length) {
    const ids = existingData.data.map(r => r.id);
    await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: { ids } })
    });
  }

  // Add new rules
  const res = await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: rules })
  });

  const data = await res.json();
  console.log('✅ Rules set:', data);
}
```

**Rule syntax tips:**
- `-is:retweet` — exclude retweets to reduce noise
- `lang:en` — filter by language
- `-is:nullcast` — exclude promoted content
- `has:links` — only tweets with URLs (useful for news detection)
- `followers_count:100` — only accounts with 100+ followers

---

## Step 3: Connect to the Stream

The stream endpoint returns newline-delimited JSON. Use a persistent HTTP connection with a streaming response parser:

```javascript
import fetch from 'node-fetch';

async function connectStream(onTweet) {
  const params = new URLSearchParams({
    'tweet.fields': 'author_id,created_at,public_metrics,entities,context_annotations',
    'user.fields': 'name,username,public_metrics',
    'expansions': 'author_id'
  });

  const url = `https://api.twitter.com/2/tweets/search/stream?${params}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Stream connection failed: ${response.status}`);
  }

  console.log('🔄 Stream connected');

  for await (const chunk of response.body) {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.data) onTweet(data);
      } catch {
        // Heartbeat lines are empty — ignore parse errors
      }
    }
  }
}
```

X sends a heartbeat (blank line) every 20 seconds. If you don't receive data for 30+ seconds, assume a disconnect.

---

## Step 4: Handle Reconnection

Streams disconnect. Build reconnect logic with exponential backoff:

```javascript
async function streamWithReconnect(onTweet) {
  let delay = 1000;
  const MAX_DELAY = 64_000;

  while (true) {
    try {
      await connectStream(onTweet);
    } catch (err) {
      console.error(`❌ Stream error: ${err.message}`);
      console.log(`🔄 Reconnecting in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 2, MAX_DELAY);
    }
  }
}
```

X's official guidance: back off at 5s, 10s, 20s, 40s, then cap at 60s for network errors. For HTTP 429, back off at 1 minute increments.

---

## Step 5: Parse and Score Tweets

Extract relevant fields and run sentiment classification:

```javascript
function processTweet(payload) {
  const tweet = payload.data;
  const author = payload.includes?.users?.[0];
  const matchedRules = payload.matching_rules;

  const doc = {
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    authorFollowers: author?.public_metrics?.followers_count ?? 0,
    likes: tweet.public_metrics?.like_count ?? 0,
    retweets: tweet.public_metrics?.retweet_count ?? 0,
    createdAt: tweet.created_at,
    rules: matchedRules.map(r => r.tag),
    sentiment: classifySentiment(tweet.text)
  };

  return doc;
}

function classifySentiment(text) {
  const lower = text.toLowerCase();
  const bullish = ['moon', 'pump', 'bullish', 'buy', 'breakout', 'ath', 'accumulate'];
  const bearish = ['dump', 'bearish', 'sell', 'crash', 'rug', 'rekt', 'exit'];

  const bullScore = bullish.filter(w => lower.includes(w)).length;
  const bearScore = bearish.filter(w => lower.includes(w)).length;

  if (bullScore > bearScore) return 'bullish';
  if (bearScore > bullScore) return 'bearish';
  return 'neutral';
}
```

For production, replace the keyword scorer with an LLM call or a fine-tuned NLP model. Keyword matching is fast but noisy — sarcasm, context, and slang defeat it regularly.

---

## Step 6: Aggregate and Store

Route processed tweets to a time-series store:

```javascript
import { InfluxDB, Point } from '@influxdata/influxdb-client';

const influx = new InfluxDB({ url: process.env.INFLUX_URL, token: process.env.INFLUX_TOKEN });
const writeApi = influx.getWriteApi('org', 'crypto-sentiment');

function storeTweet(doc) {
  const point = new Point('tweet_sentiment')
    .tag('sentiment', doc.sentiment)
    .tag('rule', doc.rules[0] ?? 'unknown')
    .intField('followers', doc.authorFollowers)
    .intField('likes', doc.likes)
    .intField('retweets', doc.retweets)
    .timestamp(new Date(doc.createdAt));

  writeApi.writePoint(point);
}
```

Aggregate sentiment scores per asset per 5-minute window. A rolling bullish/bearish ratio becomes your primary signal.

---

## Backpressure and Volume Management

During high-volatility events, BTC cashtag volume can spike to thousands of tweets per minute. If your processing pipeline can't keep up:

- Buffer tweets in a Redis queue and process asynchronously
- Drop tweets from accounts with fewer than 100 followers during peak load
- Apply deduplication — the same text reposted multiple times is noise

---

## Conclusion

The X API Filtered Stream gives you real-time access to the fastest-moving information in crypto markets. The technical setup is straightforward — the hard problems are rule design, reconnect reliability, and sentiment accuracy. Start with 3-5 cashtag rules on Basic tier, validate your sentiment signal against price data, then expand rules and volume as you find what's worth tracking.

---

*Related: [X Developer API in 2026: The Complete Guide for Crypto Builders](../x-developer-api-crypto-guide-2026.md)*
