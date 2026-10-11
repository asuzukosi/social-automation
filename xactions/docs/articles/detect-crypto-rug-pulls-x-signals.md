# How to Detect Crypto Rug Pulls with X Social Signals

**Meta description:** Use X API social signals to detect early rug pull indicators in crypto projects — sudden follower drops, sentiment shifts, coordinated FUD, and team account behavior.

---

## Introduction

Most rug pulls leave social signals on X before the contract is drained. Dev accounts go quiet, coordinated sell pressure emerges in replies, followers drop rapidly, and sentiment shifts from euphoric to panicked in hours. These signals are detectable programmatically if you know what to monitor. This guide covers the specific X API data points and detection logic used to flag rug pull risk before the exit happens.

---

## The Social Signal Timeline of a Rug Pull

Understanding the typical sequence helps you know which signals to prioritize:

1. **T-48h to T-24h:** Dev and team accounts reduce posting frequency
2. **T-12h:** Coordinated FUD appears in replies from low-account-age wallets
3. **T-6h:** Project's follower count drops as bots/bought followers are removed
4. **T-2h:** Liquidity removal warnings surface in replies ("LP withdrawn" reports)
5. **T-0:** Token price crashes, on-chain confirmation

Social signals at stages 1–3 are actionable. Stage 4 is your last warning. Stage 5 is too late.

---

## Monitoring Dev Account Activity

For each project you track, maintain a record of the dev/team accounts and their posting behavior:

```javascript
async function trackDevActivity(projectId, devHandles) {
  const fromClause = devHandles.map(h => `from:${h}`).join(' OR ');
  const recent = await xClient.get('tweets/search/recent', {
    query: `(${fromClause}) -is:retweet`,
    tweet_fields: 'created_at,public_metrics',
    max_results: 20,
  });

  const latestTweet = recent.data?.[0];
  const hoursSinceLastTweet = latestTweet
    ? (Date.now() - new Date(latestTweet.created_at)) / 3600000
    : Infinity;

  if (hoursSinceLastTweet > 24) {
    await flagRisk(projectId, 'dev-silence', {
      severity: hoursSinceLastTweet > 48 ? 'high' : 'medium',
      detail: `${Math.round(hoursSinceLastTweet)}h since last dev tweet`,
    });
  }
}
```

Compare against a 30-day baseline of posting frequency — a team that normally posts 5x/day going silent for 12 hours is more significant than one that posts weekly.

---

## Detecting Follower Count Drops

Rug pull teams often buy followers to inflate credibility, then lose them in waves as bots are purged or the project collapses:

```sql
CREATE TABLE account_snapshots (
  id            SERIAL PRIMARY KEY,
  account_id    BIGINT NOT NULL,
  project_id    INTEGER REFERENCES projects(id),
  followers     INTEGER NOT NULL,
  following     INTEGER NOT NULL,
  tweet_count   INTEGER NOT NULL,
  snapshotted_at TIMESTAMPTZ DEFAULT NOW()
);
```

```javascript
async function checkFollowerDrop(projectId, accountId) {
  const current = await fetchUserMetrics(accountId);
  const yesterday = await db.accountSnapshot.findFirst({
    where: {
      accountId,
      snapshottedAt: { lte: new Date(Date.now() - 86400000) },
    },
    orderBy: { snapshottedAt: 'desc' },
  });

  if (!yesterday) return;

  const dropPercent = (yesterday.followers - current.followers_count) / yesterday.followers;
  if (dropPercent > 0.05) { // 5% follower drop in 24h
    await flagRisk(projectId, 'follower-drop', {
      severity: dropPercent > 0.15 ? 'high' : 'medium',
      detail: `${(dropPercent * 100).toFixed(1)}% follower drop`,
    });
  }
}
```

---

## Sentiment Analysis in Project Replies

Monitor the reply thread of the project's recent tweets for sentiment shifts:

```javascript
async function analyzeReplySentiment(projectHandle) {
  // Get recent tweets from the project account
  const tweets = await xClient.get('tweets/search/recent', {
    query: `from:${projectHandle} -is:retweet`,
    max_results: 5,
    tweet_fields: 'id,created_at',
  });

  const rugSignalKeywords = [
    'rug', 'scam', 'exit', 'dev left', 'lp removed', 'dumped',
    'honey pot', 'honeypot', 'avoid', 'warning', 'DYOR',
    'can\'t sell', 'liquidity gone', 'rekt',
  ];

  for (const tweet of tweets.data ?? []) {
    const replies = await xClient.get('tweets/search/recent', {
      query: `conversation_id:${tweet.id} is:reply`,
      max_results: 100,
      tweet_fields: 'text,public_metrics,author_id',
    });

    const rugSignals = replies.data?.filter(r =>
      rugSignalKeywords.some(kw => r.text.toLowerCase().includes(kw))
    ) ?? [];

    const signalRatio = rugSignals.length / Math.max(replies.data?.length ?? 1, 1);

    if (signalRatio > 0.15) { // More than 15% of replies are warning signals
      await flagRisk(tweet.projectId, 'reply-rug-signals', {
        severity: signalRatio > 0.30 ? 'critical' : 'high',
        detail: `${rugSignals.length} rug-signal replies on tweet ${tweet.id}`,
        sampleReplies: rugSignals.slice(0, 3).map(r => r.text),
      });
    }
  }
}
```

---

## Detecting Coordinated FUD Patterns

Coordinated FUD from newly created accounts is a red flag — often competing teams or the dev themselves creating panic to buy back cheaper. Detect it:

```javascript
async function detectCoordinatedActivity(replies) {
  const authorIds = replies.map(r => r.author_id);

  // Fetch author metadata in batch
  const users = await xClient.get('users', {
    ids: authorIds.join(','),
    'user.fields': 'created_at,public_metrics',
  });

  const newAccounts = users.data.filter(u => {
    const ageDays = (Date.now() - new Date(u.created_at)) / 86400000;
    return ageDays < 30; // Account under 30 days old
  });

  const newAccountRatio = newAccounts.length / users.data.length;

  if (newAccountRatio > 0.40) {
    return {
      coordinated: true,
      detail: `${(newAccountRatio * 100).toFixed(0)}% of replies from accounts under 30 days old`,
    };
  }

  return { coordinated: false };
}
```

---

## Risk Scoring and Alerting

Aggregate individual signals into a composite risk score:

```javascript
const RUG_RISK_WEIGHTS = {
  'dev-silence': { medium: 15, high: 35 },
  'follower-drop': { medium: 20, high: 40 },
  'reply-rug-signals': { high: 30, critical: 60 },
  'coordinated-fud': { detected: 25 },
};

async function computeRugRiskScore(projectId) {
  const flags = await db.rugRiskFlag.findMany({
    where: { projectId, createdAt: { gte: new Date(Date.now() - 86400000) } },
  });

  const score = flags.reduce((sum, flag) => {
    const weight = RUG_RISK_WEIGHTS[flag.type]?.[flag.severity] ?? 0;
    return sum + weight;
  }, 0);

  if (score >= 60) {
    await sendCriticalAlert(projectId, score, flags);
  }

  return score;
}
```

---

## Conclusion

Rug pull detection from X signals is probabilistic, not deterministic — you'll have false positives. The goal is early warning, not certainty. Dev silence, follower drops, and reply sentiment shifts are your highest-signal indicators. Build the monitoring infrastructure first, tune the thresholds against historical rugs in your dataset, and combine X signals with on-chain liquidity monitoring for the most reliable results.
