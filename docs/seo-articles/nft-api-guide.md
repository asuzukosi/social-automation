---
title: "NFT APIs: Fetch Metadata, Floor Prices, and Ownership (2026)"
meta_description: "Compare the top NFT data APIs — Alchemy, Moralis, OpenSea, Reservoir, and Simplehash. Query metadata, floor prices, owners, and transfer history."
keywords: "NFT API, NFT metadata API, NFT floor price API, NFT ownership API, NFT data API"
---

# NFT APIs: Fetch Metadata, Floor Prices, and Ownership (2026)

NFT data is spread across multiple layers — on-chain ownership, off-chain metadata, and marketplace listings. These APIs unify all three.

## Alchemy NFT API

```javascript
import { Alchemy, Network } from 'alchemy-sdk';

const alchemy = new Alchemy({ apiKey: process.env.ALCHEMY_API_KEY, network: Network.ETH_MAINNET });

// All NFTs owned by an address
const { ownedNfts } = await alchemy.nft.getNftsForOwner('0xAddress');

// NFTs in a collection
const { nfts } = await alchemy.nft.getNftsForContract('0xContractAddress');

// Floor price
const floor = await alchemy.nft.getFloorPrice('0xContractAddress');
console.log('OpenSea floor:', floor.openSea?.floorPrice, 'ETH');
console.log('LooksRare floor:', floor.looksRare?.floorPrice, 'ETH');

// Transfer history
const transfers = await alchemy.nft.getTransfersForContract('0xContractAddress');
```

## Simplehash (Best Multi-Chain NFT API)

Simplehash covers 60+ chains with a unified API:

```javascript
const headers = { 'X-API-KEY': process.env.SIMPLEHASH_API_KEY };

// NFTs by wallet (multi-chain)
const res = await fetch(
  'https://api.simplehash.com/api/v0/nfts/owners_v2?chains=ethereum,polygon,solana&wallet_addresses=0xAddress',
  { headers }
);
const { nfts } = await res.json();

// Collection stats
const stats = await fetch(
  'https://api.simplehash.com/api/v0/nfts/collections/ethereum/0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
  { headers }
).then(r => r.json());
console.log(stats.floor_prices);
console.log(stats.volume_usd_24h);
```

## Reservoir Protocol

Reservoir aggregates listings from OpenSea, Blur, X2Y2, and more:

```javascript
// Best listings for a collection
const listings = await fetch(
  'https://api.reservoir.tools/orders/asks/v5?collection=0xBC4CA0...&sortBy=price&limit=20',
  { headers: { 'x-api-key': process.env.RESERVOIR_API_KEY } }
).then(r => r.json());

// Best offers
const offers = await fetch(
  'https://api.reservoir.tools/orders/bids/v6?collection=0xBC4CA0...&sortBy=price&limit=20',
  { headers: { 'x-api-key': process.env.RESERVOIR_API_KEY } }
).then(r => r.json());

// Token sales history
const sales = await fetch(
  'https://api.reservoir.tools/sales/v6?collection=0xBC4CA0...&limit=20',
  { headers: { 'x-api-key': process.env.RESERVOIR_API_KEY } }
).then(r => r.json());
```

## On-Chain NFT Ownership (No API Key)

```javascript
import { ethers } from 'ethers';

const erc721Abi = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function balanceOf(address owner) view returns (uint256)'
];

const bayc = new ethers.Contract('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', erc721Abi, provider);

const owner = await bayc.ownerOf(1);
const tokenUri = await bayc.tokenURI(1);
const balance = await bayc.balanceOf('0xAddress');
```

## Fetch IPFS Metadata

```javascript
async function getNftMetadata(tokenUri) {
  // Convert ipfs:// to https://
  const url = tokenUri.replace('ipfs://', 'https://ipfs.io/ipfs/');
  const metadata = await fetch(url).then(r => r.json());
  return {
    name: metadata.name,
    description: metadata.description,
    image: metadata.image?.replace('ipfs://', 'https://ipfs.io/ipfs/'),
    attributes: metadata.attributes || []
  };
}
```

## NFT Rarity Scoring

```javascript
function calculateRarity(traits, collectionTraits) {
  return traits.reduce((score, { trait_type, value }) => {
    const traitCount = collectionTraits[trait_type]?.[value] || 0;
    const rarity = 1 / (traitCount / 10000); // assuming 10K supply
    return score + rarity;
  }, 0);
}
```
