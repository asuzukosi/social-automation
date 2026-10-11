# How to Build a Crypto Social Proof Verification Tool with X API

**Meta description:** Build a crypto social proof verification tool using X API to detect fake endorsements, bot-amplified projects, and manufactured hype before investing or listing.

---

## Introduction

Social proof is weaponized in crypto. Projects pay influencers for undisclosed promotions. Coordinated bot networks create artificial trending signals. Fake account communities simulate organic communities. Due diligence that skips social proof analysis is incomplete due diligence.

A social proof verification tool built on X data helps you answer: Is this project's community genuine? Are the endorsements organic? Is the engagement real or manufactured? This guide covers the technical implementation.

---

## What You're Measuring

Social proof verification in crypto has three layers:

1. **Follower quality**: Are the accounts in a project's community real humans?
2. **Engagement authenticity**: Are likes, retweets, and replies organic or bot-generated?
3. **Influencer legitimacy**: Are endorsing accounts aligned by conviction or by payment?

Each layer requires different data and different analysis.

---

## Layer 1: Follower Quality Analysis

```js
import { scrapeFollowers, scrapeProfile } from 'xactions';

async function analyzeFollowerQuality(username) {
  const followers = await scrapeFollowers(username, {
    sessionCookie: process.env.XACTIONS_SESSION_COOKIE,
    limit: 500 // Sample of 500 for efficiency
  });

  const scores = await Promise.all(
    followers.map(follower => scoreAccountQuality(follower))
  );

  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const suspiciousCount = scores.filter(s => s < 0.3).length;

  return {
    sampleSize: followers.length,
    averageQualityScore: avgScore,
    suspiciousAccountRate: suspiciousCount / followers.length,
    verdict: avgScore > 0.6 ? 'likely_genuine' : avgScore > 0.4 ? 'mixed' : 'likely_artificial'
  };
}

function scoreAccountQuality(account) {
  let score = 0.5; // Start neutral

  // Account age (older = more legit)
  const ageMonths = getAccountAgeMonths(account.createdAt);
  if (ageMonths > 24) score += 0.2;
  else if (ageMonths > 6) score += 0.1;
  else if (ageMonths < 1) score -= 0.2; // Very new account

  // Tweet volume vs. age ratio
  const tweetsPerMonth = account.tweetCount / Math.max(ageMonths, 1);
  if (tweetsPerMonth > 1000) score -= 0.15; // Suspiciously high activity
  if (tweetsPerMonth < 1) score -= 0.1;    // Essentially inactive

  // Follower/following ratio
  const ratio = account.followerCount / Math.max(account.followingCount, 1);
  if (ratio < 0.05) score -= 0.15; // Following many, followed by few
  if (ratio > 0.5) score += 0.1;

  // Profile completeness
  if (!account.bio) score -= 0.1;
  if (!account.profileImage || account.profileImage.includes('default_profile')) score -= 0.15;
  if (account.location) score += 0.05;

  // Username patterns (bots often have number-heavy usernames)
  const digitRatio = (account.username.match(/\d/g) || []).length / account.username.length;
  if (digitRatio > 0.4) score -= 0.1;

  return Math.min(Math.max(score, 0), 1);
}
```

---

## Layer 2: Engagement Authenticity

```js
async function analyzeEngagementAuthenticity(username) {
  const profile = await scrapeProfile(username, {
    sessionCookie: process.env.XACTIONS_SESSION_COOKIE
  });

  const recentTweets = profile.tweets.slice(0, 20);

  const metrics = recentTweets.map(tweet => ({
    likeRate: tweet.likeCount / Math.max(profile.followerCount, 1),
    replyRate: tweet.replyCount / Math.max(profile.followerCount, 1),
    retweetRate: tweet.retweetCount / Math.max(profile.followerCount, 1),
    engagementRate: (tweet.likeCount + tweet.replyCount + tweet.retweetCount) / Math.max(profile.followerCount, 1)
  }));

  const avgEngagement = metrics.reduce((a, b) => a + b.engagementRate, 0) / metrics.length;
  const engagementVariance = calculateVariance(metrics.map(m => m.engagementRate));

  // Legitimate accounts have consistent engagement with variance
  // Bot-inflated accounts often have suspiciously uniform or spiked engagement

  const engagementSuspiciouslyUniform = engagementVariance < 0.0001 && avgEngagement > 0.02;
  const engagementSpiked = metrics.some(m => m.engagementRate > avgEngagement * 10);

  return {
    averageEngagementRate: avgEngagement,
    engagementVariance,
    suspiciouslyUniform: engagementSuspiciouslyUniform,
    hasSuspiciousSpikes: engagementSpiked,
    verdict: (!engagementSuspiciouslyUniform && !engagementSpiked) ? 'authentic' : 'suspicious'
  };
}

function calculateVariance(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
}
```

---

## Layer 3: Influencer Alignment Analysis

Detect paid promotions by analyzing whether endorsements are accompanied by disclosures, patterns of simultaneous posting, or anomalous posting frequency.

```js
async function analyzeInfluencerEndorsements(projectUsername, endorserUsernames) {
  const results = [];

  for (const endorser of endorserUsernames) {
    const profile = await scrapeProfile(endorser, {
      sessionCookie: process.env.XACTIONS_SESSION_COOKIE
    });

    // Check for disclosure keywords
    const projectMentions = profile.tweets.filter(t =>
      t.text.toLowerCase().includes(projectUsername.toLowerCase())
    );

    const disclosureKeywords = ['ad', 'sponsored', 'paid', '#ad', '#sponsored', 'partner'];
    const hasDisclosure = projectMentions.some(t =>
      disclosureKeywords.some(kw => t.text.toLowerCase().includes(kw))
    );

    // Check if endorser also promotes many other projects (paid promoter pattern)
    const cryptoPromoTerms = /giveaway|airdrop|join|don't miss|limited time|100x/i;
    const promoTweetCount = profile.tweets.filter(t => cryptoPromoTerms.test(t.text)).length;
    const promoRate = promoTweetCount / profile.tweets.length;

    results.push({
      endorser,
      projectMentionCount: projectMentions.length,
      hasDisclosure,
      promoContentRate: promoRate,
      likelySponsoredAmbiguity: !hasDisclosure && projectMentions.length > 0 && promoRate > 0.3,
      verdict: hasDisclosure ? 'disclosed_paid' : promoRate > 0.3 ? 'likely_paid' : 'likely_organic'
    });
  }

  return results;
}
```

---

## Composite Scoring and Report

```js
async function generateVerificationReport(projectUsername) {
  const [followerQuality, engagementAuth] = await Promise.all([
    analyzeFollowerQuality(projectUsername),
    analyzeEngagementAuthenticity(projectUsername)
  ]);

  // Composite social proof score
  const followerScore = followerQuality.averageQualityScore;
  const engagementScore = engagementAuth.verdict === 'authentic' ? 0.8 : 0.3;

  const compositeScore = (followerScore * 0.5) + (engagementScore * 0.5);

  return {
    project: projectUsername,
    compositeScore,
    verdict: compositeScore > 0.65 ? 'likely_genuine' : compositeScore > 0.45 ? 'mixed_signals' : 'high_risk',
    details: {
      followerQuality,
      engagementAuthenticity: engagementAuth
    },
    analyzedAt: new Date().toISOString()
  };
}
```

---

## API Endpoint

```js
router.post('/verify/social-proof', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'username required' });
  }

  const report = await generateVerificationReport(username);
  res.json(report);
});
```

---

## Conclusion

Social proof verification is a systematic process, not a gut check. Follower quality scoring, engagement variance analysis, and influencer alignment detection each surface different categories of manipulation. Composite scoring across all three layers gives you a defensible, data-driven assessment before you list a project, invest in a token, or publicize an integration. The implementation above is a foundation — tune thresholds against your own dataset of known-legitimate and known-fraudulent projects.
