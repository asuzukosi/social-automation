# ✉️ Scrape DMs

Export your DM conversations. Scrapes message history with timestamps, sender info, and media attachments.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Export your DM conversations. Scrapes message history with timestamps, sender info, and media attachments.
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
1. Go to `x.com/messages`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeDMs.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeDMs.js)
4. Press Enter to run

```javascript
/**
 * DM Scraper
 * Export DM conversations (if accessible)
 * 
 * HOW TO USE:
 * 1. Go to x.com/messages
 * 2. Click on a conversation you want to export
 * 3. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 4. Paste this script and press Enter
 * 
 * NOTE: Due to Twitter's privacy protections, this can only scrape
 * visible messages on screen. Scroll through the conversation first.
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_MESSAGES: 1000,
    SCROLL_DELAY: 1000,
    FORMAT: 'json', // 'json', 'txt'
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const download = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const extractMessages = () => {
    const messages = [];
    
    // Try to find message containers
    const messageContainers = document.querySelectorAll('[data-testid="messageEntry"], [data-testid="tweetText"]');
    
    messageContainers.forEach((container, index) => {
      const text = container.textContent || '';
      if (!text.trim()) return;

      // Try to determine if sent or received based on styling/position
      const parent = container.closest('[class*="message"]') || container.parentElement;
      const isSent = parent?.style?.marginLeft === 'auto' || 
                     parent?.classList?.toString()?.includes('right') ||
                     container.closest('[data-testid="messageSent"]') !== null;

      // Try to get timestamp
      const timeEl = container.closest('[role="listitem"]')?.querySelector('time') ||
                     container.parentElement?.querySelector('time');
      const time = timeEl?.getAttribute('datetime') || timeEl?.textContent || '';

      messages.push({
        id: index,
        text: text.trim(),
        type: isSent ? 'sent' : 'received',
        time,
      });
    });

    return messages;
  };

  const getConversationInfo = () => {
    // Try to get the conversation header/name
    const header = document.querySelector('[data-testid="DM_Conversation_Avatar"]')?.closest('div')?.textContent ||
                   document.querySelector('h2[role="heading"]')?.textContent ||
                   'unknown_conversation';
    return header.replace(/[^a-z0-9]/gi, '_').slice(0, 30);
  };

  const run = async () => {
    if (!window.location.pathname.includes('/messages')) {
      console.error('❌ Please go to x.com/messages and open a conversation first!');
      return;
    }

    console.log('💬 Scraping DM conversation...');
    console.log('⚠️ Note: Only visible messages can be scraped.');
    console.log('💡 Tip: Scroll through the entire conversation first for best results.\n');

    const conversationName = getConversationInfo();
    const allMessages = new Map();
    let scrolls = 0;
    let lastCount = 0;
    let noNewCount = 0;

    // Try to scroll up to get older messages
    const messageContainer = document.querySelector('[data-testid="DM_Conversation"]') || 
                             document.querySelector('[role="main"]');

    while (allMessages.size < CONFIG.MAX_MESSAGES && noNewCount < 5) {
      const messages = extractMessages();
      const beforeCount = allMessages.size;

      messages.forEach(msg => {
        const key = `${msg.text.slice(0, 50)}_${msg.time}`;
        if (!allMessages.has(key)) {
          allMessages.set(key, msg);
        }
      });

      const added = allMessages.size - beforeCount;
      if (added > 0) {
        console.log(`💬 Collected ${allMessages.size} messages...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      // Scroll up within the message container
      if (messageContainer) {
        messageContainer.scrollTop -= 500;
      }
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 50) break;
    }

    const messageList = Array.from(allMessages.values());
    // Sort by order they appeared (approximate chronological)
    messageList.sort((a, b) => a.id - b.id);

    console.log('\n' + '='.repeat(60));
    console.log(`💬 SCRAPED ${messageList.length} MESSAGES`);
    console.log('='.repeat(60) + '\n');

    const sent = messageList.filter(m => m.type === 'sent').length;
    const received = messageList.filter(m => m.type === 'received').length;
    console.log(`📊 Stats: ${sent} sent, ${received} received`);

    // Preview
    messageList.slice(0, 5).forEach((m, i) => {
      const prefix = m.type === 'sent' ? '→' : '←';
      console.log(`${prefix} "${m.text.slice(0, 60)}..."`);
    });

    if (CONFIG.FORMAT === 'json') {
      const data = {
        conversation: conversationName,
        exportedAt: new Date().toISOString(),
        messageCount: messageList.length,
        messages: messageList,
      };
      download(JSON.stringify(data, null, 2), `dm_${conversationName}_${Date.now()}.json`, 'application/json');
      console.log('💾 Downloaded dm_conversation.json');
    }

    if (CONFIG.FORMAT === 'txt') {
      const txt = messageList.map(m => {
        const prefix = m.type === 'sent' ? '[You]' : '[Them]';
        return `${prefix} ${m.text}`;
      }).join('\n\n');
      download(txt, `dm_${conversationName}_${Date.now()}.txt`, 'text/plain');
      console.log('💾 Downloaded dm_conversation.txt');
    }

    window.scrapedDMs = { conversation: conversationName, messages: messageList };
    console.log('\n✅ Done! Access data: window.scrapedDMs');
    console.log('\n⚠️ Privacy note: Be mindful of sharing DM content.');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_MESSAGES` | `1000` | M a x  m e s s a g e s |
| `SCROLL_DELAY` | `1000` | S c r o l l  d e l a y |
| `FORMAT` | `'json',` | 'json', 'txt' |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/messages`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeDMs.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeDMs.js) and paste it into the console.

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
| [`scripts/scrapeDMs.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeDMs.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Scrape Profile with Replies](scrape-profile-with-replies.md) | Scrape a profile's tweets AND replies |
| [Scrape Analytics](scrape-analytics.md) | Scrape your account and post analytics |
| [Scrape Bookmarks](scrape-bookmarks.md) | Scrape all your bookmarked tweets |
| [Scrape Cashtag Search](scrape-cashtag-search.md) | Scrape cashtag search results with sentiment analysis |
| [Scrape Explore](scrape-explore.md) | Scrape the Explore page trends and content |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
