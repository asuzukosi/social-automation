---
title: "Moralis API Guide: Web3 Data APIs for Developers (2026)"
meta_description: "Full guide to Moralis APIs — Wallet API, NFT API, Token API, DeFi API, and Streams. Build Web3 apps without running your own node infrastructure."
keywords: "Moralis API, Moralis Web3 API, Moralis NFT API, Moralis Wallet API, Web3 data API"
---

# Moralis API Guide: Web3 Data APIs for Developers (2026)

Moralis provides high-level Web3 APIs that abstract the complexity of raw RPC calls. Instead of parsing raw logs and state, you get clean structured data for wallets, tokens, NFTs, and DeFi positions.

## Setup

```bash
npm install moralis
```

```javascript
import Moralis from 'moralis';

await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });
```

## Wallet API

Get native balance + token balances in one call:

```javascript
const portfolio = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
  address: '0xAddress',
  chain: '0x1' // Ethereum
});

portfolio.result.forEach(token => {
  console.log(token.symbol, token.balanceFormatted, token.usdValue);
});
```

Get wallet net worth:

```javascript
const netWorth = await Moralis.EvmApi.wallets.getWalletNetWorth({
  address: '0xAddress',
  excludeSpam: true,
  excludeUnverifiedContracts: true
});
console.log(netWorth.result.totalNetworth); // USD value
```

## NFT API

```javascript
// All NFTs owned by an address
const nfts = await Moralis.EvmApi.nft.getWalletNFTs({
  address: '0xAddress',
  chain: '0x1',
  mediaItems: true
});

// NFT collection stats
const stats = await Moralis.EvmApi.nft.getNFTCollectionStats({
  address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D' // BAYC
});
console.log(stats.result.floor_price, stats.result.volume_usd);
```

## Token API

```javascript
// Token price with liquidity data
const price = await Moralis.EvmApi.token.getTokenPrice({
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  chain: '0x1'
});
console.log(price.result.usdPrice, price.result.exchangeName);
```

## DeFi API

```javascript
// All DeFi positions (Uniswap, Aave, Compound, etc.)
const positions = await Moralis.EvmApi.defi.getDefiPositionsSummary({
  address: '0xAddress',
  chain: '0x1'
});
```

## Streams (Webhooks)

Get real-time webhooks when on-chain events occur:

```javascript
const stream = await Moralis.Streams.add({
  chains: ['0x1'],
  description: 'USDC transfers',
  tag: 'usdc-transfers',
  webhookUrl: 'https://yourapp.com/webhook',
  abi: transferAbi,
  topic0: ['Transfer(address,address,uint256)'],
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
});
```

## Supported Chains

Moralis supports 30+ EVM chains plus Solana, Aptos, and more.

## Rate Limits

Free tier: 40,000 CU/day. Paid plans start at $49/month for 100M CU/month.
