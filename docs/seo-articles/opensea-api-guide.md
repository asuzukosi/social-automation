---
title: "OpenSea API Guide: NFT Data and Trading (2026)"
meta_description: "Complete guide to the OpenSea API — fetch NFT listings, collection stats, offers, floor prices, and place orders using the OpenSea SDK."
keywords: "OpenSea API, NFT API, OpenSea developer API, NFT listings API, NFT floor price API"
---

# OpenSea API Guide: NFT Data and Trading (2026)

The OpenSea API provides access to NFT listings, sales, offers, collection stats, and the ability to create and fulfill orders programmatically.

## Authentication

Register at opensea.io/account/settings for a free API key.

```javascript
const headers = {
  'X-API-KEY': process.env.OPENSEA_API_KEY,
  'Accept': 'application/json'
};
```

## Get Collection Stats

```javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/collections/boredapeyachtclub/stats',
  { headers }
);
const { total, intervals } = await res.json();
console.log('Floor:', total.floor_price, 'ETH');
console.log('24h Volume:', intervals[0].volume, 'ETH');
console.log('Total Supply:', total.num_owners, 'owners');
```

## Get NFT Listings

```javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/listings/collection/boredapeyachtclub/best?limit=20',
  { headers }
);
const { listings } = await res.json();
listings.forEach(l => {
  const price = parseInt(l.price.current.value) / 1e18;
  console.log(`Token ${l.token_id}: ${price} ETH`);
});
```

## Get NFT Metadata

```javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/chain/ethereum/contract/0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D/nfts/1',
  { headers }
);
const { nft } = await res.json();
console.log(nft.name, nft.image_url);
nft.traits.forEach(t => console.log(t.trait_type, t.value));
```

## Get NFTs by Wallet

```javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/chain/ethereum/account/0xAddress/nfts?limit=50',
  { headers }
);
const { nfts } = await res.json();
```

## Recent Sales

```javascript
const res = await fetch(
  'https://api.opensea.io/api/v2/events/collection/boredapeyachtclub?event_type=sale&limit=20',
  { headers }
);
const { asset_events } = await res.json();
asset_events.forEach(e => {
  const price = parseInt(e.payment.quantity) / 1e18;
  console.log(`Token ${e.nft.identifier}: sold for ${price} ETH`);
});
```

## Creating Listings (SDK)

```javascript
import { OpenSeaSDK, Chain } from 'opensea-js';
import { ethers } from 'ethers';

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const sdk = new OpenSeaSDK(signer, {
  chain: Chain.Mainnet,
  apiKey: process.env.OPENSEA_API_KEY
});

const listing = await sdk.createListing({
  asset: {
    tokenId: '1',
    tokenAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
  },
  startAmount: 10, // 10 ETH
  expirationTime: Math.round(Date.now() / 1000 + 86400) // 24h
});
```

## Rate Limits

- Free: 4 requests/second
- Register for an API key: higher limits available
- Webhooks: real-time event delivery for sales, listings, offers
