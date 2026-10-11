---
title: "Ethereum RPC API Guide: JSON-RPC Methods for Developers (2026)"
meta_description: "Complete guide to Ethereum JSON-RPC API — read balances, send transactions, call smart contracts, and listen to events using eth_call, eth_getLogs, and more."
keywords: "Ethereum API, Ethereum JSON-RPC, eth_call, web3 API, ethers.js API"
---

# Ethereum RPC API Guide: JSON-RPC Methods for Developers (2026)

The Ethereum JSON-RPC API is the standard interface for interacting with any EVM-compatible blockchain. Every node — whether self-hosted, Alchemy, Infura, or QuickNode — exposes this same API.

## Connecting

```javascript
import { ethers } from 'ethers';

// Via provider URL (Alchemy, Infura, QuickNode, etc.)
const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
```

## Core Methods

### Get ETH Balance

```javascript
const balance = await provider.getBalance('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
console.log(ethers.formatEther(balance)); // "1.234"
```

### Get Block

```javascript
const block = await provider.getBlock('latest');
console.log(block.number, block.timestamp, block.transactions.length);
```

### Call a Smart Contract

```javascript
const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
const usdc = new ethers.Contract('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', erc20Abi, provider);
const balance = await usdc.balanceOf('0xYourAddress');
```

### Send a Transaction

```javascript
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const tx = await signer.sendTransaction({
  to: '0xRecipient',
  value: ethers.parseEther('0.01')
});
await tx.wait();
```

## Raw JSON-RPC

```javascript
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
```

## Event Logs

```javascript
const logs = await provider.getLogs({
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  topics: [ethers.id('Transfer(address,address,uint256)')],
  fromBlock: -1000 // last 1000 blocks
});
```

## Key RPC Methods Reference

| Method | Description |
|---|---|
| `eth_blockNumber` | Latest block number |
| `eth_getBalance` | ETH balance of address |
| `eth_getTransactionByHash` | Transaction details |
| `eth_getTransactionReceipt` | Receipt + logs |
| `eth_call` | Read smart contract state |
| `eth_sendRawTransaction` | Broadcast signed tx |
| `eth_getLogs` | Query event logs |
| `eth_estimateGas` | Estimate gas cost |
| `eth_gasPrice` | Current gas price |

## Node Providers Compared

| Provider | Free tier | Chains | Websockets |
|---|---|---|---|
| Alchemy | 300M compute units/mo | 20+ | Yes |
| Infura | 100K req/day | 10+ | Yes |
| QuickNode | 10M credits/mo | 30+ | Yes |
| Ankr | 30M req/mo | 40+ | Yes |
| Llamarpc | Unlimited (rate limited) | 5 | No |

## Archive Nodes

Standard nodes only keep recent state. For historical queries (e.g., balance at block 10,000,000), you need an archive node. Alchemy and QuickNode both offer archive access on paid plans.
