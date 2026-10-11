---
title: "DeFiLlama API Guide: Free DeFi TVL and Protocol Data (2026)"
meta_description: "Learn to use the DeFiLlama API for DeFi TVL, protocol revenue, yields, stablecoin data, and bridges — completely free with no API key required."
keywords: "DeFiLlama API, DeFi TVL API, DeFi protocol data API, DeFiLlama free, yield API"
---

# DeFiLlama API Guide: Free DeFi TVL and Protocol Data (2026)

DeFiLlama is the leading DeFi analytics platform, and its API is completely free with no API key required. It covers TVL, revenue, yields, stablecoins, bridges, and more across 200+ chains and 3,000+ protocols.

## Base URL

`https://api.llama.fi`

No authentication required.

## TVL Data

```javascript
// Global DeFi TVL
const res = await fetch('https://api.llama.fi/v2/globalCharts');
const data = await res.json();
// [{date, totalLiquidityUSD}, ...]

// All protocols with current TVL
const protocols = await fetch('https://api.llama.fi/protocols').then(r => r.json());
protocols.slice(0, 5).forEach(p => {
  console.log(p.name, p.chain, `$${(p.tvl / 1e9).toFixed(2)}B`);
});

// Single protocol TVL history
const aave = await fetch('https://api.llama.fi/protocol/aave').then(r => r.json());
console.log(aave.tvl); // Historical TVL array
```

## Chain TVL

```javascript
// TVL by chain
const chains = await fetch('https://api.llama.fi/v2/chains').then(r => r.json());
chains.sort((a, b) => b.tvl - a.tvl).slice(0, 10).forEach(c => {
  console.log(c.name, `$${(c.tvl / 1e9).toFixed(1)}B`);
});
```

## Yields (APY Data)

```javascript
const pools = await fetch('https://yields.llama.fi/pools').then(r => r.json());

// Find highest yield stablecoin pools
const stablePools = pools.data
  .filter(p => p.stablecoin && p.tvlUsd > 1_000_000)
  .sort((a, b) => b.apy - a.apy)
  .slice(0, 10);

stablePools.forEach(p => {
  console.log(`${p.project} ${p.symbol}: ${p.apy.toFixed(2)}% APY (TVL: $${(p.tvlUsd/1e6).toFixed(0)}M)`);
});
```

## Stablecoin Data

```javascript
// All stablecoins
const stables = await fetch('https://stablecoins.llama.fi/stablecoins').then(r => r.json());

// USDC circulating supply
const usdc = stables.peggedAssets.find(s => s.symbol === 'USDC');
console.log('USDC mcap:', usdc.circulating.peggedUSD);

// Historical peg data
const history = await fetch('https://stablecoins.llama.fi/stablecoincharts/all').then(r => r.json());
```

## Protocol Revenue

```javascript
// Revenue for all protocols
const revenue = await fetch('https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=true').then(r => r.json());

revenue.protocols.sort((a, b) => (b.total30d || 0) - (a.total30d || 0)).slice(0, 5).forEach(p => {
  console.log(p.name, `30d revenue: $${(p.total30d / 1e6).toFixed(1)}M`);
});
```

## Bridge Volume

```javascript
const bridges = await fetch('https://bridges.llama.fi/bridges').then(r => r.json());
bridges.bridges.sort((a, b) => b.lastMonthVolume - a.lastMonthVolume).slice(0, 5).forEach(b => {
  console.log(b.displayName, `Monthly: $${(b.lastMonthVolume / 1e9).toFixed(1)}B`);
});
```

## API Endpoints Summary

| Endpoint | Data |
|---|---|
| `/protocols` | All protocols + TVL |
| `/protocol/{slug}` | Protocol TVL history |
| `/v2/chains` | TVL by chain |
| `/v2/globalCharts` | Global DeFi TVL chart |
| `/overview/fees` | Protocol revenue |
| `yields.llama.fi/pools` | Yield opportunities |
| `stablecoins.llama.fi/stablecoins` | Stablecoin data |
| `bridges.llama.fi/bridges` | Bridge volume |
