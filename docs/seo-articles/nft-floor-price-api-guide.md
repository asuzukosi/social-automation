---
title: "NFT Floor Price APIs: Real-Time and Historical Collection Data (2026)"
meta_description: "Fetch NFT floor prices in real time from OpenSea, Blur, Reservoir, and Simplehash. Build price trackers, alerts, and analytics dashboards."
keywords: "NFT floor price API, OpenSea floor price, NFT price API, Reservoir API floor price, NFT collection stats API"
---

# NFT Floor Price APIs: Real-Time and Historical Collection Data (2026)

NFT floor prices are volatile and sourced from multiple marketplaces. Reliable apps aggregate from several APIs and cross-reference listings.

## Reservoir (Multi-Marketplace Aggregator)

Reservoir aggregates listings from OpenSea, Blur, X2Y2, LooksRare, and more — giving a true floor across all venues:

```javascript
const headers = { 'x-api-key': process.env.RESERVOIR_API_KEY };
const BASE = 'https://api.reservoir.tools';

// Collection floor price
const stats = await fetch(
  `${BASE}/collections/v7?id=0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D`,
  { headers }
).then(r => r.json());

const col = stats.collections[0];
console.log('Floor:', col.floorAsk.price.amount.native, 'ETH');
console.log('24h Volume:', col.volume['1day'], 'ETH');
console.log('Floor change 24h:', col.floorSaleChange['1day'], '%');
console.log('Owner count:', col.ownerCount);
```

## OpenSea (Direct)

```javascript
const os = { headers: { 'X-API-KEY': process.env.OPENSEA_API_KEY } };

const stats = await fetch(
  'https://api.opensea.io/api/v2/collections/boredapeyachtclub/stats',
  os
).then(r => r.json());

console.log('Floor:', stats.total.floor_price, 'ETH');
console.log('24h Volume:', stats.intervals[0].volume, 'ETH');
console.log('All-time Volume:', stats.total.volume, 'ETH');
```

## Alchemy NFT API

```javascript
import { Alchemy, Network } from 'alchemy-sdk';
const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_KEY, network: Network.ETH_MAINNET });

const floor = await alchemy.nft.getFloorPrice('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D');
console.log('OpenSea floor:', floor.openSea?.floorPrice, 'ETH');
console.log('LooksRare floor:', floor.looksRare?.floorPrice, 'ETH');
```

## Simplehash (Multi-Chain)

```javascript
const simplehash = { headers: { 'X-API-KEY': process.env.SIMPLEHASH_KEY } };

// Works across Ethereum, Polygon, Solana, etc.
const col = await fetch(
  'https://api.simplehash.com/api/v0/nfts/collections/ethereum/0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
  simplehash
).then(r => r.json());

col.floor_prices.forEach(fp => {
  console.log(`${fp.marketplace_name}: ${fp.value / 1e18} ETH`);
});
```

## Historical Floor Price

```javascript
// Reservoir historical floor price
const history = await fetch(
  `${BASE}/collections/0xBC4CA0.../floor-ask-price/v1?normalizeRoyalties=false&sortDirection=desc&limit=30`,
  { headers }
).then(r => r.json());
```

## Floor Price Alert Bot

```javascript
class FloorPriceAlerts {
  constructor(collection, alerts) {
    this.collection = collection;
    this.alerts = alerts; // [{threshold, direction, webhook}]
  }

  async check() {
    const floor = await this.getFloor();

    for (const alert of this.alerts) {
      const triggered =
        alert.direction === 'below' ? floor < alert.threshold :
        alert.direction === 'above' ? floor > alert.threshold : false;

      if (triggered) {
        await fetch(alert.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Floor ${alert.direction} ${alert.threshold} ETH — currently ${floor} ETH`
          })
        });
      }
    }
    return floor;
  }

  async getFloor() {
    const data = await fetch(
      `https://api.reservoir.tools/collections/v7?id=${this.collection}`,
      { headers: { 'x-api-key': process.env.RESERVOIR_KEY } }
    ).then(r => r.json());
    return data.collections[0].floorAsk.price.amount.native;
  }
}

const monitor = new FloorPriceAlerts('0xBC4CA0...', [
  { threshold: 10, direction: 'below', webhook: process.env.SLACK_WEBHOOK }
]);
setInterval(() => monitor.check(), 60000);
```
