# How to Use X API Search Operators for Crypto Research

**Meta description:** Master X API search operators for crypto research — cashtag filtering, engagement thresholds, language targeting, and combining operators to surface high-signal content.

---

## Introduction

X API search operators are the most underused tool in crypto research. Most developers query a single cashtag or keyword, get flooded with noise, and give up. The real power comes from operator combinations: filtering by engagement threshold, language, account type, link presence, and time range simultaneously. This guide covers every operator relevant to crypto research with working query examples.

---

## Foundational Operators for Crypto Queries

### Cashtag Operator

The `$` prefix matches financial ticker symbols specifically:

```
$BTC $ETH
```

This is more precise than the keyword `bitcoin` — it targets intentional market discussion rather than news articles and casual mentions.

### Combining Cashtags with OR / AND

```
($SOL OR $ETH OR $AVAX) (defi OR dex OR yield) -is:retweet
```

Use parentheses for grouping. Without them, OR has lower precedence than AND and your query will return unexpected results.

### Excluding Noise

Always add these to crypto queries:

```
-is:retweet -is:reply lang:en
```

Retweets are duplicates. Replies require context. Non-English content is valid but segment it separately. Noise reduction here has more impact than any positive filter you add.

---

## Engagement Filtering

X API v2 doesn't expose `min_faves` directly in the search query syntax, but you can filter post-response:

```javascript
const tweets = await xClient.get('tweets/search/recent', {
  query: '$ETH defi -is:retweet lang:en',
  max_results: 100,
  tweet_fields: 'public_metrics,created_at,author_id',
});

const highSignal = tweets.data.filter(t =>
  t.public_metrics.like_count > 50 ||
  t.public_metrics.retweet_count > 20
);
```

For the Academic/Enterprise stream, you can use `min_faves:50` and `min_retweets:10` directly in the query string — this is far more efficient.

---

## Source and Account Targeting

### Verified Accounts

```
$BTC is:verified -is:retweet
```

In the current X model, `is:verified` means Blue-subscribed or organization-verified. Useful as one signal, not as a quality gate by itself.

### From Specific Accounts

```
from:aantonop OR from:VitalikButerin OR from:cz_binance
```

Build a curated allowlist of high-signal accounts and query them directly:

```javascript
const handles = ['aantonop', 'VitalikButerin', 'inversebrah'];
const fromClause = handles.map(h => `from:${h}`).join(' OR ');
const query = `(${fromClause}) ($BTC OR $ETH) -is:retweet`;
```

### Accounts Mentioning a Project

```
@uniswap OR @aave governance -is:retweet
```

---

## URL and Media Operators

### Filtering for Threads with Context

```
$SOL "thread" OR "🧵" has:links -is:retweet
```

`has:links` catches tweets with URLs. Combined with thread indicators, this surfaces in-depth analysis rather than one-liners.

### Finding Research Reports

```
$ETH (analysis OR research OR "on-chain") has:links -is:retweet lang:en
```

### Video Content

```
$BTC has:videos -is:retweet
```

Useful for finding chart breakdowns and technical analysis videos.

---

## Time-Based Queries

The recent search endpoint covers the last 7 days. Use `start_time` and `end_time` for precision:

```javascript
const query = await xClient.get('tweets/search/recent', {
  query: '$DOGE -is:retweet lang:en',
  start_time: new Date(Date.now() - 3600 * 1000).toISOString(), // Last hour
  tweet_fields: 'public_metrics,created_at',
  max_results: 100,
});
```

For historical data beyond 7 days, you need the Full-Archive Search endpoint (Academic/Enterprise tier).

---

## Advanced Operator Combinations

### Detecting New Token Launches

```
("just launched" OR "stealth launch" OR "fair launch" OR "presale live") (contract OR CA OR "contract address") -is:retweet lang:en
```

### Tracking Exchange Listings

```
("now listed" OR "listing" OR "listed on") ($BTC OR binance OR coinbase OR kraken) -is:retweet
```

### Finding Whale Alerts and Large Transfers

```
("moved" OR "transferred" OR "whale") ("million" OR "billion") ($ETH OR $BTC) -is:retweet
```

### Sentiment Signals

```
$SOL (rugged OR "rug pull" OR scam OR warning) -is:retweet lang:en
```

```javascript
// Positive vs negative sentiment counts
const bullish = await searchCount('$ETH (bullish OR moon OR pump) -is:retweet lang:en');
const bearish = await searchCount('$ETH (bearish OR dump OR crash) -is:retweet lang:en');
const sentimentRatio = bullish / (bullish + bearish);
```

---

## Using the Counts Endpoint for Trend Detection

The counts endpoint returns tweet volume over time without fetching full tweet objects — much cheaper on rate limits:

```javascript
async function getTokenMentionTrend(symbol) {
  const response = await xClient.get('tweets/counts/recent', {
    query: `$${symbol} -is:retweet lang:en`,
    granularity: 'hour',
  });
  return response.data; // Array of { start, end, tweet_count }
}
```

Use this to detect volume spikes before pulling full tweet data. A 5x spike in mentions over the last hour warrants deeper analysis.

---

## Rate Limit Budgeting

| Endpoint | Free tier | Basic | Pro |
|---|---|---|---|
| Recent search | 1 req/15 min | 60 req/15 min | 300 req/15 min |
| Counts | Not available | 15 req/15 min | 300 req/15 min |
| Filtered stream | Not available | 50 rules | 1000 rules |

Build a request queue that tracks rate limit headers and backs off automatically:

```javascript
async function rateLimitedSearch(query, params) {
  const response = await xClient.get('tweets/search/recent', { query, ...params });
  const remaining = parseInt(response.headers['x-rate-limit-remaining']);
  if (remaining < 5) {
    const reset = parseInt(response.headers['x-rate-limit-reset']) * 1000;
    await new Promise(r => setTimeout(r, reset - Date.now() + 1000));
  }
  return response;
}
```

---

## Conclusion

The difference between a useful crypto research system and a noise machine is operator precision. Start with cashtags, layer in `-is:retweet lang:en`, then add engagement filters, URL operators, and account targeting as your use case sharpens. Use the counts endpoint for trend detection before burning rate limits on full text retrieval. Most of the signal you want is accessible with Basic tier access if your queries are well-constructed.
