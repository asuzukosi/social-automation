# How to Monitor Crypto Protocol Governance Proposals on X

**Meta description:** Build a governance proposal monitor using X API to track DeFi protocol votes, DAO announcements, and on-chain governance signals from Compound, Uniswap, Aave, and MakerDAO.

---

## Introduction

DeFi governance moves markets. A Uniswap fee switch proposal, an Aave risk parameter change, or a MakerDAO collateral addition can shift billions in capital. Most governance participants announce, debate, and vote on proposals via X before and after on-chain actions. Monitoring this activity alongside on-chain governance APIs gives you a complete picture. This guide covers building a governance monitor using X API v2 filtered streams.

---

## Key Protocols and Governance Accounts

Target both official protocol accounts and known governance participants:

```js
// governance-targets.js
export const GOVERNANCE_PROTOCOLS = {
  uniswap:    { accounts: ['Uniswap', 'UniswapFND'], forum: 'gov.uniswap.org' },
  aave:       { accounts: ['AaveAave', 'AaveChan'], forum: 'governance.aave.com' },
  compound:   { accounts: ['compoundfinance'], forum: 'comp.xyz' },
  makerdao:   { accounts: ['MakerDAO', 'MakerGov'], forum: 'forum.makerdao.com' },
  curve:      { accounts: ['CurveFinance'], forum: 'gov.curve.fi' },
  lido:       { accounts: ['LidoFinance'], forum: 'research.lido.fi' },
  arbitrum:   { accounts: ['arbitrum', 'ArbitrumDAO'], forum: 'forum.arbitrum.foundation' },
  optimism:   { accounts: ['Optimism'], forum: 'gov.optimism.io' },
};

export const GOVERNANCE_DELEGATES = [
  'GFXlabs', 'HarvardLawBFI', 'gauntletnetworks',
  'dydx_defi', 'BlockAnalitica', 'karpatkey',
];
```

---

## Stream Rules for Governance Signals

```js
// governance-rules.js
import { GOVERNANCE_PROTOCOLS, GOVERNANCE_DELEGATES } from './governance-targets.js';

function allAccounts() {
  return Object.values(GOVERNANCE_PROTOCOLS)
    .flatMap(p => p.accounts)
    .map(a => `from:${a}`)
    .join(' OR ');
}

function allDelegates() {
  return GOVERNANCE_DELEGATES.map(d => `from:${d}`).join(' OR ');
}

export const GOVERNANCE_RULES = [
  // Official protocol governance announcements
  {
    value: `(${allAccounts()}) (proposal OR vote OR governance OR quorum OR "on-chain")`,
    tag: 'gov_official'
  },
  // Known delegates
  {
    value: `(${allDelegates()}) (vote OR proposal OR governance OR DAO) -is:retweet`,
    tag: 'gov_delegates'
  },
  // Governance keywords across DeFi
  {
    value: [
      '(governance proposal OR DAO vote OR "on-chain vote")',
      '($UNI OR $AAVE OR $COMP OR $MKR OR $CRV OR $LDO OR $ARB OR $OP)',
      '-is:retweet lang:en',
    ].join(' '),
    tag: 'gov_keyword_cashtag'
  },
  // Snapshot and Tally mentions
  {
    value: '(snapshot.org OR tally.xyz) (vote OR proposal) has:links -is:retweet',
    tag: 'gov_snapshot_tally'
  },
];
```

---

## Classifying Governance Signals

```js
// classifier.js
const VOTE_TERMS = ['vote', 'voting', 'cast', 'quorum', 'passed', 'failed', 'rejected'];
const PROPOSAL_TERMS = ['proposal', 'RFC', 'AIP', 'COMP-', 'MIP-', 'GIP-', 'ARC-'];
const DISCUSSION_TERMS = ['forum', 'discuss', 'feedback', 'temperature check', 'signal'];

export function classifyGovernanceTweet(text) {
  const t = text.toLowerCase();

  if (VOTE_TERMS.some(term => t.includes(term))) return 'VOTE_SIGNAL';
  if (PROPOSAL_TERMS.some(term => text.includes(term))) return 'PROPOSAL';
  if (DISCUSSION_TERMS.some(term => t.includes(term))) return 'DISCUSSION';
  if (/snapshot\.org|tally\.xyz/.test(t)) return 'SNAPSHOT_TALLY';
  return 'GENERAL_GOV';
}

export function extractProposalId(text) {
  // Match common proposal ID patterns: AIP-123, COMP-100, MIP-45
  const match = text.match(/\b(AIP|COMP|MIP|GIP|ARC|UIP)-(\d+)\b/i);
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}
```

---

## Database Schema

```sql
CREATE TABLE governance_signals (
  id            BIGSERIAL PRIMARY KEY,
  tweet_id      TEXT UNIQUE NOT NULL,
  protocol      TEXT,
  proposal_id   TEXT,
  signal_type   TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  username      TEXT,
  is_delegate   BOOLEAN DEFAULT false,
  text          TEXT NOT NULL,
  links         TEXT[],
  cashtags      TEXT[] DEFAULT '{}',
  likes         INT DEFAULT 0,
  retweets      INT DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL,
  captured_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_gov_protocol ON governance_signals(protocol, created_at DESC);
CREATE INDEX idx_gov_proposal ON governance_signals(proposal_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX idx_gov_signal ON governance_signals(signal_type, created_at DESC);
CREATE INDEX idx_gov_delegate ON governance_signals(is_delegate, created_at DESC);
```

---

## Correlating X Signals with On-Chain Governance

Fetch proposal data from on-chain APIs and cross-reference with X activity:

```js
// onchain.js
import axios from 'axios';

export async function getCompoundProposals() {
  const res = await axios.get('https://api.compound.finance/api/v2/governance/proposals', {
    params: { page_size: 10, state: ['pending', 'active'] }
  });
  return res.data.proposals;
}

export async function getAaveProposals() {
  const res = await axios.get('https://governance-v2-subgraph.aave.com/', {
    method: 'POST',
    data: {
      query: `{ proposals(first: 10, orderBy: createdTimestamp, orderDirection: desc) {
        id state title ipfsHash createdTimestamp
      }}`
    }
  });
  return res.data.data.proposals;
}
```

Match on-chain proposal IDs to X signals using `proposal_id` to build a timeline of social discussion around each vote.

---

## Vote Outcome Detection

```js
// outcome-detector.js
const PASS_TERMS = ['passed', 'approved', 'executed', 'succeeded', 'yes wins'];
const FAIL_TERMS = ['failed', 'rejected', 'defeated', 'quorum not met', 'no wins'];

export function detectOutcome(text) {
  const t = text.toLowerCase();
  if (PASS_TERMS.some(term => t.includes(term))) return 'PASSED';
  if (FAIL_TERMS.some(term => t.includes(term))) return 'FAILED';
  return null;
}
```

---

## Governance Activity Dashboard Query

```sql
SELECT
  protocol,
  signal_type,
  COUNT(*) as signal_count,
  COUNT(DISTINCT proposal_id) as unique_proposals,
  SUM(likes + retweets) as total_engagement,
  MAX(created_at) as last_activity
FROM governance_signals
WHERE created_at > now() - interval '7 days'
GROUP BY protocol, signal_type
ORDER BY total_engagement DESC;
```

---

## Conclusion

Monitoring DeFi governance on X requires targeting official protocol accounts, known delegates, proposal-specific keywords, and Snapshot/Tally links. Classifying signals by type (vote, proposal, discussion), extracting proposal IDs, and correlating with on-chain data creates a complete governance intelligence layer. This system enables alerting on active votes, tracking delegate positions, and measuring community sentiment before proposals reach quorum.
