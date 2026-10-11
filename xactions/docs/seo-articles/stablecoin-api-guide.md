---
title: "Stablecoin APIs: USDC, USDT, DAI Data and Integration (2026)"
meta_description: "How to query stablecoin data — USDC, USDT, DAI supply, flows, and depeg alerts — using DeFiLlama, Circle, and on-chain APIs."
keywords: "stablecoin API, USDC API, USDT API, DAI API, stablecoin data API, Circle API"
---

# Stablecoin APIs: USDC, USDT, DAI Data and Integration (2026)

Stablecoins are the backbone of DeFi. This guide covers APIs for tracking stablecoin supply, cross-chain flows, and integrating USDC payments.

## Stablecoin Market Data (DeFiLlama)

```javascript
// All stablecoins with market caps
const { peggedAssets } = await fetch('https://stablecoins.llama.fi/stablecoins').then(r => r.json());

const top5 = peggedAssets
  .sort((a, b) => b.circulating.peggedUSD - a.circulating.peggedUSD)
  .slice(0, 5);

top5.forEach(s => {
  const supply = (s.circulating.peggedUSD / 1e9).toFixed(1);
  console.log(`${s.symbol}: $${supply}B`);
});
```

## Historical Stablecoin Supply

```javascript
// Historical supply for USDC
const stables = await fetch('https://stablecoins.llama.fi/stablecoins').then(r => r.json());
const usdc = stables.peggedAssets.find(s => s.symbol === 'USDC');

const history = await fetch(`https://stablecoins.llama.fi/stablecoin/${usdc.id}`).then(r => r.json());
history.tokens.slice(-7).forEach(h => {
  const date = new Date(h.date * 1000).toLocaleDateString();
  const supply = (h.circulating.peggedUSD / 1e9).toFixed(2);
  console.log(`${date}: $${supply}B`);
});
```

## Circle API (USDC)

Circle offers a developer API for USDC transfers, account management, and cross-chain operations:

```javascript
// Create USDC transfer
const res = await fetch('https://api.circle.com/v1/transfers', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    idempotencyKey: crypto.randomUUID(),
    source: { type: 'wallet', id: 'walletId' },
    destination: {
      type: 'blockchain',
      address: '0xRecipient',
      chain: 'ETH'
    },
    amount: { amount: '100.00', currency: 'USD' }
  })
});
```

## USDC On-Chain (ERC-20)

```javascript
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const usdcAbi = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const usdc = new ethers.Contract(USDC_ETH, usdcAbi, provider);

// Balance
const balance = await usdc.balanceOf('0xAddress');
console.log(ethers.formatUnits(balance, 6), 'USDC');

// Total supply
const supply = await usdc.totalSupply();
console.log((Number(supply) / 1e15).toFixed(1), 'B USDC');

// Monitor large transfers
usdc.on('Transfer', (from, to, value) => {
  const amount = Number(value) / 1e6;
  if (amount > 1_000_000) console.log(`🐋 $${amount.toLocaleString()} USDC: ${from} → ${to}`);
});
```

## DAI / MakerDAO

```javascript
// DAI stats from DeFiLlama
const dai = peggedAssets.find(s => s.symbol === 'DAI');

// DSR (DAI Savings Rate) on-chain
const POT_ADDRESS = '0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7';
const potAbi = ['function dsr() view returns (uint256)', 'function chi() view returns (uint256)'];
const pot = new ethers.Contract(POT_ADDRESS, potAbi, provider);

const dsr = await pot.dsr();
// Convert from ray (1e27) to APY
const dsrApy = (Math.pow(Number(dsr) / 1e27, 365 * 24 * 60 * 60) - 1) * 100;
console.log('DAI Savings Rate:', dsrApy.toFixed(2), '%');
```

## Depeg Detection

```javascript
async function checkDepeg(stableSymbol, threshold = 0.005) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${stableSymbol}&vs_currencies=usd`
  );
  const data = await res.json();
  const price = data[stableSymbol].usd;
  const deviation = Math.abs(price - 1.0);

  if (deviation > threshold) {
    console.warn(`⚠️ DEPEG: ${stableSymbol} = $${price} (deviation: ${(deviation * 100).toFixed(3)}%)`);
  }
  return { price, deviation, isDepegged: deviation > threshold };
}
```
