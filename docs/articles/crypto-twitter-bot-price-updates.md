# Building a Crypto Twitter Bot That Posts Price Updates

**Meta description:** Learn how to build a crypto Twitter bot that automatically posts real-time price updates using Node.js, the CoinGecko API, and X API v2 OAuth 2.0.

---

## Introduction

Automated price bots are one of the most practical applications at the intersection of crypto and social media. Whether you're running a project token tracker, a DeFi protocol dashboard, or a personal portfolio alert system, posting price updates to X keeps your audience informed without manual effort. This guide walks through building a production-ready crypto price bot in Node.js using the CoinGecko public API and X API v2.

---

## Prerequisites and Setup

You need:
- Node.js >= 18
- An X Developer account with a project and app
- OAuth 2.0 App-only Bearer Token or OAuth 1.0a credentials for posting
- CoinGecko API (free tier works for polling)

Install dependencies:

```bash
npm install axios twitter-api-v2 node-cron dotenv
```

Store credentials in `.env`:

```env
X_API_KEY=your_api_key
X_API_SECRET=your_api_secret
X_ACCESS_TOKEN=your_access_token
X_ACCESS_SECRET=your_access_secret
COINGECKO_API=https://api.coingecko.com/api/v3
```

---

## Fetching Price Data from CoinGecko

CoinGecko's `/simple/price` endpoint returns prices for multiple coins in a single request. Batch your queries to avoid rate limits.

```js
import axios from 'axios';

async function getPrices(coinIds = ['bitcoin', 'ethereum', 'solana']) {
  const url = `${process.env.COINGECKO_API}/simple/price`;
  const { data } = await axios.get(url, {
    params: {
      ids: coinIds.join(','),
      vs_currencies: 'usd',
      include_24hr_change: true,
    },
  });
  return data;
}
```

This returns an object like:

```json
{
  "bitcoin": { "usd": 67420, "usd_24h_change": 2.34 },
  "ethereum": { "usd": 3510, "usd_24h_change": -1.12 }
}
```

---

## Formatting the Tweet

Keep the format consistent and scannable. Crypto audiences respond to clean, fast-reading posts.

```js
function formatPricePost(prices) {
  const lines = Object.entries(prices).map(([coin, data]) => {
    const change = data.usd_24h_change.toFixed(2);
    const arrow = change >= 0 ? '▲' : '▼';
    const symbol = coin === 'bitcoin' ? 'BTC' : coin === 'ethereum' ? 'ETH' : coin.toUpperCase();
    return `${symbol}: $${data.usd.toLocaleString()} ${arrow} ${Math.abs(change)}%`;
  });

  const timestamp = new Date().toUTCString().slice(0, 25);
  return `Crypto Prices | ${timestamp} UTC\n\n${lines.join('\n')}\n\n#crypto #bitcoin #ethereum`;
}
```

---

## Posting to X with twitter-api-v2

Use OAuth 1.0a user context to post tweets. App-only Bearer Token is read-only — you need user context for write operations.

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

async function postPriceUpdate() {
  const prices = await getPrices(['bitcoin', 'ethereum', 'solana']);
  const text = formatPricePost(prices);

  try {
    const { data } = await client.v2.tweet(text);
    console.log(`Posted tweet: ${data.id}`);
  } catch (err) {
    console.error('Post failed:', err.message);
  }
}
```

---

## Scheduling with node-cron

Post on a fixed interval. Hourly is reasonable for price bots without exceeding X's free tier write limits (500 posts/month on Basic).

```js
import cron from 'node-cron';

// Every hour at :00
cron.schedule('0 * * * *', async () => {
  console.log('Running price update...');
  await postPriceUpdate();
});

console.log('Price bot started');
```

---

## Handling Rate Limits and Errors

X enforces rate limits per endpoint. The v2 `/tweets` POST endpoint allows 50 requests per 15-minute window per user. Add exponential backoff for transient failures:

```js
async function postWithRetry(text, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.v2.tweet(text);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`Retry ${attempt} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

Check for HTTP 429 responses and respect the `x-rate-limit-reset` header if you want precise backoff timing.

---

## Avoiding Duplicate Posts

X rejects tweets with identical content. Add a timestamp or slight variation to each post, or track the last posted price and skip if the change is under a threshold:

```js
let lastPrices = {};

function hasSignificantChange(newPrices, threshold = 0.5) {
  return Object.entries(newPrices).some(([coin, data]) => {
    const last = lastPrices[coin]?.usd ?? 0;
    return Math.abs((data.usd - last) / last) * 100 > threshold;
  });
}
```

---

## Conclusion

A crypto price bot is a straightforward Node.js project that delivers real value with minimal infrastructure. Combine CoinGecko's free API with X API v2 user-context credentials, schedule posts with node-cron, and add retry logic to handle transient errors. From here, extend the bot to track specific tokens, alert on price spikes, or post DeFi protocol stats — the pattern is the same.
