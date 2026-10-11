// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared helper for the examples in this directory.
 *
 * X splits its internal API into two tiers:
 *
 *   - **Guest tier** — profiles and public user timelines. Works with no
 *     account at all. `openScraper()` is enough.
 *   - **Session tier** — search, followers, following, likes, bookmarks, DMs,
 *     home timeline. Requires a logged-in session. `openAuthenticatedScraper()`
 *     exits with instructions when no session is configured.
 *
 * Two ways to supply a session, checked in this order:
 *
 *   1. `X_AUTH_TOKEN` and `X_CSRF_TOKEN` environment variables.
 *   2. `~/.xactions/cookies.json`, written by `xactions login`.
 *
 * Both cookies matter. `auth_token` proves who you are; `ct0` is the CSRF
 * token X requires as a header before it treats the request as logged in.
 * With only `auth_token`, session-tier endpoints answer 404.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import path from 'node:path';
import os from 'node:os';
import { Scraper } from '../src/client/index.js';

const COOKIE_FILE = path.join(os.homedir(), '.xactions', 'cookies.json');

/**
 * Open a Scraper for guest-tier reads (profiles, public timelines).
 *
 * A session is attached when one is available, which raises rate limits, but
 * its absence is not an error.
 *
 * @returns {Promise<Scraper>}
 */
export async function openScraper() {
  const scraper = new Scraper();
  await attachSession(scraper);
  return scraper;
}

/**
 * Open a Scraper for session-tier reads, or exit with instructions.
 *
 * @returns {Promise<Scraper>}
 */
export async function openAuthenticatedScraper() {
  const scraper = new Scraper();
  const attached = await attachSession(scraper);

  if (!attached) {
    console.error(loginInstructions());
    process.exit(1);
  }

  return scraper;
}

/**
 * Attach a saved session to a Scraper if one can be found.
 *
 * @param {Scraper} scraper
 * @returns {Promise<boolean>} True when the scraper is authenticated
 */
async function attachSession(scraper) {
  const authToken = process.env.X_AUTH_TOKEN;
  const csrfToken = process.env.X_CSRF_TOKEN;

  if (authToken && csrfToken) {
    await scraper.setCookies(`auth_token=${authToken}; ct0=${csrfToken}`);
    return true;
  }

  try {
    await scraper.loadCookies(COOKIE_FILE);
    return await scraper.isLoggedIn();
  } catch {
    return false;
  }
}

/**
 * The message shown when an example needs a session and cannot find one.
 *
 * @returns {string}
 */
function loginInstructions() {
  return [
    '',
    'This example needs a logged-in X session.',
    '',
    'X only serves search, follower lists, likes, bookmarks, and DMs to',
    'authenticated requests. Profiles and public timelines work without one:',
    'see 01-profile-lookup.js and 02-user-timeline.js.',
    '',
    'Easiest first. Either of these writes the cookie file for you:',
    '',
    '       npx xactions connect                 log in through a real browser',
    '       npx xactions login --from-browser    read cookies from a browser you',
    '                                            are already logged in to',
    '',
    'By hand, if you prefer:',
    '  1. Open x.com and log in.',
    '  2. DevTools (F12) > Application > Cookies > https://x.com',
    '  3. Copy the values of "auth_token" and "ct0".',
    '  4. Either export them:',
    '',
    '       export X_AUTH_TOKEN=...',
    '       export X_CSRF_TOKEN=...',
    '',
    '     or save them once with the CLI:',
    '',
    '       npx xactions login',
    '',
    `Cookie file checked: ${COOKIE_FILE}`,
    '',
  ].join('\n');
}

/**
 * Print a labelled section header. Keeps example output readable when several
 * steps run in sequence.
 *
 * @param {string} title
 */
export function heading(title) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}

/**
 * Canonical x.com link for a post.
 *
 * `tweet.permanentUrl` needs the author's handle, and X does not always send
 * one on a timeline entry, so it can come back empty. The `/i/web/status/<id>`
 * form needs only the id and redirects to the real permalink, which makes it
 * the safe thing to print.
 *
 * @param {{id: string, username?: string}} tweet
 * @returns {string}
 */
export function tweetUrl(tweet) {
  return tweet.username
    ? `https://x.com/${tweet.username}/status/${tweet.id}`
    : `https://x.com/i/web/status/${tweet.id}`;
}

/**
 * Format a number the way social platforms do (92.2M, 74.3K).
 *
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function compact(n) {
  if (n === null || n === undefined) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
