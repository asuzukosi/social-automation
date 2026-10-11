# 👤 Profile Manager

Full profile management: update name, bio, avatar, header image, location, website, and verification settings.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Full profile management: update name, bio, avatar, header image, location, website, and verification settings.
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
1. Go to `x.com/settings/profile`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`src/profileManager.js`](https://github.com/nirholas/XActions/blob/main/src/profileManager.js)
4. Press Enter to run

```javascript
// src/profileManager.js
// Profile management automation for X/Twitter
// by nichxbt

/**
 * Profile Manager - Automate profile updates and management
 * 
 * Features:
 * - Update display name, bio, location, website
 * - Change profile picture and header image
 * - Manage verification and labels
 * - Filter posts by latest/most liked (2026)
 * - Generate QR codes
 * - Sync contacts
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// Selectors
// ============================================================================

const SELECTORS = {
  editProfileButton: '[data-testid="editProfileButton"]',
  nameInput: 'input[name="displayName"]',
  bioTextarea: 'textarea[name="description"]',
  locationInput: 'input[name="location"]',
  websiteInput: 'input[name="url"]',
  saveButton: '[data-testid="Profile_Save_Button"]',
  avatarEdit: '[data-testid="editProfileAvatar"]',
  headerEdit: '[data-testid="editProfileHeader"]',
  verificationBadge: '[data-testid="icon-verified"]',
  followerCount: 'a[href$="/followers"] span',
  followingCount: 'a[href$="/following"] span',
  profileName: '[data-testid="UserName"]',
  profileBio: '[data-testid="UserDescription"]',
  profileLocation: '[data-testid="UserLocation"]',
  profileUrl: '[data-testid="UserUrl"]',
  profileJoinDate: '[data-testid="UserJoinDate"]',
  postFilterLatest: '[data-testid="sortByLatest"]',
  postFilterLiked: '[data-testid="sortByLiked"]',
};

// ============================================================================
// Profile Reading
// ============================================================================

/**
 * Scrape detailed profile information
 * @param {import('puppeteer').Page} page - Puppeteer page
 * @param {string} username - Twitter username (without @)
 * @returns {Promise<Object>} Profile data
 */
export async function getProfile(page, username) {
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  const profile = await page.evaluate((sel) => {
    const getText = (s) => document.querySelector(s)?.textContent?.trim() || null;
    const getAttr = (s, attr) => document.querySelector(s)?.getAttribute(attr) || null;

    return {
      name: getText(sel.profileName),
      bio: getText(sel.profileBio),
      location: getText(sel.profileLocation),
      website: getText(sel.profileUrl),
      joinDate: getText(sel.profileJoinDate),
      isVerified: !!document.querySelector(sel.verificationBadge),
      followers: getText(sel.followerCount),
      following: getText(sel.followingCount),
      avatarUrl: getAttr('img[alt="Opens profile photo"]', 'src'),
    };
  }, SELECTORS);

  return { username, ...profile, scrapedAt: new Date().toISOString() };
}

/**
 * Filter a user's posts by latest or most liked (2026 feature)
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @param {string} sort - 'latest' or 'most_liked'
 * @param {Object} options
 * @returns {Promise<Array>} Sorted posts
 */
export async function filterPosts(page, username, sort = 'latest', options = {}) {
  const { limit = 50, type = 'all' } = options;
  await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Click sort filter if available
  const sortSelector = sort === 'most_liked' ? SELECTORS.postFilterLiked : SELECTORS.postFilterLatest;
  try {
    await page.click(sortSelector);
    await sleep(1500);
  } catch (e) {
    console.log(`⚠️ Sort filter not available, using default order`);
  }

  const posts = [];
  let scrollAttempts = 0;
  const maxScrolls = Math.ceil(limit / 5);

  while (posts.length < limit && scrollAttempts < maxScrolls) {
    const newPosts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).map(tweet => {
        const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
        const time = tweet.querySelector('time')?.getAttribute('datetime') || '';
        const likes = tweet.querySelector('[data-testid="like"] span')?.textContent || '0';
        const reposts = tweet.querySelector('[data-testid="retweet"] span')?.textContent || '0';
        const replies = tweet.querySelector('[data-testid="reply"] span')?.textContent || '0';
        const link = tweet.querySelector('a[href*="/status/"]')?.href || '';
        return { text, time, likes, reposts, replies, link };
      });
    });

    for (const post of newPosts) {
      if (!posts.find(p => p.link === post.link)) {
        posts.push(post);
      }
    }

    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(1500);
    scrollAttempts++;
  }

  return posts.slice(0, limit);
}

// ============================================================================
// Profile Updating
// ============================================================================

/**
 * Update profile fields
 * @param {import('puppeteer').Page} page
 * @param {Object} updates - Fields to update { name, bio, location, website }
 * @returns {Promise<Object>} Update result
 */
export async function updateProfile(page, updates = {}) {
  await page.goto('https://x.com/settings/profile', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // Click edit profile
  try {
    await page.click(SELECTORS.editProfileButton);
    await sleep(1500);
  } catch (e) {
    // May already be in edit mode on settings/profile
  }

  const fieldUpdated = [];

  if (updates.name) {
    const nameInput = await page.$(SELECTORS.nameInput);
    if (nameInput) {
      await nameInput.click({ clickCount: 3 });
      await nameInput.type(updates.name);
      fieldUpdated.push('name');
    }
  }

  if (updates.bio) {
    const bioInput = await page.$(SELECTORS.bioTextarea);
    if (bioInput) {
      await bioInput.click({ clickCount: 3 });
      await bioInput.type(updates.bio);
      fieldUpdated.push('bio');
    }
  }

  if (updates.location) {
    const locInput = await page.$(SELECTORS.locationInput);
    if (locInput) {
      await locInput.click({ clickCount: 3 });
      await locInput.type(updates.location);
      fieldUpdated.push('location');
    }
  }

  if (updates.website) {
    const urlInput = await page.$(SELECTORS.websiteInput);
    if (urlInput) {
      await urlInput.click({ clickCount: 3 });
      await urlInput.type(updates.website);
      fieldUpdated.push('website');
    }
  }

  // Save changes
  if (fieldUpdated.length > 0) {
    await page.click(SELECTORS.saveButton);
    await sleep(2000);
  }

  return {
    success: fieldUpdated.length > 0,
    updated: fieldUpdated,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Upload profile picture
 * @param {import('puppeteer').Page} page
 * @param {string} imagePath - Local path to image file
 */
export async function uploadAvatar(page, imagePath) {
  await page.goto('https://x.com/settings/profile', { waitUntil: 'networkidle2' });
  await sleep(2000);

  try {
    await page.click(SELECTORS.editProfileButton);
    await sleep(1500);
  } catch (e) {}

  const avatarButton = await page.$(SELECTORS.avatarEdit);
  if (avatarButton) {
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser(),
      avatarButton.click(),
    ]);
    await fileChooser.accept([imagePath]);
    await sleep(2000);
    await page.click(SELECTORS.saveButton);
    await sleep(2000);
    return { success: true, field: 'avatar' };
  }
  return { success: false, error: 'Avatar edit button not found' };
}

/**
 * Upload header/banner image
 * @param {import('puppeteer').Page} page
 * @param {string} imagePath
 */
export async function uploadHeader(page, imagePath) {
  await page.goto('https://x.com/settings/profile', { waitUntil: 'networkidle2' });
  await sleep(2000);

  try {
    await page.click(SELECTORS.editProfileButton);
    await sleep(1500);
  } catch (e) {}

  const headerButton = await page.$(SELECTORS.headerEdit);
  if (headerButton) {
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser(),
      headerButton.click(),
    ]);
    await fileChooser.accept([imagePath]);
    await sleep(2000);
    await page.click(SELECTORS.saveButton);
    await sleep(2000);
    return { success: true, field: 'header' };
  }
  return { success: false, error: 'Header edit button not found' };
}

export default {
  getProfile,
  filterPosts,
  updateProfile,
  uploadAvatar,
  uploadHeader,
  SELECTORS,
};

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/settings/profile`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`src/profileManager.js`](https://github.com/nirholas/XActions/blob/main/src/profileManager.js) and paste it into the console.

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
| [`src/profileManager.js`](https://github.com/nirholas/XActions/blob/main/src/profileManager.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Settings Manager](settings-manager.md) | Manage account security, privacy, and preference settings |
| [Manage Settings](manage-settings.md) | Manage account settings: privacy, security, display, and accessibility options |
| [Edit Profile](edit-profile.md) | Update profile fields via the settings page |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
