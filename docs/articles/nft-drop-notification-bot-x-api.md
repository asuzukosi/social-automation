# How to Build an NFT Drop Notification Bot with X API

**Meta description:** Step-by-step guide to building an NFT drop notification bot using the X API — monitoring NFT project announcements, detecting mint dates, posting alerts, and integrating with NFT marketplace APIs for on-chain verification.

---

## Introduction

NFT drops are time-sensitive. Public mint windows often open and sell out within minutes. A notification bot that monitors X for drop announcements, extracts mint details, and pushes alerts to your audience can be the difference between minting at floor and missing out entirely.

This guide builds a complete NFT drop notification bot: stream-based monitoring for announcements, structured data extraction from tweets, optional on-chain verification, and multi-channel alert delivery.

---

## What the Bot Does

1. Monitors X for NFT project accounts and keyword signals
2. Detects tweets announcing upcoming mints or live drops
3. Extracts date, time, price, and mint URL when present
4. Verifies on-chain status via marketplace API (optional)
5. Posts formatted alerts to X, Discord, or Telegram

---

## Step 1: Identify Signal Sources

NFT drop signals come from two places on X:

**Project official accounts** — The most reliable signal. Build a list of NFT projects you want to track:

```javascript
const NFT_PROJECTS = [
  { username: 'BoredApeYC', name: 'Bored Ape Yacht Club', chain: 'ethereum' },
  { username: 'DeGodsNFT', name: 'DeGods', chain: 'solana' },
  { username: 'PudgyPenguins', name: 'Pudgy Penguins', chain: 'ethereum' },
  { username: 'azukiofficial', name: 'Azuki', chain: 'ethereum' },
  { username: 'doodles', name: 'Doodles', chain: 'ethereum' }
];

// Resolve to user IDs for stream rules
async function resolveUserIds(projects) {
  const client = new TwitterApi(process.env.X_BEARER_TOKEN);
  const users = await client.v2.usersByUsernames(projects.map(p => p.username));
  return users.data.map(u => ({
    ...projects.find(p => p.username.toLowerCase() === u.username.toLowerCase()),
    id: u.id
  }));
}
```

**Keyword monitoring** — Catch announcements from projects not on your list:

```javascript
const DROP_KEYWORD_RULES = [
  { value: '("public mint" OR "mint is live" OR "minting now") NFT lang:en -is:retweet', tag: 'mint-live' },
  { value: '("mint date" OR "drop date" OR "launch date") NFT (announced OR confirmed) lang:en -is:retweet', tag: 'mint-announced' },
  { value: '("whitelist" OR "allowlist") NFT (open OR now OR live) lang:en -is:retweet', tag: 'wl-open' },
  { value: 'NFT ("free mint" OR "free drop") lang:en -is:retweet has:links', tag: 'free-mint' }
];
```

---

## Step 2: Set Up the Stream

Combine project account rules with keyword rules:

```javascript
async function configureDropStream() {
  const projects = await resolveUserIds(NFT_PROJECTS);

  // Create a rule matching all tracked project accounts
  const fromRule = projects.map(p => `from:${p.id}`).join(' OR ');
  const projectRule = {
    value: `(${fromRule}) -is:retweet`,
    tag: 'nft-project-accounts'
  };

  const allRules = [projectRule, ...DROP_KEYWORD_RULES];
  await applyStreamRules(allRules);

  return connectStream(processTweet);
}
```

---

## Step 3: Detect and Classify Drop Tweets

Not every tweet from an NFT project is a drop announcement. Classify incoming tweets:

```javascript
const DROP_PATTERNS = {
  LIVE_MINT: [
    /mint(ing)? (is )?now (live|open)/i,
    /public mint (is )?live/i,
    /minting now/i,
    /mint (is )?open/i
  ],
  UPCOMING_MINT: [
    /mint(ing)? (starts?|opens?|begins?|at|on) [A-Z]/i,
    /drop (date|time|is)/i,
    /launch(ing)? (on|at|soon)/i,
    /\d{1,2}(st|nd|rd|th)? [A-Z][a-z]+/,  // "15th March"
    /\d{1,2}\/\d{1,2}/                     // "3/15"
  ],
  WHITELIST: [
    /allowlist (is )?(open|now|live)/i,
    /whitelist (is )?(open|now|live)/i,
    /wl (spots?|open|available)/i
  ],
  FREE_MINT: [
    /free (mint|drop)/i,
    /no cost.*mint/i
  ]
};

function classifyDropTweet(text) {
  for (const [type, patterns] of Object.entries(DROP_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      return { type, isDropRelated: true };
    }
  }
  return { type: 'GENERAL', isDropRelated: false };
}
```

---

## Step 4: Extract Drop Details

Parse structured data from tweet text:

```javascript
function extractDropDetails(text) {
  const details = {};

  // Extract price (ETH, SOL, or free)
  const ethPrice = text.match(/(\d+(?:\.\d+)?)\s*ETH/i);
  const solPrice = text.match(/(\d+(?:\.\d+)?)\s*SOL/i);
  const freeMatch = text.match(/free\s*mint|0\s*ETH|0\s*SOL/i);

  if (freeMatch) details.price = 'Free';
  else if (ethPrice) details.price = `${ethPrice[1]} ETH`;
  else if (solPrice) details.price = `${solPrice[1]} SOL`;

  // Extract supply
  const supply = text.match(/(\d[,\d]*)\s*(total\s*)?(supply|items?|NFTs?)/i);
  if (supply) details.supply = supply[1].replace(/,/g, '');

  // Extract URLs
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  details.links = urls.filter(u =>
    !u.includes('twitter.com') && !u.includes('t.co') || u.includes('t.co')
  );

  // Extract date mentions
  const datePatterns = [
    /(\w+ \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?)/i,  // "March 15th"
    /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/        // "3/15/24"
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.dateText = match[1];
      break;
    }
  }

  // Time extraction
  const timeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|UTC|EST|PST))/i);
  if (timeMatch) details.time = timeMatch[1];

  return details;
}
```

---

## Step 5: Verify On-Chain Status

For live mint detection, cross-reference with NFT marketplace APIs:

```javascript
async function checkOpenSeaStatus(contractAddress) {
  const res = await fetch(
    `https://api.opensea.io/api/v2/contracts/${contractAddress}`,
    { headers: { 'X-API-KEY': process.env.OPENSEA_API_KEY } }
  );

  if (!res.ok) return null;
  const data = await res.json();

  return {
    name: data.name,
    totalSupply: data.total_supply,
    floorPrice: data.collection?.stats?.floor_price,
    verified: data.is_verified
  };
}

// For Solana NFTs — use Helius or Magic Eden API
async function checkMagicEdenStatus(collectionSymbol) {
  const res = await fetch(
    `https://api-mainnet.magiceden.dev/v2/collections/${collectionSymbol}/stats`
  );
  return res.ok ? res.json() : null;
}
```

---

## Step 6: Format and Send Alerts

Build well-formatted alert messages:

```javascript
function formatDropAlert(tweet, classification, details, project) {
  const lines = [];

  const typeEmoji = {
    LIVE_MINT: '🚨',
    UPCOMING_MINT: '📅',
    WHITELIST: '📋',
    FREE_MINT: '🆓'
  };

  lines.push(`${typeEmoji[classification.type] ?? '🎨'} ${classification.type.replace('_', ' ')}`);

  if (project) lines.push(`Project: ${project.name} (@${project.username})`);

  if (details.price) lines.push(`Price: ${details.price}`);
  if (details.supply) lines.push(`Supply: ${details.supply}`);
  if (details.dateText) lines.push(`Date: ${details.dateText}${details.time ? ` ${details.time}` : ''}`);

  lines.push(`\nSource: https://x.com/i/status/${tweet.id}`);

  return lines.join('\n');
}

async function sendAlerts(message, classification) {
  // Post to X (for a public bot account)
  if (classification.type === 'LIVE_MINT' || classification.type === 'FREE_MINT') {
    await twitterClient.v2.tweet(message.slice(0, 280));
  }

  // Discord webhook
  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      username: 'NFT Drop Bot'
    })
  });

  // Telegram
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    })
  });
}
```

---

## Step 7: Wire It Together

```javascript
async function processTweet(payload) {
  const tweet = payload.data;
  const author = payload.includes?.users?.[0];
  const matchedRules = payload.matching_rules ?? [];

  const classification = classifyDropTweet(tweet.text);
  if (!classification.isDropRelated) return;

  const details = extractDropDetails(tweet.text);

  // Find project from watchlist if applicable
  const matchedProject = NFT_PROJECTS.find(p =>
    author?.username?.toLowerCase() === p.username.toLowerCase()
  );

  const message = formatDropAlert(tweet, classification, details, matchedProject);
  console.log(`✅ Drop detected: ${classification.type}`);

  await sendAlerts(message, classification);
}
```

---

## Deduplication

NFT drop tweets get retweeted and quoted heavily. Deduplicate before sending alerts:

```javascript
const sentAlerts = new Set();

async function sendAlertsDeduped(tweetId, message, classification) {
  if (sentAlerts.has(tweetId)) return;
  sentAlerts.add(tweetId);

  // Clean up old entries after 24 hours
  setTimeout(() => sentAlerts.delete(tweetId), 24 * 60 * 60 * 1000);

  await sendAlerts(message, classification);
}
```

---

## Conclusion

An NFT drop notification bot is a practical application of the X API Filtered Stream. The core components are straightforward: stream rules targeting known project accounts plus drop keywords, tweet classification, detail extraction, and alert delivery. The hard parts are keeping your project watchlist current and tuning classification patterns to reduce false positives from non-mint tweets that use similar vocabulary. Start with a small watchlist of 10-20 projects, validate alert quality manually for a week, then expand to keyword-based detection once your classification patterns are tuned.

---

*Related: [How to Build a Crypto Price Alert Bot with X API](./crypto-price-alert-bot-x-api.md)*
