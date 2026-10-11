---
title: "QuickNode API Guide: Multi-Chain RPC for Builders (2026)"
meta_description: "Learn how to use QuickNode for fast multi-chain RPC access, Streams data pipelines, Functions serverless compute, and marketplace add-ons."
keywords: "QuickNode API, QuickNode RPC, QuickNode Streams, multi-chain API, QuickNode setup"
---

# QuickNode API Guide: Multi-Chain RPC for Builders (2026)

QuickNode is a high-performance blockchain infrastructure provider supporting 30+ chains. Beyond standard RPC, it offers Streams (real-time data pipelines), Functions (serverless compute), and a marketplace of add-ons.

## Setup

Create an endpoint at quicknode.com. You'll get a unique HTTPS and WSS URL.

```javascript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.QUICKNODE_HTTP_URL);
const wsProvider = new ethers.WebSocketProvider(process.env.QUICKNODE_WSS_URL);
```

## Supported Chains (sample)

Ethereum, Solana, Bitcoin, BNB Chain, Polygon, Avalanche, Arbitrum, Optimism, Base, zkSync, Starknet, Aptos, Sui, TON, Cosmos, Near, Fantom, Celo, Moonbeam, and more.

## QuickNode SDK

```bash
npm install @quicknode/sdk
```

```javascript
import QuickNode from '@quicknode/sdk';

const qn = new QuickNode.Core({
  endpointUrl: process.env.QUICKNODE_HTTP_URL
});

// Get NFT assets for an address
const nfts = await qn.client.qn_fetchNFTsByCollection({
  collection: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
  page: 1,
  perPage: 10
});
```

## Streams: Real-Time Data Pipelines

Streams lets you pipe on-chain data directly to a destination (HTTP, Kafka, S3, Snowflake) without polling.

```json
{
  "name": "ETH Transfers",
  "network": "ethereum-mainnet",
  "dataset": "receipts",
  "filter_function": "function main(data) { return data.filter(r => r.logs.length > 0); }",
  "destination": "https://yourapp.com/webhook",
  "status": "active"
}
```

## Functions: Serverless On-Chain Compute

Run JavaScript serverless functions that execute on QuickNode's infrastructure and have native RPC access.

```javascript
// A QuickNode Function
export async function main(params) {
  const block = await eth_blockNumber();
  const price = await fetchTokenPrice('ETH');
  return { block, price };
}
```

## Add-ons Marketplace

QuickNode's marketplace includes:
- **Token and NFT API** — enhanced asset queries
- **DeFi Pulse Data** — DeFi protocol metrics
- **Etherscan Compat** — Etherscan-style API on any chain
- **Trader Joe / Uniswap** — DEX analytics

## Rate Limits and Plans

| Plan | Req/s | Monthly credits |
|---|---|---|
| Free | 15 | 10M |
| Build | 50 | Unlimited |
| Scale | 100+ | Unlimited |
