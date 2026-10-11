# ✏️ Edit Profile

Update profile fields via the settings page. Change name, bio, location, website, and more.

---

## 📋 What It Does

This script provides the following capabilities:

1. **Automated operation** — Runs directly in your browser console on x.com
2. **Configurable settings** — Customize behavior via the CONFIG object
3. **Real-time progress** — Shows live status updates with emoji-coded logs
4. **Rate limiting** — Built-in delays to respect X/Twitter's rate limits
5. **Data export** — Results exported as JSON/CSV for further analysis

**Use cases:**
- Update profile fields via the settings page. Change name, bio, location, website, and more.
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
3. Copy and paste the script from [`scripts/editProfile.js`](https://github.com/nirholas/XActions/blob/main/scripts/editProfile.js)
4. Press Enter to run

```javascript
// scripts/editProfile.js
// Browser console script to update X/Twitter profile fields
// Paste in DevTools console on x.com/settings/profile
// by nichxbt

(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // =============================================
  // CONFIGURE YOUR PROFILE UPDATES HERE
  // =============================================
  const UPDATES = {
    // Set to null to skip a field
    name: null,        // e.g., 'Your Name'
    bio: null,         // e.g., 'Building cool stuff 🚀'
    location: null,    // e.g., 'San Francisco, CA'
    website: null,     // e.g., 'https://example.com'
  };
  // =============================================

  const SELECTORS = {
    editButton: '[data-testid="editProfileButton"]',
    nameInput: 'input[name="displayName"]',
    bioTextarea: 'textarea[name="description"]',
    locationInput: 'input[name="location"]',
    websiteInput: 'input[name="url"]',
    saveButton: '[data-testid="Profile_Save_Button"]',
  };

  const setInputValue = async (selector, value) => {
    const el = document.querySelector(selector);
    if (!el || !value) return false;

    el.focus();
    el.select?.();
    
    // Use native input setter for React controlled inputs
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  const run = async () => {
    console.log('📝 XActions Profile Editor');
    console.log('========================');

    // Click edit profile if needed
    const editBtn = document.querySelector(SELECTORS.editButton);
    if (editBtn) {
      editBtn.click();
      await sleep(2000);
      console.log('✅ Opened edit profile dialog');
    }

    let updated = 0;

    if (UPDATES.name) {
      if (await setInputValue(SELECTORS.nameInput, UPDATES.name)) {
        console.log(`✅ Name → "${UPDATES.name}"`);
        updated++;
      }
      await sleep(500);
    }

    if (UPDATES.bio) {
      if (await setInputValue(SELECTORS.bioTextarea, UPDATES.bio)) {
        console.log(`✅ Bio → "${UPDATES.bio}"`);
        updated++;
      }
      await sleep(500);
    }

    if (UPDATES.location) {
      if (await setInputValue(SELECTORS.locationInput, UPDATES.location)) {
        console.log(`✅ Location → "${UPDATES.location}"`);
        updated++;
      }
      await sleep(500);
    }

    if (UPDATES.website) {
      if (await setInputValue(SELECTORS.websiteInput, UPDATES.website)) {
        console.log(`✅ Website → "${UPDATES.website}"`);
        updated++;
      }
      await sleep(500);
    }

    if (updated === 0) {
      console.log('ℹ️ No updates configured. Edit UPDATES object at top of script.');
      return;
    }

    // Save
    const saveBtn = document.querySelector(SELECTORS.saveButton);
    if (saveBtn) {
      saveBtn.click();
      await sleep(2000);
      console.log(`\n🎉 Profile updated! (${updated} field${updated > 1 ? 's' : ''})`);
    } else {
      console.log('⚠️ Save button not found — changes may not be saved');
    }
  };

  run();
})();

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

Copy the entire script from [`scripts/editProfile.js`](https://github.com/nirholas/XActions/blob/main/scripts/editProfile.js) and paste it into the console.

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
| [`scripts/editProfile.js`](https://github.com/nirholas/XActions/blob/main/scripts/editProfile.js) | Main script |

---

## 🔗 Related Scripts

| Script | Description |
|--------|-------------|
| [Profile Manager](profile-manager.md) | Full profile management: update name, bio, avatar, header image, location, website, and verification settings |
| [Settings Manager](settings-manager.md) | Manage account security, privacy, and preference settings |
| [Manage Settings](manage-settings.md) | Manage account settings: privacy, security, display, and accessibility options |

---

> **Author:** nich ([@nichxbt](https://x.com/nichxbt)) — [XActions on GitHub](https://github.com/nirholas/XActions)
