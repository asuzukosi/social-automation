# ❤️ Multi-Account Timeline Liker

Like the entire timeline of multiple accounts. Mass-engage with content from a list of users.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Like the entire timeline of multiple accounts. Mass-engage with content from a list of users.
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
1. Go to `x.com (any profile)`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/multiAccountTimelineLiker.js`](https://github.com/nirholas/XActions/blob/main/scripts/multiAccountTimelineLiker.js)
4. Press Enter to run

```javascript
// scripts/multiAccountTimelineLiker.js
// Like the entire timeline of multiple X accounts in sequence
// Example: like 500 posts on @nichxbt, then 500 on @doi, etc.
// Paste in DevTools console on x.com
// by nichxbt

(() => {
  'use strict';

  // =============================================
  // ⬇️ CONFIGURE YOUR TARGETS HERE
  // =============================================
  const TARGETS = [
    { username: 'nichxbt', maxLikes: 500 },
    { username: 'doi',     maxLikes: 500 },
    // Add more accounts:
    // { username: 'someUser', maxLikes: 200 },
  ];

  const CONFIG = {
    delayBetween: [2000, 5000],   // Random delay between likes (ms)
    scrollDelay: 2500,            // Pause after each scroll (ms)
    maxScrollsWithoutNew: 8,      // Stop scrolling if no new tweets found
    dryRun: false,                // true = preview mode (no clicks)
    pauseBetweenAccounts: 10000,  // 10s pause when switching accounts
  };

  // =============================================

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

  const SEL = {
    tweet:     'article[data-testid="tweet"]',
    tweetText: '[data-testid="tweetText"]',
    likeBtn:   '[data-testid="like"]',
    unlikeBtn: '[data-testid="unlike"]',
    toast:     '[data-testid="toast"]',
  };

  // ── Abort handle ───────────────────────────────────────────
  let aborted = false;
  window.XActions = window.XActions || {};
  window.XActions.stop = () => { aborted = true; console.log('🛑 Stopping after current tweet...'); };

  const isRateLimited = () => {
    for (const el of document.querySelectorAll(`${SEL.toast}, [role="alert"]`)) {
      if (/rate limit|try again|too many|slow down/i.test(el.textContent)) return true;
    }
    return false;
  };

  // ── Navigate to a user's profile ───────────────────────────
  const goToProfile = async (username) => {
    const url = `https://x.com/${username}`;
    console.log(`\n🔗 Navigating to ${url}...`);
    window.location.href = url;

    // Wait for the profile timeline to load
    let attempts = 0;
    while (attempts < 30) {
      await sleep(1000);
      const tweets = document.querySelectorAll(SEL.tweet);
      // Check we're on the right page and tweets loaded
      if (tweets.length > 0 && window.location.pathname.toLowerCase().includes(username.toLowerCase())) {
        console.log(`   ✅ Profile loaded — ${tweets.length} tweets visible`);
        return true;
      }
      attempts++;
    }
    console.log(`   ⚠️ Profile may not have loaded fully. Proceeding anyway...`);
    return true;
  };

  // ── Like timeline for one account ──────────────────────────
  const likeTimeline = async (username, maxLikes) => {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  👤 @${username} — liking up to ${maxLikes} posts`);
    console.log(`${'═'.repeat(50)}`);

    let liked = 0;
    const seen = new Set();
    let scrollsWithoutNew = 0;

    while (liked < maxLikes && !aborted) {
      const articles = document.querySelectorAll(SEL.tweet);
      let foundNew = false;

      for (const article of articles) {
        if (liked >= maxLikes || aborted) break;

        // Unique fingerprint
        const link = article.querySelector('a[href*="/status/"]')?.href || '';
        const textEl = article.querySelector(SEL.tweetText);
        const text = textEl ? textEl.textContent.trim() : '';
        const id = link || text.slice(0, 80);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        foundNew = true;

        // Already liked?
        if (article.querySelector(SEL.unlikeBtn)) {
          continue;
        }

        // Rate limit check
        if (isRateLimited()) {
          console.log('   🚨 Rate limited! Waiting 120s...');
          await sleep(120000);
          if (isRateLimited()) {
            console.log('   🛑 Still limited. Stopping this account.');
            return { username, liked, stopped: 'rate_limit' };
          }
        }

        // Scroll into view
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);

        const likeBtn = article.querySelector(SEL.likeBtn);
        if (!likeBtn) continue;

        if (CONFIG.dryRun) {
          console.log(`   🏃 [DRY] Would like: "${text.slice(0, 50)}..."`);
        } else {
          likeBtn.click();
          await sleep(400);
        }

        liked++;
        if (liked % 25 === 0 || liked === 1) {
          console.log(`   ❤️ @${username}: ${liked}/${maxLikes} liked`);
        }

        const delay = rand(CONFIG.delayBetween[0], CONFIG.delayBetween[1]);
        await sleep(delay);
      }

      if (liked >= maxLikes || aborted) break;

      // Scroll for more
      if (foundNew) {
        scrollsWithoutNew = 0;
      } else {
        scrollsWithoutNew++;
        if (scrollsWithoutNew >= CONFIG.maxScrollsWithoutNew) {
          console.log(`   ⚠️ No new tweets after ${scrollsWithoutNew} scrolls. Moving on.`);
          break;
        }
      }

      window.scrollBy(0, 1200);
      await sleep(CONFIG.scrollDelay);
    }

    return { username, liked, stopped: aborted ? 'aborted' : 'done' };
  };

  // ── Main ───────────────────────────────────────────────────
  const run = async () => {
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║  🔄 MULTI-ACCOUNT TIMELINE LIKER              ║');
    console.log('║  by nichxbt — XActions                         ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`   Accounts: ${TARGETS.map(t => `@${t.username} (${t.maxLikes})`).join(', ')}`);
    console.log(`   Dry run: ${CONFIG.dryRun}`);
    console.log(`   ℹ️ Type XActions.stop() to abort at any time\n`);

    const results = [];

    for (let i = 0; i < TARGETS.length; i++) {
      if (aborted) break;

      const { username, maxLikes } = TARGETS[i];

      // Navigate to profile
      await goToProfile(username);
      await sleep(2000); // Let page settle

      // Like their timeline
      const result = await likeTimeline(username, maxLikes);
      results.push(result);

      console.log(`\n   ✅ @${username}: ${result.liked} posts liked (${result.stopped})`);

      // Pause between accounts
      if (i < TARGETS.length - 1 && !aborted) {
        console.log(`\n   ⏳ Pausing ${CONFIG.pauseBetweenAccounts / 1000}s before next account...`);
        await sleep(CONFIG.pauseBetweenAccounts);
      }
    }

    // ── Summary ──────────────────────────────────────────────
    const total = results.reduce((sum, r) => sum + r.liked, 0);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔄 MULTI-ACCOUNT TIMELINE LIKER — RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const r of results) {
      console.log(`  👤 @${r.username}: ${r.liked} liked (${r.stopped})`);
    }
    console.log(`  ─────────────────────────────────`);
    console.log(`  ❤️  Total: ${total} posts liked`);
    if (CONFIG.dryRun) console.log('  🏃 (Dry run — nothing was liked)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  };

  // ⚠️ IMPORTANT: This script navigates between pages.
  // After navigation, the script context is lost.
  // For multi-account, we use sessionStorage to track progress.

  const STATE_KEY = 'xactions_multi_liker';

  const getState = () => {
    try { return JSON.parse(sessionStorage.getItem(STATE_KEY)); }
    catch { return null; }
  };

  const setState = (state) => {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  };

  const clearState = () => {
    sessionStorage.removeItem(STATE_KEY);
  };

  // ── Resume-aware runner ────────────────────────────────────
  // Because window.location.href kills the script, we use a
  // page-by-page approach: like one account, save state, navigate,
  // then user re-runs the script to continue.

  const runWithResume = async () => {
    let state = getState();

    if (!state) {
      // Fresh start
      state = {
        currentIndex: 0,
        results: [],
        startedAt: new Date().toISOString(),
      };
    }

    console.log('╔════════════════════════════════════════════════╗');
    console.log('║  🔄 MULTI-ACCOUNT TIMELINE LIKER              ║');
    console.log('║  by nichxbt — XActions                         ║');
    console.log('╚════════════════════════════════════════════════╝');
    console.log(`   Accounts: ${TARGETS.map(t => `@${t.username} (${t.maxLikes})`).join(', ')}`);
    console.log(`   Dry run: ${CONFIG.dryRun}`);
    console.log(`   Progress: ${state.currentIndex}/${TARGETS.length} accounts done`);
    console.log(`   ℹ️ Type XActions.stop() to abort\n`);

    if (state.currentIndex >= TARGETS.length) {
      console.log('🎉 All accounts already processed! Call clearState() or clear sessionStorage to restart.');
      clearState();
      return;
    }

    const target = TARGETS[state.currentIndex];
    const currentPath = window.location.pathname.toLowerCase();

    // Check if we're on the right profile
    if (!currentPath.startsWith(`/${target.username.toLowerCase()}`)) {
      console.log(`\n🔗 Navigate to https://x.com/${target.username} and re-run this script.`);
      console.log(`   (Or we'll navigate now — re-paste the script after the page loads)\n`);
      setState(state);
      window.location.href = `https://x.com/${target.username}`;
      return;
    }

    // We're on the right page — like away
    await sleep(2000);
    const result = await likeTimeline(target.username, target.maxLikes);
    state.results.push(result);
    state.currentIndex++;
    setState(state);

    console.log(`\n   ✅ @${target.username}: ${result.liked} posts liked`);

    if (state.currentIndex < TARGETS.length && !aborted) {
      const next = TARGETS[state.currentIndex];
      console.log(`\n   ➡️ Next: @${next.username} (${next.maxLikes} likes)`);
      console.log(`   ⏳ Navigating in ${CONFIG.pauseBetweenAccounts / 1000}s...`);
      await sleep(CONFIG.pauseBetweenAccounts);
      setState(state);
      window.location.href = `https://x.com/${next.username}`;
      console.log('\n   📋 Re-paste this script after the page loads to continue!\n');
    } else {
      // All done
      const total = state.results.reduce((sum, r) => sum + r.liked, 0);
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  🔄 MULTI-ACCOUNT TIMELINE LIKER — FINAL RESULTS');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      for (const r of state.results) {
        console.log(`  👤 @${r.username}: ${r.liked} liked (${r.stopped})`);
      }
      console.log(`  ─────────────────────────────────`);
      console.log(`  ❤️  Total: ${total} posts liked`);
      if (CONFIG.dryRun) console.log('  🏃 (Dry run — nothing was liked)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      clearState();
    }
  };

  runWithResume();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `delayBetween` | `[2000, 5000],` | Random delay between likes (ms) |
| `scrollDelay` | `2500,` | Pause after each scroll (ms) |
| `maxScrollsWithoutNew` | `8,` | Stop scrolling if no new tweets found |
| `dryRun` | `false,` | true = preview mode (no clicks) |
| `pauseBetweenAccounts` | `10000,` | 10s pause when switching accounts |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com (any profile)`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/multiAccountTimelineLiker.js`](https://github.com/nirholas/XActions/blob/main/scripts/multiAccountTimelineLiker.js) and paste it into the console.

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
| [`scripts/multiAccountTimelineLiker.js`](https://github.com/nirholas/XActions/blob/main/scripts/multiAccountTimelineLiker.js) | Main script |

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
