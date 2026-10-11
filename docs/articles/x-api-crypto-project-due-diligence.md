# How to Use X API for Crypto Project Due Diligence

**Meta description:** Use the X API to automate crypto project due diligence — analyze team credibility, community health, engagement authenticity, and red flag detection programmatically.

---

## Introduction

When evaluating a crypto project — whether for investment, integration, or partnership — X data is one of the richest sources of ground truth available. The X history of a project's founders, the authenticity of their community engagement, the timeline of their announcements, and how they respond to criticism all reveal more about project quality than any whitepaper.

This guide covers building a Node.js due diligence tool that runs a systematic X-based analysis on any crypto project, producing a scored report you can use as part of a broader evaluation framework.

---

## The Due Diligence Data Model

A complete X-based due diligence report covers five dimensions:

1. **Team credibility** — history, consistency, past projects
2. **Community authenticity** — real followers vs bots, engagement quality
3. **Communication patterns** — posting frequency, response to criticism
4. **Announcement timeline** — claim verification, delivery history
5. **Red flags** — deleted tweets, coordinated inauthentic behavior

---

## Fetching Project and Team Account Data

Start by resolving the project's X account and any identified team members:

```javascript
async function resolveProjectAccounts(handles) {
  const res = await fetch(
    `https://api.twitter.com/2/users/by?usernames=${handles.join(',')}&user.fields=created_at,public_metrics,description,verified,entities`,
    { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
  );
  const { data } = await res.json();
  return data ?? [];
}

function analyzeAccountBasics(user) {
  const ageMs = Date.now() - new Date(user.created_at).getTime();
  const ageDays = ageMs / 86400000;

  return {
    username: user.username,
    followersCount: user.public_metrics.followers_count,
    followingCount: user.public_metrics.following_count,
    tweetCount: user.public_metrics.tweet_count,
    listedCount: user.public_metrics.listed_count,
    accountAgeDays: Math.floor(ageDays),
    followerToFollowingRatio: user.public_metrics.followers_count /
      Math.max(user.public_metrics.following_count, 1),
    verified: user.verified,
    hasWebsiteLink: !!user.entities?.url,
    bioLength: user.description?.length ?? 0,
  };
}
```

---

## Community Authenticity Analysis

High follower counts mean nothing if they're bots. Analyze follower quality signals:

```javascript
async function analyzeFollowerQuality(userId) {
  // Sample recent followers (limited by API tier)
  const res = await fetch(
    `https://api.twitter.com/2/users/${userId}/followers?max_results=100&user.fields=created_at,public_metrics,description`,
    { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
  );
  const { data: followers } = await res.json();
  if (!followers?.length) return null;

  const analysis = followers.map(f => ({
    hasProfilePic: !f.profile_image_url?.includes('default_profile'),
    hasBio: (f.description?.length ?? 0) > 10,
    hasFollowers: f.public_metrics.followers_count > 10,
    hasTweets: f.public_metrics.tweet_count > 5,
    accountAge: (Date.now() - new Date(f.created_at).getTime()) / 86400000,
    following: f.public_metrics.following_count,
    followers: f.public_metrics.followers_count,
  }));

  const suspiciousCount = analysis.filter(f =>
    !f.hasBio && !f.hasFollowers && f.accountAge < 30
  ).length;

  const botScore = (suspiciousCount / followers.length) * 100;

  return {
    sampleSize: followers.length,
    suspiciousAccounts: suspiciousCount,
    estimatedBotPercentage: botScore.toFixed(1),
    averageFollowerAge: (analysis.reduce((s, f) => s + f.accountAge, 0) / analysis.length).toFixed(0),
    qualityScore: Math.max(0, 100 - botScore * 1.5),
  };
}
```

---

## Engagement Authenticity Check

Artificial engagement (coordinated likes/RTs) is detectable by pattern:

```javascript
async function analyzeEngagementPatterns(userId) {
  // Fetch last 50 tweets
  const res = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?max_results=50&tweet.fields=created_at,public_metrics,text`,
    { headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` } }
  );
  const { data: tweets } = await res.json();
  if (!tweets?.length) return null;

  const metrics = tweets.map(t => ({
    likes: t.public_metrics.like_count,
    retweets: t.public_metrics.retweet_count,
    replies: t.public_metrics.reply_count,
    date: new Date(t.created_at),
    text: t.text,
  }));

  // Check for suspiciously uniform engagement (bot-like)
  const likes = metrics.map(m => m.likes);
  const avgLikes = likes.reduce((a, b) => a + b, 0) / likes.length;
  const variance = likes.reduce((s, l) => s + Math.pow(l - avgLikes, 2), 0) / likes.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = (stdDev / avgLikes) * 100;

  // Natural engagement has high CV; bot-inflated has low CV
  const engagementIsNatural = coefficientOfVariation > 50;

  // Check reply-to-like ratio (low replies with high likes = bot likes)
  const totalLikes = likes.reduce((a, b) => a + b, 0);
  const totalReplies = metrics.reduce((s, m) => s + m.replies, 0);
  const replyToLikeRatio = totalReplies / Math.max(totalLikes, 1);

  return {
    avgLikesPerTweet: avgLikes.toFixed(0),
    engagementVariation: coefficientOfVariation.toFixed(1),
    engagementIsNatural,
    replyToLikeRatio: replyToLikeRatio.toFixed(3),
    suspiciouslyLowReplies: replyToLikeRatio < 0.01,
    tweetCount: tweets.length,
  };
}
```

---

## Red Flag Detection

```javascript
function detectRedFlags(accountData, followerQuality, engagementData) {
  const redFlags = [];
  const warnings = [];

  // Account age vs follower count
  if (accountData.accountAgeDays < 90 && accountData.followersCount > 50_000) {
    redFlags.push('Extremely rapid follower growth on new account');
  }

  // Follower to following ratio
  if (accountData.followerToFollowingRatio < 0.5 && accountData.followersCount > 5_000) {
    warnings.push('Unusual follow-back ratio — possible follow-for-follow farming');
  }

  // Bot percentage
  if (followerQuality?.estimatedBotPercentage > 40) {
    redFlags.push(`High estimated bot follower percentage: ${followerQuality.estimatedBotPercentage}%`);
  } else if (followerQuality?.estimatedBotPercentage > 20) {
    warnings.push(`Elevated estimated bot followers: ${followerQuality.estimatedBotPercentage}%`);
  }

  // Engagement authenticity
  if (engagementData?.suspiciouslyLowReplies) {
    redFlags.push('Abnormally low reply-to-like ratio — suggests artificial like inflation');
  }
  if (!engagementData?.engagementIsNatural) {
    warnings.push('Engagement variation is suspiciously uniform — possible coordinated boosting');
  }

  // Very low tweet count relative to followers
  if (accountData.tweetCount < 100 && accountData.followersCount > 10_000) {
    warnings.push('Very few tweets for follower count — possible purchased followers');
  }

  return { redFlags, warnings, score: Math.max(0, 100 - redFlags.length * 25 - warnings.length * 10) };
}
```

---

## Generating the Due Diligence Report

```javascript
async function runDueDiligence(projectHandle) {
  const [account] = await resolveProjectAccounts([projectHandle]);
  if (!account) throw new Error(`Account @${projectHandle} not found`);

  const [basics, followerQuality, engagement] = await Promise.all([
    Promise.resolve(analyzeAccountBasics(account)),
    analyzeFollowerQuality(account.id),
    analyzeEngagementPatterns(account.id),
  ]);

  const { redFlags, warnings, score } = detectRedFlags(basics, followerQuality, engagement);

  return {
    handle: projectHandle,
    analyzedAt: new Date().toISOString(),
    overallScore: score,
    accountBasics: basics,
    followerQuality,
    engagementPatterns: engagement,
    redFlags,
    warnings,
    verdict: score >= 70 ? 'PASS' : score >= 40 ? 'CAUTION' : 'FAIL',
  };
}
```

---

## Conclusion

X-based due diligence provides a systematic, automatable layer of project analysis that complements on-chain metrics and whitepaper review. The most valuable signals are engagement pattern variance (natural vs artificial), follower quality sampling, reply-to-like ratios, and account age relative to growth. Run this analysis on project accounts, founder accounts, and key team members separately — the combination reveals far more than any single dimension. Output the report as JSON and feed it into your broader scoring framework alongside tokenomics, GitHub activity, and on-chain data.
