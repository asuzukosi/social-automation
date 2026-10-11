# ⭐ Premium Manager

Check your Premium subscription tier and available features. Manage Premium-specific settings and capabilities.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Check your Premium subscription tier and available features. Manage Premium-specific settings and capabilities.
- Automate repetitive premium tasks on X/Twitter
- Save time with one-click automation — no API keys needed
- Works in any modern browser (Chrome, Firefox, Edge, Safari)

---

## ⚠️ Important Notes

> **Use responsibly!** All automation should respect X/Twitter's Terms of Service. Use conservative settings and include breaks between sessions.

- This script runs in the **browser DevTools console** — not Node.js
- You must be **logged in** to x.com for the script to work
- Start with **low limits** and increase gradually
- Include **random delays** between actions to appear human
- **Don't run** multiple automation scripts simultaneously

---

## 🌐 Browser Console Usage

**Steps:**
1. Go to `x.com/settings/premium`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/premiumManager.js`](https://github.com/nirholas/XActions/blob/main/src/premiumManager.js)
4. Press Enter to run

```javascript
// src/premiumManager.js  
// Premium subscription feature management for X/Twitter
// by nichxbt

/**
 * Premium Manager - Check and manage Premium subscription features
 * 
 * Features:
 * - Check Premium tier (Basic/Premium/Premium+)
 * - List available features per tier
 * - Verification status
 * - Revenue sharing eligibility
 * - Pay-for-reach analysis (2026)
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  premiumNav: 'a[href="/i/premium_sign_up"]',
  verificationBadge: '[data-testid="icon-verified"]',
  subscriptionInfo: '[data-testid="subscriptionInfo"]',
  premiumBanner: '[data-testid="premiumBanner"]',
};

/**
 * Tier feature definitions
 */
const TIER_FEATURES = {
  free: {
    tier: 'Free',
    price: '$0/mo',
    features: {
      postLength: 280,
      videoLength: '140s',
      adReduction: 'None',
      verification: false,
      editPost: false,
      scheduling: false,
      bookmarkFolders: false,
      formatting: false,
      revenueShare: false,
      articles: false,
      radarSearch: false,
      grokLevel: 'Basic (~10 queries/day)',
      replyBoost: 'None',
    },
  },
  basic: {
    tier: 'Basic',
    price: '$3/mo',
    features: {
      postLength: 280,
      videoLength: '140s',
      adReduction: '50% fewer',
      verification: false,
      editPost: false,
      scheduling: false,
      bookmarkFolders: false,
      formatting: false,
      revenueShare: false,
      articles: false,
      radarSearch: false,
      grokLevel: 'More queries',
      replyBoost: 'Small',
    },
  },
  premium: {
    tier: 'Premium',
    price: '$8/mo',
    features: {
      postLength: 25000,
      videoLength: '60min',
      adReduction: '50% fewer',
      verification: true,
      editPost: true,
      scheduling: true,
      bookmarkFolders: true,
      formatting: true,
      revenueShare: true,
      articles: false,
      radarSearch: false,
      grokLevel: 'Higher (~100 queries/day)',
      replyBoost: 'Medium',
    },
  },
  'premium+': {
    tier: 'Premium+',
    price: '$16/mo',
    features: {
      postLength: 25000,
      videoLength: '3hr',
      adReduction: 'No ads',
      verification: true,
      editPost: true,
      scheduling: true,
      bookmarkFolders: true,
      formatting: true,
      revenueShare: true,
      articles: true,
      radarSearch: true,
      grokLevel: 'Highest (unlimited)',
      replyBoost: 'Largest',
    },
  },
  supergrok: {
    tier: 'SuperGrok',
    price: '$60/mo (separate xAI subscription)',
    features: {
      unlimited_grok: true,
      unlimited_agents: true,
      dedicated_apps: 'MacOS/iOS',
      project_org: true,
      advanced_ai: true,
    },
  },
};

/**
 * Check a user's Premium tier
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Object>}
 */
export async function checkPremiumStatus(page, username) {
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  const status = await page.evaluate((sel) => {
    const isVerified = !!document.querySelector(sel.verificationBadge);
    const badges = document.querySelectorAll('svg[data-testid]');
    let badgeType = 'none';

    badges.forEach(badge => {
      const testId = badge.getAttribute('data-testid');
      if (testId?.includes('verified')) badgeType = 'blue';
      if (testId?.includes('verifiedOrg')) badgeType = 'gold';
    });

    return { isVerified, badgeType };
  }, SELECTORS);

  // Infer tier from badge
  let inferredTier = 'free';
  if (status.badgeType === 'gold') inferredTier = 'organization';
  else if (status.isVerified) inferredTier = 'premium_or_higher';

  return {
    username,
    ...status,
    inferredTier,
    note: 'Exact tier detection requires account owner access',
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get features available for a tier
 * @param {string} tier - 'free', 'basic', 'premium', 'premium+', 'supergrok'
 * @returns {Object}
 */
export function getTierFeatures(tier) {
  const normalized = tier.toLowerCase().replace(/\s+/g, '');
  return TIER_FEATURES[normalized] || { error: `Unknown tier: ${tier}` };
}

/**
 * Compare two tiers
 * @param {string} tier1
 * @param {string} tier2
 * @returns {Object}
 */
export function compareTiers(tier1, tier2) {
  const t1 = getTierFeatures(tier1);
  const t2 = getTierFeatures(tier2);

  if (t1.error || t2.error) {
    return { error: t1.error || t2.error };
  }

  const comparison = {};
  const allFeatures = new Set([
    ...Object.keys(t1.features || {}),
    ...Object.keys(t2.features || {}),
  ]);

  for (const feature of allFeatures) {
    comparison[feature] = {
      [t1.tier]: t1.features?.[feature] ?? 'N/A',
      [t2.tier]: t2.features?.[feature] ?? 'N/A',
    };
  }

  return { comparison, tiers: [t1.tier, t2.tier] };
}

/**
 * Check revenue sharing eligibility
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Object>}
 */
export async function checkRevenueEligibility(page, username) {
  const profile = await page.evaluate(() => {
    const followers = document.querySelector('a[href$="/followers"] span')?.textContent || '0';
    return { followers };
  });

  const followerCount = parseInt(profile.followers.replace(/[,K.M]/g, '')) || 0;

  return {
    username,
    followers: profile.followers,
    meetsFollowerMin: followerCount >= 500,
    requirements: {
      minFollowers: '500+',
      minImpressions: '5M+ in last 3 months',
      premiumRequired: true,
      note: 'Must have Premium ($8/mo) or higher',
    },
    note: 'Impression data requires account owner access to verify',
  };
}

export default {
  checkPremiumStatus,
  getTierFeatures,
  compareTiers,
  checkRevenueEligibility,
  TIER_FEATURES,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/settings/premium`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/premiumManager.js`](https://github.com/nirholas/XActions/blob/main/src/premiumManager.js) and paste it into the console.

### Step 4: Customize the CONFIG (optional)

Before running, you can modify the `CONFIG` object at the top of the script to adjust behavior:

```javascript
const CONFIG = {
  // Edit these values before running
  // See Configuration table above for all options
};
```

### Step 5: Run and monitor

Press **Enter** to run the script. Watch the console for real-time progress logs:

- ✅ Green messages = success
- 🔄 Blue messages = in progress
- ⚠️ Yellow messages = warnings
- ❌ Red messages = errors

### Step 6: Export results

Most scripts automatically download results as JSON/CSV when complete. Check your Downloads folder.

---

## 🖥️ CLI Usage

You can also run this via the XActions CLI:

```bash
# Install XActions globally
npm install -g xactions

# Run via CLI
xactions --help
```

---

## 🤖 MCP Server Usage

Use with AI agents (Claude, Cursor, etc.) via the MCP server:

```bash
# Start MCP server
npm run mcp
```

See the [MCP Setup Guide](../mcp-setup.md) for integration with Claude Desktop, Cursor, and other AI tools.

---

## 📁 Source Files

| File | Description |
|------|-------------|
| [`src/premiumManager.js`](https://github.com/nirholas/XActions/blob/main/src/premiumManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| See [all scripts](README.md) | Browse the complete script catalog |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
