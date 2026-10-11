---
title: "The Graph API Guide: Query Blockchain Data with GraphQL (2026)"
meta_description: "Learn how to use The Graph protocol to query on-chain data with GraphQL. Deploy subgraphs, query Uniswap, Aave, and custom protocol data."
keywords: "The Graph API, GraphQL blockchain, subgraph API, Uniswap subgraph, The Graph protocol"
---

# The Graph API Guide: Query Blockchain Data with GraphQL (2026)

The Graph is a decentralized indexing protocol that lets you query blockchain data with GraphQL. It powers data for Uniswap, Aave, Compound, and thousands of other DeFi protocols.

## How It Works

1. A **subgraph** defines which on-chain events to index and how to structure them
2. Indexers process the subgraph and store the data
3. You query the subgraph via a GraphQL API endpoint

## Querying a Public Subgraph

No API key needed for hosted service subgraphs:

```javascript
const UNISWAP_V3 = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';

const query = `{
  pools(first: 5, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    token0 { symbol }
    token1 { symbol }
    feeTier
    totalValueLockedUSD
    volumeUSD
  }
}`;

const res = await fetch(UNISWAP_V3, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});
const { data } = await res.json();
```

## Decentralized Network (requires API key)

```javascript
const GRAPH_API_KEY = process.env.GRAPH_API_KEY;
const SUBGRAPH_ID = 'ELUcwgpm14LKPLrBRuVvPvNKHQ9HvwmtKgKSH855M4Nd'; // Uniswap V3

const endpoint = `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;
```

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

```javascript
const query = `
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
`;

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query,
    variables: { token: '0xA0b86991c...', limit: 20 }
  })
});
```

## Writing a Subgraph

```bash
npm install -g @graphprotocol/graph-cli
graph init --product hosted-service my-subgraph
```

**schema.graphql:**
```graphql
type Transfer @entity {
  id: ID!
  from: Bytes!
  to: Bytes!
  value: BigInt!
  timestamp: BigInt!
}
```

**mapping.ts:**
```typescript
export function handleTransfer(event: TransferEvent): void {
  let transfer = new Transfer(event.transaction.hash.toHex());
  transfer.from = event.params.from;
  transfer.to = event.params.to;
  transfer.value = event.params.value;
  transfer.timestamp = event.block.timestamp;
  transfer.save();
}
```
