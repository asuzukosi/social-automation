# Building a Crypto Airdrop Eligibility Alert System with X API

**Meta description:** Build an automated crypto airdrop eligibility alert system using the X API filtered stream to detect airdrop announcements, snapshot windows, and eligibility criteria in real time.

---

## Introduction

Airdrop windows are short. Projects announce snapshot cutoffs days or hours in advance on X, and users who miss them lose eligibility. Building a system that monitors X for airdrop announcements, extracts eligibility criteria, and delivers targeted alerts means you never miss a distribution for protocols you are already interacting with on-chain.

This guide covers the full pipeline: airdrop signal detection, criteria extraction, wallet eligibility checking, and alert delivery.

---

## What Airdrop Signals Look Like on X

Airdrops follow predictable announcement patterns:

- **Snapshot announcements**: "snapshot will be taken on March 31 at 00:00 UTC"
- **Eligibility criteria**: "all wallets with >100 USDC volume on Arbitrum before block X"
- **Claim portal openings**: "claim.projectname.xyz is now live"
- **Whitelist windows**: "submit your address before Friday"

Projects typically post from their official account first, then the signal propagates through DeFi researchers and airdrop hunters.

---

## Building Airdrop Detection Rules

```javascript
// config/airdropRules.js
export const AIRDROP_RULES = [
  {
    value: '("airdrop" OR "air drop") ("snapshot" OR "eligibility" OR "claim" OR "whitelist") -is:retweet lang:en',
    tag: 'airdrop-general'
  },
  {
    value: '"snapshot" ("block" OR "UTC" OR "cutoff") (airdrop OR distribution OR token) -is:retweet lang:en',
    tag: 'snapshot-announcement'
  },
  {
    value: '"claim" ("airdrop" OR "tokens" OR "allocation") ("now live" OR "is open" OR "available") -is:retweet lang:en',
    tag: 'claim-portal-open'
  },
  {
    value: '("eligible" OR "eligibility") ("wallets" OR "addresses") ("airdrop" OR "distribution") -is:retweet lang:en',
    tag: 'eligibility-criteria'
  },
  {
    value: '("airdrop hunter" OR "retroactive" OR "retro drop") ("criteria" OR "qualify" OR "requirements") -is:retweet lang:en',
    tag: 'airdrop-criteria-discussion'
  }
];
```

---

## Extracting Eligibility Criteria from Tweet Text

Use pattern matching to pull structured data from announcement text:

```javascript
// src/airdrops/criteriaExtractor.js

const SNAPSHOT_DATE_RE = /snapshot\s+(?:on|at|:)?\s*([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})/i;
const BLOCK_NUMBER_RE = /block\s+#?(\d{6,})/i;
const CHAIN_RE = /\b(ethereum|arbitrum|optimism|base|polygon|solana|avalanche|bsc|zksync)\b/gi;
const CLAIM_URL_RE = /https?:\/\/[^\s]*claim[^\s]*/gi;
const MIN_VOLUME_RE = /(?:more than|greater than|at least|>)\s*\$?([\d,]+)\s*(?:USD|USDC|volume)/i;

export function extractCriteria(tweetText) {
  return {
    snapshotDate: SNAPSHOT_DATE_RE.exec(tweetText)?.[1] ?? null,
    snapshotBlock: BLOCK_NUMBER_RE.exec(tweetText)?.[1] ?? null,
    chains: [...new Set((tweetText.match(CHAIN_RE) ?? []).map(c => c.toLowerCase()))],
    claimUrls: tweetText.match(CLAIM_URL_RE) ?? [],
    minVolume: MIN_VOLUME_RE.exec(tweetText)?.[1]?.replace(/,/g, '') ?? null
  };
}
```

---

## Checking Wallet Eligibility Against On-Chain Data

Once you have extracted criteria, check your tracked wallets against on-chain history. Use a subgraph query or direct RPC call depending on the chain.

```javascript
// src/airdrops/eligibilityChecker.js
import fetch from 'node-fetch';

// Example: check a wallet's volume on a Uniswap-style protocol via subgraph
export async function checkSubgraphVolume(walletAddress, subgraphUrl, minVolumeUsd) {
  const query = `{
    swaps(where: { origin: "${walletAddress.toLowerCase()}" }) {
      amountUSD
      timestamp
    }
  }`;

  const res = await fetch(subgraphUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const { data } = await res.json();
  const totalVolume = (data?.swaps ?? []).reduce(
    (sum, swap) => sum + parseFloat(swap.amountUSD),
    0
  );

  return {
    eligible: totalVolume >= parseFloat(minVolumeUsd),
    volumeUsd: totalVolume.toFixed(2)
  };
}
```

---

## Alert Delivery with Wallet Context

When eligibility is confirmed, deliver an alert that includes the specific wallet, the criteria met, and a direct link to the claim portal.

```javascript
// src/airdrops/alertDelivery.js
export async function sendAirdropAlert({ wallet, project, criteria, claimUrl, telegramChatId }) {
  const message = [
    `🪂 *Airdrop Alert: ${project}*`,
    `Wallet: \`${wallet}\``,
    criteria.snapshotDate ? `Snapshot: ${criteria.snapshotDate}` : '',
    criteria.chains.length ? `Chains: ${criteria.chains.join(', ')}` : '',
    claimUrl ? `[Claim Now](${claimUrl})` : ''
  ].filter(Boolean).join('\n');

  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: telegramChatId,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: false
    })
  });
}
```

---

## Managing a Wallet Watchlist

Store tracked wallets in your database and query them per alert:

```javascript
// src/airdrops/walletWatchlist.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function getTrackedWallets(chain) {
  return prisma.watchedWallet.findMany({
    where: { chains: { has: chain }, active: true }
  });
}

export async function addWallet(address, chains, userId) {
  return prisma.watchedWallet.upsert({
    where: { address },
    create: { address, chains, userId, active: true },
    update: { chains, active: true }
  });
}
```

---

## Filtering Out Scam Airdrops

A significant percentage of "airdrop" tweets are scams. Apply basic filters:

- Require the source account to be at least 90 days old
- Flag tweets where the claim URL domain was registered within 7 days
- Deprioritize accounts with follower:following ratio below 0.3
- Cross-reference the project name against your verified project database before running eligibility checks

---

## Conclusion

An X API-powered airdrop alert system compresses the time between announcement and action to near zero. The critical components are: airdrop detection rules tuned to announcement vocabulary, structured criteria extraction from free-form tweet text, on-chain eligibility verification against your tracked wallets, and fast alert delivery with enough context to act immediately. Add scam filtering as a mandatory gate to avoid burning API quota and user attention on fraudulent drops.
