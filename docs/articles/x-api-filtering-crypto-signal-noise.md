# X API Filtering Strategies for High-Signal Crypto Data

**Meta description:** Master X API filtering techniques to extract high-signal crypto data from tweet streams — covering rule syntax, NLP filtering, author credibility scoring, and noise suppression.

---

## Introduction

The X API gives you access to an enormous volume of crypto-related content. The problem is not access to data — it is signal-to-noise ratio. For every actionable tweet about a real exploit, protocol update, or market event, there are hundreds of spam posts, recycled hot takes, and engagement-farming threads. Building systems that reliably surface the 1% of high-signal content requires layered filtering strategies applied at the stream rule level, the ingestion layer, and the post-processing stage.

This guide covers the full filtering stack for crypto X data pipelines, from rule construction to NLP-based classification.

---

## Layer 1: Stream Rule Optimization

The X filtered stream supports up to 25 rules on the Basic plan and 1000 on Pro. Each rule can be up to 512 characters. The goal is maximum precision at the rule level to reduce volume before data hits your pipeline.

**Use negation operators aggressively:**

```javascript
// Bad — extremely noisy
'bitcoin price'

// Better — eliminates obvious noise
'bitcoin (breakout OR flash OR exploit OR whale OR "on-chain") -is:retweet lang:en'

// Best — precise with source constraints
'bitcoin (exploit OR "emergency pause" OR "funds at risk") from:peckshield OR from:BlockSecTeam lang:en'
```

**Combine `has:` operators to require content quality:**

```javascript
const HIGH_QUALITY_RULES = [
  // Only tweets with links (reduces low-effort content)
  '(DeFi exploit OR bridge hack) has:links -is:retweet lang:en',

  // Only verified-account tweets for market-moving claims
  '("SEC charges" OR "regulatory action") crypto is:verified lang:en',

  // Minimum engagement threshold via search (not available on filtered stream, use polling instead)
];
```

**Use `context:` annotations for financial topics:**
The X API annotates tweets with context domains. Use `context:131.*` for brand/finance and `context:66.*` for crypto to narrow scope without keyword matching.

---

## Layer 2: Author Credibility Filtering

Not all accounts posting about crypto deserve equal weight. Build a tiered credibility system:

```javascript
// Credibility tier definitions
const AUTHOR_TIERS = {
  TIER_1: {
    // Security firms, exchanges, protocol accounts
    handles: new Set(['peckshield', 'BlockSecTeam', 'certik', 'binance', 'coinbase', 'uniswap']),
    minFollowers: 0,
    score: 100,
  },
  TIER_2: {
    // Known researchers, journalists, analysts
    handles: new Set(['samczsun', 'tayvano_', 'EleanorTerrett', 'WuBlockchain']),
    minFollowers: 5_000,
    score: 75,
  },
  TIER_3: {
    // General crypto community — score by metrics
    handles: new Set(),
    minFollowers: 10_000,
    score: null, // computed dynamically
  },
};

function getAuthorScore(author) {
  const username = author.username?.toLowerCase();

  if (AUTHOR_TIERS.TIER_1.handles.has(username)) return 100;
  if (AUTHOR_TIERS.TIER_2.handles.has(username)) return 75;

  // Dynamic scoring for everyone else
  const followers = author.public_metrics?.followers_count ?? 0;
  const verified = author.verified ? 20 : 0;
  const followerScore = Math.min(50, Math.log10(Math.max(followers, 1)) * 10);
  const listedScore = Math.min(20, (author.public_metrics?.listed_count ?? 0) / 100);
  const tweetScore = Math.min(10, (author.public_metrics?.tweet_count ?? 0) / 10000);

  return Math.round(followerScore + verified + listedScore + tweetScore);
}
```

---

## Layer 3: Content-Based NLP Filtering

Apply text analysis after stream ingestion to eliminate promotional and low-quality content:

```javascript
// Spam indicators — discard if present
const SPAM_PATTERNS = [
  /follow\s+me\s+for/i,
  /dm\s+me\s+for\s+alpha/i,
  /🚀+\s*\d+x/,
  /guaranteed\s+(profit|return)/i,
  /join\s+our\s+(telegram|discord)\s+for\s+alpha/i,
  /call\s+\d+%\s+gain/i,
  /buy\s+before\s+it's\s+too\s+late/i,
  /\b(shib|doge|pepe|wojak)\b.*moon/i,
];

// Promotional indicator — down-rank, don't discard
const PROMO_PATTERNS = [
  /partnership\s+announcement/i,
  /sponsored\s+by/i,
  /use\s+my\s+referral/i,
  /affiliate\s+link/i,
];

// High-signal phrases — up-rank
const HIGH_SIGNAL_PATTERNS = [
  /funds?\s+(at\s+risk|drained|stolen)/i,
  /emergency\s+pause/i,
  /\$[\d.]+\s*(m|million|b|billion)\s+(stolen|drained|lost)/i,
  /critical\s+vulnerability/i,
  /zero.?day/i,
  /on.?chain\s+data\s+shows/i,
];

function filterByContent(text) {
  // Hard discard
  if (SPAM_PATTERNS.some(p => p.test(text))) {
    return { action: 'DISCARD', reason: 'spam_pattern' };
  }

  let score = 50; // neutral baseline

  // Promotional — down-rank
  const promoCount = PROMO_PATTERNS.filter(p => p.test(text)).length;
  score -= promoCount * 15;

  // High signal — up-rank
  const signalCount = HIGH_SIGNAL_PATTERNS.filter(p => p.test(text)).length;
  score += signalCount * 20;

  // Length quality — very short tweets often low value
  if (text.length < 50) score -= 20;
  if (text.length > 200) score += 5;

  // URL presence often increases quality for data/report tweets
  if (/https?:\/\//.test(text)) score += 10;

  if (score < 20) return { action: 'DISCARD', reason: 'low_score', score };
  if (score < 40) return { action: 'ARCHIVE', score };
  return { action: 'PROCESS', score };
}
```

---

## Layer 4: Temporal and Volume Deduplication

```javascript
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });

// Content-based deduplication (catches rewrites of same story)
function contentFingerprint(text) {
  // Remove mentions, links, whitespace normalization
  const cleaned = text
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 100);
  return Buffer.from(cleaned).toString('base64');
}

async function deduplicateTweet(tweetId, text, windowHours = 2) {
  const idKey = `dedup:id:${tweetId}`;
  const contentKey = `dedup:content:${contentFingerprint(text)}`;

  const [idExists, contentExists] = await Promise.all([
    redis.get(idKey),
    redis.get(contentKey),
  ]);

  if (idExists || contentExists) return false; // duplicate

  const ttl = windowHours * 3600;
  await Promise.all([
    redis.setEx(idKey, ttl, '1'),
    redis.setEx(contentKey, ttl, '1'),
  ]);

  return true; // novel tweet
}

// Volume spike detection — alert when topic surges
async function detectVolumeSurge(category) {
  const bucketKey = `volume:${category}:${Math.floor(Date.now() / 300000)}`; // 5-min buckets
  const count = await redis.incr(bucketKey);
  await redis.expire(bucketKey, 600);

  const prevBucketKey = `volume:${category}:${Math.floor(Date.now() / 300000) - 1}`;
  const prevCount = parseInt(await redis.get(prevBucketKey) ?? '1');

  const surgeRatio = count / prevCount;
  return { count, prevCount, surgeRatio, isSurging: surgeRatio > 3 };
}
```

---

## Layer 5: Composite Scoring Pipeline

Combine all filters into a single scoring pipeline:

```javascript
async function scoreAndRoute(tweetData, includes) {
  const { data: tweet, matching_rules } = tweetData;
  const author = includes?.users?.find(u => u.id === tweet.author_id);

  // Layer 3: Content filter (fast, cheap — run first)
  const contentResult = filterByContent(tweet.text);
  if (contentResult.action === 'DISCARD') return null;

  // Layer 4: Deduplication
  const isNovel = await deduplicateTweet(tweet.id, tweet.text);
  if (!isNovel) return null;

  // Layer 2: Author score
  const authorScore = getAuthorScore(author);

  // Composite score
  const compositeScore = Math.round(
    authorScore * 0.4 +
    contentResult.score * 0.4 +
    (matching_rules?.length ?? 0) * 10 * 0.2
  );

  // Volume surge check
  const category = matching_rules?.[0]?.tag ?? 'general';
  const surge = await detectVolumeSurge(category);

  return {
    tweet,
    author,
    compositeScore,
    contentScore: contentResult.score,
    authorScore,
    category,
    isSurging: surge.isSurging,
    surgeRatio: surge.surgeRatio,
    route: compositeScore >= 70 ? 'PRIORITY' : compositeScore >= 40 ? 'STANDARD' : 'ARCHIVE',
  };
}
```

---

## Tuning Thresholds for Your Use Case

Different crypto applications need different noise tolerances:

| Use Case | Min Score | Author Tier | Dedup Window |
|---|---|---|---|
| Security alerts | 50 | Tier 1 preferred | 2 hours |
| Sentiment analysis | 30 | Any | 30 minutes |
| Regulatory monitoring | 60 | Tier 1-2 only | 4 hours |
| Trend detection | 20 | Any | 5 minutes |
| Due diligence | 40 | Tier 2+ | 24 hours |

---

## Conclusion

High-signal crypto data from X requires filtering at every layer: precision rule construction at the stream level, author credibility scoring at the ingestion layer, NLP-based content scoring for spam and signal detection, and content-based deduplication to suppress story floods. The composite scoring pipeline ties these layers together and routes output to priority, standard, or archive queues based on your thresholds. Start conservative on thresholds and tune downward as you observe what your system misses — false negatives (missed signals) are more costly in crypto than false positives.
