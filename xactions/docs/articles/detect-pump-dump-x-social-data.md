# How to Detect Pump and Dump Schemes with X Social Data

**Meta description:** Learn how crypto developers can use X API social data, velocity analysis, and account quality scoring to detect and flag pump and dump schemes in real time.

---

## Introduction

Pump and dump schemes follow a consistent pattern on X: coordinated low-follower accounts begin posting the same cashtag simultaneously, engagement metrics spike unnaturally, and the same bullish phrases appear across unrelated accounts within minutes. X API gives developers the raw data to detect these patterns programmatically. This guide builds a pump and dump detection system using velocity analysis, account quality scoring, and coordination fingerprinting.

---

## The Detection Framework

Three independent signals, when combined, provide reliable pump detection:

1. **Velocity spike** — abnormal tweet volume for a cashtag in a short window
2. **Account quality score** — ratio of low-quality accounts posting the cashtag
3. **Text similarity** — multiple accounts posting nearly identical content

No single signal is sufficient. A legitimate listing can spike volume. Low-quality accounts can organically discuss trending assets. Text similarity can occur from copy-paste news. The combination is the signal.

---

## Monitoring Cashtag Velocity

```js
// velocity.js
import { pool } from './db.js';

export async function getCashtagVelocity(cashtag, windowMinutes = 5) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) as tweet_count,
      COUNT(DISTINCT author_id) as unique_authors,
      AVG(followers) as avg_author_followers
    FROM cashtag_stream
    WHERE cashtag = $1
      AND created_at > now() - ($2 || ' minutes')::interval
  `, [cashtag, windowMinutes]);

  return rows[0];
}

export async function getBaselineVelocity(cashtag) {
  // 7-day hourly average as baseline
  const { rows } = await pool.query(`
    SELECT AVG(hourly_count) as baseline
    FROM (
      SELECT date_trunc('hour', created_at) as hour, COUNT(*) as hourly_count
      FROM cashtag_stream
      WHERE cashtag = $1
        AND created_at BETWEEN now() - interval '7 days' AND now() - interval '1 hour'
      GROUP BY 1
    ) hourly
  `, [cashtag]);

  return parseFloat(rows[0]?.baseline || 0);
}
```

---

## Account Quality Scoring

```js
// account-quality.js
export function scoreAccount(user) {
  let score = 100; // start at 100, deduct for red flags

  const created = new Date(user.created_at);
  const ageMonths = (Date.now() - created) / (1000 * 60 * 60 * 24 * 30);
  const followers = user.public_metrics?.followers_count || 0;
  const following = user.public_metrics?.following_count || 0;
  const tweets = user.public_metrics?.tweet_count || 0;

  // New accounts
  if (ageMonths < 1) score -= 40;
  else if (ageMonths < 6) score -= 20;

  // Low follower count
  if (followers < 50) score -= 30;
  else if (followers < 500) score -= 15;

  // Suspicious follow ratio
  if (following > 0 && followers / following < 0.1) score -= 20;

  // Low tweet activity
  if (tweets < 10) score -= 25;

  // Generic username pattern (e.g., user_abc123)
  if (/^[a-zA-Z]+_?[a-z]{0,3}\d{4,}$/.test(user.username)) score -= 15;

  return Math.max(0, score);
}

export function classifyAccountQuality(score) {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}
```

---

## Text Similarity Detection

Coordinated accounts often use template messages. Detect near-duplicates using Jaccard similarity:

```js
// similarity.js
function tokenize(text) {
  return new Set(
    text.toLowerCase()
      .replace(/https?:\/\/\S+/g, '')  // remove URLs
      .replace(/[^a-z0-9$#\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

export function jaccardSimilarity(text1, text2) {
  const set1 = tokenize(text1);
  const set2 = tokenize(text2);
  const intersection = [...set1].filter(w => set2.has(w)).length;
  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : intersection / union;
}

export function detectCoordination(tweets) {
  const pairs = [];
  for (let i = 0; i < tweets.length; i++) {
    for (let j = i + 1; j < tweets.length; j++) {
      const sim = jaccardSimilarity(tweets[i].text, tweets[j].text);
      if (sim > 0.7) { // 70% similarity threshold
        pairs.push({ tweet_a: tweets[i].tweet_id, tweet_b: tweets[j].tweet_id, similarity: sim });
      }
    }
  }
  return pairs;
}
```

---

## Pump Score Calculation

Combine all signals into a single pump probability score:

```js
// pump-detector.js
export async function calculatePumpScore(cashtag, recentTweets, users) {
  const baseline = await getBaselineVelocity(cashtag);
  const current = await getCashtagVelocity(cashtag, 5);

  // Velocity multiplier (how many times above baseline)
  const velocityMultiplier = baseline > 0
    ? current.tweet_count / (baseline / 12)  // baseline is hourly, window is 5min
    : 1;

  // Account quality ratio
  const qualityScores = users.map(scoreAccount);
  const lowQualityRatio = qualityScores.filter(s => s < 40).length / qualityScores.length;

  // Coordination detection
  const coordPairs = detectCoordination(recentTweets);
  const coordinationScore = Math.min(1, coordPairs.length / 5); // normalize to 0-1

  // Weighted pump score (0-100)
  const pumpScore = Math.min(100, Math.round(
    (velocityMultiplier > 5 ? 40 : velocityMultiplier * 8) +
    (lowQualityRatio * 35) +
    (coordinationScore * 25)
  ));

  return {
    cashtag,
    pumpScore,
    velocityMultiplier: Math.round(velocityMultiplier * 10) / 10,
    lowQualityRatio: Math.round(lowQualityRatio * 100),
    coordinationPairs: coordPairs.length,
    tweetCount: current.tweet_count,
    uniqueAuthors: current.unique_authors,
  };
}
```

---

## Database Schema and Alerting

```sql
CREATE TABLE pump_detections (
  id                  BIGSERIAL PRIMARY KEY,
  cashtag             TEXT NOT NULL,
  pump_score          INT NOT NULL,
  velocity_multiplier FLOAT,
  low_quality_ratio   FLOAT,
  coordination_pairs  INT DEFAULT 0,
  tweet_count         INT,
  unique_authors      INT,
  alerted             BOOLEAN DEFAULT false,
  detected_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pump_score ON pump_detections(pump_score DESC, detected_at DESC);
CREATE INDEX idx_pump_cashtag ON pump_detections(cashtag, detected_at DESC);
```

Alert when pump score exceeds threshold:

```js
if (result.pumpScore >= 70) {
  await pool.query(`INSERT INTO pump_detections (...) VALUES (...)`, [...values]);
  await sendAlert(`⚠️ PUMP DETECTED: $${cashtag} | Score: ${result.pumpScore}/100`);
}
```

---

## Limitations and Legal Considerations

This system detects coordinated social manipulation patterns, not market manipulation as a legal matter. False positives occur around legitimate exchange listings and viral news. Never act on pump score alone — always cross-reference with price data and on-chain volume. This tool is for defensive monitoring, research, and risk management.

---

## Conclusion

Pump and dump detection using X social data requires combining three independent signals: cashtag velocity spikes above baseline, low account quality ratios among posters, and text similarity across coordinated accounts. A weighted pump score aggregates these signals into an actionable metric. The system is most effective when calibrated against historical pump events specific to the assets you monitor.
