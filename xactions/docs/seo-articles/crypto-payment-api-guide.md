---
title: "Crypto Payment APIs: Accept Cryptocurrency in Your App (2026)"
meta_description: "Compare the top crypto payment APIs — Coinbase Commerce, NOWPayments, BitPay, and x402. Learn to accept Bitcoin, ETH, USDC, and other crypto payments."
keywords: "crypto payment API, accept Bitcoin API, USDC payment API, cryptocurrency checkout API, x402 payment protocol"
---

# Crypto Payment APIs: Accept Cryptocurrency in Your App (2026)

Crypto payment APIs let your application accept Bitcoin, Ethereum, USDC, and other currencies without managing wallets manually. This guide covers the top providers and the emerging x402 standard.

## Top Crypto Payment Providers

| Provider | Supported Coins | Settlement | Fiat Conversion |
|---|---|---|---|
| Coinbase Commerce | BTC, ETH, USDC, SOL, DOGE, LTC | Crypto or USD | Yes |
| NOWPayments | 300+ coins | Crypto or fiat | Yes |
| BitPay | BTC, ETH, XRP, stablecoins | Crypto or USD | Yes |
| Stripe Crypto | USDC (Ethereum/Solana) | USD | Auto |
| x402 | USDC (Base, ETH, Solana) | Crypto | No |

## Coinbase Commerce

```javascript
// Create a charge
const res = await fetch('https://api.commerce.coinbase.com/charges', {
  method: 'POST',
  headers: {
    'X-CC-Api-Key': process.env.COINBASE_COMMERCE_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Product Purchase',
    description: 'Order #1234',
    pricing_type: 'fixed_price',
    local_price: { amount: '49.99', currency: 'USD' },
    metadata: { order_id: '1234', customer_id: 'user_789' },
    redirect_url: 'https://yourapp.com/success',
    cancel_url: 'https://yourapp.com/cancel'
  })
});
const { data } = await res.json();
// Redirect user to data.hosted_url
console.log('Payment URL:', data.hosted_url);
```

## Webhooks (Coinbase Commerce)

```javascript
import crypto from 'crypto';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-cc-webhook-signature'];
  const computed = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest('hex');

  if (sig !== computed) return res.status(400).send('Invalid signature');

  const { event } = JSON.parse(req.body);
  if (event.type === 'charge:confirmed') {
    console.log('Payment confirmed:', event.data.metadata.order_id);
    // Fulfill order
  }
  res.json({ received: true });
});
```

## NOWPayments

```javascript
// Create payment
const res = await fetch('https://api.nowpayments.io/v1/payment', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.NOWPAYMENTS_API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    price_amount: 49.99,
    price_currency: 'usd',
    pay_currency: 'btc',
    order_id: '1234',
    order_description: 'Product purchase'
  })
});
const payment = await res.json();
// Send user to payment.pay_address to pay payment.pay_amount BTC
```

## x402: HTTP-Native Crypto Payments

x402 is an emerging standard where any HTTP endpoint can require payment natively. The flow:

1. Client requests resource → server returns `402 Payment Required` with payment details
2. Client pays in USDC → includes `X-Payment` header in retry
3. Server verifies payment → returns resource

```javascript
// Client-side x402 fetch
import { fetchWithPayment } from 'x402-fetch';

const res = await fetchWithPayment('https://api.example.com/premium-data', {
  wallet: signer // ethers.js signer
});
const data = await res.json();
```

```javascript
// Server-side x402 middleware (Express)
import { paymentMiddleware } from 'x402-express';

app.use('/premium', paymentMiddleware({
  amount: 0.01, // $0.01 USDC
  token: 'USDC',
  chain: 'base',
  payTo: process.env.WALLET_ADDRESS
}));
```

## Best Practices

- Always verify payments server-side via webhook, never trust client-reported status
- Use idempotency keys to prevent double-fulfillment
- Store transaction hashes for audit trails
- Monitor for underpayments — crypto amounts can vary with gas fees
- For fiat merchants, use auto-conversion to avoid crypto volatility exposure
