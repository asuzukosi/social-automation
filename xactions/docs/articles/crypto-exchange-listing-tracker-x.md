# How to Build a Crypto Exchange Listing Tracker with X API

**Meta description:** Build a real-time crypto exchange listing tracker using X API filtered streams, targeting Binance, Coinbase, Kraken, and OKX official accounts with Node.js and PostgreSQL.

---

## Introduction

Exchange listings are among the most predictable price catalysts in crypto. Binance listings routinely trigger 50-200% pumps within hours. Being first to detect a listing announcement — even seconds before it hits aggregators — creates a measurable edge. X API makes this possible: exchange accounts post listing announcements on X before updating their websites. This guide builds a dedicated listing tracker targeting major exchange official accounts.

---

## Target Accounts and Signal Patterns

Major exchanges and their primary announcement accounts:

```js
// targets.js
export const EXCHANGE_ACCOUNTS = {
  binance:   ['binance', 'BinanceUS'],
  coinbase:  ['Coinbase', 'CoinbaseAssets'],
  kraken:    ['krakenfx'],
  okx:       ['okx'],
  kucoin:    ['kucoincom'],
  bybit:     ['Bybit_Official'],
  bitget:    ['BitgetWallet'],
  mexc:      ['MEXC_Global'],
  gate:      ['gate_io'],
  htx:       ['HTX_Global'],
};

// Listing announcement patterns
export const LISTING_PATTERNS = [
  /will list/i,
  /now (listed|trading|available)/i,
  /listing announcement/i,
  /new listing/i,
  /spot trading.*opens/i,
  /\bhas listed\b/i,
  /adds.*trading/i,
];
```

---

## Stream Rules for Exchange Listing Signals

```js
// listing-rules.js
const EXCHANGE_FROM = Object.values(EXCHANGE_ACCOUNTS)
  .flat()
  .map(h => `from:${h}`)
  .join(' OR ');

export const LISTING_RULES = [
  {
    value: `(${EXCHANGE_FROM}) (listing OR listed OR "now trading" OR "new listing")`,
    tag: 'exchange_listing_official'
  },
  {
    value: `(binance OR coinbase OR kraken OR okx) ("will list" OR "new listing" OR "spot trading") has:cashtags -is:retweet`,
    tag: 'listing_keyword'
  },
  {
    value: `(${EXCHANGE_FROM})`,
    tag: 'exchange_all'  // catch-all for official accounts
  },
];
```

The `exchange_all` rule catches everything from official accounts so you can apply pattern matching server-side without relying on keyword rules alone.

---

## Parsing Listing Announcements

```js
// parser.js
import { LISTING_PATTERNS } from './targets.js';

export function parseListing(tweet) {
  const text = tweet.text;

  // Detect listing signal
  const isListing = LISTING_PATTERNS.some(pattern => pattern.test(text));
  if (!isListing) return null;

  // Extract cashtags from entities
  const cashtags = tweet.entities?.cashtags?.map(c => c.tag.toUpperCase()) || [];

  // Extract exchange name from matching rules or username
  const exchange = detectExchange(tweet.author_id);

  return {
    tweet_id: tweet.id,
    is_listing: true,
    cashtags,
    exchange,
    text,
    created_at: tweet.created_at,
  };
}

function detectExchange(authorId) {
  // Map author_id to exchange name (pre-populated from user lookup)
  return AUTHOR_ID_MAP[authorId] || 'unknown';
}
```

---

## Database Schema

```sql
CREATE TABLE exchange_listings (
  id           BIGSERIAL PRIMARY KEY,
  tweet_id     TEXT UNIQUE NOT NULL,
  exchange     TEXT NOT NULL,
  assets       TEXT[] NOT NULL DEFAULT '{}',
  text         TEXT NOT NULL,
  rule_tag     TEXT,
  confirmed    BOOLEAN DEFAULT false,
  alert_sent   BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL,
  captured_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by asset and exchange
CREATE INDEX idx_listing_assets ON exchange_listings USING GIN(assets);
CREATE INDEX idx_listing_exchange ON exchange_listings(exchange, created_at DESC);
CREATE INDEX idx_listing_unalerted ON exchange_listings(alert_sent, created_at DESC)
  WHERE alert_sent = false;
```

---

## Alert Pipeline

```js
// alerter.js
import { pool } from './db.js';
import axios from 'axios';

export async function processPendingAlerts() {
  const { rows } = await pool.query(`
    SELECT * FROM exchange_listings
    WHERE alert_sent = false
    AND created_at > now() - interval '10 minutes'
    ORDER BY created_at ASC
  `);

  for (const listing of rows) {
    await sendAlert(listing);
    await pool.query(
      'UPDATE exchange_listings SET alert_sent = true WHERE id = $1',
      [listing.id]
    );
  }
}

async function sendAlert(listing) {
  const message = `🔔 ${listing.exchange.toUpperCase()} LISTING\n` +
    `Assets: ${listing.assets.join(', ')}\n` +
    `${listing.text.slice(0, 280)}\n` +
    `https://x.com/i/web/status/${listing.tweet_id}`;

  // Send to Telegram
  await axios.post(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
    chat_id: process.env.TG_CHAT_ID,
    text: message,
  });
}
```

---

## Deduplication and False Positive Filtering

Exchange accounts post various content — not just listings. Add a confirmation layer:

```js
export function isConfirmedListing(text) {
  const t = text.toLowerCase();

  // Must contain asset-like pattern
  const hasAsset = /\$[A-Z]{2,10}/.test(text) ||
    /(?:^|\s)[A-Z]{2,8}(?:\s|$)/.test(text);

  // Must contain date/time signal or trading pair
  const hasTrading = /usdt|usdc|busd|btc pair|spot/.test(t);

  // Reject if it's about futures/derivatives only
  const isSpot = !/perpetual|futures only|perp/.test(t);

  return hasAsset && (hasTrading || isSpot);
}
```

---

## Monitoring Historical Listing Performance

Track how often your tracker fires true versus false positives:

```sql
SELECT
  exchange,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE confirmed = true) as confirmed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE confirmed = true) / COUNT(*), 1) as precision_pct
FROM exchange_listings
WHERE created_at > now() - interval '30 days'
GROUP BY exchange
ORDER BY confirmed DESC;
```

---

## Conclusion

An exchange listing tracker built on X API filtered streams gives crypto developers sub-second detection of listing announcements across all major exchanges. The critical implementation details are: using official account `from:` rules over keyword rules for precision, server-side pattern matching for listing classification, cashtag extraction for asset identification, and a deduplication layer before alerts fire. Wire this to a Telegram bot or webhook for immediate notification.
