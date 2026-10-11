# Using X API for Cross-Platform Crypto Sentiment Comparison

**Meta description:** Learn how to use X API alongside Reddit, Telegram, and Discord data to build a cross-platform crypto sentiment comparison system for market intelligence.

---

## Introduction

Crypto sentiment is not uniform across platforms. X tends to skew bullish — influencers build audiences by promoting projects. Reddit communities run harder bearish during bear markets and can sustain skepticism longer. Telegram groups are echo chambers that amplify whatever the group admin believes. Discord is where technical community members discuss reality.

Cross-platform sentiment comparison is the practice of pulling signal from all four platforms, normalizing it, and identifying divergences. When X is extremely bullish but Reddit is neutral and Telegram is quiet, that divergence itself is information. This guide shows how to build that comparison system with X API as the primary data source.

---

## Architecture Overview

Each platform requires a different collection method:

| Platform | Method | Rate limits |
|---|---|---|
| X | Filtered stream + search API | 300 req/15min (Pro) |
| Reddit | Official API (pushshift deprecated) | 60 req/min free |
| Telegram | Telegram Bot API, channel scraping | None for bots |
| Discord | Discord Bot API | 50 req/s per bot |

Build a unified sentiment pipeline with platform-specific adapters:

```
Platform Adapters → Normalization Layer → Scoring Engine → Comparison Dashboard
```

---

## X API Sentiment Collection

The foundation layer. Collect per-token, per-timeframe sentiment:

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function collectXSentiment(token, windowHours = 1) {
  const query = `(${token} OR #${token}) lang:en -is:retweet`;
  const startTime = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  const results = [];
  let nextToken;

  do {
    const page = await client.v2.search(query, {
      max_results: 100,
      start_time: startTime,
      'tweet.fields': ['public_metrics', 'created_at'],
      next_token: nextToken,
    });

    if (page.data?.data) results.push(...page.data.data);
    nextToken = page.data?.meta?.next_token;
  } while (nextToken && results.length < 500);

  return results.map(tweet => ({
    platform: 'x',
    text: tweet.text,
    engagement: computeEngagement(tweet.public_metrics),
    timestamp: tweet.created_at,
    rawScore: scoreSentiment(tweet.text),
  }));
}

function computeEngagement(metrics) {
  return metrics.like_count + metrics.retweet_count * 2 + metrics.reply_count;
}
```

---

## Unified Sentiment Score Normalization

Each platform has different engagement scales. Normalize to a common [-1, 1] range:

```js
class SentimentNormalizer {
  // Engagement weights differ per platform
  static PLATFORM_WEIGHTS = {
    x: { baseMultiplier: 1.0, engagementScale: 10000 },
    reddit: { baseMultiplier: 0.8, engagementScale: 1000 },
    telegram: { baseMultiplier: 0.6, engagementScale: 500 },
    discord: { baseMultiplier: 0.7, engagementScale: 100 },
  };

  normalize(posts, platform) {
    const weights = SentimentNormalizer.PLATFORM_WEIGHTS[platform];
    if (!weights) throw new Error(`Unknown platform: ${platform}`);

    const scored = posts.map(post => {
      // Sentiment in [-5, 5] range, normalize to [-1, 1]
      const baseSentiment = post.rawScore / 5;

      // Weight by engagement relative to platform scale
      const engagementWeight = Math.min(
        1 + Math.log10(1 + post.engagement) / Math.log10(weights.engagementScale),
        3.0  // cap at 3x weight
      );

      return {
        ...post,
        normalizedScore: baseSentiment * engagementWeight * weights.baseMultiplier,
      };
    });

    // Aggregate to single platform score
    const totalWeight = scored.reduce((s, p) => s + Math.abs(p.normalizedScore), 0);
    const weightedSum = scored.reduce((s, p) => s + p.normalizedScore, 0);

    return {
      platform,
      score: totalWeight > 0 ? weightedSum / totalWeight : 0,
      postCount: posts.length,
      totalEngagement: posts.reduce((s, p) => s + p.engagement, 0),
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## Reddit Sentiment Collection

```js
async function collectRedditSentiment(token, subreddits = ['CryptoCurrency', 'ethereum', 'bitcoin']) {
  const posts = [];

  for (const sub of subreddits) {
    const response = await fetch(
      `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(token)}&sort=new&limit=100&t=day`,
      { headers: { 'User-Agent': 'crypto-sentiment-bot/1.0' } }
    );
    const data = await response.json();
    const subPosts = data.data?.children?.map(child => ({
      platform: 'reddit',
      text: `${child.data.title} ${child.data.selftext}`,
      engagement: child.data.score + child.data.num_comments * 2,
      timestamp: new Date(child.data.created_utc * 1000).toISOString(),
      rawScore: scoreSentiment(`${child.data.title} ${child.data.selftext}`),
    })) ?? [];

    posts.push(...subPosts);
    await new Promise(r => setTimeout(r, 1000)); // Reddit rate limit
  }

  return posts;
}
```

---

## Divergence Detection

The most valuable signal is divergence between platforms:

```js
function detectDivergence(platformScores) {
  const scores = Object.fromEntries(
    platformScores.map(p => [p.platform, p.score])
  );

  const values = Object.values(scores);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = max - min;

  // Find the outlier platform
  let outlierPlatform = null;
  let outlierDirection = null;

  if (spread > 0.4) {  // Significant divergence threshold
    for (const [platform, score] of Object.entries(scores)) {
      if (Math.abs(score - mean) > 0.3) {
        outlierPlatform = platform;
        outlierDirection = score > mean ? 'MORE_BULLISH' : 'MORE_BEARISH';
      }
    }
  }

  return {
    scores,
    mean: mean.toFixed(3),
    spread: spread.toFixed(3),
    hasDivergence: spread > 0.4,
    outlierPlatform,
    outlierDirection,
    interpretation: interpretDivergence(scores, spread),
  };
}

function interpretDivergence(scores, spread) {
  if (spread < 0.2) return 'CONSENSUS';
  if (scores.x > 0.3 && scores.reddit < -0.1) return 'X_BULLISH_REDDIT_SKEPTICAL';
  if (scores.x < -0.2 && scores.telegram > 0.3) return 'X_BEARISH_TELEGRAM_PUMPING';
  if (Math.abs(scores.x) < 0.1 && spread > 0.5) return 'X_NEUTRAL_OTHERS_DIVERGING';
  return 'GENERAL_DIVERGENCE';
}
```

---

## Time-Series Storage and Dashboard Data

```sql
CREATE TABLE platform_sentiment (
  id BIGSERIAL PRIMARY KEY,
  token VARCHAR(20) NOT NULL,
  platform VARCHAR(20) NOT NULL,
  score DECIMAL(6, 4) NOT NULL,
  post_count INT NOT NULL,
  total_engagement BIGINT,
  window_hours INT DEFAULT 1,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON platform_sentiment (token, platform, recorded_at DESC);

-- Query for dashboard: last 24 hours by platform
SELECT
  platform,
  date_trunc('hour', recorded_at) as hour,
  AVG(score) as avg_score,
  SUM(post_count) as total_posts
FROM platform_sentiment
WHERE token = 'ETH' AND recorded_at > NOW() - INTERVAL '24 hours'
GROUP BY platform, hour
ORDER BY platform, hour;
```

---

## Alerting on High-Confidence Divergences

```js
async function evaluateAndAlert(token, divergence) {
  // Only alert on high-spread divergences with sufficient data volume
  const minPosts = 50;
  const hasEnoughData = divergence.scores.x !== undefined &&
    await getRecentPostCount(token, 'x') > minPosts;

  if (divergence.hasDivergence && hasEnoughData) {
    const message = `[SENTIMENT DIVERGENCE] ${token}
Spread: ${divergence.spread} (threshold: 0.40)
Pattern: ${divergence.interpretation}
X score: ${divergence.scores.x?.toFixed(2) ?? 'N/A'}
Reddit score: ${divergence.scores.reddit?.toFixed(2) ?? 'N/A'}
${divergence.outlierPlatform ? `Outlier: ${divergence.outlierPlatform} is ${divergence.outlierDirection}` : ''}`;

    await sendAlert(message);
  }
}
```

---

## Conclusion

Cross-platform sentiment comparison with X as the anchor data source reveals information that single-platform monitoring misses. The normalization layer described here handles different engagement scales across X, Reddit, Telegram, and Discord. Divergence detection — particularly X-bullish-Reddit-skeptical patterns — is one of the most reliable short-term market sentiment signals available. Build the pipeline, run it continuously, and track which divergence patterns in your historical data preceded the largest price moves.
