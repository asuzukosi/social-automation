# Using X API for Crypto Venture Capital Deal Flow Monitoring

**Meta description:** Build an automated crypto VC deal flow monitor using the X API to track funding announcements, investor signals, and portfolio company activity in real time.

---

## Introduction

Crypto VC deal flow moves fast and leaks early on X. Before a raise is announced in a press release or Crunchbase entry, the signals are already there: a founder changing their bio to include a fund name, an investor tweeting vague excitement about a new portfolio company, or a project announcing a "strategic partnership" that turns out to be a Series A. If you're a fund analyst, LP, or competing founder, catching these signals early is a competitive edge.

This guide walks through building a Node.js pipeline that monitors X for crypto funding signals, extracts structured deal data, and feeds it into a deal tracking database.

---

## Signal Taxonomy for Crypto Fundraising

Not all signals are equal. Categorize what you're looking for:

**Tier 1 — High confidence:**
- Explicit announcements: "We raised $X from [Fund]"
- Quote tweets from known investors announcing portfolio additions
- Bio changes combining "backed by [Fund]" patterns

**Tier 2 — Medium confidence:**
- Investor accounts following new crypto projects (detectable via follower change APIs)
- Founders posting "excited to share something big" with investor replies
- New token launches mentioning "seed investors" or "strategic backers"

**Tier 3 — Weak signals:**
- Increased posting frequency from a project account
- New domain registration combined with X account creation (requires external enrichment)

---

## Building the Account Watch List

Start by compiling the accounts to monitor. For crypto VC, you want:

```javascript
const VC_ACCOUNTS = [
  'a16zcrypto', 'paradigm', 'multicoin', 'panteracapital',
  'dragonfly_xyz', 'haun', 'sparkcapital', 'coinbase_ventures',
  'binancelabs', 'animocabrands', 'polychain', 'framework_vc',
];

const ANGEL_INVESTORS = [
  'balajis', 'naval', 'Bookai1', 'muneeb', 'ljxie',
];

async function resolveUserIds(usernames) {
  const chunks = [];
  for (let i = 0; i < usernames.length; i += 100) {
    chunks.push(usernames.slice(i, i + 100));
  }

  const ids = [];
  for (const chunk of chunks) {
    const res = await fetch(
      `https://api.twitter.com/2/users/by?usernames=${chunk.join(',')}&user.fields=id,name,public_metrics`,
      { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
    );
    const { data } = await res.json();
    ids.push(...data.map(u => ({ id: u.id, username: u.username })));
  }
  return ids;
}
```

---

## Streaming Deal Announcements

Use the filtered stream with rules targeting investment-specific language:

```javascript
const DEAL_FLOW_RULES = [
  {
    value: '(raised OR "closed our" OR "seed round" OR "series a" OR "series b") (crypto OR web3 OR DeFi OR blockchain) -is:retweet',
    tag: 'raise_announcement'
  },
  {
    value: '("excited to back" OR "thrilled to invest" OR "new portfolio" OR "proud to announce") (crypto OR web3) -is:retweet',
    tag: 'investor_announcement'
  },
  {
    value: '("strategic investors" OR "lead investor" OR "participated in") (million OR $) crypto -is:retweet',
    tag: 'deal_detail'
  },
];
```

For monitoring specific VCs' own posts, use the timeline API on a schedule:

```javascript
async function pollVCTimelines(vcIds) {
  const results = [];

  for (const { id, username } of vcIds) {
    const res = await fetch(
      `https://api.twitter.com/2/users/${id}/tweets?max_results=10&tweet.fields=created_at,entities&exclude=retweets`,
      { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
    );
    const { data: tweets } = await res.json();

    for (const tweet of tweets ?? []) {
      if (isDealTweet(tweet.text)) {
        results.push({ vc: username, tweet });
      }
    }

    await new Promise(r => setTimeout(r, 1000)); // respect rate limits
  }

  return results;
}

function isDealTweet(text) {
  const patterns = [/excited to (back|invest|announce)/i, /portfolio company/i, /raised \$\d/i, /seed|series [ab]/i];
  return patterns.some(p => p.test(text));
}
```

---

## Extracting Structured Deal Data

Raw tweet text needs parsing to become actionable deal data:

```javascript
function extractDealData(text) {
  const amountMatch = text.match(/\$(\d+(?:\.\d+)?)\s*(m|million|k|thousand|b|billion)?/i);
  const roundMatch = text.match(/\b(pre-seed|seed|series [a-c]|strategic)\b/i);
  const investorMatch = text.match(/(?:led by|from|backed by)\s+(@?\w+)/i);

  return {
    amount: amountMatch ? parseAmount(amountMatch[1], amountMatch[2]) : null,
    round: roundMatch ? roundMatch[1].toLowerCase() : null,
    leadInvestor: investorMatch ? investorMatch[1] : null,
    rawText: text,
    extractedAt: new Date().toISOString(),
  };
}

function parseAmount(num, unit) {
  const n = parseFloat(num);
  const multipliers = { m: 1e6, million: 1e6, k: 1e3, thousand: 1e3, b: 1e9, billion: 1e9 };
  return n * (multipliers[unit?.toLowerCase()] ?? 1);
}
```

---

## Storing and Querying Deal Flow

Persist deals to PostgreSQL via Prisma for querying and deduplication:

```javascript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function saveDeal(tweetId, dealData, authorUsername) {
  return prisma.dealSignal.upsert({
    where: { tweetId },
    update: {},
    create: {
      tweetId,
      authorUsername,
      amount: dealData.amount,
      round: dealData.round,
      leadInvestor: dealData.leadInvestor,
      rawText: dealData.rawText,
      detectedAt: new Date(),
    },
  });
}

// Query recent raises above $5M
async function getRecentDeals(minAmount = 5_000_000) {
  return prisma.dealSignal.findMany({
    where: { amount: { gte: minAmount }, detectedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    orderBy: { detectedAt: 'desc' },
  });
}
```

---

## Conclusion

Crypto VC deal flow monitoring on X requires combining a curated watch list of fund accounts, a filtered stream for keyword-based discovery, and a parsing layer to extract structured data from unstructured tweet text. The edge here is speed: deals often leak on X hours before any formal announcement. Pair this pipeline with email enrichment and CRM integration to turn X signals into actionable investment intelligence.
