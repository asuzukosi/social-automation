---
title: "Crypto Historical Data APIs: OHLCV, Price History, and Backtesting (2026)"
meta_description: "Best APIs for historical cryptocurrency data — OHLCV candles, tick data, trade history. CoinGecko, CryptoCompare, Binance, and Kaiko compared."
keywords: "crypto historical data API, OHLCV API, historical price API, backtesting data API, CryptoCompare API"
---

# Crypto Historical Data APIs: OHLCV, Price History, and Backtesting (2026)

Historical data is essential for backtesting trading strategies, building charts, and training ML models. Here's how to access it from the best providers.

## Binance (Best Free Option)

```javascript
// OHLCV candles — up to 1000 per request, any interval
async function getBinanceCandles(symbol, interval, limit = 500) {
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  const raw = await res.json();
  return raw.map(([openTime, open, high, low, close, volume, closeTime]) => ({
    time: openTime,
    open: parseFloat(open),
    high: parseFloat(high),
    low: parseFloat(low),
    close: parseFloat(close),
    volume: parseFloat(volume)
  }));
}

// Usage
const candles = await getBinanceCandles('BTCUSDT', '1d', 365);

// Paginate for full history
async function getFullHistory(symbol, interval, startTime) {
  const all = [];
  let from = startTime;

  while (true) {
    const batch = await getBinanceCandlesPaged(symbol, interval, from, 1000);
    if (batch.length === 0) break;
    all.push(...batch);
    from = batch[batch.length - 1].time + 1;
    await new Promise(r => setTimeout(r, 200)); // respect rate limit
  }
  return all;
}
```

## CoinGecko Historical

```javascript
// Daily OHLCV (limited to 90 days on free tier)
const ohlcv = await fetch(
  'https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=90'
).then(r => r.json());
// [[timestamp, open, high, low, close], ...]

// Daily closes for any time range
const history = await fetch(
  'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=1609459200&to=1640995200'
).then(r => r.json());
// history.prices = [[timestamp, price], ...]
```

## CryptoCompare

```javascript
const key = process.env.CRYPTOCOMPARE_API_KEY;
const headers = { 'authorization': `Apikey ${key}` };

// Daily OHLCV — up to 2000 days, any exchange
const res = await fetch(
  'https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=365&e=Coinbase',
  { headers }
).then(r => r.json());
const candles = res.Data.Data;

// Hourly
const hourly = await fetch(
  'https://min-api.cryptocompare.com/data/v2/histohour?fsym=ETH&tsym=USD&limit=720',
  { headers }
).then(r => r.json());

// Minute
const minute = await fetch(
  'https://min-api.cryptocompare.com/data/v2/histominute?fsym=BTC&tsym=USD&limit=1440',
  { headers }
).then(r => r.json());
```

## Kaiko (Institutional Grade)

Kaiko provides tick-by-tick trade data from 100+ exchanges:

```javascript
const res = await fetch(
  'https://us.market-api.kaiko.io/v2/data/trades.v1/spot_direct_exchange_rate/btc/usd?interval=1d&start_time=2024-01-01T00:00:00Z',
  { headers: { 'X-Api-Key': process.env.KAIKO_API_KEY } }
).then(r => r.json());
```

## Building a Backtester

```javascript
function backtest(candles, strategy, initialCapital = 10000) {
  let cash = initialCapital;
  let position = 0;
  let trades = [];

  for (let i = 20; i < candles.length; i++) {
    const signal = strategy(candles.slice(0, i));
    const price = candles[i].close;

    if (signal === 'buy' && cash > 0) {
      position = cash / price;
      cash = 0;
      trades.push({ type: 'buy', price, time: candles[i].time });
    } else if (signal === 'sell' && position > 0) {
      cash = position * price;
      position = 0;
      trades.push({ type: 'sell', price, time: candles[i].time });
    }
  }

  const finalValue = cash + position * candles[candles.length - 1].close;
  return {
    finalValue,
    roi: ((finalValue - initialCapital) / initialCapital * 100).toFixed(2) + '%',
    trades: trades.length,
    sharpe: calculateSharpe(trades, candles)
  };
}
```
