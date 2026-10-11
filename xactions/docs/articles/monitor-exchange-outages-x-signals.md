# How to Monitor Exchange Outages via X Social Signals

**Meta description:** Build a system to detect crypto exchange outages in real time by monitoring X social signals — keyword streams, complaint velocity tracking, and alerting pipelines in Node.js.

---

## Introduction

Exchange status pages lie. Or rather, they lag. When Binance has a withdrawal issue or Coinbase's order matching stutters, X fills with complaints 2–5 minutes before any official acknowledgment. For trading systems, arbitrage bots, or risk management tools, detecting outages early via X social signals is a genuine edge. This guide covers building a real-time exchange outage detector using X's filtered stream API.

---

## Why X Signals Outpace Official Status Pages

Exchange status pages update on human timelines — someone has to notice, investigate, confirm, and post. X complaint volume is automatic. When a withdrawal fails for 500 users simultaneously, those 500 users post within minutes. The velocity of complaint posts is the signal, not any single tweet's content.

---

## Defining the Signal: What Outage Posts Look Like

Build a keyword taxonomy for each exchange:

```js
const EXCHANGE_SIGNALS = {
  binance: {
    accounts: ['binance', 'cz_binance', 'binanceus'],
    keywords: [
      'binance down', 'binance withdrawal', 'binance not working',
      'binance maintenance', 'binance error', '#binancedown',
    ],
  },
  coinbase: {
    accounts: ['coinbase', 'coinbasesupport'],
    keywords: [
      'coinbase down', 'coinbase withdrawal stuck', 'coinbase error',
      'coinbase not working', '#coinbasedown', 'coinbase outage',
    ],
  },
  kraken: {
    keywords: [
      'kraken down', 'kraken withdrawal', 'kraken error',
      '#krakendown', 'kraken not working',
    ],
  },
};
```

---

## Setting Up the Filtered Stream

X API v2 filtered stream requires at least Basic tier. Set stream rules before opening the connection:

```js
import { TwitterApi } from 'twitter-api-v2';

const client = new TwitterApi(process.env.X_BEARER_TOKEN);

async function setStreamRules(exchange, signals) {
  const keywords = signals.keywords.join(' OR ');
  const rule = `(${keywords}) -is:retweet lang:en`;

  await client.v2.updateStreamRules({
    add: [{ value: rule, tag: exchange }],
  });
}

async function initRules() {
  // Clear existing rules first
  const existing = await client.v2.streamRules();
  if (existing.data?.length) {
    await client.v2.updateStreamRules({
      delete: { ids: existing.data.map(r => r.id) },
    });
  }

  for (const [exchange, signals] of Object.entries(EXCHANGE_SIGNALS)) {
    await setStreamRules(exchange, signals);
  }
}
```

---

## Tracking Complaint Velocity

A single complaint is noise. A spike in complaints is signal. Use a sliding window counter:

```js
class VelocityTracker {
  constructor(windowMs = 5 * 60 * 1000) {
    this.windowMs = windowMs;
    this.events = {}; // { exchange: [timestamp, ...] }
  }

  record(exchange) {
    if (!this.events[exchange]) this.events[exchange] = [];
    const now = Date.now();
    this.events[exchange].push(now);
    // Prune old events outside the window
    this.events[exchange] = this.events[exchange].filter(t => now - t < this.windowMs);
  }

  getCount(exchange) {
    return this.events[exchange]?.length ?? 0;
  }
}

const tracker = new VelocityTracker();
const ALERT_THRESHOLD = 15; // 15+ complaints in 5 minutes = likely outage
```

---

## Processing the Stream

```js
async function startMonitoring() {
  const stream = await client.v2.searchStream({
    'tweet.fields': ['created_at', 'author_id', 'text'],
    'matching_rules': true,
  });

  stream.on('data', (tweet) => {
    const exchange = tweet.matching_rules?.[0]?.tag;
    if (!exchange) return;

    tracker.record(exchange);
    const count = tracker.getCount(exchange);

    console.log(`[${exchange}] complaint count: ${count}`);

    if (count >= ALERT_THRESHOLD) {
      triggerAlert(exchange, count, tweet.data.text);
    }
  });

  stream.on('error', (err) => {
    console.error('Stream error:', err);
  });
}
```

---

## Alerting Pipeline

Send alerts through multiple channels when an outage is detected:

```js
const alerted = new Map(); // exchange -> last alert timestamp
const ALERT_COOLDOWN = 15 * 60 * 1000; // 15 minutes between alerts

async function triggerAlert(exchange, count, sampleText) {
  const lastAlert = alerted.get(exchange) ?? 0;
  if (Date.now() - lastAlert < ALERT_COOLDOWN) return;

  alerted.set(exchange, Date.now());

  const message = `OUTAGE SIGNAL: ${exchange.toUpperCase()} — ${count} complaints in 5 min\nSample: "${sampleText.slice(0, 100)}"`;

  // Log to console
  console.warn(message);

  // Post to your internal X account
  await postAlert(message);

  // Optionally: webhook to Slack, PagerDuty, trading system
  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
}
```

---

## Filtering False Positives

High-complaint moments that are not outages: exchange maintenance windows, token listing announcements causing load, and regulatory news generating complaints. Filter by time-of-day patterns and cross-reference against the exchange's official maintenance schedule:

```js
function isScheduledMaintenance(exchange) {
  // Check a cached schedule fetched from exchange status API
  return maintenanceWindows[exchange]?.some(window => {
    const now = Date.now();
    return now >= window.start && now <= window.end;
  }) ?? false;
}
```

---

## Conclusion

Exchange outage detection via X social signals works because users are faster than status pages. The key metric is complaint velocity over a sliding window, not absolute tweet count. With X's filtered stream, a velocity tracker, and a cooldown-gated alert pipeline, you can detect outages 2–10 minutes before official acknowledgment — enough lead time for automated position management or manual intervention.
