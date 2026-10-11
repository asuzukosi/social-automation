---
title: "Etherscan API Guide: Blockchain Explorer Data for Developers (2026)"
meta_description: "How to use the Etherscan API to fetch transactions, token transfers, gas prices, contract ABIs, and event logs. Free and paid tier explained."
keywords: "Etherscan API, Etherscan developer API, Ethereum explorer API, get transactions API, contract ABI API"
---

# Etherscan API Guide: Blockchain Explorer Data for Developers (2026)

The Etherscan API gives programmatic access to the same data shown on etherscan.io — transaction history, token transfers, gas prices, contract source code, and more.

## Base URL

`https://api.etherscan.io/api`

Register at etherscan.io for a free API key (5 calls/second, 100K calls/day).

## Get ETH Balance

```javascript
const key = process.env.ETHERSCAN_API_KEY;

const res = await fetch(
  `https://api.etherscan.io/api?module=account&action=balance&address=0xYourAddress&tag=latest&apikey=${key}`
);
const { result } = await res.json();
console.log(parseInt(result) / 1e18); // ETH balance
```

## Get Transaction History

```javascript
const res = await fetch(
  `https://api.etherscan.io/api?module=account&action=txlist&address=0xAddress&startblock=0&endblock=99999999&sort=desc&apikey=${key}`
);
const { result } = await res.json();
result.slice(0, 5).forEach(tx => {
  console.log(tx.hash, tx.from, tx.to, parseInt(tx.value) / 1e18);
});
```

## ERC-20 Token Transfers

```javascript
const res = await fetch(
  `https://api.etherscan.io/api?module=account&action=tokentx&address=0xAddress&sort=desc&apikey=${key}`
);
const transfers = (await res.json()).result;
transfers.slice(0, 5).forEach(t => {
  const value = parseInt(t.value) / Math.pow(10, parseInt(t.tokenDecimal));
  console.log(`${t.tokenSymbol}: ${value}`);
});
```

## Gas Oracle

```javascript
const res = await fetch(
  `https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${key}`
);
const { result } = await res.json();
console.log('Safe gas:', result.SafeGasPrice, 'Gwei');
console.log('Fast gas:', result.FastGasPrice, 'Gwei');
```

## Get Contract ABI

```javascript
const res = await fetch(
  `https://api.etherscan.io/api?module=contract&action=getabi&address=0xContractAddress&apikey=${key}`
);
const { result } = await res.json();
const abi = JSON.parse(result);
```

## Get Contract Source Code

```javascript
const res = await fetch(
  `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=0xContractAddress&apikey=${key}`
);
const [contract] = (await res.json()).result;
console.log(contract.ContractName, contract.CompilerVersion);
```

## Event Logs

```javascript
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const res = await fetch(
  `https://api.etherscan.io/api?module=logs&action=getLogs&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&topic0=${transferTopic}&fromBlock=21000000&toBlock=latest&apikey=${key}`
);
const logs = (await res.json()).result;
```

## Multi-Chain Support

Etherscan has explorer APIs for: Polygon (polygonscan.com), BNB Chain (bscscan.com), Arbitrum (arbiscan.io), Optimism (optimistic.etherscan.io), Base (basescan.org), Avalanche (snowtrace.io), and more — same API format, different base URL.

## Rate Limits

| Plan | Calls/sec | Calls/day |
|---|---|---|
| Free | 5 | 100,000 |
| Standard | 10 | 500,000 |
| Advanced | 30 | 2,000,000 |
