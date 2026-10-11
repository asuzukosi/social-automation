# X API Bearer Token vs OAuth: When to Use Each in Crypto Apps

**Meta description:** Understand when to use X API Bearer Token vs OAuth 1.0a and OAuth 2.0 in crypto applications — covering read vs write access, rate limits, security tradeoffs, and implementation patterns.

---

## Introduction

The X API offers multiple authentication methods, and choosing the wrong one for your crypto app will cost you — either in rate limits, broken write access, or unnecessary complexity. Bearer Token, OAuth 1.0a, and OAuth 2.0 PKCE serve different purposes. This guide maps each auth method to specific crypto use cases so you pick the right one from the start.

---

## The Three Auth Methods

### App-Only Bearer Token

A Bearer Token authenticates your application, not a specific user. It grants read-only access to public data with no user context.

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

// Works: read public tweets
const tweets = await client.v2.search('bitcoin -is:retweet lang:en');

// Fails: cannot post tweets with Bearer Token
await client.v2.tweet('BTC up 5%'); // Error: 403
```

### OAuth 1.0a (Three-Legged)

OAuth 1.0a is the legacy auth flow. It authenticates a specific user account and grants both read and write access. Still fully supported in X API v2.

```js
const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// Works: post tweets as the authenticated user
await client.v2.tweet('ETH/BTC ratio hits 0.052');
```

### OAuth 2.0 PKCE

OAuth 2.0 with PKCE is the modern flow for user-facing apps. It uses short-lived access tokens and refresh tokens, appropriate when your crypto app authenticates multiple users.

```js
// Generate auth link for user to authorize
const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
  process.env.CALLBACK_URL,
  { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
);

// Exchange code for tokens after callback
const { accessToken, refreshToken } = await client.loginWithOAuth2({
  code: req.query.code,
  codeVerifier,
  redirectUri: process.env.CALLBACK_URL,
});
```

---

## Decision Matrix for Crypto Use Cases

| Use Case | Auth Method | Reason |
|---|---|---|
| Market sentiment scraper | Bearer Token | Read-only, higher rate limits |
| Airdrop announcement tracker | Bearer Token | Public data, no writes needed |
| Price alert bot (single account) | OAuth 1.0a | Simple, posts as one account |
| Exchange outage monitor | Bearer Token | Stream/search only |
| Multi-user trading app | OAuth 2.0 PKCE | Each user authenticates separately |
| DeFi protocol announcement bot | OAuth 1.0a | Posts as your protocol account |
| Whale alert bot | OAuth 1.0a | Reads on-chain, posts to X |
| Portfolio tracker with social auth | OAuth 2.0 PKCE | Users log in with their X account |

---

## Rate Limit Differences

Bearer Token gets more generous read rate limits than OAuth 1.0a on the same endpoints:

```
Search (v2):
  Bearer Token: 60 requests/15min (Basic)
  OAuth 1.0a: 60 requests/15min (Basic)

Timeline (v2):
  Bearer Token: 15 requests/15min
  OAuth 1.0a: 180 requests/15min (user context)

Filtered Stream:
  Bearer Token: Available (Basic+)
  OAuth 1.0a: Not applicable (stream is app-level)
```

For read-heavy scrapers, Bearer Token avoids any risk of accidentally burning user-context rate limits.

---

## Security Considerations

### Never Expose OAuth Credentials in Client-Side Code

Crypto apps are targeted. OAuth 1.0a credentials allow posting tweets as your account — if leaked, an attacker can impersonate your protocol or bot.

```js
// WRONG — never in browser-side code or public repos
const client = new TwitterApi({
  appKey: 'HARDCODED_KEY', // exposed in bundle
});

// CORRECT — server-side only, loaded from env
const client = new TwitterApi({
  appKey: process.env.X_API_KEY,
});
```

### Rotating Tokens for OAuth 2.0

OAuth 2.0 access tokens expire. Implement refresh token rotation:

```js
async function refreshIfNeeded(storedTokens) {
  const expiresAt = storedTokens.expiresAt;
  if (Date.now() > expiresAt - 60000) { // refresh 1 min before expiry
    const { accessToken, refreshToken } = await client.refreshOAuth2Token(
      storedTokens.refreshToken
    );
    return { accessToken, refreshToken, expiresAt: Date.now() + 7200000 };
  }
  return storedTokens;
}
```

### Bearer Token Scope Is App-Wide

Bearer Token access is tied to your app. If your app credentials are compromised, all Bearer Token access is compromised. Rotate app credentials immediately on suspected breach.

---

## Handling Token Storage for Multi-User Crypto Apps

If your DeFi app authenticates users via X OAuth 2.0, store tokens encrypted:

```js
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encryptToken(token) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.ENCRYPT_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}
```

Store encrypted tokens in PostgreSQL and decrypt at request time — never store plaintext OAuth tokens.

---

## Conclusion

The decision is straightforward: use Bearer Token for anything read-only (scrapers, monitors, analytics), OAuth 1.0a for bots posting as a single account, and OAuth 2.0 PKCE when your crypto app authenticates real users. Each method has distinct rate limits and security implications. Defaulting to Bearer Token where possible reduces credential exposure and simplifies your auth layer.
