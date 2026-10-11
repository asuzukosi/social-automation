// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// scripts/bulkDeleteTweets.js
// Browser console script for bulk deleting tweets with filters
// Paste in DevTools console on x.com/YOUR_USERNAME (your profile)
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // =============================================
  // CONFIGURATION
  // =============================================
  const CONFIG = {
    maxDeletes: 10,
    filters: {
      olderThanDays: 0,       // 0 = ignore; delete tweets older than N days
      containsKeywords: [],   // Delete if text contains ANY of these (empty = all)
      onlyRetweets: false,    // Only delete retweets
      onlyReplies: false,     // Only delete replies
    },
    dryRun: false,            // false = tweets are PERMANENTLY deleted. true = preview only.
    delay: 5000,              // Between deletions. X throttles bursts, so keep this unhurried.
    scrollDelay: 4000,        // After each scroll, to let the next page of posts render
    menuDelay: 1200,          // Wait after opening / clicking through a post's menu
    maxScrolls: 50,
  };
  // =============================================

  const download = (data, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log(`📥 Downloaded: ${filename}`);
  };

  const parseCount = (str) => {
    if (!str) return 0;
    const m = str.replace(/,/g, '').match(/([\d.]+)\s*([KMBkmb])?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (m[2]) n *= { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1;
    return Math.round(n);
  };

  const run = async () => {
    console.log('🗑️ BULK DELETE TWEETS — XActions by nichxbt');
    console.log(CONFIG.dryRun ? '🔍 DRY RUN — preview only' : '⚠️ LIVE MODE — tweets WILL be deleted!');

    // Live mode deletes for real, so give the run a stoppable head start.
    if (!CONFIG.dryRun) {
      for (let i = 5; i > 0; i--) {
        console.warn(`⚠️ Starting in ${i}s. Reload the page now to stop.`);
        await sleep(1000);
      }
    }

    // Accept the profile itself and its tabs (/with_replies, /media, ...); a
    // feed, a single status, or a reserved section is not a profile timeline.
    const PROFILE_TABS = ['with_replies', 'media', 'likes', 'highlights', 'articles', 'superfollows', 'affiliates'];
    const RESERVED = ['home', 'explore', 'notifications', 'messages', 'i', 'search', 'settings', 'compose',
      'hashtag', 'bookmarks', 'lists', 'topics', 'communities', 'jobs'];
    const pathMatch = window.location.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:\/([A-Za-z0-9_]+))?\/?$/);
    const pathUser = pathMatch && !RESERVED.includes(pathMatch[1].toLowerCase()) ? pathMatch[1] : null;
    const onProfile = Boolean(pathUser) && (!pathMatch[2] || PROFILE_TABS.includes(pathMatch[2].toLowerCase()));

    const navHref = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href') || '';
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')?.textContent || '';
    const ownHandle = (navHref.match(/^\/([A-Za-z0-9_]{1,15})$/) || switcher.match(/@([A-Za-z0-9_]{1,15})/) || [])[1] || null;

    if (!onProfile) {
      console.error(ownHandle
        ? `❌ Run this on your profile timeline: https://x.com/${ownHandle}`
        : '❌ Run this on your profile timeline (x.com/YOUR_USERNAME)');
      return;
    }
    if (ownHandle && pathUser.toLowerCase() !== ownHandle.toLowerCase()) {
      console.error(`❌ This is @${pathUser}'s profile. You can only delete your own posts: https://x.com/${ownHandle}`);
      return;
    }

    const profileUser = ownHandle || pathUser;
    console.log(`👤 Profile: @${profileUser}`);

    const f = CONFIG.filters;
    const cutoff = f.olderThanDays > 0 ? new Date(Date.now() - f.olderThanDays * 86400000) : null;
    if (cutoff) console.log(`📅 Deleting tweets older than ${f.olderThanDays} days`);
    if (f.containsKeywords.length) console.log(`🔑 Keywords: ${f.containsKeywords.join(', ')}`);
    if (f.onlyRetweets) console.log('🔄 Retweets only'); if (f.onlyReplies) console.log('💬 Replies only');

    const processed = new Set();
    const deletedLog = [];
    let deleted = 0;
    let errors = 0;

    for (let scroll = 0; scroll < CONFIG.maxScrolls; scroll++) {
      if (deleted >= CONFIG.maxDeletes) break;

      const articles = document.querySelectorAll('article[data-testid="tweet"]');

      for (const article of articles) {
        if (deleted >= CONFIG.maxDeletes) break;

        const tweetLink = article.querySelector('a[href*="/status/"]');
        const tweetId = tweetLink?.getAttribute('href')?.split('/status/')[1]?.split(/[?/]/)[0];
        if (!tweetId || processed.has(tweetId)) continue;
        processed.add(tweetId);

        const text = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
        const timeEl = article.querySelector('time');
        const timestamp = timeEl?.getAttribute('datetime') || '';
        const isRetweet = /reposted/i.test(article.querySelector('[data-testid="socialContext"]')?.textContent || '');
        const isReply = text.startsWith('@');
        const isPinned = /pinned/i.test(article.querySelector('[data-testid="socialContext"]')?.textContent || '');
        const likeBtn = article.querySelector('[data-testid="like"], [data-testid="unlike"]');
        const likes = parseCount(likeBtn?.getAttribute('aria-label')?.match(/([\d,.]+[KMBkmb]?)/)?.[1] || '0');

        // Skip pinned
        if (isPinned) continue;

        // Check owner
        const authorLink = article.querySelector(`a[href="/${profileUser}" i]`);
        if (!authorLink && !isRetweet) continue;

        // Filter: older than
        if (cutoff && timestamp && new Date(timestamp) > cutoff) continue;

        // Filter: keywords
        if (f.containsKeywords.length > 0) {
          const lower = text.toLowerCase();
          if (!f.containsKeywords.some(kw => lower.includes(kw.toLowerCase()))) continue;
        }

        // Filter: type
        if (f.onlyRetweets && !isRetweet) continue;
        if (f.onlyReplies && !isReply) continue;

        const preview = text.slice(0, 60).replace(/\n/g, ' ');

        if (CONFIG.dryRun) {
          console.log(`🔍 Would delete: "${preview}..." (❤️${likes})`);
          deletedLog.push({ tweetId, text: text.slice(0, 200), likes, timestamp, dryRun: true });
          deleted++;
          continue;
        }

        try {
          const caret = article.querySelector('[data-testid="caret"]');
          if (!caret) continue;

          caret.scrollIntoView({ block: 'center' });
          await sleep(400);
          caret.click();
          await sleep(CONFIG.menuDelay);

          const menuItems = document.querySelectorAll('[role="menuitem"]');
          let deleteBtn = null;
          for (const item of menuItems) {
            if (/delete/i.test(item.textContent)) { deleteBtn = item; break; }
            if (/undo repost/i.test(item.textContent)) { deleteBtn = item; break; }
          }

          if (!deleteBtn) {
            document.body.click();
            await sleep(600);
            continue;
          }

          deleteBtn.click();
          await sleep(CONFIG.menuDelay);

          const confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (confirm) {
            confirm.click();
            deleted++;
            deletedLog.push({ tweetId, text: text.slice(0, 200), likes, timestamp });
            console.log(`🗑️ #${deleted}: Deleted "${preview}..." (❤️${likes})`);
            await sleep(CONFIG.delay);
          }
        } catch (e) {
          errors++;
          document.body.click();
          await sleep(1500);
        }
      }

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(CONFIG.scrollDelay);
    }

    console.log(`\n✅ Done! Deleted: ${deleted} | Skipped: ${processed.size - deleted} | Errors: ${errors}`);
    console.log(`🔍 Dry run: ${CONFIG.dryRun}`);

    if (deletedLog.length > 0) {
      download(
        { stats: { deleted, errors, dryRun: CONFIG.dryRun }, tweets: deletedLog },
        `xactions-deleted-tweets-${new Date().toISOString().slice(0, 10)}.json`
      );
    }

    if (CONFIG.dryRun && deleted > 0) {
      console.log(`\n⚡ Set dryRun = false and re-run to actually delete ${deleted} tweets.`);
    }
  };

  run();
})();
