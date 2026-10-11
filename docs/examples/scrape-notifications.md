# 🔔 Scrape Notifications

Export your notification history. Scrapes likes, retweets, follows, and mentions with timestamps.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Export your notification history. Scrapes likes, retweets, follows, and mentions with timestamps.
- Automate repetitive scrapers tasks on X/Twitter
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
3. Copy and paste the script from [`scripts/scrapeNotifications.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeNotifications.js)
4. Press Enter to run

```javascript
/**
 * Notifications Scraper
 * Export notification history
 * 
 * HOW TO USE:
 * 1. Go to x.com/notifications
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_NOTIFICATIONS: 500,
    SCROLL_DELAY: 1500,
    FORMAT: 'both', // 'json', 'csv', 'both'
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const download = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const extractNotification = (item, index) => {
    try {
      const text = item.textContent || '';
      
      // Get notification type
      let type = 'unknown';
      if (text.includes('liked')) type = 'like';
      else if (text.includes('retweeted') || text.includes('reposted')) type = 'retweet';
      else if (text.includes('followed')) type = 'follow';
      else if (text.includes('replied')) type = 'reply';
      else if (text.includes('mentioned')) type = 'mention';
      else if (text.includes('quoted')) type = 'quote';

      // Get users involved
      const userLinks = item.querySelectorAll('a[href^="/"]');
      const users = [];
      userLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.startsWith('/') && !href.includes('/status/') && href.length < 20) {
          const handle = href.replace('/', '');
          if (handle && !users.includes(handle)) {
            users.push(handle);
          }
        }
      });

      // Get related tweet if any
      const tweetLink = item.querySelector('a[href*="/status/"]');
      const tweetUrl = tweetLink?.href || '';

      // Get time
      const timeEl = item.querySelector('time');
      const time = timeEl?.getAttribute('datetime') || timeEl?.textContent || '';

      return {
        id: index,
        type,
        text: text.slice(0, 280),
        users: users.slice(0, 10),
        tweetUrl,
        time,
      };
    } catch (e) {
      return null;
    }
  };

  const run = async () => {
    if (!window.location.pathname.includes('/notifications')) {
      console.error('❌ Please go to x.com/notifications first!');
      return;
    }

    console.log('🔔 Scraping notifications...');

    const notifications = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (notifications.size < CONFIG.MAX_NOTIFICATIONS && noNewCount < 5) {
      // Find notification items (they're usually in cells or articles)
      const items = document.querySelectorAll('[data-testid="cellInnerDiv"], article');
      const beforeCount = notifications.size;

      items.forEach((item, index) => {
        const notification = extractNotification(item, notifications.size + index);
        if (notification && notification.text.length > 5) {
          const key = `${notification.type}_${notification.text.slice(0, 50)}`;
          if (!notifications.has(key)) {
            notifications.set(key, notification);
          }
        }
      });

      const added = notifications.size - beforeCount;
      if (added > 0) {
        console.log(`🔔 Collected ${notifications.size} notifications...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 100) break;
    }

    const notificationList = Array.from(notifications.values());

    console.log('\n' + '='.repeat(60));
    console.log(`🔔 SCRAPED ${notificationList.length} NOTIFICATIONS`);
    console.log('='.repeat(60) + '\n');

    // Stats by type
    const byType = {};
    notificationList.forEach(n => {
      byType[n.type] = (byType[n.type] || 0) + 1;
    });
    
    console.log('📊 By type:');
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    // Top interactors
    const userCounts = {};
    notificationList.forEach(n => {
      n.users.forEach(user => {
        userCounts[user] = (userCounts[user] || 0) + 1;
      });
    });
    
    const topUsers = Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    if (topUsers.length > 0) {
      console.log('\n👥 Top interactors:');
      topUsers.forEach(([user, count]) => {
        console.log(`   @${user}: ${count} interactions`);
      });
    }

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      const data = {
        exportedAt: new Date().toISOString(),
        count: notificationList.length,
        byType,
        notifications: notificationList,
      };
      download(JSON.stringify(data, null, 2), `notifications_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded notifications.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Type,Text,Users,TweetURL,Time',
        ...notificationList.map(n => 
          `"${n.type}","${n.text.replace(/"/g, '""').replace(/\n/g, ' ')}","${n.users.join(', ')}","${n.tweetUrl}","${n.time}"`
        )
      ].join('\n');
      download(csv, `notifications_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded notifications.csv');
    }

    window.scrapedNotifications = notificationList;
    console.log('\n✅ Done! Access data: window.scrapedNotifications');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_NOTIFICATIONS` | `500` | M a x  n o t i f i c a t i o n s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/notifications`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeNotifications.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeNotifications.js) and paste it into the console.

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
| [`scripts/scrapeNotifications.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeNotifications.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Scrape Profile with Replies](scrape-profile-with-replies.md) | Scrape a profile's tweets AND replies |
| [Scrape Analytics](scrape-analytics.md) | Scrape your account and post analytics |
| [Scrape Bookmarks](scrape-bookmarks.md) | Scrape all your bookmarked tweets |
| [Scrape Cashtag Search](scrape-cashtag-search.md) | Scrape cashtag search results with sentiment analysis |
| [Scrape DMs](scrape-dms.md) | Export your DM conversations |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
