# Building a Crypto Derivatives Market Alert Bot with X API

**Meta description:** Build a crypto derivatives market alert bot using X API to monitor funding rates, open interest changes, and liquidation cascade announcements in real time.

---

## Introduction

Derivatives markets drive spot price in crypto more than any other factor. Funding rates, open interest spikes, large liquidations, and options expiry events create directional pressure that shows up in spot price minutes to hours later. Traders and quants who track these signals on X — where they're discussed in real time by traders, analysts, and protocol accounts — have a structural edge.

This guide covers building a derivatives market alert bot: monitoring key accounts, extracting funding rates and OI data from tweets, and correlating with live exchange data.

---

## Key Signal Sources on X

Derivatives signal comes from distinct account categories:

**Protocol official accounts**: dYdX, GMX, Hyperliquid, Synthetix, Perp Protocol — these post funding rate summaries, OI milestones, and product updates directly.

**Analytics platforms**: Coinglass, Glassnode, CryptoQuant, Laevitas — post charts with OI, liquidation, and funding data as images; the text often contains the key numbers.

**Derivatives-focused traders**: Well-followed traders who post their positions, rationale, and market reads. High-engagement posts from these accounts are leading indicators.

**Exchange accounts**: Binance Futures, Bybit, OKX Derivatives post record OI and funding rate announcements.

Build your account list from these categories. Separate protocol accounts (always track) from trader accounts (filter by engagement threshold).

---

## Stream Rules for Derivatives Coverage

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

const DERIVATIVES_RULES = [
  {
    value: '("funding rate" OR "funding rates") (#BTC OR #ETH OR Bitcoin OR Ethereum) lang:en -is:retweet',
    tag: 'funding-rates',
  },
  {
    value: '("open interest" OR OI) (record OR high OR spike OR all.time) lang:en -is:retweet',
    tag: 'open-interest',
  },
  {
    value: '(liquidat*) ($100M OR $500M OR $1B OR "billion" OR "hundred million") lang:en',
    tag: 'large-liquidations',
  },
  {
    value: '("options expiry" OR "options expiration" OR "max pain" OR "gamma squeeze") lang:en -is:retweet',
    tag: 'options-events',
  },
  {
    value: '("long squeeze" OR "short squeeze" OR "cascading liquidations" OR "liquidation cascade") lang:en',
    tag: 'squeeze-events',
  },
  {
    value: '("perpetual" OR "perps") (funding OR OI OR liquidation) (update OR alert OR data) lang:en',
    tag: 'perp-data',
  },
];

await client.v2.updateStreamRules({ add: DERIVATIVES_RULES });
```

---

## Extracting Funding Rate Data

Funding rate announcements follow consistent formatting. Parse them:

```js
const FUNDING_PATTERNS = {
  // "BTC funding rate: +0.05%" or "BTC: 0.05% (8h)"
  rateValue: /([A-Z]{2,8})\s*(?:funding\s+)?rate[:\s]+([+-]?[0-9.]+)\s*%/gi,
  // Annualized: "+18% annualized" or "18% APR"
  annualized: /([+-]?[0-9.]+)\s*%\s*(?:annualized|APR|annual)/i,
  // Direction
  direction: /(?:positive|negative|bullish|bearish)\s+funding/i,
};

function parseFundingRates(text) {
  const rates = [];

  const rateMatches = [...text.matchAll(FUNDING_PATTERNS.rateValue)];
  for (const match of rateMatches) {
    rates.push({
      token: match[1].toUpperCase(),
      rate: parseFloat(match[2]),
      type: '8h', // default perpetual funding interval
    });
  }

  const annualized = text.match(FUNDING_PATTERNS.annualized);
  const direction = FUNDING_PATTERNS.direction.test(text)
    ? (text.toLowerCase().includes('positive') ? 'POSITIVE' : 'NEGATIVE')
    : null;

  return {
    rates,
    annualizedRate: annualized ? parseFloat(annualized[1]) : null,
    direction,
    isAlert: rates.some(r => Math.abs(r.rate) > 0.1), // >0.1% per 8h is significant
  };
}
```

---

## Open Interest Change Detection

OI spikes precede volatility. Parse OI from tweets:

```js
function parseOpenInterest(text) {
  const VALUE_PATTERN = /\$([0-9,.]+)\s*([KkMmBb]?)\s*(?:in\s+)?(?:open\s+interest|OI)/i;
  const CHANGE_PATTERN = /OI\s+(?:up|down|increased?|decreased?|jumped?|dropped?)\s+(?:by\s+)?\$?([0-9,.]+[KkMmBb]?)/i;
  const RECORD_PATTERN = /(?:record|ATH|all.time.high)\s+(?:open\s+interest|OI)/i;

  const valueMatch = text.match(VALUE_PATTERN);
  const changeMatch = text.match(CHANGE_PATTERN);
  const isRecord = RECORD_PATTERN.test(text);

  const parseValue = (str, suffix) => {
    const num = parseFloat(str.replace(/,/g, ''));
    const s = (suffix || '').toUpperCase();
    if (s === 'K') return num * 1_000;
    if (s === 'M') return num * 1_000_000;
    if (s === 'B') return num * 1_000_000_000;
    return num;
  };

  return {
    totalOi: valueMatch ? parseValue(valueMatch[1], valueMatch[2]) : null,
    change: changeMatch ? parseValue(changeMatch[1]) : null,
    isRecord,
    priority: isRecord || (valueMatch && parseValue(valueMatch[1], valueMatch[2]) > 10_000_000_000)
      ? 'HIGH' : 'NORMAL',
  };
}
```

---

## Liquidation Event Handler

Large liquidation announcements warrant immediate alerts:

```js
const LIQUIDATION_PATTERNS = {
  amount: /\$([0-9,.]+)\s*([KkMmBb]?)\s*(?:in\s+)?liquidat/i,
  direction: /(longs?|shorts?)\s+(?:were\s+)?liquidated/i,
  token: /#([A-Z]{2,8})\s+(?:longs?|shorts?|positions?)/i,
};

function parseLiquidationEvent(text) {
  const amountMatch = text.match(LIQUIDATION_PATTERNS.amount);
  const directionMatch = text.match(LIQUIDATION_PATTERNS.direction);
  const tokenMatch = text.match(LIQUIDATION_PATTERNS.token);

  const amount = amountMatch
    ? parseValue(amountMatch[1], amountMatch[2])
    : null;

  return {
    amount,
    direction: directionMatch
      ? (directionMatch[1].toLowerCase().startsWith('long') ? 'LONG' : 'SHORT')
      : null,
    token: tokenMatch?.[1] ?? null,
    severity: amount > 500_000_000 ? 'CRITICAL'
      : amount > 100_000_000 ? 'HIGH'
      : amount > 10_000_000 ? 'MEDIUM'
      : 'LOW',
  };
}
```

---

## Live Exchange Data Correlation

When the bot detects a funding rate tweet, pull live data from exchanges to verify:

```js
async function fetchLiveFundingRate(symbol) {
  // Bybit API as example
  const response = await fetch(
    `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol}USDT&limit=1`
  );
  const data = await response.json();
  const latest = data.result?.list?.[0];

  if (!latest) return null;
  return {
    symbol,
    rate: parseFloat(latest.fundingRate),
    timestamp: new Date(parseInt(latest.fundingRateTimestamp)).toISOString(),
    nextFundingTime: await fetchNextFundingTime(symbol),
  };
}

async function correlateAndAlert(parsedTweet, liveData) {
  const discrepancy = parsedTweet.rates.find(r => {
    const live = liveData[r.token];
    return live && Math.abs(r.rate - live.rate) > 0.02; // >2bps discrepancy
  });

  if (discrepancy) {
    // Tweet data doesn't match live exchange data — flag as stale or incorrect
    console.warn(`⚠️ Funding rate discrepancy for ${discrepancy.token}`);
    return;
  }

  if (parsedTweet.isAlert) {
    await sendDerivativesAlert(parsedTweet, liveData);
  }
}
```

---

## Database Schema and Time-Series Tracking

```sql
CREATE TABLE derivatives_events (
  id BIGSERIAL PRIMARY KEY,
  tweet_id VARCHAR(30) UNIQUE NOT NULL,
  event_type VARCHAR(30) NOT NULL,  -- 'funding_rate', 'open_interest', 'liquidation', 'options_expiry'
  token VARCHAR(20),
  severity VARCHAR(10) DEFAULT 'NORMAL',
  funding_rate DECIMAL(10, 6),
  open_interest BIGINT,
  liquidation_amount BIGINT,
  liquidation_direction VARCHAR(10),
  is_record BOOLEAN DEFAULT FALSE,
  tweet_text TEXT NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE funding_rate_history (
  id BIGSERIAL PRIMARY KEY,
  token VARCHAR(20) NOT NULL,
  rate DECIMAL(10, 6) NOT NULL,
  source VARCHAR(20) NOT NULL,  -- 'x_tweet', 'bybit', 'binance', etc.
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON funding_rate_history (token, recorded_at DESC);
```

---

## Building the Alert Bot

Tie it all together with a message formatter:

```js
function formatDerivativesAlert(event, liveData) {
  const lines = [`[DERIVATIVES ALERT] ${event.token ?? 'Market-wide'}`];

  if (event.eventType === 'funding_rate') {
    lines.push(`Funding rate: ${event.fundingRate > 0 ? '+' : ''}${(event.fundingRate * 100).toFixed(4)}%`);
    lines.push(`Annualized: ~${(event.fundingRate * 3 * 365 * 100).toFixed(1)}%`);
    lines.push(event.fundingRate > 0 ? 'Signal: Longs paying shorts (bullish excess)' : 'Signal: Shorts paying longs (bearish excess)');
  }

  if (event.eventType === 'liquidation') {
    lines.push(`Liquidated: $${(event.liquidationAmount / 1e6).toFixed(0)}M`);
    lines.push(`Direction: ${event.liquidationDirection}s wiped`);
  }

  lines.push(`Severity: ${event.severity}`);
  lines.push(`Tweet: https://x.com/i/status/${event.tweetId}`);
  return lines.join('\n');
}
```

---

## Conclusion

Crypto derivatives market intelligence from X gives you funding rate shifts, OI milestones, and liquidation cascade alerts before they're widely processed. The bot described here — filtered stream rules for derivatives keywords, number extraction for funding rates and OI, live exchange data correlation, and severity classification — runs cheaply and delivers high-signal alerts that directly inform trading decisions. Deploy it, tune the severity thresholds to your risk tolerance, and let it run continuously alongside your market monitoring stack.
