# X Developer Account Setup Guide for Crypto Projects

**Meta description:** A complete walkthrough for crypto developers to set up an X developer account, configure OAuth 2.0, and get a filtered stream running for blockchain data collection.

---

## Introduction

Before you write a single line of crypto data pipeline code, you need a properly configured X developer account. Getting this wrong — wrong access tier, missing scopes, or misconfigured OAuth — kills projects before they start. This guide covers the exact steps to go from a blank X account to a running filtered stream endpoint, optimized for crypto data use cases.

---

## Choosing the Right Access Tier

X API has three access tiers in 2024:

| Tier | Monthly cost | Filtered stream | Search (recent) | Use case |
|------|-------------|-----------------|-----------------|----------|
| Free | $0 | No | 1 request/15min | Testing only |
| Basic | $100/mo | No | 10,000 tweets/mo | Light monitoring |
| Pro | $5,000/mo | Yes (500k tweets/mo) | Full access | Production systems |

For any serious crypto monitoring — ETF signals, sentiment analysis, launch tracking — you need **Pro** access for the filtered stream endpoint. Basic is suitable for batch sentiment analysis using the search endpoint with caching.

If your use case is academic research, apply for the **Academic Research** track instead. It's free and provides full archive access.

---

## Creating the Developer Account

1. Go to [developer.twitter.com](https://developer.twitter.com) and sign in with your X account
2. Click "Sign up for Free Account" or "Apply" depending on your current tier
3. Fill in the use case description — be specific about crypto/blockchain monitoring. Generic answers are rejected more often
4. For the use case field, use language like: *"Real-time monitoring of cryptocurrency market signals from public posts. Collecting cashtag data ($BTC, $ETH) for sentiment analysis research."*
5. Accept the developer agreement

For Pro access, you'll complete an additional review form. Approval typically takes 1-3 business days.

---

## Creating a Project and App

Once approved:

```
Developer Portal → Projects & Apps → Add Project
```

- **Project name**: Something descriptive — `crypto-signal-monitor`
- **App name**: Must be unique globally — `cryptosigmon-{yourhandle}`
- **Use case**: Select "Monitoring and listening" for stream-based applications

Within the app settings, navigate to "Keys and Tokens" and generate:
- **Bearer Token** — for app-only authentication (filtered stream, search)
- **API Key + Secret** — for OAuth 1.0a (user-context actions)
- **Client ID + Secret** — for OAuth 2.0 PKCE (modern user auth)

---

## Environment Variable Setup

Never hard-code credentials. Use a `.env` file:

```bash
# .env
X_BEARER_TOKEN=AAAAAAAAAAAAAAAAAAAAAAxxxxxx
X_API_KEY=xxxxxxxxxxxxxxxxxxxxxx
X_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
X_ACCESS_TOKEN_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxx
X_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxx
X_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Load with dotenv:

```js
import 'dotenv/config';

const bearerToken = process.env.X_BEARER_TOKEN;
if (!bearerToken) throw new Error('X_BEARER_TOKEN is required');
```

---

## Configuring App Permissions

For read-only data collection (streams, search), set app permissions to **Read**. If you need to post tweets as part of your application, enable **Read and Write**.

Under "Authentication settings":
- Enable **OAuth 2.0** and set Type to "Confidential Client"
- Add a callback URL (even for server-side apps): `https://your-domain.com/auth/callback`
- Set the website URL to your project's homepage

---

## Testing Your Credentials

Verify the Bearer Token works before building the pipeline:

```js
// test-credentials.js
import axios from 'axios';

async function verify() {
  try {
    const res = await axios.get(
      'https://api.twitter.com/2/tweets/search/recent',
      {
        headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
        params: { query: '$BTC has:cashtags', max_results: 10 },
      }
    );
    console.log(`✅ Credentials valid. Got ${res.data.data?.length} tweets.`);
  } catch (err) {
    console.error('❌ Auth failed:', err.response?.data);
  }
}

verify();
```

---

## Rate Limit Awareness

Each endpoint has independent rate limits. For Pro access:

| Endpoint | Rate limit |
|----------|-----------|
| `GET /2/tweets/search/recent` | 300 req/15min (app-level) |
| `GET /2/tweets/search/stream` | 50 connections/15min |
| `POST /2/tweets/search/stream/rules` | 25 requests/15min |
| `GET /2/users/by` | 300 req/15min |

Always include retry logic with exponential backoff and respect `x-rate-limit-reset` headers:

```js
function getRateLimitReset(headers) {
  const reset = headers['x-rate-limit-reset'];
  return reset ? parseInt(reset) * 1000 - Date.now() : 60000;
}
```

---

## Conclusion

X developer account setup for crypto projects requires choosing the right access tier upfront, filling in specific use-case details during application, and properly scoping app permissions. With credentials validated and rate limits understood, you can build streaming pipelines for cashtag sentiment, ETF signal monitoring, or any other blockchain data use case covered in this guide series.
