---
title: "Arbitrum API Guide: Ethereum L2 for Developers (2026)"
meta_description: "Build on Arbitrum One and Arbitrum Nova — RPC setup, Arbiscan API, bridging, Stylus contracts, and accessing DeFi protocols."
keywords: "Arbitrum API, Arbitrum RPC, Arbiscan API, Arbitrum One, Arbitrum developer guide"
---

# Arbitrum API Guide: Ethereum L2 for Developers (2026)

Arbitrum is Ethereum's largest Layer 2 by TVL, offering Ethereum security with 10-100x lower gas costs and faster finality.

## RPC Endpoints

| Network | Public RPC | Chain ID |
|---|---|---|
| Arbitrum One | `https://arb1.arbitrum.io/rpc` | 42161 |
| Arbitrum Nova | `https://nova.arbitrum.io/rpc` | 42170 |
| Arbitrum Sepolia | `https://sepolia-rollup.arbitrum.io/rpc` | 421614 |

```javascript
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
// Or use Alchemy: https://arb-mainnet.g.alchemy.com/v2/<key>
```

## Gas on Arbitrum

Arbitrum gas is calculated differently — there's an L1 data fee on top of the L2 execution fee:

```javascript
const ARB_GAS_INFO = '0x000000000000000000000000000000000000006C';
const arbGasAbi = [
  'function getPricesInWei() view returns (uint256, uint256, uint256, uint256, uint256, uint256)'
];

const gasInfo = new ethers.Contract(ARB_GAS_INFO, arbGasAbi, provider);
const prices = await gasInfo.getPricesInWei();
console.log('L2 gas price:', ethers.formatUnits(prices[5], 'gwei'), 'Gwei');
```

## Arbiscan API

```javascript
const BASE = 'https://api.arbiscan.io/api';
const key = process.env.ARBISCAN_API_KEY;

// Transaction list
const txns = await fetch(
  `${BASE}?module=account&action=txlist&address=0xAddress&sort=desc&apikey=${key}`
).then(r => r.json());

// Contract ABI
const abi = await fetch(
  `${BASE}?module=contract&action=getabi&address=0xContractAddress&apikey=${key}`
).then(r => r.json());
```

## Arbitrum Bridge

```javascript
// Check bridge status
const GATEWAY_ROUTER = '0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef';
const gatewayAbi = ['function getGateway(address token) view returns (address)'];
const router = new ethers.Contract(GATEWAY_ROUTER, gatewayAbi, ethProvider);

// Get gateway for USDC
const gateway = await router.getGateway('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
console.log('USDC Gateway:', gateway);
```

## Key DeFi Protocols on Arbitrum

```javascript
const ARB_CONTRACTS = {
  gmx: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', // GMX token
  uniswapV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  camelotRouter: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d'
};
```

## Stylus (Rust/WASM Contracts)

Arbitrum Stylus lets you write smart contracts in Rust, C, or C++:

```rust
#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

use stylus_sdk::prelude::*;

sol_storage! {
    #[entrypoint]
    pub struct Counter {
        uint256 number;
    }
}

#[external]
impl Counter {
    pub fn increment(&mut self) {
        self.number.set(self.number.get() + U256::from(1));
    }
    pub fn get(&self) -> U256 {
        self.number.get()
    }
}
```

## GMX Perps API

GMX is the largest perps DEX on Arbitrum:

```javascript
// GMX Stats API
const stats = await fetch('https://api.gmx.io/total_volume').then(r => r.json());
console.log('Total volume:', stats);

// Open interest
const oi = await fetch('https://api.gmx.io/open_interest').then(r => r.json());
```
