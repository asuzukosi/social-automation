# ⚡ Auto-Engage

All-in-one auto-engagement: like, reply, bookmark, and retweet matching content in a single script.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- All-in-one auto-engagement: like, reply, bookmark, and retweet matching content in a single script.
- Automate repetitive engagement tasks on X/Twitter
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
1. Go to `x.com (any page)`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/autoEngage.js`](https://github.com/nirholas/XActions/blob/main/scripts/autoEngage.js)
4. Press Enter to run

```javascript
// scripts/autoEngage.js
// Browser console script for automated engagement on X/Twitter
// Auto-like, auto-reply, bookmark management
// Paste in DevTools console on x.com/home or any feed
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // =============================================
  // CONFIGURATION
  // =============================================
  const CONFIG = {
    mode: 'like',      // 'like', 'bookmark', or 'like+bookmark'
    keywords: [],       // Filter by keywords (empty = like all visible)
    maxActions: 20,     // Maximum number of actions
    delay: 2000,        // Delay between actions (ms)
    scrollAfter: 5,     // Scroll after N actions
  };
  // =============================================

  const SELECTORS = {
    tweet: 'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    likeButton: '[data-testid="like"]',
    unlikeButton: '[data-testid="unlike"]',
    bookmarkButton: '[data-testid="bookmark"]',
    shareButton: '[data-testid="share"]',
  };

  let actionCount = 0;
  let processed = new Set();

  const matchesKeywords = (text) => {
    if (CONFIG.keywords.length === 0) return true;
    return CONFIG.keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
  };

  const likeTweet = async (tweet) => {
    const likeBtn = tweet.querySelector(SELECTORS.likeButton);
    if (likeBtn) {
      likeBtn.click();
      return true;
    }
    return false;
  };

  const bookmarkTweet = async (tweet) => {
    const shareBtn = tweet.querySelector(SELECTORS.shareButton);
    if (shareBtn) {
      shareBtn.click();
      await sleep(500);
      const bookmarkBtn = document.querySelector('[data-testid="bookmark"], [role="menuitem"]');
      if (bookmarkBtn && bookmarkBtn.textContent.toLowerCase().includes('bookmark')) {
        bookmarkBtn.click();
        return true;
      }
    }
    return false;
  };

  const run = async () => {
    console.log('⚡ XActions Auto-Engager');
    console.log('========================');
    console.log(`Mode: ${CONFIG.mode}`);
    console.log(`Max: ${CONFIG.maxActions} actions`);
    console.log(`Keywords: ${CONFIG.keywords.length ? CONFIG.keywords.join(', ') : 'all'}`);
    console.log('');

    while (actionCount < CONFIG.maxActions) {
      const tweets = document.querySelectorAll(SELECTORS.tweet);

      for (const tweet of tweets) {
        if (actionCount >= CONFIG.maxActions) break;

        // Create unique ID for tweet
        const text = tweet.querySelector(SELECTORS.tweetText)?.textContent || '';
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        const id = link || text.substring(0, 50);

        if (processed.has(id)) continue;
        processed.add(id);

        if (!matchesKeywords(text)) continue;

        // Already liked?
        if (tweet.querySelector(SELECTORS.unlikeButton)) continue;

        let success = false;

        if (CONFIG.mode === 'like' || CONFIG.mode === 'like+bookmark') {
          success = await likeTweet(tweet);
        }

        if (CONFIG.mode === 'bookmark' || CONFIG.mode === 'like+bookmark') {
          await sleep(500);
          success = await bookmarkTweet(tweet) || success;
        }

        if (success) {
          actionCount++;
          const preview = text.substring(0, 40);
          console.log(`${CONFIG.mode === 'bookmark' ? '🔖' : '❤️'} (${actionCount}/${CONFIG.maxActions}) ${preview}...`);
          await sleep(CONFIG.delay);
        }

        // Scroll periodically
        if (actionCount > 0 && actionCount % CONFIG.scrollAfter === 0) {
          window.scrollBy(0, 800);
          await sleep(1500);
        }
      }

      // Scroll for more tweets
      window.scrollBy(0, 1000);
      await sleep(2000);

      // Safety check
      if (document.querySelectorAll(SELECTORS.tweet).length === 0) {
        console.log('⚠️ No more tweets found');
        break;
      }
    }

    console.log(`\n🎉 Done! ${actionCount} actions completed.`);
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `mode` | `'like',` | 'like', 'bookmark', or 'like+bookmark' |
| `keywords` | `[],` | Filter by keywords (empty = like all visible) |
| `maxActions` | `20,` | Maximum number of actions |
| `delay` | `2000,` | Delay between actions (ms) |
| `scrollAfter` | `5,` | Scroll after N actions |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com (any page)`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/autoEngage.js`](https://github.com/nirholas/XActions/blob/main/scripts/autoEngage.js) and paste it into the console.

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
| [`scripts/autoEngage.js`](https://github.com/nirholas/XActions/blob/main/scripts/autoEngage.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Auto-Plug Replies](auto-plug-replies.md) | Automatically reply to viral tweets with your own content plug or CTA |
| [Auto-Reply](auto-reply.md) | Auto-reply to tweets matching your filters |
| [Engagement Booster](engagement-booster.md) | Systematically engage with target accounts by liking, bookmarking, and retweeting their content to build relationships |
| [Engagement Manager](engagement-manager.md) | All-in-one engagement toolkit: like, unlike, reply, bookmark, and manage interactions from a single interface |
| [Quote Tweet Automation](quote-tweet-automation.md) | Auto-retweet with quote-tweet templates |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
