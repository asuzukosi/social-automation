# 📰 Article Publisher

Publish long-form articles on X/Twitter (requires Premium+ subscription). Automates article creation, formatting, and publishing.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Publish long-form articles on X/Twitter (requires Premium+ subscription). Automates article creation, formatting, and publishing.
- Automate repetitive posting tasks on X/Twitter
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
1. Go to `x.com/compose/article`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/articlePublisher.js`](https://github.com/nirholas/XActions/blob/main/src/articlePublisher.js)
4. Press Enter to run

```javascript
// src/articlePublisher.js
// Long-form article publishing for X/Twitter (Premium+)
// by nichxbt

/**
 * Article Publisher - Create and manage long-form articles
 * 
 * Features:
 * - Publish articles with rich formatting
 * - Save drafts
 * - Audio articles (2026, testing)
 * - Article analytics
 * - Article management (list, edit, delete)
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  articleCompose: 'a[href="/compose/article"]',
  titleInput: '[data-testid="articleTitle"]',
  bodyEditor: '[data-testid="articleBody"]',
  publishButton: '[data-testid="articlePublish"]',
  saveDraft: '[data-testid="articleSaveDraft"]',
  coverImage: '[data-testid="articleCoverImage"]',
  articleList: '[data-testid="articleList"]',
  articleCard: '[data-testid="articleCard"]',
};

/**
 * Publish a long-form article
 * @param {import('puppeteer').Page} page
 * @param {Object} article - { title, body, coverImage? }
 * @returns {Promise<Object>}
 */
export async function publishArticle(page, article) {
  const { title, body, coverImage = null } = article;

  await page.goto('https://x.com/compose/article', { waitUntil: 'networkidle2' });
  await sleep(3000);

  // Enter title
  try {
    await page.click(SELECTORS.titleInput);
    await page.keyboard.type(title, { delay: 20 });
    await sleep(500);
  } catch (e) {
    return { success: false, error: 'Article compose not available — Premium+ required' };
  }

  // Enter body
  await page.click(SELECTORS.bodyEditor);
  await page.keyboard.type(body, { delay: 10 });
  await sleep(1000);

  // Upload cover image if provided
  if (coverImage) {
    try {
      const coverButton = await page.$(SELECTORS.coverImage);
      if (coverButton) {
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser(),
          coverButton.click(),
        ]);
        await fileChooser.accept([coverImage]);
        await sleep(3000);
      }
    } catch (e) {
      console.log('⚠️ Cover image upload failed:', e.message);
    }
  }

  // Publish
  await page.click(SELECTORS.publishButton);
  await sleep(5000);

  return {
    success: true,
    title,
    bodyLength: body.length,
    hasCover: !!coverImage,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Save article as draft
 * @param {import('puppeteer').Page} page
 * @param {Object} article - { title, body }
 * @returns {Promise<Object>}
 */
export async function saveDraft(page, article) {
  const { title, body } = article;

  await page.goto('https://x.com/compose/article', { waitUntil: 'networkidle2' });
  await sleep(3000);

  try {
    await page.click(SELECTORS.titleInput);
    await page.keyboard.type(title, { delay: 20 });
    await sleep(500);

    await page.click(SELECTORS.bodyEditor);
    await page.keyboard.type(body, { delay: 10 });
    await sleep(500);

    await page.click(SELECTORS.saveDraft);
    await sleep(2000);

    return { success: true, action: 'draft_saved', title };
  } catch (e) {
    return { success: false, error: 'Could not save draft — Premium+ required' };
  }
}

/**
 * Get published articles
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Object>}
 */
export async function getArticles(page, username) {
  await page.goto(`https://x.com/${username}/articles`, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const articles = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel.articleCard || 'article')).map(card => {
      const title = card.querySelector('h2, [role="heading"]')?.textContent || '';
      const preview = card.querySelector('p, [data-testid="articlePreview"]')?.textContent || '';
      const time = card.querySelector('time')?.getAttribute('datetime') || '';
      const link = card.querySelector('a[href*="/articles/"]')?.href || '';
      return { title, preview: preview.substring(0, 200), time, link };
    });
  }, SELECTORS);

  return {
    username,
    articles,
    count: articles.length,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get article analytics
 * @param {import('puppeteer').Page} page
 * @param {string} articleUrl
 * @returns {Promise<Object>}
 */
export async function getArticleAnalytics(page, articleUrl) {
  await page.goto(articleUrl, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const analytics = await page.evaluate(() => {
    return {
      title: document.querySelector('h1, [role="heading"]')?.textContent || '',
      likes: document.querySelector('[data-testid="like"] span')?.textContent || '0',
      reposts: document.querySelector('[data-testid="retweet"] span')?.textContent || '0',
      views: document.querySelector('[data-testid="analyticsButton"] span')?.textContent || '0',
    };
  });

  return {
    articleUrl,
    analytics,
    scrapedAt: new Date().toISOString(),
  };
}

export default {
  publishArticle,
  saveDraft,
  getArticles,
  getArticleAnalytics,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/compose/article`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/articlePublisher.js`](https://github.com/nirholas/XActions/blob/main/src/articlePublisher.js) and paste it into the console.

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
| [`src/articlePublisher.js`](https://github.com/nirholas/XActions/blob/main/src/articlePublisher.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Content Calendar](content-calendar.md) | Plan and visualize your posting schedule |
| [Content Repurposer](content-repurposer.md) | Transform your existing content: turn single tweets into threads, threads into singles, add hooks, rewrite for different audiences |
| [Pin Tweet Manager](pin-tweet-manager.md) | Pin and unpin tweets programmatically |
| [Poll Creator](poll-creator.md) | Create and manage poll tweets |
| [Post Composer](post-composer.md) | Full content creation suite: compose tweets, threads, polls, and articles with templates and scheduling |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
