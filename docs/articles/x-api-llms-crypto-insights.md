# X API and LLMs: Combining Social Data with AI for Crypto Insights

**Meta description:** Learn how to combine X API tweet collection with LLM analysis to generate structured crypto market insights, sentiment scores, and automated research reports.

---

## Introduction

Raw tweet data has limited value. A thousand tweets about a token launch are noise until you can extract: what's the dominant sentiment, which concerns appear most, are there credible technical claims, and what's the signal-to-noise ratio. Large language models are good at exactly this. Combined with X API data collection, LLMs let you turn social chatter into structured, actionable crypto intelligence. This guide covers the pipeline from tweet collection to LLM analysis to structured output.

## Pipeline Architecture

```
X API (collect) → preprocess → LLM analysis → structured output → storage/alerting
```

The three LLM tasks that deliver the most value in crypto:

1. **Sentiment classification** — beyond positive/negative, extract specific signals (fear, FOMO, skepticism, technical concerns)
2. **Entity and claim extraction** — which protocols, tokens, teams are mentioned, and what claims are made
3. **Summary generation** — distill 50 tweets into a 3-sentence briefing

## Collecting Tweets for LLM Analysis

Batch collection works better than streaming for LLM analysis — you want enough context to identify patterns:

```javascript
async function collectTokenTweets(token, bearerToken, count = 200) {
  const query = `${token} lang:en -is:retweet -is:reply`;
  const params = new URLSearchParams({
    query,
    max_results: 100,
    'tweet.fields': 'created_at,public_metrics,author_id,lang',
    expansions: 'author_id',
    'user.fields': 'username,public_metrics,verified',
  });

  const tweets = [];
  let nextToken = null;

  do {
    if (nextToken) params.set('next_token', nextToken);
    const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    const data = await res.json();
    if (data.data) tweets.push(...data.data);
    nextToken = data.meta?.next_token ?? null;
    if (nextToken) await new Promise(r => setTimeout(r, 1100));
  } while (nextToken && tweets.length < count);

  return tweets.slice(0, count);
}
```

## Preprocessing Tweets for LLM Input

LLMs have context windows. Trim tweets to essential content:

```javascript
function preprocessTweets(tweets, users) {
  return tweets.map(tweet => {
    const user = users.find(u => u.id === tweet.author_id);
    const followers = user?.public_metrics?.followers_count ?? 0;
    const engagement = tweet.public_metrics.like_count + tweet.public_metrics.retweet_count;

    // Weight: high-follower + high-engagement tweets carry more signal
    const weight = followers > 10000 ? 'high' : followers > 1000 ? 'medium' : 'low';

    // Strip URLs and @mentions to reduce noise tokens
    const cleanText = tweet.text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/@\w+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { text: cleanText, weight, engagement, author: user?.username };
  }).filter(t => t.text.length > 20);
}
```

## LLM Sentiment Analysis

Call an LLM API with structured prompt engineering:

```javascript
async function analyzeSentiment(tweets, token, openaiApiKey) {
  // Take top 50 by engagement to fit context window
  const topTweets = tweets
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 50);

  const tweetBlock = topTweets
    .map((t, i) => `[${i + 1}][${t.weight}] ${t.text}`)
    .join('\n');

  const prompt = `You are a crypto market analyst. Analyze these ${topTweets.length} tweets about ${token} and return a JSON object with:
- sentiment: "bullish" | "bearish" | "neutral" | "mixed"
- sentimentScore: number from -1.0 (very bearish) to 1.0 (very bullish)
- dominantThemes: array of up to 5 key themes (e.g., "price speculation", "technical concern", "partnership news")
- credibleClaims: array of specific factual claims worth investigating
- fearGreedSignal: "extreme_fear" | "fear" | "neutral" | "greed" | "extreme_greed"
- summary: 2-3 sentence summary of the dominant community sentiment

Tweets:
${tweetBlock}

Return only valid JSON.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
```

## Entity and Claim Extraction

Extract specific protocols, prices, and technical claims from tweets:

```javascript
async function extractEntitiesAndClaims(tweets, openaiApiKey) {
  const sample = tweets.slice(0, 30).map(t => t.text).join('\n---\n');

  const prompt = `Extract structured data from these crypto tweets. Return JSON with:
- mentionedProtocols: array of DeFi protocols/blockchains mentioned
- mentionedTokens: array of token symbols mentioned (beyond the main token)
- pricePredictions: array of { direction, target, timeframe } objects
- riskWarnings: array of specific risks mentioned
- catalysts: array of positive catalysts mentioned

Tweets:
${sample}

Return only valid JSON.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });

  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}
```

## Generating a Research Brief

Combine sentiment and entity analysis into a publishable brief:

```javascript
async function generateResearchBrief(token, sentiment, entities, openaiApiKey) {
  const prompt = `Write a concise crypto research brief for ${token} based on current X/Twitter community sentiment.

Sentiment data: ${JSON.stringify(sentiment)}
Entities and claims: ${JSON.stringify(entities)}

Format as:
## ${token} Social Intelligence Brief — [date]

**Sentiment:** [score] / 1.0 ([label])

**Key Themes:**
- [bullet points]

**Risk Signals:**
- [bullet points]

**Catalysts Mentioned:**
- [bullet points]

**Summary:**
[2-3 sentences]

Be direct, technical, no filler.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  const data = await res.json();
  return data.choices[0].message.content;
}
```

## Full Pipeline Execution

```javascript
async function runCryptoInsightsPipeline(tokens, bearerToken, openaiApiKey) {
  const results = [];

  for (const token of tokens) {
    console.log(`🔄 Analyzing ${token}...`);

    const rawTweets = await collectTokenTweets(token, bearerToken);
    const processed = preprocessTweets(rawTweets, []);

    const [sentiment, entities] = await Promise.all([
      analyzeSentiment(processed, token, openaiApiKey),
      extractEntitiesAndClaims(processed, openaiApiKey),
    ]);

    const brief = await generateResearchBrief(token, sentiment, entities, openaiApiKey);

    results.push({ token, sentiment, entities, brief, analyzedAt: new Date().toISOString() });

    console.log(`✅ ${token}: ${sentiment.sentiment} (${sentiment.sentimentScore})`);
    await new Promise(r => setTimeout(r, 2000)); // rate limit gap
  }

  return results;
}

// Run for a portfolio
const insights = await runCryptoInsightsPipeline(
  ['$BTC', '$ETH', '$SOL', '$ARB'],
  process.env.BEARER_TOKEN,
  process.env.OPENAI_API_KEY
);
```

## Cost Considerations

LLM API calls add up. Optimize:

- Use `gpt-4o-mini` for sentiment classification (cheap, fast, accurate enough)
- Use `gpt-4o` only for final brief generation
- Cache LLM responses for the same tweet set for at least 30 minutes
- Limit tweet batch size to 50 for analysis — more tweets rarely improve accuracy

## Conclusion

The X API + LLM pipeline converts social noise into structured research in seconds. The key design choices are: weight tweets by account authority before sending to the LLM, use JSON-mode responses for reliable parsing, and separate the extraction tasks (sentiment vs. entities) from the synthesis task (brief generation). Schedule this pipeline before market open and after major news events for maximum utility.
