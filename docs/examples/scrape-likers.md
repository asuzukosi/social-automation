# ❤️ Scrape Likers

Get all users who liked a specific tweet. Export likers list with profile metadata.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Get all users who liked a specific tweet. Export likers list with profile metadata.
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
1. Go to `x.com/USERNAME/status/ID/likes`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeLikers.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeLikers.js)
4. Press Enter to run

```javascript
/**
 * Likers Scraper
 * Get all users who liked a specific tweet
 * 
 * HOW TO USE:
 * 1. Go to a tweet and click on the likes count to open the likers list
 *    OR go directly to x.com/USERNAME/status/TWEETID/likes
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_LIKERS: 5000,
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

  const extractUser = (cell) => {
    try {
      const nameEl = cell.querySelector('[dir="ltr"] > span');
      const handleEl = cell.querySelector('a[href^="/"]');
      const bioEl = cell.querySelector('[data-testid="UserDescription"]');
      const verified = !!cell.querySelector('svg[aria-label*="Verified"]');
      
      const href = handleEl?.getAttribute('href') || '';
      const handle = href.replace('/', '').split('/')[0];
      
      return {
        handle,
        displayName: nameEl?.textContent || '',
        bio: bioEl?.textContent || '',
        verified,
        profileUrl: `https://x.com/${handle}`,
      };
    } catch (e) {
      return null;
    }
  };

  const getTweetId = () => {
    const match = window.location.pathname.match(/status\/(\d+)/);
    return match ? match[1] : null;
  };

  const run = async () => {
    if (!window.location.pathname.includes('/likes')) {
      console.error('❌ Please go to the likes page of a tweet!');
      console.log('   Example: x.com/user/status/123456/likes');
      return;
    }

    const tweetId = getTweetId();
    console.log(`❤️ Scraping likers of tweet ${tweetId}...`);

    const likers = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (likers.size < CONFIG.MAX_LIKERS && noNewCount < 5) {
      const cells = document.querySelectorAll('[data-testid="UserCell"]');
      const beforeCount = likers.size;

      cells.forEach(cell => {
        const user = extractUser(cell);
        if (user && user.handle && !likers.has(user.handle)) {
          likers.set(user.handle, user);
        }
      });

      const added = likers.size - beforeCount;
      if (added > 0) {
        console.log(`❤️ Collected ${likers.size} likers...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 200) break;
    }

    const likerList = Array.from(likers.values());

    console.log('\n' + '='.repeat(60));
    console.log(`❤️ SCRAPED ${likerList.length} LIKERS`);
    console.log('='.repeat(60) + '\n');

    likerList.slice(0, 5).forEach((l, i) => {
      console.log(`${i + 1}. @${l.handle}${l.verified ? ' ✓' : ''} - ${l.displayName}`);
    });
    if (likerList.length > 5) {
      console.log(`   ... and ${likerList.length - 5} more\n`);
    }

    const verified = likerList.filter(l => l.verified).length;
    console.log(`📊 Stats: ${verified} verified accounts`);

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      download(JSON.stringify({ tweetId, likers: likerList }, null, 2), `tweet_${tweetId}_likers_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded likers.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Handle,DisplayName,Bio,Verified,ProfileURL',
        ...likerList.map(l => 
          `"@${l.handle}","${l.displayName.replace(/"/g, '""')}","${l.bio.replace(/"/g, '""').replace(/\n/g, ' ')}",${l.verified},"${l.profileUrl}"`
        )
      ].join('\n');
      download(csv, `tweet_${tweetId}_likers_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded likers.csv');
    }

    window.scrapedLikers = { tweetId, likers: likerList };
    console.log('\n✅ Done! Access data: window.scrapedLikers');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_LIKERS` | `5000` | M a x  l i k e r s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/USERNAME/status/ID/likes`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeLikers.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeLikers.js) and paste it into the console.

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
| [`scripts/scrapeLikers.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeLikers.js) | Main script |

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
