---
title: "Coinbase Advanced Trade API: Developer Guide (2026)"
meta_description: "Full guide to the Coinbase Advanced Trade API — authentication, order management, market data, and WebSocket feeds with JavaScript examples."
keywords: "Coinbase API, Coinbase Advanced Trade API, Coinbase Pro API, Coinbase trading API"
---

# Coinbase Advanced Trade API: Developer Guide (2026)

Coinbase Advanced Trade API (formerly Coinbase Pro) is the institutional-grade trading interface for Coinbase. It offers REST endpoints for order management and real-time WebSocket feeds for market data.

## Base URL

`https://api.coinbase.com/api/v3/brokerage/`

## Authentication

Coinbase uses JWT-based authentication for all private endpoints.

```javascript
import { SignJWT } from 'jose';
import crypto from 'crypto';

async function createJWT(apiKeyName, privateKey) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(privateKey, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  return new SignJWT({ sub: apiKeyName, iss: 'cdp', nbf: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: 'ES256', kid: apiKeyName })
    .setExpirationTime('2m')
    .sign(key);
}
```

## Key Endpoints

| Endpoint | Description |
|---|---|
| `GET /products` | List all trading pairs |
| `GET /products/{id}/candles` | OHLCV data |
| `GET /best_bid_ask` | Best bid/ask for symbols |
| `POST /orders` | Place an order |
| `GET /orders/historical/batch` | Order history |
| `GET /portfolios` | Portfolio balances |

## Placing an Order

```javascript
const order = {
  client_order_id: crypto.randomUUID(),
  product_id: 'BTC-USD',
  side: 'BUY',
  order_configuration: {
    limit_limit_gtc: {
      base_size: '0.001',
      limit_price: '50000'
    }
  }
};

const res = await fetch('https://api.coinbase.com/api/v3/brokerage/orders', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(order)
});
```

## WebSocket Feed

```javascript
const ws = new WebSocket('wss://advanced-trade-ws.coinbase.com');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    product_ids: ['BTC-USD', 'ETH-USD'],
    channel: 'ticker'
  }));
};
```

**Channels:** ticker, level2, market_trades, user (private)

## Rate Limits

- Public endpoints: 10 requests/second
- Private endpoints: 30 requests/second
- WebSocket: 750 subscriptions per connection

## Sandbox Environment

Test without real funds at `https://api-public.sandbox.exchange.coinbase.com`. Sandbox accounts come pre-funded with test assets.
