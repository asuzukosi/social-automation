# Building a Crypto Token Migration Alert System with X API

**Meta description:** Build an automated crypto token migration alert system using X API to detect swap deadlines, bridge announcements, and contract upgrades before they go mainstream.

---

## Introduction

Token migrations are high-stakes events. Miss the swap window and you're holding a deprecated token on an unsupported contract. Be early and you can position around the migration narrative. Protocols announce migrations on X with varying lead times — sometimes months, sometimes days. Building an automated alert system means you never miss one.

This guide covers building a token migration alert system that monitors X for contract upgrade announcements, bridge migrations, rebranding events, and swap deadlines.

---

## What Token Migrations Look Like on X

Token migrations take several forms, each with distinct language patterns:

**Contract upgrades** — "We're migrating to V2 contract. The old token will be deprecated on [date]."

**Network migrations** — Moving from Ethereum to its own chain (or vice versa), often called a "mainnet migration" or "chain migration."

**Rebranding with new token** — New ticker, new contract, 1:1 swap from old to new.

**Bridge exploits forcing migration** — After a hack, protocols sometimes deploy a new token and compensate holders via snapshot.

**Protocol merges** — Two protocols merging issue a new combined token, requiring holders to swap from both originals.

Each pattern has different urgency. Contract upgrades with hard deadlines are the most time-sensitive.

---

## Stream Rules for Migration Detection

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

const MIGRATION_RULES = [
  {
    value: '(token OR contract) migration (date OR deadline OR swap OR migrate) lang:en -is:retweet',
    tag: 'migration-announcement',
  },
  {
    value: '"new contract" OR "contract upgrade" OR "V2 migration" OR "V3 migration" lang:en',
    tag: 'contract-upgrade',
  },
  {
    value: '("swap your" OR "migrate your") (tokens OR coins) lang:en',
    tag: 'migration-instruction',
  },
  {
    value: '("deprecated" OR "old contract" OR "legacy token") (swap OR migrate OR upgrade) lang:en',
    tag: 'deprecation-notice',
  },
  {
    value: '("mainnet migration" OR "chain migration" OR "bridge migration") lang:en',
    tag: 'network-migration',
  },
];

await client.v2.updateStreamRules({ add: MIGRATION_RULES });
```

---

## Extracting Migration Deadlines

Deadline extraction is the critical piece. Parse dates from tweet text:

```js
import chrono from 'chrono-node';

function extractMigrationDeadline(tweetText) {
  // Remove common false positives
  const cleaned = tweetText
    .replace(/\d{4,}x/gi, '')  // Remove "1000x" type strings
    .replace(/block #?\d+/gi, '');  // Remove block numbers

  const parsed = chrono.parse(cleaned);
  if (parsed.length === 0) return null;

  // Find the most future-oriented date mention
  const futureDate = parsed
    .filter(result => result.start.date() > new Date())
    .sort((a, b) => a.start.date() - b.start.date())[0];

  return futureDate?.start.date() ?? null;
}

function classifyUrgency(deadline) {
  if (!deadline) return 'UNKNOWN';
  const daysUntil = (deadline - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysUntil < 7) return 'CRITICAL';
  if (daysUntil < 30) return 'HIGH';
  if (daysUntil < 90) return 'MEDIUM';
  return 'LOW';
}
```

---

## Extracting Contract Addresses

Tweets about contract upgrades often include new contract addresses. Capture them:

```js
const CONTRACT_ADDRESS_PATTERNS = {
  ethereum: /0x[a-fA-F0-9]{40}/g,
  solana: /[1-9A-HJ-NP-Za-km-z]{32,44}/g,  // Base58, rough match
  cosmos: /cosmos1[a-z0-9]{38}/g,
};

function extractContractAddresses(text) {
  const addresses = {};
  for (const [chain, pattern] of Object.entries(CONTRACT_ADDRESS_PATTERNS)) {
    const matches = text.match(pattern);
    if (matches) addresses[chain] = [...new Set(matches)];
  }
  return addresses;
}
```

Once you have a new contract address, you can pull it into your alert to verify it on-chain:

```js
import { ethers } from 'ethers';

async function verifyNewContract(address) {
  const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
  const code = await provider.getCode(address);
  return {
    address,
    isContract: code !== '0x',
    blockNumber: await provider.getBlockNumber(),
  };
}
```

---

## Database Schema for Migration Tracking

```sql
CREATE TABLE migration_alerts (
  id BIGSERIAL PRIMARY KEY,
  tweet_id VARCHAR(30) UNIQUE NOT NULL,
  tweet_text TEXT NOT NULL,
  author_id VARCHAR(30) NOT NULL,
  author_username VARCHAR(50),
  migration_type VARCHAR(30),  -- 'contract', 'network', 'rebrand', 'merge'
  urgency VARCHAR(10),         -- 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'
  deadline TIMESTAMPTZ,
  old_contract VARCHAR(100),
  new_contract VARCHAR(100),
  chain VARCHAR(20),
  verified BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  notified_at TIMESTAMPTZ
);

CREATE INDEX ON migration_alerts (urgency, deadline);
CREATE INDEX ON migration_alerts (detected_at DESC);
```

---

## Building the Alert Pipeline

```js
async function processMigrationTweet(tweet) {
  const deadline = extractMigrationDeadline(tweet.text);
  const urgency = classifyUrgency(deadline);
  const addresses = extractContractAddresses(tweet.text);

  // Classify migration type
  const type = classifyMigrationType(tweet.text);

  const alert = await db.query(
    `INSERT INTO migration_alerts
      (tweet_id, tweet_text, author_id, migration_type, urgency, deadline, new_contract, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (tweet_id) DO NOTHING
     RETURNING *`,
    [tweet.id, tweet.text, tweet.author_id, type, urgency, deadline,
     addresses.ethereum?.[0] ?? null]
  );

  if (!alert.rows[0]) return; // duplicate

  if (urgency === 'CRITICAL') {
    await sendImmediateAlert(alert.rows[0]);
  } else if (urgency === 'HIGH') {
    await queueAlert(alert.rows[0], { delayMs: 0 });
  }
}

function classifyMigrationType(text) {
  const lower = text.toLowerCase();
  if (/rebrand|new ticker|new symbol/.test(lower)) return 'rebrand';
  if (/mainnet|chain migration|bridge migration/.test(lower)) return 'network';
  if (/merge|merger|combined token/.test(lower)) return 'merge';
  return 'contract';
}
```

---

## Scheduling Deadline Reminders

Send reminders as deadlines approach:

```js
import cron from 'node-cron';

// Run every hour
cron.schedule('0 * * * *', async () => {
  const approaching = await db.query(`
    SELECT * FROM migration_alerts
    WHERE deadline IS NOT NULL
      AND deadline > NOW()
      AND deadline < NOW() + INTERVAL '48 hours'
      AND notified_at IS NULL
    ORDER BY deadline ASC
  `);

  for (const alert of approaching.rows) {
    const hoursLeft = Math.round((new Date(alert.deadline) - Date.now()) / 3_600_000);
    await sendReminderAlert({ ...alert, hoursLeft });
    await db.query(
      'UPDATE migration_alerts SET notified_at = NOW() WHERE id = $1',
      [alert.id]
    );
  }
});
```

---

## Conclusion

Token migrations are time-sensitive and financially consequential. An X API-powered alert system that combines filtered stream monitoring, deadline extraction with chrono-node, contract address validation, and urgency classification gives you automated coverage across the entire migration lifecycle. Deploy this, point it at your tracked tokens, and you'll never miss a swap deadline again.
