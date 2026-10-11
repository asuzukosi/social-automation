# Best Practices for X API Data Storage in Crypto Apps

**Meta description:** Learn how to efficiently store, index, and query X API data in crypto applications using PostgreSQL, Redis, and time-series databases for real-time analytics.

---

## Introduction

Crypto apps built on X API data face a specific storage problem: high-velocity ingest, time-sensitive queries, and the need to correlate social signals with on-chain events. A naive approach — dumping raw tweet JSON into a single table — collapses under load within days. This guide covers the storage architecture decisions that hold up in production.

---

## Choose the Right Database for Each Data Type

Not all X API data ages the same way. Structured it into three tiers:

**Hot data (0–72 hours):** Redis sorted sets. Store tweet IDs and engagement scores with a TTL. Ideal for trending token feeds, real-time KOL activity, and alert triggers.

**Warm data (3–30 days):** PostgreSQL with JSONB columns. Full tweet payloads, author metadata, and aggregated metrics land here. Index on `author_id`, `created_at`, and cashtag arrays extracted at ingest time.

**Cold data (30+ days):** S3-compatible object storage. Archive raw NDJSON payloads for compliance and future model training. Reference via `s3_key` column in Postgres.

---

## Schema Design for Crypto-Specific Queries

A flat `tweets` table won't cut it when you need to answer "which wallets are being mentioned alongside $SOL in the last 6 hours?"

```sql
CREATE TABLE tweets (
  id            BIGINT PRIMARY KEY,
  author_id     BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  text          TEXT NOT NULL,
  lang          CHAR(5),
  metrics       JSONB,           -- { like_count, retweet_count, reply_count }
  entities      JSONB,           -- cashtags, hashtags, urls, mentions
  context_annotations JSONB,     -- X API topic classifications
  s3_key        TEXT             -- cold storage reference
);

CREATE INDEX ON tweets (author_id, created_at DESC);
CREATE INDEX ON tweets USING GIN (entities);
CREATE INDEX ON tweets (created_at DESC);
```

Extract cashtags at ingest time into a separate lookup table for fast joins:

```sql
CREATE TABLE tweet_cashtags (
  tweet_id   BIGINT REFERENCES tweets(id),
  symbol     TEXT NOT NULL,
  PRIMARY KEY (tweet_id, symbol)
);

CREATE INDEX ON tweet_cashtags (symbol, tweet_id);
```

This lets you run `SELECT tweet_id FROM tweet_cashtags WHERE symbol = 'ETH'` in milliseconds without full-text scanning.

---

## Redis for Real-Time Leaderboards

Use Redis sorted sets to maintain live KOL engagement leaderboards:

```javascript
// Increment author score on each tweet ingest
await redis.zincrby('kol:leaderboard:24h', engagementScore, authorId);

// Expire the set daily
await redis.expireat('kol:leaderboard:24h', nextMidnightUnix);

// Read top 20 KOLs
const top = await redis.zrevrange('kol:leaderboard:24h', 0, 19, 'WITHSCORES');
```

Store per-token mention counts similarly:

```javascript
await redis.zincrby('token:mentions:1h', 1, cashtag);
```

Set a 1-hour TTL and refresh the key each time you receive data, not on a fixed schedule.

---

## Deduplication at Ingest

The X API filtered stream and search endpoints can return the same tweet ID multiple times — especially when you use multiple rules that match overlapping tweets. Always deduplicate before writing:

```javascript
async function ingestTweet(tweet) {
  const exists = await redis.getset(`dedup:${tweet.id}`, '1');
  if (exists) return; // already processed
  await redis.expire(`dedup:${tweet.id}`, 3600);
  await db.tweet.upsert({
    where: { id: tweet.id },
    update: { metrics: tweet.public_metrics },
    create: mapTweetToRow(tweet),
  });
}
```

The `upsert` handles race conditions from parallel workers; the Redis check short-circuits the database round-trip in the common case.

---

## Partitioning for Scale

If you're ingesting more than 500K tweets per day, partition `tweets` by time:

```sql
CREATE TABLE tweets (
  id         BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  ...
) PARTITION BY RANGE (created_at);

CREATE TABLE tweets_2026_q1 PARTITION OF tweets
  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01');
```

Old partitions can be detached and archived without locking the live table.

---

## Compliance and Data Retention

X API Terms of Service prohibit indefinite storage of full tweet text for most use cases. Implement automated purging:

```sql
DELETE FROM tweets WHERE created_at < NOW() - INTERVAL '30 days';
```

Run this as a scheduled job (cron or Bull queue), not inline. Log deletions to a separate audit table that stores only tweet IDs, not content.

Store only what you query. Storing full raw JSON for every tweet is expensive and often unnecessary — extract the fields you need at ingest and discard the rest.

---

## Conclusion

Solid X API data storage in crypto apps comes down to three things: tier your storage by data temperature, design your schema around the queries you'll actually run, and deduplicate aggressively at ingest. PostgreSQL with JSONB handles the analytical workload; Redis handles the real-time layer. Get this foundation right before adding time-series databases or data warehouses — most crypto apps don't need them until they're past 50M rows.
