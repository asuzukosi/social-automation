---
title: "Crypto WebSocket APIs: Real-Time Data for Trading Apps (2026)"
meta_description: "Master WebSocket APIs for cryptocurrency — live price feeds, order book streams, trade data from Binance, Coinbase, Kraken, and decentralized sources."
keywords: "crypto WebSocket API, real-time crypto price, live order book API, trading WebSocket, crypto streaming API"
---

# Crypto WebSocket APIs: Real-Time Data for Trading Apps (2026)

WebSocket connections are essential for any crypto application that needs live data — trading bots, price tickers, order book visualizations, and liquidation dashboards all depend on persistent, low-latency streams.

## REST vs WebSocket

| | REST | WebSocket |
|---|---|---|
| Connection | New per request | Persistent |
| Latency | 50–200ms | 5–20ms |
| Data freshness | Polling interval | Real-time push |
| Server load | High (polling) | Low |
| Best for | OHLCV, account data | Live prices, order books |

## Binance WebSocket

```javascript
// Single stream
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');

// Combined streams
const ws = new WebSocket('wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@ticker');

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  const tick = msg.data || msg; // combined vs single
  console.log(tick.s, tick.c); // symbol, close price
};
```

**Binance stream types:**
- `<symbol>@aggTrade` — aggregated trades
- `<symbol>@kline_<interval>` — candles (1m, 5m, 1h, 1d...)
- `<symbol>@depth<levels>` — partial order book (5, 10, or 20 levels)
- `<symbol>@depth@100ms` — diff order book updates
- `!ticker@arr` — all symbols ticker

## Coinbase WebSocket

```javascript
const ws = new WebSocket('wss://advanced-trade-ws.coinbase.com');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    product_ids: ['BTC-USD', 'ETH-USD'],
    channel: 'level2'
  }));
};

ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.channel === 'l2_data') {
    msg.events.forEach(e => {
      e.updates.forEach(u => console.log(u.side, u.price_level, u.new_quantity));
    });
  }
};
```

## Kraken WebSocket

```javascript
const ws = new WebSocket('wss://ws.kraken.com/v2');

ws.onopen = () => {
  ws.send(JSON.stringify({
    method: 'subscribe',
    params: {
      channel: 'book',
      symbol: ['BTC/USD'],
      depth: 10
    }
  }));
};
```

## Reconnection Logic

WebSocket connections drop. Always implement reconnection:

```javascript
class ReconnectingWebSocket {
  constructor(url, onMessage) {
    this.url = url;
    this.onMessage = onMessage;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = ({ data }) => this.onMessage(JSON.parse(data));
    this.ws.onclose = () => {
      console.log('Disconnected, reconnecting in 3s...');
      setTimeout(() => this.connect(), 3000);
    };
    this.ws.onerror = (err) => console.error('WS error:', err);
  }

  send(data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
```

## Ethereum WebSocket (Events)

```javascript
import { ethers } from 'ethers';

const provider = new ethers.WebSocketProvider(process.env.ETH_WSS_URL);

// New blocks
provider.on('block', blockNumber => console.log('Block:', blockNumber));

// ERC-20 transfers
const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
usdc.on('Transfer', (from, to, value, event) => {
  console.log(`${from} → ${to}: ${ethers.formatUnits(value, 6)} USDC`);
});
```

## Heartbeat / Ping-Pong

Most providers require a ping every 30–60 seconds to keep connections alive:

```javascript
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.ping();
}, 30000);
```
