// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 04 — One account, three networks
 *
 * What it does: looks up the same brand on X, Bluesky, and Mastodon and prints
 * the results side by side. One network being down does not cost you the other
 * two results.
 *
 * Needs: no session on any of the three networks. All three reads are public.
 *
 * Run:
 *   node examples/04-cross-platform.js
 *   node examples/04-cross-platform.js nasa nasa.bsky.social Gargron@mastodon.social
 *
 * Each platform module normalises to the same field names (`name`, `username`,
 * `bio`, `followers`, `following`, `posts`), so a dashboard or migration tool
 * can treat them interchangeably.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import * as bluesky from '../src/scrapers/bluesky/index.js';
import * as mastodon from '../src/scrapers/mastodon/index.js';
import { openScraper, heading, compact } from './auth.js';

const xHandle = process.argv[2] || 'nasa';
const bskyHandle = process.argv[3] || 'bsky.app';
const mastoHandle = process.argv[4] || 'Gargron@mastodon.social';

const rows = [];

rows.push(await safely('X', async () => {
  const scraper = await openScraper();
  const p = await scraper.getProfile(xHandle);
  return {
    name: p.name,
    username: p.username,
    bio: p.bio,
    followers: p.followersCount,
    following: p.followingCount,
    posts: p.tweetCount,
  };
}));

rows.push(await safely('Bluesky', async () => {
  const agent = await bluesky.createAgent();
  return bluesky.scrapeProfile(agent, bskyHandle);
}));

rows.push(await safely('Mastodon', async () => {
  // Mastodon is federated: the instance is part of the address.
  const [user, host] = mastoHandle.split('@');
  const client = mastodon.createClient({ instance: `https://${host}` });
  return mastodon.scrapeProfile(client, user);
}));

heading('Profiles');
console.log(
  pad('Network', 10) + pad('Handle', 26) + pad('Followers', 12) + pad('Following', 12) + 'Posts',
);
for (const { platform, profile, error } of rows) {
  if (error) {
    console.log(pad(platform, 10) + `unavailable — ${error}`);
    continue;
  }
  console.log(
    pad(platform, 10) +
      pad(`@${profile.username}`, 26) +
      pad(compact(profile.followers), 12) +
      pad(compact(profile.following), 12) +
      compact(profile.posts),
  );
}

heading('Bios');
for (const { platform, profile, error } of rows) {
  if (error) continue;
  console.log(`  ${platform}: ${(profile.bio || '(none)').replace(/\s+/g, ' ').slice(0, 100)}`);
}

/**
 * Run one platform lookup without letting a single outage abort the run.
 * A federated instance being down should not cost you the other two results.
 *
 * @param {string} platform
 * @param {() => Promise<object>} fn
 * @returns {Promise<{platform: string, profile?: object, error?: string}>}
 */
async function safely(platform, fn) {
  try {
    return { platform, profile: await fn() };
  } catch (error) {
    return { platform, error: error.message.slice(0, 120) };
  }
}

/**
 * Left-align `value` in a fixed-width column.
 * @param {string} value
 * @param {number} width
 * @returns {string}
 */
function pad(value, width) {
  return String(value).padEnd(width);
}
