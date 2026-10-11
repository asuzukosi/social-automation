# Using X API for Layer 2 Network Status Monitoring

**Meta description:** Build a Layer 2 network status monitor that aggregates X posts from official protocol accounts and community validators to detect outages, sequencer failures, and bridge issues.

---

## Introduction

Layer 2 networks — Arbitrum, Optimism, Base, zkSync, Starknet, Polygon — have become critical infrastructure. Sequencer failures, bridge exploits, and RPC outages happen and affect billions in assets. Official status pages update slowly; X is where protocol teams, on-chain monitors, and validators post first. This guide covers building a monitoring system that aggregates L2 status signals from X and correlates them with on-chain health data.

## Identifying Signal Sources on X

Each L2 has official accounts and a community of independent monitors:

```javascript
const L2_MONITORS = {
  arbitrum: {
    official: ['arbitrum', 'offchainlabs', 'ArbitrumDevs'],
    monitors: ['theblock__', 'ChainLinkGod', 'FiatLeak'],
    keywords: ['arbitrum down', 'arbitrum sequencer', 'arbitrum outage', 'arb bridge', 'arbitrum rpc'],
  },
  optimism: {
    official: ['optimismFND', 'OptimismGov'],
    monitors: ['optimisticben', 'kelvinfichter'],
    keywords: ['optimism outage', 'op sequencer', 'op mainnet down', 'op bridge'],
  },
  base: {
    official: ['base', 'jessepollak'],
    monitors: [],
    keywords: ['base network down', 'base sequencer', 'base rpc', 'base outage'],
  },
  zksync: {
    official: ['zksync', 'zkSyncDevs'],
    monitors: [],
    keywords: ['zksync down', 'zksync outage', 'era outage', 'zksync bridge'],
  },
};
```

## Searching for Status Keywords

```javascript
async function fetchL2StatusTweets(network, bearerToken, windowMinutes = 15) {
  const config = L2_MONITORS[network];
  if (!config) throw new Error(`Unknown network: ${network}`);

  const startTime = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const keywordQuery = config.keywords.map(k => `"${k}"`).join(' OR ');
  const officialQuery = config.official.map(u => `from:${u}`).join(' OR ');
  const query = `(${keywordQuery} OR ${officialQuery}) -is:retweet lang:en`;

  const params = new URLSearchParams({
    query,
    max_results: 50,
    'tweet.fields': 'created_at,public_metrics,author_id',
    expansions: 'author_id',
    'user.fields': 'username,verified,public_metrics',
    start_time: startTime,
  });

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?${params}`,
    { headers: { Authorization: `Bearer ${bearerToken}` } }
  );

  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}
```

## Parsing Status Signal from Tweets

Not every keyword match is an outage. Score tweets by account authority and keyword severity:

```javascript
const SEVERITY_KEYWORDS = {
  critical: ['down', 'outage', 'sequencer failure', 'bridge exploit', 'hack', 'paused', 'halted'],
  warning: ['degraded', 'slow', 'delays', 'congestion', 'high latency', 'issues'],
  info: ['maintenance', 'upgrade', 'update', 'monitoring'],
};

function classifyTweet(tweet, users) {
  const user = users.find(u => u.id === tweet.author_id);
  const text = tweet.text.toLowerCase();

  let severity = null;
  for (const [level, keywords] of Object.entries(SEVERITY_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      severity = level;
      break;
    }
  }

  const isOfficial = user?.verified || user?.public_metrics?.followers_count > 50000;
  const weight = isOfficial ? 3 : 1;

  return {
    tweetId: tweet.id,
    author: user?.username,
    severity,
    weight,
    text: tweet.text.slice(0, 120),
    createdAt: tweet.created_at,
    isOfficial,
  };
}

function aggregateNetworkStatus(classifiedTweets) {
  if (!classifiedTweets.length) return { status: 'operational', confidence: 1 };

  const criticalWeight = classifiedTweets
    .filter(t => t.severity === 'critical')
    .reduce((s, t) => s + t.weight, 0);

  const warningWeight = classifiedTweets
    .filter(t => t.severity === 'warning')
    .reduce((s, t) => s + t.weight, 0);

  if (criticalWeight >= 3) return { status: 'outage', confidence: Math.min(criticalWeight / 10, 1) };
  if (criticalWeight >= 1 || warningWeight >= 5) return { status: 'degraded', confidence: 0.7 };
  if (warningWeight >= 2) return { status: 'warning', confidence: 0.5 };

  return { status: 'operational', confidence: 0.9 };
}
```

## Cross-Referencing with RPC Health Checks

Combine X signals with direct RPC health checks for higher confidence:

```javascript
async function checkRpcHealth(rpcUrl) {
  const start = Date.now();
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    const latencyMs = Date.now() - start;

    return {
      healthy: !!data.result,
      blockNumber: parseInt(data.result, 16),
      latencyMs,
    };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err.message };
  }
}

const L2_RPC_URLS = {
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  base: 'https://mainnet.base.org',
  zksync: 'https://mainnet.era.zksync.io',
};

async function getNetworkHealth(network, bearerToken) {
  const [tweetData, rpcHealth] = await Promise.all([
    fetchL2StatusTweets(network, bearerToken),
    checkRpcHealth(L2_RPC_URLS[network]),
  ]);

  const users = tweetData.includes?.users ?? [];
  const classified = (tweetData.data ?? []).map(t => classifyTweet(t, users));
  const socialStatus = aggregateNetworkStatus(classified);

  // Override: if RPC is down and social signals are critical, high confidence outage
  let finalStatus = socialStatus.status;
  if (!rpcHealth.healthy && socialStatus.status !== 'operational') {
    finalStatus = 'outage';
  }

  return {
    network,
    status: finalStatus,
    rpcHealthy: rpcHealth.healthy,
    rpcLatencyMs: rpcHealth.latencyMs,
    socialSignals: classified.filter(t => t.severity),
    checkedAt: new Date().toISOString(),
  };
}
```

## Posting Status Updates to X

When an outage is confirmed, post an alert:

```javascript
function formatL2StatusTweet(network, health) {
  const statusEmoji = {
    outage: '🔴',
    degraded: '🟡',
    warning: '🟠',
    operational: '🟢',
  };

  const emoji = statusEmoji[health.status] ?? '⚪';
  const networkName = network.charAt(0).toUpperCase() + network.slice(1);

  return `${emoji} ${networkName} Status: ${health.status.toUpperCase()}

RPC: ${health.rpcHealthy ? '✅ Responding' : '❌ Unreachable'} (${health.rpcLatencyMs}ms)
Signals: ${health.socialSignals.length} social alerts in last 15 min

#L2 #${networkName} #Ethereum`;
}
```

## Running the Monitor Loop

```javascript
async function runL2Monitor(bearerToken, postCredentials) {
  const NETWORKS = ['arbitrum', 'optimism', 'base', 'zksync'];
  const previousStatuses = new Map();

  setInterval(async () => {
    for (const network of NETWORKS) {
      const health = await getNetworkHealth(network, bearerToken);
      const prev = previousStatuses.get(network);

      // Only post when status changes
      if (prev && prev !== health.status && health.status !== 'operational') {
        const text = formatL2StatusTweet(network, health);
        await postTweet(text, postCredentials);
      }

      previousStatuses.set(network, health.status);
      console.log(`[${network}] ${health.status} | RPC: ${health.rpcHealthy}`);

      await new Promise(r => setTimeout(r, 1000));
    }
  }, 60000); // check every 60 seconds
}
```

## Conclusion

L2 network monitoring via X combines social signal aggregation with direct RPC health checks for reliable outage detection. The social layer gives you early warning; the RPC check gives you ground truth. Keep the keyword lists current as new L2s launch and protocol terminology evolves — stale keywords will cause you to miss incidents.
