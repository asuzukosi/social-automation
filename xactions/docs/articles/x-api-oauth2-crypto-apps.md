# X API OAuth 2.0 Guide for Crypto App Developers

**Meta description:** Complete OAuth 2.0 implementation guide for X API crypto apps — covering app-only vs. user-context flows, PKCE, token storage, refresh handling, and common pitfalls for crypto portfolio and trading applications.

---

## Introduction

Authentication is the first barrier every X API integration hits. Get it wrong and you're blocked before you write a single useful line of code. Get it right and the entire API surface opens up — read access, write access, DMs, and user-specific data.

X API v2 standardizes on OAuth 2.0. There are two distinct flows, and choosing the wrong one for your use case is the most common mistake crypto developers make. This guide covers both, with complete implementation examples.

---

## Two Flows, Two Use Cases

| Flow | When to Use | What It Enables |
|---|---|---|
| **App-Only (Bearer Token)** | Reading public data | Search, stream, user lookup, timelines |
| **OAuth 2.0 PKCE (User Context)** | Acting on behalf of users | Post tweets, follow/unfollow, read DMs, manage bookmarks |

For a crypto price alert bot posting to its own account: use OAuth 2.0 User Context, authenticated once, tokens stored long-term.

For a sentiment scraper reading public cashtag data: use App-Only with a Bearer Token.

For a portfolio app where users connect their X accounts: use OAuth 2.0 PKCE with a full authorization flow per user.

---

## App-Only Authentication

The simplest flow. Get a Bearer Token from the X Developer Portal and use it in the Authorization header.

```bash
# Generate a Bearer Token via API (if not using Portal)
curl -u "CLIENT_ID:CLIENT_SECRET" \
  --data 'grant_type=client_credentials' \
  'https://api.twitter.com/oauth2/token'
```

```javascript
// Node.js — app-only read request
async function searchTweets(query) {
  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.X_BEARER_TOKEN}`
      }
    }
  );
  return res.json();
}
```

App-Only tokens don't expire. Store them as environment variables — never in version control.

---

## OAuth 2.0 Authorization Code with PKCE

Required for user-context actions. PKCE (Proof Key for Code Exchange) makes the flow safe for public clients like browser apps.

### Step 1: Generate PKCE Parameters

```javascript
import crypto from 'crypto';

function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}
```

### Step 2: Build the Authorization URL

```javascript
function buildAuthURL(codeChallenge, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.X_REDIRECT_URI,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  return `https://twitter.com/i/oauth2/authorize?${params}`;
}
```

**Scopes for crypto apps:**
- `tweet.read` — read tweets and search
- `tweet.write` — post alerts, updates
- `users.read` — access user profile data
- `offline.access` — get a refresh token (required for long-lived sessions)
- `follows.read` / `follows.write` — manage follows for growth tools
- `dm.read` / `dm.write` — direct message automation

Only request scopes you actually need. X's approval process scrutinizes broad scope requests.

### Step 3: Handle the Callback

After the user authorizes, X redirects to your callback URL with a `code` parameter:

```javascript
// Express.js callback handler
app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  // Validate state to prevent CSRF
  if (state !== req.session.oauthState) {
    return res.status(400).send('Invalid state parameter');
  }

  const codeVerifier = req.session.codeVerifier;

  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    req.session.accessToken = tokens.access_token;
    req.session.refreshToken = tokens.refresh_token;
    res.redirect('/dashboard');
  } catch (err) {
    res.status(500).send('Token exchange failed');
  }
});
```

### Step 4: Exchange Code for Tokens

```javascript
async function exchangeCodeForTokens(code, codeVerifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.X_REDIRECT_URI,
    code_verifier: codeVerifier
  });

  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Token exchange failed: ${err.error_description}`);
  }

  return res.json();
  // Returns: { access_token, refresh_token, expires_in, scope, token_type }
}
```

---

## Token Storage

Access tokens expire in 2 hours. Refresh tokens are long-lived but single-use — each refresh returns a new refresh token.

```javascript
// Secure token storage in PostgreSQL
async function storeUserTokens(userId, tokens) {
  await db.query(
    `INSERT INTO user_tokens (user_id, access_token, refresh_token, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
     SET access_token = $2, refresh_token = $3, expires_at = $4`,
    [
      userId,
      encrypt(tokens.access_token),   // Encrypt at rest
      encrypt(tokens.refresh_token),
      new Date(Date.now() + tokens.expires_in * 1000)
    ]
  );
}
```

Never store tokens in plaintext. Use AES-256-GCM or your platform's secret manager (AWS Secrets Manager, Railway's encrypted env vars).

---

## Refreshing Tokens

```javascript
async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  return res.json();
}

// Middleware that auto-refreshes expired tokens
async function withValidToken(userId, fn) {
  let { accessToken, refreshToken, expiresAt } = await getUserTokens(userId);

  if (new Date() > new Date(expiresAt - 300_000)) { // 5-minute buffer
    const refreshed = await refreshAccessToken(decrypt(refreshToken));
    await storeUserTokens(userId, refreshed);
    accessToken = refreshed.access_token;
  }

  return fn(decrypt(accessToken));
}
```

---

## Common Pitfalls

**Missing `offline.access` scope** — Without it, you get no refresh token. Users must re-authorize every 2 hours. Always include `offline.access` for production apps.

**Not validating state** — The `state` parameter is your CSRF protection. Skipping validation opens your callback to token injection attacks.

**Storing tokens in client-side code** — Access tokens in browser localStorage or mobile app bundles are exposed. Keep tokens server-side; proxy X API calls through your backend.

**Single-use refresh tokens** — If a refresh fails mid-rotation (e.g., a server crash), both the old and new refresh tokens may be invalid. Implement retry logic and user re-authorization fallback.

**Scope creep** — X's review process is stricter for broad scopes. `dm.write` in particular triggers manual review. Request only what you need at launch.

---

## Revoking Tokens

When users disconnect their X accounts from your app:

```javascript
async function revokeToken(token, tokenType = 'access_token') {
  const body = new URLSearchParams({
    token,
    token_type_hint: tokenType
  });

  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString('base64');

  await fetch('https://api.twitter.com/2/oauth2/revoke', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
}
```

Always revoke both access and refresh tokens on disconnect.

---

## Conclusion

OAuth 2.0 with PKCE is the correct implementation path for any X API crypto app that acts on behalf of users. The flow has five steps: generate PKCE, build auth URL, handle callback, exchange code, store and refresh tokens. The two most common failures are skipping `offline.access` (causing 2-hour expiry issues) and not validating the state parameter (CSRF vulnerability). Get the auth layer right before building anything on top of it.

---

*Related: [X Developer API in 2026: The Complete Guide for Crypto Builders](../x-developer-api-crypto-guide-2026.md)*
