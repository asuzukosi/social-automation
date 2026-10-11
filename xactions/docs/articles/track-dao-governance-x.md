# How to Track DAO Governance Announcements on X

**Meta description:** Build a system to monitor DAO governance proposals, votes, and treasury decisions announced on X using filtered streams, keyword rules, and automated alerting.

---

## Introduction

DAO governance moves fast. A Compound proposal can pass in 48 hours; a Uniswap treasury vote can shift millions in under a week. Most governance announcements are posted on X first — before Snapshot, before Discord, before the protocol's own forum. If you're building a governance tracker, an on-chain monitoring tool, or an investment dashboard, you need to capture these announcements at source. This guide shows you how to do it systematically.

---

## Understanding What Governance Announcements Look Like on X

Before building any filter, map the signal space. DAO governance announcements on X fall into four categories:

1. **Proposal creation** — "We've submitted UIP-42 for community vote"
2. **Voting reminders** — "48 hours left to vote on Proposal #18"
3. **Result announcements** — "UIP-42 passed with 87% approval"
4. **Treasury/parameter changes** — "Following the vote, fees will change to 0.3%"

Each category has different keyword patterns, author profiles, and urgency levels. Build separate detection logic for each.

---

## Setting Up X API Filtered Stream Rules

The filtered stream endpoint lets you define rules that match tweets in real time. Governance rules should combine token cashtags, known account handles, and governance vocabulary:

```javascript
const governanceRules = [
  // DAO-specific governance keywords
  { value: '(governance OR proposal OR "snapshot vote" OR "on-chain vote") (dao OR protocol) -is:retweet lang:en', tag: 'governance-generic' },

  // Major protocol accounts
  { value: 'from:uniswap OR from:compoundfinance OR from:AaveAave OR from:MakerDAO lang:en', tag: 'protocol-accounts' },

  // Proposal lifecycle keywords + cashtags
  { value: '("proposal passed" OR "vote started" OR "quorum reached" OR "voting period") ($UNI OR $COMP OR $AAVE OR $MKR) -is:retweet', tag: 'proposal-lifecycle' },

  // Snapshot and Tally links often accompany governance posts
  { value: '(snapshot.org OR tally.xyz) -is:retweet', tag: 'governance-links' },
];

await xClient.post('tweets/search/stream/rules', {
  add: governanceRules,
});
```

Use the `tag` field to route matched tweets to different processing pipelines — a "protocol-accounts" match warrants an immediate alert; "governance-generic" might go into a review queue.

---

## Building the Account Allowlist

Official protocol accounts are the highest-signal source. Maintain a structured allowlist:

```javascript
const daoAccounts = {
  uniswap:   { handle: 'Uniswap',         token: 'UNI',  snapshotSpace: 'uniswap' },
  compound:  { handle: 'compoundfinance',  token: 'COMP', snapshotSpace: 'comp-vote.eth' },
  aave:      { handle: 'AaveAave',         token: 'AAVE', snapshotSpace: 'aave.eth' },
  maker:     { handle: 'MakerDAO',         token: 'MKR',  snapshotSpace: 'makerdao.eth' },
  curve:     { handle: 'CurveFinance',     token: 'CRV',  snapshotSpace: 'curve.eth' },
};
```

When a tweet from an allowlisted account is detected, skip the classification step and escalate directly to your alert channel.

---

## Parsing Governance Tweets

Raw tweet text needs structured extraction before it's useful. Use regex plus an LLM fallback for ambiguous posts:

```javascript
function extractGovernanceSignal(text) {
  const proposalId = text.match(/(?:proposal|UIP|GIP|AIP|SIP)[- #]?(\d+)/i)?.[1];
  const voteUrl = text.match(/https?:\/\/(?:snapshot\.org|tally\.xyz)\/[^\s]+/)?.[0];
  const result = /passed|approved|rejected|defeated/i.exec(text)?.[0]?.toLowerCase();

  return {
    proposalId: proposalId ?? null,
    voteUrl: voteUrl ?? null,
    result: result ?? null,
    needsReview: !proposalId && !voteUrl, // flag for manual review
  };
}
```

If `needsReview` is true and engagement is high, route to an LLM for structured extraction before discarding.

---

## Storing and Deduplicating Governance Events

Store governance events in a dedicated table separate from your general tweet store:

```sql
CREATE TABLE governance_events (
  id            SERIAL PRIMARY KEY,
  tweet_id      BIGINT UNIQUE,
  dao_slug      TEXT,
  proposal_id   TEXT,
  event_type    TEXT CHECK (event_type IN ('proposal', 'vote', 'result', 'treasury')),
  vote_url      TEXT,
  detected_at   TIMESTAMPTZ DEFAULT NOW(),
  alerted       BOOLEAN DEFAULT FALSE
);
```

The `UNIQUE` constraint on `tweet_id` prevents duplicate rows from multiple stream reconnections.

---

## Alerting Pipeline

Route high-confidence governance events to wherever your team monitors:

```javascript
async function handleGovernanceEvent(tweet, signal) {
  if (!signal.needsReview && (signal.voteUrl || signal.proposalId)) {
    await db.governanceEvent.create({ data: { ... } });
    await sendAlert({
      channel: '#dao-governance',
      text: `📋 New governance event detected\n${tweet.text}\n${signal.voteUrl ?? ''}`,
    });
  }
}
```

Add a 5-minute deduplication window in Redis so a viral governance tweet that gets retweeted 500 times doesn't send 500 alerts.

---

## Enriching with On-Chain Data

Once you've captured a governance announcement, cross-reference with Snapshot or the protocol's governance contract:

```javascript
async function enrichWithSnapshot(space, proposalId) {
  const res = await fetch('https://hub.snapshot.org/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: `{ proposal(id: "${proposalId}") { title state scores_total end } }`,
    }),
  });
  return (await res.json()).data?.proposal;
}
```

Attach this enriched data to the governance event record so downstream consumers don't need to re-fetch it.

---

## Conclusion

Tracking DAO governance on X is a filtering problem as much as a data problem. High-signal rules targeting protocol accounts and governance-specific vocabulary deliver most of the value. Pair that with structured extraction, on-chain enrichment, and a reliable alert pipeline, and you have a system that catches governance events minutes after they're posted — well before most market participants see them.
