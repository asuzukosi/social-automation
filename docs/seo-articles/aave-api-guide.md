---
title: "Aave API Guide: DeFi Lending Data and Protocol Integration (2026)"
meta_description: "How to query Aave protocol data — interest rates, positions, health factors, and liquidations — using the Aave subgraph and smart contracts."
keywords: "Aave API, Aave lending API, Aave subgraph, DeFi lending API, Aave V3 API"
---

# Aave API Guide: DeFi Lending Data and Protocol Integration (2026)

Aave is the largest DeFi lending protocol. You can query rates, positions, and health factors via their subgraph, REST API, or direct smart contract calls.

## Aave Subgraph

```javascript
const AAVE_V3_ETH = 'https://api.thegraph.com/subgraphs/name/aave/protocol-v3';

async function query(gql) {
  const res = await fetch(AAVE_V3_ETH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: gql })
  });
  return (await res.json()).data;
}

// Get all reserve data (interest rates, TVL)
const { reserves } = await query(`{
  reserves {
    symbol
    name
    liquidityRate
    variableBorrowRate
    stableBorrowRate
    totalDeposits
    totalCurrentVariableDebt
    baseLTVasCollateral
    reserveLiquidationThreshold
    usageAsCollateralEnabled
  }
}`);

// Format APY
reserves.forEach(r => {
  const depositApy = (parseFloat(r.liquidityRate) / 1e27 * 100).toFixed(2);
  const borrowApy = (parseFloat(r.variableBorrowRate) / 1e27 * 100).toFixed(2);
  console.log(`${r.symbol}: Deposit ${depositApy}% | Borrow ${borrowApy}%`);
});
```

## User Positions

```javascript
const { users } = await query(`{
  users(where: { id: "0xuseraddress" }) {
    healthFactor
    totalCollateralUSD
    totalDebtUSD
    currentLiquidationThreshold
    reserves {
      reserve { symbol }
      currentATokenBalance
      currentVariableDebt
      usageAsCollateralEnabled
    }
  }
}`);
```

## Direct Contract Calls

```javascript
import { ethers } from 'ethers';

const POOL_ADDRESS = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'; // Aave V3 ETH

const poolAbi = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getReserveData(address asset) view returns (tuple(...))'
];

const pool = new ethers.Contract(POOL_ADDRESS, poolAbi, provider);

const accountData = await pool.getUserAccountData('0xUserAddress');
console.log('Health Factor:', ethers.formatUnits(accountData.healthFactor, 18));
console.log('Total Collateral USD:', ethers.formatUnits(accountData.totalCollateralBase, 8));
console.log('Total Debt USD:', ethers.formatUnits(accountData.totalDebtBase, 8));
```

## Supply and Borrow

```javascript
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const amount = ethers.parseUnits('1000', 6); // 1000 USDC

const poolWithSigner = pool.connect(signer);

// Approve first
const usdc = new ethers.Contract(USDC, ['function approve(address,uint256)'], signer);
await usdc.approve(POOL_ADDRESS, amount);

// Supply
await poolWithSigner.supply(USDC, amount, signer.address, 0);

// Borrow (variable rate)
await poolWithSigner.borrow(USDC, amount, 2, 0, signer.address);

// Repay
await poolWithSigner.repay(USDC, amount, 2, signer.address);
```

## Liquidation Monitoring

```javascript
// Find positions at risk (health factor < 1.1)
const { users: atRisk } = await query(`{
  users(
    where: { healthFactor_lt: "1100000000000000000" }
    orderBy: healthFactor
    first: 20
  ) {
    id
    healthFactor
    totalCollateralUSD
    totalDebtUSD
  }
}`);
```
