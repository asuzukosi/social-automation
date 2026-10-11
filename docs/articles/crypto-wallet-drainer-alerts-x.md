# How to Use X API to Monitor Crypto Wallet Drainer Alerts

**Meta description:** Learn how to build a real-time crypto wallet drainer alert system using the X API, filtering for exploit signals and on-chain threat intelligence.

---

## Introduction

Wallet drainers are one of the fastest-moving threats in crypto. When a drainer contract goes live, the first alerts almost always surface on X — from security researchers, on-chain monitors like Cyvers and PeckShield, and community members watching for suspicious approvals. Building an automated system that ingests these signals and routes them to your infrastructure can shave critical minutes off incident response time.

This guide shows you how to wire up an X API filtered stream to detect wallet drainer mentions in real time, enrich those signals, and push actionable alerts to your team.

---

## Understanding the Threat Signal on X

Security accounts post drainer alerts using consistent language patterns. Common signal keywords include:

- `wallet drainer`
- `drainer contract`
- `revoke approval`
- `phishing site detected`
- `$ADDRESS drained`
- `SCAM WARNING` combined with contract addresses

Accounts like `@CertiKAlert`, `@PeckShieldAlert`, `@Cyvers_`, `@realScamSniffer`, and `@wallet_guard` are reliable signal sources. Filtering by these accounts combined with keyword rules gives you high signal-to-noise.

---

## Setting Up the X API Filtered Stream

The filtered stream endpoint (`POST /2/tweets/search/stream/rules`, `GET /2/tweets/search/stream`) lets you define rules that run server-side. You pay no polling cost — tweets matching your rules are pushed to your connection.

```javascript
// src/alerts/walletDrainerStream.js
import fetch from 'node-fetch';

const BEARER_TOKEN = process.env.X_BEARER_TOKEN;

const DRAINER_RULES = [
  {
    value: '(wallet drainer OR drainer contract OR "revoke approval") lang:en -is:retweet',
    tag: 'drainer-general'
  },
  {
    value: 'from:PeckShieldAlert OR from:CertiKAlert OR from:Cyvers_ (drain OR exploit OR phish)',
    tag: 'drainer-security-accounts'
  },
  {
    value: '"SCAM" "0x" has:links -is:retweet',
    tag: 'drainer-contract-address'
  }
];

async function addRules() {
  const response = await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ add: DRAINER_RULES })
  });
  return response.json();
}

async function startStream(onTweet) {
  const stream = await fetch(
    'https://api.twitter.com/2/tweets/search/stream?tweet.fields=created_at,author_id,entities&expansions=author_id',
    {
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` }
    }
  );

  for await (const chunk of stream.body) {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.data) onTweet(data);
      } catch (_) {}
    }
  }
}

export { addRules, startStream };
```

---

## Extracting Contract Addresses and URLs from Tweets

Raw tweet text often contains Ethereum addresses or suspicious URLs. Parse these immediately for downstream enrichment.

```javascript
// src/alerts/extractors.js
const ETH_ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;
const URL_RE = /https?:\/\/[^\s]+/g;

export function extractSignals(tweetText) {
  const addresses = tweetText.match(ETH_ADDRESS_RE) ?? [];
  const urls = tweetText.match(URL_RE) ?? [];
  return { addresses, urls };
}
```

Once you have addresses, you can query on-chain data (Etherscan, Alchemy, or your own node) to check if the contract has been flagged or holds suspicious patterns like approval calls in the constructor.

---

## Routing Alerts to Your Team

Push alerts to Slack, PagerDuty, or Telegram. For high-severity signals (e.g., a known security account tweets with a contract address), escalate immediately.

```javascript
// src/alerts/router.js
import { extractSignals } from './extractors.js';

export async function routeAlert(tweetData, slackWebhookUrl) {
  const text = tweetData.data.text;
  const { addresses, urls } = extractSignals(text);

  const payload = {
    text: `🚨 *Wallet Drainer Alert*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Tweet:* ${text}\n*Addresses:* ${addresses.join(', ') || 'none'}\n*URLs:* ${urls.join(', ') || 'none'}`
        }
      }
    ]
  };

  await fetch(slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
```

---

## Deduplication and Rate Limiting Considerations

The same drainer event will often trigger dozens of tweets within minutes. Use a Redis SET with a TTL to deduplicate by contract address:

```javascript
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });

export async function isNewAlert(address) {
  const key = `drainer:seen:${address}`;
  const exists = await redis.get(key);
  if (exists) return false;
  await redis.set(key, '1', { EX: 3600 }); // 1-hour dedup window
  return true;
}
```

X's filtered stream has a cap of 25 rules on the Basic tier and 1,000 on Pro. Design your rules to be broad enough to catch variants but narrow enough to avoid noise flooding your dedup store.

---

## Conclusion

An X-powered wallet drainer alert pipeline gives your team real-time threat intelligence that on-chain monitors alone miss — phishing site links, community warnings, and social proof of exploit activity surface on X before they appear in most security dashboards. Combine the filtered stream with contract address extraction, Redis deduplication, and Slack routing to build a lightweight but effective early-warning system. The critical path is stream → extract → deduplicate → route, and every component here is under 50 lines of production-ready ESM code.
