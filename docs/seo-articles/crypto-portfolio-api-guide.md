---
title: "Building a Crypto Portfolio Tracker with APIs (2026)"
meta_description: "Step-by-step guide to building a crypto portfolio tracker using CoinGecko, Alchemy, and Moralis APIs. Fetch balances, prices, and P&L in real time."
keywords: "crypto portfolio API, portfolio tracker API, crypto balance API, DeFi portfolio API, Web3 portfolio"
---

# Building a Crypto Portfolio Tracker with APIs (2026)

A complete portfolio tracker needs three data layers: on-chain balances (what you hold), price data (what it's worth), and transaction history (how you got it). Here's how to combine them.

## Architecture

```
Wallet Addresses
       ↓
Moralis / Alchemy  →  Token balances + USD values
       ↓
CoinGecko / CMC    →  Historical prices for P&L
       ↓
Etherscan / Alchemy →  Transaction history
```

## Step 1: Fetch All Token Balances with USD Values

```javascript
import Moralis from 'moralis';

await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });

async function getPortfolio(address, chain = '0x1') {
  const [native, tokens] = await Promise.all([
    Moralis.EvmApi.balance.getNativeBalance({ address, chain }),
    Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({ address, chain })
  ]);

  const holdings = [
    {
      symbol: 'ETH',
      balance: parseFloat(native.result.ether),
      usdValue: parseFloat(native.result.ether) * await getEthPrice()
    },
    ...tokens.result
      .filter(t => !t.possibleSpam && parseFloat(t.balanceFormatted) > 0)
      .map(t => ({
        symbol: t.symbol,
        name: t.name,
        balance: parseFloat(t.balanceFormatted),
        usdValue: t.usdValue || 0,
        priceChange24h: t.usd24hrPercentChange || 0
      }))
  ];

  return holdings;
}
```

## Step 2: Multi-Chain Portfolio

```javascript
const CHAINS = {
  ethereum: '0x1',
  polygon: '0x89',
  arbitrum: '0xa4b1',
  base: '0x2105',
  bsc: '0x38'
};

async function getMultiChainPortfolio(address) {
  const results = await Promise.all(
    Object.entries(CHAINS).map(async ([name, chainId]) => {
      const holdings = await getPortfolio(address, chainId);
      return holdings.map(h => ({ ...h, chain: name }));
    })
  );

  return results.flat().sort((a, b) => b.usdValue - a.usdValue);
}
```

## Step 3: Historical P&L

```javascript
async function getTokenPnl(symbol, purchaseDate, purchaseAmount, purchaseUsdValue) {
  const coinId = await getCoinGeckoId(symbol);

  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${formatDate(purchaseDate)}`
  );
  const { market_data } = await res.json();
  const purchasePriceUsd = market_data.current_price.usd;

  const currentPriceRes = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
  );
  const { [coinId]: { usd: currentPrice } } = await currentPriceRes.json();

  const currentValue = purchaseAmount * currentPrice;
  const pnl = currentValue - purchaseUsdValue;
  const pnlPct = ((currentPrice - purchasePriceUsd) / purchasePriceUsd) * 100;

  return { pnl, pnlPct, currentValue, purchasePriceUsd, currentPrice };
}
```

## Step 4: DeFi Positions

```javascript
async function getDefiPositions(address) {
  const positions = await Moralis.EvmApi.defi.getDefiPositionsSummary({
    address,
    chain: '0x1'
  });

  return positions.result.map(p => ({
    protocol: p.protocol_name,
    type: p.position_type,
    label: p.label,
    usdValue: p.balance_usd
  }));
}
```

## Step 5: Real-Time Price Updates

```javascript
async function streamPrices(symbols, onUpdate) {
  const ids = await Promise.all(symbols.map(s => getCoinGeckoId(s)));

  setInterval(async () => {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`
    );
    const prices = await res.json();
    onUpdate(prices);
  }, 30000); // every 30s
}
```

## Complete Portfolio Summary

```javascript
async function getFullPortfolio(address) {
  const [holdings, defi] = await Promise.all([
    getMultiChainPortfolio(address),
    getDefiPositions(address)
  ]);

  const walletTotal = holdings.reduce((sum, h) => sum + h.usdValue, 0);
  const defiTotal = defi.reduce((sum, p) => sum + p.usdValue, 0);

  return {
    address,
    totalUsd: walletTotal + defiTotal,
    walletTotal,
    defiTotal,
    holdings,
    defiPositions: defi
  };
}
```
