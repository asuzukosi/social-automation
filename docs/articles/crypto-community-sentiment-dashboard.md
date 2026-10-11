# How to Build a Crypto Community Sentiment Dashboard

**Meta description:** Build a real-time crypto sentiment dashboard using X API data, NLP classification, and time-series visualization to track market mood across tokens and communities.

---

## Introduction

Sentiment data from X is one of the few leading indicators in crypto that's both real-time and publicly accessible. A well-built sentiment dashboard doesn't just show you whether people are bullish or bearish — it shows you velocity of sentiment change, which communities are driving it, and how sentiment correlates with price action. This guide covers the full stack: data ingestion, classification, storage, and frontend visualization.

---

## Architecture Overview

```
X Filtered Stream → Ingest Worker → Sentiment Classifier → Time-Series Store → Dashboard API → Frontend
```

Each component is independently scalable. The ingest worker and classifier can run as separate processes connected by a Redis queue. The dashboard API reads from PostgreSQL (for historical queries) and Redis (for real-time counters).

---

## Stream Configuration for Sentiment Data

Configure stream rules to capture high-signal sentiment content across your tracked tokens:

```javascript
const sentimentRules = [
  // Top-cap tokens with engagement filter (we'll apply engagement filter post-receive)
  { value: '($BTC OR $ETH OR $SOL OR $BNB) -is:retweet lang:en', tag: 'large-cap' },
  { value: '($LINK OR $AVAX OR $MATIC OR $ARB) -is:retweet lang:en', tag: 'mid-cap' },
  // Community-specific hashtags
  { value: '(#DeFi OR #NFT OR #Web3) has:cashtags -is:retweet lang:en', tag: 'community' },
];
```

Accept all inbound data and apply engagement filters server-side — this gives you flexibility to adjust thresholds without restarting the stream.

---

## Sentiment Classification

### Rule-Based Classifier (Fast, No API Cost)

Start with a lexicon-based classifier for speed and zero cost:

```javascript
const BULLISH_TERMS = new Set([
  'bullish', 'moon', 'pump', 'breakout', 'buy', 'long', 'accumulate',
  'undervalued', 'gem', 'alpha', 'fomo', 'ath', 'bullrun', 'green',
]);

const BEARISH_TERMS = new Set([
  'bearish', 'dump', 'crash', 'sell', 'short', 'overvalued', 'rekt',
  'rug', 'scam', 'avoid', 'ponzi', 'bubble', 'red', 'bear', 'capitulate',
]);

function classifySentiment(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/);
  let bullScore = 0;
  let bearScore = 0;

  for (const word of words) {
    if (BULLISH_TERMS.has(word)) bullScore++;
    if (BEARISH_TERMS.has(word)) bearScore++;
  }

  if (bullScore === 0 && bearScore === 0) return 'neutral';
  if (bullScore > bearScore) return 'bullish';
  if (bearScore > bullScore) return 'bearish';
  return 'mixed';
}
```

This runs in under 1ms and handles 10,000+ tweets per second on a single CPU core.

### LLM Classification for Ambiguous Cases

Route low-confidence classifications to an LLM:

```javascript
async function classifyWithLLM(text) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-3-5',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Classify crypto tweet sentiment as bullish, bearish, or neutral. Reply with one word only.\n\n"${text}"`,
      }],
    }),
  });
  const data = await response.json();
  return data.content[0].text.trim().toLowerCase();
}
```

Only invoke the LLM for tweets with `mixed` classification or high engagement (>100 likes) — this controls cost while improving accuracy on the content that matters most.

---

## Time-Series Storage

Store sentiment counts in 5-minute buckets for efficient time-series queries:

```sql
CREATE TABLE sentiment_buckets (
  token_symbol TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bullish_count INTEGER DEFAULT 0,
  bearish_count INTEGER DEFAULT 0,
  neutral_count INTEGER DEFAULT 0,
  total_count   INTEGER DEFAULT 0,
  weighted_score NUMERIC(5,2), -- -100 to +100
  PRIMARY KEY (token_symbol, bucket_start)
);

CREATE INDEX ON sentiment_buckets (token_symbol, bucket_start DESC);
```

Update buckets atomically:

```javascript
async function recordSentiment(symbol, sentiment, engagementWeight = 1) {
  const bucketStart = new Date(Math.floor(Date.now() / 300000) * 300000); // 5-min bucket

  const sentimentCol = `${sentiment}_count`;
  await db.$executeRaw`
    INSERT INTO sentiment_buckets (token_symbol, bucket_start, ${sentimentCol}, total_count)
    VALUES (${symbol}, ${bucketStart}, ${engagementWeight}, ${engagementWeight})
    ON CONFLICT (token_symbol, bucket_start)
    DO UPDATE SET
      ${sentimentCol} = sentiment_buckets.${sentimentCol} + ${engagementWeight},
      total_count = sentiment_buckets.total_count + ${engagementWeight}
  `;
}
```

---

## Real-Time Redis Counters

For the live dashboard feed, maintain rolling 1-hour counts in Redis:

```javascript
async function updateRedisCounters(symbol, sentiment) {
  const pipe = redis.pipeline();
  const key = `sentiment:${symbol}:1h:${sentiment}`;
  pipe.incr(key);
  pipe.expire(key, 3600);
  await pipe.exec();
}

async function getLiveSentiment(symbol) {
  const [bullish, bearish, neutral] = await redis.mget(
    `sentiment:${symbol}:1h:bullish`,
    `sentiment:${symbol}:1h:bearish`,
    `sentiment:${symbol}:1h:neutral`,
  );

  const total = (Number(bullish) + Number(bearish) + Number(neutral)) || 1;
  return {
    bullishPercent: (Number(bullish) / total * 100).toFixed(1),
    bearishPercent: (Number(bearish) / total * 100).toFixed(1),
    neutralPercent: (Number(neutral) / total * 100).toFixed(1),
    totalTweets: total,
  };
}
```

---

## Dashboard API Endpoints

```javascript
// Current sentiment snapshot for all tracked tokens
app.get('/api/sentiment/snapshot', async (req, res) => {
  const tokens = ['BTC', 'ETH', 'SOL', 'BNB'];
  const snapshot = await Promise.all(tokens.map(async symbol => ({
    symbol,
    live: await getLiveSentiment(symbol),
  })));
  res.json(snapshot);
});

// Historical sentiment chart data (last 24 hours, 5-min buckets)
app.get('/api/sentiment/:symbol/history', async (req, res) => {
  const { symbol } = req.params;
  const { hours = 24 } = req.query;
  const since = new Date(Date.now() - Number(hours) * 3600000);

  const buckets = await db.sentimentBucket.findMany({
    where: { tokenSymbol: symbol.toUpperCase(), bucketStart: { gte: since } },
    orderBy: { bucketStart: 'asc' },
  });

  res.json(buckets);
});
```

---

## Correlation with Price Data

The most valuable insight is sentiment vs. price correlation. Fetch OHLCV data from a public source and join with sentiment buckets:

```javascript
async function getSentimentPriceCorrelation(symbol, days = 7) {
  const [sentimentData, priceData] = await Promise.all([
    db.$queryRaw`SELECT bucket_start, weighted_score FROM sentiment_buckets
                 WHERE token_symbol = ${symbol} AND bucket_start > NOW() - INTERVAL '${days} days'
                 ORDER BY bucket_start`,
    fetchOHLCV(symbol, '5m', days), // Your price data source
  ]);

  // Align timestamps and compute Pearson correlation
  return computeCorrelation(sentimentData, priceData);
}
```

---

## Conclusion

A crypto sentiment dashboard is a layered system: fast rule-based classification handles the bulk load, LLM classification handles ambiguous high-value tweets, Redis provides the real-time layer, and PostgreSQL time-series buckets power historical analysis. The most actionable output is sentiment velocity — not whether sentiment is positive, but how fast it's changing. A token going from 40% bullish to 70% bullish in two hours is a more actionable signal than a token that's been 65% bullish for a week.
