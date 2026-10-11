# Building a DeFi Yield Opportunity Alert Bot with X API

**Meta description:** Build a DeFi yield alert bot that uses the X API to detect high-APY opportunities, new pool launches, and yield farming announcements before they get crowded.

---

## Introduction

DeFi yield opportunities have a short shelf life. A new pool launching at 500% APY can drop to 30% within hours as capital floods in. The protocols, KOLs, and on-chain analysts who announce these opportunities do so on X first — before any yield aggregator indexes the pool, before DefiLlama adds the TVL, before your newsletter covers it.

Building an automated yield alert bot that monitors X gives you a systematic edge: catch high-yield announcements early, filter by credibility, and route alerts to your wallet or trading system before the crowd arrives.

---

## Defining What Counts as a Yield Signal

Yield signals on X fall into several categories:

**New pool/vault launches:**
- Protocol accounts announcing new liquidity pools
- "Farm is live", "vault is open", "liquidity mining starts"

**Incentive programs:**
- Token emissions starting, airdrop farming windows
- "Liquidity incentives", "yield boosters", "gauge votes"

**Yield aggregator updates:**
- Yearn, Beefy, Convex, Pendle announcing new strategies

**KOL calls:**
- High-follower DeFi accounts sharing yield plays
- "Current farming", "yield stack", "where I'm putting capital"

---

## Stream Rules for Yield Discovery

```javascript
const YIELD_RULES = [
  {
    value: '("APY" OR "APR") ("%" OR "percent") (farm OR pool OR vault OR liquidity) -is:retweet lang:en',
    tag: 'apy_mention'
  },
  {
    value: '("farm is live" OR "vault is live" OR "pool is open" OR "liquidity mining") -is:retweet',
    tag: 'launch_announcement'
  },
  {
    value: '("yield strategy" OR "yield stack" OR "farming guide" OR "where I\'m farming") -is:retweet',
    tag: 'kol_call'
  },
  {
    value: 'from:yearnfi OR from:BeefyFinance OR from:ConvexFinance OR from:pendle_fi -is:retweet',
    tag: 'aggregator_update'
  },
  {
    value: '("incentivized" OR "emissions start" OR "gauge vote" OR "boost available") DeFi -is:retweet',
    tag: 'incentive_start'
  },
];
```

---

## Parsing APY Values from Tweet Text

Extract the actual yield percentage when mentioned:

```javascript
function extractYieldData(text) {
  // Match patterns like "500% APY", "~200% APR", ">100% yield"
  const apyPattern = /([~>]?\d{1,6}(?:\.\d+)?)\s*%?\s*(APY|APR|yield|return)/gi;
  const matches = [...text.matchAll(apyPattern)];

  const yields = matches.map(m => ({
    value: parseFloat(m[1].replace('~', '').replace('>', '')),
    type: m[2].toUpperCase(),
    approximate: m[1].startsWith('~'),
    minimum: m[1].startsWith('>'),
  }));

  // Also extract protocol name if mentioned
  const protocolPatterns = [
    /on\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/,
    /([A-Z][a-zA-Z]+)\s+(?:farm|pool|vault)/,
  ];

  let protocol = null;
  for (const p of protocolPatterns) {
    const m = text.match(p);
    if (m) { protocol = m[1]; break; }
  }

  return { yields, protocol, rawText: text };
}
```

---

## Source Credibility Scoring for Yield Signals

A tweet claiming 10,000% APY from an unknown account is noise. Weight by source:

```javascript
const TRUSTED_PROTOCOL_ACCOUNTS = new Set([
  'yearnfi', 'BeefyFinance', 'ConvexFinance', 'pendle_fi',
  'AuraFinance', 'CurveFinance', 'LidoFinance', 'AaveAave',
  'compoundfinance', 'MakerDAO', 'UniswapProtocol',
]);

const TRUSTED_KOL_ACCOUNTS = new Set([
  'DegenSpartan', 'cobie', 'Tetranode', '0xHamz',
  'Route2FI', 'DeFi_Dad', 'MilesD_eth',
]);

function scoreYieldSignal(authorUsername, publicMetrics, yieldData) {
  let score = 0;

  if (TRUSTED_PROTOCOL_ACCOUNTS.has(authorUsername)) score += 50;
  else if (TRUSTED_KOL_ACCOUNTS.has(authorUsername)) score += 30;
  else {
    // Score by follower count for unknowns
    const followers = publicMetrics.followers_count;
    if (followers > 100_000) score += 20;
    else if (followers > 10_000) score += 10;
    else if (followers > 1_000) score += 5;
  }

  // Penalize unrealistically high APYs
  const maxYield = Math.max(...yieldData.yields.map(y => y.value), 0);
  if (maxYield > 10_000) score -= 20;
  if (maxYield > 1_000 && !TRUSTED_PROTOCOL_ACCOUNTS.has(authorUsername)) score -= 10;

  // Bonus for protocol-tagged tweets
  if (yieldData.protocol) score += 10;

  return Math.max(0, Math.min(100, score));
}
```

---

## Building the Alert Pipeline

```javascript
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });

const MIN_ALERT_SCORE = 40;
const MIN_APY_ALERT = 20; // Only alert on yields >= 20%

async function processYieldTweet(tweetData, includes) {
  const { data: tweet, matching_rules } = tweetData;
  const author = includes?.users?.find(u => u.id === tweet.author_id);

  const yieldData = extractYieldData(tweet.text);
  if (!yieldData.yields.length) return; // no yield mentioned

  const maxYield = Math.max(...yieldData.yields.map(y => y.value));
  if (maxYield < MIN_APY_ALERT) return; // below threshold

  const score = scoreYieldSignal(author.username, author.public_metrics, yieldData);
  if (score < MIN_ALERT_SCORE) return;

  const dedupKey = `yield:${tweet.id}`;
  const seen = await redis.get(dedupKey);
  if (seen) return;
  await redis.setEx(dedupKey, 86400, '1');

  await sendAlert({
    title: `Yield Opportunity: ${maxYield}% via @${author.username}`,
    protocol: yieldData.protocol,
    maxAPY: maxYield,
    yieldTypes: yieldData.yields,
    score,
    tweetUrl: `https://x.com/i/web/status/${tweet.id}`,
    text: tweet.text,
    source: matching_rules[0]?.tag,
  });
}

async function sendAlert(alert) {
  const emoji = alert.maxAPY > 200 ? '🔥' : alert.maxAPY > 50 ? '💰' : '📊';
  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `${emoji} *Yield Alert [Score: ${alert.score}]* — ${alert.maxAPY}% APY\n` +
            `Protocol: ${alert.protocol ?? 'Unknown'}\n` +
            `Source: @${alert.author} via ${alert.source}\n` +
            `${alert.tweetUrl}`,
    }),
  });
}
```

---

## Filtering False Positives

High-yield announcements attract scammers. Add a final filter layer:

```javascript
const SCAM_INDICATORS = [
  'guaranteed returns', 'risk-free', 'cant lose', "can't lose",
  'dm me', 'telegram', 'contact us for', 'whitelist only',
  'presale', 'ico', 'send eth',
];

function isLikelyScam(text) {
  const lower = text.toLowerCase();
  return SCAM_INDICATORS.some(indicator => lower.includes(indicator));
}
```

---

## Conclusion

A DeFi yield alert bot built on X gives you first-mover awareness on new farming opportunities. The key engineering decisions are: stream rules that balance coverage with noise, APY extraction to quantify the signal, source credibility scoring to weight protocol accounts over anonymous callers, and scam filtering to avoid chasing fake opportunities. Run this as a persistent Node.js service, tune the `MIN_APY_ALERT` and `MIN_ALERT_SCORE` thresholds based on your risk tolerance, and wire the output directly into your portfolio management workflow.
