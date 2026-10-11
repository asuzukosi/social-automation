# How to Analyze Crypto Influencer Engagement on X

**Meta description:** Learn how to collect and analyze crypto influencer engagement metrics on X using the API v2, including engagement rate calculation, audience overlap, and content performance.

---

## Introduction

Crypto influencer analysis is core intelligence work: which accounts actually move markets, which have inflated follower counts, and which content formats drive the most engagement in your niche. The X API v2 gives you the data to answer these questions programmatically. This guide walks through collecting influencer metrics, computing engagement rates, and identifying genuine signal from noise.

## Defining the Influencer Set

Start with a seed list of accounts. You can build this from known handles, from users who frequently appear in relevant tweet threads, or from accounts that tweet specific keywords:

```javascript
const CRYPTO_INFLUENCERS = [
  'VitalikButerin',
  'cz_binance',
  'elonmusk',
  'sassal0x',
  'cobie',
  // expand programmatically...
];

async function resolveHandlesToIds(handles, bearerToken) {
  const usernames = handles.join(',');
  const res = await fetch(
    `https://api.twitter.com/2/users/by?usernames=${usernames}&user.fields=public_metrics,description,verified`,
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );
  const data = await res.json();
  return data.data ?? [];
}
```

## Fetching Recent Tweets and Metrics

For each influencer, pull their recent tweets with engagement metrics:

```javascript
async function getUserTweets(userId, bearerToken, maxResults = 100) {
  const params = new URLSearchParams({
    max_results: maxResults,
    'tweet.fields': 'created_at,public_metrics,entities,referenced_tweets',
    exclude: 'retweets',
  });

  const res = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?${params}`,
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );

  const data = await res.json();
  return data.data ?? [];
}
```

The `public_metrics` object gives you `like_count`, `retweet_count`, `reply_count`, `quote_count`, and `impression_count` (if available on the access tier).

## Computing Engagement Rate

Engagement rate = (likes + retweets + replies + quotes) / impressions. Without impressions (limited to elevated access), use follower count as the denominator — a common approximation:

```javascript
function computeEngagementRate(tweet, followerCount) {
  const { like_count, retweet_count, reply_count, quote_count, impression_count } = tweet.public_metrics;
  const totalEngagements = like_count + retweet_count + reply_count + quote_count;
  const denominator = impression_count ?? followerCount;
  return denominator > 0 ? (totalEngagements / denominator) * 100 : 0;
}

function analyzeInfluencer(user, tweets) {
  if (!tweets.length) return null;

  const followerCount = user.public_metrics.followers_count;
  const rates = tweets.map(t => computeEngagementRate(t, followerCount));
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const medianRate = rates.sort((a, b) => a - b)[Math.floor(rates.length / 2)];

  const topTweet = tweets.reduce((best, t) => {
    const eng = computeEngagementRate(t, followerCount);
    return eng > computeEngagementRate(best, followerCount) ? t : best;
  });

  return {
    username: user.username,
    followers: followerCount,
    avgEngagementRate: avgRate,
    medianEngagementRate: medianRate,
    topTweet: { id: topTweet.id, text: topTweet.text.slice(0, 80) },
    tweetsAnalyzed: tweets.length,
  };
}
```

## Detecting Fake Engagement

Low follower-to-following ratios, abnormally high like counts relative to replies, and sudden spikes in engagement are all red flags. Check these signals:

```javascript
function suspicionScore(user, tweets) {
  const { followers_count, following_count, tweet_count } = user.public_metrics;
  let score = 0;

  // Follower/following ratio below 1 is suspicious for large accounts
  if (followers_count > 10000 && following_count > followers_count) score += 2;

  // Very high likes with almost no replies suggests bot farms
  const avgLikes = tweets.reduce((s, t) => s + t.public_metrics.like_count, 0) / tweets.length;
  const avgReplies = tweets.reduce((s, t) => s + t.public_metrics.reply_count, 0) / tweets.length;
  if (avgReplies > 0 && avgLikes / avgReplies > 100) score += 3;

  // Account created recently with lots of followers
  // (requires created_at field on user — add to user.fields query)

  return { score, suspicious: score >= 3 };
}
```

## Content Format Performance Breakdown

Break down performance by content type — plain text, with URLs, with media, thread starters:

```javascript
function categorizeContentFormats(tweets) {
  const categories = {
    plainText: [],
    withUrl: [],
    withMedia: [],
    threadStarter: [],
  };

  for (const tweet of tweets) {
    const hasUrl = tweet.entities?.urls?.length > 0;
    const hasMedia = tweet.entities?.media?.length > 0;
    const isThreadStart = tweet.referenced_tweets?.some(r => r.type === 'replied_to') === false;

    if (hasMedia) categories.withMedia.push(tweet);
    else if (hasUrl) categories.withUrl.push(tweet);
    else if (isThreadStart) categories.threadStarter.push(tweet);
    else categories.plainText.push(tweet);
  }

  return Object.fromEntries(
    Object.entries(categories).map(([key, group]) => {
      const avgLikes = group.length
        ? group.reduce((s, t) => s + t.public_metrics.like_count, 0) / group.length
        : 0;
      return [key, { count: group.length, avgLikes: avgLikes.toFixed(1) }];
    })
  );
}
```

## Aggregating Across the Full Influencer Set

```javascript
async function runInfluencerAnalysis(handles, bearerToken) {
  const users = await resolveHandlesToIds(handles, bearerToken);
  const results = [];

  for (const user of users) {
    const tweets = await getUserTweets(user.id, bearerToken);
    const analysis = analyzeInfluencer(user, tweets);
    const suspicion = suspicionScore(user, tweets);
    const formats = categorizeContentFormats(tweets);

    results.push({ ...analysis, suspicion, formats });

    await new Promise(r => setTimeout(r, 1200)); // rate limit gap
  }

  return results.sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
}
```

## Conclusion

Crypto influencer analysis requires more than follower counts. Engagement rate, like/reply ratios, and content format performance give you a clearer picture of which accounts have genuine audience relationships. Automate this analysis on a weekly cadence and you'll quickly surface which voices actually drive conversation in your target market.
