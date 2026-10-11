---
title: "Binance API Guide: Complete Reference for Developers (2026)"
meta_description: "Learn how to use the Binance API for spot trading, futures, market data, and WebSocket streams. Includes code examples and authentication setup."
keywords: "Binance API, Binance trading API, Binance WebSocket, Binance REST API"
---

# Binance API Guide: Complete Reference for Developers (2026)

The Binance API is the most widely used cryptocurrency exchange API in the world, powering millions of trading bots, portfolio trackers, and analytics tools. This guide covers everything you need to integrate with Binance's REST and WebSocket APIs.

## Authentication

Binance uses HMAC-SHA256 signed requests for private endpoints. Generate an API key in your account settings, then sign each request with your secret key.

```javascript
import crypto from 'crypto';

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function getAccountInfo(apiKey, secret) {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = sign(query, secret);

  const res = await fetch(
    `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );
  return res.json();
}
```

## Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/v3/ticker/price` | GET | Latest price for a symbol |
| `/api/v3/klines` | GET | OHLCV candlestick data |
| `/api/v3/depth` | GET | Order book snapshot |
| `/api/v3/order` | POST | Place a new order |
| `/api/v3/account` | GET | Account balances |
| `/api/v3/myTrades` | GET | Trade history |

## Fetching Candlestick Data

```javascript
const res = await fetch(
  'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100'
);
const candles = await res.json();
// [openTime, open, high, low, close, volume, closeTime, ...]
```

## WebSocket Streams

Binance WebSocket streams deliver real-time data without polling.

```javascript
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

ws.onmessage = (event) => {
  const trade = JSON.parse(event.data);
  console.log(`Price: ${trade.p}, Qty: ${trade.q}`);
};
```

**Available streams:**
- `<symbol>@trade` — real-time trade stream
- `<symbol>@kline_<interval>` — candlestick updates
- `<symbol>@depth` — order book diffs
- `<symbol>@bookTicker` — best bid/ask

## Rate Limits

Binance enforces weight-based rate limits. Each endpoint costs 1–50 weight units. The default limit is 1,200 weight per minute. Exceeding it returns HTTP 429, and repeated violations result in a temporary IP ban (HTTP 418).

Always check the `X-MBX-USED-WEIGHT-1M` response header to monitor consumption.

## Order Types

Binance supports: LIMIT, MARKET, STOP_LOSS, STOP_LOSS_LIMIT, TAKE_PROFIT, TAKE_PROFIT_LIMIT, LIMIT_MAKER. For most bots, LIMIT and MARKET cover 90% of use cases.

## Futures API

The Futures API lives at `https://fapi.binance.com`. It shares the same authentication scheme but has additional endpoints for leverage, position, and funding rate data.

```javascript
// Get funding rate history
const res = await fetch(
  'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=10'
);
```

## Best Practices

- Cache public market data (prices, candles) for at least 1 second
- Use WebSockets instead of polling for latency-sensitive strategies
- Implement exponential backoff on 429 responses
- Never store API keys in source code — use environment variables
- Enable IP restrictions on your API key in account settings
