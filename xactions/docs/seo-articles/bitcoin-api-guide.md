---
title: "Bitcoin API Guide: On-Chain Data, Wallets, and Transactions (2026)"
meta_description: "How to use Bitcoin APIs — query addresses, broadcast transactions, get UTXO sets, and access mempool data using BlockCypher, Blockstream, and Electrum."
keywords: "Bitcoin API, Bitcoin RPC API, Bitcoin transaction API, BlockCypher API, Bitcoin developer API"
---

# Bitcoin API Guide: On-Chain Data, Wallets, and Transactions (2026)

Bitcoin has its own RPC and REST API ecosystem, separate from Ethereum. This guide covers the main options for querying Bitcoin on-chain data and building Bitcoin applications.

## Option 1: Blockstream.info (Free, No Key)

```javascript
const BASE = 'https://blockstream.info/api';

// Address info
const addr = await fetch(`${BASE}/address/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh`).then(r => r.json());
console.log('Balance:', addr.chain_stats.funded_txo_sum - addr.chain_stats.spent_txo_sum, 'satoshis');

// UTXOs
const utxos = await fetch(`${BASE}/address/bc1q.../utxo`).then(r => r.json());

// Transaction
const tx = await fetch(`${BASE}/tx/txid`).then(r => r.json());

// Broadcast raw transaction
await fetch(`${BASE}/tx`, { method: 'POST', body: rawTxHex });

// Current fees
const fees = await fetch(`${BASE}/fee-estimates`).then(r => r.json());
console.log('Next block fee:', fees[1], 'sat/vB');
```

## Option 2: BlockCypher API

```javascript
const token = process.env.BLOCKCYPHER_TOKEN;
const BASE = 'https://api.blockcypher.com/v1/btc/main';

// Address balance
const addr = await fetch(`${BASE}/addrs/bc1q.../balance?token=${token}`).then(r => r.json());
console.log('Final balance:', addr.final_balance);

// Create and send transaction
const newTx = await fetch(`${BASE}/txs/new?token=${token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inputs: [{ addresses: ['fromAddress'] }],
    outputs: [{ addresses: ['toAddress'], value: 10000 }]
  })
}).then(r => r.json());
// Sign inputs, then call /txs/send
```

## Option 3: Bitcoin Core RPC

Running your own node gives full access:

```javascript
async function btcRpc(method, params = []) {
  const res = await fetch('http://localhost:8332', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64')
    },
    body: JSON.stringify({ jsonrpc: '1.0', method, params })
  });
  const { result, error } = await res.json();
  if (error) throw new Error(error.message);
  return result;
}

// Usage
const info = await btcRpc('getblockchaininfo');
const balance = await btcRpc('getreceivedbyaddress', ['bc1q...', 1]);
const txid = await btcRpc('sendtoaddress', ['bc1q...', 0.001]);
```

## Key Bitcoin RPC Methods

| Method | Description |
|---|---|
| `getblockchaininfo` | Chain sync status |
| `getblockcount` | Current block height |
| `getblock` | Block data by hash |
| `getrawtransaction` | Raw transaction hex |
| `decoderawtransaction` | Parse raw tx |
| `sendrawtransaction` | Broadcast tx |
| `getaddressinfo` | Address details |
| `listunspent` | UTXOs for wallet |
| `estimatesmartfee` | Fee estimation |
| `getmempoolinfo` | Mempool stats |

## Fee Estimation

```javascript
// From Bitcoin Core
const feeRate = await btcRpc('estimatesmartfee', [6]); // 6 blocks
console.log(feeRate.feerate, 'BTC/kB');

// From Mempool.space
const fees = await fetch('https://mempool.space/api/v1/fees/recommended').then(r => r.json());
console.log('Fast fee:', fees.fastestFee, 'sat/vB');
console.log('Hour fee:', fees.hourFee, 'sat/vB');
```

## Building a Bitcoin Wallet

```javascript
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import BIP32Factory from 'bip32';

const bip32 = BIP32Factory(ecc);

// Generate HD wallet
const root = bip32.fromSeed(Buffer.from(mnemonic));
const account = root.derivePath("m/84'/0'/0'"); // BIP84 native segwit
const external = account.derive(0).derive(0);

const { address } = bitcoin.payments.p2wpkh({
  pubkey: external.publicKey
});
console.log('Address:', address); // bc1q...
```
