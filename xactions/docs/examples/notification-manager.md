# 🔔 Notification Manager

Scrape, filter, and manage your notifications. Export notification history and set up custom filters.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Scrape, filter, and manage your notifications. Export notification history and set up custom filters.
- Automate repetitive notifications tasks on X/Twitter
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
1. Go to `x.com/notifications`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/notificationManager.js`](https://github.com/nirholas/XActions/blob/main/src/notificationManager.js)
4. Press Enter to run

```javascript
// src/notificationManager.js
// Notification management for X/Twitter
// by nichxbt

/**
 * Notification Manager - Scrape, filter, and manage notifications
 * 
 * Features:
 * - Scrape notifications (likes, mentions, replies, follows)
 * - Filter by notification type
 * - Mute/unmute users and keywords
 * - Configure notification preferences
 * - Priority notifications (2026)
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  notificationTab: 'a[href="/notifications"]',
  mentionsTab: 'a[href="/notifications/mentions"]',
  notification: '[data-testid="notification"]',
  settingsGear: 'a[href="/settings/notifications"]',
  toggleSwitch: '[data-testid="settingsSwitch"]',
  notificationText: '[data-testid="notification"] span',
  userCell: '[data-testid="UserCell"]',
  muteOption: '[data-testid="mute"]',
};

/**
 * Scrape recent notifications
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Array>}
 */
export async function getNotifications(page, options = {}) {
  const { limit = 50, type = 'all' } = options;

  const url = type === 'mentions' ? 'https://x.com/notifications/mentions' : 'https://x.com/notifications';
  await page.goto(url, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const notifications = [];
  let scrollAttempts = 0;

  while (notifications.length < limit && scrollAttempts < 15) {
    const newNotifs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="notification"]')).map(notif => {
        const text = notif.textContent || '';
        const links = Array.from(notif.querySelectorAll('a')).map(a => ({
          text: a.textContent,
          href: a.href,
        }));
        const time = notif.querySelector('time')?.getAttribute('datetime') || '';
        return { text: text.substring(0, 200), links, time };
      });
    });

    for (const notif of newNotifs) {
      if (!notifications.find(n => n.text === notif.text && n.time === notif.time)) {
        notifications.push(notif);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(1500);
    scrollAttempts++;
  }

  return {
    type,
    notifications: notifications.slice(0, limit),
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Mute a user
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Object>}
 */
export async function muteUser(page, username) {
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Click more options
  await page.click('[data-testid="userActions"]');
  await sleep(1000);

  // Click mute
  await page.click('[data-testid="mute"]');
  await sleep(1500);

  return { success: true, action: 'muted', username, timestamp: new Date().toISOString() };
}

/**
 * Unmute a user
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Object>}
 */
export async function unmuteUser(page, username) {
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  await page.click('[data-testid="userActions"]');
  await sleep(1000);
  await page.click('[data-testid="unmute"]');
  await sleep(1500);

  return { success: true, action: 'unmuted', username, timestamp: new Date().toISOString() };
}

/**
 * Mute a word/phrase
 * @param {import('puppeteer').Page} page
 * @param {string} word
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function muteWord(page, word, options = {}) {
  const { duration = 'forever' } = options; // forever, 24h, 7d, 30d

  await page.goto('https://x.com/settings/muted_keywords', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Click add muted word
  await page.click('[data-testid="addMutedWord"]');
  await sleep(1000);

  // Type the word
  await page.click('[data-testid="mutedWordInput"]');
  await page.keyboard.type(word);
  await sleep(500);

  // Save
  await page.click('[data-testid="saveMutedWord"]');
  await sleep(1500);

  return { success: true, action: 'muted_word', word, duration, timestamp: new Date().toISOString() };
}

/**
 * Get notification settings
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>}
 */
export async function getNotificationSettings(page) {
  await page.goto('https://x.com/settings/notifications', { waitUntil: 'networkidle2' });
  await sleep(2000);

  const settings = await page.evaluate(() => {
    const switches = Array.from(document.querySelectorAll('[data-testid="settingsSwitch"]'));
    return switches.map(s => ({
      label: s.closest('[role="listitem"]')?.textContent || '',
      enabled: s.getAttribute('aria-checked') === 'true',
    }));
  });

  return { settings, scrapedAt: new Date().toISOString() };
}

export default {
  getNotifications,
  muteUser,
  unmuteUser,
  muteWord,
  getNotificationSettings,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/notifications`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/notificationManager.js`](https://github.com/nirholas/XActions/blob/main/src/notificationManager.js) and paste it into the console.

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
| [`src/notificationManager.js`](https://github.com/nirholas/XActions/blob/main/src/notificationManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Manage Notifications](manage-notifications.md) | Configure notification preferences |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
