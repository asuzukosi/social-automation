// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 06 — Who doesn't follow you back
 *
 * What it does: the set difference XActions is best known for, done with the
 * HTTP client instead of a browser. Prints the biggest accounts first and
 * writes the full list to JSON.
 *
 * Needs: A LOGGED-IN SESSION. Both follower and following lists are
 * session-tier. Run `npx xactions connect` first, or export X_AUTH_TOKEN and
 * X_CSRF_TOKEN. Without one this exits with setup instructions.
 *
 * Run:
 *   node examples/06-find-non-followers.js
 *   node examples/06-find-non-followers.js nasa
 *
 * Read-only on purpose. Unfollowing is a separate, deliberate step
 * (`xactions bulk unfollow <file>`, or the browser script in
 * `scripts/unfollowback.js`). Bulk-unfollowing in the same breath as
 * discovering the list is how people trip X's rate limits and lock themselves
 * out for a day.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { writeFile } from 'node:fs/promises';
import { openAuthenticatedScraper, heading, compact } from './auth.js';

const MAX = Number(process.argv[3] || 5000);

const scraper = await openAuthenticatedScraper();

// With no argument, audit the logged-in account itself.
const handle = process.argv[2] || (await scraper.me()).username;

heading(`Reading the following list of @${handle}`);
const following = new Map();
for await (const account of scraper.getFollowing(handle, MAX)) {
  following.set(account.username.toLowerCase(), account);
  if (following.size % 50 === 0) process.stdout.write(`\r  ${following.size}`);
}
process.stdout.write(`\r  ${following.size} accounts followed\n`);

heading(`Reading the follower list of @${handle}`);
const followers = new Set();
for await (const account of scraper.getFollowers(handle, MAX)) {
  followers.add(account.username.toLowerCase());
  if (followers.size % 50 === 0) process.stdout.write(`\r  ${followers.size}`);
}
process.stdout.write(`\r  ${followers.size} followers\n`);

const nonFollowers = [...following.entries()]
  .filter(([username]) => !followers.has(username))
  .map(([, account]) => account)
  // Biggest accounts first: those are usually the deliberate follows you want
  // to keep, so seeing them at the top prevents an unthinking mass unfollow.
  .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0));

heading('Not following you back');
console.log(`  ${nonFollowers.length} of ${following.size}\n`);

for (const account of nonFollowers.slice(0, 25)) {
  console.log(
    `  @${account.username.padEnd(20)} ${compact(account.followersCount).padStart(7)} followers  ${account.name}`,
  );
}
if (nonFollowers.length > 25) console.log(`  … and ${nonFollowers.length - 25} more`);

const outFile = `${handle}-non-followers.json`;
await writeFile(outFile, JSON.stringify(nonFollowers, null, 2));
console.log(`\n  Full list → ${outFile}`);
