---
title: "Base Chain API Guide: Coinbase L2 for Developers (2026)"
meta_description: "Build on Base — Coinbase's Ethereum L2. Setup RPC, use Basescan API, deploy contracts, and integrate with USDC and Coinbase wallet."
keywords: "Base chain API, Base RPC, Basescan API, Coinbase Base L2, Base developer guide"
---

# Base Chain API Guide: Coinbase L2 for Developers (2026)

Base is an Ethereum Layer 2 built by Coinbase using the OP Stack. It's the fastest-growing L2 and the home of USDC native issuance and the x402 payment protocol.

## RPC Endpoints

| Environment | RPC | Chain ID |
|---|---|---|
| Mainnet | `https://mainnet.base.org` | 8453 |
| Sepolia Testnet | `https://sepolia.base.org` | 84532 |
| Alchemy | `https://base-mainnet.g.alchemy.com/v2/<key>` | 8453 |

```javascript
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
```

## USDC on Base

Base has native USDC issuance from Circle — no bridging risk:

```javascript
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const usdc = new ethers.Contract(USDC_BASE, [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
], provider);

const balance = await usdc.balanceOf('0xAddress');
console.log(ethers.formatUnits(balance, 6), 'USDC');
```

## Basescan API

```javascript
const BASE = 'https://api.basescan.org/api';
const key = process.env.BASESCAN_API_KEY;

// Get transactions
const txns = await fetch(
  `${BASE}?module=account&action=txlist&address=0xAddress&sort=desc&apikey=${key}`
).then(r => r.json());

// Get USDC transfers
const transfers = await fetch(
  `${BASE}?module=account&action=tokentx&contractaddress=${USDC_BASE}&address=0xAddress&apikey=${key}`
).then(r => r.json());
```

## x402 Payments on Base

x402 is HTTP-native micropayments — Base is the primary chain:

```javascript
// Server: require payment for an endpoint
import { paymentMiddleware } from 'x402-express';

app.use('/api/data', paymentMiddleware({
  amount: '0.001', // $0.001 USDC
  token: 'USDC',
  chain: 'base',
  payTo: process.env.WALLET_ADDRESS
}));

// Client: auto-pay
import { withPaymentInterceptor } from 'x402-axios';
const client = withPaymentInterceptor(axios, signer);
const data = await client.get('https://api.example.com/api/data');
```

## Aerodrome DEX (Base)

Aerodrome is the dominant DEX on Base:

```javascript
const AERO_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/aerodrome-finance/slipstream';

const { pools } = await fetch(AERO_SUBGRAPH, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `{
      pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        token0 { symbol }
        token1 { symbol }
        totalValueLockedUSD
        volumeUSD
      }
    }`
  })
}).then(r => r.json()).then(r => r.data);
```

## Coinbase Wallet Integration

```javascript
import { CoinbaseWalletSDK } from '@coinbase/wallet-sdk';

const sdk = new CoinbaseWalletSDK({ appName: 'My App', appLogoUrl: '/logo.png' });
const ethereum = sdk.makeWeb3Provider();
const provider = new ethers.BrowserProvider(ethereum);

// Request connection
const accounts = await ethereum.request({ method: 'eth_requestAccounts' });

// Switch to Base
await ethereum.request({
  method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x2105' }] // 8453 in hex
});
```
