---
title: "DeFi Yield APIs: Find the Best APY Across Protocols (2026)"
meta_description: "How to query yield farming opportunities, staking rewards, and lending rates using DeFiLlama Yields, Zapper, and direct protocol APIs."
keywords: "DeFi yield API, APY API, yield farming API, staking rate API, DeFiLlama yields"
---

# DeFi Yield APIs: Find the Best APY Across Protocols (2026)

Finding the best yield requires querying dozens of protocols. These APIs aggregate yield data across the DeFi ecosystem.

## DeFiLlama Yields (Best Free Option)

```javascript
// All yield pools across all chains and protocols
const { data: pools } = await fetch('https://yields.llama.fi/pools').then(r => r.json());

console.log('Total pools:', pools.length);

// Top stablecoin yields
const stableYields = pools
  .filter(p =>
    p.stablecoin &&
    p.tvlUsd > 1_000_000 &&
    p.apy > 0 &&
    !p.ilRisk
  )
  .sort((a, b) => b.apy - a.apy)
  .slice(0, 20);

stableYields.forEach(p => {
  console.log(`${p.project} | ${p.symbol} | ${p.chain} | APY: ${p.apy.toFixed(2)}% | TVL: $${(p.tvlUsd/1e6).toFixed(0)}M`);
});

// Highest ETH staking yields
const ethYields = pools
  .filter(p => p.symbol === 'ETH' || p.symbol.includes('stETH') || p.symbol.includes('wstETH'))
  .sort((a, b) => b.apy - a.apy);
```

## Historical APY

```javascript
// APY history for a specific pool
const poolId = 'your-pool-id'; // from the pools list
const history = await fetch(`https://yields.llama.fi/chart/${poolId}`).then(r => r.json());
history.data.slice(-30).forEach(({ timestamp, apy, tvlUsd }) => {
  console.log(new Date(timestamp).toLocaleDateString(), `APY: ${apy.toFixed(2)}%`, `TVL: $${(tvlUsd/1e6).toFixed(0)}M`);
});
```

## Aave Interest Rates (Direct)

```javascript
const AAVE_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3';

const { reserves } = await fetch(AAVE_SUBGRAPH, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ reserves { symbol liquidityRate variableBorrowRate } }' })
}).then(r => r.json()).then(d => d.data);

reserves.forEach(r => {
  const depositApy = (parseFloat(r.liquidityRate) / 1e27) * 100;
  const borrowApy = (parseFloat(r.variableBorrowRate) / 1e27) * 100;
  if (depositApy > 0) console.log(`${r.symbol}: Supply ${depositApy.toFixed(3)}% | Borrow ${borrowApy.toFixed(3)}%`);
});
```

## Compound Rates

```javascript
// Compound V3 USDC market
const COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const cometAbi = [
  'function getSupplyRate(uint utilization) view returns (uint64)',
  'function getBorrowRate(uint utilization) view returns (uint64)',
  'function getUtilization() view returns (uint)'
];

const comet = new ethers.Contract(COMET, cometAbi, provider);
const utilization = await comet.getUtilization();
const supplyRate = await comet.getSupplyRate(utilization);
const borrowRate = await comet.getBorrowRate(utilization);

// Convert per-second rate to APY
const SECONDS_PER_YEAR = 31_536_000;
const supplyApy = (Math.pow(Number(supplyRate) / 1e18 * SECONDS_PER_YEAR + 1, 1) - 1) * 100;
console.log('Supply APY:', supplyApy.toFixed(3), '%');
```

## Lido Staking Rate

```javascript
// Lido stETH APR
const res = await fetch('https://eth-api.lido.fi/v1/protocol/steth/apr/sma').then(r => r.json());
console.log('Lido stETH APR (7d SMA):', res.data.smaApr, '%');

// Rocket Pool rETH APR
const rp = await fetch('https://api.rocketpool.net/api/eth/apr').then(r => r.json());
console.log('Rocket Pool APR:', rp.yearlyAPR, '%');
```
