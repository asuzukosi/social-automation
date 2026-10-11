# Using X API to Track Crypto Conference and Event Announcements

**Meta description:** Learn how to use X API filtered streams and search to automatically track crypto conference announcements, speaker lineups, and event-driven market signals.

---

## Introduction

Crypto conferences are announcement catalysts. Protocol upgrades, partnership reveals, and token launches are routinely timed to Consensus, ETHDenver, Solana Breakpoint, and Bitcoin Miami. Tracking conference-related X activity gives developers early access to pre-announcement signals, speaker commentary, and post-conference sentiment. This guide builds a conference tracking system using X API v2.

---

## The Conference Signal Taxonomy

Conference-related signals on X fall into four categories:

1. **Pre-event hype** — speaker announcements, agenda drops, ticket sales
2. **Live announcements** — mainnet launches, funding rounds, partnership reveals
3. **Developer commentary** — technical talks, code drops, GitHub links
4. **Market reactions** — price commentary tied to specific announcements

Each category requires different stream rules and serves different downstream use cases.

---

## Defining Conference Targets

```js
// conferences.js
export const MAJOR_CONFERENCES = [
  { name: 'consensus', hashtags: ['#Consensus2025', '#Consensus'], account: 'consensus' },
  { name: 'ethdenver', hashtags: ['#ETHDenver', '#ETHDenver2025'], account: 'EthereumDenver' },
  { name: 'breakpoint', hashtags: ['#Breakpoint', '#SolanaBreakpoint'], account: 'solana' },
  { name: 'bitcoin_miami', hashtags: ['#Bitcoin2025', '#BitcoinMiami'], account: 'BTC_Inc' },
  { name: 'token2049', hashtags: ['#TOKEN2049', '#Token2049Dubai'], account: 'Token2049' },
  { name: 'ethcc', hashtags: ['#EthCC', '#EthCC8'], account: 'EthCC' },
  { name: 'devcon', hashtags: ['#Devcon', '#Devcon8'], account: 'EFDevcon' },
];

export function buildHashtagQuery(conf) {
  return conf.hashtags.join(' OR ');
}
```

---

## Stream Rules for Conference Coverage

```js
// conference-rules.js
import { MAJOR_CONFERENCES, buildHashtagQuery } from './conferences.js';

export function buildConferenceRules() {
  const rules = [];

  for (const conf of MAJOR_CONFERENCES) {
    // Primary hashtag stream
    rules.push({
      value: `(${buildHashtagQuery(conf)}) -is:retweet lang:en`,
      tag: `conf_${conf.name}_hashtag`
    });

    // Official account stream
    rules.push({
      value: `from:${conf.account}`,
      tag: `conf_${conf.name}_official`
    });
  }

  // Cross-conference announcement keywords
  rules.push({
    value: [
      '("mainnet launch" OR "announcing" OR "partnership" OR "integration")',
      '(#Consensus2025 OR #ETHDenver OR #Breakpoint OR #Bitcoin2025)',
      '-is:retweet lang:en',
    ].join(' '),
    tag: 'conf_announcements'
  });

  return rules;
}
```

---

## Classifying Conference Tweets

```js
// classifier.js
const ANNOUNCEMENT_TERMS = [
  'announcing', 'launch', 'partnership', 'integration', 'mainnet',
  'testnet', 'funding', 'raise', 'series', 'grant', 'open source'
];

const SPEAKER_TERMS = [
  'speaking', 'presenting', 'keynote', 'panel', 'workshop', 'talk'
];

export function classifyConferenceTweet(text) {
  const t = text.toLowerCase();

  if (ANNOUNCEMENT_TERMS.some(term => t.includes(term))) return 'ANNOUNCEMENT';
  if (SPEAKER_TERMS.some(term => t.includes(term))) return 'SPEAKER_CONTENT';
  if (/\bthread\b|\d+\/\d+/.test(t)) return 'THREAD';
  if (/#[a-zA-Z0-9]+/.test(text) && text.length < 150) return 'GENERAL';
  return 'COVERAGE';
}
```

---

## Database Schema

```sql
CREATE TABLE conference_signals (
  id              BIGSERIAL PRIMARY KEY,
  tweet_id        TEXT UNIQUE NOT NULL,
  conference      TEXT NOT NULL,
  signal_type     TEXT NOT NULL,
  author_id       TEXT NOT NULL,
  username        TEXT,
  text            TEXT NOT NULL,
  cashtags        TEXT[] DEFAULT '{}',
  likes           INT DEFAULT 0,
  retweets        INT DEFAULT 0,
  quotes          INT DEFAULT 0,
  followers       INT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL,
  captured_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conf_name ON conference_signals(conference, created_at DESC);
CREATE INDEX idx_conf_signal ON conference_signals(signal_type, conference, created_at DESC);
CREATE INDEX idx_conf_cashtags ON conference_signals USING GIN(cashtags);
```

---

## Detecting High-Impact Announcements

```js
// detector.js
import { pool } from './db.js';

export async function getTopAnnouncements(conference, hours = 1) {
  const { rows } = await pool.query(`
    SELECT
      tweet_id, username, text, cashtags,
      likes + (retweets * 3) + (quotes * 2) AS engagement_score,
      created_at
    FROM conference_signals
    WHERE conference = $1
      AND signal_type = 'ANNOUNCEMENT'
      AND created_at > now() - ($2 || ' hours')::interval
    ORDER BY engagement_score DESC
    LIMIT 10
  `, [conference, hours]);

  return rows;
}
```

Engagement score weights retweets higher than likes — retweets signal active amplification, not passive approval.

---

## Pre-Conference Speaker Monitoring

Conference alpha often comes from speaker prep tweets, not the talks themselves. Target known speakers:

```js
// Build speaker watch rules from a curated list
export const CRYPTO_SPEAKERS = [
  'VitalikButerin', 'anatoly_yakovenko', 'cz_binance',
  'brian_armstrong', 'hoskinson', 'ljxie', 'drakefjustin'
];

export function buildSpeakerRules(conference) {
  const from = CRYPTO_SPEAKERS.map(h => `from:${h}`).join(' OR ');
  return {
    value: `(${from}) (${buildHashtagQuery(conference)} OR "${conference.name}")`,
    tag: `conf_${conference.name}_speakers`
  };
}
```

---

## Conference Timeline Query

Reconstruct the announcement timeline for any completed conference:

```js
export async function getConferenceTimeline(conference, startDate, endDate) {
  const { rows } = await pool.query(`
    SELECT
      date_trunc('hour', created_at) AS hour,
      signal_type,
      COUNT(*) AS tweet_count,
      SUM(likes) AS total_likes,
      SUM(retweets) AS total_retweets
    FROM conference_signals
    WHERE conference = $1
      AND created_at BETWEEN $2 AND $3
    GROUP BY 1, 2
    ORDER BY 1 ASC, tweet_count DESC
  `, [conference, startDate, endDate]);

  return rows;
}
```

---

## Conclusion

X API conference tracking gives crypto developers structured access to the announcement signals that drive market movements. The implementation requires per-conference hashtag and account rules, server-side classification of announcement versus general coverage, and engagement-weighted scoring to surface high-impact signals. Speaker monitoring in the days before a conference often yields the highest-signal pre-announcement data.
