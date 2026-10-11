# How to Build a Crypto Project Team Activity Tracker on X

**Meta description:** Build a system to track and analyze crypto project team members' X activity, surfacing engagement trends, posting cadence, and silence signals for due diligence.

---

## Introduction

When evaluating a crypto project, on-chain metrics tell you what is happening. X activity tells you who is behind it and whether they are still paying attention. A team that goes silent on X before an announced mainnet launch is a red flag. A sudden burst of activity from the lead dev at 3 AM is worth noticing. Building an automated tracker that monitors the X accounts of known team members gives you a due diligence signal layer that most retail investors lack.

This guide walks you through building a tracker that polls team member timelines, stores activity metrics, and surfaces anomalies.

---

## Defining Your Watch List

Start with a structured config per project. Keep this in a JSON file that you can update as team composition changes.

```json
// config/watchlist.json
{
  "projects": [
    {
      "name": "ExampleProtocol",
      "chain": "ethereum",
      "members": [
        { "handle": "devlead_alice", "role": "CTO", "userId": "123456789" },
        { "handle": "mkt_bob", "role": "Marketing", "userId": "987654321" },
        { "handle": "protocol_carol", "role": "Lead Dev", "userId": "112233445" }
      ]
    }
  ]
}
```

Using numeric `userId` values is more reliable than handles — X allows handle changes, but user IDs are permanent.

---

## Fetching Timeline Activity

Use the user timeline endpoint to retrieve recent tweets for each team member. The v2 endpoint supports `tweet.fields` expansions for engagement metrics.

```javascript
// src/trackers/teamActivityFetcher.js
import fetch from 'node-fetch';

const BEARER = process.env.X_BEARER_TOKEN;

export async function fetchRecentActivity(userId, maxResults = 50) {
  const url = new URL(`https://api.twitter.com/2/users/${userId}/tweets`);
  url.searchParams.set('max_results', maxResults);
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,entities');
  url.searchParams.set('exclude', 'retweets');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BEARER}` }
  });

  const json = await res.json();
  return json.data ?? [];
}
```

Run this on a schedule — every 4 to 6 hours is sufficient for most due diligence use cases without burning through rate limits. The user timeline endpoint allows 1,500 requests per 15-minute window on the Basic tier.

---

## Computing Activity Metrics

For each team member, compute a rolling activity score based on posting cadence, reply ratio, and engagement rate.

```javascript
// src/trackers/metricsComputer.js
export function computeMetrics(tweets) {
  if (!tweets.length) return { postCount: 0, avgLikes: 0, avgReplies: 0, silenceDays: null };

  const now = Date.now();
  const latestTs = new Date(tweets[0].created_at).getTime();
  const silenceDays = (now - latestTs) / (1000 * 60 * 60 * 24);

  const totals = tweets.reduce(
    (acc, t) => ({
      likes: acc.likes + (t.public_metrics?.like_count ?? 0),
      replies: acc.replies + (t.public_metrics?.reply_count ?? 0),
      replyTweets: acc.replyTweets + (t.text.startsWith('@') ? 1 : 0)
    }),
    { likes: 0, replies: 0, replyTweets: 0 }
  );

  return {
    postCount: tweets.length,
    avgLikes: +(totals.likes / tweets.length).toFixed(2),
    avgReplies: +(totals.replies / tweets.length).toFixed(2),
    replyRatio: +(totals.replyTweets / tweets.length).toFixed(2),
    silenceDays: +silenceDays.toFixed(1)
  };
}
```

---

## Storing Snapshots in PostgreSQL

Persist daily snapshots so you can trend activity over time. A Prisma model keeps it clean.

```prisma
// prisma/schema.prisma (addition)
model TeamActivitySnapshot {
  id          String   @id @default(cuid())
  projectName String
  userHandle  String
  userId      String
  role        String
  postCount   Int
  avgLikes    Float
  avgReplies  Float
  replyRatio  Float
  silenceDays Float
  capturedAt  DateTime @default(now())
}
```

```javascript
// src/trackers/snapshotStore.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function saveSnapshot(member, projectName, metrics) {
  await prisma.teamActivitySnapshot.create({
    data: {
      projectName,
      userHandle: member.handle,
      userId: member.userId,
      role: member.role,
      ...metrics
    }
  });
}
```

---

## Detecting Anomalies

Two signals matter most: extended silence and sudden high-volume activity.

```javascript
// src/trackers/anomalyDetector.js
export function detectAnomalies(current, historical) {
  const alerts = [];

  // Silence alert: no posts in 7+ days when avg cadence was higher
  if (current.silenceDays >= 7 && historical.avgPostsPerWeek > 3) {
    alerts.push({
      type: 'SILENCE',
      message: `${current.userHandle} has been silent for ${current.silenceDays} days (avg: ${historical.avgPostsPerWeek} posts/week)`
    });
  }

  // Burst alert: post count 3x above rolling average
  const rollingAvgPosts = historical.avgPostsPerPeriod;
  if (current.postCount > rollingAvgPosts * 3) {
    alerts.push({
      type: 'BURST',
      message: `${current.userHandle} posted ${current.postCount} times vs avg ${rollingAvgPosts}`
    });
  }

  return alerts;
}
```

---

## Scheduling and Alerting

Wire the tracker into a Bull queue job that runs on a cron schedule:

```javascript
// api/services/teamTrackerJob.js
import { teamTrackerQueue } from './jobQueue.js';

teamTrackerQueue.add(
  { watchlistPath: './config/watchlist.json' },
  { repeat: { cron: '0 */6 * * *' } } // every 6 hours
);

teamTrackerQueue.process(async (job) => {
  const { projects } = await import(job.data.watchlistPath, { assert: { type: 'json' } });
  for (const project of projects) {
    for (const member of project.members) {
      const tweets = await fetchRecentActivity(member.userId);
      const metrics = computeMetrics(tweets);
      await saveSnapshot(member, project.name, metrics);
      // compare with historical and fire alerts
    }
  }
});
```

---

## Conclusion

A team activity tracker built on X API timelines gives crypto researchers a due diligence layer that complements on-chain analysis. Silence from a core dev, a sudden marketing burst before a token unlock, or a CTO switching from technical to promotional content are all signals worth catching early. The architecture here — JSON watchlist, periodic timeline fetches, metric snapshots in PostgreSQL, anomaly detection — is extensible to any number of projects and team members without significant infrastructure cost.
