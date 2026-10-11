# ❤️ Keyword Liker

Like posts matching specific keywords. Enter keywords via a UI prompt and auto-like matching tweets.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Like posts matching specific keywords. Enter keywords via a UI prompt and auto-like matching tweets.
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
1. Go to `x.com/search?q=keyword`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/keywordLiker.js`](https://github.com/nirholas/XActions/blob/main/scripts/keywordLiker.js)
4. Press Enter to run

```javascript
// scripts/keywordLiker.js
// Like only posts containing specific keywords — with a prompt input box
// Paste in DevTools console on x.com/home or any feed/search page
// by nichxbt

(() => {
  'use strict';

  // =============================================
  // ⬇️ PROMPT: ask user for keywords
  // =============================================
  const input = prompt(
    '🔍 Enter keywords to match (comma-separated):\n\nExample: crypto, bitcoin, web3',
    'crypto'
  );
  if (!input) { console.log('❌ Cancelled.'); return; }

  const keywords = input.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (keywords.length === 0) { console.log('❌ No keywords provided.'); return; }

  // =============================================
  // CONFIG — adjust as needed
  // =============================================
  const CONFIG = {
    keywords,                 // From the prompt above
    maxLikes: 50,             // Stop after this many likes
    delayBetween: [2000, 5000], // Random delay between likes (ms)
    scrollRounds: 20,         // How many scroll cycles to do
    scrollDelay: 2500,        // Pause after each scroll (ms)
    dryRun: false,            // Set true to preview without actually liking
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

  const SEL = {
    tweet:     'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    likeBtn:   '[data-testid="like"]',
    unlikeBtn: '[data-testid="unlike"]',
    toast:     '[data-testid="toast"]',
  };

  const matchesKeywords = (text) => {
    const lower = text.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
  };

  const isRateLimited = () => {
    for (const el of document.querySelectorAll(`${SEL.toast}, [role="alert"]`)) {
      if (/rate limit|try again|too many|slow down/i.test(el.textContent)) return true;
    }
    return false;
  };

  let liked = 0;
  let skipped = 0;
  const seen = new Set();

  // ── Abort handle ───────────────────────────────────────────
  let aborted = false;
  window.XActions = window.XActions || {};
  window.XActions.stop = () => { aborted = true; console.log('🛑 Stopping after current tweet...'); };

  const run = async () => {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║  🔑 KEYWORD LIKER                         ║');
    console.log('║  by nichxbt — XActions                     ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`   Keywords: ${keywords.join(', ')}`);
    console.log(`   Max likes: ${CONFIG.maxLikes}`);
    console.log(`   Dry run: ${CONFIG.dryRun}`);
    console.log(`   ℹ️ Type XActions.stop() to abort early\n`);

    for (let round = 0; round < CONFIG.scrollRounds && !aborted; round++) {
      const articles = document.querySelectorAll(SEL.tweet);

      for (const article of articles) {
        if (liked >= CONFIG.maxLikes || aborted) break;

        // Unique fingerprint
        const link = article.querySelector('a[href*="/status/"]')?.href || '';
        const textEl = article.querySelector(SEL.tweetText);
        const text = textEl ? textEl.textContent.trim() : '';
        const id = link || text.slice(0, 80);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // Already liked?
        if (article.querySelector(SEL.unlikeBtn)) continue;

        // Keyword filter
        if (!matchesKeywords(text)) { skipped++; continue; }

        // Rate limit check
        if (isRateLimited()) {
          console.log('🚨 Rate limited! Waiting 120s...');
          await sleep(120000);
          if (isRateLimited()) { console.log('🛑 Still limited. Stopping.'); aborted = true; break; }
        }

        // Scroll into view
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);

        const likeBtn = article.querySelector(SEL.likeBtn);
        if (!likeBtn) continue;

        if (CONFIG.dryRun) {
          console.log(`🏃 [DRY] Would like: "${text.slice(0, 60)}..."`);
        } else {
          likeBtn.click();
          await sleep(400);
          // Verify
          if (!article.querySelector(SEL.unlikeBtn)) {
            console.log(`   ⚠️ Like may not have registered.`);
          }
        }

        liked++;
        console.log(`❤️ (${liked}/${CONFIG.maxLikes}) "${text.slice(0, 50)}..."`);

        const delay = rand(CONFIG.delayBetween[0], CONFIG.delayBetween[1]);
        await sleep(delay);
      }

      if (liked >= CONFIG.maxLikes || aborted) break;

      // Scroll for more content
      window.scrollBy(0, 1200);
      console.log(`   📜 Scroll ${round + 1}/${CONFIG.scrollRounds} — ${liked} liked, ${skipped} skipped`);
      await sleep(CONFIG.scrollDelay);
    }

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  🔑 KEYWORD LIKER RESULTS`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  ❤️  Liked:   ${liked}`);
    console.log(`  ⏭️  Skipped: ${skipped} (no keyword match)`);
    console.log(`  🔍 Keywords: ${keywords.join(', ')}`);
    if (CONFIG.dryRun) console.log('  🏃 (Dry run — nothing was liked)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxLikes` | `50,` | Stop after this many likes |
| `delayBetween` | `[2000, 5000],` | Random delay between likes (ms) |
| `scrollRounds` | `20,` | How many scroll cycles to do |
| `scrollDelay` | `2500,` | Pause after each scroll (ms) |
| `dryRun` | `false,` | Set true to preview without actually liking |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/search?q=keyword`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/keywordLiker.js`](https://github.com/nirholas/XActions/blob/main/scripts/keywordLiker.js) and paste it into the console.

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
| [`scripts/keywordLiker.js`](https://github.com/nirholas/XActions/blob/main/scripts/keywordLiker.js) | Main script |

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
