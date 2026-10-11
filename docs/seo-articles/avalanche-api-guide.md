---
title: "Avalanche API Guide: C-Chain, X-Chain, and P-Chain (2026)"
meta_description: "Build on Avalanche — connect to C-Chain for EVM, query X-Chain and P-Chain data, use AvaCloud, and access Avalanche subnet APIs."
keywords: "Avalanche API, Avalanche C-Chain API, AvalancheGo RPC, AVAX API, Avalanche developer guide"
---

# Avalanche API Guide: C-Chain, X-Chain, and P-Chain (2026)

Avalanche has a unique multi-chain architecture with three primary chains. C-Chain is EVM-compatible; X-Chain handles asset transfers; P-Chain manages validators and subnets.

## C-Chain (EVM Compatible)

```javascript
import { ethers } from 'ethers';

// Public RPC
const provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');
// Or: https://avalanche-mainnet.infura.io/v3/<id>
// Chain ID: 43114

const balance = await provider.getBalance('0xAddress');
console.log(ethers.formatEther(balance), 'AVAX');
```

## Snowtrace API (C-Chain Explorer)

```javascript
const BASE = 'https://api.snowtrace.io/api';
const key = process.env.SNOWTRACE_API_KEY;

// Transactions
const txns = await fetch(
  `${BASE}?module=account&action=txlist&address=0xAddress&sort=desc&apikey=${key}`
).then(r => r.json());
```

## X-Chain (Asset Exchange)

```javascript
// X-Chain API endpoint
const X_CHAIN = 'https://api.avax.network/ext/bc/X';

// Get balance
const res = await fetch(X_CHAIN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'avm.getBalance',
    params: { address: 'X-avax1...', assetID: 'AVAX' }
  })
});
const { result } = await res.json();
console.log('Balance:', parseInt(result.balance) / 1e9, 'AVAX');
```

## P-Chain (Platform / Validators)

```javascript
const P_CHAIN = 'https://api.avax.network/ext/bc/P';

// Get current validators
const validators = await fetch(P_CHAIN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'platform.getCurrentValidators',
    params: {}
  })
}).then(r => r.json());

console.log('Validator count:', validators.result.validators.length);

// Get stake
const stake = await fetch(P_CHAIN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'platform.getStake',
    params: { addresses: ['P-avax1...'] }
  })
}).then(r => r.json());
```

## Avalanche Subnets

```javascript
// Get all subnets
const subnets = await fetch(P_CHAIN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'platform.getSubnets',
    params: {}
  })
}).then(r => r.json());

// Connect to a subnet's C-Chain equivalent
const subnetProvider = new ethers.JsonRpcProvider('https://subnets.avax.network/mysubnet/rpc');
```

## Trader Joe (Avalanche DEX)

```javascript
const TJ_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/traderjoe-xyz/dex-v2-1-avalanche';

const { pairs } = await fetch(TJ_SUBGRAPH, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ pairs(first: 10, orderBy: reserveUSD, orderDirection: desc) { id token0 { symbol } token1 { symbol } reserveUSD volumeUSD } }' })
}).then(r => r.json()).then(d => d.data);
```
