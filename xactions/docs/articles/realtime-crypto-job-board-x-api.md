# How to Build a Real-Time Crypto Job Board via X API

**Meta description:** Build a real-time crypto job board by scraping and monitoring job postings on X from crypto companies, DAOs, and protocols using the X API filtered stream and search endpoints.

---

## Introduction

Crypto hiring happens on X before it appears anywhere else. Protocol teams, DAOs, and crypto startups post open roles directly on X, often before updating their career pages or posting to job boards. Building a job aggregator that monitors X in real time gives candidates and researchers a significant timing advantage.

This guide covers scraping job postings from X, normalizing them into structured listings, and serving them through a queryable API.

---

## Signal Detection: What Does a Job Tweet Look Like?

Crypto job postings on X follow recognizable patterns. Map them before writing rules:

```javascript
const JOB_PATTERNS = {
  explicit: [
    /\bwe['']re hiring\b/i,
    /\bwe are hiring\b/i,
    /\bjob opening\b/i,
    /\bopen role\b/i,
    /\bnow hiring\b/i,
    /\bapply now\b/i,
    /\bjoin our team\b/i
  ],
  roleKeywords: [
    'engineer', 'developer', 'researcher', 'analyst', 'designer',
    'product manager', 'devrel', 'solidity', 'rust developer',
    'protocol engineer', 'smart contract', 'technical lead'
  ],
  daoSpecific: [
    'contributor', 'grant', 'bounty', 'governance', 'working group',
    'subDAO', 'delegate', 'steward'
  ]
};

function isJobPosting(text) {
  const lower = text.toLowerCase();
  const hasExplicit = JOB_PATTERNS.explicit.some(p => p.test(text));
  const hasRole = JOB_PATTERNS.roleKeywords.some(k => lower.includes(k));
  const hasHiring = lower.includes('hiring') || lower.includes('looking for');
  return hasExplicit || (hasRole && hasHiring);
}
```

---

## Filtered Stream Setup

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function setupJobStreamRules() {
  const rules = [
    {
      value: '(we\'re hiring OR "we are hiring" OR "now hiring" OR "open role" OR "join our team") (crypto OR web3 OR defi OR blockchain OR solidity OR ethereum OR solana) -is:retweet lang:en',
      tag: 'crypto-jobs-general'
    },
    {
      value: '("solidity developer" OR "smart contract engineer" OR "protocol engineer" OR "devrel" OR "blockchain engineer") (hiring OR apply OR role OR position) -is:retweet lang:en',
      tag: 'crypto-jobs-technical'
    },
    {
      value: '(DAO OR protocol OR L2) ("looking for" OR "seeking" OR hiring) (engineer OR researcher OR contributor) -is:retweet lang:en',
      tag: 'crypto-jobs-dao'
    }
  ];

  await client.v2.updateStreamRules({ add: rules });
}
```

---

## Parsing Job Listings from Tweet Text

Extract structured data from unstructured tweet text:

```javascript
const ROLE_TYPES = [
  'engineer', 'developer', 'researcher', 'analyst', 'designer',
  'product manager', 'devrel', 'writer', 'marketer', 'recruiter',
  'operations', 'legal', 'finance', 'cto', 'vp', 'head of'
];

const TECH_STACK = [
  'solidity', 'rust', 'typescript', 'go', 'python', 'cairo',
  'move', 'javascript', 'c++', 'wasm', 'haskell'
];

const LOCATION_SIGNALS = ['remote', 'onsite', 'hybrid', 'worldwide', 'us only', 'eu'];

function parseJobTweet(text, author) {
  const lower = text.toLowerCase();

  const roleType = ROLE_TYPES.find(r => lower.includes(r)) || 'unspecified';
  const techStack = TECH_STACK.filter(t => lower.includes(t));
  const location = LOCATION_SIGNALS.find(l => lower.includes(l)) || 'unspecified';

  // Extract apply link if present
  const urlMatch = text.match(/https?:\/\/\S+/);
  const applyUrl = urlMatch ? urlMatch[0] : null;

  // Detect compensation signals
  const hasSalary = /\$\d+k?|\d+k\s*(usd|usdc|salary|comp)/i.test(text);
  const hasEquity = /equity|token|options|vesting/i.test(text);

  return {
    authorId: author.id,
    authorHandle: author.username,
    authorName: author.name,
    roleType,
    techStack,
    location,
    applyUrl,
    hasSalary,
    hasEquity,
    rawText: text
  };
}
```

---

## Enriching with Company Data

Resolve the posting author into a company profile:

```javascript
async function enrichWithCompanyData(authorId) {
  const cacheKey = `company:${authorId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const { data: user } = await client.v2.user(authorId, {
    'user.fields': ['description', 'entities', 'public_metrics', 'url', 'verified']
  });

  const company = {
    id: user.id,
    handle: user.username,
    name: user.name,
    description: user.description,
    website: user.entities?.url?.urls?.[0]?.expanded_url || null,
    followersCount: user.public_metrics?.followers_count,
    verified: user.verified
  };

  await redis.setEx(cacheKey, 3600 * 6, JSON.stringify(company));
  return company;
}
```

---

## Storage Schema

```sql
CREATE TABLE crypto_jobs (
  id SERIAL PRIMARY KEY,
  tweet_id TEXT UNIQUE NOT NULL,
  author_id TEXT NOT NULL,
  author_handle TEXT,
  author_name TEXT,
  company_website TEXT,
  role_type TEXT,
  tech_stack TEXT[],
  location TEXT,
  apply_url TEXT,
  has_salary BOOLEAN DEFAULT false,
  has_equity BOOLEAN DEFAULT false,
  raw_text TEXT,
  tweet_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX ON crypto_jobs (role_type);
CREATE INDEX ON crypto_jobs (tech_stack) USING GIN;
CREATE INDEX ON crypto_jobs (created_at DESC);
CREATE INDEX ON crypto_jobs (is_active, created_at DESC);
```

---

## REST API for the Job Board

```javascript
import express from 'express';
const router = express.Router();

router.get('/jobs', async (req, res) => {
  const { role, tech, location, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT * FROM crypto_jobs
    WHERE is_active = true AND expires_at > NOW()
  `;
  const params = [];

  if (role) {
    params.push(role);
    query += ` AND role_type = $${params.length}`;
  }
  if (tech) {
    params.push(tech.toLowerCase());
    query += ` AND $${params.length} = ANY(tech_stack)`;
  }
  if (location) {
    params.push(`%${location.toLowerCase()}%`);
    query += ` AND LOWER(location) LIKE $${params.length}`;
  }

  params.push(limit, offset);
  query += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await db.query(query, params);
  res.json({ jobs: rows, page: parseInt(page), limit: parseInt(limit) });
});
```

---

## Expiring Stale Listings

Job postings older than 30 days are usually filled. Auto-expire them:

```javascript
// Run daily via cron
async function expireOldJobs() {
  const result = await db.query(
    `UPDATE crypto_jobs SET is_active = false
     WHERE expires_at < NOW() AND is_active = true
     RETURNING tweet_id`
  );
  console.log(`Expired ${result.rowCount} job listings`);
}
```

---

## Conclusion

A real-time crypto job board built on X API filtered streams captures postings the moment they go live — before job boards, newsletters, or aggregators pick them up. The core pipeline is: stream detection with keyword rules, text parsing for role/tech/location, company enrichment via user lookup, and a queryable SQL backend with time-based expiry. Add a frontend and you have a functional product in a few hundred lines of code.
