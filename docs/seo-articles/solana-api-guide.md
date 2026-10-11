---
title: "Solana RPC API Guide for Developers (2026)"
meta_description: "Learn to use the Solana JSON-RPC API — read accounts, send transactions, subscribe to events, and query on-chain data with JavaScript examples."
keywords: "Solana API, Solana RPC, Solana JSON-RPC, @solana/web3.js, Solana developer API"
---

# Solana RPC API Guide for Developers (2026)

Solana's JSON-RPC API is the primary interface for building on the Solana blockchain. With sub-second finality and ~4,000 TPS, Solana is the go-to chain for high-frequency DeFi, NFTs, and payments.

## Setup

```bash
npm install @solana/web3.js
```

```javascript
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
```

## Get SOL Balance

```javascript
const pubkey = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
const balance = await connection.getBalance(pubkey);
console.log(balance / LAMPORTS_PER_SOL); // SOL balance
```

## Get Token Balances (SPL)

```javascript
const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
  programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
});

tokenAccounts.value.forEach(({ account }) => {
  const { mint, tokenAmount } = account.data.parsed.info;
  console.log(mint, tokenAmount.uiAmount);
});
```

## Send a Transaction

```javascript
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
```

## Subscribe to Account Changes

```javascript
const subscriptionId = connection.onAccountChange(pubkey, (accountInfo) => {
  console.log('Balance changed:', accountInfo.lamports / LAMPORTS_PER_SOL);
});

// Unsubscribe when done
await connection.removeAccountChangeListener(subscriptionId);
```

## Key RPC Methods

| Method | Description |
|---|---|
| `getBalance` | SOL balance |
| `getAccountInfo` | Raw account data |
| `getTransaction` | Transaction details |
| `getBlock` | Block with transactions |
| `sendTransaction` | Broadcast transaction |
| `simulateTransaction` | Dry-run without broadcasting |
| `getTokenAccountsByOwner` | All SPL token accounts |
| `getProgramAccounts` | All accounts owned by a program |

## RPC Providers for Solana

- **Helius** — best Solana-specific provider, advanced APIs (DAS, webhooks)
- **QuickNode** — reliable, multi-region
- **Alchemy** — Solana support added 2024
- **Triton** — high-performance, staked connections

## getProgramAccounts — Power Query

This method returns all accounts owned by a program — essential for DeFi integrations.

```javascript
const accounts = await connection.getProgramAccounts(
  new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'), // Raydium AMM
  {
    filters: [{ dataSize: 752 }] // filter by account size
  }
);
```
