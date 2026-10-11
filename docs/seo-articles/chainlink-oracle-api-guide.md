---
title: "Chainlink Oracle API Guide: On-Chain Price Feeds (2026)"
meta_description: "How to use Chainlink price feeds, VRF random numbers, and CCIP cross-chain messaging in smart contracts and off-chain applications."
keywords: "Chainlink API, Chainlink price feed, Chainlink oracle, Chainlink VRF, on-chain price feed"
---

# Chainlink Oracle API Guide: On-Chain Price Feeds (2026)

Chainlink is the dominant oracle network, providing tamper-proof price feeds, verifiable randomness, and cross-chain messaging used by $50B+ in DeFi protocols.

## Price Feeds

### Read On-Chain (Smart Contract)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract PriceConsumer {
    AggregatorV3Interface internal priceFeed;

    constructor() {
        // ETH/USD on Ethereum Mainnet
        priceFeed = AggregatorV3Interface(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);
    }

    function getLatestPrice() public view returns (int) {
        (, int price, , , ) = priceFeed.latestRoundData();
        return price / 1e8; // 8 decimals
    }
}
```

### Read Off-Chain (ethers.js)

```javascript
const FEEDS = {
  'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b',
  'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  'SOL/USD': '0x4ffC43a60e009B551865A93d232E33Fce9f01507'
};

const abi = ['function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'];

async function getChainlinkPrice(pair) {
  const feed = new ethers.Contract(FEEDS[pair], abi, provider);
  const { answer, updatedAt } = await feed.latestRoundData();
  return {
    price: Number(answer) / 1e8,
    updatedAt: new Date(Number(updatedAt) * 1000)
  };
}
```

### Historical Rounds

```javascript
async function getHistoricalPrice(feedAddress, roundId) {
  const feed = new ethers.Contract(feedAddress, abi, provider);
  const { answer, startedAt } = await feed.getRoundData(roundId);
  return { price: Number(answer) / 1e8, timestamp: new Date(Number(startedAt) * 1000) };
}
```

## Chainlink VRF (Verifiable Random Function)

```solidity
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2Plus.sol";

contract RandomLottery is VRFConsumerBaseV2Plus {
    uint256 public lastRandomWord;

    constructor(address vrfCoordinator) VRFConsumerBaseV2Plus(vrfCoordinator) {}

    function requestRandomNumber() external returns (uint256 requestId) {
        return s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: 0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae,
                subId: SUBSCRIPTION_ID,
                requestConfirmations: 3,
                callbackGasLimit: 100000,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({ nativePayment: false }))
            })
        );
    }

    function fulfillRandomWords(uint256, uint256[] calldata randomWords) internal override {
        lastRandomWord = randomWords[0];
    }
}
```

## Chainlink CCIP (Cross-Chain)

```solidity
import "@chainlink/contracts-ccip/src/v0.8/CCIPReceiver.sol";

contract CrossChainReceiver is CCIPReceiver {
    string public lastMessage;

    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        lastMessage = abi.decode(message.data, (string));
    }
}
```

## Data Feeds Directory

All available feeds: [data.chain.link](https://data.chain.link)

Key categories:
- **Crypto/USD** — BTC, ETH, SOL, LINK, AVAX, MATIC, and 200+ more
- **Forex** — EUR/USD, GBP/USD, JPY/USD
- **Commodities** — XAU/USD (gold), XAG/USD (silver), crude oil
- **Equities** — TSLA, AAPL (on some chains)
- **Proof of Reserve** — verify exchange/bridge collateral
