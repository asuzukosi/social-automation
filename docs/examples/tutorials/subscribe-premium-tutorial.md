---
title: "Subscribe to X Premium — Tutorial"
description: "Compare X Premium tiers, check your subscription status, and navigate to the signup flow using XActions."
keywords: ["x premium subscription", "twitter premium tiers", "x premium signup script", "twitter blue subscribe", "xactions premium"]
canonical: "https://xactions.app/examples/subscribe-premium"
author: "nich (@nichxbt)"
date: "2026-03-30"
---

# Subscribe to X Premium — Tutorial

> Step-by-step guide to comparing X Premium tiers, checking your current status, and navigating through the subscription flow using XActions.

**Works on:** Browser Console
**Difficulty:** Beginner
**Time:** 2-5 minutes
**Requirements:** Logged into x.com in your browser

---

## Prerequisites

- Logged into x.com in your browser
- Browser DevTools console (F12 or Cmd+Option+J on Mac)
- A payment method for subscribing

---

## Quick Start

1. Go to any page on x.com
2. Open DevTools Console (F12, then click the **Console** tab)
3. Paste the script below to check status, compare tiers, and navigate to signup
4. Review the tier comparison in the console
5. Follow the on-screen prompts to complete your subscription

---

## Configuration

```javascript
const CONFIG = {
  autoNavigate: true,          // Navigate to Premium signup page automatically
  showTierComparison: true,    // Display tier comparison table in console
  checkCurrentStatus: true,    // Check if you already have Premium
  delayBetweenActions: 2000,   // ms between navigation steps
};
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoNavigate` | boolean | `true` | Auto-navigate to the Premium signup page |
| `showTierComparison` | boolean | `true` | Print tier comparison to console |
| `checkCurrentStatus` | boolean | `true` | Check if you already have Premium |
| `delayBetweenActions` | number | `2000` | Delay between UI actions in ms |

---

## Step-by-Step Guide

### Step 1: Check Your Current Status and Compare Tiers

```javascript
(() => {
  'use strict';

  console.log('💎 X PREMIUM — XActions by nichxbt');
  console.log('');

  // Check current status
  const verifiedBadge = document.querySelector('[data-testid="icon-verified"]');
  const premiumLinks = document.querySelectorAll('a[href="/i/premium_sign_up"]');

  if (verifiedBadge) {
    console.log('✅ You appear to have a verified badge (Premium active).');
    console.log('💡 Manage your subscription: x.com/settings/manage_subscription');
  } else {
    console.log('⚠️ No verified badge detected — you may not have Premium.');
  }

  // Tier comparison
  console.log('\n══════════════════════════════════════════════════');
  console.log('💎 X PREMIUM TIER COMPARISON');
  console.log('══════════════════════════════════════════════════\n');

  const tiers = {
    'Basic — $3/mo': [
      'Small blue checkmark',
      'Edit posts (5 per post, within 30 min)',
      'Longer posts (up to 10,000 characters)',
      'Longer video uploads (up to 2 hours)',
      'Bookmark folders',
      'Fewer ads in For You and Following',
    ],
    'Premium — $8/mo': [
      'Everything in Basic',
      'Blue checkmark',
      'Prioritized rankings in replies & search',
      'Half the ads',
      'Creator Subscriptions',
      'Grok AI assistant',
      'Media Studio access',
      'Analytics dashboard',
    ],
    'Premium+ — $16/mo': [
      'Everything in Premium',
      'Largest blue checkmark boost',
      'No ads',
      'Largest reply boost',
      'Write Articles',
      'Revenue sharing eligible',
      'X Pro (TweetDeck) access',
      'Highest priority support',
    ],
  };

  for (const [tier, features] of Object.entries(tiers)) {
    console.log(`\n🏷️  ${tier}`);
    console.log('─'.repeat(40));
    features.forEach(f => console.log(`   ✓ ${f}`));
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('💡 Annual billing saves ~12% on all tiers.');
  console.log('💡 Subscribe at: x.com/i/premium_sign_up');
})();
```

### Step 2: Navigate to the Signup Page

```javascript
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  console.log('🚀 Navigating to Premium signup page...');

  const premiumLink = document.querySelector('a[href="/i/premium_sign_up"]')
    || document.querySelector('nav a[href="/i/premium_sign_up"]');

  if (premiumLink) {
    premiumLink.click();
    console.log('✅ Clicked Premium signup link.');
    await sleep(2000);
  } else {
    console.log('⚠️ No Premium link in sidebar. Navigating directly...');
    window.location.href = 'https://x.com/i/premium_sign_up';
    await sleep(4000);
  }

  // Check for tier options on the page
  const tierElements = document.querySelectorAll('[data-testid="premiumTier"]');
  if (tierElements.length > 0) {
    console.log(`✅ Found ${tierElements.length} tier option(s) on the page.`);
  } else {
    console.log('ℹ️ Tier elements loading... Follow the on-screen prompts.');
  }

  console.log('\n✅ Follow the on-screen prompts to complete your subscription.');
})();
```

### Full Script (All-in-One)

Run the complete `src/subscribePremium.js` script for the full experience including status check, tier comparison, and auto-navigation:

```javascript
// Copy the full contents of src/subscribePremium.js and paste into console
// The script will:
// 1. Check if you already have Premium
// 2. Display a tier comparison table
// 3. Navigate to the signup page
```

### Expected Console Output

```
═══════════════════════════════════════════
💎 XActions — Subscribe to X Premium
═══════════════════════════════════════════

🔍 Checking current Premium status...
⚠️ No verified badge detected — you may not have Premium.
💡 Premium signup link found in sidebar — subscription may not be active.

══════════════════════════════════════════════════
💎 X PREMIUM TIER COMPARISON
══════════════════════════════════════════════════

🏷️  Basic — $3/mo
────────────────────────────────────────
   ✓ Small blue checkmark
   ✓ Edit posts (5 per post, within 30 min)
   ✓ Longer posts (up to 10,000 characters)
   ✓ Longer video uploads (up to 2 hours)
   ✓ Bookmark folders
   ✓ Fewer ads in For You and Following

🏷️  Premium — $8/mo
────────────────────────────────────────
   ✓ Everything in Basic
   ✓ Blue checkmark
   ✓ Prioritized rankings in replies & search
   ✓ Half the ads
   ✓ Creator Subscriptions
   ✓ Grok AI assistant
   ✓ Media Studio access
   ✓ Analytics dashboard

🏷️  Premium+ — $16/mo
────────────────────────────────────────
   ✓ Everything in Premium
   ✓ Largest blue checkmark boost
   ✓ No ads
   ✓ Largest reply boost
   ✓ Write Articles
   ✓ Revenue sharing eligible
   ✓ X Pro (TweetDeck) access
   ✓ Highest priority support

══════════════════════════════════════════════════
💡 Annual billing saves ~12% on all tiers.

🚀 Navigating to Premium signup page...
✅ Clicked Premium signup link.

✅ Done! Follow the on-screen prompts to complete your subscription.
```

---

## Tips & Tricks

1. **Annual billing saves money** -- All tiers offer annual billing at approximately 12% discount compared to monthly.

2. **Check before subscribing** -- The script checks for an existing verified badge so you do not accidentally double-subscribe.

3. **Manage existing subscription** -- If you already have Premium, manage it at `x.com/settings/manage_subscription`.

4. **Regional pricing** -- Prices may vary by country. The signup page will show your local pricing.

5. **Trial periods** -- X occasionally offers free trial periods for new subscribers. Check the signup page for current promotions.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No Premium link in sidebar" | The link may not be visible if you already have Premium. Check `x.com/settings/manage_subscription`. |
| Signup page not loading | Try navigating directly to `x.com/i/premium_sign_up`. Clear browser cache if needed. |
| Payment fails | Ensure your payment method is valid. Try a different card or payment method. |
| Already subscribed but no badge | Verification can take up to 24 hours after subscribing. Check `x.com/settings/verification`. |

---

## Related Scripts

| Feature | Script | Description |
|---------|--------|-------------|
| Blue Checkmark & Fewer Ads | `src/premiumManager.js` | Manage Premium features and check tier |
| Premium Gifting | `src/premiumGifting.js` | Gift Premium to another user |
| ID Verification | `src/idVerification.js` | Complete identity verification |
| Creator Revenue | `src/creatorSubscriptions.js` | Set up revenue sharing |

---

<footer>
Built with XActions by <a href="https://x.com/nichxbt">@nichxbt</a> · <a href="https://xactions.app">xactions.app</a> · <a href="https://github.com/nichxbt/xactions">GitHub</a>
</footer>
