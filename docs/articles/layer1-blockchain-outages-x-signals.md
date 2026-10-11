# How to Track Layer 1 Blockchain Outages via X Social Signals

**Meta description:** Use X API social signals to detect Layer 1 blockchain outages and network degradation before official status pages update, using filtered stream monitoring and sentiment analysis.

---

## Introduction

Official status pages for Layer 1 blockchains often lag the actual incident by 10 to 30 minutes. X is faster. When Solana's network degrades, validators and developers post about failed transactions and missed slots within seconds. When an Ethereum node provider goes down, complaints surface on X before Infura or Alchemy update their status pages. Building a social signal monitor that processes X data gives your infrastructure team an early warning system that outpaces official channels.

This guide shows you how to detect outage signals on X, correlate them with known accounts, and trigger automated incident response workflows.

---

## The Anatomy of an Outage Signal

Blockchain outage signals on X follow predictable patterns:

- **Direct status reports**: "Solana mainnet is degraded", "BSC transactions are stuck"
- **User complaints with technical context**: "getting BlockNotFound errors", "RPC timeout on all endpoints"
- **Validator/node operator posts**: often contain slot numbers, block heights, or error codes
- **Retweet cascades**: a validator with 5,000 followers posts, dozens retweet within 2 minutes

The combination of technical terminology, high-credibility source accounts, and rapid retweet velocity is a reliable outage signature.

---

## Configuring Stream Rules per L1

Build rules that are specific to each Layer 1's failure vocabulary:

```javascript
// config/l1OutageRules.js
export const L1_OUTAGE_RULES = [
  // Solana
  {
    value: '(solana OR sol) ("network degraded" OR "slot skipping" OR "validator" OR "mainnet down" OR "TPS dropped") -is:retweet lang:en',
    tag: 'solana-outage'
  },
  // Ethereum / EVM
  {
    value: '(ethereum OR "eth mainnet") ("finality" OR "reorg" OR "node sync" OR "RPC down" OR "missed blocks") -is:retweet lang:en',
    tag: 'ethereum-outage'
  },
  // Avalanche
  {
    value: '(avalanche OR avax) ("C-Chain" OR "P-Chain" OR "X-Chain" OR "subnet down" OR "consensus stalled") -is:retweet lang:en',
    tag: 'avalanche-outage'
  },
  // Aptos / Sui
  {
    value: '(aptos OR sui) ("validator" OR "consensus" OR "network halt" OR "epoch stall") -is:retweet lang:en',
    tag: 'aptos-sui-outage'
  },
  // From known validator and infra accounts
  {
    value: 'from:solana OR from:solana_devs OR from:Infura_io OR from:AlchemyPlatform ("outage" OR "degraded" OR "investigating" OR "incident")',
    tag: 'official-infra-status'
  }
];
```

---

## Stream Ingestion and Signal Scoring

Not every matching tweet is a real outage. Apply a scoring model that weights by account authority and signal density.

```javascript
// src/monitors/outageSignalScorer.js

// Pre-load high-authority account IDs (validators, L1 foundations, infra providers)
const AUTHORITY_ACCOUNTS = new Set([
  '1051041938',  // @solana
  '877877877',   // @avalancheavax (example)
  // ... add real IDs
]);

export function scoreSignal(tweetEvent, recentSignals) {
  let score = 0;

  const authorId = tweetEvent.data.author_id;
  const text = tweetEvent.data.text.toLowerCase();
  const tag = tweetEvent.matching_rules?.[0]?.tag ?? '';

  // Authority multiplier
  if (AUTHORITY_ACCOUNTS.has(authorId)) score += 40;

  // Technical specificity increases confidence
  if (/slot|block height|epoch|validator|rpc|finality/.test(text)) score += 20;

  // Outage vocabulary
  if (/down|outage|degraded|stall|halt|stuck|failing/.test(text)) score += 15;

  // Signal density: how many matching tweets in the last 5 minutes
  const recentCount = recentSignals.filter(s => s.tag === tag && Date.now() - s.ts < 300_000).length;
  score += Math.min(recentCount * 5, 25); // cap density bonus at 25

  return score;
}
```

A score above 50 warrants a LOW alert. Above 70: MEDIUM. Above 85: page the on-call team.

---

## Correlating X Signals with RPC Health Checks

Social signals are more useful when correlated with actual RPC probes. When X signal scores climb, immediately probe the chain's RPC endpoints:

```javascript
// src/monitors/rpcHealthCheck.js
export async function probeRpc(rpcUrl, chainId) {
  const start = Date.now();
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000)
    });
    const json = await res.json();
    return {
      healthy: !!json.result,
      latencyMs: Date.now() - start,
      blockNumber: parseInt(json.result, 16)
    };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}
```

When X signal score > 60 AND RPC probe fails → escalate to CRITICAL immediately.

---

## Triggering Incident Response

Wire high-confidence outage signals into PagerDuty or your incident management system:

```javascript
// src/monitors/incidentRouter.js
export async function triggerIncident({ chain, score, sampleTweet, rpcStatus }) {
  const severity = score >= 85 ? 'critical' : score >= 70 ? 'error' : 'warning';

  await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routing_key: process.env.PAGERDUTY_ROUTING_KEY,
      event_action: 'trigger',
      payload: {
        summary: `${chain} network degradation detected via X signals (score: ${score})`,
        severity,
        source: 'x-social-monitor',
        custom_details: {
          sampleTweet,
          rpcHealthy: rpcStatus.healthy,
          rpcLatencyMs: rpcStatus.latencyMs
        }
      }
    })
  });
}
```

---

## Avoiding False Positives

Common noise sources to filter out:

- **Price discussions**: "SOL is down 10%" — add `-price -down% -chart` to rules
- **Scheduled maintenance**: check official accounts for planned downtime announcements
- **Old retweets**: always filter `-is:retweet` and check `created_at` recency
- **Single-source signals**: require at least two independent accounts before escalating

---

## Conclusion

X social signals give you Layer 1 outage detection that beats official status pages by a meaningful margin. The key insight is combining signal scoring (authority accounts + technical vocabulary + temporal density) with active RPC health probes triggered by elevated social signal scores. This dual-signal approach — social + synthetic monitoring — dramatically reduces both false positives and false negatives, giving your infrastructure team an early warning system calibrated to real network failures rather than social noise.
