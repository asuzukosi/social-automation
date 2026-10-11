# Building a Solana Ecosystem Tracker with X API

**Meta description:** Step-by-step guide for crypto developers to build a real-time Solana ecosystem tracker using X API v2 streams, cashtag filtering, and Node.js with PostgreSQL.

---

## Introduction

Solana's ecosystem moves fast: new DEX launches, protocol exploits, validator updates, and token listings often surface on X before any official announcement. Building a Solana ecosystem tracker lets you aggregate signals from developers, validators, protocols, and community accounts into a single structured feed. This guide walks through implementing one with X API v2.

---

## Defining the Signal Scope

Solana ecosystem coverage requires four distinct signal categories:

1. **Protocol activity** — Marinade, Jito, Kamino, Drift, Jupiter updates
2. **Infrastructure** — validator performance, RPC outages, network congestion
3. **Token launches** — new SPL tokens, Raydium/Orca listings
4. **Developer signals** — Anchor releases, Solana CLI updates, SDK changes

Each category needs separate stream rules so you can route signals to different consumers.

---

## Stream Rule Configuration

```js
// solana-rules.js
export const SOLANA_RULES = [
  // Ecosystem cashtag + project names
  {
    value: '$SOL ($JUP OR $JTO OR $MNDE OR $DRIFT OR $KAMINO) -is:retweet lang:en',
    tag: 'sol_defi_tokens'
  },
  // Infrastructure signals
  {
    value: '(solana OR #solana) (outage OR congestion OR "validator" OR "RPC" OR "mainnet") -is:retweet',
    tag: 'sol_infra'
  },
  // Core developer accounts
  {
    value: 'from:aeyakovenko OR from:armaniferrante OR from:rajgokal $SOL OR solana',
    tag: 'sol_core_devs'
  },
  // New token/IDO signals
  {
    value: '(solana OR SPL) ("new token" OR "token launch" OR IDO OR "fair launch") -is:retweet',
    tag: 'sol_launches'
  },
];
```

---

## Setting Stream Rules via API

```js
// set-rules.js
import axios from 'axios';
import { SOLANA_RULES } from './solana-rules.js';

const headers = { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` };
const BASE = 'https://api.twitter.com/2/tweets/search/stream/rules';

export async function applyRules() {
  // Delete existing rules first
  const existing = await axios.get(BASE, { headers });
  const ids = existing.data.data?.map(r => r.id) || [];
  if (ids.length) {
    await axios.post(BASE, { delete: { ids } }, { headers });
  }

  // Add new rules
  const res = await axios.post(BASE, { add: SOLANA_RULES }, { headers });
  console.log('Rules applied:', res.data.data.length);
}
```

---

## Processing and Enriching the Stream

```js
// tracker.js
import { startStream } from './stream.js';
import { classifySolanaSignal } from './classifier.js';
import { saveEvent } from './db.js';

startStream(async (payload) => {
  const tweet = payload.data;
  const user = payload.includes?.users?.[0];
  const tag = payload.matching_rules?.[0]?.tag;

  const signal = classifySolanaSignal(tweet.text, tag);

  await saveEvent({
    tweet_id: tweet.id,
    author_id: tweet.author_id,
    username: user?.username,
    text: tweet.text,
    signal_type: signal,
    rule_tag: tag,
    followers: user?.public_metrics?.followers_count || 0,
    created_at: tweet.created_at,
  });
});
```

```js
// classifier.js
export function classifySolanaSignal(text, tag) {
  if (tag === 'sol_infra') {
    if (/outage|down|degraded/.test(text.toLowerCase())) return 'OUTAGE';
    return 'INFRA_UPDATE';
  }
  if (tag === 'sol_launches') return 'TOKEN_LAUNCH';
  if (tag === 'sol_core_devs') return 'CORE_DEV';
  return 'ECOSYSTEM_GENERAL';
}
```

---

## Database Schema

```sql
CREATE TABLE solana_signals (
  id           BIGSERIAL PRIMARY KEY,
  tweet_id     TEXT UNIQUE NOT NULL,
  author_id    TEXT NOT NULL,
  username     TEXT,
  text         TEXT NOT NULL,
  signal_type  TEXT NOT NULL,
  rule_tag     TEXT,
  followers    INT DEFAULT 0,
  likes        INT DEFAULT 0,
  retweets     INT DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL,
  captured_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sol_signal_type ON solana_signals(signal_type, created_at DESC);
CREATE INDEX idx_sol_outages ON solana_signals(signal_type, created_at DESC)
  WHERE signal_type = 'OUTAGE';
```

The partial index on outages makes it fast to surface the most recent network incidents without scanning the full table.

---

## Building a Summary API

Expose a summary endpoint so downstream systems can consume aggregated signals:

```js
// api.js (Express route)
app.get('/api/solana/signals', async (req, res) => {
  const { signal_type, hours = 24, limit = 50 } = req.query;

  const query = `
    SELECT tweet_id, username, text, signal_type, rule_tag,
           likes, retweets, created_at
    FROM solana_signals
    WHERE created_at > now() - ($1 || ' hours')::interval
    ${signal_type ? 'AND signal_type = $2' : ''}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const params = signal_type ? [hours, signal_type] : [hours];
  const { rows } = await pool.query(query, params);
  res.json({ count: rows.length, signals: rows });
});
```

---

## Monitoring Validator and RPC Health

For infrastructure signals, cross-reference tweet text with on-chain data from the Solana RPC:

```js
import { Connection } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

async function checkNetworkHealth() {
  const slot = await connection.getSlot();
  const perfSamples = await connection.getRecentPerformanceSamples(5);
  const avgTPS = perfSamples.reduce((a, b) => a + b.numTransactions / b.samplePeriodSecs, 0) / perfSamples.length;

  return { slot, avgTPS: Math.round(avgTPS) };
}
```

If the TPS drops below 1000 simultaneously with OUTAGE signals appearing in the stream, you have a high-confidence network incident.

---

## Conclusion

A Solana ecosystem tracker built on X API v2 gives you structured, real-time visibility into protocol updates, network incidents, token launches, and developer announcements. The architecture — scoped rules, server-side classification, PostgreSQL storage, and a summary API — scales to cover the full Solana ecosystem without manual monitoring. Extend it by wiring outage signals to PagerDuty or routing token launch signals to a Telegram bot.
