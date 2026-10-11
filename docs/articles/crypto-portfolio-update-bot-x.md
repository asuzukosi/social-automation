# Building a Crypto Portfolio Update Bot for X

**Meta description:** Build a Node.js bot that posts automated crypto portfolio updates to X, including price changes, P&L summaries, and market alerts using the X API v2.

---

## Introduction

A crypto portfolio update bot posts regular snapshots of your holdings directly to X — price changes, P&L, top movers, and custom alerts. These bots are useful for transparency in public investment communities, automated reporting for funds, or personal accountability. This guide covers the full implementation: fetching price data, formatting tweet content, and posting through the X API v2.

## Architecture Overview

The bot has three components:

1. **Price fetcher** — pulls current prices from a public API (CoinGecko, Binance, etc.)
2. **Portfolio calculator** — computes P&L, allocation percentages, 24h changes
3. **X poster** — formats and publishes the tweet via X API v2

You can run this on a cron schedule (every hour, every 4 hours, on market open/close).

## Fetching Portfolio Prices

Use CoinGecko's free API for price data. No key required for basic usage:

```javascript
async function fetchPrices(coinIds) {
  const ids = coinIds.join(',');
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
  );
  if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
  return res.json();
}

// Usage
const prices = await fetchPrices(['bitcoin', 'ethereum', 'solana']);
// { bitcoin: { usd: 67000, usd_24h_change: 2.3 }, ... }
```

## Computing Portfolio Metrics

```javascript
function computePortfolio(holdings, prices) {
  let totalValue = 0;
  let totalCostBasis = 0;

  const positions = holdings.map(({ id, symbol, amount, avgCost }) => {
    const price = prices[id]?.usd ?? 0;
    const change24h = prices[id]?.usd_24h_change ?? 0;
    const value = amount * price;
    const costBasis = amount * avgCost;
    const pnl = value - costBasis;
    const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

    totalValue += value;
    totalCostBasis += costBasis;

    return { id, symbol, amount, price, value, change24h, pnl, pnlPct };
  });

  const totalPnl = totalValue - totalCostBasis;
  const totalPnlPct = totalCostBasis > 0 ? (totalPnl / totalCostBasis) * 100 : 0;

  return { positions, totalValue, totalPnl, totalPnlPct };
}
```

## Formatting the Tweet

X posts have a 280 character limit. Keep the format tight and scannable:

```javascript
function formatPortfolioTweet(portfolio, label = 'Portfolio Update') {
  const { positions, totalValue, totalPnl, totalPnlPct } = portfolio;

  const pnlSign = totalPnl >= 0 ? '+' : '';
  const header = `📊 ${label}\n💼 $${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}\n${pnlSign}${totalPnlPct.toFixed(2)}% all-time\n\n`;

  const topMovers = [...positions]
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 4);

  const lines = topMovers.map(p => {
    const arrow = p.change24h >= 0 ? '▲' : '▼';
    return `${p.symbol} ${arrow}${Math.abs(p.change24h).toFixed(1)}%`;
  });

  const footer = `\n${new Date().toUTCString().slice(0, 16)} UTC`;
  return header + lines.join(' · ') + footer;
}
```

Example output:
```
📊 Portfolio Update
💼 $142,300
+18.40% all-time

BTC ▲2.3% · ETH ▼1.1% · SOL ▲5.8% · ARB ▼3.2%
Mon, 06 Jan 2025 UTC
```

## Posting to X API v2

Use the `POST /2/tweets` endpoint with OAuth 2.0 user context (required for posting):

```javascript
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';

async function postTweet(text, credentials) {
  const { apiKey, apiSecret, accessToken, accessTokenSecret } = credentials;

  const oauth = new OAuth({
    consumer: { key: apiKey, secret: apiSecret },
    signature_method: 'HMAC-SHA1',
    hash_function: (base, key) =>
      crypto.createHmac('sha1', key).update(base).digest('base64'),
  });

  const url = 'https://api.twitter.com/2/tweets';
  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method: 'POST' }, { key: accessToken, secret: accessTokenSecret })
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Tweet failed: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  console.log(`✅ Posted: https://x.com/i/web/status/${data.data.id}`);
  return data.data;
}
```

## Scheduling with Cron

Use `node-cron` for scheduling without an external scheduler:

```javascript
import cron from 'node-cron';

const HOLDINGS = [
  { id: 'bitcoin', symbol: 'BTC', amount: 0.5, avgCost: 45000 },
  { id: 'ethereum', symbol: 'ETH', amount: 4.2, avgCost: 2800 },
  { id: 'solana', symbol: 'SOL', amount: 50, avgCost: 120 },
];

// Post every 4 hours
cron.schedule('0 */4 * * *', async () => {
  try {
    const prices = await fetchPrices(HOLDINGS.map(h => h.id));
    const portfolio = computePortfolio(HOLDINGS, prices);
    const text = formatPortfolioTweet(portfolio);
    await postTweet(text, credentials);
  } catch (err) {
    console.error('❌ Portfolio update failed:', err.message);
  }
});
```

## Adding Price Alert Tweets

Trigger additional tweets when a holding moves more than a threshold:

```javascript
async function checkAndAlertMovers(portfolio, credentials, threshold = 5) {
  for (const pos of portfolio.positions) {
    if (Math.abs(pos.change24h) >= threshold) {
      const direction = pos.change24h > 0 ? '🚀 pumping' : '🔻 dumping';
      const text = `⚠️ Alert: ${pos.symbol} is ${direction} ${pos.change24h.toFixed(1)}% in 24h\nCurrent price: $${pos.price.toLocaleString()}\n\n#crypto #${pos.symbol}`;
      await postTweet(text, credentials);
      await new Promise(r => setTimeout(r, 2000)); // avoid burst posting
    }
  }
}
```

## Conclusion

The portfolio update bot pattern is straightforward: fetch prices, compute metrics, format within 280 characters, post. The complexity is in the scheduling and alert logic. Add Redis to track which alerts you've already sent and you have a production-grade system that reports on your portfolio without manual input.
