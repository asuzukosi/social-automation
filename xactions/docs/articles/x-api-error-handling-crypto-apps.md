# X API Error Handling Best Practices for Crypto Applications

**Meta description:** Learn how to handle X API errors reliably in crypto applications, including rate limits, transient failures, and auth errors, with production-ready code patterns.

---

## Introduction

Crypto apps that rely on X (Twitter) data operate in a hostile environment: markets move fast, your users expect real-time data, and the X API will fail on you at the worst possible moment. A rate limit hit during a flash crash, a 503 during a governance vote — these aren't edge cases, they're guaranteed. This guide covers the error types you'll encounter and the patterns that keep your pipeline alive.

## Understanding X API Error Categories

The X API v2 returns structured errors. Every response that isn't a 200 needs handling. The main categories:

- **401 Unauthorized** — bad or expired token, missing scope
- **403 Forbidden** — app-level restriction, read-only token trying to write
- **429 Too Many Requests** — rate limit exceeded; check `x-rate-limit-reset` header
- **500 / 503** — X-side failures; transient, always retry
- **400 Bad Request** — malformed query; don't retry without fixing the request

Crypto pipelines typically hit 429s and 503s. Both are recoverable.

## Implementing Exponential Backoff

Never retry immediately. Use exponential backoff with jitter to avoid thundering herd:

```javascript
async function fetchWithRetry(url, options, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        const resetTs = res.headers.get('x-rate-limit-reset');
        const waitMs = resetTs
          ? (parseInt(resetTs) * 1000 - Date.now()) + 500
          : Math.min(1000 * 2 ** attempt + Math.random() * 1000, 64000);
        console.warn(`⚠️ Rate limited. Waiting ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (res.status >= 500) {
        const waitMs = Math.min(1000 * 2 ** attempt + Math.random() * 500, 32000);
        console.warn(`⚠️ Server error ${res.status}. Retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) throw new Error(`Non-retryable error: ${res.status}`);
      return res;

    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      const waitMs = Math.min(1000 * 2 ** attempt, 16000);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}
```

The key detail: for 429 responses, honor the `x-rate-limit-reset` header rather than using fixed delays. X tells you exactly when your window resets — use it.

## Respecting Rate Limit Headers

Every X API response includes rate limit metadata:

```
x-rate-limit-limit: 300
x-rate-limit-remaining: 0
x-rate-limit-reset: 1706745600
```

Track these per endpoint. Crypto apps often fan out across multiple search queries (e.g., one per token). Each query burns from the same pool:

```javascript
class RateLimitTracker {
  constructor() {
    this.limits = new Map();
  }

  update(endpoint, headers) {
    this.limits.set(endpoint, {
      limit: parseInt(headers.get('x-rate-limit-limit')),
      remaining: parseInt(headers.get('x-rate-limit-remaining')),
      reset: parseInt(headers.get('x-rate-limit-reset')) * 1000,
    });
  }

  canRequest(endpoint) {
    const state = this.limits.get(endpoint);
    if (!state) return true;
    if (state.remaining > 0) return true;
    return Date.now() > state.reset;
  }

  msUntilReset(endpoint) {
    const state = this.limits.get(endpoint);
    if (!state) return 0;
    return Math.max(0, state.reset - Date.now());
  }
}
```

## Handling Auth Errors in Long-Running Processes

Crypto monitoring bots run for days. Bearer tokens for app-only auth don't expire, but user OAuth 2.0 tokens do. Catch 401s specifically and trigger a token refresh:

```javascript
async function requestWithAuthRefresh(client, endpoint) {
  let res = await client.get(endpoint);

  if (res.status === 401) {
    console.log('🔄 Token expired, refreshing...');
    await client.refreshToken();
    res = await client.get(endpoint);
  }

  if (res.status === 401) {
    throw new Error('❌ Auth failed after refresh — check credentials');
  }

  return res;
}
```

## Circuit Breakers for Sustained Outages

When X has a sustained incident, retrying burns your quota. Use a circuit breaker that opens after N consecutive failures:

```javascript
class CircuitBreaker {
  constructor(threshold = 5, resetMs = 60000) {
    this.failures = 0;
    this.threshold = threshold;
    this.resetMs = resetMs;
    this.openedAt = null;
  }

  isOpen() {
    if (this.openedAt && Date.now() - this.openedAt > this.resetMs) {
      this.failures = 0;
      this.openedAt = null;
    }
    return this.openedAt !== null;
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.openedAt = Date.now();
      console.error('❌ Circuit breaker opened');
    }
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = null;
  }
}
```

## Logging Errors for Crypto Context

Generic error logs don't help. Include the token, query, and timestamp so you can correlate errors with market events:

```javascript
function logApiError(err, context) {
  console.error({
    timestamp: new Date().toISOString(),
    status: err.status,
    query: context.query,
    token: context.token,
    market_price: context.currentPrice,
    message: err.message,
  });
}
```

## Conclusion

Solid error handling in crypto X apps comes down to three things: never retry non-recoverable errors, honor rate limit headers precisely, and isolate sustained failures with circuit breakers. Implement these patterns once in a shared client module and every feature you build on top inherits the resilience automatically.
