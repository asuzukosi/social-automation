// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 05 — Export followers to CSV
 *
 * What it does: pages through a follower list and writes a spreadsheet-ready
 * CSV. Rows are streamed to disk as they arrive rather than accumulated in
 * memory, so an interrupted run keeps whatever it had already written.
 *
 * Needs: A LOGGED-IN SESSION. X does not serve follower lists to guests. Run
 * `npx xactions connect` first, or export X_AUTH_TOKEN and X_CSRF_TOKEN.
 * Without one this exits with setup instructions and does nothing.
 *
 * Run:
 *   node examples/05-export-followers.js
 *   node examples/05-export-followers.js nasa 500 nasa-followers.csv
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { createWriteStream } from 'node:fs';
import { openAuthenticatedScraper, heading, compact } from './auth.js';

const handle = process.argv[2] || 'nasa';
const limit = Number(process.argv[3] || 200);
const outFile = process.argv[4] || `${handle}-followers.csv`;

const scraper = await openAuthenticatedScraper();

heading(`Exporting up to ${limit} followers of @${handle}`);

const out = createWriteStream(outFile, { encoding: 'utf8' });
out.write('username,name,followers,following,posts,verified,bio\n');

let count = 0;
try {
  for await (const follower of scraper.getFollowers(handle, limit)) {
    out.write(
      [
        follower.username,
        follower.name,
        follower.followersCount ?? '',
        follower.followingCount ?? '',
        follower.tweetCount ?? '',
        follower.isBlueVerified ? 'yes' : 'no',
        follower.bio,
      ]
        .map(csvCell)
        .join(',') + '\n',
    );

    count += 1;
    if (count % 25 === 0) process.stdout.write(`\r  ${count} written`);
  }
} finally {
  await new Promise((resolve) => out.end(resolve));
}

process.stdout.write(`\r  ${count} written\n`);

if (count === 0) {
  console.error(
    `\nX returned no followers for @${handle}. The account may be protected, or your ` +
      'session may have expired — re-run `xactions login` and try again.',
  );
  process.exit(1);
}

heading('Done');
console.log(`  ${compact(count)} followers → ${outFile}`);

/**
 * Quote a value for CSV.
 *
 * Bios routinely contain commas, quotes, and newlines. Writing them raw
 * produces a file that opens misaligned in every spreadsheet program, which is
 * the sort of thing nobody notices until row 4,000.
 *
 * @param {unknown} value
 * @returns {string}
 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}
