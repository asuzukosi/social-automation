# Building a Crypto Market Maker Monitoring System via X

**Meta description:** Build a system to monitor crypto market maker activity, spread announcements, and liquidity provision signals via the X API for competitive intelligence and risk management.

---

## Introduction

Market makers are the hidden infrastructure of crypto markets. They post on X about new exchange partnerships, liquidity provision programs, spread adjustments during volatility, and platform outages that affect their operations. For traders, funds, and protocol teams running liquidity programs, monitoring market maker activity on X provides early warning of liquidity changes, bid-ask spread widening, and exchange health issues.

This guide covers building a Node.js system that monitors X for market maker signals and integrates with exchange APIs for correlation.

---

## Who to Monitor: Market Maker Accounts

**Institutional market makers with active X presence:**
- `@WintermuteTrade` — Wintermute, high signal on exchange partnerships
- `@kaikodata` — market data, liquidity analysis
- `@GlobusHoldings` — active on exchange integrations
- `@Amber_Group_` — trading desk updates
- `@GSR_io` — GSR, DeFi and CeFi liquidity
- `@FalconXNetwork` — prime brokerage, liquidity updates
- `@B2C2Ltd` — OTC, institutional liquidity

**DeFi market makers and AMM protocols:**
- `@GauntletNetwork` — risk and liquidity optimization
- `@ChaosLabsHQ` — DeFi parameter recommendations (affects MM profitability)
- `@AaveAave`, `@compoundfinance` — rate changes affect MM strategies
- `@UniswapProtocol` — fee tier changes, new pool launches

**Analysts covering market structure:**
- `@skewdotcom`, `@laevitas1` — options market, MM-relevant metrics
- `@QCPCapital` — vol desk, spread and risk commentary

---

## Signal Categories for Market Makers

```javascript
const MM_SIGNAL_RULES = [
  {
    value: '("market maker" OR "liquidity provider" OR "market making") (crypto OR DeFi OR exchange) -is:retweet lang:en',
    tag: 'mm_general'
  },
  {
    value: 'from:WintermuteTrade OR from:GSR_io OR from:Amber_Group_ OR from:FalconXNetwork -is:retweet',
    tag: 'mm_official'
  },
  {
    value: '("spread widening" OR "liquidity withdrawn" OR "halting market making" OR "reducing exposure") -is:retweet lang:en',
    tag: 'mm_risk_event'
  },
  {
    value: '("new listing" OR "listing partnership" OR "liquidity program") ("exchange" OR "DEX" OR "CEX") -is:retweet lang:en',
    tag: 'mm_partnership'
  },
  {
    value: '("bid ask" OR "bid-ask" OR "slippage" OR "thin orderbook" OR "low liquidity") (BTC OR ETH OR SOL OR "altcoin") -is:retweet lang:en',
    tag: 'market_structure'
  },
];
```

---

## Classifying Market Maker Events

```javascript
const MM_EVENT_TYPES = {
  RISK_OFF: {
    terms: ['reducing exposure', 'halting', 'pausing operations', 'spread widening', 'liquidity withdrawn', 'pulling liquidity'],
    impact: 'NEGATIVE',
    priority: 'HIGH',
  },
  NEW_LISTING: {
    terms: ['new listing', 'now live on', 'now supporting', 'added support for', 'listing partnership'],
    impact: 'POSITIVE',
    priority: 'MEDIUM',
  },
  SYSTEM_OUTAGE: {
    terms: ['system issues', 'experiencing issues', 'temporarily unavailable', 'maintenance', 'outage'],
    impact: 'NEGATIVE',
    priority: 'HIGH',
  },
  VOLUME_MILESTONE: {
    terms: ['daily volume', 'trading volume', 'record volume', 'billion in volume'],
    impact: 'POSITIVE',
    priority: 'LOW',
  },
  REGULATORY: {
    terms: ['compliance', 'licensed', 'registered', 'regulatory approval', 'restricted'],
    impact: 'NEUTRAL',
    priority: 'MEDIUM',
  },
};

function classifyMMEvent(text) {
  const lower = text.toLowerCase();
  const matches = [];

  for (const [type, config] of Object.entries(MM_EVENT_TYPES)) {
    const matched = config.terms.filter(t => lower.includes(t));
    if (matched.length) {
      matches.push({ type, ...config, matchedTerms: matched, score: matched.length });
    }
  }

  return matches.sort((a, b) => {
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  })[0] ?? null;
}
```

---

## Correlating X Signals with Exchange Data

When a risk-off event is detected, cross-reference with live exchange data:

```javascript
async function fetchOrderBookDepth(exchange, symbol) {
  const endpoints = {
    binance: `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`,
    coinbase: `https://api.coinbase.com/api/v3/brokerage/best_bid_ask?product_ids=${symbol}`,
    bybit: `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=25`,
  };

  const url = endpoints[exchange];
  if (!url) return null;

  const res = await fetch(url);
  const data = await res.json();
  return normalizeOrderBook(exchange, data);
}

function normalizeOrderBook(exchange, raw) {
  if (exchange === 'binance') {
    const topBid = parseFloat(raw.bids[0]?.[0]);
    const topAsk = parseFloat(raw.asks[0]?.[0]);
    const spread = ((topAsk - topBid) / topBid) * 100;
    const bidDepth = raw.bids.slice(0, 10).reduce((s, [, qty]) => s + parseFloat(qty), 0);
    const askDepth = raw.asks.slice(0, 10).reduce((s, [, qty]) => s + parseFloat(qty), 0);
    return { exchange, topBid, topAsk, spread, bidDepth, askDepth };
  }
  // Add normalization for other exchanges
  return null;
}

async function correlateMMLiquiditySignal(mmEvent, affectedTokens) {
  const correlations = [];

  for (const token of affectedTokens) {
    const symbol = `${token}USDT`;
    const [binanceBook, bybitBook] = await Promise.all([
      fetchOrderBookDepth('binance', symbol),
      fetchOrderBookDepth('bybit', symbol),
    ]);

    if (binanceBook && bybitBook) {
      const spreadChange = binanceBook.spread - bybitBook.spread;
      correlations.push({
        token,
        binanceSpread: binanceBook.spread.toFixed(4),
        bybitSpread: bybitBook.spread.toFixed(4),
        spreadDivergence: Math.abs(spreadChange).toFixed(4),
        liquidityRisk: binanceBook.bidDepth < 10 ? 'HIGH' : 'NORMAL',
      });
    }
  }

  return correlations;
}
```

---

## Detecting Coordinated Liquidity Events

When multiple MMs post similar signals within a short window, it may indicate a systemic event:

```javascript
import { createClient } from 'redis';
const redis = createClient({ url: process.env.REDIS_URL });

async function detectCoordinatedEvent(event, authorUsername) {
  const windowKey = `mm_event:${event.type}:${Math.floor(Date.now() / 300000)}`; // 5-min bucket
  const count = await redis.incr(windowKey);
  await redis.expire(windowKey, 600);

  if (count === 1) {
    // First signal — start tracking
    await redis.lPush(`mm_event_sources:${windowKey}`, authorUsername);
  } else {
    await redis.lPush(`mm_event_sources:${windowKey}`, authorUsername);
  }

  if (count >= 3) {
    const sources = await redis.lRange(`mm_event_sources:${windowKey}`, 0, -1);
    return {
      isCoordinated: true,
      count,
      sources: [...new Set(sources)],
      eventType: event.type,
    };
  }

  return { isCoordinated: false, count };
}
```

---

## Alert Dashboard Integration

```javascript
async function processMMSignal(tweetData, includes) {
  const { data: tweet, matching_rules } = tweetData;
  const author = includes?.users?.find(u => u.id === tweet.author_id);

  const event = classifyMMEvent(tweet.text);
  if (!event) return;

  const coordinated = await detectCoordinatedEvent(event, author.username);

  // Extract mentioned tokens
  const tokens = [...tweet.text.matchAll(/\$([A-Z]{2,6})\b/g)].map(m => m[1]);

  // For high-priority or coordinated events, fetch order book data
  let correlations = [];
  if (event.priority === 'HIGH' || coordinated.isCoordinated) {
    correlations = await correlateMMLiquiditySignal(event, tokens.slice(0, 3));
  }

  const alert = {
    type: event.type,
    impact: event.impact,
    priority: coordinated.isCoordinated ? 'CRITICAL' : event.priority,
    source: author.username,
    text: tweet.text,
    url: `https://x.com/i/web/status/${tweet.id}`,
    tokens,
    correlations,
    coordinated,
    timestamp: tweet.created_at,
  };

  await postMMAlert(alert);
}
```

---

## Conclusion

Market maker monitoring on X gives you a front-row view of institutional liquidity decisions before they manifest in order books. The key is knowing which accounts to watch, building event classifiers that distinguish between risk-off events (high priority) and routine announcements (low priority), and correlating X signals with live order book data to confirm real liquidity changes. Coordinated event detection across multiple MM accounts is your highest-value signal — when three or more major market makers post similar content within minutes, something significant is happening to market structure.
