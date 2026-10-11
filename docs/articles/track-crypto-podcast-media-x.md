# Using X API to Track Crypto Podcast and Media Mentions

**Meta description:** Use the X API to monitor when your crypto project, protocol, or token gets mentioned in podcasts, newsletters, and media publications announced on X, and build a structured media tracking dashboard.

---

## Introduction

Crypto media coverage drives narrative. When Bankless, Unchained, or The Block covers a protocol, the reach is significant — and most of that reach happens through X amplification. If you're running growth, PR, or research for a crypto project, knowing about media mentions in real time lets you respond, amplify, and track sentiment before coverage goes cold.

This guide walks through building a media mention tracker using X API that monitors podcast episode announcements, newsletter drops, and article publications.

---

## Mapping the Crypto Media Ecosystem

Track two categories: media publishers and their X handles.

```javascript
const CRYPTO_MEDIA = {
  podcasts: {
    '1375856780754108420': 'Bankless',
    '1044698283': 'Unchained',
    '2885738660': 'The Pomp Podcast',
    '1080988966629060608': 'Epicenter',
    '2867784826': 'Lex Fridman',
    '1217007838721974272': 'The Defiant'
  },
  newsletters: {
    '939091953548525568': 'The Block',
    '877843985': 'CoinDesk',
    '831225562': 'Cointelegraph',
    '1062469558536556545': 'Decrypt',
    '1158316035752767488': 'DL News'
  },
  research: {
    '1052524763': 'Messari',
    '1145258659832852480': 'Delphi Digital',
    '1191783824428421121': 'Kaito AI'
  }
};

const ALL_MEDIA_IDS = [
  ...Object.keys(CRYPTO_MEDIA.podcasts),
  ...Object.keys(CRYPTO_MEDIA.newsletters),
  ...Object.keys(CRYPTO_MEDIA.research)
];
```

---

## Configuring Projects to Monitor

```javascript
// Projects you want to track mentions for
const YOUR_PROJECTS = {
  tokens: ['USDC', 'ETH', 'SOL', 'ARB', 'OP'],
  protocols: ['Uniswap', 'Aave', 'Compound', 'Curve', 'Lido'],
  companies: ['Coinbase', 'Binance', 'a16z crypto', 'Paradigm']
};

function buildMentionQuery(mediaId, projects) {
  const projectList = [
    ...projects.tokens,
    ...projects.protocols,
    ...projects.companies
  ].map(p => `"${p}"`).join(' OR ');

  return `from:${mediaId} (${projectList}) -is:retweet`;
}
```

---

## Stream Rules for Media Monitoring

Because you're combining "from specific accounts" with "mentions specific projects," filtered streams are the right tool:

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function setupMediaStream() {
  // Remove existing rules first
  const existing = await client.v2.streamRules();
  if (existing.data?.length) {
    await client.v2.updateStreamRules({
      delete: { ids: existing.data.map(r => r.id) }
    });
  }

  const rules = ALL_MEDIA_IDS.flatMap(id => {
    // One rule per media outlet to keep tags meaningful
    const mediaType = Object.entries(CRYPTO_MEDIA)
      .find(([_, accounts]) => id in accounts)?.[0] || 'unknown';
    const mediaName = Object.values(CRYPTO_MEDIA).reduce((acc, outlets) => ({
      ...acc, ...outlets
    }), {})[id];

    return [{
      value: `from:${id} -is:retweet lang:en`,
      tag: `media-${mediaType}-${mediaName?.toLowerCase().replace(/\s+/g, '-')}`
    }];
  });

  await client.v2.updateStreamRules({ add: rules });
  console.log(`Added ${rules.length} media stream rules`);
}
```

---

## Processing Media Mentions

```javascript
function extractMentionedProjects(text) {
  const mentioned = {
    tokens: [],
    protocols: [],
    companies: []
  };

  for (const [category, items] of Object.entries(YOUR_PROJECTS)) {
    for (const item of items) {
      if (text.toLowerCase().includes(item.toLowerCase())) {
        mentioned[category].push(item);
      }
    }
  }

  return mentioned;
}

function detectContentType(text, url) {
  if (/ep\.|episode|#\d+|listen|podcast/i.test(text)) return 'podcast';
  if (/newsletter|digest|weekly|daily|roundup/i.test(text)) return 'newsletter';
  if (/research|report|analysis/i.test(text)) return 'research';
  if (/breaking|just in|exclusive/i.test(text)) return 'news';
  return 'article';
}

function extractSentiment(text) {
  const bullish = /bull|bullish|surge|rally|growth|adoption|milestone|major|huge/i;
  const bearish = /bear|bearish|crash|drop|fall|concern|risk|hack|exploit|fraud/i;

  if (bullish.test(text) && !bearish.test(text)) return 'positive';
  if (bearish.test(text) && !bullish.test(text)) return 'negative';
  return 'neutral';
}
```

---

## Storage and Querying

```sql
CREATE TABLE media_mentions (
  id SERIAL PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  media_outlet TEXT,
  media_type TEXT,  -- podcast, newsletter, research, news, article
  content_type TEXT,
  mentioned_tokens TEXT[],
  mentioned_protocols TEXT[],
  mentioned_companies TEXT[],
  sentiment TEXT,
  raw_text TEXT,
  tweet_url TEXT,
  article_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON media_mentions (media_outlet);
CREATE INDEX ON media_mentions (mentioned_protocols) USING GIN;
CREATE INDEX ON media_mentions (sentiment, created_at DESC);
```

```javascript
async function storeMention(tweet, mediaOutlet, mediaType, mentions, contentType) {
  const sentiment = extractSentiment(tweet.text);
  const articleUrl = tweet.entities?.urls?.[0]?.expanded_url;

  await db.query(
    `INSERT INTO media_mentions
     (tweet_id, media_outlet, media_type, content_type, mentioned_tokens,
      mentioned_protocols, mentioned_companies, sentiment, raw_text, tweet_url, article_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [
      tweet.id, mediaOutlet, mediaType, contentType,
      mentions.tokens, mentions.protocols, mentions.companies,
      sentiment, tweet.text,
      `https://x.com/i/web/status/${tweet.id}`,
      articleUrl
    ]
  );
}
```

---

## Analytics Queries

```javascript
// Mention frequency by outlet for a specific protocol
async function getMentionFrequency(protocol, days = 30) {
  return db.query(
    `SELECT media_outlet, content_type, COUNT(*) as mentions,
            COUNT(*) FILTER (WHERE sentiment='positive') as positive,
            COUNT(*) FILTER (WHERE sentiment='negative') as negative
     FROM media_mentions
     WHERE $1 = ANY(mentioned_protocols)
       AND created_at > NOW() - INTERVAL '${days} days'
     GROUP BY media_outlet, content_type
     ORDER BY mentions DESC`,
    [protocol]
  );
}

// Sentiment trend over time
async function getSentimentTrend(protocol, days = 90) {
  return db.query(
    `SELECT DATE_TRUNC('week', created_at) as week,
            sentiment, COUNT(*) as count
     FROM media_mentions
     WHERE $1 = ANY(mentioned_protocols)
       AND created_at > NOW() - INTERVAL '${days} days'
     GROUP BY week, sentiment
     ORDER BY week`,
    [protocol]
  );
}
```

---

## Alert on Major Coverage

```javascript
async function checkForMajorCoverage(tweet, mediaOutlet, mentions) {
  const majorOutlets = ['Bankless', 'The Block', 'CoinDesk', 'Messari'];
  const isMajor = majorOutlets.includes(mediaOutlet);
  const hasMentions = Object.values(mentions).flat().length > 0;

  if (isMajor && hasMentions) {
    await postToSlack('#media-mentions', {
      text: `*${mediaOutlet}* mentioned ${Object.values(mentions).flat().join(', ')}`,
      attachments: [{
        text: tweet.text,
        footer: `https://x.com/i/web/status/${tweet.id}`
      }]
    });
  }
}
```

---

## Conclusion

X API is the most efficient way to track crypto media mentions because podcasts, newsletters, and news outlets all promote their content on X first. The pipeline — media outlet stream rules, project mention extraction, sentiment tagging, and SQL analytics — gives you a full picture of how your protocol is being covered and by whom. Use this data to prioritize PR outreach, identify narrative shifts, and catch negative coverage before it amplifies.
