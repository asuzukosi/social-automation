# X API v2 vs Legacy v1.1: What Crypto Developers Need to Know

**Meta description:** Compare X API v2 and legacy v1.1 for crypto developers — authentication changes, endpoint differences, rate limits, and migration priorities for bots, scrapers, and trading tools.

---

## Introduction

If you built a crypto Twitter tool before 2023, it likely uses v1.1. X has been deprecating v1.1 endpoints progressively while pushing developers toward v2, but the migration is not a clean swap — auth models differ, response schemas changed, and some v1.1 capabilities have no direct v2 equivalent. This guide cuts through the confusion and focuses on what crypto developers specifically need to know.

---

## Authentication: The Biggest Breaking Change

### v1.1: OAuth 1.0a Only

v1.1 required OAuth 1.0a with four credentials: API Key, API Secret, Access Token, Access Token Secret. Every request, including read-only ones, required all four.

### v2: Bearer Token for Read, OAuth for Write

v2 separates read and write contexts:

- **App-only Bearer Token** — read-only, no user context, higher rate limits
- **OAuth 2.0 PKCE** — user context, write access, modern flow
- **OAuth 1.0a** — still supported in v2 for write operations

For crypto bots that only read price discussion or scrape market sentiment, Bearer Token is simpler and has better rate limits. For bots that post price updates or alerts, you still need OAuth 1.0a or OAuth 2.0 with user context.

```js
// v1.1 — always needed all four credentials
const client = new TwitterApi({
  appKey, appSecret, accessToken, accessSecret
});

// v2 read-only — Bearer Token sufficient
const readClient = new TwitterApi(process.env.BEARER_TOKEN);

// v2 write — OAuth 1.0a still works
const writeClient = new TwitterApi({
  appKey, appSecret, accessToken, accessSecret
});
```

---

## Endpoint Comparison for Crypto Use Cases

### Search

| Feature | v1.1 | v2 |
|---|---|---|
| Endpoint | `GET /1.1/search/tweets.json` | `GET /2/tweets/search/recent` |
| Historical access | 7 days (Standard) | 7 days (Basic), full archive (Academic) |
| Operators | Basic | Advanced (AND/OR/NOT, `has:links`, etc.) |
| Response format | Flat JSON | Nested with expansions |

v2 search is strictly better for crypto research. The operator system lets you query `bitcoin lang:en -is:retweet has:links min_retweets:50` — impossible with v1.1.

### Streaming

v1.1 offered a public filter stream that crypto devs used heavily for real-time keyword tracking. This is largely gone. v2's filtered stream is the replacement but requires at least Basic tier access ($100/month).

### User Lookup

v2 separates user lookup from tweet lookup and requires explicit field expansion. Follower counts and verification status need to be requested explicitly:

```js
// v2 — must request fields explicitly
const user = await client.v2.userByUsername('coinbase', {
  'user.fields': ['public_metrics', 'verified', 'description'],
});
```

---

## Rate Limits: v2 Is More Restrictive on Free Tier

| Operation | v1.1 (Standard) | v2 (Free) | v2 (Basic) |
|---|---|---|---|
| Search requests | 180/15min | Not available | 60/15min |
| Timeline reads | 900/15min | 1/15min | 5/15min |
| Post tweets | 300/3hr | 17/24hr | 100/24hr |
| Filtered stream | Available | Not available | Available |

For crypto bots that need high-frequency data, the free tier is nearly useless for production. Budget for Basic ($100/month) or Pro ($5,000/month) depending on volume.

---

## Response Schema Changes

v2 responses use a different structure. Tweet text, author data, and metrics are no longer in a flat object:

```js
// v1.1 response
{ id_str, text, user: { screen_name, followers_count }, retweet_count }

// v2 response (with expansions)
{
  data: { id, text, author_id, public_metrics: { retweet_count } },
  includes: { users: [{ id, username, public_metrics }] }
}
```

Update all field mappings when migrating. `id_str` becomes `id`, `screen_name` becomes `username`, `retweet_count` moves inside `public_metrics`.

---

## What v1.1 Features Are Gone

- **Public filter stream** (free) — removed, v2 filtered stream requires paid tier
- **Favorites timeline** — use v2 liked tweets endpoint
- **Trends** — v2 trends endpoint exists but has different geographic granularity
- **Direct messages v1** — v2 DM API is significantly changed
- **Retweet timeline** — no direct equivalent; use search with `is:retweet from:user`

---

## Migration Priority for Crypto Developers

1. **Price bots posting tweets** — OAuth 1.0a still works in v2, swap the search library but auth stays similar
2. **Sentiment scrapers** — migrate to v2 search with Bearer Token, gain better operators
3. **Real-time keyword monitoring** — requires paid tier for v2 filtered stream; evaluate cost vs. alternative scraping approaches
4. **Account analytics** — v2 user endpoints are cleaner, migrate eagerly

---

## Conclusion

v2 is the present and future of the X API. For crypto developers, the operator improvements in v2 search justify migration for read-heavy tools immediately. Write operations can stay on OAuth 1.0a. The biggest pain point is rate limits — free tier is not viable for production crypto tooling. Factor in Basic or Pro tier costs when architecting new tools, and migrate streaming integrations carefully since the public stream has no free equivalent.
