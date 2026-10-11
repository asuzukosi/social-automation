# How to Scrape Crypto Influencer Data from X

**Meta description:** Practical guide to scraping crypto influencer data from X — using X API v2 user lookup and timeline endpoints, building a KOL scoring system, and extracting posting patterns without violating rate limits.

---

## Introduction

Crypto Key Opinion Leaders (KOLs) move markets. A tweet from a high-credibility account can send a token up 20% within minutes. Scraping and analyzing influencer data — posting frequency, engagement rates, follower growth, topic focus — lets you build watchlists, track alpha, and score credibility before acting on information.

This guide covers the mechanics of pulling influencer data from X: authenticating, querying user profiles, pulling tweet timelines, and computing engagement metrics.

---

## What "Scraping" Means Here

"Scraping" in the X API context means programmatic data collection via official endpoints — not crawling HTML or bypassing rate limits. Using the User Lookup and Timelines endpoints is compliant with X's developer terms at the appropriate access tier.

For browser-based scraping without API costs, tools like [XActions](https://xactions.app) offer pay-per-request access to X profile and timeline data.

---

## Step 1: Build Your Influencer Seed List

Start with a manually curated list of known crypto influencers. Organize by niche:

```javascript
const seedInfluencers = {
  bitcoin: ['saylor', 'DocumentingBTC', 'WClementeIII', 'BitcoinMagazine'],
  ethereum: ['VitalikButerin', 'sassal0x', 'TimBeiko'],
  defi: ['Tetranode', 'DefiMoon', 'ChainLinkGod'],
  memecoins: ['muradmahmudov', 'HsakaTrades'],
  analysts: ['CryptoKaleo', 'DonAlt', 'CryptoCobain']
};
```

Expand this list by pulling followers of known influencers and filtering by engagement metrics.

---

## Step 2: Fetch User Profiles

The `/2/users/by` endpoint supports batch lookups of up to 100 usernames per request:

```javascript
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.BEARER_TOKEN);

async function fetchUserProfiles(usernames) {
  const res = await client.v2.usersByUsernames(usernames, {
    'user.fields': [
      'id', 'name', 'username', 'description', 'created_at',
      'public_metrics', 'verified', 'entities', 'pinned_tweet_id'
    ]
  });

  return res.data.map(user => ({
    id: user.id,
    username: user.username,
    name: user.name,
    bio: user.description,
    followers: user.public_metrics.followers_count,
    following: user.public_metrics.following_count,
    tweetCount: user.public_metrics.tweet_count,
    listed: user.public_metrics.listed_count,
    verified: user.verified ?? false,
    createdAt: user.created_at,
    // Follower/following ratio — inflated numbers flag suspicious accounts
    credibilityRatio: user.public_metrics.followers_count / Math.max(user.public_metrics.following_count, 1)
  }));
}
```

---

## Step 3: Pull Tweet Timelines

Fetch recent tweets for each influencer via the `/2/users/:id/tweets` endpoint:

```javascript
async function fetchUserTimeline(userId, maxTweets = 200) {
  const tweets = [];
  let paginationToken;

  do {
    const res = await client.v2.userTimeline(userId, {
      max_results: 100,
      pagination_token: paginationToken,
      exclude: ['retweets', 'replies'], // original content only
      'tweet.fields': ['created_at', 'public_metrics', 'entities', 'context_annotations', 'referenced_tweets'],
      'media.fields': ['type', 'url'],
      'expansions': ['attachments.media_keys']
    });

    tweets.push(...(res.data.data ?? []));
    paginationToken = res.data.meta?.next_token;
  } while (paginationToken && tweets.length < maxTweets);

  return tweets;
}
```

Timelines go back up to 3,200 tweets per user — X's hard cap for this endpoint.

---

## Step 4: Compute Engagement Metrics

Raw follower count is a weak signal. Compute engagement rate from actual post performance:

```javascript
function computeEngagementMetrics(tweets, followerCount) {
  if (!tweets.length) return null;

  const metrics = tweets.map(t => ({
    likes: t.public_metrics.like_count,
    retweets: t.public_metrics.retweet_count,
    replies: t.public_metrics.reply_count,
    quotes: t.public_metrics.quote_count,
    total: t.public_metrics.like_count +
           t.public_metrics.retweet_count +
           t.public_metrics.reply_count +
           t.public_metrics.quote_count
  }));

  const avgEngagement = metrics.reduce((sum, m) => sum + m.total, 0) / metrics.length;
  const engagementRate = (avgEngagement / followerCount) * 100;

  // Virality score — how often does content break out?
  const viralThreshold = avgEngagement * 5;
  const viralTweets = metrics.filter(m => m.total > viralThreshold).length;
  const viralRate = (viralTweets / tweets.length) * 100;

  return {
    avgEngagement: Math.round(avgEngagement),
    engagementRate: engagementRate.toFixed(2) + '%',
    viralRate: viralRate.toFixed(1) + '%',
    bestTweet: tweets[metrics.findIndex(m => m.total === Math.max(...metrics.map(x => x.total)))]
  };
}
```

A typical Twitter account has 0.5-1% engagement rate. Crypto KOLs with strong communities often hit 2-5%. Anything above 10% on consistent volume suggests genuine influence.

---

## Step 5: Analyze Posting Patterns

When do they post? What topics do they focus on? Are they consistent or erratic?

```javascript
function analyzePostingPatterns(tweets) {
  const hourCounts = new Array(24).fill(0);
  const dayCounts = new Array(7).fill(0);
  const topicFrequency = {};

  for (const tweet of tweets) {
    const date = new Date(tweet.created_at);
    hourCounts[date.getUTCHours()]++;
    dayCounts[date.getUTCDay()]++;

    // Extract cashtags and hashtags
    const cashtags = tweet.entities?.cashtags?.map(c => '$' + c.tag) ?? [];
    const hashtags = tweet.entities?.hashtags?.map(h => '#' + h.tag.toLowerCase()) ?? [];

    [...cashtags, ...hashtags].forEach(tag => {
      topicFrequency[tag] = (topicFrequency[tag] ?? 0) + 1;
    });
  }

  const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
  const topTopics = Object.entries(topicFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  const tweetsPerDay = tweets.length / 90; // assumes 90-day window

  return { peakHour, tweetsPerDay: tweetsPerDay.toFixed(1), topTopics };
}
```

---

## Step 6: Build a KOL Score

Combine signals into a single influencer score:

```javascript
function computeKOLScore(profile, engagement, patterns) {
  const scores = {
    // Scale: raw score → 0-100
    followers: Math.min(profile.followers / 100_000 * 30, 30),      // 30 pts max
    engagementRate: Math.min(parseFloat(engagement.engagementRate) * 10, 25), // 25 pts max
    credibilityRatio: Math.min(profile.credibilityRatio / 10 * 20, 20),       // 20 pts max
    consistency: Math.min(parseFloat(patterns.tweetsPerDay) * 5, 15),         // 15 pts max
    viralRate: Math.min(parseFloat(patterns.viralRate) * 2, 10)               // 10 pts max
  };

  const total = Object.values(scores).reduce((sum, s) => sum + s, 0);

  return {
    total: Math.round(total),
    breakdown: scores,
    tier: total >= 70 ? 'A' : total >= 50 ? 'B' : total >= 30 ? 'C' : 'D'
  };
}
```

---

## Rate Limits and Responsible Scraping

User timeline lookups are expensive at scale. Plan your data collection:

- Basic tier: 15 user lookups / 15 minutes; 5 timeline requests / 15 minutes
- Spread lookups across time — collect one influencer's data per minute
- Cache results — re-fetch weekly, not daily
- Store raw API responses for re-analysis without additional API calls

```javascript
// Simple file-based cache
import { writeFileSync, readFileSync, existsSync } from 'fs';

function cachedFetch(username, fetchFn, ttlHours = 24) {
  const cacheFile = `/tmp/xapi_cache_${username}.json`;
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (Date.now() - cached.timestamp < ttlHours * 3_600_000) return cached.data;
  }
  const data = fetchFn();
  writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), data }));
  return data;
}
```

---

## Conclusion

Crypto influencer data from X is a concrete, actionable input for trading signals, community analysis, and market intelligence. The X API v2 gives you everything you need: profile data, timelines, and engagement metrics. The work is in scoring — building a KOL ranking system that correlates with actual market impact requires calibration over time. Start with 20-30 seed accounts, track their predictions versus outcomes, and refine your scoring weights from there.

---

*Related: [Building a Bitcoin Sentiment Tracker with X API v2](./bitcoin-sentiment-tracker-x-api-v2.md)*
