---
title: "Uniswap API Guide: DEX Data and Swap Integration (2026)"
meta_description: "How to query Uniswap V3 pool data, execute swaps, get token prices, and access liquidity analytics using the Uniswap subgraph and SDK."
keywords: "Uniswap API, Uniswap V3 API, Uniswap subgraph, DEX API, token swap API"
---

# Uniswap API Guide: DEX Data and Swap Integration (2026)

Uniswap is the largest decentralized exchange by volume. You can access its data via The Graph subgraph or execute swaps programmatically via the Uniswap SDK.

## Data via The Graph

```javascript
const UNISWAP_V3 = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

async function graphQuery(query) {
  const res = await fetch(UNISWAP_V3, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return (await res.json()).data;
}
```

## Top Pools by TVL

```javascript
const { pools } = await graphQuery(`{
  pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    token0 { symbol }
    token1 { symbol }
    feeTier
    totalValueLockedUSD
    volumeUSD
    token0Price
    token1Price
  }
}`);
```

## Token Price

```javascript
const { token } = await graphQuery(`{
  token(id: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
    symbol
    derivedETH
    tokenDayData(first: 7, orderBy: date, orderDirection: desc) {
      date
      priceUSD
      volumeUSD
    }
  }
}`);
```

## Recent Swaps

```javascript
const { swaps } = await graphQuery(`{
  swaps(first: 20, orderBy: timestamp, orderDirection: desc, where: {
    pool: "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"
  }) {
    id
    timestamp
    amount0
    amount1
    amountUSD
    sender
    recipient
  }
}`);
```

## Execute a Swap (SDK)

```bash
npm install @uniswap/v3-sdk @uniswap/sdk-core
```

```javascript
import { SwapRouter, AlphaRouter } from '@uniswap/smart-order-router';
import { Token, CurrencyAmount, TradeType, Percent } from '@uniswap/sdk-core';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
const router = new AlphaRouter({ chainId: 1, provider });

const WETH = new Token(1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18, 'WETH');
const USDC = new Token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'USDC');

const route = await router.route(
  CurrencyAmount.fromRawAmount(WETH, ethers.parseEther('0.1').toString()),
  USDC,
  TradeType.EXACT_INPUT,
  {
    slippageTolerance: new Percent(5, 1000), // 0.5%
    deadline: Math.floor(Date.now() / 1000) + 300,
    recipient: '0xYourAddress'
  }
);

console.log('Expected output:', route.quote.toFixed(2), 'USDC');
console.log('Price impact:', route.trade.priceImpact.toFixed(2), '%');
```

## Pool Contract Direct Interaction

```javascript
const poolAbi = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, ...)'];
const pool = new ethers.Contract(poolAddress, poolAbi, provider);
const { sqrtPriceX96, tick } = await pool.slot0();
```
