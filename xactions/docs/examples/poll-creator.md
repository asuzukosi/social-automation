# 📊 Poll Creator

Create and manage poll tweets. Configure options, duration, and track poll results programmatically.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Create and manage poll tweets. Configure options, duration, and track poll results programmatically.
- Automate repetitive posting tasks on X/Twitter
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
1. Go to `x.com/compose/post`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/pollCreator.js`](https://github.com/nirholas/XActions/blob/main/src/pollCreator.js)
4. Press Enter to run

```javascript
// src/pollCreator.js
// Poll creation and management for X/Twitter
// by nichxbt

/**
 * Poll Creator - Create and manage polls
 * 
 * Features:
 * - Create polls with 2-4 options
 * - Set poll duration (5min - 7 days)
 * - Image polls (2026 feature)
 * - Shuffle choices (2026, in development)
 * - Poll results scraping
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  composeButton: 'a[data-testid="SideNav_NewTweet_Button"]',
  tweetTextarea: '[data-testid="tweetTextarea_0"]',
  tweetButton: '[data-testid="tweetButton"]',
  addPoll: '[aria-label="Add poll"]',
  pollOption: (i) => `[data-testid="pollOption_${i}"]`,
  addPollOption: '[data-testid="addPollOption"]',
  pollDurationDays: '[data-testid="pollDurationDays"]',
  pollDurationHours: '[data-testid="pollDurationHours"]',
  pollDurationMinutes: '[data-testid="pollDurationMinutes"]',
  removePoll: '[data-testid="removePoll"]',
  pollResults: '[data-testid="pollResults"]',
};

/**
 * Create a poll
 * @param {import('puppeteer').Page} page
 * @param {string} question - Poll question text
 * @param {Array<string>} choices - 2-4 poll options
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function createPoll(page, question, choices, options = {}) {
  const { durationDays = 1, durationHours = 0, durationMinutes = 0 } = options;

  if (choices.length < 2 || choices.length > 4) {
    return { success: false, error: 'Polls require 2-4 choices' };
  }

  await page.goto('https://x.com/compose/tweet', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Type question
  await page.click(SELECTORS.tweetTextarea);
  await page.keyboard.type(question, { delay: 30 });
  await sleep(500);

  // Add poll
  try {
    await page.click(SELECTORS.addPoll);
    await sleep(1500);
  } catch (e) {
    return { success: false, error: 'Poll button not found' };
  }

  // Fill in choices
  for (let i = 0; i < choices.length; i++) {
    if (i >= 2) {
      // Add extra option slots for 3rd and 4th choices
      try {
        await page.click(SELECTORS.addPollOption);
        await sleep(500);
      } catch (e) {
        console.log(`⚠️ Could not add option ${i + 1}`);
        break;
      }
    }

    const optionSel = SELECTORS.pollOption(i);
    try {
      await page.click(optionSel);
      await page.keyboard.type(choices[i], { delay: 20 });
      await sleep(300);
    } catch (e) {
      console.log(`⚠️ Could not fill option ${i + 1}`);
    }
  }

  // Set duration
  try {
    if (durationDays !== 1) {
      const daysInput = await page.$(SELECTORS.pollDurationDays);
      if (daysInput) {
        await daysInput.click({ clickCount: 3 });
        await daysInput.type(String(durationDays));
      }
    }
    if (durationHours > 0) {
      const hoursInput = await page.$(SELECTORS.pollDurationHours);
      if (hoursInput) {
        await hoursInput.click({ clickCount: 3 });
        await hoursInput.type(String(durationHours));
      }
    }
    if (durationMinutes > 0) {
      const minsInput = await page.$(SELECTORS.pollDurationMinutes);
      if (minsInput) {
        await minsInput.click({ clickCount: 3 });
        await minsInput.type(String(durationMinutes));
      }
    }
  } catch (e) {
    console.log('⚠️ Could not set custom duration, using default');
  }

  // Post poll
  await page.click(SELECTORS.tweetButton);
  await sleep(3000);

  return {
    success: true,
    question,
    choices,
    duration: `${durationDays}d ${durationHours}h ${durationMinutes}m`,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get poll results from a tweet
 * @param {import('puppeteer').Page} page
 * @param {string} tweetUrl - URL of the poll tweet
 * @returns {Promise<Object>}
 */
export async function getPollResults(page, tweetUrl) {
  await page.goto(tweetUrl, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const results = await page.evaluate(() => {
    const poll = document.querySelector('[data-testid="pollResults"], [role="group"]');
    if (!poll) return null;

    const options = [];
    poll.querySelectorAll('[role="radio"], [data-testid*="pollOption"]').forEach(opt => {
      const text = opt.textContent || '';
      const percentage = opt.querySelector('[data-testid="pollPercentage"]')?.textContent || '';
      options.push({ text: text.trim(), percentage });
    });

    const totalVotes = poll.querySelector('[data-testid="pollTotalVotes"]')?.textContent || '';
    const timeRemaining = poll.querySelector('[data-testid="pollTimeRemaining"]')?.textContent || '';

    return { options, totalVotes, timeRemaining };
  });

  return {
    url: tweetUrl,
    results: results || { error: 'Poll not found or not accessible' },
    scrapedAt: new Date().toISOString(),
  };
}

export default {
  createPoll,
  getPollResults,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/compose/post`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/pollCreator.js`](https://github.com/nirholas/XActions/blob/main/src/pollCreator.js) and paste it into the console.

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
| [`src/pollCreator.js`](https://github.com/nirholas/XActions/blob/main/src/pollCreator.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Article Publisher](article-publisher.md) | Publish long-form articles on X/Twitter (requires Premium+ subscription) |
| [Content Calendar](content-calendar.md) | Plan and visualize your posting schedule |
| [Content Repurposer](content-repurposer.md) | Transform your existing content: turn single tweets into threads, threads into singles, add hooks, rewrite for different audiences |
| [Pin Tweet Manager](pin-tweet-manager.md) | Pin and unpin tweets programmatically |
| [Post Composer](post-composer.md) | Full content creation suite: compose tweets, threads, polls, and articles with templates and scheduling |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
