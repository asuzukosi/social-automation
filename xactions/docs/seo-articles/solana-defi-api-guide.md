---
title: "Solana DeFi APIs: Jupiter, Raydium, and Orca Integration (2026)"
meta_description: "Query Solana DeFi protocols — get swap quotes from Jupiter, pool data from Raydium and Orca, and execute transactions programmatically."
keywords: "Solana DeFi API, Jupiter API, Raydium API, Orca API, Solana swap API"
---

# Solana DeFi APIs: Jupiter, Raydium, and Orca Integration (2026)

Solana's DeFi ecosystem is dominated by Jupiter (aggregator), Raydium, and Orca. All three offer APIs or SDKs for integration.

## Jupiter Aggregator API

Jupiter routes swaps across all Solana DEXs to get the best price:

```javascript
const BASE = 'https://quote-api.jup.ag/v6';

// Get a swap quote
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';

const quote = await fetch(
  `${BASE}/quote?inputMint=${USDC}&outputMint=${SOL}&amount=100000000&slippageBps=50`
).then(r => r.json());

console.log('Input: 100 USDC');
console.log('Output:', quote.outAmount / 1e9, 'SOL');
console.log('Price impact:', quote.priceImpactPct, '%');
console.log('Route:', quote.routePlan.map(r => r.swapInfo.label).join(' → '));
```

Execute the swap:

```javascript
import { Connection, VersionedTransaction } from '@solana/web3.js';

const { swapTransaction } = await fetch(`${BASE}/swap`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    quoteResponse: quote,
    userPublicKey: wallet.publicKey.toString(),
    wrapAndUnwrapSol: true
  })
}).then(r => r.json());

const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
tx.sign([wallet]);
const sig = await connection.sendTransaction(tx);
await connection.confirmTransaction(sig, 'confirmed');
```

## Jupiter Token List

```javascript
// All verified tokens on Solana
const tokens = await fetch('https://token.jup.ag/all').then(r => r.json());
const usdc = tokens.find(t => t.symbol === 'USDC');
console.log(usdc.address, usdc.decimals);
```

## Raydium

```javascript
// Raydium pool info
const pools = await fetch('https://api.raydium.io/v2/main/pairs').then(r => r.json());
const solUsdc = pools.find(p => p.name === 'SOL-USDC');
console.log('SOL/USDC price:', solUsdc.price);
console.log('24h volume:', solUsdc.volume24h);
console.log('TVL:', solUsdc.tvl);

// Top pools by volume
const top10 = pools
  .sort((a, b) => b.volume24h - a.volume24h)
  .slice(0, 10);
```

## Orca

```javascript
import { buildWhirlpoolClient, ORCA_WHIRLPOOLS_CONFIG } from '@orca-so/whirlpools-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';

const provider = AnchorProvider.env();
const client = buildWhirlpoolClient(ORCA_WHIRLPOOLS_CONFIG, provider);

// Get pool data
const poolAddress = new PublicKey('poolAddressHere');
const pool = await client.getPool(poolAddress);
const poolData = pool.getData();
console.log('Current price:', pool.getPrice().toFixed(4));
console.log('Liquidity:', poolData.liquidity.toString());
```

## Solana Token Prices (Helius DAS API)

```javascript
const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

// Get asset (token) price and metadata
const res = await fetch(HELIUS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getAsset',
    params: { id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
  })
});
const { result } = await res.json();
console.log(result.content.metadata.name, result.token_info.price_info?.price_per_token);
```
