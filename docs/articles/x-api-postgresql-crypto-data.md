# X API and PostgreSQL: Storing Crypto Social Data at Scale

**Meta description:** A technical guide for crypto developers on architecting PostgreSQL schemas, indexing strategies, and ingestion pipelines for X API crypto social data at production scale.

---

## Introduction

A filtered stream can ingest thousands of tweets per hour for active crypto markets. Without a well-designed storage layer, this data becomes unusable within days — slow queries, missed indexes, and bloated tables kill the value of real-time collection. This guide covers PostgreSQL schema design, indexing strategy, partitioning, and query patterns specifically for X API crypto social data.

---

## Core Schema Design Principles

For crypto social data, optimize for these query patterns:

- **Time-series queries** — "last N hours of data for asset X"
- **Asset-specific lookups** — "all signals for $BTC in the last 24 hours"
- **Aggregations** — "hourly sentiment averages by asset"
- **High-score filtering** — "top tweets by engagement in a window"

These patterns drive every schema decision below.

---

## Primary Tweets Table

```sql
CREATE TABLE crypto_tweets (
  id              BIGSERIAL,
  tweet_id        TEXT NOT NULL,
  author_id       TEXT NOT NULL,
  username        TEXT,
  text            TEXT NOT NULL,
  cashtags        TEXT[] NOT NULL DEFAULT '{}',
  hashtags        TEXT[] DEFAULT '{}',
  urls            TEXT[] DEFAULT '{}',
  signal_type     TEXT,
  rule_tag        TEXT,
  likes           INT NOT NULL DEFAULT 0,
  retweets        INT NOT NULL DEFAULT 0,
  replies         INT NOT NULL DEFAULT 0,
  quotes          INT NOT NULL DEFAULT 0,
  followers       INT NOT NULL DEFAULT 0,
  verified        BOOLEAN DEFAULT false,
  sentiment       TEXT,       -- BULLISH | BEARISH | NEUTRAL
  sentiment_score FLOAT,
  lang            TEXT DEFAULT 'en',
  created_at      TIMESTAMPTZ NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)  -- composite PK for partitioning
) PARTITION BY RANGE (created_at);
```

---

## Table Partitioning by Month

For high-volume streams, monthly partitions keep query performance stable as data grows:

```sql
-- Create partitions for current and next month
CREATE TABLE crypto_tweets_2025_01 PARTITION OF crypto_tweets
  FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE crypto_tweets_2025_02 PARTITION OF crypto_tweets
  FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Automate partition creation with a function
CREATE OR REPLACE FUNCTION create_monthly_partition(target_date DATE)
RETURNS void AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  start_date := DATE_TRUNC('month', target_date);
  end_date := start_date + INTERVAL '1 month';
  partition_name := 'crypto_tweets_' || TO_CHAR(start_date, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF crypto_tweets FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );
END;
$$ LANGUAGE plpgsql;
```

Call `SELECT create_monthly_partition(CURRENT_DATE + INTERVAL '1 month')` from a monthly cron job.

---

## Indexing Strategy

```sql
-- Time + cashtag: most common query pattern
CREATE INDEX idx_tweets_cashtag_time ON crypto_tweets
  USING GIN(cashtags) WHERE array_length(cashtags, 1) > 0;

-- Created_at for time-range queries (per partition)
CREATE INDEX idx_tweets_time ON crypto_tweets(created_at DESC);

-- Signal type filtering
CREATE INDEX idx_tweets_signal ON crypto_tweets(signal_type, created_at DESC)
  WHERE signal_type IS NOT NULL;

-- High-engagement tweets
CREATE INDEX idx_tweets_engagement ON crypto_tweets(
  (likes + retweets * 3 + quotes * 2) DESC, created_at DESC
);

-- Author lookup
CREATE INDEX idx_tweets_author ON crypto_tweets(author_id, created_at DESC);

-- Deduplication
CREATE UNIQUE INDEX idx_tweets_tweet_id ON crypto_tweets(tweet_id);
```

---

## Efficient Bulk Ingestion

Batch inserts dramatically outperform single-row inserts for stream data:

```js
// ingester.js
import { pool } from './db.js';

const BATCH_SIZE = 100;
const FLUSH_INTERVAL = 2000; // 2 seconds

let buffer = [];
let flushTimer = null;

export function queueTweet(tweet) {
  buffer.push(tweet);
  if (buffer.length >= BATCH_SIZE) {
    flushBuffer();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL);
  }
}

async function flushBuffer() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!buffer.length) return;

  const batch = buffer.splice(0, buffer.length);

  const values = batch.map((t, i) => {
    const base = i * 14;
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14})`;
  }).join(',');

  const params = batch.flatMap(t => [
    t.tweet_id, t.author_id, t.username, t.text,
    t.cashtags, t.hashtags, t.signal_type, t.rule_tag,
    t.likes, t.retweets, t.followers, t.sentiment,
    t.sentiment_score, t.created_at,
  ]);

  await pool.query(`
    INSERT INTO crypto_tweets
      (tweet_id,author_id,username,text,cashtags,hashtags,signal_type,
       rule_tag,likes,retweets,followers,sentiment,sentiment_score,created_at)
    VALUES ${values}
    ON CONFLICT (tweet_id) DO NOTHING
  `, params);
}
```

---

## Materialized Views for Aggregations

Pre-compute hourly aggregations to avoid expensive real-time GROUP BY queries:

```sql
CREATE MATERIALIZED VIEW hourly_sentiment AS
SELECT
  date_trunc('hour', created_at)           AS hour,
  UNNEST(cashtags)                          AS asset,
  AVG(sentiment_score)                      AS avg_score,
  COUNT(*) FILTER (WHERE sentiment = 'BULLISH') AS bullish,
  COUNT(*) FILTER (WHERE sentiment = 'BEARISH') AS bearish,
  COUNT(*)                                  AS total,
  SUM(likes + retweets)                     AS total_engagement
FROM crypto_tweets
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2
WITH NO DATA;

CREATE UNIQUE INDEX ON hourly_sentiment(hour, asset);

-- Refresh every 15 minutes via pg_cron or application cron
SELECT cron.schedule('refresh-sentiment', '*/15 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY hourly_sentiment');
```

---

## Common Query Patterns

Rolling 24-hour sentiment per asset:

```sql
SELECT asset, AVG(avg_score) as sentiment_24h, SUM(total) as tweet_count
FROM hourly_sentiment
WHERE hour > now() - interval '24 hours'
GROUP BY asset
ORDER BY tweet_count DESC;
```

Top tweets for an asset in a window:

```sql
SELECT tweet_id, username, text, likes, retweets, created_at
FROM crypto_tweets
WHERE 'BTC' = ANY(cashtags)
  AND created_at > now() - interval '4 hours'
ORDER BY likes + (retweets * 3) DESC
LIMIT 20;
```

---

## Connection Pooling

Use pgBouncer or the `pg` pool configuration to avoid connection exhaustion:

```js
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,           // max connections per process
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

## Conclusion

Storing X API crypto social data at scale requires partitioned tables by time, GIN indexes on cashtag arrays, batch ingestion with buffering, and materialized views for aggregation queries. This schema handles millions of tweets per month without query degradation. The investment in schema design upfront pays off immediately — poorly indexed crypto social tables become unusable within weeks of production streaming.
