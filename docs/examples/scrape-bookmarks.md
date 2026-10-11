# 🔖 Scrape Bookmarks

Scrape all your bookmarked tweets. Exports bookmarks with full metadata to JSON/CSV.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Scrape all your bookmarked tweets. Exports bookmarks with full metadata to JSON/CSV.
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
1. Go to `x.com/i/bookmarks`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeBookmarks.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeBookmarks.js)
4. Press Enter to run

```javascript
/**
 * Bookmarks Scraper (Enhanced)
 * Scrape all bookmarks with full metadata
 * 
 * HOW TO USE:
 * 1. Go to x.com/i/bookmarks
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_BOOKMARKS: 2000,
    SCROLL_DELAY: 1500,
    FORMAT: 'both', // 'json', 'csv', 'both'
    INCLUDE_MEDIA_URLS: true,
    INCLUDE_LINKS: true,
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

  const parseNumber = (str) => {
    if (!str) return 0;
    const num = parseFloat(str.replace(/,/g, ''));
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  const extractBookmark = (article) => {
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      const userName = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
      const handle = userName.match(/@(\w+)/)?.[1] || '';
      const displayName = userName.split('@')[0]?.trim() || '';
      const verified = !!article.querySelector('[data-testid="User-Name"] svg[aria-label*="Verified"]');
      
      const timeLink = article.querySelector('time')?.closest('a');
      const tweetUrl = timeLink?.href || '';
      const tweetId = tweetUrl.split('/status/')[1]?.split('?')[0] || '';
      const time = article.querySelector('time')?.getAttribute('datetime') || '';

      const buttons = article.querySelectorAll('[role="group"] button');
      let replies = 0, retweets = 0, likes = 0, views = 0;
      
      buttons.forEach(btn => {
        const label = btn.getAttribute('aria-label') || '';
        const num = parseNumber(label.match(/[\d,.]+[KM]?/)?.[0] || '0');
        
        if (label.includes('repl')) replies = num;
        else if (label.includes('repost') || label.includes('Retweet')) retweets = num;
        else if (label.includes('like')) likes = num;
        else if (label.includes('view')) views = num;
      });

      // Media URLs
      let images = [];
      let videos = [];
      if (CONFIG.INCLUDE_MEDIA_URLS) {
        images = Array.from(article.querySelectorAll('img[src*="media"]'))
          .map(img => img.src.replace(/&name=\w+/, '&name=large'))
          .filter(src => !src.includes('profile'));
        videos = Array.from(article.querySelectorAll('video'))
          .map(v => v.poster || v.src);
      }

      // External links
      let links = [];
      if (CONFIG.INCLUDE_LINKS) {
        links = Array.from(article.querySelectorAll('a[href^="http"]'))
          .map(a => a.getAttribute('title') || a.href)
          .filter(href => !href.includes('x.com') && !href.includes('twitter.com') && !href.includes('t.co'));
      }

      // Hashtags
      const hashtags = tweetText.match(/#\w+/g) || [];

      // Mentions
      const mentions = tweetText.match(/@\w+/g) || [];

      return {
        tweetId,
        handle,
        displayName,
        verified,
        text: tweetText,
        url: tweetUrl,
        time,
        likes,
        retweets,
        replies,
        views,
        images,
        videos,
        links,
        hashtags,
        mentions,
        hasMedia: images.length > 0 || videos.length > 0,
      };
    } catch (e) {
      return null;
    }
  };

  const run = async () => {
    if (!window.location.pathname.includes('/bookmarks')) {
      console.error('❌ Please go to x.com/i/bookmarks first!');
      return;
    }

    console.log('📚 Scraping bookmarks with full metadata...');

    const bookmarks = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (bookmarks.size < CONFIG.MAX_BOOKMARKS && noNewCount < 5) {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const beforeCount = bookmarks.size;

      articles.forEach(article => {
        const bookmark = extractBookmark(article);
        if (bookmark && bookmark.tweetId && !bookmarks.has(bookmark.tweetId)) {
          bookmarks.set(bookmark.tweetId, bookmark);
        }
      });

      const added = bookmarks.size - beforeCount;
      if (added > 0) {
        console.log(`📚 Collected ${bookmarks.size} bookmarks...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 200) break;
    }

    const bookmarkList = Array.from(bookmarks.values());

    console.log('\n' + '='.repeat(60));
    console.log(`📚 SCRAPED ${bookmarkList.length} BOOKMARKS`);
    console.log('='.repeat(60) + '\n');

    // Stats
    const withMedia = bookmarkList.filter(b => b.hasMedia).length;
    const withLinks = bookmarkList.filter(b => b.links.length > 0).length;
    const uniqueAuthors = new Set(bookmarkList.map(b => b.handle)).size;
    console.log(`📊 Stats:`);
    console.log(`   - ${uniqueAuthors} unique authors`);
    console.log(`   - ${withMedia} with media`);
    console.log(`   - ${withLinks} with external links`);

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      const data = {
        exportedAt: new Date().toISOString(),
        count: bookmarkList.length,
        bookmarks: bookmarkList,
      };
      download(JSON.stringify(data, null, 2), `bookmarks_full_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded bookmarks_full.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Handle,DisplayName,Verified,Text,Likes,Retweets,Views,HasMedia,URL,Time',
        ...bookmarkList.map(b => 
          `"@${b.handle}","${b.displayName.replace(/"/g, '""')}",${b.verified},"${b.text.replace(/"/g, '""').replace(/\n/g, ' ')}",${b.likes},${b.retweets},${b.views},${b.hasMedia},"${b.url}","${b.time}"`
        )
      ].join('\n');
      download(csv, `bookmarks_full_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded bookmarks_full.csv');
    }

    window.scrapedBookmarks = bookmarkList;
    console.log('\n✅ Done! Access data: window.scrapedBookmarks');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_BOOKMARKS` | `2000` | M a x  b o o k m a r k s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |
| `INCLUDE_MEDIA_URLS` | `true` | I n c l u d e  m e d i a  u r l s |
| `INCLUDE_LINKS` | `true` | I n c l u d e  l i n k s |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/i/bookmarks`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeBookmarks.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeBookmarks.js) and paste it into the console.

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
| [`scripts/scrapeBookmarks.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeBookmarks.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Scrape Profile with Replies](scrape-profile-with-replies.md) | Scrape a profile's tweets AND replies |
| [Scrape Analytics](scrape-analytics.md) | Scrape your account and post analytics |
| [Scrape Cashtag Search](scrape-cashtag-search.md) | Scrape cashtag search results with sentiment analysis |
| [Scrape DMs](scrape-dms.md) | Export your DM conversations |
| [Scrape Explore](scrape-explore.md) | Scrape the Explore page trends and content |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
