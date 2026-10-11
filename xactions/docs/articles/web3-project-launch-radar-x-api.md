# Building a Web3 Project Launch Radar with X Streaming API

**Meta description:** Build a Web3 project launch radar using X Streaming API to detect new protocol launches, token TGEs, NFT drops, and DEX listings in real time with Node.js.

---

## Introduction

The Web3 launch cycle is fast: projects go from announcement to TGE to DEX listing in days. A launch radar built on X Streaming API captures these signals in real time — new protocol announcements, token generation events, NFT collection drops, airdrop reveals, and beta launches. This guide implements a production launch radar with classification, deduplication, and a REST API for downstream consumption.

---

## Launch Signal Taxonomy

Web3 launches on X fall into distinct categories:

| Signal Type | Examples | Urgency |
|-------------|---------|---------|
| `TGE` | Token generation event, token launch, IDO | High |
| `AIRDROP` | Airdrop claim, snapshot, eligibility | High |
| `NFT_DROP` | Mint date, collection reveal, allowlist | Medium |
| `PROTOCOL_LAUNCH` | Mainnet, beta, v2 launch | Medium |
| `DEX_LISTING` | Uniswap listing, Raydium pool | High |
| `FUNDING` | Seed round, Series A, grant | Low |

---

## Stream Rules for Launch Detection

```js
// launch-rules.js
export const LAUNCH_RULES = [
  // TGE signals
  {
    value: '("TGE" OR "token launch" OR "token generation event" OR "IDO opens") has:cashtags -is:retweet lang:en',
    tag: 'launch_tge'
  },
  // Airdrop signals
  {
    value: '("airdrop" OR "claim now" OR "snapshot taken" OR "eligible to claim") has:cashtags -is:retweet lang:en',
    tag: 'launch_airdrop'
  },
  // NFT drops
  {
    value: '("mint is live" OR "minting now" OR "collection drops" OR "allowlist" OR "whitelist opens") -is:retweet lang:en',
    tag: 'launch_nft'
  },
  // Protocol/mainnet launches
  {
    value: '("mainnet is live" OR "mainnet launch" OR "now live on mainnet" OR "v2 launch" OR "beta is live") has:cashtags -is:retweet lang:en',
    tag: 'launch_protocol'
  },
  // DEX listings
  {
    value: '("now trading on" OR "listed on" OR "pool is live") (uniswap OR raydium OR curve OR orca OR pancakeswap) has:cashtags -is:retweet',
    tag: 'launch_dex'
  },
  // Funding announcements
  {
    value: '("raised" OR "funding round" OR "seed round" OR "series A") (web3 OR crypto OR blockchain OR DeFi) has:cashtags -is:retweet lang:en',
    tag: 'launch_funding'
  },
];
```

---

## Stream Handler with Classification

```js
// radar.js
import { startStream } from './stream.js';
import { classifyLaunch, extractLaunchDetails } from './classifier.js';
import { saveLaunch, isDuplicate } from './db.js';

startStream(async (payload) => {
  const tweet = payload.data;
  const user = payload.includes?.users?.[0];
  const tag = payload.matching_rules?.[0]?.tag;

  // Skip low-authority accounts for high-noise categories
  const followers = user?.public_metrics?.followers_count || 0;
  if (tag === 'launch_airdrop' && followers < 500) return;

  const signalType = classifyLaunch(tweet.text, tag);
  const details = extractLaunchDetails(tweet);

  // Deduplication: same project shouldn't trigger multiple alerts
  if (await isDuplicate(details.cashtags, signalType, '30 minutes')) return;

  await saveLaunch({
    tweet_id: tweet.id,
    author_id: tweet.author_id,
    username: user?.username,
    signal_type: signalType,
    rule_tag: tag,
    cashtags: details.cashtags,
    project_name: details.projectName,
    text: tweet.text,
    followers,
    likes: tweet.public_metrics?.like_count || 0,
    retweets: tweet.public_metrics?.retweet_count || 0,
    created_at: tweet.created_at,
  });
});
```

---

## Launch Detail Extraction

```js
// classifier.js
export function classifyLaunch(text, tag) {
  const MAP = {
    'launch_tge': 'TGE',
    'launch_airdrop': 'AIRDROP',
    'launch_nft': 'NFT_DROP',
    'launch_protocol': 'PROTOCOL_LAUNCH',
    'launch_dex': 'DEX_LISTING',
    'launch_funding': 'FUNDING',
  };
  return MAP[tag] || 'GENERAL';
}

export function extractLaunchDetails(tweet) {
  const cashtags = tweet.entities?.cashtags?.map(c => c.tag.toUpperCase()) || [];
  const urls = tweet.entities?.urls?.map(u => u.expanded_url) || [];

  // Extract project name heuristic: text before first cashtag or URL
  const nameMatch = tweet.text.match(/^([A-Z][a-zA-Z0-9\s]{2,30}?)\s+(?:is|\$|has)/);
  const projectName = nameMatch?.[1]?.trim() || cashtags[0] || null;

  return { cashtags, urls, projectName };
}
```

---

## Database Schema

```sql
CREATE TABLE web3_launches (
  id            BIGSERIAL PRIMARY KEY,
  tweet_id      TEXT UNIQUE NOT NULL,
  author_id     TEXT NOT NULL,
  username      TEXT,
  signal_type   TEXT NOT NULL,
  rule_tag      TEXT,
  project_name  TEXT,
  cashtags      TEXT[] DEFAULT '{}',
  text          TEXT NOT NULL,
  urls          TEXT[] DEFAULT '{}',
  followers     INT DEFAULT 0,
  likes         INT DEFAULT 0,
  retweets      INT DEFAULT 0,
  alert_sent    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL,
  captured_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_launch_type ON web3_launches(signal_type, created_at DESC);
CREATE INDEX idx_launch_cashtags ON web3_launches USING GIN(cashtags);
CREATE INDEX idx_launch_pending ON web3_launches(alert_sent, created_at DESC)
  WHERE alert_sent = false;
```

---

## Deduplication Query

```js
// db.js
export async function isDuplicate(cashtags, signalType, window) {
  if (!cashtags.length) return false;

  const { rows } = await pool.query(`
    SELECT id FROM web3_launches
    WHERE cashtags && $1
      AND signal_type = $2
      AND created_at > now() - ($3::interval)
    LIMIT 1
  `, [cashtags, signalType, window]);

  return rows.length > 0;
}
```

The `&&` operator on a GIN-indexed array column checks for any overlap between the incoming cashtags and existing records — efficient even with thousands of rows.

---

## Launch Radar REST API

```js
// routes/launches.js (Express)
app.get('/api/launches', async (req, res) => {
  const { type, hours = 6, min_followers = 1000, limit = 25 } = req.query;

  const { rows } = await pool.query(`
    SELECT tweet_id, username, signal_type, project_name,
           cashtags, text, followers, likes, retweets, created_at
    FROM web3_launches
    WHERE created_at > now() - ($1 || ' hours')::interval
      AND followers >= $2
      ${type ? 'AND signal_type = $3' : ''}
    ORDER BY likes + (retweets * 3) DESC
    LIMIT ${parseInt(limit)}
  `, type ? [hours, min_followers, type] : [hours, min_followers]);

  res.json({ count: rows.length, launches: rows });
});
```

---

## Conclusion

A Web3 launch radar built on X Streaming API captures TGEs, airdrops, NFT drops, protocol launches, and DEX listings as they happen. The critical implementation points are: granular rule tags per launch type, authority filtering by follower count, cashtag-based deduplication within a rolling time window, and a REST API for downstream consumers. This system replaces manual monitoring of dozens of crypto project accounts.
