---
title: "Alchemy API Guide: Enhanced Web3 APIs Explained (2026)"
meta_description: "Complete guide to Alchemy APIs — NFT API, Token API, Transfers API, Webhooks, and Notify. Build blockchain apps faster with Alchemy enhanced APIs."
keywords: "Alchemy API, Alchemy NFT API, Alchemy Transfers API, Alchemy Web3, blockchain API"
---

# Alchemy API Guide: Enhanced Web3 APIs Explained (2026)

Alchemy is the leading blockchain infrastructure provider, offering standard JSON-RPC plus a suite of enhanced APIs that make common tasks dramatically easier.

## Setup

```bash
npm install alchemy-sdk
```

```javascript
import { Alchemy, Network } from 'alchemy-sdk';

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET
});
```

## NFT API

Get all NFTs owned by a wallet — no manual event log parsing required.

```javascript
const nfts = await alchemy.nft.getNftsForOwner('0xAddress');
nfts.ownedNfts.forEach(nft => {
  console.log(nft.contract.address, nft.tokenId, nft.title);
});
```

Get NFT metadata:

```javascript
const nft = await alchemy.nft.getNftMetadata('0xContractAddress', '1');
console.log(nft.title, nft.description, nft.image.originalUrl);
```

## Token API

Get all ERC-20 token balances for a wallet:

```javascript
const balances = await alchemy.core.getTokenBalances('0xAddress');
const nonZero = balances.tokenBalances.filter(t => t.tokenBalance !== '0x0');
```

Get token metadata:

```javascript
const meta = await alchemy.core.getTokenMetadata('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
console.log(meta.name, meta.symbol, meta.decimals); // USD Coin, USDC, 6
```

## Transfers API

Get the full transfer history for any address — much faster than scanning logs manually.

```javascript
const transfers = await alchemy.core.getAssetTransfers({
  fromAddress: '0xAddress',
  category: ['erc20', 'erc721', 'erc1155', 'external'],
  withMetadata: true,
  maxCount: 100
});
```

## Webhooks (Notify)

Get real-time notifications via HTTP webhook when events happen on-chain.

```javascript
// Create a webhook for address activity
const webhook = await alchemy.notify.createWebhook(
  'https://yourapp.com/webhook',
  WebhookType.ADDRESS_ACTIVITY,
  { addresses: ['0xYourAddress'] }
);
```

**Webhook types:**
- `MINED_TRANSACTION` — tx confirmed
- `DROPPED_TRANSACTION` — tx dropped from mempool
- `ADDRESS_ACTIVITY` — any activity on watched addresses
- `NFT_ACTIVITY` — NFT transfers

## Supported Networks

Alchemy supports 20+ chains including Ethereum, Polygon, Arbitrum, Optimism, Base, Solana, Starknet, Astar, and more.

## Compute Units

Alchemy bills by "compute units" (CUs). Standard JSON-RPC calls cost 1–50 CUs. Enhanced APIs cost more — e.g., `getNftsForOwner` costs 100 CUs. The free tier includes 300M CUs/month.
