# Using X API for Real-Time Crypto Arbitrage Signal Detection

**Meta description:** Build a real-time arbitrage signal detection system using X API to identify exchange price discrepancies, CEX/DEX spreads, and cross-chain opportunities from social data.

---

## Introduction

Arbitrage in crypto is an information speed game. Exchange outages, deposit/withdrawal suspensions, liquidity crises, and listing desynchronizations all create tradeable price gaps — and these events are announced or leaked on X before they fully propagate into price feeds.

X API data, combined with on-chain price feeds, gives you a dual-layer signal system: social detection of events that will cause spreads, and price feed confirmation of spreads that already exist. This guide covers the social signal layer — the half most arbitrage systems ignore.

---

## Arbitrage Signal Categories on X

Not all X signals relate to arbitrage, but several categories are highly predictive:

| Signal Type | Example | Likely Market Impact |
|---|---|---|
| Exchange withdrawal suspension | "Withdrawals temporarily suspended" | Premium on that exchange vs. others |
| Deposit halt | "BTC deposits paused" | Discount on that exchange |
| DEX liquidity crisis | "Pool drained", "slippage warning" | CEX/DEX spread widens |
| Bridge outage | "Bridge maintenance" | Cross-chain spread persists |
| New listing desync | Asset listed on one exchange before others | Price gap between exchanges |
| Stablecoin depeg | "USDC depeg", "USDT bank run" | Stablecoin/fiat arb opportunity |

---

## Stream Configuration

```js
import { TwitterStream } from 'xactions';

const ARB_SIGNAL_KEYWORDS = [
  // Exchange operational signals
  'withdrawal suspended', 'withdrawals paused', 'deposits halted',
  'temporarily unavailable', 'maintenance mode', 'under maintenance',
  'processing delays', 'wallet maintenance',

  // DEX/DeFi signals
  'pool drained', 'liquidity crisis', 'slippage', 'price impact',
  'impermanent loss', 'exploit', 'flashloan', 'sandwich attack',

  // Bridge signals
  'bridge paused', 'bridge maintenance', 'cross-chain delay',

  // Stablecoin signals
  'depeg', 'peg deviation', 'bank run', 'redemption suspended',

  // Listing signals
  'now listed', 'new listing', 'trading begins'
];

const EXCHANGE_STATUS_ACCOUNTS = [
  // Status accounts
  'BinanceHelpDesk', 'CoinbaseSupport', 'Bybit_Support',
  'OKX', 'KrakenSupport', 'GateioHelp',
  // Official exchange accounts
  'binance', 'coinbase', 'Bybit_Official', 'krakenfx',
  // DeFi protocol accounts
  'Uniswap', 'AaveAave', 'CurveFinance', 'MakerDAO',
  // Bridge accounts
  'StargateFinance', 'HopProtocol', 'LayerZero_Core'
];

const stream = new TwitterStream({
  sessionCookie: process.env.XACTIONS_SESSION_COOKIE,
});

await stream.start({
  keywords: ARB_SIGNAL_KEYWORDS,
  accounts: EXCHANGE_STATUS_ACCOUNTS,
  onTweet: processArbSignal
});
```

---

## Signal Classification and Urgency Scoring

```js
function classifyArbSignal(tweet) {
  const text = tweet.text.toLowerCase();

  const categories = {
    withdrawal_suspension: /withdrawal.*suspend|suspend.*withdrawal|withdraw.*halt|withdraw.*pause/,
    deposit_halt: /deposit.*halt|deposit.*pause|deposit.*suspend/,
    exchange_outage: /down|outage|offline|unavailable|incident/,
    dex_exploit: /exploit|flashloan|drain|attack|hack/,
    bridge_issue: /bridge.*pause|bridge.*down|cross.chain.*delay/,
    stablecoin_depeg: /depeg|peg.*deviation|bank run/,
    new_listing: /now listed|new listing|trading begins|available for trading/
  };

  let detectedCategory = 'general';
  for (const [cat, pattern] of Object.entries(categories)) {
    if (pattern.test(text)) {
      detectedCategory = cat;
      break;
    }
  }

  // Urgency: higher for events that create immediate tradeable spreads
  const urgencyMap = {
    withdrawal_suspension: 'critical',
    dex_exploit: 'critical',
    stablecoin_depeg: 'critical',
    deposit_halt: 'high',
    exchange_outage: 'high',
    bridge_issue: 'high',
    new_listing: 'medium',
    general: 'low'
  };

  return {
    category: detectedCategory,
    urgency: urgencyMap[detectedCategory],
    affectedExchange: extractExchangeName(tweet.author, tweet.text)
  };
}

function extractExchangeName(author, text) {
  const authorMap = {
    'BinanceHelpDesk': 'Binance', 'binance': 'Binance',
    'CoinbaseSupport': 'Coinbase', 'coinbase': 'Coinbase',
    'Bybit_Support': 'Bybit', 'Bybit_Official': 'Bybit',
    'KrakenSupport': 'Kraken', 'krakenfx': 'Kraken',
    'OKX': 'OKX'
  };

  if (authorMap[author]) return authorMap[author];

  // Fall back to text extraction
  const exchangeNames = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'OKX', 'Bitget', 'HTX'];
  for (const name of exchangeNames) {
    if (text.includes(name)) return name;
  }

  return null;
}
```

---

## Correlating Social Signals with Price Data

```js
import { createPublicClient, http } from 'viem';

async function correlateWithPriceData(signal) {
  if (signal.urgency !== 'critical' && signal.urgency !== 'high') return;

  // Fetch prices from multiple sources
  const prices = await fetchMultiSourcePrices(signal.affectedExchange);

  if (!prices) return;

  const { cexPrice, dexPrice } = prices;
  const spreadPct = Math.abs(cexPrice - dexPrice) / cexPrice * 100;

  if (spreadPct > 0.5) {
    await publishArbOpportunity({
      signal,
      spreadPercent: spreadPct,
      cexPrice,
      dexPrice,
      direction: cexPrice > dexPrice ? 'buy_dex_sell_cex' : 'buy_cex_sell_dex',
      detectedAt: new Date().toISOString(),
      sourceUrl: `https://x.com/i/web/status/${signal.tweetId}`
    });
  }
}

async function fetchMultiSourcePrices(excludeExchange) {
  try {
    const [cexResponse, dexResponse] = await Promise.all([
      fetch(`${process.env.PRICE_FEED_URL}/cex?exclude=${excludeExchange}`),
      fetch(`${process.env.PRICE_FEED_URL}/dex`)
    ]);

    return {
      cexPrice: (await cexResponse.json()).price,
      dexPrice: (await dexResponse.json()).price
    };
  } catch {
    return null;
  }
}
```

---

## Opportunity Publication

```js
async function processArbSignal(tweet) {
  const signal = classifyArbSignal(tweet);
  signal.tweetId = tweet.id;
  signal.author = tweet.author;
  signal.text = tweet.text;

  await storeSignal(signal);

  if (signal.urgency === 'critical') {
    // Immediate correlation attempt
    await correlateWithPriceData(signal);

    // Alert trading desk
    await sendCriticalAlert({
      title: `ARB SIGNAL: ${signal.category.replace(/_/g, ' ').toUpperCase()}`,
      exchange: signal.affectedExchange,
      tweet: tweet.text,
      url: `https://x.com/i/web/status/${tweet.id}`
    });
  }
}

async function publishArbOpportunity(opportunity) {
  // Push to trading system via queue
  await arbQueue.add('opportunity', opportunity, { priority: 1 });

  // Log to database
  await prisma.arbOpportunity.create({
    data: {
      signalSource: 'x_social',
      spreadPercent: opportunity.spreadPercent,
      direction: opportunity.direction,
      affectedExchange: opportunity.signal.affectedExchange,
      sourceUrl: opportunity.sourceUrl,
      detectedAt: new Date()
    }
  });
}
```

---

## Backtesting Signal Quality

Track which signal categories actually correlated with spreads to tune your system.

```js
router.get('/arb/signal-performance', async (req, res) => {
  const signals = await prisma.arbSignal.findMany({
    include: { opportunities: true },
    orderBy: { detectedAt: 'desc' },
    take: 200
  });

  const performance = {};
  for (const signal of signals) {
    const cat = signal.category;
    if (!performance[cat]) {
      performance[cat] = { total: 0, withOpportunity: 0, avgSpread: 0 };
    }
    performance[cat].total++;
    if (signal.opportunities.length > 0) {
      performance[cat].withOpportunity++;
      const avgSpread = signal.opportunities.reduce((a, b) => a + b.spreadPercent, 0) / signal.opportunities.length;
      performance[cat].avgSpread = (performance[cat].avgSpread + avgSpread) / 2;
    }
  }

  // Calculate hit rate per category
  const result = Object.entries(performance).map(([cat, stats]) => ({
    category: cat,
    hitRate: stats.withOpportunity / stats.total,
    averageSpread: stats.avgSpread,
    sampleSize: stats.total
  }));

  res.json({ performance: result });
});
```

---

## Conclusion

Social signal detection is the underutilized layer in crypto arbitrage systems. Most traders react to price divergences after they appear; social monitoring lets you position ahead of divergences caused by known operational events. The framework above — stream-based detection, urgency classification, price correlation, and opportunity publication — gives you the infrastructure to exploit this timing advantage systematically. Backtest your signal categories against historical opportunities and cut the low-hit-rate ones to keep the signal-to-noise ratio high.
