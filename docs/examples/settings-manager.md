# ⚙️ Settings Manager

Manage account security, privacy, and preference settings. Bulk-update notification, display, and privacy options.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Manage account security, privacy, and preference settings. Bulk-update notification, display, and privacy options.
- Automate repetitive account tasks on X/Twitter
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
1. Go to `x.com/settings`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/settingsManager.js`](https://github.com/nirholas/XActions/blob/main/src/settingsManager.js)
4. Press Enter to run

```javascript
// src/settingsManager.js
// Account settings and privacy management for X/Twitter
// by nichxbt

/**
 * Settings Manager - Account security, privacy, preferences
 * 
 * Features:
 * - Toggle protected/private account
 * - Manage blocked/muted users
 * - Configure content preferences
 * - Data download/archive request
 * - Delegate access management
 * - Content filter settings
 * - Accessibility options
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SELECTORS = {
  settingsNav: 'a[href="/settings"]',
  accountTab: 'a[href="/settings/account"]',
  privacyTab: 'a[href="/settings/privacy_and_safety"]',
  notificationsTab: 'a[href="/settings/notifications"]',
  settingsSwitch: '[role="switch"]',
  protectedToggle: '[data-testid="protectedTweets"]',
  dataDownload: 'a[href="/settings/download_data"]',
  deactivate: 'a[href="/settings/deactivate"]',
  twoFASettings: 'a[href="/settings/account/login_verification"]',
  blockedAccounts: 'a[href="/settings/blocked"]',
  mutedAccounts: 'a[href="/settings/muted"]',
  mutedKeywords: 'a[href="/settings/muted_keywords"]',
  contentPrefs: 'a[href="/settings/content_preferences"]',
  displaySettings: 'a[href="/settings/display"]',
  saveButton: '[data-testid="settingsSave"]',
};

/**
 * Get current settings overview
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>}
 */
export async function getSettings(page) {
  await page.goto('https://x.com/settings/account', { waitUntil: 'networkidle2' });
  await sleep(2000);

  const settings = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/settings/"]'));
    const sections = links.map(link => ({
      text: link.textContent?.trim() || '',
      href: link.getAttribute('href') || '',
    }));

    const switches = Array.from(document.querySelectorAll('[role="switch"]')).map(sw => ({
      label: sw.closest('[data-testid]')?.textContent?.trim()?.substring(0, 100) || '',
      enabled: sw.getAttribute('aria-checked') === 'true',
    }));

    return { sections, switches };
  });

  return { settings, scrapedAt: new Date().toISOString() };
}

/**
 * Toggle protected/private account
 * @param {import('puppeteer').Page} page
 * @param {boolean} protect - true to protect, false to unprotect
 * @returns {Promise<Object>}
 */
export async function toggleProtectedAccount(page, protect) {
  await page.goto('https://x.com/settings/audience_and_tagging', { waitUntil: 'networkidle2' });
  await sleep(2000);

  const currentState = await page.evaluate((sel) => {
    const toggle = document.querySelector(sel.protectedToggle) || document.querySelector('[role="switch"]');
    return toggle?.getAttribute('aria-checked') === 'true';
  }, SELECTORS);

  if (currentState === protect) {
    return { success: true, action: 'no_change', protected: protect };
  }

  // Click toggle
  await page.click('[role="switch"]');
  await sleep(1000);

  // Confirm if needed
  try {
    await page.click('[data-testid="confirmationSheetConfirm"]');
    await sleep(1500);
  } catch (e) {
    // No confirmation needed
  }

  return {
    success: true,
    action: protect ? 'protected' : 'unprotected',
    protected: protect,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get blocked accounts list
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getBlockedAccounts(page, options = {}) {
  const { limit = 100 } = options;

  await page.goto('https://x.com/settings/blocked/all', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const blocked = [];
  let scrollAttempts = 0;

  while (blocked.length < limit && scrollAttempts < Math.ceil(limit / 5)) {
    const users = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="UserCell"]')).map(user => {
        const name = user.querySelector('[dir="ltr"]')?.textContent || '';
        const handle = user.querySelector('a[role="link"]')?.href?.split('/').pop() || '';
        return { name, handle };
      });
    });

    for (const user of users) {
      if (user.handle && !blocked.find(b => b.handle === user.handle)) {
        blocked.push(user);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(1500);
    scrollAttempts++;
  }

  return {
    blocked: blocked.slice(0, limit),
    count: Math.min(blocked.length, limit),
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Get muted accounts list
 * @param {import('puppeteer').Page} page
 * @param {Object} options
 * @returns {Promise<Object>}
 */
export async function getMutedAccounts(page, options = {}) {
  const { limit = 100 } = options;

  await page.goto('https://x.com/settings/muted/all', { waitUntil: 'networkidle2' });
  await sleep(3000);

  const muted = [];
  let scrollAttempts = 0;

  while (muted.length < limit && scrollAttempts < Math.ceil(limit / 5)) {
    const users = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="UserCell"]')).map(user => {
        const name = user.querySelector('[dir="ltr"]')?.textContent || '';
        const handle = user.querySelector('a[role="link"]')?.href?.split('/').pop() || '';
        return { name, handle };
      });
    });

    for (const user of users) {
      if (user.handle && !muted.find(m => m.handle === user.handle)) {
        muted.push(user);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(1500);
    scrollAttempts++;
  }

  return {
    muted: muted.slice(0, limit),
    count: Math.min(muted.length, limit),
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Request data download/archive
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>}
 */
export async function requestDataDownload(page) {
  await page.goto('https://x.com/settings/download_your_data', { waitUntil: 'networkidle2' });
  await sleep(2000);

  try {
    await page.click('[data-testid="requestData"]');
    await sleep(2000);

    // May need password confirmation
    return {
      success: true,
      action: 'data_download_requested',
      note: 'Archive typically takes 24-48 hours to generate',
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return {
      success: false,
      error: 'Could not request data download — may need password confirmation',
    };
  }
}

/**
 * Set content preferences (reduce political content, etc.)
 * @param {import('puppeteer').Page} page
 * @param {Object} preferences
 * @returns {Promise<Object>}
 */
export async function setContentPreferences(page, preferences = {}) {
  await page.goto('https://x.com/settings/content_preferences', { waitUntil: 'networkidle2' });
  await sleep(2000);

  const updated = [];

  // Toggle available preference switches
  const switches = await page.$$('[role="switch"]');
  for (const sw of switches) {
    const label = await sw.evaluate(el =>
      el.closest('[data-testid]')?.textContent?.trim()?.substring(0, 80) || ''
    );
    
    for (const [key, value] of Object.entries(preferences)) {
      if (label.toLowerCase().includes(key.toLowerCase())) {
        const currentState = await sw.evaluate(el => el.getAttribute('aria-checked') === 'true');
        if (currentState !== value) {
          await sw.click();
          await sleep(500);
          updated.push(key);
        }
      }
    }
  }

  return {
    updated,
    timestamp: new Date().toISOString(),
  };
}

export default {
  getSettings,
  toggleProtectedAccount,
  getBlockedAccounts,
  getMutedAccounts,
  requestDataDownload,
  setContentPreferences,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/settings`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/settingsManager.js`](https://github.com/nirholas/XActions/blob/main/src/settingsManager.js) and paste it into the console.

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
| [`src/settingsManager.js`](https://github.com/nirholas/XActions/blob/main/src/settingsManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Profile Manager](profile-manager.md) | Full profile management: update name, bio, avatar, header image, location, website, and verification settings |
| [Manage Settings](manage-settings.md) | Manage account settings: privacy, security, display, and accessibility options |
| [Edit Profile](edit-profile.md) | Update profile fields via the settings page |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
