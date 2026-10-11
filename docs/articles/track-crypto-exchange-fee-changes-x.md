# How to Use X API to Track Crypto Exchange Fee Changes

**Meta description:** Monitor crypto exchange fee changes, maker/taker updates, and withdrawal fee announcements in real time using X API filtered streams and Node.js.

---

## Introduction

Exchange fees directly impact trading profitability. A maker fee increase from 0.1% to 0.15% might seem trivial until you run the numbers on high-frequency or high-volume strategies. Exchanges announce fee changes on X before they post them to their documentation, before changelog emails go out, sometimes before the fee engine even updates. Being first to detect these announcements lets you adjust strategy, move volume, or front-run the news.

This guide builds a crypto exchange fee change tracker using the X API v2 filtered stream.

---

## Which Exchanges to Track

Focus on exchanges that actually post operational updates on X, rather than purely marketing content. High-signal exchanges include:

- **Spot DEXes**: Uniswap, Curve, Balancer, dYdX official accounts
- **CEXes with active X presence**: Binance, Coinbase, Kraken, OKX, Bybit
- **Derivatives**: Hyperliquid, GMX, Perpetual Protocol
- **Aggregators**: 1inch, Paraswap — these post fee-related updates when routing changes

Get user IDs for each. Store them in a config file, not hardcoded in stream rule logic.

---

## Stream Rules

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

const EXCHANGE_ACCOUNT_IDS = await loadExchangeAccountIds(); // from config

const FEE_RULES = [
  {
    value: `(${EXCHANGE_ACCOUNT_IDS.map(id => `from:${id}`).join(' OR ')})`,
    tag: 'exchange-accounts',
  },
  {
    value: '(maker OR taker OR "trading fee" OR "withdrawal fee" OR "gas fee") (update OR change OR new OR increase OR decrease OR reduce) lang:en -is:retweet',
    tag: 'fee-keywords',
  },
  {
    value: '("fee schedule" OR "fee structure" OR "fee tier" OR "fee update") lang:en',
    tag: 'fee-schedule',
  },
  {
    value: '("zero fee" OR "0% fee" OR "fee free" OR "fee waiver") (trading OR withdrawal) lang:en',
    tag: 'fee-promotion',
  },
];

await client.v2.updateStreamRules({ add: FEE_RULES });
```

The first rule (exchange accounts) will generate volume. Combine it with keyword filtering client-side to avoid burning rate limits on irrelevant posts.

---

## Parsing Fee Percentages from Tweet Text

Fee announcements follow recognizable patterns. Extract percentage values:

```js
const FEE_PATTERNS = {
  makerFee: /maker(?:\s+fee)?\s*(?:of\s+|:\s*)?([0-9.]+)\s*%/i,
  takerFee: /taker(?:\s+fee)?\s*(?:of\s+|:\s*)?([0-9.]+)\s*%/i,
  tradingFee: /trading\s+fee\s*(?:of\s+|:\s*)?([0-9.]+)\s*%/i,
  withdrawalFee: /withdrawal\s+fee\s*(?:of\s+)?([0-9.,]+)\s*([A-Z]{2,6})/i,
  feeReduction: /(\d+)\s*%\s+(?:fee\s+)?(?:reduction|discount|rebate)/i,
};

function parseFeeData(text) {
  const result = { raw: text };
  for (const [field, pattern] of Object.entries(FEE_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      result[field] = parseFloat(match[1]);
      if (match[2]) result[`${field}Token`] = match[2];
    }
  }
  return result;
}

function detectFeeDirection(text) {
  const lower = text.toLowerCase();
  if (/reduce|lower|decrease|cut|drop|from.*to.*less/i.test(lower)) return 'DECREASE';
  if (/increase|raise|higher|new.*higher|up.*to/i.test(lower)) return 'INCREASE';
  if (/zero|free|no fee|waive/i.test(lower)) return 'ZERO';
  if (/introduce|new.*fee|fee.*start/i.test(lower)) return 'NEW';
  return 'CHANGE';
}
```

---

## Database Schema

```sql
CREATE TABLE exchange_fee_events (
  id BIGSERIAL PRIMARY KEY,
  tweet_id VARCHAR(30) UNIQUE NOT NULL,
  tweet_text TEXT NOT NULL,
  exchange_name VARCHAR(50),
  author_id VARCHAR(30) NOT NULL,
  fee_type VARCHAR(30),      -- 'maker', 'taker', 'withdrawal', 'trading', 'promotion'
  direction VARCHAR(10),     -- 'INCREASE', 'DECREASE', 'ZERO', 'NEW', 'CHANGE'
  old_fee DECIMAL(8, 5),
  new_fee DECIMAL(8, 5),
  fee_token VARCHAR(10),     -- for withdrawal fees denominated in specific tokens
  effective_date TIMESTAMPTZ,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  engagement_score INT
);

CREATE INDEX ON exchange_fee_events (exchange_name, detected_at DESC);
CREATE INDEX ON exchange_fee_events (direction, detected_at DESC);
```

---

## Resolving Exchange Name from Author ID

Map author IDs to exchange names at ingest time:

```js
const EXCHANGE_ID_MAP = {
  '783214': 'Twitter',  // example placeholder
  // load from config/exchanges.json
};

async function loadExchangeMap() {
  const config = JSON.parse(
    await fs.readFile('./config/exchanges.json', 'utf8')
  );
  return Object.fromEntries(
    config.map(({ id, name }) => [id, name])
  );
}
```

Maintain this map as a JSON config file. When an exchange changes usernames, update the config; the ID stays constant.

---

## Detecting Fee Changes vs. Fee Promotions

Fee promotions (limited-time zero fees, trading competitions) are different from permanent changes. Classify them:

```js
const PROMOTION_SIGNALS = [
  /limited time/i,
  /for \d+ (day|week|month)/i,
  /until [A-Z][a-z]+/i,
  /trading competition/i,
  /launch promotion/i,
  /temporarily/i,
];

function isPromotion(text) {
  return PROMOTION_SIGNALS.some(pattern => pattern.test(text));
}

async function processFeeEvent(tweet, exchangeName) {
  const feeData = parseFeeData(tweet.text);
  const direction = detectFeeDirection(tweet.text);
  const promotion = isPromotion(tweet.text);

  if (!hasRelevantFeeData(feeData)) return;

  await db.query(
    `INSERT INTO exchange_fee_events
      (tweet_id, tweet_text, exchange_name, author_id, direction, new_fee,
       fee_type, detected_at, engagement_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [
      tweet.id, tweet.text, exchangeName, tweet.author_id,
      promotion ? 'PROMOTION' : direction,
      feeData.makerFee ?? feeData.tradingFee ?? feeData.takerFee,
      detectFeeType(feeData),
      computeEngagement(tweet.public_metrics),
    ]
  );
}
```

---

## Alerting and Comparison

When a fee change is detected for an exchange you actively use, fire an immediate alert:

```js
const TRACKED_EXCHANGES = new Set(['Binance', 'Bybit', 'Hyperliquid']);

async function maybeAlert(event) {
  if (!TRACKED_EXCHANGES.has(event.exchange_name)) return;
  if (!['INCREASE', 'DECREASE', 'ZERO'].includes(event.direction)) return;

  const message = formatFeeAlert(event);
  await Promise.all([
    sendSlackAlert(message),
    sendTelegramAlert(message),
  ]);
}

function formatFeeAlert(event) {
  return `[FEE CHANGE] ${event.exchange_name}
Direction: ${event.direction}
Type: ${event.fee_type}
New fee: ${event.new_fee}%
Tweet: https://x.com/i/status/${event.tweet_id}`;
}
```

---

## Conclusion

Exchange fee changes on X surface faster than any other channel. The system described here — filtered stream rules targeting exchange accounts and fee keywords, regex parsing of percentage values, direction classification, and PostgreSQL storage — gives you structured fee intelligence without relying on any exchange's changelog or email list. Add alerting for your active exchanges and you'll catch every meaningful fee event as it happens.
