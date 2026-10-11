#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Regenerate the browser profile pool from the current shipping browsers.
 *
 * A User-Agent string that is two major versions behind is not camouflage, it
 * is a signal: no real Chrome install stays that far back. The pool used to be
 * five strings typed in by hand, which meant it aged the moment it was written.
 *
 * fa0311/latest-user-agent runs the real browsers in CI and commits what they
 * send: `output.json` (the User-Agent per browser) and `header.json` (the whole
 * request header set, including the `Sec-CH-UA` brand list that a Chromium
 * request has to agree with). This script reads both and writes
 * `src/client/auth/userAgents.generated.js`.
 *
 * Upstream's CI runs on Linux, so every string it publishes carries the
 * `X11; Linux x86_64` platform token. The versions are the part that goes
 * stale; the platform token is a fixed, documented string per operating system
 * (Chromium froze its platform token years ago, which is why every Windows
 * Chrome reports `Windows NT 10.0; Win64; x64` whatever the actual build). So
 * the generator keeps upstream's version and browser identity exactly as
 * published and substitutes the platform token to cover Windows and macOS,
 * rather than inventing version numbers upstream did not observe.
 *
 * Attribution: source data from https://github.com/fa0311/latest-user-agent
 * (MIT, (c) fa0311). See THIRD-PARTY-NOTICES.md.
 *
 * Usage:
 *   node scripts/sync-user-agents.mjs            # fetch and rewrite
 *   node scripts/sync-user-agents.mjs --check    # fail if the pool is stale
 *   node scripts/sync-user-agents.mjs --json
 *   node scripts/sync-user-agents.mjs --fixtures tests/fixtures/upstream/user-agents
 *
 * Exit codes: 0 up to date / written, 1 drift found under --check, 2 fetch or
 * write failure.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const UPSTREAM_REPO = 'fa0311/latest-user-agent';
export const UPSTREAM_REF = 'main';
export const UPSTREAM_FILES = { agents: 'output.json', headers: 'header.json' };

export const DEFAULT_OUTPUT = path.join(ROOT, 'src/client/auth/userAgents.generated.js');

/**
 * The platform tokens each desktop operating system reports, per engine.
 *
 * Chromium's is frozen by the reduced-User-Agent rollout, and Gecko's has been
 * the same triple since Firefox 4. Neither carries a version to go stale, which
 * is why substituting them into upstream's freshly observed string is safe.
 */
const PLATFORMS = {
  windows: { chromium: 'Windows NT 10.0; Win64; x64', gecko: 'Windows NT 10.0; Win64; x64', hint: 'Windows' },
  macos: { chromium: 'Macintosh; Intel Mac OS X 10_15_7', gecko: 'Macintosh; Intel Mac OS X 10.15', hint: 'macOS' },
  linux: { chromium: 'X11; Linux x86_64', gecko: 'X11; Linux x86_64', hint: 'Linux' },
};

/** Which browser/platform pairs make up the pool, in order. */
const POOL = [
  { browser: 'chrome', engine: 'chromium', platform: 'windows' },
  { browser: 'chrome', engine: 'chromium', platform: 'macos' },
  { browser: 'chrome', engine: 'chromium', platform: 'linux' },
  { browser: 'edge', engine: 'chromium', platform: 'windows' },
  { browser: 'firefox', engine: 'gecko', platform: 'windows' },
  { browser: 'firefox', engine: 'gecko', platform: 'macos' },
  { browser: 'firefox', engine: 'gecko', platform: 'linux' },
];

/**
 * The profile used when a caller asks for no particular one. Chrome on Windows
 * is the single most common desktop browser, so it is the least remarkable
 * thing a request can claim to be.
 */
export const DEFAULT_PROFILE_ID = 'chrome-windows';

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @returns {Promise<{agents: object, headers: object, commit: string, committedAt: string}>}
 */
export async function fetchUpstream(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const apiHeaders = { accept: 'application/vnd.github+json', 'user-agent': 'xactions-sync-user-agents' };
  if (process.env.GITHUB_TOKEN) apiHeaders.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const commitRes = await fetchFn(`https://api.github.com/repos/${UPSTREAM_REPO}/commits/${UPSTREAM_REF}`, { headers: apiHeaders });
  if (!commitRes.ok) throw new Error(`GitHub API answered ${commitRes.status} for ${UPSTREAM_REPO}@${UPSTREAM_REF}; cannot record provenance`);
  const commitBody = await commitRes.json();
  const commit = commitBody.sha;
  const committedAt = commitBody.commit?.committer?.date ?? commitBody.commit?.author?.date;
  if (!commit || !committedAt) throw new Error('GitHub API returned a commit without a sha or a date');

  const [agents, headers] = await Promise.all([
    fetchJson(fetchFn, commit, UPSTREAM_FILES.agents),
    fetchJson(fetchFn, commit, UPSTREAM_FILES.headers),
  ]);
  return { agents, headers, commit, committedAt };
}

async function fetchJson(fetchFn, ref, file) {
  const url = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${ref}/${file}`;
  const res = await fetchFn(url, { headers: { 'user-agent': 'xactions-sync-user-agents' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

/**
 * @param {string} dir
 * @returns {Promise<{agents: object, headers: object, commit: string, committedAt: string}>}
 */
export async function readFixtures(dir) {
  const read = async (name) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
  const meta = await read('meta.json');
  const [agents, headers] = await Promise.all([read('output.json'), read('header.json')]);
  return { agents, headers, commit: meta.commit, committedAt: meta.committedAt };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Swap the platform token in a User-Agent string.
 *
 * Chromium: `Mozilla/5.0 (<platform>) AppleWebKit/...`
 * Gecko:    `Mozilla/5.0 (<platform>; rv:<version>) Gecko/...`
 * The `rv:` fragment is part of the version upstream observed, so it is carried
 * across untouched.
 *
 * @param {string} userAgent
 * @param {string} platformToken
 * @returns {string}
 */
export function retargetPlatform(userAgent, platformToken) {
  const match = userAgent.match(/^Mozilla\/5\.0 \(([^)]*)\)(.*)$/s);
  if (!match) throw new Error(`Unrecognised User-Agent shape: ${userAgent}`);
  const [, original, rest] = match;
  const rv = original.match(/;\s*(rv:[\d.]+)\s*$/);
  const token = rv ? `${platformToken}; ${rv[1]}` : platformToken;
  return `Mozilla/5.0 (${token})${rest}`;
}

/**
 * Read the browser version out of a User-Agent, for the report and for the
 * generated `VERSIONS` map.
 *
 * @param {string} browser
 * @param {string} userAgent
 * @returns {string}
 */
export function extractVersion(browser, userAgent) {
  const patterns = { chrome: /Chrome\/([\d.]+)/, edge: /Edg\/([\d.]+)/, firefox: /Firefox\/([\d.]+)/ };
  const match = userAgent.match(patterns[browser]);
  if (!match) throw new Error(`Could not read a ${browser} version out of: ${userAgent}`);
  return match[1];
}

/**
 * Build the profile pool from upstream's two files.
 *
 * @param {object} agents  contents of output.json
 * @param {object} headers contents of header.json
 * @returns {{profiles: object[], versions: Record<string, string>}}
 */
export function buildProfiles(agents, headers) {
  const profiles = [];
  const versions = {};

  for (const { browser, engine, platform } of POOL) {
    const base = agents[browser];
    if (typeof base !== 'string' || !base) throw new Error(`Upstream output.json has no "${browser}" entry`);
    const upstreamHeaders = headers[browser] ?? {};
    const spec = PLATFORMS[platform];

    versions[browser] = extractVersion(browser, base);

    const profile = {
      id: `${browser}-${platform}`,
      browser,
      engine,
      platform,
      version: versions[browser],
      userAgent: retargetPlatform(base, spec[engine]),
      acceptLanguage: upstreamHeaders['accept-language'] ?? 'en-US,en;q=0.9',
      accept: upstreamHeaders.accept ?? null,
      acceptEncoding: upstreamHeaders['accept-encoding'] ?? null,
      // Gecko sends no client hints at all, so a Firefox profile that carried
      // Sec-CH-UA headers would contradict its own User-Agent.
      secChUa: engine === 'chromium' ? upstreamHeaders['sec-ch-ua'] ?? null : null,
      secChUaMobile: engine === 'chromium' ? upstreamHeaders['sec-ch-ua-mobile'] ?? '?0' : null,
      secChUaPlatform: engine === 'chromium' ? `"${spec.hint}"` : null,
    };
    profiles.push(profile);
  }

  if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID)) {
    throw new Error(`The pool does not contain the default profile ${DEFAULT_PROFILE_ID}`);
  }
  return { profiles, versions };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER = `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
//
// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run sync:user-agents
// Verify with:     npm run sync:user-agents:check
//
// Source data: https://github.com/fa0311/latest-user-agent (MIT, (c) fa0311),
// files output.json and header.json, produced by running the real browsers in
// CI and recording what they send. Upstream publishes Linux builds; the
// platform token is substituted per operating system (see
// scripts/sync-user-agents.mjs) and every version is upstream's, unmodified.
//
// Selection policy lives in ./userAgent.js, not here.
`;

/**
 * @param {object} data
 * @param {object[]} data.profiles
 * @param {Record<string, string>} data.versions
 * @param {string} data.commit
 * @param {string} data.committedAt
 * @param {string} data.fetchedAt
 * @returns {string}
 */
export function renderModule(data) {
  const lines = [];
  lines.push(HEADER);

  lines.push('/**');
  lines.push(' * Where this pool came from, and when. Read by `xactions doctor` so the age of');
  lines.push(' * the fingerprint is a fact rather than a guess.');
  lines.push(' * @type {Readonly<{repo: string, ref: string, commit: string, committedAt: string, fetchedAt: string, files: readonly string[]}>}');
  lines.push(' */');
  lines.push('export const UPSTREAM = Object.freeze({');
  lines.push(`  repo: ${JSON.stringify(UPSTREAM_REPO)},`);
  lines.push(`  ref: ${JSON.stringify(UPSTREAM_REF)},`);
  lines.push(`  commit: ${JSON.stringify(data.commit)},`);
  lines.push(`  committedAt: ${JSON.stringify(data.committedAt)},`);
  lines.push(`  fetchedAt: ${JSON.stringify(data.fetchedAt)},`);
  lines.push(`  files: Object.freeze([${Object.values(UPSTREAM_FILES).map((f) => JSON.stringify(f)).join(', ')}]),`);
  lines.push('});');
  lines.push('');

  lines.push('/**');
  lines.push(' * The browser versions upstream observed, for reporting.');
  lines.push(' * @type {Readonly<Record<string, string>>}');
  lines.push(' */');
  lines.push('export const VERSIONS = Object.freeze({');
  for (const [browser, version] of Object.entries(data.versions).sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`  ${browser}: ${JSON.stringify(version)},`);
  }
  lines.push('});');
  lines.push('');

  lines.push('/**');
  lines.push(' * One coherent browser identity per entry: the User-Agent and the request');
  lines.push(' * headers that a real install of that browser sends alongside it. Mixing a');
  lines.push(' * User-Agent from one row with client hints from another is exactly the');
  lines.push(' * inconsistency a fingerprinter looks for, so they travel together.');
  lines.push(' *');
  lines.push(' * @type {readonly Readonly<{id: string, browser: string, engine: string, platform: string, version: string, userAgent: string, acceptLanguage: string, accept: string|null, acceptEncoding: string|null, secChUa: string|null, secChUaMobile: string|null, secChUaPlatform: string|null}>[]}');
  lines.push(' */');
  lines.push('export const PROFILES = Object.freeze([');
  for (const profile of data.profiles) {
    lines.push('  Object.freeze({');
    for (const [key, value] of Object.entries(profile)) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    }
    lines.push('  }),');
  }
  lines.push(']);');
  lines.push('');

  lines.push('/**');
  lines.push(' * The profile chosen when a caller names none.');
  lines.push(' * @type {string}');
  lines.push(' */');
  lines.push(`export const DEFAULT_PROFILE_ID = ${JSON.stringify(DEFAULT_PROFILE_ID)};`);
  lines.push('');

  lines.push('/**');
  lines.push(' * Just the User-Agent strings, in profile order, for the callers that only');
  lines.push(' * ever wanted a string.');
  lines.push(' * @type {readonly string[]}');
  lines.push(' */');
  lines.push('export const USER_AGENT_STRINGS = Object.freeze(PROFILES.map((profile) => profile.userAgent));');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { check: false, json: false, fixtures: null, out: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--fixtures') args.fixtures = path.resolve(argv[++i] ?? '');
    else if (arg === '--out') args.out = path.resolve(argv[++i] ?? '');
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const HELP = `sync-user-agents  refresh the browser profile pool

  node scripts/sync-user-agents.mjs [--check] [--json] [--fixtures <dir>] [--out <file>]

  --check          do not write; exit 1 if the committed pool differs from upstream
  --json           print the report as JSON
  --fixtures <dir> read output.json, header.json and meta.json from <dir> instead of the network
  --out <file>     write somewhere other than src/client/auth/userAgents.generated.js
`;

/**
 * Run one sync.
 *
 * @param {object} [options]
 * @param {boolean} [options.check]
 * @param {string|null} [options.fixtures]
 * @param {string} [options.out]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {string} [options.now]
 * @returns {Promise<object>} report
 */
export async function sync(options = {}) {
  const out = options.out ?? DEFAULT_OUTPUT;
  const raw = options.fixtures ? await readFixtures(options.fixtures) : await fetchUpstream(options);
  const { profiles, versions } = buildProfiles(raw.agents, raw.headers);

  let committed = null;
  try {
    await fs.access(out);
    committed = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
  } catch {
    committed = null;
  }

  const fetchedAt = options.now ?? new Date().toISOString();
  const rendered = renderModule({ profiles, versions, commit: raw.commit, committedAt: raw.committedAt, fetchedAt });
  const comparable = committed?.UPSTREAM?.fetchedAt
    ? renderModule({ profiles, versions, commit: raw.commit, committedAt: raw.committedAt, fetchedAt: committed.UPSTREAM.fetchedAt })
    : rendered;

  let existing = null;
  try {
    existing = await fs.readFile(out, 'utf8');
  } catch {
    existing = null;
  }
  const upToDate = existing === comparable;

  const before = committed?.VERSIONS ?? null;
  const versionDiff = Object.entries(versions)
    .filter(([browser, version]) => !before || before[browser] !== version)
    .map(([browser, version]) => ({ browser, from: before ? before[browser] ?? null : null, to: version }));

  const report = {
    upstream: { repo: UPSTREAM_REPO, ref: UPSTREAM_REF, commit: raw.commit, committedAt: raw.committedAt },
    versions,
    versionDiff,
    profiles: profiles.map((p) => ({ id: p.id, userAgent: p.userAgent })),
    upToDate,
    out,
    written: false,
  };

  if (!options.check && !upToDate) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, rendered, 'utf8');
    report.written = true;
  }
  return report;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    process.exit(2);
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  let report;
  try {
    report = await sync(args);
  } catch (err) {
    console.error(`sync-user-agents failed: ${err.message}`);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`upstream ${report.upstream.repo}@${report.upstream.commit.slice(0, 12)} committed ${report.upstream.committedAt}`);
    console.log(`versions ${Object.entries(report.versions).map(([b, v]) => `${b} ${v}`).join(', ')}`);
    if (report.versionDiff.length) {
      console.log('\nchanged:');
      for (const d of report.versionDiff) console.log(`  ${d.browser.padEnd(10)} ${d.from ?? 'none'} -> ${d.to}`);
    }
    console.log(`\n${report.profiles.length} profiles:`);
    for (const p of report.profiles) console.log(`  ${p.id.padEnd(18)} ${p.userAgent}`);
    if (report.upToDate) console.log('\nup to date');
    else if (args.check) console.log(`\nSTALE: ${report.out} does not match upstream. Run: npm run sync:user-agents`);
    else console.log(`\nwrote ${report.out}`);
  }

  if (args.check && !report.upToDate) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
