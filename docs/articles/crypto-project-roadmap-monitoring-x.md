# How to Use X API for Crypto Project Roadmap Monitoring

**Meta description:** Use the X API to automatically track crypto project roadmap updates, milestone announcements, and timeline changes from official project handles and core team members.

---

## Introduction

Crypto roadmaps shift constantly. Mainnet launches get delayed, features get cut, new milestones appear without notice. For investors, competing protocols, and integration partners, catching these changes early is a competitive advantage. Most projects announce roadmap updates on X before they update their docs.

This guide walks through building a system that tracks roadmap-related tweets from target projects, detects milestone language, and maintains a structured timeline of what was promised versus what was delivered.

---

## Defining Your Monitoring Scope

### Which Accounts Matter

For roadmap tracking, you need both official handles and core contributor accounts. Official handles post polished announcements; core contributors often post early signals in plain language.

```javascript
const MONITORED_PROJECTS = {
  ethereum: {
    official: ['2906364936'], // @ethereum
    coreTeam: ['295218901', '110754491', '24484128'] // Vitalik, etc.
  },
  solana: {
    official: ['951329744804392960'],
    coreTeam: ['3021318360', '948084357992493056']
  },
  arbitrum: {
    official: ['1430356939962957829'],
    coreTeam: ['1074440135980015617']
  }
};
```

### Roadmap Signal Keywords

```javascript
const ROADMAP_KEYWORDS = {
  milestones: [
    'mainnet', 'testnet', 'launch', 'deployed', 'live', 'shipped',
    'goes live', 'go-live', 'milestone', 'v2', 'v3', 'upgrade'
  ],
  delays: [
    'delayed', 'postponed', 'pushed back', 'rescheduled', 'timeline update',
    'taking longer', 'not ready', 'more time needed'
  ],
  features: [
    'feature', 'capability', 'support for', 'introducing', 'announcing',
    'now available', 'coming soon', 'roadmap', 'Q1', 'Q2', 'Q3', 'Q4'
  ]
};
```

---

## Stream Setup

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function setupRoadmapStream() {
  const rules = [];

  for (const [project, accounts] of Object.entries(MONITORED_PROJECTS)) {
    const allIds = [...accounts.official, ...accounts.coreTeam];
    const fromClause = allIds.map(id => `from:${id}`).join(' OR ');
    const keywordClause = [
      ...ROADMAP_KEYWORDS.milestones,
      ...ROADMAP_KEYWORDS.delays
    ].slice(0, 10).map(k => `"${k}"`).join(' OR ');

    rules.push({
      value: `(${fromClause}) (${keywordClause}) -is:retweet`,
      tag: `roadmap-${project}`
    });
  }

  const { data } = await client.v2.updateStreamRules({ add: rules });
  console.log('Roadmap stream rules added:', data?.length);
}
```

---

## Classifying Roadmap Events

Parse each tweet into a structured roadmap event:

```javascript
function classifyRoadmapTweet(text, projectTag) {
  const lower = text.toLowerCase();

  const isDelay = ROADMAP_KEYWORDS.delays.some(k => lower.includes(k));
  const isMilestone = ROADMAP_KEYWORDS.milestones.some(k => lower.includes(k));
  const isFeature = ROADMAP_KEYWORDS.features.some(k => lower.includes(k));

  // Extract quarter references
  const quarterMatch = text.match(/Q([1-4])\s*['']?(\d{2,4})?/i);
  const quarter = quarterMatch
    ? `Q${quarterMatch[1]}${quarterMatch[2] ? ' ' + quarterMatch[2] : ''}`
    : null;

  // Extract version references
  const versionMatch = text.match(/v(\d+(?:\.\d+)*)/i);
  const version = versionMatch ? versionMatch[0] : null;

  return {
    project: projectTag.replace('roadmap-', ''),
    eventType: isDelay ? 'DELAY' : isMilestone ? 'MILESTONE' : isFeature ? 'FEATURE' : 'GENERAL',
    quarter,
    version,
    isDelay,
    isMilestone,
    rawText: text
  };
}
```

---

## Building the Roadmap Timeline

Store events in a structured format that lets you reconstruct the project's public roadmap over time:

```javascript
async function storeRoadmapEvent(event, tweet) {
  await db.query(
    `INSERT INTO roadmap_events
     (tweet_id, project, event_type, quarter_ref, version_ref, is_delay,
      is_milestone, raw_text, author_id, tweet_url, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [
      tweet.id, event.project, event.eventType, event.quarter,
      event.version, event.isDelay, event.isMilestone, event.rawText,
      tweet.author_id, `https://x.com/i/web/status/${tweet.id}`,
      tweet.created_at
    ]
  );
}

async function getProjectTimeline(project, limit = 50) {
  return db.query(
    `SELECT event_type, quarter_ref, version_ref, raw_text, tweet_url, created_at
     FROM roadmap_events
     WHERE project = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [project, limit]
  );
}
```

---

## Delay Detection and Diffing

The most valuable signal is when a previously announced timeline changes. Detect this by comparing current milestone announcements to historical ones:

```javascript
async function detectTimelineConflict(event) {
  if (!event.version && !event.quarter) return null;

  // Find previous announcements about the same version/quarter
  const previous = await db.query(
    `SELECT raw_text, quarter_ref, created_at, tweet_url
     FROM roadmap_events
     WHERE project = $1
       AND (version_ref = $2 OR quarter_ref = $3)
       AND created_at < NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC
     LIMIT 5`,
    [event.project, event.version, event.quarter]
  );

  if (previous.rows.length === 0) return null;

  const latestPrevious = previous.rows[0];
  const hasConflict = event.isDelay ||
    (event.quarter && latestPrevious.quarter_ref &&
     event.quarter !== latestPrevious.quarter_ref);

  return hasConflict ? {
    conflict: true,
    originalTweet: latestPrevious.tweet_url,
    originalDate: latestPrevious.created_at,
    originalText: latestPrevious.raw_text
  } : null;
}
```

---

## Sending Roadmap Alerts

```javascript
async function alertOnRoadmapEvent(event, tweet, conflict) {
  const emoji = event.isDelay ? '🔴' : event.isMilestone ? '🟢' : '🔵';
  const conflictNote = conflict
    ? `\n⚠️ Conflicts with previous announcement: ${conflict.originalTweet}`
    : '';

  await postToSlack('#roadmap-tracker', {
    text: `${emoji} *[${event.project.toUpperCase()}]* ${event.eventType}${event.quarter ? ` — ${event.quarter}` : ''}${event.version ? ` (${event.version})` : ''}`,
    attachments: [{
      text: tweet.text + conflictNote,
      footer: `https://x.com/i/web/status/${tweet.id}`
    }]
  });
}
```

---

## Conclusion

X API filtered streams let you build a live roadmap tracker that captures official announcements and core team signals the moment they're posted. The critical value-add is the conflict detection layer — automatically surfacing when new timeline references contradict previous ones. This turns a raw tweet feed into a structured, queryable audit trail of what projects promised versus when they delivered.
