---
title: "Building a Crypto Trading Bot with APIs (2026)"
meta_description: "Learn how to build an automated crypto trading bot using exchange APIs. Covers strategy implementation, order management, risk controls, and backtesting."
keywords: "crypto trading bot API, automated trading API, algorithmic trading crypto, trading bot Binance, crypto bot development"
---

# Building a Crypto Trading Bot with APIs (2026)

Automated trading bots execute strategies 24/7 without emotion. This guide covers building a production-grade bot using exchange APIs.

## Architecture

```
Market Data (WebSocket) → Strategy Engine → Signal Generator → Order Manager → Exchange API
                                    ↑
                              Risk Manager
```

## Market Data Feed

```javascript
class MarketDataFeed {
  constructor(symbol, interval = '1m') {
    this.symbol = symbol.toLowerCase();
    this.candles = [];
    this.connect(interval);
  }

  connect(interval) {
    this.ws = new WebSocket(
      `wss://stream.binance.com:9443/ws/${this.symbol}@kline_${interval}`
    );

    this.ws.onmessage = ({ data }) => {
      const { k: candle } = JSON.parse(data);
      if (candle.x) { // candle closed
        this.candles.push({
          open: parseFloat(candle.o),
          high: parseFloat(candle.h),
          low: parseFloat(candle.l),
          close: parseFloat(candle.c),
          volume: parseFloat(candle.v),
          timestamp: candle.T
        });
        if (this.candles.length > 200) this.candles.shift();
        this.onCandle?.(this.candles);
      }
    };

    this.ws.onclose = () => setTimeout(() => this.connect(interval), 3000);
  }
}
```

## Simple Moving Average Strategy

```javascript
function smaStrategy(candles, fastPeriod = 10, slowPeriod = 20) {
  if (candles.length < slowPeriod) return 'hold';

  const closes = candles.map(c => c.close);
  const fast = closes.slice(-fastPeriod).reduce((a, b) => a + b) / fastPeriod;
  const slow = closes.slice(-slowPeriod).reduce((a, b) => a + b) / slowPeriod;

  const prevFast = closes.slice(-fastPeriod - 1, -1).reduce((a, b) => a + b) / fastPeriod;
  const prevSlow = closes.slice(-slowPeriod - 1, -1).reduce((a, b) => a + b) / slowPeriod;

  if (prevFast <= prevSlow && fast > slow) return 'buy';
  if (prevFast >= prevSlow && fast < slow) return 'sell';
  return 'hold';
}
```

## RSI Indicator

```javascript
function calculateRSI(closes, period = 14) {
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains = changes.map(c => Math.max(c, 0));
  const losses = changes.map(c => Math.max(-c, 0));

  const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
```

## Order Manager

```javascript
import crypto from 'crypto';

class OrderManager {
  constructor(apiKey, secret, baseUrl = 'https://api.binance.com') {
    this.apiKey = apiKey;
    this.secret = secret;
    this.baseUrl = baseUrl;
  }

  sign(params) {
    const query = new URLSearchParams(params).toString();
    const sig = crypto.createHmac('sha256', this.secret).update(query).digest('hex');
    return `${query}&signature=${sig}`;
  }

  async placeOrder(symbol, side, quantity, price = null) {
    const params = {
      symbol,
      side: side.toUpperCase(),
      type: price ? 'LIMIT' : 'MARKET',
      quantity: quantity.toFixed(5),
      timestamp: Date.now(),
      ...(price && { price: price.toFixed(2), timeInForce: 'GTC' })
    };

    const res = await fetch(`${this.baseUrl}/api/v3/order?${this.sign(params)}`, {
      method: 'POST',
      headers: { 'X-MBX-APIKEY': this.apiKey }
    });
    return res.json();
  }
}
```

## Risk Manager

```javascript
class RiskManager {
  constructor({ maxPositionPct = 0.1, stopLossPct = 0.02, maxDailyLoss = 0.05 }) {
    this.maxPositionPct = maxPositionPct;
    this.stopLossPct = stopLossPct;
    this.maxDailyLoss = maxDailyLoss;
    this.dailyPnl = 0;
    this.positions = new Map();
  }

  canTrade() {
    return this.dailyPnl > -this.maxDailyLoss;
  }

  positionSize(accountBalance, price) {
    return (accountBalance * this.maxPositionPct) / price;
  }

  shouldStopLoss(entryPrice, currentPrice, side) {
    const pnlPct = side === 'buy'
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;
    return pnlPct < -this.stopLossPct;
  }
}
```

## Full Bot Loop

```javascript
const feed = new MarketDataFeed('BTCUSDT', '5m');
const orders = new OrderManager(process.env.BINANCE_KEY, process.env.BINANCE_SECRET);
const risk = new RiskManager({ maxPositionPct: 0.05, stopLossPct: 0.015 });

let position = null;

feed.onCandle = async (candles) => {
  if (!risk.canTrade()) return;

  const signal = smaStrategy(candles);
  const closes = candles.map(c => c.close);
  const rsi = calculateRSI(closes);
  const price = closes[closes.length - 1];

  if (signal === 'buy' && rsi < 65 && !position) {
    const qty = risk.positionSize(1000, price);
    const order = await orders.placeOrder('BTCUSDT', 'buy', qty);
    position = { side: 'buy', entryPrice: price, orderId: order.orderId };
  }

  if (position && (signal === 'sell' || risk.shouldStopLoss(position.entryPrice, price, position.side))) {
    await orders.placeOrder('BTCUSDT', 'sell', position.qty);
    position = null;
  }
};
```
