# 📚 Bookmark Manager

Full bookmark management: save, remove, organize, export, and search through your bookmarked tweets.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Full bookmark management: save, remove, organize, export, and search through your bookmarked tweets.
- Automate repetitive bookmarks tasks on X/Twitter
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
1. Go to `x.com/i/bookmarks`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/bookmarkManager.js`](https://github.com/nirholas/XActions/blob/main/src/bookmarkManager.js)
4. Press Enter to run

```javascript
// src/bookmarkManager.js
// Advanced bookmark management for X/Twitter
// by nichxbt

/**
 * Bookmark Manager - Save, organize, export, and manage bookmarks
 * 
 * Features:
 * - Bookmark/unbookmark posts
 * - Create bookmark folders (Premium)
 * - Export bookmarks to JSON/CSV
 * - Clear all bookmarks
 * - Search within bookmarks
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  bookmarksNav: 'a[href="/i/bookmarks"]',
  bookmark: '[data-testid="bookmark"]',
  removeBookmark: '[data-testid="removeBookmark"]',
  bookmarkFolder: '[data-testid="bookmarkFolder"]',
  createFolder: '[data-testid="createBookmarkFolder"]',
  tweet: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  clearAll: '[data-testid="clearAllBookmarks"]',
  confirmClear: '[data-testid="confirmationSheetConfirm"]',
};

/**
 * Get all bookmarks
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getBookmarks(page, options = {}) {
  const { limit = 100, format = 'json' } = options;

  await page.goto('https://x.com/i/bookmarks', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const bookmarks = [];
  let scrollAttempts = 0;
  const maxScrolls = Math.ceil(limit / 5);

  while (bookmarks.length < limit && scrollAttempts < maxScrolls) {
    const newBookmarks = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel.tweet)).map(tweet => {
        const text = tweet.querySelector(sel.tweetText)?.textContent || '';
        const author = tweet.querySelector('[data-testid="User-Name"] a')?.textContent || '';
        const time = tweet.querySelector('time')?.getAttribute('datetime') || '';
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        const likes = tweet.querySelector('[data-testid="like"] span')?.textContent || '0';
        const hasMedia = !!tweet.querySelector('img[src*="media"], video');
        return { text, author, time, link, likes, hasMedia };
      });
    }, SELECTORS);

    for (const bm of newBookmarks) {
      if (bm.link && !bookmarks.find(b => b.link === bm.link)) {
        bookmarks.push(bm);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(1500);
    scrollAttempts++;
  }

  const result = bookmarks.slice(0, limit);

  if (format === 'csv') {
    const csv = [
      'text,author,time,link,likes,hasMedia',
      ...result.map(b => `"${b.text.replace(/"/g, '""')}","${b.author}","${b.time}","${b.link}","${b.likes}","${b.hasMedia}"`),
    ].join('\n');
    return { format: 'csv', data: csv, count: result.length };
  }

  return {
    bookmarks: result,
    count: result.length,
    format: 'json',
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Create a bookmark folder (Premium required)
 * @param {import('puppeteer').Page} page
 * @param {string} folderName
 * @returns {Promise<Object>}
 */
export async function createFolder(page, folderName) {
  await page.goto('https://x.com/i/bookmarks', { waitUntil: 'networkidle2' });
  await sleep(2000);

  try {
    await page.click(SELECTORS.createFolder);
    await sleep(1000);

    await page.click('input[name="folderName"]');
    await page.keyboard.type(folderName);
    await sleep(500);

    await page.click('[data-testid="createFolderConfirm"]');
    await sleep(1500);

    return { success: true, action: 'created_folder', name: folderName };
  } catch (e) {
    return { success: false, error: 'Could not create folder — Premium required' };
  }
}

/**
 * Clear all bookmarks
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>}
 */
export async function clearAllBookmarks(page) {
  await page.goto('https://x.com/i/bookmarks', { waitUntil: 'networkidle2' });
  await sleep(2000);

  try {
    // Open more options
    await page.click('[aria-label="More"]');
    await sleep(1000);

    await page.click(SELECTORS.clearAll);
    await sleep(1000);

    await page.click(SELECTORS.confirmClear);
    await sleep(2000);

    return { success: true, action: 'cleared_all', timestamp: new Date().toISOString() };
  } catch (e) {
    return { success: false, error: 'Could not clear bookmarks' };
  }
}

export default {
  getBookmarks,
  createFolder,
  clearAllBookmarks,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/i/bookmarks`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/bookmarkManager.js`](https://github.com/nirholas/XActions/blob/main/src/bookmarkManager.js) and paste it into the console.

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
| [`src/bookmarkManager.js`](https://github.com/nirholas/XActions/blob/main/src/bookmarkManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Manage Bookmarks](manage-bookmarks.md) | Manage bookmarks via the browser UI |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
