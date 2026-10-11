# How to Use X API for Crypto Community Health Monitoring

**Meta description:** Monitor the health of crypto project communities on X by tracking engagement quality, bot ratios, sentiment trends, and follower authenticity using the X API.

---

## Introduction

A crypto project's community on X is often the most visible signal of project health — and the most easily manipulated. Coordinated bot networks inflate follower counts, fake engagement campaigns distort sentiment metrics, and community toxicity drives away genuine contributors. Building a systematic community health monitoring pipeline lets you assess the authenticity and trajectory of any project's X presence, whether you are doing due diligence on a protocol, managing your own community, or building analytics tooling for institutional clients.

This guide covers the metrics that matter, how to compute them from X API data, and how to surface deterioration signals before they become obvious.

---

## Defining Community Health Metrics

Health monitoring is only useful if you are measuring the right things. Focus on metrics that are hard to fake at scale:

| Metric | Signal | Threshold (warning) |
|---|---|---|
| Engagement rate | Likes + replies / followers | < 0.5% suggests inactive or bot audience |
| Reply-to-like ratio | Replies / likes | < 0.05 suggests like-farming |
| Account age distribution | % of followers < 30 days old | > 20% suggests bot injection |
| Unique commenter ratio | Unique accounts / total replies | < 40% suggests coordinated posting |
| Sentiment velocity | Rate of sentiment change | > 30% swing in 24h = manipulation signal |
| Thread completion rate | Replies in thread / thread length | Low = disengaged community |

---

## Fetching Community Engagement Data

Pull recent tweets from the project's account and analyze their engagement patterns:

```javascript
// src/health/communityFetcher.js
import fetch from 'node-fetch';

const BEARER = process.env.X_BEARER_TOKEN;

export async function fetchProjectTweets(userId, count = 100) {
  const url = new URL(`https://api.twitter.com/2/users/${userId}/tweets`);
  url.searchParams.set('max_results', count);
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,conversation_id');
  url.searchParams.set('exclude', 'retweets,replies');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${BEARER}` } });
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchFollowerSample(userId, maxResults = 1000) {
  const url = new URL(`https://api.twitter.com/2/users/${userId}/followers`);
  url.searchParams.set('max_results', Math.min(maxResults, 1000));
  url.searchParams.set('user.fields', 'created_at,public_metrics,description,verified');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${BEARER}` } });
  const json = await res.json();
  return json.data ?? [];
}
```

---

## Computing Engagement Quality Score

```javascript
// src/health/engagementAnalyzer.js
export function analyzeEngagement(tweets, followerCount) {
  if (!tweets.length || !followerCount) return null;

  const totals = tweets.reduce((acc, t) => ({
    likes: acc.likes + t.public_metrics.like_count,
    replies: acc.replies + t.public_metrics.reply_count,
    retweets: acc.retweets + t.public_metrics.retweet_count,
    impressions: acc.impressions + (t.public_metrics.impression_count ?? 0)
  }), { likes: 0, replies: 0, retweets: 0, impressions: 0 });

  const avgLikes = totals.likes / tweets.length;
  const engagementRate = ((totals.likes + totals.replies + totals.retweets) / tweets.length) / followerCount;
  const replyToLikeRatio = totals.likes > 0 ? totals.replies / totals.likes : 0;

  return {
    avgLikes: +avgLikes.toFixed(2),
    engagementRate: +(engagementRate * 100).toFixed(3),
    replyToLikeRatio: +replyToLikeRatio.toFixed(4),
    sampleSize: tweets.length
  };
}
```

---

## Detecting Bot Accounts in Follower Samples

Run heuristic checks on follower samples to estimate bot ratio:

```javascript
// src/health/botDetector.js
const BOT_SIGNALS = {
  accountAgeDays: 30,       // created within 30 days
  followingToFollowerRatio: 10, // following 10x more than followers
  noDescription: true,
  defaultProfileImage: true,
  lowTweetCount: 5
};

export function assessFollowerAuthenticity(followers) {
  const now = Date.now();
  let suspiciousCount = 0;

  for (const follower of followers) {
    let signals = 0;
    const ageDays = (now - new Date(follower.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const { followers_count, following_count, tweet_count } = follower.public_metrics;

    if (ageDays < BOT_SIGNALS.accountAgeDays) signals++;
    if (following_count > 0 && followers_count / following_count < 0.1) signals++;
    if (!follower.description || follower.description.trim() === '') signals++;
    if (tweet_count < BOT_SIGNALS.lowTweetCount) signals++;

    if (signals >= 2) suspiciousCount++;
  }

  return {
    sampleSize: followers.length,
    suspiciousCount,
    suspiciousRatio: +(suspiciousCount / followers.length).toFixed(3),
    healthGrade: suspiciousCount / followers.length < 0.1 ? 'A' :
                 suspiciousCount / followers.length < 0.2 ? 'B' :
                 suspiciousCount / followers.length < 0.35 ? 'C' : 'D'
  };
}
```

---

## Tracking Sentiment Trends Over Time

Pull recent mentions of the project and run lightweight sentiment scoring:

```javascript
// src/health/sentimentTracker.js
import { fetchRecentMentions } from './communityFetcher.js';

// Simple keyword-based sentiment (replace with an LLM call for accuracy)
const POSITIVE = ['bullish', 'moon', 'amazing', 'love', 'solid', 'based', 'legit', 'lfg'];
const NEGATIVE = ['rug', 'scam', 'dump', 'dead', 'worthless', 'exit', 'avoid', 'rekt'];

export function scoreSentiment(text) {
  const lower = text.toLowerCase();
  const pos = POSITIVE.filter(w => lower.includes(w)).length;
  const neg = NEGATIVE.filter(w => lower.includes(w)).length;
  if (pos === neg) return 'neutral';
  return pos > neg ? 'positive' : 'negative';
}

export function aggregateSentiment(tweets) {
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const tweet of tweets) {
    counts[scoreSentiment(tweet.text)]++;
  }
  const total = tweets.length || 1;
  return {
    positiveRatio: +(counts.positive / total).toFixed(3),
    negativeRatio: +(counts.negative / total).toFixed(3),
    netSentiment: +((counts.positive - counts.negative) / total).toFixed(3)
  };
}
```

---

## Building a Health Score Dashboard

Combine all metrics into a single health score and store daily snapshots:

```javascript
// src/health/healthScore.js
export function computeHealthScore({ engagementRate, replyToLikeRatio, suspiciousRatio, netSentiment }) {
  let score = 100;
  if (engagementRate < 0.5) score -= 20;
  if (replyToLikeRatio < 0.05) score -= 15;
  if (suspiciousRatio > 0.2) score -= 25;
  if (suspiciousRatio > 0.35) score -= 20; // stacks
  if (netSentiment < -0.1) score -= 15;
  if (netSentiment < -0.3) score -= 10; // stacks
  return Math.max(0, score);
}
```

---

## Conclusion

Community health monitoring on X gives crypto researchers and project managers a systematic view of what engagement metrics actually mean. The difference between a 500k-follower community with 3% authentic engagement and one with 50k followers and 8% authentic engagement is enormous for long-term project viability. Combining engagement quality analysis, bot heuristics on follower samples, and sentiment trend tracking — all derived from X API data — gives you a repeatable, auditable health assessment that surfaces manipulation and decay before they become obvious price or community events.
