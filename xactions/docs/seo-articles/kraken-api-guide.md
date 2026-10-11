---
title: "Kraken API Guide: Trading and Market Data for Developers (2026)"
meta_description: "Complete guide to the Kraken API — authentication, order placement, margin trading, WebSocket feeds, and staking endpoints with code examples."
keywords: "Kraken API, Kraken trading API, Kraken WebSocket, Kraken REST API, crypto exchange API"
---

# Kraken API Guide: Trading and Market Data for Developers (2026)

Kraken offers a robust API for spot trading, futures, margin, staking, and market data. It's especially popular with European traders and institutions due to its strong regulatory compliance.

## Base URLs

- REST: `https://api.kraken.com`
- WebSocket: `wss://ws.kraken.com/v2`
- Futures REST: `https://futures.kraken.com`

## Authentication

Kraken uses HMAC-SHA512 with a nonce:

```javascript
import crypto from 'crypto';

function getKrakenSignature(path, postData, secret) {
  const { nonce } = postData;
  const message = postData.nonce + new URLSearchParams(postData).toString();
  const secret_buffer = Buffer.from(secret, 'base64');
  const hash = crypto.createHash('sha256').update(nonce + message).digest('binary');
  const hmac = crypto.createHmac('sha512', secret_buffer);
  return hmac.update(path + hash, 'binary').digest('base64');
}

async function privateRequest(path, data, apiKey, apiSecret) {
  const postData = { nonce: Date.now().toString(), ...data };
  const signature = getKrakenSignature('/0' + path, postData, apiSecret);

  const res = await fetch(`https://api.kraken.com/0${path}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(postData)
  });
  return res.json();
}
```

## Market Data (Public)

```javascript
// Ticker for multiple pairs
const res = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD');
const { result } = await res.json();
console.log(result.XXBTZUSD.c[0]); // Last trade price

// OHLCV data
const ohlc = await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60');
```

## Placing Orders

```javascript
const order = await privateRequest('/private/AddOrder', {
  pair: 'XBTUSD',
  type: 'buy',
  ordertype: 'limit',
  price: '50000',
  volume: '0.001',
  validate: false // set true to test without placing
}, apiKey, apiSecret);
console.log(order.result.txid);
```

## WebSocket v2

```javascript
const ws = new WebSocket('wss://ws.kraken.com/v2');

ws.onopen = () => {
  // Subscribe to ticker
  ws.send(JSON.stringify({
    method: 'subscribe',
    params: { channel: 'ticker', symbol: ['BTC/USD', 'ETH/USD'] }
  }));

  // Subscribe to order book
  ws.send(JSON.stringify({
    method: 'subscribe',
    params: { channel: 'book', symbol: ['BTC/USD'], depth: 10 }
  }));
};
```

## Staking API

```javascript
// Get stakeable assets
const stakeable = await privateRequest('/private/Staking/Assets', {}, apiKey, apiSecret);

// Stake assets
const stake = await privateRequest('/private/Stake', {
  asset: 'ETH',
  amount: '1.0',
  method: 'ethereum-validator'
}, apiKey, apiSecret);
```

## Rate Limits

Kraken uses a counter-based system. Your counter starts at 15 (Starter) or 20 (Intermediate/Pro). Each private call costs 1 counter, with 0.33–1 counter/second regeneration. Exceeding triggers HTTP 429.
