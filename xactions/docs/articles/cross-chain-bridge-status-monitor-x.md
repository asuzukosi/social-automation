# How to Build a Cross-Chain Bridge Status Monitor with X API

**Meta description:** Learn how to build a real-time cross-chain bridge status monitor using the X API to detect outages, hacks, and liquidity alerts before they hit block explorers.

---

## Introduction

Cross-chain bridges are critical infrastructure — and they're frequently compromised. When Ronin lost $625M or Wormhole lost $320M, X was where the news broke first, often 10–30 minutes before any official post-mortem. If you're running a DeFi protocol, a fund, or an aggregator that depends on bridge liquidity, you need automated monitoring that surfaces bridge status changes the moment they happen.

This guide shows you how to build a Node.js pipeline that streams X data to monitor bridge health across Ethereum, Arbitrum, Optimism, Base, Polygon, and other chains.

---

## Identifying the Right Signal Sources

Before writing code, map the signal graph. Bridge status changes propagate through a predictable set of accounts and keywords:

**Official bridge accounts:** Canonical bridges like Arbitrum Bridge, Optimism Gateway, Hop Protocol, Stargate, Across Protocol, and LayerZero all post incident updates from official handles.

**Security researchers:** `@pcaversaccio`, `@samczsun`, `@tayvano_`, and `@0xfoobar are high-signal sources for exploit detection.

**Keywords to track:**
- `bridge paused`, `bridge halted`, `withdrawals suspended`
- `exploit`, `vulnerability`, `hack`
- `bridge name + "drained"` or `"compromised"`
- Chain-specific: `#Arbitrum`, `#Optimism`, `#Base` combined with incident terms

---

## Setting Up the X Filtered Stream

Use the X API v2 filtered stream to watch for bridge-related posts in real time. You'll need Bearer Token auth and at minimum Basic API access.

```javascript
import { createReadlineInterface } from 'readline';
import fetch from 'node-fetch';

const BEARER_TOKEN = process.env.X_BEARER_TOKEN;

const RULES = [
  { value: 'bridge paused OR bridge halted OR bridge drained lang:en', tag: 'bridge_incident' },
  { value: 'from:LayerZero_Labs OR from:StargateFinance OR from:HopProtocol', tag: 'bridge_official' },
  { value: '(exploit OR hack OR vulnerability) (Arbitrum OR Optimism OR Base OR Polygon) -is:retweet', tag: 'chain_exploit' },
];

async function setStreamRules() {
  // Delete existing rules first
  const existing = await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
    headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
  }).then(r => r.json());

  if (existing.data?.length) {
    const ids = existing.data.map(r => r.id);
    await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BEARER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: { ids } }),
    });
  }

  await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${BEARER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: RULES }),
  });
}

async function connectStream(onTweet) {
  const response = await fetch(
    'https://api.twitter.com/2/tweets/search/stream?tweet.fields=created_at,author_id,entities&expansions=author_id',
    { headers: { Authorization: `Bearer ${BEARER_TOKEN}` } }
  );

  for await (const chunk of response.body) {
    const line = chunk.toString().trim();
    if (!line) continue;
    try {
      const data = JSON.parse(line);
      onTweet(data);
    } catch {}
  }
}
```

---

## Classifying Severity

Not every tweet about a bridge is an incident. Apply a severity classifier before triggering alerts:

```javascript
const CRITICAL_TERMS = ['drained', 'exploited', 'hacked', 'paused withdrawals', 'all funds'];
const WARNING_TERMS = ['vulnerability', 'bug', 'delay', 'congestion', 'slow'];

function classifySeverity(text) {
  const lower = text.toLowerCase();
  if (CRITICAL_TERMS.some(t => lower.includes(t))) return 'CRITICAL';
  if (WARNING_TERMS.some(t => lower.includes(t))) return 'WARNING';
  return 'INFO';
}

function handleTweet({ data, matching_rules, includes }) {
  const severity = classifySeverity(data.text);
  const author = includes?.users?.find(u => u.id === data.author_id);

  if (severity === 'CRITICAL') {
    triggerAlert({
      level: 'CRITICAL',
      text: data.text,
      author: author?.username,
      url: `https://x.com/i/web/status/${data.id}`,
      timestamp: data.created_at,
      rule: matching_rules[0]?.tag,
    });
  }
}
```

---

## Alert Routing and Deduplication

Bridge incidents generate tweet storms. Deduplicate with a Redis set and route to Slack, PagerDuty, or a webhook:

```javascript
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });

async function triggerAlert(alert) {
  const key = `bridge_alert:${Buffer.from(alert.text).toString('base64').slice(0, 32)}`;
  const exists = await redis.get(key);
  if (exists) return; // duplicate

  await redis.setEx(key, 3600, '1'); // deduplicate for 1 hour

  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🚨 *Bridge Alert [${alert.level}]* — @${alert.author}\n${alert.text}\n${alert.url}`,
    }),
  });
}
```

---

## Cross-Referencing with On-Chain Data

X signals are faster but noisier. Cross-reference against on-chain TVL changes to confirm incidents:

```javascript
async function checkBridgeTVL(bridgeAddress, chain) {
  // Use DefiLlama or your own node RPC
  const res = await fetch(`https://api.llama.fi/protocol/${chain}-bridge`);
  const { tvl } = await res.json();
  return tvl;
}

// On CRITICAL alert, snapshot TVL and compare to 1h ago
async function validateWithOnChain(alert) {
  const currentTVL = await checkBridgeTVL(BRIDGE_MAP[alert.rule]);
  const cachedTVL = await redis.get(`tvl:${alert.rule}`);
  const drop = cachedTVL ? ((cachedTVL - currentTVL) / cachedTVL) * 100 : 0;

  if (drop > 10) {
    alert.onChainConfirmed = true;
    alert.tvlDrop = `${drop.toFixed(1)}%`;
  }
  return alert;
}
```

---

## Conclusion

A cross-chain bridge monitor built on X streaming gives you a 10–30 minute head start on incidents compared to waiting for official announcements or block explorer anomaly detection. The architecture is straightforward: filtered stream rules for signal capture, severity classification for noise reduction, Redis deduplication to suppress tweet storms, and optional on-chain TVL cross-referencing for confirmation. Deploy this as a persistent Node.js service on Railway or Fly.io and you'll have 24/7 bridge incident coverage across every major chain.
