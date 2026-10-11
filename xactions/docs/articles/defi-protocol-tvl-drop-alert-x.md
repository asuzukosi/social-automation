# How to Build a DeFi Protocol TVL Drop Alert with X API

**Meta description:** Build a DeFi TVL drop alert system that combines DefiLlama on-chain data with X API social signals to detect protocol risk events before they fully materialize.

---

## Introduction

A sudden TVL drop in a DeFi protocol is one of the clearest risk signals in crypto. When liquidity providers pull funds en masse, it often precedes a broader crisis: a discovered exploit, a team exit, a competitor launch siphoning users, or a governance failure. The best early warning comes from combining two data sources — DefiLlama or direct on-chain TVL data, and X API social signals from researchers and LPs posting about what they are observing. This guide shows you how to build that dual-signal alert system.

---

## Data Source Architecture

```
DefiLlama API (TVL polling)
        │
        ├── Detect TVL drop > threshold
        │
        ▼
Trigger X API search for protocol mentions
        │
        ├── Classify sentiment and signal type
        │
        ▼
Compose alert with both on-chain and social context
        │
        ▼
Route to Slack / PagerDuty / Telegram
```

Polling TVL every 10 to 15 minutes is sufficient — DefiLlama updates most protocols at that cadence, and TVL drops large enough to matter don't happen instantaneously.

---

## Fetching TVL from DefiLlama

```javascript
// src/defi/tvlFetcher.js

const DEFILLAMA_BASE = 'https://api.llama.fi';

export async function getProtocolTvl(protocolSlug) {
  const res = await fetch(`${DEFILLAMA_BASE}/protocol/${protocolSlug}`);
  const json = await res.json();

  // Current TVL
  const currentTvl = json.currentChainTvls
    ? Object.values(json.currentChainTvls).reduce((sum, v) => sum + v, 0)
    : json.tvl?.at(-1)?.totalLiquidityUSD ?? 0;

  // TVL 24h ago
  const dayAgo = Date.now() / 1000 - 86400;
  const historical = json.tvl ?? [];
  const snapshot24h = historical.findLast(p => p.date <= dayAgo);
  const tvl24hAgo = snapshot24h?.totalLiquidityUSD ?? currentTvl;

  const dropPercent = ((tvl24hAgo - currentTvl) / tvl24hAgo) * 100;

  return {
    protocol: json.name,
    slug: protocolSlug,
    currentTvl,
    tvl24hAgo,
    dropPercent: +dropPercent.toFixed(2),
    chains: Object.keys(json.currentChainTvls ?? {})
  };
}

export async function getAllProtocolSlugs() {
  const res = await fetch(`${DEFILLAMA_BASE}/protocols`);
  const protocols = await res.json();
  return protocols.map(p => ({ name: p.name, slug: p.slug, tvl: p.tvl }));
}
```

---

## Defining Alert Thresholds

Different protocols warrant different thresholds. A $50M protocol dropping 15% TVL in 24h is significant. A $5B protocol dropping 5% may be routine rebalancing.

```javascript
// config/tvlAlertThresholds.js
export const TVL_THRESHOLDS = [
  { maxTvlUsd: 10_000_000,  dropPercentAlert: 20, severity: 'HIGH' },
  { maxTvlUsd: 100_000_000, dropPercentAlert: 15, severity: 'HIGH' },
  { maxTvlUsd: 500_000_000, dropPercentAlert: 10, severity: 'MEDIUM' },
  { maxTvlUsd: Infinity,    dropPercentAlert: 7,  severity: 'LOW' }
];

export function getSeverity(tvlData) {
  if (tvlData.dropPercent <= 0) return null; // TVL increased or flat

  const threshold = TVL_THRESHOLDS.find(t => tvlData.currentTvl <= t.maxTvlUsd);
  if (!threshold) return null;

  if (tvlData.dropPercent >= threshold.dropPercentAlert) return threshold.severity;
  return null;
}
```

---

## Querying X for Protocol Context

When a TVL drop triggers an alert, immediately search X for recent mentions to provide social context:

```javascript
// src/defi/xContextFetcher.js
import fetch from 'node-fetch';

const BEARER = process.env.X_BEARER_TOKEN;

export async function fetchProtocolMentions(protocolName, hoursBack = 6) {
  const startTime = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  // Build query — escape the protocol name for use in search
  const query = `"${protocolName}" (TVL OR liquidity OR withdraw OR exploit OR rug OR hack OR drain) -is:retweet lang:en`;

  const url = new URL('https://api.twitter.com/2/tweets/search/recent');
  url.searchParams.set('query', query);
  url.searchParams.set('start_time', startTime);
  url.searchParams.set('max_results', '50');
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username,public_metrics');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${BEARER}` } });
  const json = await res.json();
  return json.data ?? [];
}
```

---

## Classifying Social Signal Type

Parse the retrieved tweets to understand why the TVL is dropping:

```javascript
// src/defi/signalClassifier.js
const SIGNAL_PATTERNS = {
  EXPLOIT: /exploit|hack|drained|vulnerability|attack|reentrancy/i,
  EXIT_SCAM: /rug|exit scam|dev left|team gone|abandoned/i,
  LIQUIDITY_MIGRATION: /migrating to|moving to|better yield|higher apy|bridge/i,
  MARKET_REACTION: /market down|bear|crash|risk off/i,
  GOVERNANCE: /governance|proposal|vote|multisig/i
};

export function classifySignals(tweets) {
  const signals = { EXPLOIT: 0, EXIT_SCAM: 0, LIQUIDITY_MIGRATION: 0, MARKET_REACTION: 0, GOVERNANCE: 0 };

  for (const tweet of tweets) {
    for (const [signal, pattern] of Object.entries(SIGNAL_PATTERNS)) {
      if (pattern.test(tweet.text)) signals[signal]++;
    }
  }

  // Return dominant signal type
  const dominant = Object.entries(signals).sort(([, a], [, b]) => b - a)[0];
  return dominant[1] > 0 ? { type: dominant[0], count: dominant[1] } : { type: 'UNKNOWN', count: 0 };
}
```

---

## Composing and Routing the Alert

```javascript
// src/defi/alertComposer.js
export async function sendTvlAlert({ tvlData, severity, socialSignal, sampleTweets }, slackWebhookUrl) {
  const tvlFormatted = (n) => `$${(n / 1_000_000).toFixed(1)}M`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🚨 TVL Drop Alert: ${tvlData.protocol}* [${severity}]\n` +
              `TVL: ${tvlFormatted(tvlData.currentTvl)} (was ${tvlFormatted(tvlData.tvl24hAgo)} 24h ago)\n` +
              `Drop: *${tvlData.dropPercent}%*\n` +
              `Social Signal: *${socialSignal.type}* (${socialSignal.count} tweets)\n` +
              `Chains: ${tvlData.chains.join(', ')}`
      }
    }
  ];

  if (sampleTweets.length) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Sample tweet:* ${sampleTweets[0].text.slice(0, 280)}` }
    });
  }

  await fetch(slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks })
  });
}
```

---

## Running the Monitor

```javascript
// src/defi/tvlMonitor.js
import { getProtocolTvl } from './tvlFetcher.js';
import { getSeverity } from '../../config/tvlAlertThresholds.js';
import { fetchProtocolMentions } from './xContextFetcher.js';
import { classifySignals } from './signalClassifier.js';
import { sendTvlAlert } from './alertComposer.js';

const WATCH_PROTOCOLS = ['uniswap', 'aave', 'compound', 'curve', 'lido'];

export async function runTvlMonitor() {
  for (const slug of WATCH_PROTOCOLS) {
    const tvlData = await getProtocolTvl(slug);
    const severity = getSeverity(tvlData);

    if (!severity) continue;

    const mentions = await fetchProtocolMentions(tvlData.protocol);
    const socialSignal = classifySignals(mentions);

    await sendTvlAlert(
      { tvlData, severity, socialSignal, sampleTweets: mentions.slice(0, 3) },
      process.env.SLACK_WEBHOOK_URL
    );

    await new Promise(r => setTimeout(r, 2000)); // Rate limit courtesy delay
  }
}
```

---

## Conclusion

Combining DefiLlama's TVL data with X API social signal context gives you a richer alert than either source provides alone. An on-chain TVL drop is a fact; the X signal context tells you the likely cause — whether that is a known exploit being discussed by security researchers, migration to a competitor, or organic market-driven deleveraging. That distinction determines the appropriate response, from emergency governance action to a calm portfolio rebalancing decision. The pipeline described here can monitor dozens of protocols with minimal infrastructure cost and delivers alerts that are actionable from first receipt.
