# Archived Code

> **This page describes January 2026, and the "no payments" claim below is no longer
> true.** It is kept as a record of what was removed then, not as a description of the
> project today. What changed since:
>
> - The **credit system** archived here (buy credits, spend them per operation, claim a
>   follow bonus) is genuinely gone and is not coming back.
> - A **hosted API** was added later, with Stripe subscription tiers
>   (`api/routes/billing.js`, `api/config/subscription-tiers.js`: Free, Pro at $19,
>   Business at $49, Enterprise) and x402 pay-per-request for agents. `webhooks.js` and
>   `subscription-tiers.js` are live files again, and the copies in this directory are
>   older forks of them, not the current code.
> - **Everything you run yourself is still free and unmetered**: the CLI, the Node
>   library, the MCP server, the browser scripts and the extension need no account, no
>   key and no payment. Nothing in this repository phones home. The paid surface only
>   exists for people who would rather call a hosted endpoint than run it themselves.
>
> Current pricing lives on [the pricing page](../dashboard/pricing.html); the live tier
> definitions are in `api/config/subscription-tiers.js`.

The following files were archived when XActions dropped its credit system on
January 25, 2026.

## Backend Payment Code (`archive/backend/`)

| File | Description | Original Location |
|------|-------------|-------------------|
| `payments.js` | Stripe payment routes for subscriptions and credit purchases | `api/routes/payments.js` |
| `crypto-payments.js` | Cryptocurrency payment routes (Coinbase Commerce, NOWPayments, BTCPay) | `api/routes/crypto-payments.js` |
| `webhooks.js` | Payment webhooks for Stripe and crypto providers | `api/routes/webhooks.js` |
| `subscription-tiers.js` | Subscription tier configuration, credit packages, and monetization rules | `api/config/subscription-tiers.js` |

## Dashboard Pages (`archive/dashboard/`)

| File | Description | Original Location |
|------|-------------|-------------------|
| `pricing.html` | Pricing page with credit packages and crypto payment options | `dashboard/pricing.html` |

## Why Archived?

The credit system was the wrong shape for this project: it metered things that cost
XActions nothing, because the work happens on the user's own machine with the user's
own session. What replaced it:

- No accounts required for browser scripts, the CLI, the library or the MCP server
- No credit system anywhere
- Unlimited local use, with the full source available

A hosted API with subscription tiers was added later for people who want someone else
to run it. That is a separate surface, and it does not gate anything you run yourself.

All features are accessible via:
1. **Browser Console Scripts** - Copy-paste automation (no setup needed)
2. **CLI Tools** - `npm install -g xactions` 
3. **Node.js Library** - `import { unfollowEveryone } from 'xactions'`
4. **MCP Server** - AI agent integration for Claude, GPT, etc.

## Modified Files

The following files were modified to remove payment functionality:

### `api/server.js`
- Removed payment route imports and registrations
- `/pricing` now redirects to `/docs`

### `api/middleware/auth.js`
- `checkCredits()` - Now always allows (no-op)
- `requireSubscription()` - Now always allows (no-op)
- Removed subscription tier validation

### `api/routes/user.js`
- Removed credit balance endpoints
- Removed subscription status endpoints
- Removed `claim-follow-bonus` endpoint

### `api/routes/operations.js`
- Removed `checkCredits` middleware from all routes
- Removed credit deduction logic
- Operations are now free and unlimited

### `api/realtime/socketHandler.js`
- Removed credit checking before operations
- Removed credit deduction on completion

### `dashboard/index.html`
- Removed credit display code from `loadDashboard()`
- Removed credit deduction in `updateProgress()`
- Removed `needCredits` error handling
- Removed `claimFollowBonus()` function
- Removed `.credits-highlight` CSS class
- Removed "This will cost 2 credits" confirmation text

## Restoration Guide

If payment features need to be restored:

1. Move archived files back to original locations
2. Restore imports in `api/server.js`:
   ```javascript
   import webhookRoutes from './routes/webhooks.js';
   import paymentsRoutes from './routes/payments.js';
   import cryptoPaymentsRoutes from './routes/crypto-payments.js';
   ```
3. Restore route registrations:
   ```javascript
   app.use('/api/webhooks', webhookRoutes);
   app.use('/api/payments', paymentsRoutes);
   app.use('/api/crypto', cryptoPaymentsRoutes);
   ```
4. Restore raw body parsing for webhooks:
   ```javascript
   app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));
   ```
5. Restore credit logic in `auth.js`, `operations.js`, and `socketHandler.js`
6. Configure environment variables:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `COINBASE_COMMERCE_API_KEY`
   - `NOWPAYMENTS_API_KEY`
   - etc.

---

*Archived by Agent 1 - January 25, 2026*
*XActions is now 100% free and open source*
