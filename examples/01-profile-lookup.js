// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 01 — Profile lookup
 *
 * What it does: fetches one or more public X profiles and prints the headline
 * numbers. The shortest path from "npm install xactions" to real data.
 *
 * Needs: no session. Guest-tier read, no API key and no browser. It goes
 * straight to X's internal GraphQL API over plain HTTP, so it finishes in well
 * under a second rather than launching Chromium.
 *
 * Run:
 *   node examples/01-profile-lookup.js
 *   node examples/01-profile-lookup.js nasa github vercel
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { openScraper, heading, compact } from './auth.js';

const handles = process.argv.slice(2);
const targets = handles.length > 0 ? handles : ['nasa'];

const scraper = await openScraper();

for (const handle of targets) {
  try {
    const profile = await scraper.getProfile(handle);

    heading(`@${profile.username} — ${profile.name}`);
    console.log(profile.bio || '(no bio)');
    console.log('');
    console.log(`  Followers  ${compact(profile.followersCount)}`);
    console.log(`  Following  ${compact(profile.followingCount)}`);
    console.log(`  Posts      ${compact(profile.tweetCount)}`);
    console.log(`  Listed     ${compact(profile.listedCount)}`);
    console.log(`  Joined     ${new Date(profile.joined).toISOString().slice(0, 10)}`);
    if (profile.location) console.log(`  Location   ${profile.location}`);
    if (profile.website) console.log(`  Website    ${profile.website}`);
    if (profile.isBlueVerified) console.log('  Verified   yes');
  } catch (error) {
    // ScraperError carries `code` and `httpStatus`, so callers can branch on
    // the failure kind instead of matching on message text.
    console.error(`\n@${handle} failed [${error.code}]: ${error.message}`);
    process.exitCode = 1;
  }
}
