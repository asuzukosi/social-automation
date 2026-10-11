# Memecoin Early Detection: Using X API to Spot Viral Tokens

**Meta description:** How to use the X API to detect memecoins early — monitoring cashtag emergence, tracking velocity metrics, cross-referencing with DEX liquidity data, and filtering out pump-and-dump noise.

---

## Introduction

Memecoins live and die on social momentum. A token can go from zero to 100x in 48 hours when it catches a viral moment — and collapse just as fast when the narrative fades. The X API is the best real-time signal source for detecting this momentum before it fully prices in.

This guide builds an early detection system: monitoring for new cashtag emergence, measuring velocity, cross-referencing with on-chain liquidity, and scoring which tokens have genuine viral potential versus coordinated pump noise.

---

## The Signal Stack

Memecoin early detection requires combining several signals:

1. **Cashtag velocity** — how fast is mention count accelerating?
2. **Account diversity** — is it spreading organically or from a concentrated cluster?
3. **Engagement quality** — real reactions or copy-paste bot activity?
4. **On-chain confirmation** — is there actual liquidity and buy volume?
5. **Influencer amplification** — which accounts are picking it up?

X API covers signals 1-3 and 5. On-chain data (signal 4) requires a DEX API like DexScreener or Birdeye.

---

## Step 1: Monitor for New Cashtag Emergence

The X API Recent Search endpoint lets you track how mention counts change over time for any cashtag:

```javascript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

async function getCashtagVelocity(ticker) {
  const cashtag = ticker.startsWith('$') ? ticker : `$${ticker}`;

  // Count mentions in last 1 hour
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const res1h = await client.v2.search(`${cashtag} lang:en -is:retweet`, {
    start_time: oneHourAgo,
    max_results: 100,
    'tweet.fields': ['created_at', 'public_metrics']
  });

  // Count mentions in previous hour (1-2 hours ago)
  const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
  const res2h = await client.v2.search(`${cashtag} lang:en -is:retweet`, {
    start_time: twoHoursAgo,
    end_time: oneHourAgo,
    max_results: 100,
    'tweet.fields': ['created_at', 'public_metrics']
  });

  const recent = res1h.data?.meta?.result_count ?? 0;
  const previous = res2h.data?.meta?.result_count ?? 0;

  const velocity = previous === 0 ? recent * 10 : (recent - previous) / previous;

  return {
    ticker,
    mentions1h: recent,
    mentions2h: previous,
    velocity, // positive = growing, negative = declining
    accelerating: velocity > 0.5 // 50%+ growth = significant
  };
}
```

---

## Step 2: Detect Unknown Tickers Emerging in Real Time

Rather than tracking a known list, detect new cashtags organically using the Filtered Stream:

```javascript
const trackedTickers = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'SHIB']); // established — ignore
const emergingTickers = new Map(); // ticker → { firstSeen, mentionCount, accounts }

async function detectNewCashtags() {
  await setStreamRules([
    { value: 'lang:en -is:retweet has:cashtags', tag: 'cashtag-monitor' }
  ]);

  await connectStream((payload) => {
    const tweet = payload.data;
    const cashtags = tweet.entities?.cashtags?.map(c => c.tag.toUpperCase()) ?? [];

    for (const ticker of cashtags) {
      if (trackedTickers.has(ticker)) continue; // Skip established coins
      if (ticker.length > 10) continue; // Skip noise

      if (!emergingTickers.has(ticker)) {
        emergingTickers.set(ticker, {
          firstSeen: Date.now(),
          mentionCount: 0,
          accounts: new Set(),
          tweets: []
        });
      }

      const data = emergingTickers.get(ticker);
      data.mentionCount++;
      data.accounts.add(tweet.author_id);
      data.tweets.push(tweet.id);
    }
  });
}

// Check emerging tickers every 5 minutes for virality
setInterval(() => {
  for (const [ticker, data] of emergingTickers) {
    const ageMinutes = (Date.now() - data.firstSeen) / 60_000;
    const mentionsPerMinute = data.mentionCount / ageMinutes;
    const accountDiversity = data.accounts.size / data.mentionCount;

    if (mentionsPerMinute > 5 && accountDiversity > 0.4) {
      console.log(`🚨 Emerging ticker detected: $${ticker}`);
      console.log(`   ${data.mentionCount} mentions from ${data.accounts.size} unique accounts`);
      investigateTicker(ticker);
    }
  }
}, 5 * 60 * 1000);
```

---

## Step 3: Score Organic vs. Coordinated Activity

The difference between viral memecoins and coordinated pumps is account diversity and content variation:

```javascript
async function scoreOrganicness(ticker, tweets) {
  const authors = new Set(tweets.map(t => t.author_id));
  const diversityScore = authors.size / tweets.length; // 1.0 = all unique authors

  // Check content uniqueness — bots copy-paste
  const uniqueTexts = new Set(tweets.map(t => t.text.slice(0, 50).toLowerCase()));
  const contentVariety = uniqueTexts.size / tweets.length;

  // Account creation time diversity (newer accounts = higher bot risk)
  const authorDetails = await client.v2.users([...authors].slice(0, 20), {
    'user.fields': ['created_at', 'public_metrics']
  });

  const accountAges = authorDetails.data.map(u => {
    const ageMs = Date.now() - new Date(u.created_at).getTime();
    return ageMs / (1000 * 60 * 60 * 24 * 365); // Age in years
  });

  const avgAccountAge = accountAges.reduce((a, b) => a + b, 0) / accountAges.length;
  const youngAccounts = accountAges.filter(a => a < 0.5).length / accountAges.length;

  return {
    ticker,
    diversityScore,
    contentVariety,
    avgAccountAge: avgAccountAge.toFixed(1) + ' years',
    youngAccountRatio: (youngAccounts * 100).toFixed(0) + '%',
    organicScore: Math.round((diversityScore * 0.4 + contentVariety * 0.4 + (1 - youngAccounts) * 0.2) * 100),
    verdict: diversityScore > 0.7 && contentVariety > 0.6 ? 'ORGANIC' : 'SUSPICIOUS'
  };
}
```

---

## Step 4: Track Influencer Amplification

A memecoin goes viral when it gets picked up by high-follower accounts. Track which influencers are posting about an emerging ticker:

```javascript
async function trackInfluencerAmplification(ticker, tweets) {
  const authorIds = [...new Set(tweets.map(t => t.author_id))];

  const users = await client.v2.users(authorIds.slice(0, 100), {
    'user.fields': ['public_metrics', 'verified', 'username']
  });

  const influencers = users.data
    .filter(u => u.public_metrics.followers_count > 10_000)
    .sort((a, b) => b.public_metrics.followers_count - a.public_metrics.followers_count);

  const totalReach = influencers.reduce(
    (sum, u) => sum + u.public_metrics.followers_count, 0
  );

  return {
    ticker,
    influencerCount: influencers.length,
    topInfluencers: influencers.slice(0, 5).map(u => ({
      username: u.username,
      followers: u.public_metrics.followers_count
    })),
    totalReach,
    amplificationTier: totalReach > 5_000_000 ? 'MAJOR' : totalReach > 500_000 ? 'SIGNIFICANT' : 'MINOR'
  };
}
```

---

## Step 5: Cross-Reference with DEX Data

X data alone isn't sufficient — always validate with on-chain liquidity:

```javascript
async function getDexData(ticker) {
  // DexScreener API — free, no key required
  const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${ticker}`);
  const data = await res.json();

  if (!data.pairs?.length) return null;

  // Get the pair with highest liquidity
  const topPair = data.pairs
    .filter(p => p.chainId === 'solana' || p.chainId === 'ethereum')
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

  if (!topPair) return null;

  return {
    contractAddress: topPair.baseToken.address,
    chain: topPair.chainId,
    liquidity: topPair.liquidity?.usd ?? 0,
    volume24h: topPair.volume?.h24 ?? 0,
    priceChange1h: topPair.priceChange?.h1 ?? 0,
    txCount24h: topPair.txns?.h24?.buys ?? 0,
    pairAge: topPair.pairCreatedAt
  };
}

// Combined scoring
async function scoreToken(ticker, socialData, dexData) {
  if (!dexData) return { score: 0, verdict: 'NO_LIQUIDITY' };

  const liquidityScore = Math.min(dexData.liquidity / 100_000 * 30, 30); // 30 pts max
  const volumeScore = Math.min(dexData.volume24h / 500_000 * 25, 25);    // 25 pts max
  const socialScore = Math.min(socialData.organicScore * 0.25, 25);       // 25 pts max
  const velocityScore = Math.min(socialData.velocity * 10, 20);           // 20 pts max

  const total = liquidityScore + volumeScore + socialScore + velocityScore;

  return {
    ticker,
    score: Math.round(total),
    verdict: total > 60 ? 'HIGH_POTENTIAL' : total > 40 ? 'WATCH' : 'IGNORE',
    breakdown: { liquidityScore, volumeScore, socialScore, velocityScore }
  };
}
```

---

## Red Flags to Filter

- Liquidity under $50,000 — too easy to manipulate
- Token age under 1 hour — pre-pump coordination
- `youngAccountRatio` above 60% — bot army
- `contentVariety` below 0.3 — copy-paste campaign
- Single influencer driving 80%+ of reach — paid promotion, not organic

---

## Conclusion

Early memecoin detection on X is a signal extraction problem, not a prediction problem. The X API gives you the social velocity, account diversity, and influencer amplification data. DEX APIs give you the on-chain confirmation. The combination filters out most of the noise — coordinated pumps fail on account diversity or liquidity metrics. Genuine viral tokens show organic account spread, content variety, and real liquidity growth in parallel. Build the detection pipeline, validate signals against historical token launches, and calibrate your thresholds before putting capital behind the signals.

---

*Related: [X API Filtered Stream: Real-Time Crypto Sentiment Monitoring](./x-api-filtered-stream-crypto-sentiment.md)*
