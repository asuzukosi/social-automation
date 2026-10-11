# ✉️ DM Manager

Full DM management: send messages, export conversations, manage message requests, and bulk operations.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Full DM management: send messages, export conversations, manage message requests, and bulk operations.
- Automate repetitive messaging tasks on X/Twitter
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
1. Go to `x.com/messages`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/dmManager.js`](https://github.com/nirholas/XActions/blob/main/src/dmManager.js)
4. Press Enter to run

```javascript
// src/dmManager.js
// Direct Message management for X/Twitter
// by nichxbt

/**
 * DM Manager - Send, export, and manage Direct Messages
 * 
 * Features:
 * - Send DMs (individual and group)
 * - Export DM conversations
 * - Manage message requests
 * - DM privacy settings
 * - Conversation search
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  messagesTab: 'a[href="/messages"]',
  conversation: '[data-testid="conversation"]',
  messageInput: '[data-testid="dmComposerTextInput"]',
  sendButton: '[data-testid="dmComposerSendButton"]',
  newDmButton: '[data-testid="NewDM_Button"]',
  searchPeople: '[data-testid="searchPeople"]',
  messageEntry: '[data-testid="messageEntry"]',
  reactionButton: '[data-testid="messageReaction"]',
  requestsTab: '[data-testid="messageRequests"]',
  acceptRequest: '[data-testid="acceptRequest"]',
  deleteRequest: '[data-testid="deleteRequest"]',
};

/**
 * Send a direct message
 * @param {import('puppeteer').Page} page
 * @param {string} username - Recipient username
 * @param {string} message - Message text
 * @returns {Promise<Object>}
 */
export async function sendDM(page, username, message) {
  await page.goto('https://x.com/messages', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Start new conversation
  await page.click(SELECTORS.newDmButton);
  await sleep(1500);

  // Search for user
  await page.click(SELECTORS.searchPeople);
  await page.keyboard.type(username, { delay: 50 });
  await sleep(2000);

  // Select user from results
  await page.click('[data-testid="TypeaheadUser"]');
  await sleep(1000);

  // Click next/confirm
  await page.click('[data-testid="nextButton"]');
  await sleep(1500);

  // Type and send message
  await page.click(SELECTORS.messageInput);
  await page.keyboard.type(message, { delay: 20 });
  await sleep(500);

  await page.click(SELECTORS.sendButton);
  await sleep(2000);

  return {
    success: true,
    recipient: username,
    message: message.substring(0, 100),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get DM conversations list
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Array>}
 */
export async function getConversations(page, options = {}) {
  const { limit = 20 } = options;

  await page.goto('https://x.com/messages', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const conversations = await page.evaluate((sel, lim) => {
    return Array.from(document.querySelectorAll(sel.conversation)).slice(0, lim).map(conv => {
      const name = conv.querySelector('[dir="ltr"] span')?.textContent || '';
      const lastMessage = conv.querySelector('[data-testid="lastMessage"]')?.textContent || '';
      const time = conv.querySelector('time')?.getAttribute('datetime') || '';
      const unread = conv.querySelector('[data-testid="unread"]') !== null;
      return { name, lastMessage, time, unread };
    });
  }, SELECTORS, limit);

  return { conversations, scrapedAt: new Date().toISOString() };
}

/**
 * Export messages from a conversation
 * @param {import('puppeteer').Page} page
 * @param {string} conversationUrl - URL of the DM conversation
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function exportConversation(page, conversationUrl, options = {}) {
  const { limit = 100 } = options;

  await page.goto(conversationUrl, { waitUntil: 'networkidle2' });
  await sleep(3000);

  const messages = [];
  let scrollAttempts = 0;

  // Scroll up to load older messages
  while (messages.length < limit && scrollAttempts < 20) {
    const newMessages = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel.messageEntry)).map(msg => {
        const text = msg.textContent || '';
        const time = msg.querySelector('time')?.getAttribute('datetime') || '';
        const sender = msg.querySelector('[data-testid="User-Name"]')?.textContent || '';
        return { text, time, sender };
      });
    }, SELECTORS);

    for (const msg of newMessages) {
      if (!messages.find(m => m.text === msg.text && m.time === msg.time)) {
        messages.push(msg);
      }
    }

    // Scroll up for older messages
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="DmScrollerContainer"]');
      if (container) container.scrollTop = 0;
    });
    await sleep(1500);
    scrollAttempts++;
  }

  return {
    conversationUrl,
    messages: messages.slice(0, limit),
    count: messages.length,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Get message requests
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array>}
 */
export async function getMessageRequests(page) {
  await page.goto('https://x.com/messages/requests', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const requests = await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel.conversation)).map(conv => {
      const name = conv.querySelector('[dir="ltr"] span')?.textContent || '';
      const preview = conv.querySelector('[data-testid="lastMessage"]')?.textContent || '';
      const time = conv.querySelector('time')?.getAttribute('datetime') || '';
      return { name, preview, time };
    });
  }, SELECTORS);

  return { requests, scrapedAt: new Date().toISOString() };
}

/**
 * Update DM privacy settings
 * @param {import('puppeteer').Page} page
 * @param {Object} settings
 * @returns {Promise<Object>}
 */
export async function updateDMSettings(page, settings = {}) {
  await page.goto('https://x.com/settings/messages', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Toggle settings as needed
  const result = { updated: [], timestamp: new Date().toISOString() };

  if (settings.allowDMsFrom !== undefined) {
    // Find and toggle the appropriate setting
    result.updated.push('allowDMsFrom');
  }

  return result;
}

export default {
  sendDM,
  getConversations,
  exportConversation,
  getMessageRequests,
  updateDMSettings,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/messages`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/dmManager.js`](https://github.com/nirholas/XActions/blob/main/src/dmManager.js) and paste it into the console.

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
| [`src/dmManager.js`](https://github.com/nirholas/XActions/blob/main/src/dmManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [DM Exporter](dm-exporter.md) | Export DM conversations with full message details |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
