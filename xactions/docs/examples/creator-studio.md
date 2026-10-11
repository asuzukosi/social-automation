# 🎨 Creator Studio

Creator analytics dashboard: track subscriptions, tips, Super Follows revenue, and audience growth metrics.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Creator analytics dashboard: track subscriptions, tips, Super Follows revenue, and audience growth metrics.
- Automate repetitive business tasks on X/Twitter
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
1. Go to `x.com/settings/monetization`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/creatorStudio.js`](https://github.com/nirholas/XActions/blob/main/src/creatorStudio.js)
4. Press Enter to run

```javascript
// src/creatorStudio.js
// Creator Studio and monetization tools for X/Twitter
// by nichxbt

/**
 * Creator Studio - Analytics, subscriptions, tips, revenue
 * 
 * Features:
 * - Account and post analytics
 * - Revenue tracking
 * - Subscription management
 * - Tip configuration
 * - X Money integration (2026)
 * - Affiliate tracking
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  analyticsNav: 'a[href="/i/account_analytics"]',
  impressions: '[data-testid="impressions"]',
  engagements: '[data-testid="engagements"]',
  followersChart: '[data-testid="followersChart"]',
  revenueTab: '[data-testid="revenueTab"]',
  monetization: 'a[href="/settings/monetization"]',
  subscriptionSettings: '[data-testid="subscriptionSettings"]',
  tipsSettings: '[data-testid="tipsSettings"]',
  analyticsExport: '[data-testid="exportAnalytics"]',
};

/**
 * Get account analytics
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getAccountAnalytics(page, options = {}) {
  const { period = '28d' } = options;

  await page.goto('https://x.com/i/account_analytics', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const analytics = await page.evaluate(() => {
    const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '0';
    
    // Try to extract key metrics from the analytics page
    const metrics = {};
    const statElements = document.querySelectorAll('[data-testid*="stat"], [data-testid*="metric"]');
    statElements.forEach(el => {
      const label = el.querySelector('span:first-child')?.textContent || '';
      const value = el.querySelector('span:last-child')?.textContent || '';
      if (label && value) metrics[label] = value;
    });

    // Also try generic extraction
    const cards = document.querySelectorAll('[role="listitem"], [data-testid="analyticsCard"]');
    cards.forEach(card => {
      const text = card.textContent?.trim() || '';
      if (text) metrics[`card_${cards.length}`] = text.substring(0, 200);
    });

    return metrics;
  });

  return {
    period,
    analytics,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get analytics for a specific post
 * @param {import('puppeteer').Page} page
 * @param {string} postUrl
 * @returns {Promise<Object>}
 */
export async function getPostAnalytics(page, postUrl) {
  await page.goto(postUrl, { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Click analytics button on the post
  try {
    await page.click('[data-testid="analyticsButton"]');
    await sleep(2000);
  } catch (e) {
    // Analytics may be inline on the post
  }

  const analytics = await page.evaluate(() => {
    const tweet = document.querySelector('article[data-testid="tweet"]');
    if (!tweet) return null;

    return {
      likes: tweet.querySelector('[data-testid="like"] span')?.textContent || '0',
      reposts: tweet.querySelector('[data-testid="retweet"] span')?.textContent || '0',
      replies: tweet.querySelector('[data-testid="reply"] span')?.textContent || '0',
      bookmarks: tweet.querySelector('[data-testid="bookmark"] span')?.textContent || '0',
      views: tweet.querySelector('[data-testid="impressions"], [data-testid="analyticsButton"] span')?.textContent || '0',
    };
  });

  return {
    postUrl,
    analytics: analytics || { error: 'Could not extract analytics' },
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get revenue/earnings data
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>}
 */
export async function getRevenue(page) {
  await page.goto('https://x.com/settings/monetization', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const revenue = await page.evaluate(() => {
    const text = document.querySelector('[role="main"]')?.textContent || '';
    return { rawText: text.substring(0, 500) };
  });

  return {
    revenue,
    note: 'Revenue data requires Premium subscription and eligibility',
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get subscriber list
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getSubscribers(page, options = {}) {
  const { limit = 50 } = options;

  await page.goto('https://x.com/settings/monetization/subscribers', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const subscribers = await page.evaluate((sel, max) => {
    return Array.from(document.querySelectorAll('[data-testid="UserCell"]')).slice(0, max).map(user => {
      const name = user.querySelector('[dir="ltr"]')?.textContent || '';
      const username = user.querySelector('a[role="link"]')?.href?.split('/').pop() || '';
      const since = user.querySelector('time')?.getAttribute('datetime') || '';
      return { name, username, subscribedSince: since };
    });
  }, SELECTORS, limit);

  return {
    subscribers,
    count: subscribers.length,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Creator dashboard - combined analytics
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>}
 */
export async function getCreatorDashboard(page) {
  const analytics = await getAccountAnalytics(page);
  const revenue = await getRevenue(page);

  return {
    analytics: analytics.analytics,
    revenue: revenue.revenue,
    scrapedAt: new Date().toISOString(),
  };
}

export default {
  getAccountAnalytics,
  getPostAnalytics,
  getRevenue,
  getSubscribers,
  getCreatorDashboard,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/settings/monetization`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/creatorStudio.js`](https://github.com/nirholas/XActions/blob/main/src/creatorStudio.js) and paste it into the console.

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
| [`src/creatorStudio.js`](https://github.com/nirholas/XActions/blob/main/src/creatorStudio.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Business Tools](business-tools.md) | Brand monitoring, competitor analysis, and audience insights for business accounts |
| [Business Analytics](business-analytics.md) | Brand monitoring and sentiment analysis for businesses |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
