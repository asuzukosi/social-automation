# 👥 Scrape Following

Export the full following list to JSON/CSV. See every account you follow with their metadata.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Export the full following list to JSON/CSV. See every account you follow with their metadata.
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
1. Go to `x.com/USERNAME/following`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeFollowing.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeFollowing.js)
4. Press Enter to run

```javascript
/**
 * Following Scraper
 * Export your following list to JSON/CSV
 * 
 * HOW TO USE:
 * 1. Go to x.com/USERNAME/following
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_FOLLOWING: 5000,
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

  const extractBio = (cell) => {
    const testId = cell.querySelector('[data-testid="UserDescription"]');
    if (testId?.textContent?.trim()) return testId.textContent.trim();
    const autoDir = cell.querySelector('[dir="auto"]:not([data-testid])');
    const text = autoDir?.textContent?.trim();
    if (text && text.length >= 10 && !text.startsWith('@')) return text;
    return '';
  };

  const extractUser = (cell) => {
    try {
      const nameEl = cell.querySelector('[dir="ltr"] > span');
      const handleEl = cell.querySelector('a[href^="/"]');
      const followsYou = !!cell.querySelector('[data-testid="userFollowIndicator"]');
      
      const href = handleEl?.getAttribute('href') || '';
      const handle = href.replace('/', '').split('/')[0];
      
      return {
        handle,
        displayName: nameEl?.textContent || '',
        bio: extractBio(cell),
        followsYou,
        profileUrl: `https://x.com/${handle}`,
      };
    } catch (e) {
      return null;
    }
  };

  const run = async () => {
    if (!window.location.pathname.includes('/following')) {
      console.error('❌ Please go to x.com/USERNAME/following first!');
      return;
    }

    const username = window.location.pathname.split('/')[1];
    console.log(`👥 Scraping following list of @${username}...`);

    const following = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (following.size < CONFIG.MAX_FOLLOWING && noNewCount < 5) {
      const cells = document.querySelectorAll('[data-testid="UserCell"]');
      const beforeCount = following.size;

      cells.forEach(cell => {
        const user = extractUser(cell);
        if (user && user.handle && !following.has(user.handle)) {
          following.set(user.handle, user);
        }
      });

      const added = following.size - beforeCount;
      if (added > 0) {
        console.log(`👥 Collected ${following.size} following...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 200) break;
    }

    const followingList = Array.from(following.values());

    console.log('\n' + '='.repeat(60));
    console.log(`👥 SCRAPED ${followingList.length} FOLLOWING`);
    console.log('='.repeat(60) + '\n');

    followingList.slice(0, 5).forEach((f, i) => {
      console.log(`${i + 1}. @${f.handle} - ${f.displayName}${f.followsYou ? ' (follows you)' : ''}`);
    });
    if (followingList.length > 5) {
      console.log(`   ... and ${followingList.length - 5} more\n`);
    }

    // Stats
    const mutuals = followingList.filter(f => f.followsYou).length;
    console.log(`📊 Stats: ${mutuals} mutuals, ${followingList.length - mutuals} non-followers`);

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      download(JSON.stringify(followingList, null, 2), `${username}_following_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded following.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Handle,DisplayName,Bio,FollowsYou,ProfileURL',
        ...followingList.map(f => 
          `"@${f.handle}","${f.displayName.replace(/"/g, '""')}","${f.bio.replace(/"/g, '""').replace(/\n/g, ' ')}",${f.followsYou},"${f.profileUrl}"`
        )
      ].join('\n');
      download(csv, `${username}_following_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded following.csv');
    }

    window.scrapedFollowing = followingList;
    console.log('\n✅ Done! Access data: window.scrapedFollowing');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_FOLLOWING` | `5000` | M a x  f o l l o w i n g |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/USERNAME/following`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeFollowing.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeFollowing.js) and paste it into the console.

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
| [`scripts/scrapeFollowing.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeFollowing.js) | Main script |

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
