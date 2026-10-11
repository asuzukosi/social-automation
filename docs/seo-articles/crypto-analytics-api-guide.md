---
title: "Crypto Analytics APIs: On-Chain Metrics and Market Intelligence (2026)"
meta_description: "Best APIs for on-chain analytics — Glassnode, Messari, Nansen, and Santiment. Track whale activity, exchange flows, and miner behavior."
keywords: "crypto analytics API, on-chain analytics API, Glassnode API, Messari API, Nansen API"
---

# Crypto Analytics APIs: On-Chain Metrics and Market Intelligence (2026)

On-chain analytics APIs provide institutional-grade intelligence: exchange flows, realized cap, SOPR, MVRV, and whale wallet tracking — signals unavailable from price data alone.

## Glassnode API

Glassnode is the industry standard for on-chain metrics:

```javascript
const BASE = 'https://api.glassnode.com/v1/metrics';
const key = process.env.GLASSNODE_API_KEY;

// Exchange net position change (are whales depositing or withdrawing?)
const flow = await fetch(
  `${BASE}/distribution/exchange_net_position_change?a=BTC&i=24h&api_key=${key}`
).then(r => r.json());

// MVRV (Market Value to Realized Value) — overvalued/undervalued signal
const mvrv = await fetch(
  `${BASE}/market/mvrv?a=BTC&i=24h&api_key=${key}`
).then(r => r.json());

// Active addresses
const activeAddresses = await fetch(
  `${BASE}/addresses/active_count?a=BTC&i=24h&api_key=${key}`
).then(r => r.json());

// Format: [{t: timestamp, v: value}, ...]
mvrv.slice(-7).forEach(({ t, v }) => {
  console.log(new Date(t * 1000).toLocaleDateString(), 'MVRV:', v.toFixed(3));
});
```

### Key Glassnode Metrics

| Metric | Endpoint | Signal |
|---|---|---|
| MVRV | `market/mvrv` | >3.5 = overvalued, <1 = undervalued |
| SOPR | `indicators/sopr` | >1 = selling at profit, <1 = selling at loss |
| Exchange inflows | `transactions/transfers_to_exchanges_count` | High = selling pressure |
| Long-term holder supply | `supply/lth_sum` | Accumulation vs. distribution |
| Hash ribbon | `mining/hash_ribbon` | Miner capitulation signal |

## Messari API

```javascript
const BASE = 'https://data.messari.io/api/v1';
const key = process.env.MESSARI_API_KEY;

// Asset metrics
const btc = await fetch(`${BASE}/assets/btc/metrics`, {
  headers: { 'x-messari-api-key': key }
}).then(r => r.json());

console.log('Market cap:', btc.data.market_data.real_volume_last_24_hours);
console.log('Realized cap:', btc.data.supply.y_2050);
console.log('ROI 1y:', btc.data.roi_data.percent_change_last_1_year, '%');

// Protocol revenue
const protocols = await fetch('https://data.messari.io/api/v1/protocols', {
  headers: { 'x-messari-api-key': key }
}).then(r => r.json());
```

## Nansen (Wallet Labels)

```javascript
// Nansen labels known wallets (funds, exchanges, whales)
const res = await fetch(`https://api.nansen.ai/labels/${address}`, {
  headers: { 'apiKey': process.env.NANSEN_API_KEY }
}).then(r => r.json());
console.log(res.labels); // e.g., ["Smart Money", "DEX Trader"]
```

## Santiment API

```javascript
// Social volume for a crypto asset
const SANTIMENT_GQL = 'https://api.santiment.net/graphql';

const query = `{
  socialVolume(slug: "bitcoin", from: "2025-01-01T00:00:00Z", to: "2025-01-07T00:00:00Z", interval: "1d", socialVolumeType: PROFESSIONAL_TRADERS_CHAT_OVERVIEW) {
    datetime
    mentionsCount
  }
}`;

const res = await fetch(SANTIMENT_GQL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Apikey ${process.env.SANTIMENT_API_KEY}`
  },
  body: JSON.stringify({ query })
}).then(r => r.json());
```

## Build Your Own: On-Chain Whale Tracker

```javascript
// Track large ETH movements using Alchemy
const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_KEY });

const transfers = await alchemy.core.getAssetTransfers({
  category: ['external'],
  minValue: 100, // >100 ETH
  withMetadata: true,
  maxCount: 20
});

transfers.transfers.forEach(t => {
  console.log(`🐋 ${t.value.toFixed(0)} ETH: ${t.from} → ${t.to}`);
});
```
