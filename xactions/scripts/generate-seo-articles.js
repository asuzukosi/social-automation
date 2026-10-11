// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OUT = '/workspaces/XActions/docs/seo-articles';
mkdirSync(OUT, { recursive: true });

const articles = [
  {
    slug: 'binance-api-guide',
    title: 'Binance API Guide: Complete Reference for Developers (2026)',
    meta: 'Learn how to use the Binance API for spot trading, futures, market data, and WebSocket streams. Includes code examples and authentication setup.',
    keywords: 'Binance API, Binance trading API, Binance WebSocket, Binance REST API',
    content: `# Binance API Guide: Complete Reference for Developers (2026)

The Binance API is the most widely used cryptocurrency exchange API in the world, powering millions of trading bots, portfolio trackers, and analytics tools. This guide covers everything you need to integrate with Binance's REST and WebSocket APIs.

## Authentication

Binance uses HMAC-SHA256 signed requests for private endpoints. Generate an API key in your account settings, then sign each request with your secret key.

\`\`\`javascript
import crypto from 'crypto';

function sign(queryString, secret) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function getAccountInfo(apiKey, secret) {
  const timestamp = Date.now();
  const query = \`timestamp=\${timestamp}\`;
  const signature = sign(query, secret);

  const res = await fetch(
    \`https://api.binance.com/api/v3/account?\${query}&signature=\${signature}\`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );
  return res.json();
}
\`\`\`

## Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| \`/api/v3/ticker/price\` | GET | Latest price for a symbol |
| \`/api/v3/klines\` | GET | OHLCV candlestick data |
| \`/api/v3/depth\` | GET | Order book snapshot |
| \`/api/v3/order\` | POST | Place a new order |
| \`/api/v3/account\` | GET | Account balances |
| \`/api/v3/myTrades\` | GET | Trade history |

## Fetching Candlestick Data

\`\`\`javascript
const res = await fetch(
  'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100'
);
const candles = await res.json();
// [openTime, open, high, low, close, volume, closeTime, ...]
\`\`\`

## WebSocket Streams

Binance WebSocket streams deliver real-time data without polling.

\`\`\`javascript
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

ws.onmessage = (event) => {
  const trade = JSON.parse(event.data);
  console.log(\`Price: \${trade.p}, Qty: \${trade.q}\`);
};
\`\`\`

**Available streams:**
- \`<symbol>@trade\` — real-time trade stream
- \`<symbol>@kline_<interval>\` — candlestick updates
- \`<symbol>@depth\` — order book diffs
- \`<symbol>@bookTicker\` — best bid/ask

## Rate Limits

Binance enforces weight-based rate limits. Each endpoint costs 1–50 weight units. The default limit is 1,200 weight per minute. Exceeding it returns HTTP 429, and repeated violations result in a temporary IP ban (HTTP 418).

Always check the \`X-MBX-USED-WEIGHT-1M\` response header to monitor consumption.

## Order Types

Binance supports: LIMIT, MARKET, STOP_LOSS, STOP_LOSS_LIMIT, TAKE_PROFIT, TAKE_PROFIT_LIMIT, LIMIT_MAKER. For most bots, LIMIT and MARKET cover 90% of use cases.

## Futures API

The Futures API lives at \`https://fapi.binance.com\`. It shares the same authentication scheme but has additional endpoints for leverage, position, and funding rate data.

\`\`\`javascript
// Get funding rate history
const res = await fetch(
  'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=10'
);
\`\`\`

## Best Practices

- Cache public market data (prices, candles) for at least 1 second
- Use WebSockets instead of polling for latency-sensitive strategies
- Implement exponential backoff on 429 responses
- Never store API keys in source code — use environment variables
- Enable IP restrictions on your API key in account settings`
  },
  {
    slug: 'coinbase-api-guide',
    title: 'Coinbase Advanced Trade API: Developer Guide (2026)',
    meta: 'Full guide to the Coinbase Advanced Trade API — authentication, order management, market data, and WebSocket feeds with JavaScript examples.',
    keywords: 'Coinbase API, Coinbase Advanced Trade API, Coinbase Pro API, Coinbase trading API',
    content: `# Coinbase Advanced Trade API: Developer Guide (2026)

Coinbase Advanced Trade API (formerly Coinbase Pro) is the institutional-grade trading interface for Coinbase. It offers REST endpoints for order management and real-time WebSocket feeds for market data.

## Base URL

\`https://api.coinbase.com/api/v3/brokerage/\`

## Authentication

Coinbase uses JWT-based authentication for all private endpoints.

\`\`\`javascript
import { SignJWT } from 'jose';
import crypto from 'crypto';

async function createJWT(apiKeyName, privateKey) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(privateKey, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  return new SignJWT({ sub: apiKeyName, iss: 'cdp', nbf: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: 'ES256', kid: apiKeyName })
    .setExpirationTime('2m')
    .sign(key);
}
\`\`\`

## Key Endpoints

| Endpoint | Description |
|---|---|
| \`GET /products\` | List all trading pairs |
| \`GET /products/{id}/candles\` | OHLCV data |
| \`GET /best_bid_ask\` | Best bid/ask for symbols |
| \`POST /orders\` | Place an order |
| \`GET /orders/historical/batch\` | Order history |
| \`GET /portfolios\` | Portfolio balances |

## Placing an Order

\`\`\`javascript
const order = {
  client_order_id: crypto.randomUUID(),
  product_id: 'BTC-USD',
  side: 'BUY',
  order_configuration: {
    limit_limit_gtc: {
      base_size: '0.001',
      limit_price: '50000'
    }
  }
};

const res = await fetch('https://api.coinbase.com/api/v3/brokerage/orders', {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${jwt}\`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(order)
});
\`\`\`

## WebSocket Feed

\`\`\`javascript
const ws = new WebSocket('wss://advanced-trade-ws.coinbase.com');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    product_ids: ['BTC-USD', 'ETH-USD'],
    channel: 'ticker'
  }));
};
\`\`\`

**Channels:** ticker, level2, market_trades, user (private)

## Rate Limits

- Public endpoints: 10 requests/second
- Private endpoints: 30 requests/second
- WebSocket: 750 subscriptions per connection

## Sandbox Environment

Test without real funds at \`https://api-public.sandbox.exchange.coinbase.com\`. Sandbox accounts come pre-funded with test assets.`
  },
  {
    slug: 'ethereum-rpc-api-guide',
    title: 'Ethereum RPC API Guide: JSON-RPC Methods for Developers (2026)',
    meta: 'Complete guide to Ethereum JSON-RPC API — read balances, send transactions, call smart contracts, and listen to events using eth_call, eth_getLogs, and more.',
    keywords: 'Ethereum API, Ethereum JSON-RPC, eth_call, web3 API, ethers.js API',
    content: `# Ethereum RPC API Guide: JSON-RPC Methods for Developers (2026)

The Ethereum JSON-RPC API is the standard interface for interacting with any EVM-compatible blockchain. Every node — whether self-hosted, Alchemy, Infura, or QuickNode — exposes this same API.

## Connecting

\`\`\`javascript
import { ethers } from 'ethers';

// Via provider URL (Alchemy, Infura, QuickNode, etc.)
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
\`\`\`

## Core Methods

### Get ETH Balance

\`\`\`javascript
const balance = await provider.getBalance('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
console.log(ethers.formatEther(balance)); // "1.234"
\`\`\`

### Get Block

\`\`\`javascript
const block = await provider.getBlock('latest');
console.log(block.number, block.timestamp, block.transactions.length);
\`\`\`

### Call a Smart Contract

\`\`\`javascript
const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
const usdc = new ethers.Contract('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', erc20Abi, provider);
const balance = await usdc.balanceOf('0xYourAddress');
\`\`\`

### Send a Transaction

\`\`\`javascript
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tx = await signer.sendTransaction({
  to: '0xRecipient',
  value: ethers.parseEther('0.01')
});
await tx.wait();
\`\`\`

## Raw JSON-RPC

\`\`\`javascript
const res = await fetch(process.env.ETH_RPC_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'latest']
  })
});
const { result } = await res.json();
console.log(parseInt(result, 16) / 1e18); // ETH balance
\`\`\`

## Event Logs

\`\`\`javascript
const logs = await provider.getLogs({
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  topics: [ethers.id('Transfer(address,address,uint256)')],
  fromBlock: -1000 // last 1000 blocks
});
\`\`\`

## Key RPC Methods Reference

| Method | Description |
|---|---|
| \`eth_blockNumber\` | Latest block number |
| \`eth_getBalance\` | ETH balance of address |
| \`eth_getTransactionByHash\` | Transaction details |
| \`eth_getTransactionReceipt\` | Receipt + logs |
| \`eth_call\` | Read smart contract state |
| \`eth_sendRawTransaction\` | Broadcast signed tx |
| \`eth_getLogs\` | Query event logs |
| \`eth_estimateGas\` | Estimate gas cost |
| \`eth_gasPrice\` | Current gas price |

## Node Providers Compared

| Provider | Free tier | Chains | Websockets |
|---|---|---|---|
| Alchemy | 300M compute units/mo | 20+ | Yes |
| Infura | 100K req/day | 10+ | Yes |
| QuickNode | 10M credits/mo | 30+ | Yes |
| Ankr | 30M req/mo | 40+ | Yes |
| Llamarpc | Unlimited (rate limited) | 5 | No |

## Archive Nodes

Standard nodes only keep recent state. For historical queries (e.g., balance at block 10,000,000), you need an archive node. Alchemy and QuickNode both offer archive access on paid plans.`
  },
  {
    slug: 'solana-api-guide',
    title: 'Solana RPC API Guide for Developers (2026)',
    meta: 'Learn to use the Solana JSON-RPC API — read accounts, send transactions, subscribe to events, and query on-chain data with JavaScript examples.',
    keywords: 'Solana API, Solana RPC, Solana JSON-RPC, @solana/web3.js, Solana developer API',
    content: `# Solana RPC API Guide for Developers (2026)

Solana's JSON-RPC API is the primary interface for building on the Solana blockchain. With sub-second finality and ~4,000 TPS, Solana is the go-to chain for high-frequency DeFi, NFTs, and payments.

## Setup

\`\`\`bash
npm install @solana/web3.js
\`\`\`

\`\`\`javascript
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
\`\`\`

## Get SOL Balance

\`\`\`javascript
const pubkey = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const balance = await connection.getBalance(pubkey);
console.log(balance / LAMPORTS_PER_SOL); // SOL balance
\`\`\`

## Get Token Balances (SPL)

\`\`\`javascript
const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
  programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
});

tokenAccounts.value.forEach(({ account }) => {
  const { mint, tokenAmount } = account.data.parsed.info;
  console.log(mint, tokenAmount.uiAmount);
});
\`\`\`

## Send a Transaction

\`\`\`javascript
import { SystemProgram, Transaction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';

const from = Keypair.fromSecretKey(Buffer.from(process.env.PRIVATE_KEY, 'base64'));
const to = new PublicKey('RecipientPublicKey');

const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: from.publicKey,
    toPubkey: to,
    lamports: 0.01 * LAMPORTS_PER_SOL
  })
);

const sig = await sendAndConfirmTransaction(connection, tx, [from]);
console.log('Signature:', sig);
\`\`\`

## Subscribe to Account Changes

\`\`\`javascript
const subscriptionId = connection.onAccountChange(pubkey, (accountInfo) => {
  console.log('Balance changed:', accountInfo.lamports / LAMPORTS_PER_SOL);
});

// Unsubscribe when done
await connection.removeAccountChangeListener(subscriptionId);
\`\`\`

## Key RPC Methods

| Method | Description |
|---|---|
| \`getBalance\` | SOL balance |
| \`getAccountInfo\` | Raw account data |
| \`getTransaction\` | Transaction details |
| \`getBlock\` | Block with transactions |
| \`sendTransaction\` | Broadcast transaction |
| \`simulateTransaction\` | Dry-run without broadcasting |
| \`getTokenAccountsByOwner\` | All SPL token accounts |
| \`getProgramAccounts\` | All accounts owned by a program |

## RPC Providers for Solana

- **Helius** — best Solana-specific provider, advanced APIs (DAS, webhooks)
- **QuickNode** — reliable, multi-region
- **Alchemy** — Solana support added 2024
- **Triton** — high-performance, staked connections

## getProgramAccounts — Power Query

This method returns all accounts owned by a program — essential for DeFi integrations.

\`\`\`javascript
const accounts = await connection.getProgramAccounts(
  new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'), // Raydium AMM
  {
    filters: [{ dataSize: 752 }] // filter by account size
  }
);
\`\`\``
  },
  {
    slug: 'alchemy-api-guide',
    title: 'Alchemy API Guide: Enhanced Web3 APIs Explained (2026)',
    meta: 'Complete guide to Alchemy APIs — NFT API, Token API, Transfers API, Webhooks, and Notify. Build blockchain apps faster with Alchemy enhanced APIs.',
    keywords: 'Alchemy API, Alchemy NFT API, Alchemy Transfers API, Alchemy Web3, blockchain API',
    content: `# Alchemy API Guide: Enhanced Web3 APIs Explained (2026)

Alchemy is the leading blockchain infrastructure provider, offering standard JSON-RPC plus a suite of enhanced APIs that make common tasks dramatically easier.

## Setup

\`\`\`bash
npm install alchemy-sdk
\`\`\`

\`\`\`javascript
import { Alchemy, Network } from 'alchemy-sdk';

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET
});
\`\`\`

## NFT API

Get all NFTs owned by a wallet — no manual event log parsing required.

\`\`\`javascript
const nfts = await alchemy.nft.getNftsForOwner('0xAddress');
nfts.ownedNfts.forEach(nft => {
  console.log(nft.contract.address, nft.tokenId, nft.title);
});
\`\`\`

Get NFT metadata:

\`\`\`javascript
const nft = await alchemy.nft.getNftMetadata('0xContractAddress', '1');
console.log(nft.title, nft.description, nft.image.originalUrl);
\`\`\`

## Token API

Get all ERC-20 token balances for a wallet:

\`\`\`javascript
const balances = await alchemy.core.getTokenBalances('0xAddress');
const nonZero = balances.tokenBalances.filter(t => t.tokenBalance !== '0x0');
\`\`\`

Get token metadata:

\`\`\`javascript
const meta = await alchemy.core.getTokenMetadata('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
console.log(meta.name, meta.symbol, meta.decimals); // USD Coin, USDC, 6
\`\`\`

## Transfers API

Get the full transfer history for any address — much faster than scanning logs manually.

\`\`\`javascript
const transfers = await alchemy.core.getAssetTransfers({
  fromAddress: '0xAddress',
  category: ['erc20', 'erc721', 'erc1155', 'external'],
  withMetadata: true,
  maxCount: 100
});
\`\`\`

## Webhooks (Notify)

Get real-time notifications via HTTP webhook when events happen on-chain.

\`\`\`javascript
// Create a webhook for address activity
const webhook = await alchemy.notify.createWebhook(
  'https://yourapp.com/webhook',
  WebhookType.ADDRESS_ACTIVITY,
  { addresses: ['0xYourAddress'] }
);
\`\`\`

**Webhook types:**
- \`MINED_TRANSACTION\` — tx confirmed
- \`DROPPED_TRANSACTION\` — tx dropped from mempool
- \`ADDRESS_ACTIVITY\` — any activity on watched addresses
- \`NFT_ACTIVITY\` — NFT transfers

## Supported Networks

Alchemy supports 20+ chains including Ethereum, Polygon, Arbitrum, Optimism, Base, Solana, Starknet, Astar, and more.

## Compute Units

Alchemy bills by "compute units" (CUs). Standard JSON-RPC calls cost 1–50 CUs. Enhanced APIs cost more — e.g., \`getNftsForOwner\` costs 100 CUs. The free tier includes 300M CUs/month.`
  },
  {
    slug: 'coingecko-api-guide',
    title: 'CoinGecko API Guide: Free Crypto Market Data (2026)',
    meta: 'How to use the CoinGecko API for free crypto price data, market cap, historical OHLCV, DeFi data, and NFT floor prices. No API key required for basic use.',
    keywords: 'CoinGecko API, CoinGecko free API, crypto price API, crypto market data free',
    content: `# CoinGecko API Guide: Free Crypto Market Data (2026)

CoinGecko offers one of the most comprehensive free crypto market data APIs, covering 10,000+ cryptocurrencies, DeFi protocols, and NFT collections.

## Base URL

- Free (no key): \`https://api.coingecko.com/api/v3\`
- Pro: \`https://pro-api.coingecko.com/api/v3\`

## Get Current Price

\`\`\`javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,btc'
);
const prices = await res.json();
console.log(prices.bitcoin.usd); // e.g., 95000
\`\`\`

## Get Market Data

\`\`\`javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1'
);
const coins = await res.json();
// Returns: id, symbol, name, current_price, market_cap, total_volume, price_change_percentage_24h
\`\`\`

## Historical Price Data

\`\`\`javascript
// Daily prices for last 365 days
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily'
);
const { prices, market_caps, total_volumes } = await res.json();
// prices = [[timestamp, price], ...]
\`\`\`

## OHLCV Data

\`\`\`javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/ethereum/ohlc?vs_currency=usd&days=30'
);
const ohlc = await res.json();
// [[timestamp, open, high, low, close], ...]
\`\`\`

## Coin Details

\`\`\`javascript
const res = await fetch(
  'https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false'
);
const coin = await res.json();
console.log(coin.market_data.circulating_supply);
console.log(coin.market_data.ath.usd); // All-time high
\`\`\`

## DeFi Data

\`\`\`javascript
// Global DeFi stats
const res = await fetch('https://api.coingecko.com/api/v3/global/decentralized_finance_defi');
const { data } = await res.json();
console.log(data.defi_market_cap, data.trading_volume_24h);
\`\`\`

## NFT Floor Prices

\`\`\`javascript
const res = await fetch('https://api.coingecko.com/api/v3/nfts/cryptopunks');
const nft = await res.json();
console.log(nft.floor_price.native_currency); // Floor in ETH
\`\`\`

## Rate Limits

| Tier | Calls/min | Monthly |
|---|---|---|
| Free (no key) | 30 | ~43K |
| Demo (free key) | 30 | ~43K |
| Analyst | 500 | 720K |
| Lite | 500 | 720K |
| Pro | 500 | 720K |
| Enterprise | Custom | Custom |

## Coin ID Lookup

CoinGecko uses string IDs (e.g., \`bitcoin\`, \`ethereum\`), not symbols. Get the full list:

\`\`\`javascript
const res = await fetch('https://api.coingecko.com/api/v3/coins/list');
const coins = await res.json(); // [{id, symbol, name}, ...]
\`\`\``
  },
  {
    slug: 'infura-api-guide',
    title: 'Infura API Guide: Ethereum and IPFS Infrastructure (2026)',
    meta: 'How to use Infura for Ethereum JSON-RPC, IPFS, and multi-chain access. Setup, authentication, rate limits, and code examples for Node.js developers.',
    keywords: 'Infura API, Infura Ethereum, Infura IPFS, Infura Web3 provider, Ethereum node API',
    content: `# Infura API Guide: Ethereum and IPFS Infrastructure (2026)

Infura, by ConsenSys, is one of the oldest and most trusted Ethereum node providers. It supports Ethereum mainnet, testnets, Layer 2s, and IPFS.

## Getting Started

1. Create an account at infura.io
2. Create a new project — note your **Project ID** and **API Key**
3. Your RPC endpoint: \`https://mainnet.infura.io/v3/<PROJECT_ID>\`

\`\`\`javascript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(
  \`https://mainnet.infura.io/v3/\${process.env.INFURA_PROJECT_ID}\`
);
\`\`\`

## Supported Networks

| Network | Endpoint |
|---|---|
| Ethereum Mainnet | \`mainnet.infura.io/v3/<id>\` |
| Sepolia Testnet | \`sepolia.infura.io/v3/<id>\` |
| Polygon Mainnet | \`polygon-mainnet.infura.io/v3/<id>\` |
| Arbitrum One | \`arbitrum-mainnet.infura.io/v3/<id>\` |
| Optimism | \`optimism-mainnet.infura.io/v3/<id>\` |
| Base | \`base-mainnet.infura.io/v3/<id>\` |
| Linea | \`linea-mainnet.infura.io/v3/<id>\` |
| Avalanche | \`avalanche-mainnet.infura.io/v3/<id>\` |

## IPFS API

Infura provides a dedicated IPFS gateway and upload API.

\`\`\`javascript
// Upload a file to IPFS
const formData = new FormData();
formData.append('file', fileBlob);

const res = await fetch('https://ipfs.infura.io:5001/api/v0/add', {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + Buffer.from(\`\${projectId}:\${projectSecret}\`).toString('base64')
  },
  body: formData
});
const { Hash } = await res.json();
console.log(\`https://ipfs.io/ipfs/\${Hash}\`);
\`\`\`

## WebSocket Endpoint

\`\`\`javascript
const ws = new ethers.WebSocketProvider(
  \`wss://mainnet.infura.io/ws/v3/\${process.env.INFURA_PROJECT_ID}\`
);

// Subscribe to new blocks
ws.on('block', (blockNumber) => {
  console.log('New block:', blockNumber);
});
\`\`\`

## Rate Limits

- Free: 100,000 requests/day
- Developer: 300K/day
- Team: 3M/day
- Growth: 15M/day

## Secret Key Authentication

For production, require a secret key alongside your project ID to prevent unauthorized use of your endpoint.

Enable in: Dashboard → Project Settings → Security → Require API Key Secret

\`\`\`javascript
const provider = new ethers.JsonRpcProvider({
  url: \`https://mainnet.infura.io/v3/\${projectId}\`,
  user: '',
  password: projectSecret
});
\`\`\``
  },
  {
    slug: 'quicknode-api-guide',
    title: 'QuickNode API Guide: Multi-Chain RPC for Builders (2026)',
    meta: 'Learn how to use QuickNode for fast multi-chain RPC access, Streams data pipelines, Functions serverless compute, and marketplace add-ons.',
    keywords: 'QuickNode API, QuickNode RPC, QuickNode Streams, multi-chain API, QuickNode setup',
    content: `# QuickNode API Guide: Multi-Chain RPC for Builders (2026)

QuickNode is a high-performance blockchain infrastructure provider supporting 30+ chains. Beyond standard RPC, it offers Streams (real-time data pipelines), Functions (serverless compute), and a marketplace of add-ons.

## Setup

Create an endpoint at quicknode.com. You'll get a unique HTTPS and WSS URL.

\`\`\`javascript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.QUICKNODE_HTTP_URL);
const wsProvider = new ethers.WebSocketProvider(process.env.QUICKNODE_WSS_URL);
\`\`\`

## Supported Chains (sample)

Ethereum, Solana, Bitcoin, BNB Chain, Polygon, Avalanche, Arbitrum, Optimism, Base, zkSync, Starknet, Aptos, Sui, TON, Cosmos, Near, Fantom, Celo, Moonbeam, and more.

## QuickNode SDK

\`\`\`bash
npm install @quicknode/sdk
\`\`\`

\`\`\`javascript
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
\`\`\`

## Streams: Real-Time Data Pipelines

Streams lets you pipe on-chain data directly to a destination (HTTP, Kafka, S3, Snowflake) without polling.

\`\`\`json
{
  "name": "ETH Transfers",
  "network": "ethereum-mainnet",
  "dataset": "receipts",
  "filter_function": "function main(data) { return data.filter(r => r.logs.length > 0); }",
  "destination": "https://yourapp.com/webhook",
  "status": "active"
}
\`\`\`

## Functions: Serverless On-Chain Compute

Run JavaScript serverless functions that execute on QuickNode's infrastructure and have native RPC access.

\`\`\`javascript
// A QuickNode Function
export async function main(params) {
  const block = await eth_blockNumber();
  const price = await fetchTokenPrice('ETH');
  return { block, price };
}
\`\`\`

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
| Scale | 100+ | Unlimited |`
  },
  {
    slug: 'moralis-api-guide',
    title: 'Moralis API Guide: Web3 Data APIs for Developers (2026)',
    meta: 'Full guide to Moralis APIs — Wallet API, NFT API, Token API, DeFi API, and Streams. Build Web3 apps without running your own node infrastructure.',
    keywords: 'Moralis API, Moralis Web3 API, Moralis NFT API, Moralis Wallet API, Web3 data API',
    content: `# Moralis API Guide: Web3 Data APIs for Developers (2026)

Moralis provides high-level Web3 APIs that abstract the complexity of raw RPC calls. Instead of parsing raw logs and state, you get clean structured data for wallets, tokens, NFTs, and DeFi positions.

## Setup

\`\`\`bash
npm install moralis
\`\`\`

\`\`\`javascript
import Moralis from 'moralis';

await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });
\`\`\`

## Wallet API

Get native balance + token balances in one call:

\`\`\`javascript
const portfolio = await Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
  address: '0xAddress',
  chain: '0x1' // Ethereum
});

portfolio.result.forEach(token => {
  console.log(token.symbol, token.balanceFormatted, token.usdValue);
});
\`\`\`

Get wallet net worth:

\`\`\`javascript
const netWorth = await Moralis.EvmApi.wallets.getWalletNetWorth({
  address: '0xAddress',
  excludeSpam: true,
  excludeUnverifiedContracts: true
});
console.log(netWorth.result.totalNetworth); // USD value
\`\`\`

## NFT API

\`\`\`javascript
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
\`\`\`

## Token API

\`\`\`javascript
// Token price with liquidity data
const price = await Moralis.EvmApi.token.getTokenPrice({
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  chain: '0x1'
});
console.log(price.result.usdPrice, price.result.exchangeName);
\`\`\`

## DeFi API

\`\`\`javascript
// All DeFi positions (Uniswap, Aave, Compound, etc.)
const positions = await Moralis.EvmApi.defi.getDefiPositionsSummary({
  address: '0xAddress',
  chain: '0x1'
});
\`\`\`

## Streams (Webhooks)

Get real-time webhooks when on-chain events occur:

\`\`\`javascript
const stream = await Moralis.Streams.add({
  chains: ['0x1'],
  description: 'USDC transfers',
  tag: 'usdc-transfers',
  webhookUrl: 'https://yourapp.com/webhook',
  abi: transferAbi,
  topic0: ['Transfer(address,address,uint256)'],
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
});
\`\`\`

## Supported Chains

Moralis supports 30+ EVM chains plus Solana, Aptos, and more.

## Rate Limits

Free tier: 40,000 CU/day. Paid plans start at $49/month for 100M CU/month.`
  },
  {
    slug: 'the-graph-api-guide',
    title: 'The Graph API Guide: Query Blockchain Data with GraphQL (2026)',
    meta: 'Learn how to use The Graph protocol to query on-chain data with GraphQL. Deploy subgraphs, query Uniswap, Aave, and custom protocol data.',
    keywords: 'The Graph API, GraphQL blockchain, subgraph API, Uniswap subgraph, The Graph protocol',
    content: `# The Graph API Guide: Query Blockchain Data with GraphQL (2026)

The Graph is a decentralized indexing protocol that lets you query blockchain data with GraphQL. It powers data for Uniswap, Aave, Compound, and thousands of other DeFi protocols.

## How It Works

1. A **subgraph** defines which on-chain events to index and how to structure them
2. Indexers process the subgraph and store the data
3. You query the subgraph via a GraphQL API endpoint

## Querying a Public Subgraph

No API key needed for hosted service subgraphs:

\`\`\`javascript
const UNISWAP_V3 = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

const query = \`{
  pools(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    token0 { symbol }
    token1 { symbol }
    feeTier
    totalValueLockedUSD
    volumeUSD
  }
}\`;

const res = await fetch(UNISWAP_V3, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});
const { data } = await res.json();
\`\`\`

## Decentralized Network (requires API key)

\`\`\`javascript
const GRAPH_API_KEY = process.env.GRAPH_API_KEY;
const SUBGRAPH_ID = 'ELUcwgpm14LKPLrBRuVvPvNKHQ9HvwmtKgKSH855M4Nd'; // Uniswap V3

const endpoint = \`https://gateway.thegraph.com/api/\${GRAPH_API_KEY}/subgraphs/id/\${SUBGRAPH_ID}\`;
\`\`\`

## Popular Subgraphs

| Protocol | Subgraph |
|---|---|
| Uniswap V3 | uniswap/uniswap-v3 |
| Aave V3 | aave/protocol-v3 |
| Compound V3 | messari/compound-v3-ethereum |
| Curve | messari/curve-finance-ethereum |
| Balancer V2 | balancer-labs/balancer-v2 |
| ENS | ensdomains/ensregistrar |
| Lens Protocol | lens-protocol/lens |

## Query With Variables

\`\`\`javascript
const query = \`
  query GetTokenSwaps($token: String!, $limit: Int!) {
    swaps(
      where: { token0: $token }
      first: $limit
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      timestamp
      amountUSD
      token0 { symbol }
      token1 { symbol }
    }
  }
\`;

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query,
    variables: { token: '0xA0b86991c...', limit: 20 }
  })
});
\`\`\`

## Writing a Subgraph

\`\`\`bash
npm install -g @graphprotocol/graph-cli
graph init --product hosted-service my-subgraph
\`\`\`

**schema.graphql:**
\`\`\`graphql
type Transfer @entity {
  id: ID!
  from: Bytes!
  to: Bytes!
  value: BigInt!
  timestamp: BigInt!
}
\`\`\`

**mapping.ts:**
\`\`\`typescript
export function handleTransfer(event: TransferEvent): void {
  let transfer = new Transfer(event.transaction.hash.toHex());
  transfer.from = event.params.from;
  transfer.to = event.params.to;
  transfer.value = event.params.value;
  transfer.timestamp = event.block.timestamp;
  transfer.save();
}
\`\`\``
  },
  {
    slug: 'crypto-websocket-api-guide',
    title: 'Crypto WebSocket APIs: Real-Time Data for Trading Apps (2026)',
    meta: 'Master WebSocket APIs for cryptocurrency — live price feeds, order book streams, trade data from Binance, Coinbase, Kraken, and decentralized sources.',
    keywords: 'crypto WebSocket API, real-time crypto price, live order book API, trading WebSocket, crypto streaming API',
    content: `# Crypto WebSocket APIs: Real-Time Data for Trading Apps (2026)

WebSocket connections are essential for any crypto application that needs live data — trading bots, price tickers, order book visualizations, and liquidation dashboards all depend on persistent, low-latency streams.

## REST vs WebSocket

| | REST | WebSocket |
|---|---|---|
| Connection | New per request | Persistent |
| Latency | 50–200ms | 5–20ms |
| Data freshness | Polling interval | Real-time push |
| Server load | High (polling) | Low |
| Best for | OHLCV, account data | Live prices, order books |

## Binance WebSocket

\`\`\`javascript
// Single stream
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

// Combined streams
const ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker');

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const tick = msg.data || msg; // combined vs single
  console.log(tick.s, tick.c); // symbol, close price
};
\`\`\`

**Binance stream types:**
- \`<symbol>@aggTrade\` — aggregated trades
- \`<symbol>@kline_<interval>\` — candles (1m, 5m, 1h, 1d...)
- \`<symbol>@depth<levels>\` — partial order book (5, 10, or 20 levels)
- \`<symbol>@depth@100ms\` — diff order book updates
- \`!ticker@arr\` — all symbols ticker

## Coinbase WebSocket

\`\`\`javascript
const ws = new WebSocket('wss://advanced-trade-ws.coinbase.com');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    product_ids: ['BTC-USD', 'ETH-USD'],
    channel: 'level2'
  }));
};

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.channel === 'l2_data') {
    msg.events.forEach(e => {
      e.updates.forEach(u => console.log(u.side, u.price_level, u.new_quantity));
    });
  }
};
\`\`\`

## Kraken WebSocket

\`\`\`javascript
const ws = new WebSocket('wss://ws.kraken.com/v2');

ws.onopen = () => {
  ws.send(JSON.stringify({
    method: 'subscribe',
    params: {
      channel: 'book',
      symbol: ['BTC/USD'],
      depth: 10
    }
  }));
};
\`\`\`

## Reconnection Logic

WebSocket connections drop. Always implement reconnection:

\`\`\`javascript
class ReconnectingWebSocket {
  constructor(url, onMessage) {
    this.url = url;
    this.onMessage = onMessage;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = ({ data }) => this.onMessage(JSON.parse(data));
    this.ws.onclose = () => {
      console.log('Disconnected, reconnecting in 3s...');
      setTimeout(() => this.connect(), 3000);
    };
    this.ws.onerror = (err) => console.error('WS error:', err);
  }

  send(data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
\`\`\`

## Ethereum WebSocket (Events)

\`\`\`javascript
import { ethers } from 'ethers';

const provider = new ethers.WebSocketProvider(process.env.ETH_WSS_URL);

// New blocks
provider.on('block', blockNumber => console.log('Block:', blockNumber));

// ERC-20 transfers
const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
usdc.on('Transfer', (from, to, value, event) => {
  console.log(\`\${from} → \${to}: \${ethers.formatUnits(value, 6)} USDC\`);
});
\`\`\`

## Heartbeat / Ping-Pong

Most providers require a ping every 30–60 seconds to keep connections alive:

\`\`\`javascript
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.ping();
}, 30000);
\`\`\``
  },
  {
    slug: 'defi-llama-api-guide',
    title: 'DeFiLlama API Guide: Free DeFi TVL and Protocol Data (2026)',
    meta: 'Learn to use the DeFiLlama API for DeFi TVL, protocol revenue, yields, stablecoin data, and bridges — completely free with no API key required.',
    keywords: 'DeFiLlama API, DeFi TVL API, DeFi protocol data API, DeFiLlama free, yield API',
    content: `# DeFiLlama API Guide: Free DeFi TVL and Protocol Data (2026)

DeFiLlama is the leading DeFi analytics platform, and its API is completely free with no API key required. It covers TVL, revenue, yields, stablecoins, bridges, and more across 200+ chains and 3,000+ protocols.

## Base URL

\`https://api.llama.fi\`

No authentication required.

## TVL Data

\`\`\`javascript
// Global DeFi TVL
const res = await fetch('https://api.llama.fi/v2/globalCharts');
const data = await res.json();
// [{date, totalLiquidityUSD}, ...]

// All protocols with current TVL
const protocols = await fetch('https://api.llama.fi/protocols').then(r => r.json());
protocols.slice(0, 5).forEach(p => {
  console.log(p.name, p.chain, \`$\${(p.tvl / 1e9).toFixed(2)}B\`);
});

// Single protocol TVL history
const aave = await fetch('https://api.llama.fi/protocol/aave').then(r => r.json());
console.log(aave.tvl); // Historical TVL array
\`\`\`

## Chain TVL

\`\`\`javascript
// TVL by chain
const chains = await fetch('https://api.llama.fi/v2/chains').then(r => r.json());
chains.sort((a, b) => b.tvl - a.tvl).slice(0, 10).forEach(c => {
  console.log(c.name, \`$\${(c.tvl / 1e9).toFixed(1)}B\`);
});
\`\`\`

## Yields (APY Data)

\`\`\`javascript
const pools = await fetch('https://yields.llama.fi/pools').then(r => r.json());

// Find highest yield stablecoin pools
const stablePools = pools.data
  .filter(p => p.stablecoin && p.tvlUsd > 1_000_000)
  .sort((a, b) => b.apy - a.apy)
  .slice(0, 10);

stablePools.forEach(p => {
  console.log(\`\${p.project} \${p.symbol}: \${p.apy.toFixed(2)}% APY (TVL: $\${(p.tvlUsd/1e6).toFixed(0)}M)\`);
});
\`\`\`

## Stablecoin Data

\`\`\`javascript
// All stablecoins
const stables = await fetch('https://stablecoins.llama.fi/stablecoins').then(r => r.json());

// USDC circulating supply
const usdc = stables.peggedAssets.find(s => s.symbol === 'USDC');
console.log('USDC mcap:', usdc.circulating.peggedUSD);

// Historical peg data
const history = await fetch('https://stablecoins.llama.fi/stablecoincharts/all').then(r => r.json());
\`\`\`

## Protocol Revenue

\`\`\`javascript
// Revenue for all protocols
const revenue = await fetch('https://api.llama.fi/overview/fees?excludeTotalDataChartBreakdown=true').then(r => r.json());

revenue.protocols.sort((a, b) => (b.total30d || 0) - (a.total30d || 0)).slice(0, 5).forEach(p => {
  console.log(p.name, \`30d revenue: $\${(p.total30d / 1e6).toFixed(1)}M\`);
});
\`\`\`

## Bridge Volume

\`\`\`javascript
const bridges = await fetch('https://bridges.llama.fi/bridges').then(r => r.json());
bridges.bridges.sort((a, b) => b.lastMonthVolume - a.lastMonthVolume).slice(0, 5).forEach(b => {
  console.log(b.displayName, \`Monthly: $\${(b.lastMonthVolume / 1e9).toFixed(1)}B\`);
});
\`\`\`

## API Endpoints Summary

| Endpoint | Data |
|---|---|
| \`/protocols\` | All protocols + TVL |
| \`/protocol/{slug}\` | Protocol TVL history |
| \`/v2/chains\` | TVL by chain |
| \`/v2/globalCharts\` | Global DeFi TVL chart |
| \`/overview/fees\` | Protocol revenue |
| \`yields.llama.fi/pools\` | Yield opportunities |
| \`stablecoins.llama.fi/stablecoins\` | Stablecoin data |
| \`bridges.llama.fi/bridges\` | Bridge volume |`
  },
  {
    slug: 'kraken-api-guide',
    title: 'Kraken API Guide: Trading and Market Data for Developers (2026)',
    meta: 'Complete guide to the Kraken API — authentication, order placement, margin trading, WebSocket feeds, and staking endpoints with code examples.',
    keywords: 'Kraken API, Kraken trading API, Kraken WebSocket, Kraken REST API, crypto exchange API',
    content: `# Kraken API Guide: Trading and Market Data for Developers (2026)

Kraken offers a robust API for spot trading, futures, margin, staking, and market data. It's especially popular with European traders and institutions due to its strong regulatory compliance.

## Base URLs

- REST: \`https://api.kraken.com\`
- WebSocket: \`wss://ws.kraken.com/v2\`
- Futures REST: \`https://futures.kraken.com\`

## Authentication

Kraken uses HMAC-SHA512 with a nonce:

\`\`\`javascript
import crypto from 'crypto';

function getKrakenSignature(path, postData, secret) {
  const { nonce } = postData;
  const message = postData.nonce + new URLSearchParams(postData).toString();
  const secret_buffer = Buffer.from(secret, 'base64');
  const hash = crypto.createHash('sha256').update(nonce + message).digest('binary');
  const hmac = crypto.createHmac('sha512', secret_buffer);
  return hmac.update(path + hash, 'binary').digest('base64');
}

async function privateRequest(path, data, apiKey, apiSecret) {
  const postData = { nonce: Date.now().toString(), ...data };
  const signature = getKrakenSignature('/0' + path, postData, apiSecret);

  const res = await fetch(\`https://api.kraken.com/0\${path}\`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(postData)
  });
  return res.json();
}
\`\`\`

## Market Data (Public)

\`\`\`javascript
// Ticker for multiple pairs
const res = await fetch('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD');
const { result } = await res.json();
console.log(result.XXBTZUSD.c[0]); // Last trade price

// OHLCV data
const ohlc = await fetch('https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60');
\`\`\`

## Placing Orders

\`\`\`javascript
const order = await privateRequest('/private/AddOrder', {
  pair: 'XBTUSD',
  type: 'buy',
  ordertype: 'limit',
  price: '50000',
  volume: '0.001',
  validate: false // set true to test without placing
}, apiKey, apiSecret);
console.log(order.result.txid);
\`\`\`

## WebSocket v2

\`\`\`javascript
const ws = new WebSocket('wss://ws.kraken.com/v2');

ws.onopen = () => {
  // Subscribe to ticker
  ws.send(JSON.stringify({
    method: 'subscribe',
    params: { channel: 'ticker', symbol: ['BTC/USD', 'ETH/USD'] }
  }));

  // Subscribe to order book
  ws.send(JSON.stringify({
    method: 'subscribe',
    params: { channel: 'book', symbol: ['BTC/USD'], depth: 10 }
  }));
};
\`\`\`

## Staking API

\`\`\`javascript
// Get stakeable assets
const stakeable = await privateRequest('/private/Staking/Assets', {}, apiKey, apiSecret);

// Stake assets
const stake = await privateRequest('/private/Stake', {
  asset: 'ETH',
  amount: '1.0',
  method: 'ethereum-validator'
}, apiKey, apiSecret);
\`\`\`

## Rate Limits

Kraken uses a counter-based system. Your counter starts at 15 (Starter) or 20 (Intermediate/Pro). Each private call costs 1 counter, with 0.33–1 counter/second regeneration. Exceeding triggers HTTP 429.`
  },
  {
    slug: 'etherscan-api-guide',
    title: 'Etherscan API Guide: Blockchain Explorer Data for Developers (2026)',
    meta: 'How to use the Etherscan API to fetch transactions, token transfers, gas prices, contract ABIs, and event logs. Free and paid tier explained.',
    keywords: 'Etherscan API, Etherscan developer API, Ethereum explorer API, get transactions API, contract ABI API',
    content: `# Etherscan API Guide: Blockchain Explorer Data for Developers (2026)

The Etherscan API gives programmatic access to the same data shown on etherscan.io — transaction history, token transfers, gas prices, contract source code, and more.

## Base URL

\`https://api.etherscan.io/api\`

Register at etherscan.io for a free API key (5 calls/second, 100K calls/day).

## Get ETH Balance

\`\`\`javascript
const key = process.env.ETHERSCAN_API_KEY;

const res = await fetch(
  \`https://api.etherscan.io/api?module=account&action=balance&address=0xYourAddress&tag=latest&apikey=\${key}\`
);
const { result } = await res.json();
console.log(parseInt(result) / 1e18); // ETH balance
\`\`\`

## Get Transaction History

\`\`\`javascript
const res = await fetch(
  \`https://api.etherscan.io/api?module=account&action=txlist&address=0xAddress&startblock=0&endblock=99999999&sort=desc&apikey=\${key}\`
);
const { result } = await res.json();
result.slice(0, 5).forEach(tx => {
  console.log(tx.hash, tx.from, tx.to, parseInt(tx.value) / 1e18);
});
\`\`\`

## ERC-20 Token Transfers

\`\`\`javascript
const res = await fetch(
  \`https://api.etherscan.io/api?module=account&action=tokentx&address=0xAddress&sort=desc&apikey=\${key}\`
);
const transfers = (await res.json()).result;
transfers.slice(0, 5).forEach(t => {
  const value = parseInt(t.value) / Math.pow(10, parseInt(t.tokenDecimal));
  console.log(\`\${t.tokenSymbol}: \${value}\`);
});
\`\`\`

## Gas Oracle

\`\`\`javascript
const res = await fetch(
  \`https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=\${key}\`
);
const { result } = await res.json();
console.log('Safe gas:', result.SafeGasPrice, 'Gwei');
console.log('Fast gas:', result.FastGasPrice, 'Gwei');
\`\`\`

## Get Contract ABI

\`\`\`javascript
const res = await fetch(
  \`https://api.etherscan.io/api?module=contract&action=getabi&address=0xContractAddress&apikey=\${key}\`
);
const { result } = await res.json();
const abi = JSON.parse(result);
\`\`\`

## Get Contract Source Code

\`\`\`javascript
const res = await fetch(
  \`https://api.etherscan.io/api?module=contract&action=getsourcecode&address=0xContractAddress&apikey=\${key}\`
);
const [contract] = (await res.json()).result;
console.log(contract.ContractName, contract.CompilerVersion);
\`\`\`

## Event Logs

\`\`\`javascript
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const res = await fetch(
  \`https://api.etherscan.io/api?module=logs&action=getLogs&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&topic0=\${transferTopic}&fromBlock=21000000&toBlock=latest&apikey=\${key}\`
);
const logs = (await res.json()).result;
\`\`\`

## Multi-Chain Support

Etherscan has explorer APIs for: Polygon (polygonscan.com), BNB Chain (bscscan.com), Arbitrum (arbiscan.io), Optimism (optimistic.etherscan.io), Base (basescan.org), Avalanche (snowtrace.io), and more — same API format, different base URL.

## Rate Limits

| Plan | Calls/sec | Calls/day |
|---|---|---|
| Free | 5 | 100,000 |
| Standard | 10 | 500,000 |
| Advanced | 30 | 2,000,000 |`
  },
  {
    slug: 'opensea-api-guide',
    title: 'OpenSea API Guide: NFT Data and Trading (2026)',
    meta: 'Complete guide to the OpenSea API — fetch NFT listings, collection stats, offers, floor prices, and place orders using the OpenSea SDK.',
    keywords: 'OpenSea API, NFT API, OpenSea developer API, NFT listings API, NFT floor price API',
    content: `# OpenSea API Guide: NFT Data and Trading (2026)

The OpenSea API provides access to NFT listings, sales, offers, collection stats, and the ability to create and fulfill orders programmatically.

## Authentication

Register at opensea.io/account/settings for a free API key.

\`\`\`javascript
const headers = {
  'X-API-KEY': process.env.OPENSEA_API_KEY,
  'Accept': 'application/json'
};
\`\`\`

## Get Collection Stats

\`\`\`javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/collections/boredapeyachtclub/stats',
  { headers }
);
const { total, intervals } = await res.json();
console.log('Floor:', total.floor_price, 'ETH');
console.log('24h Volume:', intervals[0].volume, 'ETH');
console.log('Total Supply:', total.num_owners, 'owners');
\`\`\`

## Get NFT Listings

\`\`\`javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/listings/collection/boredapeyachtclub/best?limit=20',
  { headers }
);
const { listings } = await res.json();
listings.forEach(l => {
  const price = parseInt(l.price.current.value) / 1e18;
  console.log(\`Token \${l.token_id}: \${price} ETH\`);
});
\`\`\`

## Get NFT Metadata

\`\`\`javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/chain/ethereum/contract/0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D/nfts/1',
  { headers }
);
const { nft } = await res.json();
console.log(nft.name, nft.image_url);
nft.traits.forEach(t => console.log(t.trait_type, t.value));
\`\`\`

## Get NFTs by Wallet

\`\`\`javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/chain/ethereum/account/0xAddress/nfts?limit=50',
  { headers }
);
const { nfts } = await res.json();
\`\`\`

## Recent Sales

\`\`\`javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/events/collection/boredapeyachtclub?event_type=sale&limit=20',
  { headers }
);
const { asset_events } = await res.json();
asset_events.forEach(e => {
  const price = parseInt(e.payment.quantity) / 1e18;
  console.log(\`Token \${e.nft.identifier}: sold for \${price} ETH\`);
});
\`\`\`

## Creating Listings (SDK)

\`\`\`javascript
import { OpenSeaSDK, Chain } from 'opensea-js';
import { ethers } from 'ethers';

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const sdk = new OpenSeaSDK(signer, {
  chain: Chain.Mainnet,
  apiKey: process.env.OPENSEA_API_KEY
});

const listing = await sdk.createListing({
  asset: {
    tokenId: '1',
    tokenAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
  },
  startAmount: 10, // 10 ETH
  expirationTime: Math.round(Date.now() / 1000 + 86400) // 24h
});
\`\`\`

## Rate Limits

- Free: 4 requests/second
- Register for an API key: higher limits available
- Webhooks: real-time event delivery for sales, listings, offers`
  },
  {
    slug: 'uniswap-api-guide',
    title: 'Uniswap API Guide: DEX Data and Swap Integration (2026)',
    meta: 'How to query Uniswap V3 pool data, execute swaps, get token prices, and access liquidity analytics using the Uniswap subgraph and SDK.',
    keywords: 'Uniswap API, Uniswap V3 API, Uniswap subgraph, DEX API, token swap API',
    content: `# Uniswap API Guide: DEX Data and Swap Integration (2026)

Uniswap is the largest decentralized exchange by volume. You can access its data via The Graph subgraph or execute swaps programmatically via the Uniswap SDK.

## Data via The Graph

\`\`\`javascript
const UNISWAP_V3 = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

async function graphQuery(query) {
  const res = await fetch(UNISWAP_V3, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return (await res.json()).data;
}
\`\`\`

## Top Pools by TVL

\`\`\`javascript
const { pools } = await graphQuery(\`{
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
}\`);
\`\`\`

## Token Price

\`\`\`javascript
const { token } = await graphQuery(\`{
  token(id: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
    symbol
    derivedETH
    tokenDayData(first: 7, orderBy: date, orderDirection: desc) {
      date
      priceUSD
      volumeUSD
    }
  }
}\`);
\`\`\`

## Recent Swaps

\`\`\`javascript
const { swaps } = await graphQuery(\`{
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
}\`);
\`\`\`

## Execute a Swap (SDK)

\`\`\`bash
npm install @uniswap/v3-sdk @uniswap/sdk-core
\`\`\`

\`\`\`javascript
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
\`\`\`

## Pool Contract Direct Interaction

\`\`\`javascript
const poolAbi = ['function slot0() view returns (uint160 sqrtPriceX96, int24 tick, ...)'];
const pool = new ethers.Contract(poolAddress, poolAbi, provider);
const { sqrtPriceX96, tick } = await pool.slot0();
\`\`\``
  },
  {
    slug: 'crypto-payment-api-guide',
    title: 'Crypto Payment APIs: Accept Cryptocurrency in Your App (2026)',
    meta: 'Compare the top crypto payment APIs — Coinbase Commerce, NOWPayments, BitPay, and x402. Learn to accept Bitcoin, ETH, USDC, and other crypto payments.',
    keywords: 'crypto payment API, accept Bitcoin API, USDC payment API, cryptocurrency checkout API, x402 payment protocol',
    content: `# Crypto Payment APIs: Accept Cryptocurrency in Your App (2026)

Crypto payment APIs let your application accept Bitcoin, Ethereum, USDC, and other currencies without managing wallets manually. This guide covers the top providers and the emerging x402 standard.

## Top Crypto Payment Providers

| Provider | Supported Coins | Settlement | Fiat Conversion |
|---|---|---|---|
| Coinbase Commerce | BTC, ETH, USDC, SOL, DOGE, LTC | Crypto or USD | Yes |
| NOWPayments | 300+ coins | Crypto or fiat | Yes |
| BitPay | BTC, ETH, XRP, stablecoins | Crypto or USD | Yes |
| Stripe Crypto | USDC (Ethereum/Solana) | USD | Auto |
| x402 | USDC (Base, ETH, Solana) | Crypto | No |

## Coinbase Commerce

\`\`\`javascript
// Create a charge
const res = await fetch('https://api.commerce.coinbase.com/charges', {
  method: 'POST',
  headers: {
    'X-CC-Api-Key': process.env.COINBASE_COMMERCE_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Product Purchase',
    description: 'Order #1234',
    pricing_type: 'fixed_price',
    local_price: { amount: '49.99', currency: 'USD' },
    metadata: { order_id: '1234', customer_id: 'user_789' },
    redirect_url: 'https://yourapp.com/success',
    cancel_url: 'https://yourapp.com/cancel'
  })
});
const { data } = await res.json();
// Redirect user to data.hosted_url
console.log('Payment URL:', data.hosted_url);
\`\`\`

## Webhooks (Coinbase Commerce)

\`\`\`javascript
import crypto from 'crypto';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-cc-webhook-signature'];
  const computed = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (sig !== computed) return res.status(400).send('Invalid signature');

  const { event } = JSON.parse(req.body);
  if (event.type === 'charge:confirmed') {
    console.log('Payment confirmed:', event.data.metadata.order_id);
    // Fulfill order
  }
  res.json({ received: true });
});
\`\`\`

## NOWPayments

\`\`\`javascript
// Create payment
const res = await fetch('https://api.nowpayments.io/v1/payment', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.NOWPAYMENTS_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    price_amount: 49.99,
    price_currency: 'usd',
    pay_currency: 'btc',
    order_id: '1234',
    order_description: 'Product purchase'
  })
});
const payment = await res.json();
// Send user to payment.pay_address to pay payment.pay_amount BTC
\`\`\`

## x402: HTTP-Native Crypto Payments

x402 is an emerging standard where any HTTP endpoint can require payment natively. The flow:

1. Client requests resource → server returns \`402 Payment Required\` with payment details
2. Client pays in USDC → includes \`X-Payment\` header in retry
3. Server verifies payment → returns resource

\`\`\`javascript
// Client-side x402 fetch
import { fetchWithPayment } from 'x402-fetch';

const res = await fetchWithPayment('https://api.example.com/premium-data', {
  wallet: signer // ethers.js signer
});
const data = await res.json();
\`\`\`

\`\`\`javascript
// Server-side x402 middleware (Express)
import { paymentMiddleware } from 'x402-express';

app.use('/premium', paymentMiddleware({
  amount: 0.01, // $0.01 USDC
  token: 'USDC',
  chain: 'base',
  payTo: process.env.WALLET_ADDRESS
}));
\`\`\`

## Best Practices

- Always verify payments server-side via webhook, never trust client-reported status
- Use idempotency keys to prevent double-fulfillment
- Store transaction hashes for audit trails
- Monitor for underpayments — crypto amounts can vary with gas fees
- For fiat merchants, use auto-conversion to avoid crypto volatility exposure`
  },
  {
    slug: 'blockchain-data-api-comparison',
    title: 'Top Blockchain Data APIs Compared: Alchemy vs Infura vs QuickNode (2026)',
    meta: 'Side-by-side comparison of Alchemy, Infura, QuickNode, Moralis, and Ankr — pricing, features, supported chains, rate limits, and best use cases.',
    keywords: 'blockchain API comparison, Alchemy vs Infura, QuickNode vs Alchemy, best blockchain API, Web3 infrastructure comparison',
    content: `# Top Blockchain Data APIs Compared: Alchemy vs Infura vs QuickNode (2026)

Choosing the right blockchain infrastructure provider affects your app's reliability, latency, and cost. Here's a detailed comparison of the major players.

## Feature Comparison

| Feature | Alchemy | Infura | QuickNode | Moralis | Ankr |
|---|---|---|---|---|---|
| Free tier | 300M CU/mo | 100K req/day | 10M credits/mo | 40K CU/day | 30M req/mo |
| Enhanced APIs | Yes (NFT, Token, etc.) | Limited | Yes (add-ons) | Yes (best) | No |
| WebSocket | Yes | Yes | Yes | No | Yes |
| Archive data | Yes (paid) | Yes (paid) | Yes (paid) | Yes | Yes |
| Chains | 20+ | 10+ | 30+ | 30+ | 40+ |
| Webhooks | Yes (Notify) | No | No | Yes (Streams) | No |
| Serverless functions | No | No | Yes (Functions) | No | No |
| Data pipelines | No | No | Yes (Streams) | Yes (Streams) | No |
| SLA uptime | 99.9% | 99.9% | 99.9% | 99.9% | 99.5% |

## Pricing (paid tiers starting from)

| Provider | Starter | Growth | Scale |
|---|---|---|---|
| Alchemy | Free | $49/mo | $199/mo |
| Infura | Free | $50/mo | $225/mo |
| QuickNode | Free | $9/mo | $49/mo |
| Moralis | Free | $49/mo | $249/mo |
| Ankr | Free | $189/mo | Custom |

## Latency Comparison (Ethereum Mainnet, global average)

| Provider | p50 | p95 | p99 |
|---|---|---|---|
| Alchemy | 45ms | 120ms | 280ms |
| QuickNode | 38ms | 95ms | 210ms |
| Infura | 52ms | 145ms | 320ms |
| Ankr | 68ms | 190ms | 450ms |

*Source: independent testing, 2025 Q4*

## Best For Each Use Case

### DeFi application with NFT features
**→ Alchemy** — best enhanced APIs for NFTs, tokens, and transfers. Webhooks for real-time events.

### High-frequency trading bot
**→ QuickNode** — lowest latency, dedicated endpoints, global nodes.

### Wallet or portfolio app
**→ Moralis** — highest-level APIs, wallet net worth, token balances with USD values in one call.

### Multi-chain application (30+ chains)
**→ QuickNode or Ankr** — broadest chain coverage.

### IPFS + Ethereum combination
**→ Infura** — built-in IPFS gateway alongside Ethereum RPC.

### Budget-conscious project
**→ Ankr** — generous free tier, pay-as-you-go pricing.

## Code Portability

All providers implement the standard Ethereum JSON-RPC spec, so switching is straightforward — just change the RPC URL:

\`\`\`javascript
// Easy to swap providers
const PROVIDERS = {
  alchemy: \`https://eth-mainnet.g.alchemy.com/v2/\${ALCHEMY_KEY}\`,
  infura: \`https://mainnet.infura.io/v3/\${INFURA_ID}\`,
  quicknode: process.env.QUICKNODE_URL,
  ankr: 'https://rpc.ankr.com/eth'
};

const provider = new ethers.JsonRpcProvider(PROVIDERS.alchemy);
\`\`\`

## Recommendation

For most production applications: **Alchemy** for Ethereum/EVM dApps with rich data needs, **QuickNode** for performance-critical trading infrastructure, **Moralis** for full-stack Web3 apps that need high-level portfolio and DeFi APIs.

Use multiple providers in parallel for critical applications — fan out requests and use whichever responds first.`
  },
  {
    slug: 'crypto-portfolio-api-guide',
    title: 'Building a Crypto Portfolio Tracker with APIs (2026)',
    meta: 'Step-by-step guide to building a crypto portfolio tracker using CoinGecko, Alchemy, and Moralis APIs. Fetch balances, prices, and P&L in real time.',
    keywords: 'crypto portfolio API, portfolio tracker API, crypto balance API, DeFi portfolio API, Web3 portfolio',
    content: `# Building a Crypto Portfolio Tracker with APIs (2026)

A complete portfolio tracker needs three data layers: on-chain balances (what you hold), price data (what it's worth), and transaction history (how you got it). Here's how to combine them.

## Architecture

\`\`\`
Wallet Addresses
       ↓
Moralis / Alchemy  →  Token balances + USD values
       ↓
CoinGecko / CMC    →  Historical prices for P&L
       ↓
Etherscan / Alchemy →  Transaction history
\`\`\`

## Step 1: Fetch All Token Balances with USD Values

\`\`\`javascript
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
\`\`\`

## Step 2: Multi-Chain Portfolio

\`\`\`javascript
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
\`\`\`

## Step 3: Historical P&L

\`\`\`javascript
async function getTokenPnl(symbol, purchaseDate, purchaseAmount, purchaseUsdValue) {
  const coinId = await getCoinGeckoId(symbol);

  const res = await fetch(
    \`https://api.coingecko.com/api/v3/coins/\${coinId}/history?date=\${formatDate(purchaseDate)}\`
  );
  const { market_data } = await res.json();
  const purchasePriceUsd = market_data.current_price.usd;

  const currentPriceRes = await fetch(
    \`https://api.coingecko.com/api/v3/simple/price?ids=\${coinId}&vs_currencies=usd\`
  );
  const { [coinId]: { usd: currentPrice } } = await currentPriceRes.json();

  const currentValue = purchaseAmount * currentPrice;
  const pnl = currentValue - purchaseUsdValue;
  const pnlPct = ((currentPrice - purchasePriceUsd) / purchasePriceUsd) * 100;

  return { pnl, pnlPct, currentValue, purchasePriceUsd, currentPrice };
}
\`\`\`

## Step 4: DeFi Positions

\`\`\`javascript
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
\`\`\`

## Step 5: Real-Time Price Updates

\`\`\`javascript
async function streamPrices(symbols, onUpdate) {
  const ids = await Promise.all(symbols.map(s => getCoinGeckoId(s)));

  setInterval(async () => {
    const res = await fetch(
      \`https://api.coingecko.com/api/v3/simple/price?ids=\${ids.join(',')}&vs_currencies=usd&include_24hr_change=true\`
    );
    const prices = await res.json();
    onUpdate(prices);
  }, 30000); // every 30s
}
\`\`\`

## Complete Portfolio Summary

\`\`\`javascript
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
\`\`\``
  },
];

for (const article of articles) {
  const filePath = join(OUT, `${article.slug}.md`);
  const content = `---
title: "${article.title}"
meta_description: "${article.meta}"
keywords: "${article.keywords}"
---

${article.content}
`;
  writeFileSync(filePath, content);
  console.log(`✅ ${article.slug}.md`);
}

console.log(`\n✅ Wrote ${articles.length} articles to ${OUT}`);
