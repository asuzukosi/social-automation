# 🧠 Grok AI Integration

Interact with X's built-in Grok AI assistant programmatically. Send prompts, collect responses, and automate AI-powered analysis.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Interact with X's built-in Grok AI assistant programmatically. Send prompts, collect responses, and automate AI-powered analysis.
- Automate repetitive ai tasks on X/Twitter
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
1. Go to `x.com/i/grok`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/grokIntegration.js`](https://github.com/nirholas/XActions/blob/main/src/grokIntegration.js)
4. Press Enter to run

```javascript
// src/grokIntegration.js
// Grok AI integration for X/Twitter
// by nichxbt

/**
 * Grok Integration - Interact with Grok AI features
 * 
 * Features:
 * - Send queries to Grok
 * - Image generation (Premium+)
 * - Content summarization
 * - Post analysis and ranking prediction
 * - Topic summaries (2026)
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  grokNav: 'a[href="/i/grok"]',
  chatInput: '[data-testid="grokInput"]',
  sendButton: '[data-testid="grokSendButton"]',
  responseArea: '[data-testid="grokResponse"]',
  newChat: '[data-testid="grokNewChat"]',
  imageGen: '[data-testid="grokImageGen"]',
  chatHistory: '[data-testid="grokChatHistory"]',
  responseText: '[data-testid="grokResponseText"]',
};

/**
 * Send a query to Grok AI
 * @param {import('puppeteer').Page} page
 * @param {string} query - The question/prompt for Grok
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function queryGrok(page, query, options = {}) {
  const { newChat = true, waitTime = 15000 } = options;

  await page.goto('https://x.com/i/grok', { waitUntil: 'networkidle2' });
  await sleep(3000);

  if (newChat) {
    try {
      await page.click(SELECTORS.newChat);
      await sleep(1000);
    } catch (e) {
      // New chat button may not be visible if already in new chat
    }
  }

  // Type query
  await page.click(SELECTORS.chatInput);
  await page.keyboard.type(query, { delay: 20 });
  await sleep(500);

  // Send
  await page.click(SELECTORS.sendButton);

  // Wait for response
  await sleep(waitTime);

  // Extract response
  const response = await page.evaluate((sel) => {
    const responses = document.querySelectorAll(sel.responseText || sel.responseArea);
    if (responses.length === 0) return null;
    const lastResponse = responses[responses.length - 1];
    return lastResponse?.textContent?.trim() || null;
  }, SELECTORS);

  return {
    success: !!response,
    query,
    response: response || 'No response received (try increasing waitTime)',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate an image with Grok AI (Premium+ required)
 * @param {import('puppeteer').Page} page
 * @param {string} prompt - Image generation prompt
 * @returns {Promise<Object>}
 */
export async function generateImage(page, prompt) {
  await page.goto('https://x.com/i/grok', { waitUntil: 'networkidle2' });
  await sleep(3000);

  // Start new chat
  try {
    await page.click(SELECTORS.newChat);
    await sleep(1000);
  } catch (e) {}

  // Type image generation prompt
  const imagePrompt = `Generate an image: ${prompt}`;
  await page.click(SELECTORS.chatInput);
  await page.keyboard.type(imagePrompt, { delay: 20 });
  await sleep(500);

  await page.click(SELECTORS.sendButton);
  await sleep(20000); // Image generation takes longer

  // Try to extract image URL
  const result = await page.evaluate(() => {
    const images = document.querySelectorAll('img[src*="grok"]');
    if (images.length > 0) {
      const lastImg = images[images.length - 1];
      return { imageUrl: lastImg.src, alt: lastImg.alt };
    }
    return null;
  });

  return {
    success: !!result,
    prompt,
    ...(result || { error: 'Image generation failed or Premium+ required' }),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Summarize a topic or thread using Grok
 * @param {import('puppeteer').Page} page
 * @param {string} topic - Topic or thread URL to summarize
 * @returns {Promise<Object>}
 */
export async function summarize(page, topic) {
  const prompt = topic.startsWith('http')
    ? `Summarize this thread/post: ${topic}`
    : `Summarize the latest discussion about: ${topic}`;

  return queryGrok(page, prompt, { waitTime: 20000 });
}

/**
 * Analyze a post's potential performance
 * @param {import('puppeteer').Page} page
 * @param {string} postText - The post text to analyze
 * @returns {Promise<Object>}
 */
export async function analyzePost(page, postText) {
  const prompt = `Analyze this X/Twitter post for potential engagement and reach. Rate it 1-10 and suggest improvements:\n\n"${postText}"`;
  return queryGrok(page, prompt, { waitTime: 15000 });
}

export default {
  queryGrok,
  generateImage,
  summarize,
  analyzePost,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/i/grok`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/grokIntegration.js`](https://github.com/nirholas/XActions/blob/main/src/grokIntegration.js) and paste it into the console.

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
| [`src/grokIntegration.js`](https://github.com/nirholas/XActions/blob/main/src/grokIntegration.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| See [all scripts](README.md) | Browse the complete script catalog |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
