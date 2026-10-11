# 🔍 Scrape Search Results

Search and export tweets by keyword. Supports advanced search operators and date filtering.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Search and export tweets by keyword. Supports advanced search operators and date filtering.
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
1. Go to `x.com/search?q=keyword`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeSearch.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeSearch.js)
4. Press Enter to run

```javascript
/**
 * Search Scraper
 * Search and export tweets by keyword
 * 
 * HOW TO USE:
 * 1. Go to x.com/search?q=YOUR_SEARCH_TERM
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_TWEETS: 500,
    SCROLL_DELAY: 1500,
    FORMAT: 'both', // 'json', 'csv', 'both'
    MIN_LIKES: 0,   // Filter: minimum likes (0 = no filter)
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

  const extractTweet = (article) => {
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      const userName = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
      const handle = userName.match(/@(\w+)/)?.[1] || '';
      const displayName = userName.split('@')[0]?.trim() || '';
      
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

      return {
        tweetId,
        handle,
        displayName,
        text: tweetText,
        url: tweetUrl,
        time,
        likes,
        retweets,
        replies,
        views,
        engagement: likes + retweets + replies,
      };
    } catch (e) {
      return null;
    }
  };

  const getSearchQuery = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || 'unknown';
  };

  const run = async () => {
    if (!window.location.pathname.includes('/search')) {
      console.error('❌ Please go to Twitter search first!');
      console.log('   Example: x.com/search?q=your+search+term');
      return;
    }

    const query = getSearchQuery();
    console.log(`🔍 Scraping search results for: "${query}"...`);

    const tweets = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (tweets.size < CONFIG.MAX_TWEETS && noNewCount < 5) {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const beforeCount = tweets.size;

      articles.forEach(article => {
        const tweet = extractTweet(article);
        if (tweet && tweet.tweetId && !tweets.has(tweet.tweetId)) {
          if (tweet.likes >= CONFIG.MIN_LIKES) {
            tweets.set(tweet.tweetId, tweet);
          }
        }
      });

      const added = tweets.size - beforeCount;
      if (added > 0) {
        console.log(`🔍 Collected ${tweets.size} tweets...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 100) break;
    }

    const tweetList = Array.from(tweets.values());
    tweetList.sort((a, b) => b.engagement - a.engagement);

    console.log('\n' + '='.repeat(60));
    console.log(`🔍 SCRAPED ${tweetList.length} TWEETS FOR "${query}"`);
    console.log('='.repeat(60) + '\n');

    // Stats
    const totalLikes = tweetList.reduce((sum, t) => sum + t.likes, 0);
    const totalRetweets = tweetList.reduce((sum, t) => sum + t.retweets, 0);
    console.log(`📊 Total engagement: ${totalLikes.toLocaleString()} likes, ${totalRetweets.toLocaleString()} retweets`);

    tweetList.slice(0, 5).forEach((t, i) => {
      console.log(`${i + 1}. @${t.handle} (${t.likes} ❤️): "${t.text.slice(0, 50)}..."`);
    });

    const safeQuery = query.replace(/[^a-z0-9]/gi, '_').slice(0, 30);

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      const data = { query, scrapedAt: new Date().toISOString(), tweets: tweetList };
      download(JSON.stringify(data, null, 2), `search_${safeQuery}_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded search_results.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Handle,Text,Likes,Retweets,Replies,Views,URL,Time',
        ...tweetList.map(t => 
          `"@${t.handle}","${t.text.replace(/"/g, '""').replace(/\n/g, ' ')}",${t.likes},${t.retweets},${t.replies},${t.views},"${t.url}","${t.time}"`
        )
      ].join('\n');
      download(csv, `search_${safeQuery}_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded search_results.csv');
    }

    window.scrapedSearch = { query, tweets: tweetList };
    console.log('\n✅ Done! Access data: window.scrapedSearch');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_TWEETS` | `500` | M a x  t w e e t s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |
| `MIN_LIKES` | `0,` | Filter: minimum likes (0 = no filter) |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/search?q=keyword`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeSearch.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeSearch.js) and paste it into the console.

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
| [`scripts/scrapeSearch.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeSearch.js) | Main script |

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
