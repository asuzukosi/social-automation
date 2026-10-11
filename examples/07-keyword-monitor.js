// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 07 — Watch a keyword and alert on it
 *
 * What it does: polls X search on an interval, scores each new post for
 * sentiment, and fires a webhook when something negative shows up. The shape of
 * a brand monitor, a support-mention watcher, or an incident tripwire. Seen IDs
 * are tracked so a post is reported once, and the first poll is treated as a
 * baseline rather than alerting on the entire backlog.
 *
 * Needs: A LOGGED-IN SESSION. X search is not available to guests. Run
 * `npx xactions connect` first, or export X_AUTH_TOKEN and X_CSRF_TOKEN.
 * ALERT_WEBHOOK is optional; without it negatives are printed, not posted.
 *
 * Run (Ctrl+C to stop):
 *   node examples/07-keyword-monitor.js "your brand"
 *   ALERT_WEBHOOK=https://hooks.example.com/x node examples/07-keyword-monitor.js "your brand" 120
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { analyzeSentiment } from '../src/analytics/index.js';
import { SearchMode } from '../src/client/index.js';
import { openAuthenticatedScraper, heading, tweetUrl } from './auth.js';

const query = process.argv[2] || 'xactions';
const intervalSeconds = Number(process.argv[3] || 60);
const webhook = process.env.ALERT_WEBHOOK || null;
const PER_POLL = 25;

const scraper = await openAuthenticatedScraper();
const seen = new Set();
let baseline = true;

heading(`Monitoring "${query}"`);
console.log(`  Polling every ${intervalSeconds}s`);
console.log(`  Alerts: ${webhook ? webhook : 'console only (set ALERT_WEBHOOK to POST them)'}`);
console.log('  Ctrl+C to stop\n');

// Poll immediately, then on the interval, so the first result does not sit
// behind a full interval of silence.
await poll();
const timer = setInterval(poll, intervalSeconds * 1000);

process.on('SIGINT', () => {
  clearInterval(timer);
  console.log(`\n\nStopped. ${seen.size} unique posts seen.`);
  process.exit(0);
});

/**
 * Fetch the newest matches and report anything not seen before.
 */
async function poll() {
  let fresh = 0;

  try {
    for await (const tweet of scraper.searchTweets(query, PER_POLL, SearchMode.Latest)) {
      if (seen.has(tweet.id)) continue;
      seen.add(tweet.id);

      // The first pass only establishes what already existed. Without this,
      // starting the monitor would alert on every historical match at once.
      if (baseline) continue;

      fresh += 1;
      const sentiment = await analyzeSentiment(tweet.text || '');
      report(tweet, sentiment);

      if (webhook && sentiment.label === 'negative') {
        await notify(tweet, sentiment);
      }
    }
  } catch (error) {
    // A failed poll should not kill a long-running monitor. Rate limits and
    // transient 5xx both resolve themselves by the next interval.
    console.error(`  [${stamp()}] poll failed: ${error.message}`);
    return;
  }

  if (baseline) {
    baseline = false;
    console.log(`  [${stamp()}] baseline set (${seen.size} existing posts ignored)`);
  } else if (fresh === 0) {
    console.log(`  [${stamp()}] no new matches`);
  }
}

/**
 * Print one matched post.
 * @param {object} tweet
 * @param {{label: string, score: number}} sentiment
 */
function report(tweet, sentiment) {
  const marker = { positive: '+', negative: '!', neutral: ' ' }[sentiment.label] ?? ' ';
  console.log(
    `  [${stamp()}] ${marker} @${tweet.username}: ${(tweet.text || '').replace(/\s+/g, ' ').slice(0, 100)}`,
  );
  console.log(`             ${tweetUrl(tweet)}`);
}

/**
 * POST an alert to the configured webhook.
 * @param {object} tweet
 * @param {{label: string, score: number, keywords: string[]}} sentiment
 */
async function notify(tweet, sentiment) {
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        url: tweetUrl(tweet),
        author: tweet.username,
        text: tweet.text,
        sentiment,
        detectedAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(`             webhook failed: ${error.message}`);
  }
}

/** @returns {string} HH:MM:SS for log lines */
function stamp() {
  return new Date().toISOString().slice(11, 19);
}
