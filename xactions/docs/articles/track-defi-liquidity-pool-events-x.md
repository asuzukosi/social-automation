# How to Track DeFi Liquidity Pool Events on X

**Meta description:** Monitor DeFi liquidity pool deployments, TVL changes, and pool incentive announcements in real time using X API filtered streams and on-chain data correlation.

---

## Introduction

DeFi liquidity pools are constantly evolving. New pools launch, incentives get added or removed, large LPs enter or exit, and occasionally pools get exploited. Each of these events creates opportunities — or risks — for liquidity providers and traders. The fastest surface for announcements about all of these events is X.

This guide covers building a DeFi liquidity pool event tracker: monitoring protocol announcements, detecting deployment tweets, correlating social signals with on-chain TVL data, and alerting on high-priority events.

---

## Event Types to Track

DeFi LP events on X fall into distinct categories:

**Pool launches** — New trading pairs, new AMM deployments, new concentrated liquidity ranges going live.

**Incentive changes** — Liquidity mining programs starting or ending, gauge weight votes passing on Curve/Balancer, reward token additions.

**Large LP movements** — Whales announcing they're entering or exiting a position, protocol treasuries moving liquidity.

**Exploit and hack alerts** — Rug pulls, flash loan attacks, oracle manipulation. These are the fastest-breaking events on X.

**Protocol upgrades** — Fee tier changes, new fee switch activations, pool migration from V2 to V3.

Each category has distinct keyword patterns and urgency levels.

---

## Stream Rules for DeFi LP Coverage

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

const DEFI_LP_RULES = [
  {
    value: '("liquidity pool" OR "liquidity mining" OR "LP incentives") (launch OR new OR deploy OR live) lang:en -is:retweet',
    tag: 'pool-launches',
  },
  {
    value: '(Uniswap OR Curve OR Balancer OR Aerodrome OR Velodrome) (pool OR gauge OR incentive OR reward) (new OR update OR change) lang:en',
    tag: 'amm-protocols',
  },
  {
    value: '("gauge weight" OR "gauge vote" OR "bribe" OR "veToken") lang:en -is:retweet',
    tag: 'gauge-mechanics',
  },
  {
    value: '("liquidity removed" OR "pool drained" OR "LP exit" OR "impermanent loss") lang:en',
    tag: 'lp-exits',
  },
  {
    value: '(exploit OR hack OR "flash loan" OR "oracle manipulation") (pool OR protocol OR AMM) lang:en',
    tag: 'security-alerts',
  },
  {
    value: '("TVL" OR "total value locked") (drop OR increase OR milestone OR all.time) lang:en -is:retweet',
    tag: 'tvl-events',
  },
];

await client.v2.updateStreamRules({ add: DEFI_LP_RULES });
```

---

## Parsing Pool Deployment Data

Pool launch tweets often contain contract addresses and pair information:

```js
const POOL_PATTERNS = {
  contractAddress: /0x[a-fA-F0-9]{40}/g,
  tokenPair: /([A-Z]{2,8})[\/\-]([A-Z]{2,8})/g,
  feeTier: /(\d+(?:\.\d+)?)\s*(?:bps|%)\s*fee/i,
  tvl: /\$([0-9,.]+[KkMmBb]?)\s+(?:TVL|liquidity)/i,
  apr: /([0-9.]+)\s*%\s+(?:APR|APY)/i,
  rewardToken: /rewarded?\s+in\s+([A-Z]{2,8})/i,
};

function parsePoolEvent(tweetText) {
  const result = {};

  const addresses = tweetText.match(POOL_PATTERNS.contractAddress);
  if (addresses) result.addresses = [...new Set(addresses)];

  const pairs = [...tweetText.matchAll(POOL_PATTERNS.tokenPair)];
  if (pairs.length) {
    result.pairs = pairs.map(m => ({ token0: m[1], token1: m[2] }));
  }

  const feeTier = tweetText.match(POOL_PATTERNS.feeTier);
  if (feeTier) result.feeTier = parseFloat(feeTier[1]);

  const tvl = tweetText.match(POOL_PATTERNS.tvl);
  if (tvl) result.tvlMentioned = parseTvlString(tvl[1]);

  const apr = tweetText.match(POOL_PATTERNS.apr);
  if (apr) result.apr = parseFloat(apr[1]);

  return result;
}

function parseTvlString(str) {
  const num = parseFloat(str.replace(/,/g, ''));
  const suffix = str.slice(-1).toUpperCase();
  if (suffix === 'K') return num * 1_000;
  if (suffix === 'M') return num * 1_000_000;
  if (suffix === 'B') return num * 1_000_000_000;
  return num;
}
```

---

## Correlating X Announcements with On-Chain TVL

When a pool launch is announced, verify it on-chain and pull current TVL:

```js
async function fetchPoolTvl(poolAddress, protocol = 'uniswap-v3') {
  // Use DeFiLlama for protocol-agnostic TVL data
  const response = await fetch(
    `https://api.llama.fi/pool/${poolAddress}`
  );

  if (!response.ok) return null;
  const data = await response.json();

  return {
    tvlUsd: data.tvlUsd,
    apy: data.apy,
    apyBase: data.apyBase,
    apyReward: data.apyReward,
    chain: data.chain,
    project: data.project,
  };
}

async function enrichPoolEvent(parsedTweet) {
  const enriched = { ...parsedTweet };

  for (const address of parsedTweet.addresses ?? []) {
    const tvlData = await fetchPoolTvl(address);
    if (tvlData) {
      enriched.onChainTvl = tvlData.tvlUsd;
      enriched.onChainApy = tvlData.apy;
      enriched.verified = true;
      break;
    }
  }

  return enriched;
}
```

---

## Security Alert Fast Path

Exploit announcements require immediate handling — they can move within minutes of the first tweet:

```js
const EXPLOIT_SIGNALS = [
  /exploit/i, /hack/i, /drained/i, /attacked/i,
  /flash loan/i, /reentrancy/i, /oracle manipulat/i,
  /rugpull/i, /rug pull/i, /exit scam/i,
];

const AMOUNT_PATTERN = /\$([0-9,.]+[KkMmBb]?)\s+(?:stolen|drained|lost|missing)/i;

function classifySecurityEvent(tweetText) {
  const isExploit = EXPLOIT_SIGNALS.some(p => p.test(tweetText));
  if (!isExploit) return null;

  const amountMatch = tweetText.match(AMOUNT_PATTERN);
  const amount = amountMatch ? parseTvlString(amountMatch[1]) : null;

  return {
    type: 'EXPLOIT',
    estimatedLoss: amount,
    severity: amount > 1_000_000 ? 'CRITICAL' : amount > 100_000 ? 'HIGH' : 'MEDIUM',
  };
}

async function handleSecurityAlert(tweet, securityEvent) {
  // Store immediately
  await db.query(
    `INSERT INTO security_events (tweet_id, severity, estimated_loss, detected_at)
     VALUES ($1, $2, $3, NOW())`,
    [tweet.id, securityEvent.severity, securityEvent.estimatedLoss]
  );

  // Alert with no delay for critical events
  if (securityEvent.severity === 'CRITICAL') {
    await sendImmediateAlert({
      type: 'EXPLOIT_DETECTED',
      severity: securityEvent.severity,
      estimatedLoss: securityEvent.estimatedLoss,
      tweetUrl: `https://x.com/i/status/${tweet.id}`,
      tweetText: tweet.text,
    });
  }
}
```

---

## Incentive Program Tracking

Liquidity mining starts and ends affect LP decisions:

```js
async function trackIncentiveProgram(tweet, parsedData) {
  const isStart = /launch|start|begin|new program|introducing/i.test(tweet.text);
  const isEnd = /end|ending|expir|wind down|last week/i.test(tweet.text);
  const isChange = /reduce|increase|adjust|update.*reward/i.test(tweet.text);

  if (!isStart && !isEnd && !isChange) return;

  await db.query(
    `INSERT INTO incentive_events
      (tweet_id, event_type, apr, reward_token, pairs, detected_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [
      tweet.id,
      isStart ? 'START' : isEnd ? 'END' : 'CHANGE',
      parsedData.apr,
      parsedData.rewardToken,
      JSON.stringify(parsedData.pairs ?? []),
    ]
  );
}
```

---

## Database Schema

```sql
CREATE TABLE lp_events (
  id BIGSERIAL PRIMARY KEY,
  tweet_id VARCHAR(30) UNIQUE NOT NULL,
  tweet_text TEXT NOT NULL,
  event_type VARCHAR(30) NOT NULL,  -- 'pool_launch', 'incentive_start', 'exploit', 'tvl_change'
  severity VARCHAR(10) DEFAULT 'NORMAL',
  protocol VARCHAR(50),
  pair VARCHAR(30),
  pool_address VARCHAR(100),
  on_chain_tvl DECIMAL(20, 2),
  on_chain_apy DECIMAL(8, 4),
  estimated_loss DECIMAL(20, 2),
  verified BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON lp_events (event_type, detected_at DESC);
CREATE INDEX ON lp_events (severity, detected_at DESC);
```

---

## Conclusion

DeFi liquidity pool events — launches, incentive changes, exploits — break first on X and move fast. The system described here handles all major event types with a shared ingest layer, event-specific parsers, on-chain verification via DeFiLlama, and a fast path for security alerts. Run the exploit detector at the highest priority; a $10M drain that you catch 10 minutes early is the difference between recovery and catastrophic loss for any LP position.
