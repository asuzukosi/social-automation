# Using X API Context Annotations to Filter Noise in Crypto Data

**Meta description:** Learn how to use X API context annotations to filter crypto social data noise, targeting tweets about specific entities, domains, and topics with precision.

---

## Introduction

When you run a filtered stream for crypto terms, you get noise. A tweet containing "bitcoin" might be financial analysis, a meme, a customer complaint about a non-crypto product sharing the name, or a bot post with no informational value. X's context annotations solve this at the API layer — before the tweet reaches your application — by classifying tweets using X's internal entity and domain taxonomy. Filtering on these annotations lets you target, for example, tweets that X itself has classified as being about Bitcoin the cryptocurrency, rather than anything that happens to contain the word.

This guide explains the context annotation schema, how to use it in stream rules and post-processing, and practical applications for crypto data quality improvement.

---

## Understanding Context Annotations

X's backend runs a classifier that tags tweets with two fields: `domain` and `entity`. The `domain` is the broad category; the `entity` is the specific subject. Both have numeric IDs.

Relevant domains for crypto work:

| Domain ID | Domain Name |
|---|---|
| 21 | Technology |
| 131 | Unified Twitter Taxonomy |
| 137 | Financial Services |
| 138 | Financial Services — Crypto |
| 67 | Cryptocurrency |

Within domain 67 (Cryptocurrency), common entity examples:
- Bitcoin (`id: 1007360414114435072`)
- Ethereum (`id: 1148346529781497856`)
- DeFi (various entity IDs per protocol)

The exact IDs are not fully documented publicly, so you must discover them empirically from tweet data.

---

## Requesting Context Annotations from the API

Add `context_annotations` to your `tweet.fields` request:

```javascript
// src/annotations/annotatedStream.js
import fetch from 'node-fetch';

const BEARER = process.env.X_BEARER_TOKEN;

export async function startAnnotatedStream(onTweet) {
  const stream = await fetch(
    'https://api.twitter.com/2/tweets/search/stream' +
    '?tweet.fields=created_at,author_id,context_annotations,public_metrics' +
    '&expansions=author_id&user.fields=username,verified',
    { headers: { Authorization: `Bearer ${BEARER}` } }
  );

  for await (const chunk of stream.body) {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.data?.context_annotations) {
          onTweet(event);
        }
        // Tweets without context_annotations are more likely to be noise
      } catch (_) {}
    }
  }
}
```

---

## Building a Context Annotation Registry

Discover which entity IDs map to which crypto assets by accumulating annotations from a broad stream. Log everything for the first 24 hours of operation.

```javascript
// src/annotations/registry.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function learnAnnotations(tweetEvent) {
  const annotations = tweetEvent.data.context_annotations ?? [];

  for (const ann of annotations) {
    await prisma.annotationRegistry.upsert({
      where: { entityId: ann.entity.id },
      create: {
        entityId: ann.entity.id,
        entityName: ann.entity.name,
        domainId: ann.domain.id,
        domainName: ann.domain.name,
        observedCount: 1
      },
      update: {
        observedCount: { increment: 1 }
      }
    });
  }
}
```

After 24 hours, query your registry to find the entity IDs corresponding to your crypto assets of interest.

---

## Using Context Annotations in Stream Rules

Once you have entity IDs, you can use them directly in filter rules for precise targeting:

```javascript
// config/annotationFilterRules.js
// Entity IDs discovered empirically from your annotation registry
const BITCOIN_ENTITY_ID = '1007360414114435072';
const ETHEREUM_ENTITY_ID = '1148346529781497856';
const DEFI_DOMAIN_ID = '67';

export const ANNOTATION_RULES = [
  {
    // Tweets X has classified as being about Bitcoin — much more precise than keyword matching
    value: `context:${DEFI_DOMAIN_ID}.${BITCOIN_ENTITY_ID} -is:retweet`,
    tag: 'bitcoin-classified'
  },
  {
    // DeFi domain, any entity — catches all X-classified DeFi content
    value: `context:${DEFI_DOMAIN_ID}.* (price OR yield OR TVL OR exploit) -is:retweet lang:en`,
    tag: 'defi-financial'
  }
];
```

The `context:domain.entity` operator is one of the most underused precision filters in the X API. It eliminates an entire class of false positives that keyword rules produce.

---

## Post-Processing: Filtering by Annotation After Ingestion

For use cases where you need to apply annotation filters after ingestion (e.g., when categorizing stored tweets), implement a classifier:

```javascript
// src/annotations/annotationFilter.js

// Curated set of entity IDs we care about — built from your registry
const CRYPTO_ENTITY_IDS = new Set([
  '1007360414114435072', // Bitcoin
  '1148346529781497856', // Ethereum
  '1151490530655858688', // DeFi (example)
  '1338721010030067712', // NFT (example)
  // ... populate from your registry
]);

const FINANCIAL_DOMAIN_IDS = new Set(['67', '137', '138']);

export function isCryptoRelevant(tweetData) {
  const annotations = tweetData.context_annotations ?? [];

  return annotations.some(ann =>
    CRYPTO_ENTITY_IDS.has(ann.entity.id) ||
    FINANCIAL_DOMAIN_IDS.has(ann.domain.id)
  );
}

export function extractCryptoEntities(tweetData) {
  const annotations = tweetData.context_annotations ?? [];
  return annotations
    .filter(ann => FINANCIAL_DOMAIN_IDS.has(ann.domain.id))
    .map(ann => ({ entityId: ann.entity.id, entityName: ann.entity.name }));
}
```

---

## Practical Application: Noise Reduction Metrics

Measure the impact of annotation filtering against raw keyword filtering:

```javascript
// src/annotations/noiseAnalyzer.js
export class NoiseAnalyzer {
  constructor() {
    this.total = 0;
    this.keywordMatches = 0;
    this.annotationFiltered = 0;
  }

  process(tweet, hasKeywordMatch, hasAnnotationMatch) {
    this.total++;
    if (hasKeywordMatch) this.keywordMatches++;
    if (hasKeywordMatch && hasAnnotationMatch) this.annotationFiltered++;
  }

  get noiseReductionRate() {
    if (!this.keywordMatches) return 0;
    return +((1 - this.annotationFiltered / this.keywordMatches) * 100).toFixed(1);
  }

  report() {
    return {
      total: this.total,
      keywordMatches: this.keywordMatches,
      afterAnnotationFilter: this.annotationFiltered,
      noiseReductionPercent: this.noiseReductionRate
    };
  }
}
```

In practice, annotation filtering typically reduces false positives by 30 to 60% for common crypto terms like "mining", "block", "chain", and "token" which appear frequently in non-crypto contexts.

---

## Combining Annotations with Other Filters

Context annotations work best in combination with other filtering strategies:

```javascript
export function shouldProcessTweet(tweetData, authorData) {
  // Gate 1: X classified this as crypto-relevant
  if (!isCryptoRelevant(tweetData)) return false;

  // Gate 2: Author has minimum credibility signal
  const { followers_count, tweet_count } = authorData?.public_metrics ?? {};
  if ((followers_count ?? 0) < 50 || (tweet_count ?? 0) < 20) return false;

  // Gate 3: Not a reply-only account (often bots)
  if (tweetData.text.startsWith('@') && !tweetData.text.includes('$')) return false;

  return true;
}
```

---

## Conclusion

X API context annotations give you a precision filter layer that operates on X's own content classification — a taxonomy built from billions of tweets that is independent of your keyword rules. For crypto applications, the difference between keyword matching and annotation-qualified filtering can cut processing volume by half while improving signal quality. The investment is front-loaded: spend 24 hours running an annotation discovery stream to build your entity ID registry, then apply those IDs in stream rules and post-processing filters. The result is a data pipeline that processes what matters and discards what does not.
