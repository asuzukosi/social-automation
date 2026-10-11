---
title: "CoinGecko API Guide: Free Crypto Market Data (2026)"
meta_description: "How to use the CoinGecko API for free crypto price data, market cap, historical OHLCV, DeFi data, and NFT floor prices. No API key required for basic use."
keywords: "CoinGecko API, CoinGecko free API, crypto price API, crypto market data free"
---

# CoinGecko API Guide: Free Crypto Market Data (2026)

CoinGecko offers one of the most comprehensive free crypto market data APIs, covering 10,000+ cryptocurrencies, DeFi protocols, and NFT collections.

## Base URL

- Free (no key): `https://api.coingecko.com/api/v3`
- Pro: `https://pro-api.coingecko.com/api/v3`

## Get Current Price

```javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,btc'
);
const prices = await res.json();
console.log(prices.bitcoin.usd); // e.g., 95000
```

## Get Market Data

```javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1'
);
const coins = await res.json();
// Returns: id, symbol, name, current_price, market_cap, total_volume, price_change_percentage_24h
```

## Historical Price Data

```javascript
// Daily prices for last 365 days
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily'
);
const { prices, market_caps, total_volumes } = await res.json();
// prices = [[timestamp, price], ...]
```

## OHLCV Data

```javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=30'
);
const ohlc = await res.json();
// [[timestamp, open, high, low, close], ...]
```

## Coin Details

```javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false'
);
const coin = await res.json();
console.log(coin.market_data.circulating_supply);
console.log(coin.market_data.ath.usd); // All-time high
```

## DeFi Data

```javascript
// Global DeFi stats
const res = await fetch('https://api.coingecko.com/api/v3/global/decentralized_finance_defi');
const { data } = await res.json();
console.log(data.defi_market_cap, data.trading_volume_24h);
```

## NFT Floor Prices

```javascript
const res = await fetch('https://api.coingecko.com/api/v3/nfts/cryptopunks');
const nft = await res.json();
console.log(nft.floor_price.native_currency); // Floor in ETH
```

## Rate Limits

| Tier | Calls/min | Monthly |
|---|---|---|
| Free (no key) | 30 | ~43K |
| Demo (free key) | 30 | ~43K |
| Analyst | 500 | 720K |
| Lite | 500 | 720K |
| Pro | 500 | 720K |
| Enterprise | Custom | Custom |

## Coin ID Lookup

CoinGecko uses string IDs (e.g., `bitcoin`, `ethereum`), not symbols. Get the full list:

```javascript
const res = await fetch('https://api.coingecko.com/api/v3/coins/list');
const coins = await res.json(); // [{id, symbol, name}, ...]
```
