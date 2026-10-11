# Building an On-Chain Event to X Post Automation System

**Meta description:** Learn how to build an on-chain event listener that automatically posts to X when smart contract events fire — covering ethers.js event subscriptions, formatting, and X API v2 integration.

---

## Introduction

On-chain events are the ground truth of DeFi. When a large swap executes, a governance proposal passes, or a vault reaches a liquidation threshold, that information is more valuable when it reaches your audience in seconds rather than minutes. This guide covers building an event-to-post pipeline: listen for on-chain events with ethers.js, format the data into readable posts, and publish to X automatically.

---

## Architecture Overview

The system has three components:

1. **Event listener** — subscribes to smart contract events via WebSocket RPC
2. **Formatter** — converts raw event data into human-readable post text
3. **Publisher** — posts formatted text to X using the v2 API

Each component is decoupled so you can swap chains, contracts, or output channels independently.

---

## Setting Up the Event Listener

Use ethers.js v6 with a WebSocket provider for real-time event subscriptions. HTTP polling is unreliable for low-latency event detection.

```bash
npm install ethers twitter-api-v2 dotenv
```

```env
RPC_WSS=wss://mainnet.infura.io/ws/v3/YOUR_KEY
CONTRACT_ADDRESS=0x...
X_API_KEY=...
X_API_SECRET=...
X_ACCESS_TOKEN=...
X_ACCESS_SECRET=...
```

Connect to the contract:

```js
import { ethers } from 'ethers';

const provider = new ethers.WebSocketProvider(process.env.RPC_WSS);

const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
];

const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  ERC20_ABI,
  provider
);
```

---

## Subscribing to Events

Filter for large transfers — posting every token transfer is noise:

```js
const WHALE_THRESHOLD = ethers.parseUnits('100000', 18); // 100k tokens

contract.on('Transfer', async (from, to, value, event) => {
  if (value < WHALE_THRESHOLD) return;

  const txHash = event.log.transactionHash;
  const block = await provider.getBlock(event.log.blockNumber);

  await handleWhaleTransfer({ from, to, value, txHash, timestamp: block.timestamp });
});
```

For DeFi protocols, listen to protocol-specific events. For example, Uniswap V3 `Swap` events:

```js
const UNISWAP_V3_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
];
```

---

## Formatting On-Chain Data for X

Translate raw integers and addresses into readable content:

```js
function formatWhaleAlert(event) {
  const amount = Number(ethers.formatUnits(event.value, 18)).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });

  const shortFrom = `${event.from.slice(0, 6)}...${event.from.slice(-4)}`;
  const shortTo = `${event.to.slice(0, 6)}...${event.to.slice(-4)}`;
  const explorerUrl = `https://etherscan.io/tx/${event.txHash}`;

  return [
    `Whale Alert 🐋`,
    ``,
    `${amount} tokens transferred`,
    `From: ${shortFrom}`,
    `To: ${shortTo}`,
    ``,
    `Tx: ${explorerUrl}`,
    ``,
    `#DeFi #Ethereum #WhaleAlert`,
  ].join('\n');
}
```

Keep posts under 280 characters. Etherscan links are shortened by X automatically.

---

## Publishing to X

```js
import { TwitterApi } from 'twitter-api-v2';

const xClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

async function handleWhaleTransfer(event) {
  const text = formatWhaleAlert(event);

  try {
    const { data } = await xClient.v2.tweet(text);
    console.log(`Posted: ${data.id} for tx ${event.txHash}`);
  } catch (err) {
    console.error('Post failed:', err.message);
  }
}
```

---

## Handling WebSocket Reconnection

WebSocket connections drop. Implement automatic reconnection:

```js
async function startListener() {
  try {
    const provider = new ethers.WebSocketProvider(process.env.RPC_WSS);

    provider.websocket.on('close', () => {
      console.warn('WebSocket closed, reconnecting in 5s...');
      setTimeout(startListener, 5000);
    });

    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ERC20_ABI, provider);
    contract.on('Transfer', onTransfer);

    console.log('Listener started');
  } catch (err) {
    console.error('Listener error:', err.message);
    setTimeout(startListener, 5000);
  }
}

startListener();
```

---

## Rate Limiting and Deduplication

On-chain events can fire in rapid succession during network congestion. Use a queue and deduplication by transaction hash:

```js
const posted = new Set();
const queue = [];
let posting = false;

async function enqueue(text, txHash) {
  if (posted.has(txHash)) return;
  posted.add(txHash);
  queue.push(text);
  if (!posting) processQueue();
}

async function processQueue() {
  posting = true;
  while (queue.length > 0) {
    const text = queue.shift();
    await xClient.v2.tweet(text);
    await new Promise(r => setTimeout(r, 2000)); // 2s between posts
  }
  posting = false;
}
```

---

## Conclusion

An on-chain event to X post pipeline is a high-value automation for protocol teams, analytics projects, and whale trackers. The core pattern — WebSocket event subscription, structured formatting, X API v2 posting — is reusable across any EVM chain and any contract. Extend it to support multiple contracts, multiple chains via parallel providers, or route high-priority events to Discord/Telegram in addition to X.
