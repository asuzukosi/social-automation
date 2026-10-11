# How to Use X API to Track Crypto Derivatives Exchange Listings

**Meta description:** Build an automated system using X API to monitor crypto derivatives exchange listing announcements, enabling faster positioning on new perpetual and options markets.

---

## Introduction

Derivatives exchange listings are among the most tradeable events in crypto. When a token gets listed on Binance Futures, dYdX, or Bybit perpetuals, price and volume move predictably — and the traders who know first capture the most. Exchange listing announcements almost always appear on X before they show up in aggregators, price feeds, or news sites.

This guide shows you how to build an automated derivatives listing tracker that monitors exchange accounts, detects listing announcements, extracts the relevant asset metadata, and routes actionable signals to your trading infrastructure.

---

## Target Accounts

### Centralized derivatives exchanges

```
@binance            — Binance Futures listings
@Bybit_Official     — Bybit perpetuals and options
@OKX                — OKX derivatives
@BitMEX             — BitMEX perpetuals
@DeribitExchange    — Deribit (options leader)
@CMEGroup           — CME Bitcoin/Ethereum futures
@coinbaseintl       — Coinbase Advanced derivatives
@GateiO_Futures     — Gate.io futures
@HTX_Global         — HTX (formerly Huobi) derivatives
```

### Decentralized derivatives

```
@dYdX               — dYdX perpetuals (Cosmos)
@GMX_IO             — GMX (Arbitrum/Avalanche)
@DriftProtocol      — Drift (Solana)
@HyperliquidX       — Hyperliquid
@synthetix_io       — Synthetix
@polynomial_fi      — Polynomial options
```

### Aggregators that break listing news early

```
@DefiLlama          — On-chain data including derivatives
@CoinMarketCap      — Listings coverage
@coingecko          — Listings tracking
```

---

## Stream Setup

```js
import { TwitterStream } from 'xactions';

const LISTING_KEYWORDS = [
  'perpetual', 'perpetuals', 'futures listing', 'now listed',
  'new listing', 'launch.*perp', 'perp.*launch',
  'options listing', 'new contract', 'USDT-margined',
  'inverse contract', 'mark price', 'funding rate',
  'open interest', 'listed on', 'available for trading',
  'now trading', 'new pairs'
];

const EXCHANGE_ACCOUNTS = [
  'binance', 'Bybit_Official', 'OKX', 'BitMEX',
  'DeribitExchange', 'coinbaseintl', 'dYdX',
  'GMX_IO', 'DriftProtocol', 'HyperliquidX'
];

const stream = new TwitterStream({
  sessionCookie: process.env.XACTIONS_SESSION_COOKIE,
});

await stream.start({
  keywords: LISTING_KEYWORDS,
  accounts: EXCHANGE_ACCOUNTS,
  onTweet: processListingTweet
});
```

---

## Listing Signal Extraction

Extract the ticker, contract type, and launch time from listing announcements.

```js
function extractListingData(text) {
  const result = {
    tickers: [],
    contractType: null,
    leverage: null,
    launchTime: null,
    isConfirmed: false
  };

  // Extract ticker symbols (e.g., $BTC, DOGE, PEPE/USDT)
  const tickerPattern = /\$?([A-Z]{2,10})(?:\/?(USDT|BTC|USD|USDC|ETH))?/g;
  let match;
  while ((match = tickerPattern.exec(text)) !== null) {
    const ticker = match[1];
    // Filter common non-ticker caps words
    const skip = ['NEW', 'THE', 'FOR', 'NOW', 'ALL', 'GET', 'USD', 'USDT', 'API'];
    if (!skip.includes(ticker)) {
      result.tickers.push(ticker);
    }
  }

  // Detect contract type
  if (/perpetual|perp/i.test(text)) result.contractType = 'perpetual';
  else if (/option/i.test(text)) result.contractType = 'option';
  else if (/future/i.test(text)) result.contractType = 'future';
  else if (/inverse/i.test(text)) result.contractType = 'inverse';

  // Extract max leverage
  const levMatch = text.match(/(\d+)x\s*leverage|leverage.*?(\d+)x/i);
  if (levMatch) result.leverage = parseInt(levMatch[1] || levMatch[2]);

  // Detect if it's a confirmed listing vs. announcement
  result.isConfirmed = /now (trading|live|available)|trading (has begun|started)/i.test(text);

  // Extract launch time if present
  const timeMatch = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|UTC)?)|(\d{4}-\d{2}-\d{2})/i);
  if (timeMatch) result.launchTime = timeMatch[0];

  return result;
}
```

---

## Confidence Scoring

Not every tweet from an exchange is a listing announcement. Score confidence before routing to trading systems.

```js
function scoreListingConfidence(tweet, listingData) {
  let score = 0;

  // Higher weight if from official exchange account
  const officialAccounts = ['binance', 'Bybit_Official', 'OKX', 'DeribitExchange'];
  if (officialAccounts.includes(tweet.author)) score += 0.4;

  // Has recognizable ticker
  if (listingData.tickers.length > 0) score += 0.2;

  // Has contract type
  if (listingData.contractType) score += 0.2;

  // Confirmed live vs. future announcement
  if (listingData.isConfirmed) score += 0.2;
  else score += 0.05;

  // Contains trading link or announcement pattern
  if (/futures\.binance|bybit\.com|okx\.com|dydx\.exchange/i.test(tweet.text)) {
    score += 0.15;
  }

  return Math.min(score, 1.0);
}
```

---

## Routing to Trading Infrastructure

```js
const CONFIDENCE_THRESHOLD = 0.65;

async function processListingTweet(tweet) {
  const listingData = extractListingData(tweet.text);
  const confidence = scoreListingConfidence(tweet, listingData);

  await storeListingEvent({
    tweetId: tweet.id,
    author: tweet.author,
    text: tweet.text,
    ...listingData,
    confidence,
    detectedAt: new Date()
  });

  if (confidence >= CONFIDENCE_THRESHOLD && listingData.tickers.length > 0) {
    // Send to trading signal queue
    await publishToQueue('derivatives-listings', {
      tickers: listingData.tickers,
      exchange: tweet.author,
      contractType: listingData.contractType,
      leverage: listingData.leverage,
      isConfirmed: listingData.isConfirmed,
      confidence,
      sourceUrl: `https://x.com/i/web/status/${tweet.id}`,
      detectedAt: new Date().toISOString()
    });

    // Alert traders
    await sendSignalAlert(tweet, listingData, confidence);
  }
}
```

---

## Historical Listing Performance Analysis

Build a feedback loop to improve your signal quality by tracking post-listing price action.

```js
router.get('/listings/performance', async (req, res) => {
  const listings = await prisma.derivativesListing.findMany({
    where: {
      confidence: { gte: 0.65 },
      detectedAt: {
        gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days
      }
    },
    include: { priceAction: true }
  });

  const summary = listings.map(l => ({
    ticker: l.tickers[0],
    exchange: l.author,
    confidence: l.confidence,
    priceChange1h: l.priceAction?.change1h,
    priceChange24h: l.priceAction?.change24h,
    volumeSpike: l.priceAction?.volumeMultiplier
  }));

  res.json({ listings: summary });
});
```

---

## Conclusion

Derivatives exchange listing announcements on X are time-sensitive, high-value signals. The key challenges are separating confirmed listings from pre-announcements, extracting ticker and contract metadata reliably, and routing only high-confidence signals to trading infrastructure. The system above gives you a starting framework — tune confidence thresholds against your historical data and use the performance analysis endpoint to measure signal quality over time.
