# How to Build a Crypto Insider Activity Monitor with X API

**Meta description:** Build a crypto insider activity monitor that tracks wallet-linked X accounts, detects unusual posting patterns, and correlates social activity with on-chain moves.

---

## Introduction

Crypto insiders — founders, VCs, core team members, large holders — often telegraph their moves on X before they execute on-chain. A founder posting "exciting news coming soon" is sometimes followed by a token listing. A VC account going quiet right before an unlock cliff is a pattern worth noting. Monitoring insider social activity and correlating it with on-chain data is a legitimate and powerful edge.

This guide covers building a structured insider activity monitor: how to define your target list, detect posting pattern anomalies, and correlate X activity with wallet behavior.

---

## Defining "Insider" for Your Context

The definition varies by what you're tracking:

**Protocol insiders**: Founders, core devs, treasury multisig signers. Find them in GitHub commit history, protocol documentation, and team pages.

**VC and fund accounts**: Known crypto VCs that are portfolio investors in your tracked tokens. They often announce portfolio moves subtly on X.

**Whale accounts**: Accounts that have publicly linked to known large wallets, or whose identity has been correlated with large wallet activity.

**Exchange insiders**: Key staff at exchanges listing or delisting tokens.

Build a CSV or JSON config mapping X user IDs to roles:

```json
[
  { "id": "12345678", "name": "Protocol Founder", "role": "founder", "token": "MYTOKEN", "wallet": "0xabc..." },
  { "id": "87654321", "name": "Lead Investor VC", "role": "vc", "token": "MYTOKEN", "wallet": null }
]
```

---

## Monitoring Insider Accounts

Fetch recent tweets for each insider on a schedule. Avoid the filtered stream for this — use timeline polling to capture deletions and edits:

```js
import { Client } from 'twitter-api-v2';

const client = new Client(process.env.X_BEARER_TOKEN);

async function fetchInsiderTimeline(userId, sinceId = null) {
  const params = {
    max_results: 100,
    'tweet.fields': ['created_at', 'public_metrics', 'entities', 'referenced_tweets'],
    exclude: ['replies'],
  };
  if (sinceId) params.since_id = sinceId;

  const timeline = await client.v2.userTimeline(userId, params);
  return timeline.data?.data ?? [];
}

// Poll each insider every 10 minutes
async function pollAllInsiders(insiders) {
  for (const insider of insiders) {
    const tweets = await fetchInsiderTimeline(insider.id, insider.lastSeenId);
    if (tweets.length > 0) {
      await processInsiderTweets(insider, tweets);
      insider.lastSeenId = tweets[0].id;
    }
    await new Promise(r => setTimeout(r, 2000)); // 2s between accounts
  }
}
```

The 2-second delay is important. Polling 50 insider accounts at 10-minute intervals is 5 req/min, well within limits — but burst-calling all 50 simultaneously is not.

---

## Detecting Posting Pattern Anomalies

Insider accounts have baseline posting patterns. Deviations from baseline are signals:

```js
class InsiderPatternAnalyzer {
  constructor(historyDays = 30) {
    this.historyDays = historyDays;
  }

  async computeBaseline(userId) {
    const tweets = await db.query(
      `SELECT date_trunc('hour', created_at) as hour, COUNT(*) as count
       FROM insider_tweets
       WHERE author_id = $1
         AND created_at > NOW() - INTERVAL '${this.historyDays} days'
       GROUP BY hour`,
      [userId]
    );

    const hourly = tweets.rows.map(r => parseInt(r.count));
    return {
      avgPerDay: hourly.reduce((a, b) => a + b, 0) / this.historyDays,
      stdDev: this.stdDev(hourly),
    };
  }

  stdDev(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  async detectAnomaly(userId, currentDayCount) {
    const baseline = await this.computeBaseline(userId);
    const zScore = (currentDayCount - baseline.avgPerDay) / (baseline.stdDev || 1);

    return {
      isAnomaly: Math.abs(zScore) > 2.5,
      zScore,
      direction: zScore > 0 ? 'HIGH_ACTIVITY' : 'LOW_ACTIVITY',
      baseline,
    };
  }
}
```

**High activity** spikes (2.5+ standard deviations above baseline) can indicate coordinated announcement campaigns. **Low activity** drops can indicate an insider going quiet before a major move — a common pattern before token sales.

---

## Keyword Analysis for Insider Tweets

Track which topics insiders are discussing and how that changes over time:

```js
const BULLISH_SIGNALS = [
  'excited', 'thrilled', 'proud', 'announcing', 'milestone',
  'launch', 'shipping', 'live', 'mainnet', 'integration',
];

const BEARISH_SIGNALS = [
  'stepping down', 'leaving', 'resigned', 'disappointed',
  'regulatory', 'challenge', 'difficult', 'pausing',
];

const FINANCIAL_SIGNALS = [
  'raise', 'round', 'funding', 'investment', 'acquired',
  'partnership', 'deal', 'agreement',
];

function analyzeInsiderTweet(tweet, insider) {
  const lower = tweet.text.toLowerCase();

  const signals = {
    bullish: BULLISH_SIGNALS.filter(kw => lower.includes(kw)),
    bearish: BEARISH_SIGNALS.filter(kw => lower.includes(kw)),
    financial: FINANCIAL_SIGNALS.filter(kw => lower.includes(kw)),
  };

  const signalStrength = signals.bullish.length - signals.bearish.length;
  const hasFinancialSignal = signals.financial.length > 0;

  return {
    signals,
    signalStrength,
    hasFinancialSignal,
    priority: hasFinancialSignal || Math.abs(signalStrength) >= 2 ? 'HIGH' : 'NORMAL',
  };
}
```

---

## Correlating X Activity with On-Chain Wallet Data

For insiders with known wallet addresses, pull on-chain activity when posting spikes:

```js
async function checkWalletActivity(walletAddress, hoursBack = 24) {
  const response = await fetch(
    `https://api.etherscan.io/api?module=account&action=txlist` +
    `&address=${walletAddress}&sort=desc&apikey=${process.env.ETHERSCAN_KEY}`
  );
  const data = await response.json();

  const cutoff = Date.now() / 1000 - hoursBack * 3600;
  const recentTxs = data.result.filter(tx => parseInt(tx.timeStamp) > cutoff);

  return {
    recentTransactionCount: recentTxs.length,
    totalValueMoved: recentTxs.reduce((sum, tx) =>
      sum + parseFloat(tx.value) / 1e18, 0
    ),
    transactions: recentTxs.slice(0, 10),
  };
}

async function correlateInsiderActivity(insider, anomaly) {
  if (!insider.wallet || !anomaly.isAnomaly) return;

  const onchain = await checkWalletActivity(insider.wallet);

  if (onchain.recentTransactionCount > 0 && anomaly.isAnomaly) {
    await sendAlert({
      type: 'INSIDER_CORRELATION',
      insider: insider.name,
      socialAnomaly: anomaly,
      onchainActivity: onchain,
      message: `${insider.name} has unusual X activity (z=${anomaly.zScore.toFixed(1)}) with ${onchain.recentTransactionCount} on-chain txs in 24h`,
    });
  }
}
```

---

## Database Schema

```sql
CREATE TABLE insider_tweets (
  id BIGSERIAL PRIMARY KEY,
  tweet_id VARCHAR(30) UNIQUE NOT NULL,
  author_id VARCHAR(30) NOT NULL,
  insider_name VARCHAR(100),
  insider_role VARCHAR(30),
  tweet_text TEXT NOT NULL,
  signal_strength SMALLINT,
  has_financial_signal BOOLEAN DEFAULT FALSE,
  priority VARCHAR(10) DEFAULT 'NORMAL',
  created_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE insider_anomalies (
  id BIGSERIAL PRIMARY KEY,
  author_id VARCHAR(30) NOT NULL,
  z_score DECIMAL(6, 3) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  current_count INT NOT NULL,
  baseline_avg DECIMAL(8, 3),
  onchain_correlated BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Conclusion

A crypto insider activity monitor built on X API timeline polling, statistical anomaly detection, and on-chain correlation is one of the highest-signal tools a crypto developer can build. Define your insider list carefully, establish baselines before alerting, and correlate social anomalies with wallet activity to find the highest-confidence signals. Run it continuously, and you'll see patterns emerge that aren't visible anywhere else.
