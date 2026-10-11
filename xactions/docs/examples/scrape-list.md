# 📝 Scrape List Members

Scrape all members from a public Twitter list. Exports member profiles with metadata.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Scrape all members from a public Twitter list. Exports member profiles with metadata.
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
1. Go to `x.com/i/lists/LIST_ID/members`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeList.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeList.js)
4. Press Enter to run

```javascript
/**
 * List Members Scraper
 * Get all members of a Twitter list
 * 
 * HOW TO USE:
 * 1. Go to a Twitter list: x.com/i/lists/LISTID/members
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_MEMBERS: 5000,
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

  const getListId = () => {
    const match = window.location.pathname.match(/lists\/(\d+)/);
    return match ? match[1] : null;
  };

  const getListName = () => {
    const header = document.querySelector('h2[role="heading"]');
    return header?.textContent || 'unknown_list';
  };

  const run = async () => {
    if (!window.location.pathname.includes('/lists/')) {
      console.error('❌ Please go to a Twitter list first!');
      console.log('   Example: x.com/i/lists/123456/members');
      return;
    }

    const listId = getListId();
    const listName = getListName();
    console.log(`📋 Scraping list: ${listName} (ID: ${listId})...`);

    const members = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (members.size < CONFIG.MAX_MEMBERS && noNewCount < 5) {
      const cells = document.querySelectorAll('[data-testid="UserCell"]');
      const beforeCount = members.size;

      cells.forEach(cell => {
        const user = extractUser(cell);
        if (user && user.handle && !members.has(user.handle)) {
          members.set(user.handle, user);
        }
      });

      const added = members.size - beforeCount;
      if (added > 0) {
        console.log(`📋 Collected ${members.size} members...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 200) break;
    }

    const memberList = Array.from(members.values());

    console.log('\n' + '='.repeat(60));
    console.log(`📋 SCRAPED ${memberList.length} MEMBERS FROM "${listName}"`);
    console.log('='.repeat(60) + '\n');

    const verified = memberList.filter(m => m.verified).length;
    console.log(`📊 Stats: ${verified} verified accounts`);

    memberList.slice(0, 5).forEach((m, i) => {
      console.log(`${i + 1}. @${m.handle}${m.verified ? ' ✓' : ''} - ${m.displayName}`);
    });
    if (memberList.length > 5) {
      console.log(`   ... and ${memberList.length - 5} more\n`);
    }

    const safeListName = listName.replace(/[^a-z0-9]/gi, '_').slice(0, 30);

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      const data = { listId, listName, members: memberList };
      download(JSON.stringify(data, null, 2), `list_${safeListName}_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded list_members.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Handle,DisplayName,Bio,Verified,ProfileURL',
        ...memberList.map(m => 
          `"@${m.handle}","${m.displayName.replace(/"/g, '""')}","${m.bio.replace(/"/g, '""').replace(/\n/g, ' ')}",${m.verified},"${m.profileUrl}"`
        )
      ].join('\n');
      download(csv, `list_${safeListName}_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded list_members.csv');
    }

    window.scrapedList = { listId, listName, members: memberList };
    console.log('\n✅ Done! Access data: window.scrapedList');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_MEMBERS` | `5000` | M a x  m e m b e r s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/i/lists/LIST_ID/members`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeList.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeList.js) and paste it into the console.

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
| [`scripts/scrapeList.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeList.js) | Main script |

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
