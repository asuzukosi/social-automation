# 👤 Scrape Profile

Get detailed profile data for any user. Extracts bio, stats, links, verification, and header images.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Get detailed profile data for any user. Extracts bio, stats, links, verification, and header images.
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
1. Go to `x.com/USERNAME`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeProfile.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeProfile.js)
4. Press Enter to run

```javascript
/**
 * Profile Scraper
 * Get detailed profile data for a user
 * 
 * HOW TO USE:
 * 1. Go to any user's profile: x.com/USERNAME
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const download = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseNumber = (str) => {
    if (!str) return 0;
    const clean = str.replace(/,/g, '').trim();
    const num = parseFloat(clean);
    if (str.includes('K')) return num * 1000;
    if (str.includes('M')) return num * 1000000;
    return num;
  };

  const run = async () => {
    const username = window.location.pathname.split('/')[1];
    
    if (!username || username.startsWith('i/') || ['home', 'explore', 'notifications', 'messages'].includes(username)) {
      console.error('❌ Please go to a user profile first!');
      return;
    }

    console.log(`👤 Scraping profile of @${username}...`);

    // Extract profile data from the page
    const profile = {
      handle: username,
      displayName: '',
      bio: '',
      location: '',
      website: '',
      joinDate: '',
      followersCount: 0,
      followingCount: 0,
      tweetsCount: 0,
      verified: false,
      profileImageUrl: '',
      bannerImageUrl: '',
      scrapedAt: new Date().toISOString(),
    };

    // Display name
    const displayNameEl = document.querySelector('[data-testid="UserName"] span');
    profile.displayName = displayNameEl?.textContent || username;

    // Bio
    const bioEl = document.querySelector('[data-testid="UserDescription"]');
    profile.bio = bioEl?.textContent || '';

    // Location
    const locationEl = document.querySelector('[data-testid="UserLocation"]');
    profile.location = locationEl?.textContent || '';

    // Website
    const websiteEl = document.querySelector('[data-testid="UserUrl"]');
    profile.website = websiteEl?.href || websiteEl?.querySelector('a')?.href || websiteEl?.textContent || '';

    // Join date
    const joinDateEl = document.querySelector('[data-testid="UserJoinDate"]');
    profile.joinDate = joinDateEl?.textContent || '';

    // Followers/Following counts
    const followLinks = document.querySelectorAll('a[href*="/followers"], a[href*="/following"]');
    followLinks.forEach(link => {
      const text = link.textContent || '';
      if (link.href.includes('/followers')) {
        profile.followersCount = parseNumber(text);
      } else if (link.href.includes('/following')) {
        profile.followingCount = parseNumber(text);
      }
    });

    // Verified badge
    profile.verified = !!document.querySelector('[data-testid="UserName"] svg[aria-label*="Verified"]');

    // Profile image
    const profileImg = document.querySelector('a[href*="/photo"] img');
    if (profileImg) {
      profile.profileImageUrl = profileImg.src.replace('_normal', '_400x400');
    }

    // Banner image
    const bannerImg = document.querySelector('a[href*="/header_photo"] img');
    profile.bannerImageUrl = bannerImg?.src || '';

    // Tweet count (from nav or header)
    const tweetCountEl = document.querySelector('[data-testid="primaryColumn"] h2')?.parentElement?.querySelector('span');
    if (tweetCountEl) {
      const match = tweetCountEl.textContent?.match(/[\d,.]+[KM]?/);
      if (match) profile.tweetsCount = parseNumber(match[0]);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`👤 PROFILE: @${profile.handle}`);
    console.log('='.repeat(60));
    console.log(`📛 Name: ${profile.displayName}`);
    console.log(`📝 Bio: ${profile.bio.slice(0, 100)}${profile.bio.length > 100 ? '...' : ''}`);
    console.log(`📍 Location: ${profile.location || 'N/A'}`);
    console.log(`🔗 Website: ${profile.website || 'N/A'}`);
    console.log(`📅 Joined: ${profile.joinDate}`);
    console.log(`👥 Followers: ${profile.followersCount.toLocaleString()}`);
    console.log(`👥 Following: ${profile.followingCount.toLocaleString()}`);
    console.log(`${profile.verified ? '✅ Verified' : ''}`);
    console.log('='.repeat(60) + '\n');

    download(JSON.stringify(profile, null, 2), `profile_${username}_${Date.now()}.json`, 'application/json');
    console.log('💾 Downloaded profile.json');

    window.scrapedProfile = profile;
    console.log('\n✅ Done! Access data: window.scrapedProfile');
  };

  run();
})();

```

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/USERNAME`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeProfile.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeProfile.js) and paste it into the console.

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
| [`scripts/scrapeProfile.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeProfile.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Scrape Profile with Replies](scrape-profile-with-replies.md) | Scrape a profile's tweets AND replies |
| [Scrape Analytics](scrape-analytics.md) | Scrape your account and post analytics |
| [Scrape Bookmarks](scrape-bookmarks.md) | Scrape all your bookmarked tweets |
| [Scrape Cashtag Search](scrape-cashtag-search.md) | Scrape cashtag search results with sentiment analysis |
| [Scrape DMs](scrape-dms.md) | Export your DM conversations |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
