# 🔔 Manage Notifications

Configure notification preferences. Bulk-update which notifications you receive and how.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Configure notification preferences. Bulk-update which notifications you receive and how.
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
1. Go to `x.com/settings/notifications`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/manageNotifications.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageNotifications.js)
4. Press Enter to run

```javascript
// scripts/manageNotifications.js
// Browser console script to scrape and manage X/Twitter notifications
// Paste in DevTools console on x.com/notifications
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const CONFIG = {
    maxNotifications: 100,
    exportFormat: 'json', // 'json' or 'csv'
  };

  const run = async () => {
    console.log('🔔 XActions Notification Scraper');
    console.log('================================');

    const notifications = [];
    let scrollAttempts = 0;

    while (notifications.length < CONFIG.maxNotifications && scrollAttempts < 30) {
      document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach(cell => {
        const text = cell.textContent?.trim() || '';
        if (!text || text.length < 5) return;

        const links = Array.from(cell.querySelectorAll('a')).map(a => ({
          text: a.textContent?.trim(),
          href: a.href,
        }));
        const time = cell.querySelector('time')?.getAttribute('datetime') || '';

        // Classify notification type
        let type = 'other';
        const lower = text.toLowerCase();
        if (lower.includes('liked your')) type = 'like';
        else if (lower.includes('replied')) type = 'reply';
        else if (lower.includes('mentioned')) type = 'mention';
        else if (lower.includes('followed you')) type = 'follow';
        else if (lower.includes('retweeted') || lower.includes('reposted')) type = 'repost';
        else if (lower.includes('quote')) type = 'quote';

        const id = text.substring(0, 80) + time;
        if (!notifications.find(n => (n.text.substring(0, 80) + n.time) === id)) {
          notifications.push({
            type,
            text: text.substring(0, 200),
            time,
            links: links.slice(0, 3),
          });
        }
      });

      window.scrollBy(0, 800);
      await sleep(1500);
      scrollAttempts++;

      if (scrollAttempts % 5 === 0) {
        console.log(`  📥 Scraped ${notifications.length} notifications...`);
      }
    }

    // Summary
    const typeCounts = {};
    notifications.forEach(n => {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    });

    console.log(`\n📊 Notification summary (${notifications.length} total):`);
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      const emoji = { like: '❤️', reply: '💬', mention: '@', follow: '👤', repost: '🔁', quote: '💭', other: '📌' };
      console.log(`  ${emoji[type] || '📌'} ${type}: ${count}`);
    });

    const result = {
      notifications: notifications.slice(0, CONFIG.maxNotifications),
      summary: typeCounts,
      scrapedAt: new Date().toISOString(),
    };

    console.log('\n📦 Full JSON:');
    console.log(JSON.stringify(result, null, 2));

    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      console.log('\n✅ Copied to clipboard!');
    } catch (e) {
      console.log('\n⚠️ Could not copy to clipboard.');
    }
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxNotifications` | `100` | Max notifications |
| `exportFormat` | `'json',` | 'json' or 'csv' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/settings/notifications`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/manageNotifications.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageNotifications.js) and paste it into the console.

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
| [`scripts/manageNotifications.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageNotifications.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Notification Manager](notification-manager.md) | Scrape, filter, and manage your notifications |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
