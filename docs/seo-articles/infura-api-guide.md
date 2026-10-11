---
title: "Infura API Guide: Ethereum and IPFS Infrastructure (2026)"
meta_description: "How to use Infura for Ethereum JSON-RPC, IPFS, and multi-chain access. Setup, authentication, rate limits, and code examples for Node.js developers."
keywords: "Infura API, Infura Ethereum, Infura IPFS, Infura Web3 provider, Ethereum node API"
---

# Infura API Guide: Ethereum and IPFS Infrastructure (2026)

Infura, by ConsenSys, is one of the oldest and most trusted Ethereum node providers. It supports Ethereum mainnet, testnets, Layer 2s, and IPFS.

## Getting Started

1. Create an account at infura.io
2. Create a new project — note your **Project ID** and **API Key**
3. Your RPC endpoint: `https://mainnet.infura.io/v3/<PROJECT_ID>`

```javascript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(
  `https://mainnet.infura.io/v3/${process.env.INFURA_PROJECT_ID}`
);
```

## Supported Networks

| Network | Endpoint |
|---|---|
| Ethereum Mainnet | `mainnet.infura.io/v3/<id>` |
| Sepolia Testnet | `sepolia.infura.io/v3/<id>` |
| Polygon Mainnet | `polygon-mainnet.infura.io/v3/<id>` |
| Arbitrum One | `arbitrum-mainnet.infura.io/v3/<id>` |
| Optimism | `optimism-mainnet.infura.io/v3/<id>` |
| Base | `base-mainnet.infura.io/v3/<id>` |
| Linea | `linea-mainnet.infura.io/v3/<id>` |
| Avalanche | `avalanche-mainnet.infura.io/v3/<id>` |

## IPFS API

Infura provides a dedicated IPFS gateway and upload API.

```javascript
// Upload a file to IPFS
const formData = new FormData();
formData.append('file', fileBlob);

const res = await fetch('https://ipfs.infura.io:5001/api/v0/add', {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + Buffer.from(`${projectId}:${projectSecret}`).toString('base64')
  },
  body: formData
});
const { Hash } = await res.json();
console.log(`https://ipfs.io/ipfs/${Hash}`);
```

## WebSocket Endpoint

```javascript
const ws = new ethers.WebSocketProvider(
  `wss://mainnet.infura.io/ws/v3/${process.env.INFURA_PROJECT_ID}`
);

// Subscribe to new blocks
ws.on('block', (blockNumber) => {
  console.log('New block:', blockNumber);
});
```

## Rate Limits

- Free: 100,000 requests/day
- Developer: 300K/day
- Team: 3M/day
- Growth: 15M/day

## Secret Key Authentication

For production, require a secret key alongside your project ID to prevent unauthorized use of your endpoint.

Enable in: Dashboard → Project Settings → Security → Require API Key Secret

```javascript
const provider = new ethers.JsonRpcProvider({
  url: `https://mainnet.infura.io/v3/${projectId}`,
  user: '',
  password: projectSecret
});
```
