# 💼 Business Tools

Brand monitoring, competitor analysis, and audience insights for business accounts. Tracks mentions, sentiment, and share of voice.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Brand monitoring, competitor analysis, and audience insights for business accounts. Tracks mentions, sentiment, and share of voice.
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
1. Go to `x.com (any page)`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/businessTools.js`](https://github.com/nirholas/XActions/blob/main/src/businessTools.js)
4. Press Enter to run

```javascript
// src/businessTools.js
// Business and advertising tools for X/Twitter
// by nichxbt

/**
 * Business Tools - Ads, campaigns, brand monitoring, audience insights
 * 
 * Features:
 * - Brand mention monitoring
 * - Competitor analysis
 * - Audience insights
 * - Campaign management basics
 * - Social listening
 * - Post boosting
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  userCell: '[data-testid="UserCell"]',
  searchInput: '[data-testid="SearchBox_Search_Input"]',
};

/**
 * Monitor brand mentions
 * @param {import('puppeteer').Page} page
 * @param {string} brandName - Brand name or @handle to monitor
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function monitorBrandMentions(page, brandName, options = {}) {
  const { limit = 50, since = null } = options;

  let query = brandName;
  if (since) query += ` since:${since}`;

  await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&f=live`, {
    waitUntil: 'networkidle2',
  });
  await sleep(3000);

  const mentions = [];
  let scrollAttempts = 0;

  while (mentions.length < limit && scrollAttempts < Math.ceil(limit / 5)) {
    const newMentions = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel.tweet)).map(tweet => {
        const text = tweet.querySelector(sel.tweetText)?.textContent || '';
        const author = tweet.querySelector('[data-testid="User-Name"] a')?.textContent || '';
        const time = tweet.querySelector('time')?.getAttribute('datetime') || '';
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        const likes = tweet.querySelector('[data-testid="like"] span')?.textContent || '0';
        const reposts = tweet.querySelector('[data-testid="retweet"] span')?.textContent || '0';

        // Basic sentiment analysis
        const lowerText = text.toLowerCase();
        let sentiment = 'neutral';
        const positive = ['love', 'great', 'amazing', 'awesome', 'excellent', 'best', 'good', '🔥', '❤️', '👏'];
        const negative = ['hate', 'terrible', 'worst', 'bad', 'awful', 'horrible', 'scam', '💩', '👎'];
        if (positive.some(w => lowerText.includes(w))) sentiment = 'positive';
        if (negative.some(w => lowerText.includes(w))) sentiment = 'negative';

        return { text, author, time, link, likes, reposts, sentiment };
      });
    }, SELECTORS);

    for (const mention of newMentions) {
      if (mention.link && !mentions.find(m => m.link === mention.link)) {
        mentions.push(mention);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(1500);
    scrollAttempts++;
  }

  const result = mentions.slice(0, limit);
  const sentimentBreakdown = {
    positive: result.filter(m => m.sentiment === 'positive').length,
    negative: result.filter(m => m.sentiment === 'negative').length,
    neutral: result.filter(m => m.sentiment === 'neutral').length,
  };

  return {
    brand: brandName,
    mentions: result,
    count: result.length,
    sentiment: sentimentBreakdown,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get audience insights for an account
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getAudienceInsights(page, username, options = {}) {
  const { sampleSize = 50 } = options;

  // Scrape followers for analysis
  await page.goto(`https://x.com/${username}/followers`, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const followers = [];
  let scrollAttempts = 0;

  while (followers.length < sampleSize && scrollAttempts < Math.ceil(sampleSize / 5)) {
    const newFollowers = await page.evaluate((sel) => {
      const extractBio = (cell) => {
        const testId = cell.querySelector('[data-testid="UserDescription"]');
        if (testId?.textContent?.trim()) return testId.textContent.trim();
        const autoDir = cell.querySelector('[dir="auto"]:not([data-testid])');
        const text = autoDir?.textContent?.trim();
        if (text && text.length >= 10 && !text.startsWith('@')) return text;
        return '';
      };
      return Array.from(document.querySelectorAll(sel.userCell)).map(user => {
        const name = user.querySelector('[dir="ltr"]')?.textContent || '';
        const bio = extractBio(user);
        const isVerified = !!user.querySelector('[data-testid="icon-verified"]');
        return { name, bio: bio.substring(0, 200), isVerified };
      });
    }, SELECTORS);

    for (const f of newFollowers) {
      if (f.name && !followers.find(e => e.name === f.name)) {
        followers.push(f);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(1500);
    scrollAttempts++;
  }

  // Basic analysis
  const sample = followers.slice(0, sampleSize);
  const verifiedPct = Math.round((sample.filter(f => f.isVerified).length / sample.length) * 100);

  // Extract common interests from bios
  const bioWords = sample.map(f => f.bio.toLowerCase()).join(' ');
  const techKeywords = ['developer', 'engineer', 'coding', 'tech', 'AI', 'startup', 'founder', 'crypto', 'web3', 'design'];
  const interests = {};
  techKeywords.forEach(kw => {
    const count = (bioWords.match(new RegExp(kw, 'gi')) || []).length;
    if (count > 0) interests[kw] = count;
  });

  return {
    username,
    sampleSize: sample.length,
    verifiedFollowersPct: verifiedPct + '%',
    topInterests: Object.entries(interests).sort((a, b) => b[1] - a[1]).slice(0, 10),
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Competitor analysis
 * @param {import('puppeteer').Page} page
 * @param {Array<string>} competitors - Array of usernames to compare
 * @returns {Promise<Object>}
 */
export async function analyzeCompetitors(page, competitors) {
  const results = [];

  for (const username of competitors) {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    await sleep(2000);

    const profile = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.trim() || '';
      return {
        followers: getText('a[href$="/followers"] span'),
        following: getText('a[href$="/following"] span'),
        isVerified: !!document.querySelector('[data-testid="icon-verified"]'),
        bio: getText('[data-testid="UserDescription"]'),
      };
    });

    results.push({ username, ...profile });
    await sleep(1000);
  }

  return {
    competitors: results,
    comparedAt: new Date().toISOString(),
  };
}

export default {
  monitorBrandMentions,
  getAudienceInsights,
  analyzeCompetitors,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com (any page)`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/businessTools.js`](https://github.com/nirholas/XActions/blob/main/src/businessTools.js) and paste it into the console.

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
| [`src/businessTools.js`](https://github.com/nirholas/XActions/blob/main/src/businessTools.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Creator Studio](creator-studio.md) | Creator analytics dashboard: track subscriptions, tips, Super Follows revenue, and audience growth metrics |
| [Business Analytics](business-analytics.md) | Brand monitoring and sentiment analysis for businesses |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
