# 📤 DM Exporter

Export DM conversations with full message details. Includes timestamps, read receipts, and media links.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Export DM conversations with full message details. Includes timestamps, read receipts, and media links.
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
3. Copy and paste the script from [`scripts/dmExporter.js`](https://github.com/nirholas/XActions/blob/main/scripts/dmExporter.js)
4. Press Enter to run

```javascript
// scripts/dmExporter.js
// Browser console script to export X/Twitter DM conversations
// Paste in DevTools console on x.com/messages
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const CONFIG = {
    maxConversations: 20,   // Max conversations to list
    exportMessages: false,  // Set true to export messages from first conversation
    maxMessages: 100,       // Max messages per conversation
  };

  const run = async () => {
    console.log('✉️ XActions DM Exporter');
    console.log('======================');

    // Scrape conversation list
    const conversations = [];
    document.querySelectorAll('[data-testid="conversation"]').forEach((conv, i) => {
      if (i >= CONFIG.maxConversations) return;
      
      const name = conv.querySelector('[dir="ltr"]')?.textContent || '';
      const lastMsg = conv.querySelector('[data-testid="lastMessage"]')?.textContent || 
                      conv.querySelectorAll('span')[conv.querySelectorAll('span').length - 1]?.textContent || '';
      const time = conv.querySelector('time')?.getAttribute('datetime') || '';
      const unread = !!conv.querySelector('[data-testid="unread"]');

      conversations.push({
        index: i + 1,
        name: name.trim(),
        lastMessage: lastMsg.trim().substring(0, 100),
        time,
        unread,
      });
    });

    console.log(`\n📬 Found ${conversations.length} conversations:`);
    conversations.forEach(c => {
      const badge = c.unread ? '🔴' : '⚪';
      console.log(`  ${badge} ${c.index}. ${c.name} — ${c.lastMessage.substring(0, 40)}...`);
    });

    // Export messages from current conversation if enabled
    let messages = [];
    if (CONFIG.exportMessages) {
      console.log('\n📜 Exporting messages from current conversation...');

      // Click the first conversation if not already in one
      const firstConv = document.querySelector('[data-testid="conversation"]');
      if (firstConv) {
        firstConv.click();
        await sleep(2000);
      }

      let scrollAttempts = 0;
      while (messages.length < CONFIG.maxMessages && scrollAttempts < 30) {
        document.querySelectorAll('[data-testid="messageEntry"], [data-testid="tweetText"]').forEach(msg => {
          const text = msg.textContent?.trim() || '';
          const time = msg.closest('[data-testid]')?.querySelector('time')?.getAttribute('datetime') || '';
          const id = text.substring(0, 50) + time;

          if (text && !messages.find(m => m.id === id)) {
            messages.push({ id, text, time });
          }
        });

        // Scroll up for older messages
        const container = document.querySelector('[data-testid="DmScrollerContainer"]') ||
                          document.querySelector('[data-testid="DMConversation"]') ||
                          document.querySelector('[role="main"]');
        if (container) {
          container.scrollTop = Math.max(0, container.scrollTop - 500);
        }
        await sleep(1500);
        scrollAttempts++;
      }

      // Clean IDs from output
      messages = messages.map(({ id, ...rest }) => rest);
      console.log(`  Found ${messages.length} messages`);
    }

    const result = {
      conversations,
      messages: CONFIG.exportMessages ? messages : 'Set CONFIG.exportMessages = true to export',
      scrapedAt: new Date().toISOString(),
    };

    console.log('\n📦 Full JSON:');
    console.log(JSON.stringify(result, null, 2));

    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      console.log('\n✅ Copied to clipboard!');
    } catch (e) {
      console.log('\n⚠️ Could not copy to clipboard.');
    }
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `maxConversations` | `20,` | Max conversations to list |
| `exportMessages` | `false,` | Set true to export messages from first conversation |
| `maxMessages` | `100,` | Max messages per conversation |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/messages`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/dmExporter.js`](https://github.com/nirholas/XActions/blob/main/scripts/dmExporter.js) and paste it into the console.

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
| [`scripts/dmExporter.js`](https://github.com/nirholas/XActions/blob/main/scripts/dmExporter.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [DM Manager](dm-manager.md) | Full DM management: send messages, export conversations, manage message requests, and bulk operations |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
