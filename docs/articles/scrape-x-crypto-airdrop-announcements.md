# How to Scrape X for Crypto Airdrop Announcements

**Meta description:** Step-by-step guide to scraping X for crypto airdrop announcements using the X API v2 search endpoint, keyword filters, and structured data extraction in Node.js.

---

## Introduction

Airdrop announcements move fast on X. By the time a project tweets eligibility criteria, thousands of wallets are already submitting. If you're building an airdrop aggregator, a notification bot, or a research tool, automated scraping of X is the only scalable approach. This guide covers querying X's search endpoint for airdrop-related posts, filtering signal from noise, and extracting structured data for downstream processing.

---

## Why X Is the Primary Airdrop Signal Source

Project teams announce airdrops on X before anywhere else. Discord leaks happen, but official eligibility windows, snapshot dates, and claim links land on X first. The combination of verified account posts, retweet velocity, and keyword density makes X the highest-signal surface for airdrop detection.

---

## Setting Up X API v2 Search

You need an X Developer account with at least Basic access. The `recent` search endpoint covers the last 7 days. For historical data, use the `all` search endpoint (Academic Research access required, now largely restricted — use a third-party archive or filtered stream for real-time instead).

```bash
npm install twitter-api-v2 dotenv
```

```env
X_BEARER_TOKEN=your_bearer_token
```

---

## Building the Search Query

X API v2 uses a structured query language. Combine keywords, operators, and account filters to target airdrop announcements specifically:

```js
const AIRDROP_QUERY = [
  '(airdrop OR "token distribution" OR "claim your tokens" OR "snapshot date")',
  '-is:retweet',           // original posts only
  'lang:en',
  'has:links',             // most legit announcements include a link
  '-filter:spam',
].join(' ');
```

Add verified account filtering or minimum follower thresholds via `author_id` lists if you're building a curated feed.

---

## Querying the Search Endpoint

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

async function searchAirdrops(query, maxResults = 100) {
  const response = await client.v2.search(query, {
    max_results: maxResults,
    'tweet.fields': ['created_at', 'author_id', 'entities', 'public_metrics'],
    'user.fields': ['username', 'verified', 'public_metrics'],
    expansions: ['author_id', 'entities.urls.unwound_url'],
  });

  return response.data ?? [];
}
```

Request `entities` to extract URLs from tweets — airdrop posts almost always link to a claim page or blog post.

---

## Extracting Structured Airdrop Data

Raw tweet text requires parsing. Use regex patterns to extract key fields:

```js
function parseAirdropSignals(tweet) {
  const text = tweet.text.toLowerCase();

  return {
    id: tweet.id,
    authorId: tweet.author_id,
    createdAt: tweet.created_at,
    rawText: tweet.text,
    signals: {
      mentionsSnapshot: /snapshot/i.test(text),
      mentionsEligibility: /eligible|eligibility/i.test(text),
      mentionsClaim: /claim|claiming/i.test(text),
      mentionsDate: /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(text),
      hasLink: tweet.entities?.urls?.length > 0,
    },
    links: tweet.entities?.urls?.map(u => u.expanded_url) ?? [],
    engagement: tweet.public_metrics,
  };
}
```

Score each result by signal count to rank by announcement confidence.

---

## Filtering Scams and Noise

Airdrop scraping surfaces a high volume of scams. Apply these filters:

```js
function isLikelyLegitimate(tweet, author) {
  const followerCount = author?.public_metrics?.followers_count ?? 0;
  const likeCount = tweet.public_metrics?.like_count ?? 0;

  // Scam posts from tiny accounts with zero engagement
  if (followerCount < 1000 && likeCount < 10) return false;

  // Phishing patterns
  const text = tweet.text.toLowerCase();
  const scamPatterns = ['send eth', 'double your', 'connect wallet here', 'dm for whitelist'];
  if (scamPatterns.some(p => text.includes(p))) return false;

  return true;
}
```

Maintain a blocklist of known scam account IDs and update it regularly.

---

## Storing and Deduplicating Results

Airdrop announcements repeat across retweets, quote tweets, and reposts. Deduplicate by canonical tweet ID and track previously seen projects by domain:

```js
const seen = new Set();

function deduplicateAirdrops(tweets) {
  return tweets.filter(tweet => {
    if (seen.has(tweet.id)) return false;
    seen.add(tweet.id);
    return true;
  });
}
```

For persistent storage, write to PostgreSQL with a unique constraint on `tweet_id`.

---

## Running Continuous Monitoring with Filtered Stream

For real-time airdrop detection, the filtered stream endpoint is more efficient than polling search:

```js
const stream = await client.v2.searchStream({
  'tweet.fields': ['created_at', 'author_id', 'entities'],
});

for await (const tweet of stream) {
  const signals = parseAirdropSignals(tweet.data);
  if (signals.signals.mentionsClaim || signals.signals.mentionsSnapshot) {
    await notifyAirdrop(signals);
  }
}
```

Set stream rules via `POST /2/tweets/search/stream/rules` before opening the stream.

---

## Conclusion

Scraping X for airdrop announcements is a signal extraction problem: high volume, low precision. Use structured X API v2 queries with operator combinations to narrow the search, parse tweet entities for links, apply legitimacy scoring to reduce scams, and switch from polling to filtered stream for real-time coverage. From here, pipe results into a notification system, an aggregator UI, or an on-chain eligibility checker.
