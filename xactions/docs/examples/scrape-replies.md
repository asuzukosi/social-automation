# 💬 Scrape Replies

Scrape all replies to a specific tweet. Export conversation threads with engagement data.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Scrape all replies to a specific tweet. Export conversation threads with engagement data.
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
1. Go to `x.com/USERNAME/status/ID`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeReplies.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeReplies.js)
4. Press Enter to run

```javascript
/**
 * Replies Scraper
 * Get all replies to a specific tweet
 * 
 * HOW TO USE:
 * 1. Go to any tweet: x.com/USERNAME/status/TWEETID
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_REPLIES: 500,
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

  const parseNumber = (str) => {
    if (!str) return 0;
    const num = parseFloat(str.replace(/,/g, ''));
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  const extractReply = (article) => {
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      const userName = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
      const handle = userName.match(/@(\w+)/)?.[1] || '';
      const displayName = userName.split('@')[0]?.trim() || '';
      const verified = !!article.querySelector('[data-testid="User-Name"] svg[aria-label*="Verified"]');
      
      const timeLink = article.querySelector('time')?.closest('a');
      const replyUrl = timeLink?.href || '';
      const replyId = replyUrl.split('/status/')[1]?.split('?')[0] || '';
      const time = article.querySelector('time')?.getAttribute('datetime') || '';

      const buttons = article.querySelectorAll('[role="group"] button');
      let replies = 0, retweets = 0, likes = 0;
      
      buttons.forEach(btn => {
        const label = btn.getAttribute('aria-label') || '';
        const num = parseNumber(label.match(/[\d,.]+[KM]?/)?.[0] || '0');
        
        if (label.includes('repl')) replies = num;
        else if (label.includes('repost') || label.includes('Retweet')) retweets = num;
        else if (label.includes('like')) likes = num;
      });

      return {
        replyId,
        handle,
        displayName,
        verified,
        text: tweetText,
        url: replyUrl,
        time,
        likes,
        retweets,
        replies,
      };
    } catch (e) {
      return null;
    }
  };

  const getTweetId = () => {
    const match = window.location.pathname.match(/status\/(\d+)/);
    return match ? match[1] : null;
  };

  const getOriginalAuthor = () => {
    const match = window.location.pathname.match(/\/(\w+)\/status/);
    return match ? match[1] : null;
  };

  const run = async () => {
    const tweetId = getTweetId();
    const originalAuthor = getOriginalAuthor();

    if (!tweetId) {
      console.error('❌ Please go to a tweet first!');
      console.log('   Example: x.com/user/status/123456');
      return;
    }

    console.log(`💬 Scraping replies to @${originalAuthor}'s tweet...`);

    const replies = new Map();
    let scrolls = 0;
    let noNewCount = 0;
    let isFirstTweet = true;

    while (replies.size < CONFIG.MAX_REPLIES && noNewCount < 5) {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const beforeCount = replies.size;

      articles.forEach(article => {
        const reply = extractReply(article);
        
        // Skip the original tweet (first one)
        if (reply && reply.replyId) {
          if (reply.replyId === tweetId) {
            isFirstTweet = false;
            return; // Skip original tweet
          }
          
          if (!replies.has(reply.replyId)) {
            replies.set(reply.replyId, reply);
          }
        }
      });

      const added = replies.size - beforeCount;
      if (added > 0) {
        console.log(`💬 Collected ${replies.size} replies...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 100) break;
    }

    const replyList = Array.from(replies.values());
    replyList.sort((a, b) => b.likes - a.likes);

    console.log('\n' + '='.repeat(60));
    console.log(`💬 SCRAPED ${replyList.length} REPLIES`);
    console.log('='.repeat(60) + '\n');

    // Stats
    const verifiedReplies = replyList.filter(r => r.verified).length;
    const uniqueUsers = new Set(replyList.map(r => r.handle)).size;
    console.log(`📊 Stats: ${uniqueUsers} unique users, ${verifiedReplies} verified accounts`);

    replyList.slice(0, 5).forEach((r, i) => {
      console.log(`${i + 1}. @${r.handle}${r.verified ? ' ✓' : ''} (${r.likes} ❤️): "${r.text.slice(0, 50)}..."`);
    });

    if (CONFIG.FORMAT === 'json' || CONFIG.FORMAT === 'both') {
      const data = { 
        originalTweetId: tweetId, 
        originalAuthor,
        replyCount: replyList.length,
        replies: replyList 
      };
      download(JSON.stringify(data, null, 2), `tweet_${tweetId}_replies_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded replies.json');
    }

    if (CONFIG.FORMAT === 'csv' || CONFIG.FORMAT === 'both') {
      const csv = [
        'Handle,DisplayName,Verified,Text,Likes,Retweets,URL,Time',
        ...replyList.map(r => 
          `"@${r.handle}","${r.displayName.replace(/"/g, '""')}",${r.verified},"${r.text.replace(/"/g, '""').replace(/\n/g, ' ')}",${r.likes},${r.retweets},"${r.url}","${r.time}"`
        )
      ].join('\n');
      download(csv, `tweet_${tweetId}_replies_${Date.now()}.csv`, 'text/csv');
      console.log('💾 Downloaded replies.csv');
    }

    window.scrapedReplies = { tweetId, originalAuthor, replies: replyList };
    console.log('\n✅ Done! Access data: window.scrapedReplies');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_REPLIES` | `500` | M a x  r e p l i e s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `FORMAT` | `'both',` | 'json', 'csv', 'both' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/USERNAME/status/ID`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeReplies.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeReplies.js) and paste it into the console.

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
| [`scripts/scrapeReplies.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeReplies.js) | Main script |

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
