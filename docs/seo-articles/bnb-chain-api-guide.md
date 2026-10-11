---
title: "BNB Chain API Guide: BSC Developer Reference (2026)"
meta_description: "Build on BNB Smart Chain — RPC endpoints, BSCScan API, PancakeSwap integration, and BEP-20 token interactions."
keywords: "BNB Chain API, BSC API, BSCScan API, PancakeSwap API, BNB developer guide"
---

# BNB Chain API Guide: BSC Developer Reference (2026)

BNB Smart Chain (BSC) is an EVM-compatible blockchain with low fees and fast finality, operated by Binance. It's home to PancakeSwap, Venus, and hundreds of DeFi protocols.

## RPC Endpoints

| Network | RPC | Chain ID |
|---|---|---|
| BSC Mainnet | `https://bsc-dataseed.binance.org/` | 56 |
| BSC Testnet | `https://data-seed-prebsc-1-s1.binance.org:8545/` | 97 |
| Alchemy | `https://bnb-mainnet.g.alchemy.com/v2/<key>` | 56 |

```javascript
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
console.log(await provider.getNetwork()); // chainId: 56n
```

## BSCScan API

```javascript
const BASE = 'https://api.bscscan.com/api';
const key = process.env.BSCSCAN_API_KEY;

// BNB balance
const bal = await fetch(
  `${BASE}?module=account&action=balance&address=0xAddress&apikey=${key}`
).then(r => r.json());
console.log(parseInt(bal.result) / 1e18, 'BNB');

// BEP-20 transfers
const transfers = await fetch(
  `${BASE}?module=account&action=tokentx&address=0xAddress&sort=desc&apikey=${key}`
).then(r => r.json());
```

## BEP-20 Tokens

```javascript
const BUSD = '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'; // PancakeSwap

const busd = new ethers.Contract(BUSD, ['function balanceOf(address) view returns (uint256)'], provider);
const balance = await busd.balanceOf('0xAddress');
console.log(ethers.formatEther(balance), 'BUSD');
```

## PancakeSwap API

```javascript
const CAKE_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/pancakeswap/exhange-v3';

const { pools } = await fetch(CAKE_SUBGRAPH, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `{
      pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
        id
        token0 { symbol }
        token1 { symbol }
        feeTier
        totalValueLockedUSD
        volumeUSD
      }
    }`
  })
}).then(r => r.json()).then(r => r.data);

// PancakeSwap REST API
const pairs = await fetch('https://api.pancakeswap.info/api/v2/pairs').then(r => r.json());
```

## PancakeSwap Router (Swap)

```javascript
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const routerAbi = [
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable'
];

const router = new ethers.Contract(ROUTER, routerAbi, provider);
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

const amounts = await router.getAmountsOut(ethers.parseEther('0.1'), [WBNB, CAKE]);
console.log('BNB → CAKE:', ethers.formatEther(amounts[1]));
```

## Venus Protocol (Lending)

```javascript
const VENUS_COMPTROLLER = '0xfD36E2c2a6789Db23113685031d7F16329158384';
const comptrollerAbi = ['function getAllMarkets() view returns (address[])'];
const comptroller = new ethers.Contract(VENUS_COMPTROLLER, comptrollerAbi, provider);
const markets = await comptroller.getAllMarkets();
console.log('Venus markets:', markets.length);
```
