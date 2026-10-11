# 🖼️ Scrape Media

Download all images and videos from a profile's media tab. Saves media files with metadata.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Download all images and videos from a profile's media tab. Saves media files with metadata.
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
1. Go to `x.com/USERNAME/media`
2. Open browser console (`F12` → Console tab)
3. Copy and paste the script from [`scripts/scrapeMedia.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeMedia.js)
4. Press Enter to run

```javascript
/**
 * Media Scraper
 * Download all media (images/videos) from a user's profile
 * 
 * HOW TO USE:
 * 1. Go to x.com/USERNAME/media
 * 2. Open Developer Console (Ctrl+Shift+J or Cmd+Option+J)
 * 3. Paste this script and press Enter
 * 
 * by nichxbt - https://github.com/nirholas/XActions
 */

(() => {
  const CONFIG = {
    MAX_ITEMS: 500,
    SCROLL_DELAY: 1500,
    HIGH_QUALITY: true, // Get highest quality images
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

  const upgradeImageQuality = (url) => {
    if (!url) return url;
    // Remove size parameters to get full quality
    return url
      .replace(/&name=\w+/, '&name=large')
      .replace(/\?format=\w+/, '?format=jpg')
      .replace('_normal', '_400x400');
  };

  const extractMedia = (article) => {
    const media = [];
    
    // Get tweet info
    const timeLink = article.querySelector('time')?.closest('a');
    const tweetUrl = timeLink?.href || '';
    const tweetId = tweetUrl.split('/status/')[1]?.split('?')[0] || '';
    const userName = article.querySelector('[data-testid="User-Name"]')?.textContent || '';
    const handle = userName.match(/@(\w+)/)?.[1] || '';

    // Get images
    const images = article.querySelectorAll('img[src*="media"], img[src*="pbs.twimg.com/media"]');
    images.forEach(img => {
      let src = img.src;
      if (CONFIG.HIGH_QUALITY) {
        src = upgradeImageQuality(src);
      }
      if (!src.includes('profile_images') && !src.includes('emoji')) {
        media.push({
          type: 'image',
          url: src,
          tweetId,
          tweetUrl,
          handle,
        });
      }
    });

    // Get videos (poster images or video elements)
    const videos = article.querySelectorAll('video');
    videos.forEach(video => {
      media.push({
        type: 'video',
        url: video.poster || video.src || '',
        tweetId,
        tweetUrl,
        handle,
      });
    });

    // Get GIFs
    const gifs = article.querySelectorAll('img[src*="tweet_video_thumb"]');
    gifs.forEach(gif => {
      media.push({
        type: 'gif',
        url: gif.src,
        tweetId,
        tweetUrl,
        handle,
      });
    });

    return media;
  };

  const run = async () => {
    const username = window.location.pathname.split('/')[1];
    
    if (!window.location.pathname.includes('/media')) {
      console.log('⚠️ For best results, go to x.com/' + username + '/media');
    }

    console.log(`🖼️ Scraping media from @${username}...`);

    const allMedia = new Map();
    let scrolls = 0;
    let noNewCount = 0;

    while (allMedia.size < CONFIG.MAX_ITEMS && noNewCount < 5) {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const beforeCount = allMedia.size;

      articles.forEach(article => {
        const mediaItems = extractMedia(article);
        mediaItems.forEach(item => {
          const key = item.url.split('?')[0]; // Dedupe by base URL
          if (!allMedia.has(key)) {
            allMedia.set(key, item);
          }
        });
      });

      const added = allMedia.size - beforeCount;
      if (added > 0) {
        console.log(`🖼️ Collected ${allMedia.size} media items...`);
        noNewCount = 0;
      } else {
        noNewCount++;
      }

      window.scrollBy(0, 800);
      await sleep(CONFIG.SCROLL_DELAY);
      scrolls++;

      if (scrolls > 100) break;
    }

    const mediaList = Array.from(allMedia.values());
    const images = mediaList.filter(m => m.type === 'image');
    const videos = mediaList.filter(m => m.type === 'video');
    const gifs = mediaList.filter(m => m.type === 'gif');

    console.log('\n' + '='.repeat(60));
    console.log(`🖼️ SCRAPED ${mediaList.length} MEDIA ITEMS FROM @${username}`);
    console.log('='.repeat(60));
    console.log(`📷 Images: ${images.length}`);
    console.log(`🎥 Videos: ${videos.length}`);
    console.log(`🎞️ GIFs: ${gifs.length}`);
    console.log('='.repeat(60) + '\n');

    // Download JSON with all URLs
    const data = {
      username,
      scrapedAt: new Date().toISOString(),
      stats: {
        images: images.length,
        videos: videos.length,
        gifs: gifs.length,
        total: mediaList.length,
      },
      media: mediaList,
    };

    download(JSON.stringify(data, null, 2), `${username}_media_${Date.now()}.json`, 'application/json');
    console.log('💾 Downloaded media.json');

    // Also create a simple text file with just URLs
    const urlList = mediaList.map(m => m.url).join('\n');
    download(urlList, `${username}_media_urls_${Date.now()}.txt`, 'text/plain');
    console.log('💾 Downloaded media_urls.txt');

    window.scrapedMedia = data;
    console.log('\n✅ Done! Access data: window.scrapedMedia');
    console.log('💡 To download images: Open each URL from the JSON file');
  };

  run();
})();

```

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_ITEMS` | `500` | M a x  i t e m s |
| `SCROLL_DELAY` | `1500` | S c r o l l  d e l a y |
| `HIGH_QUALITY` | `true,` | Get highest quality images |

---

## 📖 Step-by-Step Tutorial

### Step 1: Navigate to the right page

Open your browser and go to `x.com/USERNAME/media`. Make sure you're logged in to your X/Twitter account.

### Step 2: Open the browser console

- **Chrome/Edge:** Press `F12` or `Ctrl+Shift+J` (Mac: `Cmd+Option+J`)
- **Firefox:** Press `F12` or `Ctrl+Shift+K`
- **Safari:** Enable Developer menu in Preferences → Advanced, then press `Cmd+Option+C`

### Step 3: Paste the script

Copy the entire script from [`scripts/scrapeMedia.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeMedia.js) and paste it into the console.

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
| [`scripts/scrapeMedia.js`](https://github.com/nirholas/XActions/blob/main/scripts/scrapeMedia.js) | Main script |

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
