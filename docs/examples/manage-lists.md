# 📝 Manage Lists

Manage X Lists: create, edit, delete lists and add/remove members in bulk.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Manage X Lists: create, edit, delete lists and add/remove members in bulk.
- Automate repetitive lists tasks on X/Twitter
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
1. Go to `x.com/YOUR_USERNAME/lists`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/manageLists.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageLists.js)
4. Press Enter to run

```javascript
// scripts/manageLists.js
// Browser console script to manage X/Twitter Lists
// Paste in DevTools console on x.com/i/lists
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const extractBio = (cell) => {
    const testId = cell.querySelector('[data-testid="UserDescription"]');
    if (testId?.textContent?.trim()) return testId.textContent.trim();
    const autoDir = cell.querySelector('[dir="auto"]:not([data-testid])');
    const text = autoDir?.textContent?.trim();
    if (text && text.length >= 10 && !text.startsWith('@')) return text;
    return '';
  };

  const CONFIG = {
    action: 'export', // 'export' or 'export_members'
    maxLists: 50,
    maxMembers: 100,
  };

  const exportLists = async () => {
    console.log('📋 Exporting lists...');

    const lists = [];
    let scrollAttempts = 0;

    while (lists.length < CONFIG.maxLists && scrollAttempts < 10) {
      document.querySelectorAll('[data-testid="listItem"], a[href*="/lists/"]').forEach(el => {
        const name = el.querySelector('[dir="ltr"]')?.textContent || el.textContent?.trim() || '';
        const link = el.href || el.querySelector('a')?.href || '';
        const description = el.querySelector('[data-testid="listDescription"]')?.textContent || '';
        const memberCount = el.querySelector('[data-testid="memberCount"]')?.textContent || '';

        if (name && link && !lists.find(l => l.link === link)) {
          lists.push({
            name: name.trim().substring(0, 100),
            link,
            description: description.trim(),
            memberCount,
          });
        }
      });

      window.scrollBy(0, 800);
      await sleep(1500);
      scrollAttempts++;
    }

    console.log(`  Found ${lists.length} lists`);
    lists.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.name} ${l.memberCount ? `(${l.memberCount} members)` : ''}`);
    });

    return lists;
  };

  const exportListMembers = async () => {
    console.log('👥 Exporting list members from current list...');
    console.log('   (Navigate to a specific list first)');

    const members = [];
    let scrollAttempts = 0;

    while (members.length < CONFIG.maxMembers && scrollAttempts < Math.ceil(CONFIG.maxMembers / 5)) {
      document.querySelectorAll('[data-testid="UserCell"]').forEach(user => {
        const name = user.querySelector('[dir="ltr"]')?.textContent || '';
        const handle = user.querySelector('a[role="link"]')?.href?.split('/').pop() || '';
        const bio = extractBio(user);
        const isVerified = !!user.querySelector('[data-testid="icon-verified"]');

        if (handle && !members.find(m => m.handle === handle)) {
          members.push({ name: name.trim(), handle, bio: bio.trim().substring(0, 200), isVerified });
        }
      });

      window.scrollBy(0, 800);
      await sleep(1500);
      scrollAttempts++;
    }

    console.log(`  Found ${members.length} members`);
    return members;
  };

  const run = async () => {
    console.log('📋 XActions List Manager');
    console.log('========================');

    let result = {};

    if (CONFIG.action === 'export_members') {
      result.members = await exportListMembers();
    } else {
      result.lists = await exportLists();
    }

    result.scrapedAt = new Date().toISOString();

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
| `action` | `'export',` | 'export' or 'export_members' |
| `maxLists` | `50` | Max lists |
| `maxMembers` | `100` | Max members |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/YOUR_USERNAME/lists`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/manageLists.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageLists.js) and paste it into the console.

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
| [`scripts/manageLists.js`](https://github.com/nirholas/XActions/blob/main/scripts/manageLists.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| See [all scripts](README.md) | Browse the complete script catalog |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
