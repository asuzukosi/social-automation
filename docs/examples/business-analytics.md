# 💼 Business Analytics

Brand monitoring and sentiment analysis for businesses. Track mentions, engagement trends, and audience sentiment.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Brand monitoring and sentiment analysis for businesses. Track mentions, engagement trends, and audience sentiment.
- Automate repetitive business tasks on X/Twitter
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
3. Copy and paste the script from [`scripts/businessAnalytics.js`](https://github.com/nirholas/XActions/blob/main/scripts/businessAnalytics.js)
4. Press Enter to run

```javascript
// scripts/businessAnalytics.js
// Browser console script for X/Twitter business analytics and brand monitoring
// Paste in DevTools console on x.com or business.x.com
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // =============================================
  // CONFIGURE BRAND MONITORING
  // =============================================
  const CONFIG = {
    brand: '',          // e.g., 'XActions' or '@nichxbt' — empty scrapes current page
    maxMentions: 50,
    includeSentiment: true,
  };
  // =============================================

  const positiveWords = ['love', 'great', 'amazing', 'awesome', 'excellent', 'best', 'good', 'fantastic', 'incredible', 'perfect', '🔥', '❤️', '👏', '💯', '🚀'];
  const negativeWords = ['hate', 'terrible', 'worst', 'bad', 'awful', 'horrible', 'scam', 'broken', 'trash', 'garbage', '💩', '👎', '🤮'];

  const analyzeSentiment = (text) => {
    const lower = text.toLowerCase();
    let score = 0;
    positiveWords.forEach(w => { if (lower.includes(w)) score++; });
    negativeWords.forEach(w => { if (lower.includes(w)) score--; });
    if (score > 0) return 'positive';
    if (score < 0) return 'negative';
    return 'neutral';
  };

  const run = async () => {
    console.log('💼 XActions Business Analytics');
    console.log('==============================');

    // If brand is specified, search for it
    if (CONFIG.brand) {
      console.log(`🔍 Monitoring brand: "${CONFIG.brand}"`);
      window.location.href = `https://x.com/search?q=${encodeURIComponent(CONFIG.brand)}&f=live`;
      await sleep(5000);
    }

    const mentions = [];
    let scrollAttempts = 0;

    while (mentions.length < CONFIG.maxMentions && scrollAttempts < Math.ceil(CONFIG.maxMentions / 3)) {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(tweet => {
        const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
        const author = tweet.querySelector('[data-testid="User-Name"] a')?.textContent || '';
        const handle = tweet.querySelector('[data-testid="User-Name"] a[tabindex="-1"]')?.textContent || '';
        const time = tweet.querySelector('time')?.getAttribute('datetime') || '';
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        const likes = tweet.querySelector('[data-testid="like"] span')?.textContent || '0';
        const reposts = tweet.querySelector('[data-testid="retweet"] span')?.textContent || '0';
        const isVerified = !!tweet.querySelector('[data-testid="icon-verified"]');

        if (link && !mentions.find(m => m.link === link)) {
          mentions.push({
            text: text.substring(0, 300),
            author,
            handle,
            time,
            link,
            likes,
            reposts,
            isVerified,
            sentiment: CONFIG.includeSentiment ? analyzeSentiment(text) : undefined,
          });
        }
      });

      window.scrollBy(0, 1000);
      await sleep(1500);
      scrollAttempts++;
    }

    // Analysis
    const sentimentBreakdown = {
      positive: mentions.filter(m => m.sentiment === 'positive').length,
      negative: mentions.filter(m => m.sentiment === 'negative').length,
      neutral: mentions.filter(m => m.sentiment === 'neutral').length,
    };

    const verifiedMentions = mentions.filter(m => m.isVerified).length;
    const topMentions = [...mentions].sort((a, b) =>
      (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0)
    ).slice(0, 5);

    console.log(`\n📊 Brand Analysis (${mentions.length} mentions):`);
    console.log(`  😊 Positive: ${sentimentBreakdown.positive}`);
    console.log(`  😐 Neutral: ${sentimentBreakdown.neutral}`);
    console.log(`  😞 Negative: ${sentimentBreakdown.negative}`);
    console.log(`  ✅ From verified accounts: ${verifiedMentions}`);
    
    console.log('\n🏆 Top mentions by likes:');
    topMentions.forEach((m, i) => {
      console.log(`  ${i + 1}. @${m.handle} (${m.likes} likes): ${m.text.substring(0, 50)}...`);
    });

    const result = {
      brand: CONFIG.brand || window.location.href,
      mentions,
      analysis: {
        sentiment: sentimentBreakdown,
        verifiedMentions,
        topMentions,
        totalEngagement: mentions.reduce((s, m) => s + (parseInt(m.likes) || 0) + (parseInt(m.reposts) || 0), 0),
      },
      scrapedAt: new Date().toISOString(),
    };

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
| `brand` | `'',` | e.g., 'XActions' or '@nichxbt' — empty scrapes current page |
| `maxMentions` | `50` | Max mentions |
| `includeSentiment` | `true` | Include sentiment |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com (any page)`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/businessAnalytics.js`](https://github.com/nirholas/XActions/blob/main/scripts/businessAnalytics.js) and paste it into the console.

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
| [`scripts/businessAnalytics.js`](https://github.com/nirholas/XActions/blob/main/scripts/businessAnalytics.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Business Tools](business-tools.md) | Brand monitoring, competitor analysis, and audience insights for business accounts |
| [Creator Studio](creator-studio.md) | Creator analytics dashboard: track subscriptions, tips, Super Follows revenue, and audience growth metrics |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
