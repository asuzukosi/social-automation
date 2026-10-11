# 📑 Manage Bookmarks

Manage bookmarks via the browser UI. Add, remove, and organize bookmarks with bulk operations.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Manage bookmarks via the browser UI. Add, remove, and organize bookmarks with bulk operations.
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
3. Copy and paste the script from [`scripts/manageBookmarks.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageBookmarks.js)
4. Press Enter to run

```javascript
// scripts/manageBookmarks.js
// Browser console script to export and manage X/Twitter bookmarks
// Paste in DevTools console on x.com/i/bookmarks
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const CONFIG = {
    action: 'export', // 'export' or 'clear_all'
    maxBookmarks: 200,
    format: 'json',   // 'json' or 'csv'
  };

  const exportBookmarks = async () => {
    console.log('🔖 Exporting bookmarks...');

    const bookmarks = [];
    let scrollAttempts = 0;
    const maxScrolls = Math.ceil(CONFIG.maxBookmarks / 3);

    while (bookmarks.length < CONFIG.maxBookmarks && scrollAttempts < maxScrolls) {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
        const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
        const author = tweet.querySelector('[data-testid="User-Name"] a')?.textContent || '';
        const handle = tweet.querySelector('[data-testid="User-Name"] a[tabindex="-1"]')?.textContent || '';
        const time = tweet.querySelector('time')?.getAttribute('datetime') || '';
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        const likes = tweet.querySelector('[data-testid="like"] span')?.textContent || '0';
        const hasMedia = !!(tweet.querySelector('img[src*="media"]') || tweet.querySelector('video'));

        if (link && !bookmarks.find(b => b.link === link)) {
          bookmarks.push({ text: text.substring(0, 500), author, handle, time, link, likes, hasMedia });
        }
      });

      window.scrollBy(0, 1000);
      await sleep(1500);
      scrollAttempts++;

      if (scrollAttempts % 5 === 0) {
        console.log(`  📥 ${bookmarks.length} bookmarks scraped...`);
      }
    }

    console.log(`\n📚 Total: ${bookmarks.length} bookmarks`);

    if (CONFIG.format === 'csv') {
      const csv = 'author,handle,text,link,likes,time,hasMedia\n' +
        bookmarks.map(b => 
          `"${b.author}","${b.handle}","${b.text.replace(/"/g, '""')}","${b.link}","${b.likes}","${b.time}","${b.hasMedia}"`
        ).join('\n');

      console.log('\n📋 CSV output:');
      console.log(csv);

      try {
        await navigator.clipboard.writeText(csv);
        console.log('\n✅ CSV copied to clipboard!');
      } catch (e) {}
    } else {
      const result = {
        bookmarks,
        count: bookmarks.length,
        exportedAt: new Date().toISOString(),
      };

      console.log('\n📦 JSON output:');
      console.log(JSON.stringify(result, null, 2));

      try {
        await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
        console.log('\n✅ JSON copied to clipboard!');
      } catch (e) {}
    }

    return bookmarks;
  };

  const clearAllBookmarks = async () => {
    console.log('🗑️ Clearing all bookmarks...');
    console.log('⚠️ This action cannot be undone!');
    await sleep(2000);

    // Look for the more/settings menu
    const moreBtn = document.querySelector('[aria-label="More"]');
    if (moreBtn) {
      moreBtn.click();
      await sleep(1000);
    }

    const clearBtn = document.querySelector('[data-testid="clearAllBookmarks"]');
    if (clearBtn) {
      clearBtn.click();
      await sleep(1000);

      const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
      if (confirmBtn) {
        confirmBtn.click();
        await sleep(2000);
        console.log('✅ All bookmarks cleared!');
      }
    } else {
      console.log('⚠️ Clear all button not found. Try clearing from the top menu.');
    }
  };

  const run = async () => {
    console.log('🔖 XActions Bookmark Manager');
    console.log('============================');

    if (CONFIG.action === 'clear_all') {
      await clearAllBookmarks();
    } else {
      await exportBookmarks();
    }
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `action` | `'export',` | 'export' or 'clear_all' |
| `maxBookmarks` | `200` | Max bookmarks |
| `format` | `'json',` | 'json' or 'csv' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/i/bookmarks`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/manageBookmarks.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageBookmarks.js) and paste it into the console.

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
| [`scripts/manageBookmarks.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageBookmarks.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Bookmark Manager](bookmark-manager.md) | Full bookmark management: save, remove, organize, export, and search through your bookmarked tweets |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
