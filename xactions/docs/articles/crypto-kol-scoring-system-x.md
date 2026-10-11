# Building a Crypto KOL Scoring System with X API

**Meta description:** Build a quantitative KOL scoring system for crypto Twitter using X API engagement data, follower quality metrics, and predictive accuracy tracking.

---

## Introduction

Not all crypto KOLs are equal. Some drive real price action; others post noise with high follower counts. Building a KOL scoring system lets you separate signal from shill — programmatically. This article walks through the data model, scoring algorithm, and infrastructure needed to rank crypto Key Opinion Leaders (KOLs) on X by actual influence quality, not raw follower count.

---

## Defining What "Influence Quality" Means

Raw followers and likes are gameable. A credible KOL scoring system should measure:

- **Engagement rate** — interactions per impression, not absolute counts
- **Follower quality** — ratio of active, non-bot accounts in their audience
- **Prediction accuracy** — did their bullish/bearish calls play out on-chain?
- **Content originality** — original takes vs. reposted alpha
- **Audience overlap with other high-signal accounts** — do legit traders follow them?

Build your scoring function to weight these factors. Start simple — you can always add complexity.

---

## Data Collection with X API

Pull KOL candidate accounts from multiple sources:

```javascript
// Seed list: accounts mentioned frequently in crypto discourse
const seedQuery = '(alpha OR "gem" OR "degen") ($ETH OR $SOL OR $BTC) -is:retweet has:cashtags lang:en';

const response = await xClient.get('tweets/search/recent', {
  query: seedQuery,
  max_results: 100,
  expansions: 'author_id',
  'user.fields': 'public_metrics,created_at,verified,description',
  tweet_fields: 'public_metrics,created_at,context_annotations',
});
```

Collect `author_id` values, then fetch full user objects for each unique author. Store these in a `kol_candidates` table.

---

## The Scoring Model

### Engagement Rate Score

```javascript
function engagementRateScore(metrics) {
  const { like_count, retweet_count, reply_count, quote_count, impression_count } = metrics;
  if (!impression_count || impression_count === 0) return 0;
  const interactions = like_count + (retweet_count * 2) + (reply_count * 1.5) + (quote_count * 2);
  const rate = interactions / impression_count;
  // Normalize: 0.02 (2%) is excellent in crypto Twitter
  return Math.min(rate / 0.02, 1) * 100;
}
```

Weight retweets and quotes more heavily than likes — they signal someone found the content worth amplifying.

### Follower Quality Score

Without access to each follower's data (rate limits make this impractical at scale), use proxy signals:

```javascript
function followerQualityScore(user) {
  const { followers_count, following_count, tweet_count, created_at } = user.public_metrics;
  const accountAgeDays = (Date.now() - new Date(created_at)) / 86400000;

  // High follower:following ratio = healthier organic growth
  const ffRatio = followers_count / Math.max(following_count, 1);
  const ffScore = Math.min(ffRatio / 10, 1) * 40;

  // Account age matters — older accounts less likely to be bot farms
  const ageScore = Math.min(accountAgeDays / 365, 1) * 30;

  // Activity: too many or too few tweets is suspicious
  const tweetsPerDay = tweet_count / Math.max(accountAgeDays, 1);
  const activityScore = tweetsPerDay > 1 && tweetsPerDay < 50 ? 30 : 10;

  return ffScore + ageScore + activityScore;
}
```

### Prediction Accuracy Score

This requires tracking KOL calls over time and comparing them to actual price movements:

```sql
CREATE TABLE kol_predictions (
  id           SERIAL PRIMARY KEY,
  kol_id       BIGINT NOT NULL,
  tweet_id     BIGINT NOT NULL,
  token_symbol TEXT NOT NULL,
  direction    TEXT CHECK (direction IN ('bullish', 'bearish', 'neutral')),
  detected_at  TIMESTAMPTZ NOT NULL,
  price_at_call NUMERIC,
  price_7d_later NUMERIC,
  outcome      TEXT CHECK (outcome IN ('correct', 'incorrect', 'neutral', 'pending'))
);
```

Fill `price_7d_later` and `outcome` via a scheduled job that queries a price API 7 days after the call is detected.

---

## Composite Scoring

Combine sub-scores into a final KOL score:

```javascript
function computeKolScore({ engagementScore, followerQualityScore, predictionAccuracyScore, originality }) {
  const weights = {
    engagement: 0.25,
    followerQuality: 0.20,
    prediction: 0.40,   // prediction accuracy is the strongest signal
    originality: 0.15,
  };

  return (
    engagementScore * weights.engagement +
    followerQualityScore * weights.followerQuality +
    predictionAccuracyScore * weights.prediction +
    originality * weights.originality
  );
}
```

Store the composite score in a `kol_scores` table with a timestamp so you can track score drift over time.

---

## Updating Scores Incrementally

Don't recompute from scratch on every tweet. Use a sliding window approach:

```javascript
// On each new tweet from a tracked KOL
async function updateKolScore(kolId, newTweet) {
  const recentMetrics = await db.tweet.findMany({
    where: { authorId: kolId, createdAt: { gte: subDays(new Date(), 30) } },
    select: { metrics: true },
  });

  const avgEngagement = recentMetrics.reduce((sum, t) => sum + engagementRateScore(t.metrics), 0) / recentMetrics.length;

  await db.kolScore.upsert({
    where: { kolId },
    update: { engagementScore: avgEngagement, updatedAt: new Date() },
    create: { kolId, engagementScore: avgEngagement },
  });
}
```

---

## Serving the Leaderboard

Expose a simple API endpoint for your dashboard:

```javascript
app.get('/api/kols/leaderboard', async (req, res) => {
  const { token, limit = 20 } = req.query;
  const kols = await db.$queryRaw`
    SELECT k.*, ks.composite_score
    FROM kol_candidates k
    JOIN kol_scores ks ON k.id = ks.kol_id
    WHERE ($1::text IS NULL OR k.tracked_tokens @> ARRAY[$1])
    ORDER BY ks.composite_score DESC
    LIMIT ${parseInt(limit)}
  `;
  res.json(kols);
});
```

---

## Conclusion

A KOL scoring system is only as good as its prediction accuracy tracking — that's where the real alpha is. Engagement rates and follower quality are table stakes; the edge comes from knowing whose calls actually move in the right direction over time. Build the infrastructure to track predictions first, then layer in the engagement and quality signals. Start with a seed list of 50–100 accounts and expand as the system proves itself.
