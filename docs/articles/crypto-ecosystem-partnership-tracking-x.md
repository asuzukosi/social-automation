# How to Use X API for Crypto Ecosystem Partnership Tracking

**Meta description:** Use the X API to detect and track crypto partnership announcements, protocol integrations, and ecosystem collaboration signals in real time from project handles and core team members.

---

## Introduction

Crypto ecosystem growth is measured in integrations. When Chainlink announces a new data feed integration, when a Layer 2 adds a new DeFi protocol to its ecosystem, or when a stablecoin issuer partners with a payment platform, these signals matter for investors, competing protocols, and BD teams. The pattern is always the same: the announcement hits X first.

This guide covers building a partnership tracking system that monitors X for collaboration announcements, classifies them by partnership type, and maintains a structured database of ecosystem relationships.

---

## Defining Partnership Signal Types

Not all partnership tweets are equal. Classify them:

```javascript
const PARTNERSHIP_TYPES = {
  INTEGRATION: {
    keywords: ['integrated', 'integration', 'now supports', 'live on', 'deployed on', 'available on'],
    description: 'Technical integration — one protocol now works with another'
  },
  COLLABORATION: {
    keywords: ['partnered', 'partnership', 'collaborating', 'working together', 'joint'],
    description: 'Strategic collaboration without deep technical integration'
  },
  GRANT: {
    keywords: ['grant', 'funded by', 'supported by', 'ecosystem grant', 'grant recipient'],
    description: 'Funding relationship'
  },
  LISTING: {
    keywords: ['listed on', 'now on', 'trading on', 'available on', 'added to'],
    description: 'Exchange or market listing'
  },
  CHAIN_EXPANSION: {
    keywords: ['deployed to', 'launching on', 'expanding to', 'going multichain', 'bridge to'],
    description: 'Protocol expanding to a new chain'
  }
};

function classifyPartnership(text) {
  const lower = text.toLowerCase();

  for (const [type, config] of Object.entries(PARTNERSHIP_TYPES)) {
    if (config.keywords.some(k => lower.includes(k))) {
      return type;
    }
  }
  return 'UNCLASSIFIED';
}
```

---

## Accounts to Monitor

Monitor a broad set of ecosystem actors — both the announcing party and the receiving party matter:

```javascript
const ECOSYSTEM_ACCOUNTS = {
  // Layer 1s and L2s
  l1l2: [
    '2906364936',    // Ethereum
    '951329744804392960', // Solana
    '1430356939962957829', // Arbitrum
    '1549101047',    // Optimism
    '1279037590381076480' // Polygon
  ],
  // DeFi protocols
  defi: [
    '1418697892000374785', // Uniswap
    '979593966768226304',  // Aave
    '1198777003',          // Curve
    '1308897707988619264'  // Across
  ],
  // Infrastructure
  infra: [
    '877425049039872001',  // Chainlink
    '1145374544',          // The Graph
    '1192481499617193984'  // Quantstamp
  ],
  // Wallets and custody
  wallets: [
    '902926941413453824',  // MetaMask
    '1137359767919939584', // Gnosis Safe
    '1087487601721159680'  // Rainbow
  ]
};

const ALL_ECOSYSTEM_IDS = Object.values(ECOSYSTEM_ACCOUNTS).flat();
```

---

## Stream Rule Configuration

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function setupPartnershipStream() {
  const fromClause = ALL_ECOSYSTEM_IDS.map(id => `from:${id}`).join(' OR ');

  const keywordClause = Object.values(PARTNERSHIP_TYPES)
    .flatMap(t => t.keywords)
    .map(k => `"${k}"`)
    .join(' OR ');

  const rules = [
    {
      // Official accounts announcing partnerships
      value: `(${fromClause}) (${keywordClause}) -is:retweet lang:en`,
      tag: 'partnership-official'
    },
    {
      // Broad partnership mentions in the ecosystem
      value: '(crypto OR defi OR web3) ("partnership" OR "integration" OR "deployed on" OR "live on") -is:retweet lang:en min_faves:50',
      tag: 'partnership-community'
    },
    {
      // Chain expansion announcements
      value: '("deployed to" OR "launching on" OR "going multichain") (ethereum OR solana OR arbitrum OR optimism OR polygon OR base) -is:retweet lang:en',
      tag: 'partnership-chain-expansion'
    }
  ];

  await client.v2.updateStreamRules({ add: rules });
}
```

---

## Extracting Partner Names

Identify which projects are mentioned in the partnership announcement:

```javascript
const KNOWN_PROJECTS = [
  'Uniswap', 'Aave', 'Compound', 'Curve', 'Balancer', 'dYdX',
  'Chainlink', 'The Graph', 'Filecoin', 'Polygon', 'Arbitrum',
  'Optimism', 'Base', 'zkSync', 'StarkNet', 'Avalanche',
  'Solana', 'Ethereum', 'Bitcoin', 'Cosmos', 'Polkadot',
  'MetaMask', 'Ledger', 'Coinbase', 'Binance', 'Kraken',
  'Lido', 'Rocket Pool', 'EigenLayer', 'Restaking'
];

function extractMentionedProjects(text, tweetMentions = []) {
  const found = new Set();

  // Match against known project names
  for (const project of KNOWN_PROJECTS) {
    if (text.toLowerCase().includes(project.toLowerCase())) {
      found.add(project);
    }
  }

  // Also extract @mentions from tweet entities
  for (const mention of tweetMentions) {
    found.add(`@${mention.username}`);
  }

  return Array.from(found);
}

function buildRelationshipEdge(authorProject, mentionedProjects, partnershipType) {
  return mentionedProjects.map(partner => ({
    source: authorProject,
    target: partner,
    type: partnershipType,
    direction: 'announced_by_source'
  }));
}
```

---

## Graph Database Storage

Partnership data is naturally a graph. Store it as edges:

```javascript
// PostgreSQL with adjacency list (works for most use cases)
async function storePartnershipEdge(edge, tweet) {
  await db.query(
    `INSERT INTO ecosystem_relationships
     (tweet_id, source_project, target_project, relationship_type,
      direction, raw_text, tweet_url, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tweet_id, target_project) DO NOTHING`,
    [
      tweet.id,
      edge.source,
      edge.target,
      edge.type,
      edge.direction,
      tweet.text,
      `https://x.com/i/web/status/${tweet.id}`,
      tweet.created_at
    ]
  );
}

// Query: what projects has Uniswap partnered with this year?
async function getProjectPartners(projectName, days = 365) {
  return db.query(
    `SELECT target_project, relationship_type, COUNT(*) as signal_count,
            array_agg(tweet_url) as sources
     FROM ecosystem_relationships
     WHERE source_project ILIKE $1
       AND created_at > NOW() - INTERVAL '${days} days'
     GROUP BY target_project, relationship_type
     ORDER BY signal_count DESC`,
    [`%${projectName}%`]
  );
}

// Query: which protocols are integrating with a given chain?
async function getChainEcosystem(chainName, days = 90) {
  return db.query(
    `SELECT source_project, relationship_type, created_at, tweet_url
     FROM ecosystem_relationships
     WHERE target_project ILIKE $1
       AND relationship_type IN ('INTEGRATION', 'CHAIN_EXPANSION')
       AND created_at > NOW() - INTERVAL '${days} days'
     ORDER BY created_at DESC`,
    [`%${chainName}%`]
  );
}
```

---

## Deduplication Across Sources

The same partnership often gets announced by both parties. Deduplicate by the project pair:

```javascript
async function isDuplicatePartnership(source, target, days = 7) {
  const result = await db.query(
    `SELECT 1 FROM ecosystem_relationships
     WHERE (
       (source_project ILIKE $1 AND target_project ILIKE $2) OR
       (source_project ILIKE $2 AND target_project ILIKE $1)
     )
     AND created_at > NOW() - INTERVAL '${days} days'
     LIMIT 1`,
    [`%${source}%`, `%${target}%`]
  );
  return result.rows.length > 0;
}
```

---

## Alert on High-Significance Partnerships

```javascript
const HIGH_VALUE_PAIRS = [
  ['Chainlink', 'any'],      // Any Chainlink integration is significant
  ['Coinbase', 'any'],
  ['Binance', 'any'],
  ['any', 'Ethereum'],       // Anything deploying to Ethereum mainnet
  ['any', 'Base']            // Base ecosystem growth
];

async function checkHighValuePartnership(edges) {
  for (const edge of edges) {
    const isHighValue = HIGH_VALUE_PAIRS.some(([src, tgt]) =>
      (src === 'any' || edge.source.includes(src)) &&
      (tgt === 'any' || edge.target.includes(tgt))
    );

    if (isHighValue) {
      await postToSlack('#partnerships-high-value', {
        text: `*New significant partnership:* ${edge.source} + ${edge.target} (${edge.type})`
      });
    }
  }
}
```

---

## Conclusion

X API partnership tracking turns unstructured announcement tweets into a structured graph of ecosystem relationships. The core pipeline — filtered streams for official accounts, keyword classification for partnership type, named entity extraction for project identification, and deduplication by project pair — gives you a continuously updated view of how the crypto ecosystem is integrating. Query it to understand chain ecosystem growth, protocol adoption curves, and competitive positioning.
