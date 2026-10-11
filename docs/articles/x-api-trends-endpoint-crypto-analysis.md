# Using X API Trends Endpoint for Crypto Market Analysis

**Meta description:** Learn how to use the X API trends endpoint for crypto market analysis — fetching trending topics, filtering crypto signals, tracking trend velocity, and correlating with price data.

---

## Introduction

X trends are a leading indicator for retail crypto market activity. When a token name or hashtag starts trending, it often precedes price action by 15–60 minutes — retail traders see the trend, investigate, buy. For quantitative analysts and trading tools, systematically monitoring X trends for crypto signals is worth the engineering investment. This guide covers accessing trends via the X API, filtering for crypto relevance, and building a trend tracking pipeline.

---

## The Trends Endpoint

X API v2 provides trends via the `GET /2/trends/by/woeid` endpoint, where WOEID is Yahoo's Where On Earth ID. Use WOEID `1` for worldwide trends.

```bash
# Worldwide
GET /2/trends/by/woeid/1

# United States
GET /2/trends/by/woeid/23424977

# United Kingdom
GET /2/trends/by/woeid/23424975
```

Note: The trends endpoint is available on the Basic tier. Rate limits are 75 requests per 15-minute window with Bearer Token.

---

## Fetching Trends

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

async function getTrends(woeid = 1) {
  // The trends endpoint is on v1.1 — v2 trends has limited geographic support
  const trends = await client.v1.trendsByPlace(woeid);
  return trends[0]?.trends ?? [];
}

async function getCryptoTrends() {
  const all = await getTrends(1);
  return all.filter(isCryptoTrend);
}
```

Note: At time of writing, the v2 trends endpoint (`/2/trends/by/woeid`) is available to Basic+ tiers. The v1.1 trends endpoint (`/1.1/trends/place.json`) may still work for accounts with legacy access. Verify your tier access.

---

## Filtering for Crypto Relevance

Not every trending topic is crypto. Build a relevance classifier:

```js
const CRYPTO_TERMS = new Set([
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'defi', 'nft',
  'blockchain', 'solana', 'sol', 'binance', 'bnb', 'coinbase',
  'altcoin', 'altcoins', 'web3', 'doge', 'dogecoin', 'xrp', 'ripple',
  'cardano', 'ada', 'polygon', 'matic', 'chainlink', 'link',
  'uniswap', 'aave', 'compound', 'makerdao', 'dai', 'usdc', 'usdt',
]);

const CRYPTO_REGEX = /\$[A-Z]{2,6}|#[A-Z]{2,6}USD|[A-Z]{2,6}USDT/;

function isCryptoTrend(trend) {
  const name = trend.name.toLowerCase().replace('#', '');
  if (CRYPTO_TERMS.has(name)) return true;
  if (CRYPTO_REGEX.test(trend.name)) return true;

  // Check for token-like hashtags: #PEPE, #WIF, #BONK
  if (/^#[A-Z]{3,6}$/.test(trend.name)) return true;

  return false;
}
```

---

## Tracking Trend Velocity

A trend's tweet volume alone doesn't tell you much. Velocity — the rate of change in tweet volume — is more predictive:

```js
class TrendTracker {
  constructor() {
    this.history = new Map(); // trendName -> [{ timestamp, tweetVolume }]
  }

  update(trends) {
    const now = Date.now();
    for (const trend of trends) {
      const name = trend.name;
      if (!this.history.has(name)) this.history.set(name, []);
      const record = this.history.get(name);
      record.push({ timestamp: now, volume: trend.tweet_volume ?? 0 });
      // Keep 2 hours of history
      const cutoff = now - 2 * 60 * 60 * 1000;
      this.history.set(name, record.filter(r => r.timestamp > cutoff));
    }
  }

  getVelocity(trendName) {
    const history = this.history.get(trendName);
    if (!history || history.length < 2) return 0;

    const recent = history[history.length - 1];
    const older = history[0];
    const timeDeltaHours = (recent.timestamp - older.timestamp) / 3600000;
    if (timeDeltaHours === 0) return 0;

    return (recent.volume - older.volume) / timeDeltaHours;
  }
}
```

---

## New Trend Detection

New entries in the trending list are the most actionable signal:

```js
class NewTrendDetector {
  constructor() {
    this.previousTrends = new Set();
  }

  detectNew(currentTrends) {
    const current = new Set(currentTrends.map(t => t.name));
    const newTrends = currentTrends.filter(t => !this.previousTrends.has(t.name));
    this.previousTrends = current;
    return newTrends;
  }
}

const detector = new NewTrendDetector();

setInterval(async () => {
  const cryptoTrends = await getCryptoTrends();
  const newOnes = detector.detectNew(cryptoTrends);

  for (const trend of newOnes) {
    console.log(`New crypto trend: ${trend.name} (${trend.tweet_volume?.toLocaleString()} tweets)`);
    await handleNewTrend(trend);
  }
}, 5 * 60 * 1000); // Check every 5 minutes
```

---

## Correlating Trends with Price Data

Combine trend signals with price data to validate signal quality:

```js
async function analyzeTrendPriceCorrelation(trendName, coinId) {
  const [priceData, trendHistory] = await Promise.all([
    fetchPriceHistory(coinId, '1h'), // from CoinGecko
    getTrendVolumeHistory(trendName),
  ]);

  // Simple correlation: did price move within 1h of trend spike?
  const trendSpikes = trendHistory.filter(r => r.velocity > 10000);
  const priceMovements = trendSpikes.map(spike => {
    const priceAt = getPriceAt(priceData, spike.timestamp);
    const priceAfter = getPriceAt(priceData, spike.timestamp + 3600000);
    return priceAfter && priceAt ? ((priceAfter - priceAt) / priceAt) * 100 : null;
  }).filter(Boolean);

  const avgMove = priceMovements.reduce((a, b) => a + b, 0) / priceMovements.length;
  return { avgPriceMovement: avgMove, sampleSize: priceMovements.length };
}
```

---

## Building a Trend Alert System

Post trend alerts to X or send to a monitoring channel:

```js
async function handleNewTrend(trend) {
  const velocity = tracker.getVelocity(trend.name);
  if (velocity < 5000) return; // Low velocity, skip

  const text = [
    `Trending Crypto Signal: ${trend.name}`,
    `Volume: ${(trend.tweet_volume ?? 0).toLocaleString()} tweets`,
    `Velocity: +${Math.round(velocity).toLocaleString()}/hr`,
    ``,
    `#crypto #trending`,
  ].join('\n');

  await xClient.v2.tweet(text);
}
```

---

## Conclusion

X trends are an underutilized signal source for crypto market analysis. By filtering for crypto relevance, tracking velocity rather than raw volume, and detecting new trend entries, you extract actionable intelligence from the noise. Correlate trend spikes against price history to validate your signals and tune your filters. The 15–60 minute lead time between trending and price movement is exploitable with a well-tuned monitoring pipeline.
