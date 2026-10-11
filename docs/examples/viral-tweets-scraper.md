# 🔥 Viral Tweets Scraper

Find top-performing tweets in any niche. Scrapes viral content sorted by engagement metrics.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Find top-performing tweets in any niche. Scrapes viral content sorted by engagement metrics.
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
1. Go to `x.com/search`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/viralTweetsScraper.js`](https://github.com/nirholas/XActions/blob/main/scripts/viralTweetsScraper.js)
4. Press Enter to run

```javascript
/**
 * Viral Tweet Scraper
 * Find top performing tweets by keyword or from any account
 * 
 * HOW TO USE:
 * 1. Go to x.com/search?q=YOUR_KEYWORD or x.com/USERNAME
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  // Configuration
  const CONFIG = {
    MIN_LIKES: 100,           // Minimum likes to be considered "viral"
    MIN_RETWEETS: 10,         // Minimum retweets
    MAX_TWEETS: 100,          // How many tweets to scan
    SCROLL_DELAY: 1500,       // Delay between scrolls (ms)
    SORT_BY: 'likes',         // 'likes', 'retweets', 'replies', 'views'
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Parse engagement numbers (handles "1.2K", "5M", etc.)
  const parseNumber = (str) => {
    if (!str) return 0;
    const num = parseFloat(str.replace(/,/g, ''));
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  // Extract tweet data
  const extractTweet = (article) => {
    try {
      const tweetText = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
      const userName = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
      const handle = userName.match(/@(\w+)/)?.[1] || '';
      const displayName = userName.split('@')[0]?.trim() || '';
      
      // Get tweet link
      const timeLink = article.querySelector('time')?.closest('a');
      const tweetUrl = timeLink?.href || '';
      const tweetId = tweetUrl.split('/status/')[1]?.split('?')[0] || '';
      
      // Get engagement metrics
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

      // Get time
      const time = article.querySelector('time')?.getAttribute('datetime') || '';

      return {
        tweetId,
        handle,
        displayName,
        text: tweetText.slice(0, 280),
        url: tweetUrl,
        likes,
        retweets,
        replies,
        views,
        time,
        engagement: likes + retweets + replies,
      };
    } catch (e) {
      return null;
    }
  };

  // Main function
  const run = async () => {
    console.log('🔥 Viral Tweet Scraper Starting...');
    console.log(`📊 Looking for tweets with ${CONFIG.MIN_LIKES}+ likes`);
    
    const tweets = new Map();
    let scrolls = 0;
    let lastHeight = 0;

    while (tweets.size < CONFIG.MAX_TWEETS && scrolls < 50) {
      // Get all tweet articles
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      
      articles.forEach(article => {
        const tweet = extractTweet(article);
        if (tweet && tweet.tweetId && !tweets.has(tweet.tweetId)) {
          // Filter by minimum engagement
          if (tweet.likes >= CONFIG.MIN_LIKES || tweet.retweets >= CONFIG.MIN_RETWEETS) {
            tweets.set(tweet.tweetId, tweet);
            console.log(`🔥 Found: ${tweet.likes} likes | @${tweet.handle}`);
          }
        }
      });

      // Scroll
      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      
      // Check if we've hit the bottom
      const newHeight = document.body.scrollHeight;
      if (newHeight === lastHeight) {
        scrolls++;
        if (scrolls > 3) break;
      } else {
        scrolls = 0;
      }
      lastHeight = newHeight;
    }

    // Sort tweets
    const sortedTweets = Array.from(tweets.values()).sort((a, b) => {
      switch (CONFIG.SORT_BY) {
        case 'retweets': return b.retweets - a.retweets;
        case 'replies': return b.replies - a.replies;
        case 'views': return b.views - a.views;
        case 'engagement': return b.engagement - a.engagement;
        default: return b.likes - a.likes;
      }
    });

    // Display results
    console.log('\n' + '='.repeat(60));
    console.log(`🔥 FOUND ${sortedTweets.length} VIRAL TWEETS`);
    console.log('='.repeat(60) + '\n');

    sortedTweets.slice(0, 20).forEach((t, i) => {
      console.log(`${i + 1}. @${t.handle} (${t.likes.toLocaleString()} ❤️ | ${t.retweets.toLocaleString()} 🔁)`);
      console.log(`   "${t.text.slice(0, 100)}..."`);
      console.log(`   ${t.url}\n`);
    });

    // Copy to clipboard
    const csv = [
      'Handle,Likes,Retweets,Replies,Views,Text,URL',
      ...sortedTweets.map(t => 
        `"@${t.handle}",${t.likes},${t.retweets},${t.replies},${t.views},"${t.text.replace(/"/g, '""')}","${t.url}"`
      )
    ].join('\n');

    try {
      await navigator.clipboard.writeText(csv);
      console.log('📋 Results copied to clipboard as CSV!');
    } catch (e) {
      console.log('📋 Copy manually from window.viralTweets');
    }

    // Store globally for access
    window.viralTweets = sortedTweets;

    // Download option
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `viral_tweets_${Date.now()}.csv`;
    a.click();
    
    console.log('💾 CSV downloaded!');
    console.log('\n✅ Done! Access data: window.viralTweets');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MIN_LIKES` | `100,` | Minimum likes to be considered "viral" |
| `MIN_RETWEETS` | `10,` | Minimum retweets |
| `MAX_TWEETS` | `100,` | How many tweets to scan |
| `SCROLL_DELAY` | `1500,` | Delay between scrolls (ms) |
| `SORT_BY` | `'likes',` | 'likes', 'retweets', 'replies', 'views' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/search`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/viralTweetsScraper.js`](https://github.com/nirholas/XActions/blob/main/scripts/viralTweetsScraper.js) and paste it into the console.

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
| [`scripts/viralTweetsScraper.js`](https://github.com/nirholas/XActions/blob/main/scripts/viralTweetsScraper.js) | Main script |

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
