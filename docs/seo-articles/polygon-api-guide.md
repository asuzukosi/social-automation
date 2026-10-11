---
title: "Polygon API Guide: EVM Scaling Network for Developers (2026)"
meta_description: "How to build on Polygon using JSON-RPC, Polygonscan API, and PolygonScan. Low fees, fast finality, full EVM compatibility."
keywords: "Polygon API, Polygon RPC, Polygonscan API, Matic API, Polygon developer guide"
---

# Polygon API Guide: EVM Scaling Network for Developers (2026)

Polygon (formerly Matic) is an EVM-compatible Layer 2 with low fees and fast finality. Since it's EVM-compatible, all Ethereum tools work out of the box.

## RPC Endpoints

| Provider | Endpoint |
|---|---|
| Public RPC | `https://polygon-rpc.com` |
| Alchemy | `https://polygon-mainnet.g.alchemy.com/v2/<key>` |
| Infura | `https://polygon-mainnet.infura.io/v3/<id>` |
| QuickNode | Custom endpoint from dashboard |
| Chainstack | Custom endpoint |

```javascript
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
```

## Same API, Lower Fees

All Ethereum JSON-RPC calls work identically on Polygon. Just point at the Polygon RPC:

```javascript
// Get MATIC balance
const balance = await provider.getBalance('0xAddress');
console.log(ethers.formatEther(balance), 'MATIC');

// Gas is ~100-1000x cheaper than Ethereum
const feeData = await provider.getFeeData();
console.log(ethers.formatUnits(feeData.gasPrice, 'gwei'), 'Gwei'); // typically 30-100 Gwei
```

## Polygonscan API

Same interface as Etherscan:

```javascript
const BASE = 'https://api.polygonscan.com/api';
const key = process.env.POLYGONSCAN_API_KEY;

// Transaction history
const txns = await fetch(
  `${BASE}?module=account&action=txlist&address=0xAddress&sort=desc&apikey=${key}`
).then(r => r.json());

// ERC-20 transfers
const transfers = await fetch(
  `${BASE}?module=account&action=tokentx&address=0xAddress&sort=desc&apikey=${key}`
).then(r => r.json());

// Gas oracle
const gas = await fetch(`${BASE}?module=gastracker&action=gasoracle&apikey=${key}`).then(r => r.json());
console.log('Fast:', gas.result.FastGasPrice, 'Gwei');
```

## Cross-Chain Bridge (Polygon PoS)

```javascript
// Monitor bridge deposits (Ethereum → Polygon)
const BRIDGE_ADDRESS = '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0';

const bridgeAbi = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
const bridge = new ethers.Contract(BRIDGE_ADDRESS, bridgeAbi, ethProvider);

bridge.on('Transfer', (from, to, value) => {
  if (to === '0x0000000000000000000000000000000000000000') {
    console.log(`Bridge deposit: ${ethers.formatEther(value)} MATIC from ${from}`);
  }
});
```

## USDC on Polygon (Native)

```javascript
const USDC_POLYGON = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // Native USDC
const USDC_E_POLYGON = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // Bridged USDC.e

const usdc = new ethers.Contract(USDC_POLYGON, erc20Abi, provider);
const balance = await usdc.balanceOf('0xAddress');
console.log(ethers.formatUnits(balance, 6), 'USDC');
```

## Quickswap (Polygon DEX)

```javascript
const QUICKSWAP_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/sameepsi/quickswap-v3';

const { pools } = await fetch(QUICKSWAP_SUBGRAPH, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) { id token0 { symbol } token1 { symbol } totalValueLockedUSD volumeUSD } }' })
}).then(r => r.json()).then(r => r.data);
```

## Polygon zkEVM

For Polygon zkEVM (separate from Polygon PoS):

- RPC: `https://zkevm-rpc.com`
- Explorer: zkevm.polygonscan.com
- Chain ID: 1101
