#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Live verification against x.com.
 *
 * Runs the two things a no-API client depends on and records whether they
 * still work today:
 *
 *   1. GraphQL query-ID discovery (`discoverQueryIds()` from
 *      src/scrapers/twitter/http/queryIds.js): loads an x.com page, reads the
 *      webpack manifest, and extracts live `{queryId, operationName}` pairs.
 *      Nothing is persisted to ~/.xactions; this is a pure probe.
 *   2. The guest profile scrape behind `xactions profile nasa`: activates a
 *      guest token (src/scrapers/twitter/http/guest.js) and calls
 *      `scrapeProfile()` (src/scrapers/twitter/http/profile.js) for @nasa
 *      with no login at all.
 *
 * Output (shields.io endpoint format, served at https://xactions.app/badges/):
 *
 *   public/badges/live.json         {schemaVersion, label, message, color}
 *   public/badges/live-status.json  full detail: per-check status, timings,
 *                                   operation count, sample profile fields,
 *                                   and the error text of a failing check
 *
 * Invocation (no npm script needed):
 *
 *   node scripts/verify-live.mjs
 *
 * Options:
 *   --handle <name>   Profile to scrape instead of nasa
 *   --out <dir>       Directory for the two JSON files (default public/badges)
 *
 * Exit code is 0 when both checks pass and 1 otherwise, so it can gate a
 * deploy or a cron. The badge is written either way: on failure it turns red
 * and names the check that failed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { discoverQueryIds } from '../src/scrapers/twitter/http/queryIds.js';
import { GuestTokenManager, randomUserAgent } from '../src/scrapers/twitter/http/guest.js';
import { TwitterHttpClient } from '../src/scrapers/twitter/http/client.js';
import { scrapeProfile } from '../src/scrapers/twitter/http/profile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { handle: 'nasa', outDir: path.join(ROOT, 'public', 'badges') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--handle' && argv[i + 1]) out.handle = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) out.outDir = path.resolve(argv[++i]);
  }
  return out;
}

async function timed(name, fn) {
  const started = performance.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Math.round(performance.now() - started), ...detail };
  } catch (err) {
    return {
      name,
      ok: false,
      ms: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
      ...(err && typeof err === 'object' && err.shape ? { diagnosis: err.shape } : {}),
    };
  }
}

/** Check 1: live query-ID discovery, not persisted. */
async function checkQueryIds() {
  const result = await discoverQueryIds({ persist: false });
  const sample = ['UserByScreenName', 'TweetDetail', 'SearchTimeline', 'Followers', 'Following']
    .filter((op) => result.operations[op])
    .map((op) => ({ operationName: op, queryId: result.operations[op].queryId }));
  return {
    operationCount: result.count,
    entryUrl: result.source.entryUrl,
    mainBundle: result.source.mainBundle,
    chunksFetched: result.source.chunksFetched,
    chunksFailed: result.source.chunksFailed,
    bytes: result.source.bytes,
    sample,
  };
}

/**
 * x.com answers a User-Agent-less `POST /1.1/guest/activate.json` with a
 * misleading HTTP 404 (`code: 34`). Every request here carries a browser UA,
 * the same way src/client/auth/GuestToken.js does.
 */
function withHeaders(extra) {
  return (url, init = {}) =>
    globalThis.fetch(url, { ...init, headers: { ...(init.headers || {}), ...extra } });
}

/**
 * When the parser rejects a response, say why: X has been moving user fields
 * out of `legacy` into `core`, `avatar`, `relationship_counts` and friends,
 * and that is a different failure from a dead endpoint.
 */
async function diagnoseProfileShape(client, handle) {
  const { GRAPHQL } = await import('../src/scrapers/twitter/http/endpoints.js');
  const { queryId, operationName } = GRAPHQL.UserByScreenName;
  const response = await client.graphql(queryId, operationName, {
    screen_name: handle,
    withSafetyModeUserFields: true,
  });
  const body = response?.data?.data ? response.data : response;
  const result = body?.data?.user?.result;
  if (!result) return { httpOk: true, userResult: false };
  return {
    httpOk: true,
    userResult: true,
    typename: result.__typename,
    restId: result.rest_id ?? null,
    hasLegacy: Boolean(result.legacy),
    resultKeys: Object.keys(result),
  };
}

/** Check 2: guest-token activation plus the UserByScreenName profile scrape. */
async function checkGuestProfile(handle) {
  const userAgent = randomUserAgent();
  const guest = new GuestTokenManager({ fetch: withHeaders({ 'user-agent': userAgent }) });
  const guestHeaders = await guest.getHeaders();

  const client = new TwitterHttpClient({
    fetch: withHeaders({ 'user-agent': userAgent, 'x-guest-token': guestHeaders['x-guest-token'] }),
    userAgent,
    autoRefreshQueryIds: true,
  });

  let profile;
  try {
    profile = await scrapeProfile(client, handle);
  } catch (err) {
    const shape = await diagnoseProfileShape(client, handle).catch((e) => ({ httpOk: false, error: e.message }));
    const why =
      shape.userResult && !shape.hasLegacy
        ? `x.com returned @${handle} (rest_id ${shape.restId}) without the legacy block the parser reads; fields now live in ${shape.resultKeys.filter((k) => ['core', 'avatar', 'relationship_counts', 'tweet_counts', 'profile_bio'].includes(k)).join(', ')}`
        : err.message;
    const wrapped = new Error(why);
    wrapped.shape = shape;
    throw wrapped;
  }
  if (!profile || !profile.id || !profile.username) {
    throw new Error(`x.com answered but returned no profile for @${handle}`);
  }
  return {
    handle,
    guestTokenActivated: true,
    profile: {
      id: profile.id,
      username: profile.username,
      name: profile.name,
      followers: profile.followers,
      following: profile.following,
      tweets: profile.tweets,
      verified: profile.verified,
    },
  };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();

  const queryIds = await timed('query-ids', checkQueryIds);
  const guestProfile = await timed('guest-profile', () => checkGuestProfile(args.handle));
  const checks = [queryIds, guestProfile];
  const failed = checks.filter((c) => !c.ok);
  const allOk = failed.length === 0;

  const badge = allOk
    ? { schemaVersion: 1, label: 'x.com', message: `verified ${isoDate(startedAt)}`, color: 'brightgreen' }
    : { schemaVersion: 1, label: 'x.com', message: `${failed.map((c) => c.name).join(', ')} failing`, color: 'red' };

  const status = {
    ok: allOk,
    checkedAt: startedAt.toISOString(),
    durationMs: Math.round(performance.now()),
    xactionsVersion: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    node: process.version,
    checks,
  };

  writeJson(path.join(args.outDir, 'live.json'), badge);
  writeJson(path.join(args.outDir, 'live-status.json'), status);

  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    const extra = c.ok
      ? c.name === 'query-ids'
        ? `${c.operationCount} operations from ${c.entryUrl}`
        : `@${c.profile.username} (${c.profile.followers} followers)`
      : c.error;
    console.log(`[${mark}] ${c.name} ${c.ms}ms: ${extra}`);
  }
  console.log(`badge: ${badge.message} (${badge.color})`);
  console.log(`wrote ${path.relative(ROOT, path.join(args.outDir, 'live.json'))} and live-status.json`);
  process.exitCode = allOk ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
