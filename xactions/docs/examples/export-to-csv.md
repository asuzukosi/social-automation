# 📄 Export to CSV

Generic CSV export tool. Convert any scraped data array to downloadable CSV format.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Generic CSV export tool. Convert any scraped data array to downloadable CSV format.
- Automate repetitive utilities tasks on X/Twitter
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
3. Copy and paste the script from [`scripts/exportToCSV.js`](https://github.com/nirholas/XActions/blob/main/scripts/exportToCSV.js)
4. Press Enter to run

```javascript
/**
 * Export to CSV Utility
 * Convert any scraped data to CSV format
 * 
 * HOW TO USE:
 * 1. First, run any scraper script (scrapeFollowers, scrapeLikes, etc.)
 * 2. Then paste this script
 * 3. Call: exportToCSV(window.scrapedFollowers, 'followers.csv')
 * 
 * EXAMPLES:
 *   exportToCSV(window.scrapedFollowers, 'followers.csv')
 *   exportToCSV(window.scrapedLikes, 'my_likes.csv')
 *   exportToCSV(window.viralTweets, 'viral.csv')
 *   exportToCSV(window.scrapedSearch.tweets, 'search_results.csv')
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  /**
   * Convert an array of objects to CSV and download
   * @param {Array} data - Array of objects to convert
   * @param {string} filename - Name for the downloaded file
   * @param {Array} columns - Optional: specific columns to include (default: all)
   */
  const exportToCSV = (data, filename = 'export.csv', columns = null) => {
    if (!data) {
      console.error('❌ No data provided!');
      console.log('Usage: exportToCSV(yourData, "filename.csv")');
      return;
    }

    // Handle both arrays and objects with nested arrays
    let dataArray = data;
    if (!Array.isArray(data)) {
      // Look for common nested array properties
      if (data.tweets) dataArray = data.tweets;
      else if (data.followers) dataArray = data.followers;
      else if (data.following) dataArray = data.following;
      else if (data.members) dataArray = data.members;
      else if (data.bookmarks) dataArray = data.bookmarks;
      else if (data.messages) dataArray = data.messages;
      else if (data.notifications) dataArray = data.notifications;
      else if (data.likers) dataArray = data.likers;
      else if (data.replies) dataArray = data.replies;
      else if (data.quotes) dataArray = data.quotes;
      else if (data.media) dataArray = data.media;
      else if (data.links) dataArray = data.links;
      else {
        console.error('❌ Could not find array data. Pass the array directly.');
        return;
      }
    }

    if (!dataArray.length) {
      console.error('❌ Data array is empty!');
      return;
    }

    console.log(`📊 Converting ${dataArray.length} items to CSV...`);

    // Get all unique keys from all objects (some objects might have different keys)
    const allKeys = new Set();
    dataArray.forEach(item => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(key => allKeys.add(key));
      }
    });

    // Filter to specified columns if provided
    let headers = columns || Array.from(allKeys);
    
    // Exclude complex nested objects/arrays from default export
    headers = headers.filter(key => {
      const sample = dataArray.find(item => item && item[key] !== undefined);
      if (sample) {
        const val = sample[key];
        // Keep arrays as comma-separated, exclude deep objects
        if (Array.isArray(val)) return true;
        if (typeof val === 'object' && val !== null) return false;
      }
      return true;
    });

    // Escape CSV values
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      
      // Handle arrays
      if (Array.isArray(value)) {
        value = value.join('; ');
      }
      
      // Convert to string
      const str = String(value);
      
      // Escape quotes and wrap in quotes if needed
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Build CSV
    const rows = [headers.join(',')];
    
    dataArray.forEach(item => {
      if (!item || typeof item !== 'object') return;
      
      const row = headers.map(key => escapeCSV(item[key]));
      rows.push(row.join(','));
    });

    const csv = rows.join('\n');

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`✅ Downloaded ${filename} with ${dataArray.length} rows and ${headers.length} columns`);
    console.log(`📋 Columns: ${headers.join(', ')}`);
    
    return csv;
  };

  /**
   * Convert data to JSON and download
   * @param {any} data - Data to export
   * @param {string} filename - Name for the downloaded file
   */
  const exportToJSON = (data, filename = 'export.json') => {
    if (!data) {
      console.error('❌ No data provided!');
      return;
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`✅ Downloaded ${filename}`);
    return json;
  };

  /**
   * Convert data to plain text list and download
   * @param {Array} data - Array of objects
   * @param {string} field - Field to extract (e.g., 'handle', 'url')
   * @param {string} filename - Name for the downloaded file
   */
  const exportToTXT = (data, field, filename = 'export.txt') => {
    if (!data || !field) {
      console.error('❌ Usage: exportToTXT(data, "fieldName", "filename.txt")');
      return;
    }

    let dataArray = Array.isArray(data) ? data : 
                    data.tweets || data.followers || data.members || [];

    const lines = dataArray
      .map(item => item[field])
      .filter(val => val !== undefined && val !== null)
      .join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`✅ Downloaded ${filename} with ${lines.split('\n').length} lines`);
    return lines;
  };

  // Expose globally
  window.exportToCSV = exportToCSV;
  window.exportToJSON = exportToJSON;
  window.exportToTXT = exportToTXT;

  console.log('📤 Export utilities loaded!');
  console.log('');
  console.log('Available functions:');
  console.log('  exportToCSV(data, "filename.csv")  - Export to CSV');
  console.log('  exportToJSON(data, "filename.json") - Export to JSON');
  console.log('  exportToTXT(data, "field", "filename.txt") - Export single field');
  console.log('');
  console.log('Examples:');
  console.log('  exportToCSV(window.scrapedFollowers, "my_followers.csv")');
  console.log('  exportToCSV(window.viralTweets, "viral_tweets.csv")');
  console.log('  exportToTXT(window.scrapedFollowing, "handle", "handles.txt")');
})();

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com (any page)`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/exportToCSV.js`](https://github.com/nirholas/XActions/blob/main/scripts/exportToCSV.js) and paste it into the console.

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
| [`scripts/exportToCSV.js`](https://github.com/nirholas/XActions/blob/main/scripts/exportToCSV.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| See [all scripts](README.md) | Browse the complete script catalog |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
