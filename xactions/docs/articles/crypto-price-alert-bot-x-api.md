# How to Build a Crypto Price Alert Bot with X API

**Meta description:** Step-by-step guide to building a crypto price alert bot that posts to X automatically — covering X API v2 authentication, posting endpoints, price feed integration, and rate limit handling.

---

## Introduction

A crypto price alert bot does one thing well: it watches price feeds and posts to X when conditions are met. No dashboards, no databases required at the start — just a price source, the X API, and logic that decides when to post.

This guide walks through building a production-ready alert bot in Node.js. You'll integrate a price feed, set alert thresholds, authenticate with X API v2, and post formatted alerts automatically.

---

## What You Need

- X Developer account with Basic tier ($100/month) or pay-per-use credits
- Node.js 18+
- A price data source (CoinGecko free API, Binance WebSocket, or Chainlink on-chain feeds)
- OAuth 2.0 app credentials from the X Developer Portal

---

## Step 1: Set Up X API Authentication

For posting tweets, you need user-context authentication — specifically OAuth 2.0 with the `tweet.write` scope.

In the X Developer Portal:
1. Create a Project and App
2. Enable OAuth 2.0
3. Set a redirect URI (use `http://localhost:3000/callback` for local dev)
4. Note your Client ID and Client Secret

For bot accounts that only post (not user-facing apps), use the Bearer Token + App-only flow if posting on your own account via OAuth 1.0a user context. The simpler path for a single-account bot:

```bash
# Generate access token and secret via OAuth 1.0a (one-time setup)
npx oauth-tools twitter --consumer-key YOUR_KEY --consumer-secret YOUR_SECRET
```

Store credentials in environment variables — never hardcode them.

```env
X_API_KEY=your_api_key
X_API_SECRET=your_api_secret
X_ACCESS_TOKEN=your_access_token
X_ACCESS_SECRET=your_access_token_secret
```

---

## Step 2: Fetch Crypto Prices

CoinGecko's free API requires no key for basic price fetches:

```javascript
import fetch from 'node-fetch';

async function getPrice(coinId) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  const data = await res.json();
  return {
    price: data[coinId].usd,
    change24h: data[coinId].usd_24h_change
  };
}
```

For lower latency and real-time data, use Binance WebSocket streams:

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

ws.on('message', (raw) => {
  const data = JSON.parse(raw);
  const price = parseFloat(data.c);
  checkAlerts(price);
});
```

---

## Step 3: Define Alert Logic

Alert conditions should be configurable. A simple threshold-based approach:

```javascript
const alerts = [
  { asset: 'bitcoin', symbol: 'BTC', threshold: 100000, direction: 'above', triggered: false },
  { asset: 'ethereum', symbol: 'ETH', threshold: 3000, direction: 'below', triggered: false }
];

function checkAlerts(asset, currentPrice) {
  for (const alert of alerts) {
    if (alert.asset !== asset || alert.triggered) continue;

    const hit = alert.direction === 'above'
      ? currentPrice >= alert.threshold
      : currentPrice <= alert.threshold;

    if (hit) {
      alert.triggered = true;
      postAlert(alert.symbol, currentPrice, alert.threshold, alert.direction);
    }
  }
}
```

The `triggered` flag prevents repeated posts for the same alert. Reset it when price crosses back through the threshold if you want recurring alerts.

---

## Step 4: Post Alerts to X

Use the X API v2 `/2/tweets` endpoint to post:

```javascript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET
});

async function postAlert(symbol, price, threshold, direction) {
  const arrow = direction === 'above' ? '🚀' : '🔻';
  const text = `${arrow} $${symbol} ALERT\n\nPrice: $${price.toLocaleString()}\nThreshold: $${threshold.toLocaleString()} (${direction})\n\n#crypto #${symbol}`;

  try {
    await client.v2.tweet(text);
    console.log(`✅ Alert posted for ${symbol}`);
  } catch (err) {
    console.error(`❌ Failed to post alert: ${err.message}`);
  }
}
```

---

## Step 5: Schedule and Loop

Run price checks on a configurable interval. Avoid polling faster than your data source updates — CoinGecko's free API updates every 60 seconds:

```javascript
const CHECK_INTERVAL_MS = 60_000;

async function runBot() {
  console.log('🤖 Price alert bot started');

  setInterval(async () => {
    for (const alert of alerts) {
      if (alert.triggered) continue;
      const { price } = await getPrice(alert.asset);
      checkAlerts(alert.asset, price);
    }
  }, CHECK_INTERVAL_MS);
}

runBot();
```

For Binance WebSocket, skip the interval — price checks happen on each message.

---

## Handling Rate Limits

X API Basic tier allows 1,500 posts/month. For an alert bot that posts 5-10 times daily, this is sufficient. Key rules:

- Never post more than once per 15-minute window on Basic
- Catch `429` responses and implement exponential backoff
- Log all API calls with timestamps to audit your usage

```javascript
async function postWithRetry(text, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await client.v2.tweet(text);
    } catch (err) {
      if (err.code === 429) {
        const wait = Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, wait));
      } else throw err;
    }
  }
}
```

---

## Deployment

For 24/7 operation, deploy to a VPS or cloud function:

- **Railway / Render** — simple Node.js deployment, $5-7/month
- **AWS Lambda + EventBridge** — event-driven, pay only for invocations
- **Fly.io** — low latency globally, good for WebSocket-based bots

Use `pm2` for process management on VPS deployments:

```bash
pm2 start bot.js --name crypto-alert-bot
pm2 save
pm2 startup
```

---

## Conclusion

A crypto price alert bot on X is a practical starting point for X API development. The core loop is straightforward: fetch price, check threshold, post if triggered. The complexity lives in reliability — handling rate limits, preventing duplicate posts, and keeping the process alive.

Start with CoinGecko polling for simplicity, then graduate to WebSocket streams when you need sub-minute latency. At Basic tier, 1,500 monthly posts gives you plenty of headroom for a focused alert bot covering your key assets.

---

*Related: [X Developer API in 2026: The Complete Guide for Crypto Builders](../x-developer-api-crypto-guide-2026.md)*
