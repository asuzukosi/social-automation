// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 02 — User timeline and engagement stats
 *
 * What it does: streams a public timeline and summarises what actually
 * performs, ranking posts by likes plus reposts plus replies and reporting the
 * median so one viral post cannot skew the picture.
 *
 * Needs: no session. Guest-tier read.
 *
 * Run:
 *   node examples/02-user-timeline.js
 *   node examples/02-user-timeline.js github 40
 *
 * `getTweets()` is an async generator that pages under the hood, so you can
 * stop early on a large account without fetching pages you will not read.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { openScraper, heading, compact, tweetUrl } from './auth.js';

const handle = process.argv[2] || 'nasa';
const limit = Number(process.argv[3] || 20);

const scraper = await openScraper();
const tweets = [];

heading(`Fetching up to ${limit} posts from @${handle}`);

for await (const tweet of scraper.getTweets(handle, limit)) {
  tweets.push(tweet);
  process.stdout.write(`\r  ${tweets.length}/${limit}`);
}
process.stdout.write('\n');

if (tweets.length === 0) {
  console.error(
    `No posts returned for @${handle}. The account may be protected, suspended, or empty.`,
  );
  process.exit(1);
}

const engagement = (t) => (t.likes || 0) + (t.retweets || 0) + (t.replies || 0);
const original = tweets.filter((t) => !t.isRetweet);
const withMedia = tweets.filter((t) => (t.photos?.length || 0) + (t.videos?.length || 0) > 0);

heading('Summary');
console.log(`  Posts sampled     ${tweets.length}`);
console.log(`  Original (not RT) ${original.length}`);
console.log(`  With media        ${withMedia.length}`);
console.log(
  `  Median engagement ${compact(median(original.map(engagement)))} per original post`,
);

heading('Top 5 by engagement');
for (const [i, tweet] of [...tweets].sort((a, b) => engagement(b) - engagement(a)).slice(0, 5).entries()) {
  const text = (tweet.text || '').replace(/\s+/g, ' ').slice(0, 90);
  console.log(`\n  ${i + 1}. ${compact(engagement(tweet))} engagements`);
  console.log(`     ${text}${text.length === 90 ? '…' : ''}`);
  console.log(`     ${tweetUrl(tweet)}`);
}

/**
 * Median of a numeric list. Preferred over the mean here because one viral
 * post skews an account's average badly enough to be misleading.
 *
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}
