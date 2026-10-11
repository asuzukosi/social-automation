# Using X API Context Annotations for Crypto Asset Classification

**Meta description:** Leverage X API context annotations to automatically classify crypto-related tweets by asset type, entity category, and topic domain without building your own NLP classifier.

---

## Introduction

X API context annotations are machine-learning-generated labels attached to tweets that identify the entities and domains a tweet is about. They're underused in crypto applications because most developers don't know they exist. When a tweet mentions Bitcoin, X may annotate it with domain `131` (Crypto) and entity labels identifying the specific asset. This guide shows you how to use context annotations to classify crypto tweets with zero NLP overhead on your end.

---

## What Context Annotations Look Like

Context annotations come back in the `context_annotations` field when you request it:

```javascript
const response = await xClient.get('tweets/search/recent', {
  query: '$BTC bullish -is:retweet lang:en',
  tweet_fields: 'context_annotations,text,public_metrics',
  max_results: 10,
});
```

A tweet about Bitcoin might return:

```json
{
  "context_annotations": [
    {
      "domain": { "id": "131", "name": "Crypto", "description": "Cryptocurrency topics" },
      "entity": { "id": "1235775236843945984", "name": "Bitcoin", "description": "Cryptocurrency" }
    },
    {
      "domain": { "id": "66", "name": "Interests and Hobbies", "description": "..." },
      "entity": { "id": "847981708595912704", "name": "Finance", "description": "..." }
    }
  ]
}
```

Each annotation has a `domain` (broad category) and `entity` (specific subject). A tweet can have multiple annotations.

---

## Key Domain IDs for Crypto Classification

X doesn't publish a complete domain taxonomy, but these are consistently relevant for crypto:

| Domain ID | Name | Use case |
|---|---|---|
| 131 | Crypto | Core crypto content |
| 66 | Interests and Hobbies | General finance interest |
| 46 | Business & Finance | Broader financial context |
| 10 | Person | When a crypto personality is mentioned |
| 11 | Organization | Exchanges, protocols as entities |
| 35 | News | Breaking news about crypto |
| 29 | Events | Conferences, launches |

Filter tweets with domain `131` to get verified crypto-classified content without relying on keyword matching:

```javascript
function isCryptoDomain(tweet) {
  return tweet.context_annotations?.some(a => a.domain.id === '131') ?? false;
}

const cryptoTweets = response.data.filter(isCryptoDomain);
```

---

## Building an Asset-Level Classification Map

Entity IDs within the Crypto domain map to specific assets. Build a reverse-lookup map from entity ID to asset:

```javascript
// Entity IDs discovered empirically from X API responses
const CRYPTO_ENTITY_MAP = {
  '1235775236843945984': 'BTC',
  '1235775237051461632': 'ETH',
  '1235775237243228160': 'LTC',
  '1273254836979396613': 'DOGE',
  '1503745728038768641': 'SOL',
  // Expand as you encounter new entity IDs in your data
};

function extractAssetFromAnnotations(contextAnnotations) {
  const assets = [];
  for (const annotation of contextAnnotations ?? []) {
    if (annotation.domain.id === '131') { // Crypto domain
      const symbol = CRYPTO_ENTITY_MAP[annotation.entity.id];
      if (symbol) assets.push(symbol);
    }
  }
  return assets;
}
```

---

## Growing the Entity Map Automatically

X introduces new entity IDs as new assets gain relevance. Auto-discover and expand your map:

```javascript
async function discoverNewCryptoEntities() {
  const query = '($BTC OR $ETH OR $SOL) -is:retweet lang:en';
  const tweets = await xClient.get('tweets/search/recent', {
    query,
    tweet_fields: 'context_annotations',
    max_results: 100,
  });

  const discovered = new Map();
  for (const tweet of tweets.data ?? []) {
    for (const annotation of tweet.context_annotations ?? []) {
      if (annotation.domain.id === '131') {
        const { id, name } = annotation.entity;
        if (!CRYPTO_ENTITY_MAP[id]) {
          discovered.set(id, name);
        }
      }
    }
  }

  if (discovered.size > 0) {
    console.log('New crypto entities discovered:', Object.fromEntries(discovered));
    // Persist to database for manual review and mapping
    await db.unknownCryptoEntity.createMany({
      data: Array.from(discovered.entries()).map(([entityId, entityName]) => ({
        entityId, entityName,
      })),
      skipDuplicates: true,
    });
  }
}
```

Run this nightly. Review the results weekly and add confirmed mappings to your entity map.

---

## Using Annotations for Filtering Instead of Keywords

Context annotations let you filter by topic without keyword lists that require constant maintenance:

```javascript
// Without annotations: fragile keyword list
const keywordFilter = text =>
  /bitcoin|btc|\$btc|satoshi/i.test(text);

// With annotations: stable, ML-maintained classification
const annotationFilter = tweet =>
  tweet.context_annotations?.some(
    a => a.domain.id === '131' && a.entity.id === '1235775236843945984'
  ) ?? false;
```

The annotation-based filter catches nuanced references that keyword matching misses — and won't break when slang evolves.

---

## Combining Annotations with Cashtags

Annotations and cashtags are complementary signals. Use both for maximum precision:

```javascript
function classifyTweet(tweet) {
  const cashtags = tweet.entities?.cashtags?.map(c => c.tag.toUpperCase()) ?? [];
  const annotatedAssets = extractAssetFromAnnotations(tweet.context_annotations);

  // High confidence: both cashtag AND annotation agree
  const highConfidence = cashtags.filter(ct => annotatedAssets.includes(ct));

  // Medium confidence: only cashtag (annotation may not have fired)
  const cashtagOnly = cashtags.filter(ct => !annotatedAssets.includes(ct));

  // Lower confidence: annotation only (implied reference, no explicit cashtag)
  const annotationOnly = annotatedAssets.filter(a => !cashtags.includes(a));

  return { highConfidence, cashtagOnly, annotationOnly };
}
```

High-confidence matches (both cashtag and annotation) are the most reliable signal for price-sensitive analysis.

---

## Filtering by Non-Crypto Domains to Find Off-Radar Mentions

Annotations also tell you when a crypto asset is mentioned in a non-crypto context — potentially valuable for detecting mainstream adoption signals:

```javascript
function isMainstreamCryptoMention(tweet) {
  const annotations = tweet.context_annotations ?? [];
  const hasCrypto = annotations.some(a => a.domain.id === '131');
  const hasNonCryptoContext = annotations.some(
    a => ['35', '29', '46'].includes(a.domain.id) && a.domain.id !== '131'
  );
  // Crypto mentioned in news/events/general finance context
  return hasCrypto && hasNonCryptoContext;
}
```

This pattern surfaces Bitcoin being discussed on financial news accounts or at conferences — different signal quality than native crypto Twitter discourse.

---

## Schema for Annotation Storage

```sql
CREATE TABLE tweet_annotations (
  tweet_id   BIGINT REFERENCES tweets(id),
  domain_id  TEXT NOT NULL,
  domain_name TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  PRIMARY KEY (tweet_id, domain_id, entity_id)
);

CREATE INDEX ON tweet_annotations (entity_id);
CREATE INDEX ON tweet_annotations (domain_id, entity_id);
```

This enables fast queries like "all tweets about ETH (entity ID) in the last 24 hours" without parsing JSONB.

---

## Conclusion

X API context annotations are X's own ML-generated topic labels — using them means you benefit from X's internal content understanding models without running your own NLP pipeline. For crypto apps, domain `131` is your entry point to verified crypto-classified content. Combine annotations with cashtags for high-confidence asset classification, auto-discover new entity IDs as the market evolves, and store annotations in indexed columns to make them queryable. It's one of the easiest quality improvements you can make to a crypto data pipeline.
