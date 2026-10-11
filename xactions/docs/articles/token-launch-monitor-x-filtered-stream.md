# Building a Token Launch Monitor with X Filtered Stream

**Meta description:** Build a real-time token launch monitor using X API filtered stream to detect new crypto launches, contract addresses, and stealth drops as they're announced.

---

## Introduction

New token launches are announced on X before they hit any aggregator. The gap between a stealth launch tweet and its appearance on DEX Screener or DexTools is often 5–15 minutes — long enough for significant price movement to occur. A real-time token launch monitor built on X's filtered stream closes that gap. This guide walks through the complete implementation: stream setup, launch signal detection, contract address extraction, and enrichment.

---

## Stream Rule Design

The filtered stream works by matching tweets against a set of rules server-side before delivery. Your rules need to cover the vocabulary of token launches without generating too much noise:

```javascript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi({ bearerToken: process.env.X_BEARER_TOKEN });

const launchRules = [
  {
    value: '("stealth launch" OR "fair launch" OR "just launched" OR "launching now") -is:retweet lang:en',
    tag: 'launch-vocabulary',
  },
  {
    value: '("contract address" OR "CA:" OR "contract:") (erc20 OR bsc OR solana OR "base chain") -is:retweet lang:en',
    tag: 'contract-announcement',
  },
  {
    value: '(presale OR "pre-sale" OR whitelist) ("now live" OR "is open" OR "starts now") -is:retweet lang:en',
    tag: 'presale-launch',
  },
  {
    value: 'site:dexscreener.com OR site:dextools.io -is:retweet',
    tag: 'dex-link',
  },
];

// Delete existing rules first to avoid duplicates
const existing = await client.v2.streamRules();
if (existing.data?.length) {
  await client.v2.updateStreamRules({
    delete: { ids: existing.data.map(r => r.id) },
  });
}

await client.v2.updateStreamRules({ add: launchRules });
```

---

## Opening and Maintaining the Stream

The filtered stream connection drops periodically. Implement exponential backoff reconnection:

```javascript
async function startLaunchStream(onTweet) {
  let attempt = 0;

  async function connect() {
    try {
      const stream = await client.v2.searchStream({
        'tweet.fields': 'created_at,author_id,entities,public_metrics,context_annotations',
        'user.fields': 'public_metrics,created_at,verified',
        expansions: 'author_id',
      });

      stream.on('data', (tweet) => {
        attempt = 0; // Reset backoff on successful data
        onTweet(tweet).catch(console.error);
      });

      stream.on('connection-error', async (err) => {
        console.error('❌ Stream error:', err.message);
        stream.close();
        const delay = Math.min(1000 * 2 ** attempt, 60000);
        attempt++;
        console.log(`🔄 Reconnecting in ${delay}ms`);
        setTimeout(connect, delay);
      });

      stream.on('reconnect-error-limit-exceeded', () => {
        console.error('❌ Reconnect limit exceeded — exiting');
        process.exit(1);
      });

    } catch (err) {
      const delay = Math.min(1000 * 2 ** attempt, 60000);
      attempt++;
      setTimeout(connect, delay);
    }
  }

  connect();
}
```

---

## Contract Address Extraction

Ethereum, Base, and Solana contract addresses have distinct formats. Extract them from tweet text using regex:

```javascript
const CONTRACT_PATTERNS = {
  evm: /0x[a-fA-F0-9]{40}/g,
  solana: /[1-9A-HJ-NP-Za-km-z]{32,44}/g,
};

function extractContracts(text) {
  const evmMatches = [...(text.matchAll(CONTRACT_PATTERNS.evm) ?? [])].map(m => ({
    address: m[0],
    chain: 'evm',
  }));

  // Solana regex is broad — filter by length and character set more strictly
  const solanaMatches = [...(text.matchAll(CONTRACT_PATTERNS.solana) ?? [])]
    .map(m => m[0])
    .filter(addr => addr.length >= 43 && addr.length <= 44) // Solana pubkeys are 44 chars base58
    .map(addr => ({ address: addr, chain: 'solana' }));

  return [...evmMatches, ...solanaMatches];
}
```

EVM addresses are reliable to extract. Solana addresses are base58 strings that can appear in normal text — validate them against an RPC before treating them as legitimate contracts.

---

## Launch Signal Scoring

Not every tweet matching your rules is a real launch. Score each incoming tweet:

```javascript
function scoreLaunchSignal(tweet, matchingTag) {
  let score = 0;

  // Tag priority
  const tagScores = {
    'contract-announcement': 40,
    'dex-link': 35,
    'launch-vocabulary': 20,
    'presale-launch': 15,
  };
  score += tagScores[matchingTag] ?? 0;

  // Contract address present in text
  const contracts = extractContracts(tweet.text);
  if (contracts.length > 0) score += 30;

  // DEX link present
  if (/dexscreener\.com|dextools\.io|birdeye\.so/i.test(tweet.text)) score += 20;

  // Author credibility
  const author = tweet.includes?.users?.[0];
  if (author) {
    if (author.public_metrics.followers_count > 1000) score += 10;
    if (author.public_metrics.followers_count > 10000) score += 15;
    const accountAgeDays = (Date.now() - new Date(author.created_at)) / 86400000;
    if (accountAgeDays > 180) score += 10;
  }

  return { score, contracts };
}
```

Only persist and alert on tweets with a score above your threshold (e.g., 50).

---

## Enrichment with DEX Data

When a contract address is detected, enrich with on-chain data before alerting:

```javascript
async function enrichWithDexData(address, chain) {
  if (chain === 'evm') {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`
    );
    const data = await res.json();
    return data.pairs?.[0] ?? null;
  }
  // Solana: use Birdeye or Jupiter APIs
  return null;
}
```

DexScreener's public API requires no auth and returns pair data, liquidity, and price within seconds of a token being listed.

---

## Storing and Alerting

```javascript
async function handleLaunchTweet(tweet) {
  const tag = tweet.matching_rules?.[0]?.tag;
  const { score, contracts } = scoreLaunchSignal(tweet, tag);

  if (score < 50) return; // Below threshold

  for (const contract of contracts) {
    const dexData = await enrichWithDexData(contract.address, contract.chain);

    await db.tokenLaunch.create({
      data: {
        tweetId: tweet.data.id,
        authorId: tweet.data.author_id,
        contractAddress: contract.address,
        chain: contract.chain,
        signalScore: score,
        liquidityUsd: dexData?.liquidity?.usd ?? null,
        detectedAt: new Date(),
      },
    });

    if (score >= 70) {
      await sendAlert({
        text: `🚀 Token launch detected (score: ${score})\n${contract.address}\n${tweet.data.text.slice(0, 200)}`,
        liquidityUsd: dexData?.liquidity?.usd,
      });
    }
  }
}
```

---

## Conclusion

A token launch monitor built on X's filtered stream gives you first-mover detection on new launches before aggregators index them. The key is layered signal scoring: vocabulary matching alone generates too much noise; combine it with contract address extraction, DEX link detection, and author credibility signals to get a precision-recall balance that's actually useful. Enrich with on-chain data immediately after detection — that's where the actionable intelligence is.
