// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 03 — Sentiment report for an account
 *
 * What it does: pulls a public timeline and scores how the account talks.
 * Prints the distribution, the most positive and most negative post, and the
 * words that drove the scores.
 *
 * Needs: no session. The analyzer is rule-based and runs entirely offline, so
 * this costs nothing and needs no model, no key, and no network beyond the
 * timeline fetch itself.
 *
 * Run:
 *   node examples/03-sentiment-report.js
 *   node examples/03-sentiment-report.js github 40
 *
 * Set `mode: 'llm'` plus `OPENROUTER_API_KEY` to swap in a model instead. Same
 * return shape, so nothing downstream changes.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { analyzeBatch, aggregateResults } from '../src/analytics/index.js';
import { openScraper, heading } from './auth.js';

const handle = process.argv[2] || 'nasa';
const limit = Number(process.argv[3] || 25);

const scraper = await openScraper();

heading(`Sampling @${handle}`);
const texts = [];
for await (const tweet of scraper.getTweets(handle, limit)) {
  if (tweet.text) texts.push(tweet.text);
}
console.log(`  ${texts.length} posts collected`);

if (texts.length === 0) {
  console.error('Nothing to analyse.');
  process.exit(1);
}

const results = await analyzeBatch(texts);
const summary = aggregateResults(results);

heading('Sentiment');
console.log(`  Average     ${summary.average.toFixed(2)}`);
console.log(`  Median      ${summary.median.toFixed(2)}`);
console.log(`  Trend       ${summary.trend}`);
console.log(`  Positive    ${summary.distribution.positive}`);
console.log(`  Neutral     ${summary.distribution.neutral}`);
console.log(`  Negative    ${summary.distribution.negative}`);

const ranked = [...results].sort((a, b) => b.score - a.score);

heading('Most positive');
show(ranked[0]);

heading('Most negative');
show(ranked[ranked.length - 1]);

const keywords = new Map();
for (const result of results) {
  for (const word of result.keywords || []) {
    keywords.set(word, (keywords.get(word) || 0) + 1);
  }
}

if (keywords.size > 0) {
  heading('Top sentiment-bearing words');
  for (const [word, count] of [...keywords].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(count).padStart(3)}  ${word}`);
  }
}

/**
 * Print one scored post.
 * @param {{text: string, score: number, label: string, keywords: string[]}} result
 */
function show(result) {
  if (!result) {
    console.log('  (none)');
    return;
  }
  console.log(`  score ${result.score.toFixed(2)} (${result.label})`);
  console.log(`  ${result.text.replace(/\s+/g, ' ').slice(0, 140)}`);
  if (result.keywords?.length) console.log(`  matched: ${result.keywords.join(', ')}`);
}
