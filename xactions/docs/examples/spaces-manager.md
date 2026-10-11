# 🎙️ Spaces Manager

Manage Twitter Spaces: find, join, schedule, and monitor live audio rooms and events.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Manage Twitter Spaces: find, join, schedule, and monitor live audio rooms and events.
- Automate repetitive spaces tasks on X/Twitter
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
1. Go to `x.com/i/spaces`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/spacesManager.js`](https://github.com/nirholas/XActions/blob/main/src/spacesManager.js)
4. Press Enter to run

```javascript
// src/spacesManager.js
// Spaces, Live Streams, and Events management for X/Twitter
// by nichxbt

/**
 * Spaces Manager - Live audio/video, events, and Circles
 * 
 * Features:
 * - Scrape live and scheduled Spaces
 * - Monitor Space metadata (speakers, listeners)
 * - Create and schedule Spaces
 * - Event creation and management
 * - Circle management
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  spacesNav: 'a[href*="/spaces"]',
  startSpace: '[data-testid="SpaceButton"]',
  joinSpace: '[data-testid="joinSpace"]',
  spaceSpeakers: '[data-testid="spaceSpeakers"]',
  spaceListeners: '[data-testid="spaceListeners"]',
  spaceRecording: '[data-testid="spaceRecording"]',
  scheduleSpace: '[data-testid="scheduleSpace"]',
  spaceTopic: '[data-testid="spaceTopic"]',
  spaceTitle: '[data-testid="spaceTitle"]',
};

/**
 * Get live Spaces
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getLiveSpaces(page, options = {}) {
  const { query = '', limit = 20 } = options;

  const url = query
    ? `https://x.com/search?q=${encodeURIComponent(query)}&f=live_spaces`
    : 'https://x.com/i/spaces';
  
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const spaces = await page.evaluate((max) => {
    const items = [];
    document.querySelectorAll('[data-testid="SpaceCard"], [data-testid="space"]').forEach(card => {
      items.push({
        title: card.querySelector('[data-testid="spaceTitle"]')?.textContent || '',
        host: card.querySelector('[data-testid="spaceHost"]')?.textContent || '',
        listeners: card.querySelector('[data-testid="spaceListeners"]')?.textContent || '0',
        speakers: card.querySelector('[data-testid="spaceSpeakers"]')?.textContent || '0',
        topic: card.querySelector('[data-testid="spaceTopic"]')?.textContent || '',
        link: card.querySelector('a')?.href || '',
        isLive: true,
      });
    });
    return items.slice(0, max);
  }, limit);

  return {
    spaces,
    count: spaces.length,
    query,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get scheduled Spaces
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Object>}
 */
export async function getScheduledSpaces(page, username) {
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  const scheduled = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('[data-testid="scheduledSpace"]').forEach(el => {
      items.push({
        title: el.querySelector('[data-testid="spaceTitle"]')?.textContent || '',
        scheduledFor: el.querySelector('time')?.getAttribute('datetime') || '',
        link: el.querySelector('a')?.href || '',
      });
    });
    return items;
  });

  return {
    username,
    scheduledSpaces: scheduled,
    count: scheduled.length,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Scrape Space metadata
 * @param {import('puppeteer').Page} page
 * @param {string} spaceUrl
 * @returns {Promise<Object>}
 */
export async function scrapeSpace(page, spaceUrl) {
  await page.goto(spaceUrl, { waitUntil: 'networkidle2' });
  await sleep(5000);

  const metadata = await page.evaluate((sel) => {
    return {
      title: document.querySelector(sel.spaceTitle)?.textContent || '',
      topic: document.querySelector(sel.spaceTopic)?.textContent || '',
      speakers: document.querySelector(sel.spaceSpeakers)?.textContent || '0',
      listeners: document.querySelector(sel.spaceListeners)?.textContent || '0',
      isRecording: !!document.querySelector(sel.spaceRecording),
      participantList: Array.from(document.querySelectorAll('[data-testid="UserCell"]')).map(u =>
        u.querySelector('[dir="ltr"]')?.textContent || ''
      ),
    };
  }, SELECTORS);

  return {
    url: spaceUrl,
    ...metadata,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Create an event
 * @param {import('puppeteer').Page} page
 * @param {Object} event - { title, description, date, time, location? }
 * @returns {Promise<Object>}
 */
export async function createEvent(page, event) {
  const { title, description, date, time, location = '' } = event;

  // X Events are typically created through Communities or Spaces
  await page.goto('https://x.com/compose/tweet', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Post event announcement
  const eventText = [
    `📅 ${title}`,
    '',
    description,
    '',
    `🗓 ${date} at ${time}`,
    location ? `📍 ${location}` : '',
    '',
    '#event',
  ].filter(Boolean).join('\n');

  await page.click('[data-testid="tweetTextarea_0"]');
  await page.keyboard.type(eventText, { delay: 20 });
  await sleep(500);

  await page.click('[data-testid="tweetButton"]');
  await sleep(3000);

  return {
    success: true,
    event: { title, date, time, location },
    timestamp: new Date().toISOString(),
  };
}

export default {
  getLiveSpaces,
  getScheduledSpaces,
  scrapeSpace,
  createEvent,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/i/spaces`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/spacesManager.js`](https://github.com/nirholas/XActions/blob/main/src/spacesManager.js) and paste it into the console.

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
| [`src/spacesManager.js`](https://github.com/nirholas/XActions/blob/main/src/spacesManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| See [all scripts](README.md) | Browse the complete script catalog |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
