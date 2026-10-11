# Building a Crypto DAO Treasury Alert System with X API

**Meta description:** Build a DAO treasury alert system that monitors X for treasury movement announcements, governance spending proposals, and multisig transaction signals from major DAOs and protocol teams.

---

## Introduction

DAO treasuries hold hundreds of millions in assets, and their movement matters. When a DAO votes to diversify its treasury, fund a grant program, or move funds to a new multisig, the announcement almost always appears on X before it shows up in on-chain analytics tools. Building a system that catches these signals early gives you an edge in understanding protocol risk, funding flows, and governance health.

This guide covers building an X-based DAO treasury alert system that combines social signal monitoring with on-chain verification.

---

## Accounts to Monitor

Track both DAO governance handles and core contributor accounts who post treasury-related announcements:

```javascript
const DAO_TREASURY_ACCOUNTS = {
  // Major protocol DAOs
  '979593966768226304': { name: 'MakerDAO', token: 'MKR' },
  '1418697892000374785': { name: 'Uniswap', token: 'UNI' },
  '1267486259523227648': { name: 'Compound', token: 'COMP' },
  '1159516034903494656': { name: 'Arbitrum DAO', token: 'ARB' },
  '1549101047': { name: 'Optimism', token: 'OP' },
  '908524292': { name: 'ENS DAO', token: 'ENS' },
  '1085744273945378817': { name: 'Gitcoin', token: 'GTC' },

  // Multi-sig/treasury management
  '1059148283836198913': { name: 'Tally', token: null },
  '1130237397': { name: 'Gnosis Safe', token: null }
};
```

---

## Treasury Signal Keywords

```javascript
const TREASURY_SIGNALS = {
  // High priority — actual movement
  critical: [
    'treasury', 'multisig', 'safe wallet', 'fund transfer',
    'diversification', 'runway', 'grant disbursement', 'payment'
  ],
  // Medium — governance votes on spending
  governance: [
    'governance proposal', 'treasury proposal', 'funding proposal',
    'budget', 'working group', 'allocation', 'grant program',
    'strategic reserve', 'ecosystem fund'
  ],
  // Low — discussion, not action
  discussion: [
    'should we', 'thoughts on', 'discussion', 'temperature check',
    'RFC', 'request for comment'
  ]
};

function classifyTreasurySignal(text) {
  const lower = text.toLowerCase();

  const criticalHits = TREASURY_SIGNALS.critical.filter(k => lower.includes(k));
  const govHits = TREASURY_SIGNALS.governance.filter(k => lower.includes(k));
  const discussionHits = TREASURY_SIGNALS.discussion.filter(k => lower.includes(k));

  if (criticalHits.length >= 2) return { priority: 'CRITICAL', matches: criticalHits };
  if (criticalHits.length === 1 && govHits.length >= 1) return { priority: 'HIGH', matches: [...criticalHits, ...govHits] };
  if (govHits.length >= 2) return { priority: 'MEDIUM', matches: govHits };
  if (discussionHits.length > 0) return { priority: 'LOW', matches: discussionHits };
  return { priority: 'INFO', matches: [] };
}
```

---

## Filtered Stream Setup

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function setupTreasuryStream() {
  const fromClause = Object.keys(DAO_TREASURY_ACCOUNTS)
    .map(id => `from:${id}`)
    .join(' OR ');

  const rules = [
    {
      value: `(${fromClause}) (treasury OR multisig OR "safe wallet" OR grant OR budget OR allocation) -is:retweet`,
      tag: 'dao-treasury-official'
    },
    {
      value: '(dao treasury OR "protocol treasury" OR "ecosystem fund") (move OR transfer OR diversify OR allocate OR vote) -is:retweet lang:en',
      tag: 'dao-treasury-community'
    },
    {
      value: '(tally.xyz OR snapshot.org) (treasury OR grant OR budget OR allocation) -is:retweet',
      tag: 'dao-treasury-governance'
    }
  ];

  await client.v2.updateStreamRules({ add: rules });
}
```

---

## Extracting Dollar Amounts

Treasury announcements almost always mention dollar amounts. Extract them:

```javascript
function extractAmount(text) {
  // Match patterns like $1M, $500k, $2.5 million, 1,000,000 USDC
  const patterns = [
    { re: /\$(\d+(?:\.\d+)?)\s*B(?:illion)?/i, multiplier: 1_000_000_000 },
    { re: /\$(\d+(?:\.\d+)?)\s*M(?:illion)?/i, multiplier: 1_000_000 },
    { re: /\$(\d+(?:\.\d+)?)\s*K(?:thousand)?/i, multiplier: 1_000 },
    { re: /\$(\d{1,3}(?:,\d{3})+)/i, multiplier: 1 },
    { re: /(\d+(?:\.\d+)?)\s*M\s*(USDC|USDT|DAI|USD)/i, multiplier: 1_000_000 },
    { re: /(\d+(?:\.\d+)?)\s*K\s*(USDC|USDT|DAI|USD)/i, multiplier: 1_000 }
  ];

  for (const { re, multiplier } of patterns) {
    const match = text.match(re);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      return {
        raw: match[0],
        usdEstimate: value * multiplier
      };
    }
  }
  return null;
}
```

---

## On-Chain Treasury Verification

Cross-reference X announcements with actual on-chain balances:

```javascript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

const USDC = new ethers.Contract(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  ERC20_ABI,
  provider
);

const DAO_MULTISIGS = {
  'MakerDAO': '0x9e1585d9CA64243CE43D42f7dD7333190F66Ca09',
  'Uniswap': '0x1a9C8182C09F50C8318d769245beA52c32BE35BC',
  'Compound': '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925'
};

async function getTreasuryBalance(daoName) {
  const multisig = DAO_MULTISIGS[daoName];
  if (!multisig) return null;

  const [usdcBalance, decimals] = await Promise.all([
    USDC.balanceOf(multisig),
    USDC.decimals()
  ]);

  return {
    usdc: Number(ethers.formatUnits(usdcBalance, decimals)),
    ethBalance: Number(ethers.formatEther(await provider.getBalance(multisig)))
  };
}
```

---

## Alert Routing

```javascript
async function routeTreasuryAlert(tweet, daoInfo, classification, amount) {
  const amountStr = amount
    ? ` — ${amount.raw} (~$${(amount.usdEstimate / 1e6).toFixed(1)}M)`
    : '';

  const color = {
    CRITICAL: '#FF0000',
    HIGH: '#FF6600',
    MEDIUM: '#FFA500',
    LOW: '#FFCC00',
    INFO: '#808080'
  }[classification.priority];

  const slackPayload = {
    text: `*[${classification.priority}]* ${daoInfo.name} treasury event${amountStr}`,
    attachments: [{
      color,
      text: tweet.text,
      fields: [
        { title: 'DAO', value: daoInfo.name, short: true },
        { title: 'Token', value: daoInfo.token || 'N/A', short: true },
        { title: 'Signal', value: classification.matches.slice(0, 3).join(', '), short: false }
      ],
      footer: `https://x.com/i/web/status/${tweet.id}`
    }]
  };

  if (classification.priority === 'CRITICAL') {
    await postToSlack('#treasury-critical', slackPayload);
    await triggerPagerDuty(slackPayload, 'warning');
  } else if (classification.priority === 'HIGH') {
    await postToSlack('#treasury-alerts', slackPayload);
  } else {
    await postToSlack('#treasury-info', slackPayload);
  }
}
```

---

## Storage Schema

```sql
CREATE TABLE treasury_alerts (
  id SERIAL PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  dao_name TEXT,
  dao_token TEXT,
  priority TEXT,
  signal_matches TEXT[],
  amount_raw TEXT,
  amount_usd_estimate NUMERIC,
  on_chain_usdc_balance NUMERIC,
  on_chain_eth_balance NUMERIC,
  raw_text TEXT,
  tweet_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON treasury_alerts (dao_name, created_at DESC);
CREATE INDEX ON treasury_alerts (priority, created_at DESC);
```

---

## Conclusion

A DAO treasury alert system on X works because governance announcements, spending proposals, and fund transfers are consistently socialized before or simultaneously with on-chain execution. The architecture — filtered streams for social signals, amount extraction for sizing, on-chain verification for confirmation — gives you a complete picture of when significant treasury movements are happening across the major DAOs. Hook it into your risk monitoring stack to catch events that could affect protocol solvency or token price before they propagate.
