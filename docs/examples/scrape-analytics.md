# 📊 Scrape Analytics

Scrape your account and post analytics. Extracts impressions, engagement rates, and audience data.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Scrape your account and post analytics. Extracts impressions, engagement rates, and audience data.
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
1. Go to `x.com/YOUR_USERNAME`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeAnalytics.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeAnalytics.js)
4. Press Enter to run

```javascript
// scripts/scrapeAnalytics.js
// Browser console script to scrape X/Twitter analytics data
// Paste in DevTools console on x.com/i/account_analytics or any post
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const CONFIG = {
    mode: 'account', // 'account' or 'post'
    // For post mode, navigate to a specific tweet first
    scrapeRecentPosts: true,
    maxPosts: 20,
  };

  const scrapeAccountAnalytics = async () => {
    console.log('📊 Scraping account analytics...');

    // Try to extract analytics from the analytics page
    const metrics = {};

    // Generic metric extraction
    document.querySelectorAll('[role="listitem"], [data-testid*="stat"], [data-testid*="metric"]').forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 200) {
        const parts = text.split('\n').filter(Boolean);
        if (parts.length >= 2) {
          metrics[parts[0].trim()] = parts[1].trim();
        }
      }
    });

    // Try specific selectors
    const specificMetrics = {
      impressions: document.querySelector('[data-testid="impressions"]')?.textContent,
      engagements: document.querySelector('[data-testid="engagements"]')?.textContent,
      followers: document.querySelector('a[href$="/followers"] span')?.textContent,
      following: document.querySelector('a[href$="/following"] span')?.textContent,
    };

    Object.entries(specificMetrics).forEach(([k, v]) => {
      if (v) metrics[k] = v.trim();
    });

    return metrics;
  };

  const scrapePostAnalytics = async () => {
    console.log('📈 Scraping post analytics...');

    const tweet = document.querySelector('article[data-testid="tweet"]');
    if (!tweet) return { error: 'No tweet found on this page' };

    return {
      text: tweet.querySelector('[data-testid="tweetText"]')?.textContent || '',
      likes: tweet.querySelector('[data-testid="like"] span, [data-testid="unlike"] span')?.textContent || '0',
      reposts: tweet.querySelector('[data-testid="retweet"] span')?.textContent || '0',
      replies: tweet.querySelector('[data-testid="reply"] span')?.textContent || '0',
      views: tweet.querySelector('[data-testid="analyticsButton"] span')?.textContent || '0',
      bookmarks: tweet.querySelector('[data-testid="bookmark"] span')?.textContent || '0',
      time: tweet.querySelector('time')?.getAttribute('datetime') || '',
    };
  };

  const scrapeRecentPosts = async () => {
    console.log('📝 Scraping recent posts analytics...');

    const posts = [];
    let scrollAttempts = 0;

    while (posts.length < CONFIG.maxPosts && scrollAttempts < CONFIG.maxPosts) {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        if (!link || posts.find(p => p.link === link)) return;

        posts.push({
          text: (tweet.querySelector('[data-testid="tweetText"]')?.textContent || '').substring(0, 200),
          likes: tweet.querySelector('[data-testid="like"] span, [data-testid="unlike"] span')?.textContent || '0',
          reposts: tweet.querySelector('[data-testid="retweet"] span')?.textContent || '0',
          replies: tweet.querySelector('[data-testid="reply"] span')?.textContent || '0',
          views: tweet.querySelector('[data-testid="analyticsButton"] span')?.textContent || '',
          time: tweet.querySelector('time')?.getAttribute('datetime') || '',
          link,
        });
      });

      window.scrollBy(0, 800);
      await sleep(1500);
      scrollAttempts++;
    }

    return posts.slice(0, CONFIG.maxPosts);
  };

  const run = async () => {
    console.log('📊 XActions Analytics Scraper');
    console.log('============================');

    let result = {};

    if (CONFIG.mode === 'post') {
      result.postAnalytics = await scrapePostAnalytics();
    } else {
      result.accountMetrics = await scrapeAccountAnalytics();
    }

    if (CONFIG.scrapeRecentPosts) {
      result.recentPosts = await scrapeRecentPosts();

      // Calculate engagement summary
      const totalLikes = result.recentPosts.reduce((sum, p) => sum + parseInt(p.likes.replace(/[,K]/g, '')) || 0, 0);
      const totalReposts = result.recentPosts.reduce((sum, p) => sum + parseInt(p.reposts.replace(/[,K]/g, '')) || 0, 0);

      result.summary = {
        totalPosts: result.recentPosts.length,
        totalLikes,
        totalReposts,
        avgLikes: Math.round(totalLikes / result.recentPosts.length),
        avgReposts: Math.round(totalReposts / result.recentPosts.length),
        topPost: result.recentPosts.sort((a, b) => 
          (parseInt(b.likes.replace(/[,K]/g, '')) || 0) - (parseInt(a.likes.replace(/[,K]/g, '')) || 0)
        )[0],
      };

      console.log(`\n📈 Summary (${result.recentPosts.length} posts):`);
      console.log(`  ❤️ Total likes: ${totalLikes}`);
      console.log(`  🔁 Total reposts: ${totalReposts}`);
      console.log(`  📊 Avg likes/post: ${result.summary.avgLikes}`);
    }

    result.scrapedAt = new Date().toISOString();

    console.log('\n📦 Full JSON:');
    console.log(JSON.stringify(result, null, 2));

    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      console.log('\n✅ Copied to clipboard!');
    } catch (e) {}
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `mode` | `'account',` | 'account' or 'post' |
| `scrapeRecentPosts` | `true` | Scrape recent posts |
| `maxPosts` | `20` | Max posts |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/YOUR_USERNAME`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeAnalytics.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeAnalytics.js) and paste it into the console.

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
| [`scripts/scrapeAnalytics.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeAnalytics.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Scrape Profile with Replies](scrape-profile-with-replies.md) | Scrape a profile's tweets AND replies |
| [Scrape Bookmarks](scrape-bookmarks.md) | Scrape all your bookmarked tweets |
| [Scrape Cashtag Search](scrape-cashtag-search.md) | Scrape cashtag search results with sentiment analysis |
| [Scrape DMs](scrape-dms.md) | Export your DM conversations |
| [Scrape Explore](scrape-explore.md) | Scrape the Explore page trends and content |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
