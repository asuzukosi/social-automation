# How to Monitor Crypto Protocol Fee Changes on X

**Meta description:** Build a system to monitor when DeFi protocols announce fee changes, governance votes on fees, and parameter updates on X, combining social signals with on-chain verification.

---

## Introduction

Protocol fee changes are high-signal events. When Uniswap governance passes a fee switch, when Aave adjusts borrow rates, or when a DEX changes its LP fee tier structure, traders, LPs, and arbitrageurs need to know immediately. These changes are almost always announced on X — by protocol accounts, governance forums, and core contributors — before they're reflected on any dashboard.

This guide shows how to monitor fee change announcements on X and correlate them with on-chain data.

---

## Target Accounts and Signal Types

### Protocol Accounts to Watch

```javascript
const FEE_MONITORED_ACCOUNTS = {
  // DEXes — LP fee changes
  '1418697892000374785': 'Uniswap',
  '1198777003': 'Curve Finance',
  '879591924907053056': 'Balancer',
  '1266749749674369026': 'dYdX',

  // Lending — borrow/supply rate changes
  '979593966768226304': 'Aave',
  '803378429887709184': 'Compound',
  '1060163355088392193': 'Morpho',

  // Bridges — bridge fee changes
  '1319489920241803270': 'Stargate',
  '1308897707988619264': 'Across Protocol',

  // Governance forums that post on X
  '1059148283836198913': 'Tally',
  '1065376876237479937': 'Snapshot'
};
```

### Fee Change Signal Patterns

```javascript
const FEE_SIGNAL_PATTERNS = {
  // Governance proposals
  governance: [
    /governance\s*(proposal|vote|snapshot)/i,
    /\bSIP[-\s]?\d+\b/i,      // Snapshot Improvement Proposal
    /\bAIP[-\s]?\d+\b/i,      // Aave Improvement Proposal
    /\bGIP[-\s]?\d+\b/i,      // General Improvement Proposal
    /on-?chain\s*(vote|governance)/i
  ],
  // Direct fee announcements
  feeChange: [
    /fee\s*(update|change|reduction|increase|switch|tier)/i,
    /\b(borrow|supply|protocol|swap|bridge)\s*fee/i,
    /basis\s*points?\s*(reduced|increased|changed|now)/i,
    /\bbps\b.*?(reduced|increased|from|to)/i,
    /fee\s*from\s*\d+.*?to\s*\d+/i
  ],
  // Parameter changes (broader)
  paramChange: [
    /parameter\s*(update|change|adjustment)/i,
    /interest\s*(rate|model)\s*(update|change)/i,
    /liquidation\s*(threshold|penalty)\s*(change|update)/i,
    /collateral\s*(factor|ratio)\s*(changed|updated)/i
  ]
};
```

---

## Stream Configuration

```javascript
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function setupFeeMonitorStream() {
  const fromIds = Object.keys(FEE_MONITORED_ACCOUNTS);
  const fromClause = fromIds.map(id => `from:${id}`).join(' OR ');

  const rules = [
    {
      value: `(${fromClause}) (fee OR governance OR parameter OR bps OR "basis points") -is:retweet`,
      tag: 'protocol-fee-official'
    },
    {
      // Catch fee discussions from anyone mentioning major protocols
      value: '"fee switch" OR "fee change" OR "fee reduction" (uniswap OR aave OR compound OR curve) -is:retweet lang:en',
      tag: 'protocol-fee-community'
    },
    {
      // Governance votes on fees
      value: '(snapshot.org OR tally.xyz) (fee OR "basis points" OR "borrow rate" OR "supply rate") -is:retweet',
      tag: 'protocol-fee-governance'
    }
  ];

  await client.v2.updateStreamRules({ add: rules });
}
```

---

## Parsing Fee Change Details

Extract specific fee values from tweet text:

```javascript
function parseFeeDetails(text) {
  const result = {
    signalType: 'UNKNOWN',
    feeType: null,
    oldValue: null,
    newValue: null,
    unit: null,
    isGovernance: false,
    proposalId: null,
    governanceUrl: null
  };

  // Detect signal type
  for (const [type, patterns] of Object.entries(FEE_SIGNAL_PATTERNS)) {
    if (patterns.some(p => p.test(text))) {
      result.signalType = type.toUpperCase();
      break;
    }
  }

  result.isGovernance = FEE_SIGNAL_PATTERNS.governance.some(p => p.test(text));

  // Extract numeric fee values — "from 30 bps to 20 bps" or "from 0.3% to 0.05%"
  const bpsFromTo = text.match(/from\s*(\d+(?:\.\d+)?)\s*bps\s*to\s*(\d+(?:\.\d+)?)\s*bps/i);
  const pctFromTo = text.match(/from\s*(\d+(?:\.\d+)?)%\s*to\s*(\d+(?:\.\d+)?)%/i);

  if (bpsFromTo) {
    result.oldValue = parseFloat(bpsFromTo[1]);
    result.newValue = parseFloat(bpsFromTo[2]);
    result.unit = 'bps';
  } else if (pctFromTo) {
    result.oldValue = parseFloat(pctFromTo[1]);
    result.newValue = parseFloat(pctFromTo[2]);
    result.unit = 'percent';
  }

  // Extract proposal ID
  const proposalMatch = text.match(/\b([A-Z]+IP[-\s]?\d+)\b/i);
  if (proposalMatch) result.proposalId = proposalMatch[1];

  // Extract governance URL
  const urlMatch = text.match(/https?:\/\/(snapshot\.org|tally\.xyz|gov\.\w+)\S*/i);
  if (urlMatch) result.governanceUrl = urlMatch[0];

  // Detect fee type
  if (/\bswap\s*fee/i.test(text)) result.feeType = 'swap';
  else if (/\bborrow\s*fee/i.test(text)) result.feeType = 'borrow';
  else if (/\bsupply\s*fee/i.test(text) || /\bsupply\s*rate/i.test(text)) result.feeType = 'supply';
  else if (/\bbridge\s*fee/i.test(text)) result.feeType = 'bridge';
  else if (/\bliquidity|LP\s*fee/i.test(text)) result.feeType = 'lp';
  else if (/\bprotocol\s*fee/i.test(text)) result.feeType = 'protocol';

  return result;
}
```

---

## On-Chain Correlation

When you detect a fee change announcement, verify it on-chain using a public RPC:

```javascript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);

// Example: check Uniswap v3 pool fee for a specific pool
async function verifyUniswapFee(poolAddress) {
  const poolAbi = ['function fee() view returns (uint24)'];
  const pool = new ethers.Contract(poolAddress, poolAbi, provider);
  const fee = await pool.fee();
  return fee; // Returns fee in units of 1/1000000 (e.g., 3000 = 0.3%)
}

async function correlateOnChain(parsedFee, protocol) {
  try {
    if (protocol === 'Uniswap' && parsedFee.newValue) {
      // Fetch top pools and verify fee tiers changed
      const onChainFee = await verifyUniswapFee(
        process.env.UNISWAP_USDC_ETH_POOL
      );
      return {
        verified: true,
        onChainValue: onChainFee / 10000, // convert to bps
        matches: Math.abs(onChainFee / 10000 - parsedFee.newValue) < 1
      };
    }
  } catch (err) {
    return { verified: false, error: err.message };
  }
}
```

---

## Storage and Alerting

```javascript
async function storeFeeChangeEvent(tweet, protocol, parsed, onChain) {
  await db.query(
    `INSERT INTO fee_change_events
     (tweet_id, protocol, signal_type, fee_type, old_value, new_value, unit,
      is_governance, proposal_id, governance_url, on_chain_verified,
      on_chain_value, raw_text, tweet_url, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (tweet_id) DO NOTHING`,
    [
      tweet.id, protocol, parsed.signalType, parsed.feeType,
      parsed.oldValue, parsed.newValue, parsed.unit,
      parsed.isGovernance, parsed.proposalId, parsed.governanceUrl,
      onChain?.verified, onChain?.onChainValue,
      tweet.text, `https://x.com/i/web/status/${tweet.id}`,
      tweet.created_at
    ]
  );
}

async function alertFeeChange(protocol, parsed, tweet) {
  const direction = parsed.oldValue && parsed.newValue
    ? parsed.newValue < parsed.oldValue ? 'DECREASED' : 'INCREASED'
    : 'CHANGED';

  const valueStr = parsed.oldValue && parsed.newValue
    ? `${parsed.oldValue} → ${parsed.newValue} ${parsed.unit}`
    : '';

  await postToSlack('#fee-changes', {
    text: `*[${protocol}]* ${parsed.feeType || 'protocol'} fee ${direction} ${valueStr}`,
    attachments: [{
      color: direction === 'DECREASED' ? '#00AA00' : '#FF6600',
      text: tweet.text,
      footer: `https://x.com/i/web/status/${tweet.id}`
    }]
  });
}
```

---

## Conclusion

Monitoring crypto protocol fee changes on X requires a two-layer approach: filtered streams for real-time social signals, and on-chain verification to confirm the announcement reflects an actual state change. The keyword parser handles the variability in how protocols communicate changes — some use bps, some use percentages, some post governance links. The on-chain correlation layer catches false positives (discussions, not announcements) and validates the numeric values mentioned.
