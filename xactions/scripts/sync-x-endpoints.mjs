#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Regenerate the X GraphQL endpoint table from x.com's own bundles.
 *
 * Every internal GraphQL call to x.com is addressed by a persisted query ID.
 * X rotates those IDs whenever it ships a new web bundle, and a stale ID
 * answers `404 Query not found`. Until now the table in
 * `src/scrapers/twitter/http/endpoints.js` was refreshed by hand, which means
 * it was only ever as fresh as the last person who remembered.
 *
 * fa0311/TwitterInternalAPIDocument runs a bot that statically analyses x.com's
 * JavaScript bundles once a day and commits the result as JSON on its `develop`
 * branch. This script reads those files and writes
 * `src/scrapers/twitter/http/x-endpoints.generated.js`:
 *
 *   - `docs/json/GraphQL.json`  every operation with its queryId, operation
 *                               type, feature switches (with the values x.com's
 *                               own client sends) and field toggles.
 *   - `docs/json/v1.1.json`     the v1.1 REST dispatch table (path, method,
 *                               host), used to confirm our REST paths.
 *
 * `docs/json/FreezeObject.json` is deliberately not read. It holds x.com's
 * frozen Redux action-type and enum constants (`REQUEST`/`SUCCESS`/`FAILURE`
 * triples, keyboard-shortcut maps, entity-name maps); a sweep of all 1921
 * objects in it found no feature-flag defaults. The feature-flag values we need
 * are already carried per operation inside GraphQL.json.
 *
 * Attribution: the JSON this reads is produced by
 * https://github.com/fa0311/TwitterInternalAPIDocument (MIT, (c) fa0311).
 * The query IDs, operation names, endpoint paths and flag names themselves are
 * observations of x.com's behaviour rather than upstream's authorship. See
 * THIRD-PARTY-NOTICES.md.
 *
 * Usage:
 *   node scripts/sync-x-endpoints.mjs            # fetch and rewrite
 *   node scripts/sync-x-endpoints.mjs --check    # fail if the table is stale
 *   node scripts/sync-x-endpoints.mjs --json     # machine-readable report
 *   node scripts/sync-x-endpoints.mjs --fixtures tests/fixtures/upstream/x-endpoints
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

export const UPSTREAM_REPO = 'fa0311/TwitterInternalAPIDocument';
export const UPSTREAM_REF = 'develop';
export const UPSTREAM_FILES = {
  graphql: 'docs/json/GraphQL.json',
  v11: 'docs/json/v1.1.json',
};

export const DEFAULT_OUTPUT = path.join(ROOT, 'src/scrapers/twitter/http/x-endpoints.generated.js');

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Read the upstream JSON plus the commit it came from.
 *
 * @param {object} [options]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @returns {Promise<{graphql: object[], v11: object[], commit: string, committedAt: string}>}
 */
export async function fetchUpstream(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'xactions-sync-x-endpoints' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const commitRes = await fetchFn(`https://api.github.com/repos/${UPSTREAM_REPO}/commits/${UPSTREAM_REF}`, { headers });
  if (!commitRes.ok) {
    throw new Error(`GitHub API answered ${commitRes.status} for ${UPSTREAM_REPO}@${UPSTREAM_REF}; cannot record provenance`);
  }
  const commitBody = await commitRes.json();
  const commit = commitBody.sha;
  const committedAt = commitBody.commit?.committer?.date ?? commitBody.commit?.author?.date;
  if (!commit || !committedAt) throw new Error('GitHub API returned a commit without a sha or a date');

  const [graphql, v11] = await Promise.all([
    fetchJson(fetchFn, commit, UPSTREAM_FILES.graphql),
    fetchJson(fetchFn, commit, UPSTREAM_FILES.v11),
  ]);

  return { graphql, v11, commit, committedAt };
}

async function fetchJson(fetchFn, ref, file) {
  const url = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${ref}/${file}`;
  const res = await fetchFn(url, { headers: { 'user-agent': 'xactions-sync-x-endpoints' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error(`${file} is not the array this parser expects`);
  return body;
}

/**
 * Read the same three inputs from a directory of committed fixtures, so tests
 * and offline runs exercise the real parser against real upstream shapes.
 *
 * @param {string} dir
 * @returns {Promise<{graphql: object[], v11: object[], commit: string, committedAt: string}>}
 */
export async function readFixtures(dir) {
  const read = async (name) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
  const meta = await read('meta.json');
  const [graphql, v11] = await Promise.all([read('GraphQL.json'), read('v1.1.json')]);
  return { graphql, v11, commit: meta.commit, committedAt: meta.committedAt };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Collapse upstream's per-bundle entries into one record per operation.
 *
 * The same operation is emitted once per bundle that references it (747
 * entries for 325 operations at the time of writing), always with the same
 * query ID, so the first sighting wins and later duplicates are checked for
 * disagreement rather than silently dropped.
 *
 * @param {object[]} entries
 * @returns {{operations: Record<string, {queryId: string, type: string, features: string[], fieldToggles: string[]}>, featureValues: Record<string, boolean>, conflicts: string[]}}
 */
export function parseGraphQL(entries) {
  /** @type {Record<string, {queryId: string, type: string, features: string[], fieldToggles: string[]}>} */
  const operations = {};
  /** @type {Record<string, boolean>} */
  const featureValues = {};
  const conflicts = [];

  for (const entry of entries) {
    const x = entry?.exports;
    if (!x?.operationName || !x?.queryId) continue;

    const metadata = x.metadata ?? {};
    const features = [...new Set(metadata.featureSwitches ?? [])].sort();
    const fieldToggles = [...new Set(metadata.fieldToggles ?? [])].sort();

    for (const [name, spec] of Object.entries(metadata.featureSwitch ?? {})) {
      const value = spec?.value === 'true' || spec?.value === true;
      if (name in featureValues && featureValues[name] !== value) {
        conflicts.push(`feature ${name} is declared both true and false upstream`);
      }
      featureValues[name] = value;
    }

    const existing = operations[x.operationName];
    if (existing) {
      if (existing.queryId !== x.queryId) {
        conflicts.push(`${x.operationName} has two query IDs upstream: ${existing.queryId} and ${x.queryId}`);
      }
      continue;
    }

    operations[x.operationName] = {
      queryId: x.queryId,
      type: x.operationType ?? 'query',
      features,
      fieldToggles,
    };
  }

  return { operations, featureValues, conflicts };
}

/**
 * Turn upstream's v1.1 dispatch table into `path -> {methods, url}`.
 *
 * Each entry carries a `queryId` that is really a path fragment, and a
 * `dispatch` triple of `[method, apiPrefix, urlTemplate]` where the template
 * interpolates `{queryId}`. A few paths are dispatched under more than one
 * method (`account/settings` is both a GET and a POST), so methods accumulate
 * rather than overwrite.
 *
 * @param {object[]} entries
 * @returns {Record<string, {methods: string[], url: string}>}
 */
export function parseV11(entries) {
  /** @type {Record<string, {methods: string[], url: string}>} */
  const out = {};
  for (const entry of entries) {
    const fragment = entry?.queryId;
    const dispatch = entry?.dispatch;
    if (typeof fragment !== 'string' || !Array.isArray(dispatch) || dispatch.length < 3) continue;
    if (!fragment.replace(/^\//, '').trim()) continue;
    const [method, , template] = dispatch;
    if (typeof template !== 'string') continue;
    const url = template.replace('{queryId}', fragment.replace(/^\//, ''));
    const parsed = safeUrl(url);
    if (!parsed) continue;
    const verb = String(method).toUpperCase();
    const existing = out[parsed.pathname];
    if (existing) {
      if (!existing.methods.includes(verb)) existing.methods = [...existing.methods, verb].sort();
    } else {
      out[parsed.pathname] = { methods: [verb], url };
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const HEADER = `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
//
// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run sync:endpoints
// Verify with:     npm run sync:endpoints:check
//
// Source data: https://github.com/fa0311/TwitterInternalAPIDocument (MIT, (c) fa0311),
// files docs/json/GraphQL.json and docs/json/v1.1.json on the \`develop\` branch,
// produced by a bot that statically analyses x.com's own JavaScript bundles once
// a day. The query IDs, operation names, endpoint paths and feature-flag names
// below are observations of x.com's behaviour; upstream's contribution is the
// extraction. See THIRD-PARTY-NOTICES.md.
//
// Hand-pinning belongs in ./endpoints.js, not here: this file is overwritten in
// full on every sync.
`;

/**
 * Render the generated data module.
 *
 * Every collection is emitted in sorted order so that two syncs of the same
 * upstream commit produce byte-identical files and `--check` compares content
 * rather than iteration order.
 *
 * @param {object} data
 * @param {Record<string, object>} data.operations
 * @param {Record<string, boolean>} data.featureValues
 * @param {Record<string, object>} data.v11
 * @param {string} data.commit
 * @param {string} data.committedAt
 * @param {string} data.fetchedAt
 * @returns {string}
 */
export function renderModule(data) {
  const opNames = Object.keys(data.operations).sort();
  const featureNames = Object.keys(data.featureValues).sort();
  const featureIndex = new Map(featureNames.map((name, i) => [name, i]));

  const toggleNames = [...new Set(opNames.flatMap((name) => data.operations[name].fieldToggles))].sort();
  const toggleIndex = new Map(toggleNames.map((name, i) => [name, i]));

  const queries = opNames.filter((name) => data.operations[name].type === 'query').length;
  const mutations = opNames.filter((name) => data.operations[name].type === 'mutation').length;

  const lines = [];
  lines.push(HEADER);
  lines.push('/**');
  lines.push(' * Where this table came from, and when.');
  lines.push(' *');
  lines.push(' * `xactions doctor` and the endpoint audit read this instead of a date written');
  lines.push(' * into a comment by hand, so "last verified" is a fact rather than a claim.');
  lines.push(' *');
  lines.push(" * @type {Readonly<{repo: string, ref: string, commit: string, committedAt: string, fetchedAt: string, files: readonly string[], operations: number, queries: number, mutations: number, featureSwitches: number, fieldToggles: number, restPaths: number}>}");
  lines.push(' */');
  lines.push('export const UPSTREAM = Object.freeze({');
  lines.push(`  repo: ${JSON.stringify(UPSTREAM_REPO)},`);
  lines.push(`  ref: ${JSON.stringify(UPSTREAM_REF)},`);
  lines.push(`  commit: ${JSON.stringify(data.commit)},`);
  lines.push(`  committedAt: ${JSON.stringify(data.committedAt)},`);
  lines.push(`  fetchedAt: ${JSON.stringify(data.fetchedAt)},`);
  lines.push(`  files: Object.freeze([${Object.values(UPSTREAM_FILES).map((f) => JSON.stringify(f)).join(', ')}]),`);
  lines.push(`  operations: ${opNames.length},`);
  lines.push(`  queries: ${queries},`);
  lines.push(`  mutations: ${mutations},`);
  lines.push(`  featureSwitches: ${featureNames.length},`);
  lines.push(`  fieldToggles: ${toggleNames.length},`);
  lines.push(`  restPaths: ${Object.keys(data.v11).length},`);
  lines.push('});');
  lines.push('');

  lines.push('/**');
  lines.push(' * Every GraphQL feature switch x.com declares, with the value its own web');
  lines.push(' * client sends. No switch is declared with two different values upstream, so a');
  lines.push(' * single map is enough.');
  lines.push(' * @type {Readonly<Record<string, boolean>>}');
  lines.push(' */');
  lines.push('export const FEATURE_VALUES = Object.freeze({');
  for (const name of featureNames) lines.push(`  ${JSON.stringify(name)}: ${data.featureValues[name]},`);
  lines.push('});');
  lines.push('');

  lines.push('/**');
  lines.push(' * Feature-switch names, in the order the index lists below refer to them.');
  lines.push(' * @type {readonly string[]}');
  lines.push(' */');
  lines.push(`export const FEATURE_NAMES = Object.freeze([\n${wrapList(featureNames)}\n]);`);
  lines.push('');

  lines.push('/**');
  lines.push(" * Field-toggle names, in the order the index lists below refer to them. Upstream");
  lines.push(' * records which operations accept a toggle but not what value the client sends,');
  lines.push(' * so the values live in `FIELD_TOGGLE_VALUES` in ./endpoints.js.');
  lines.push(' * @type {readonly string[]}');
  lines.push(' */');
  lines.push(`export const FIELD_TOGGLE_NAMES = Object.freeze([\n${wrapList(toggleNames)}\n]);`);
  lines.push('');

  lines.push('/**');
  lines.push(' * Every operation x.com ships, keyed by operation name.');
  lines.push(' *');
  lines.push(' * `featureIdx` and `toggleIdx` index into `FEATURE_NAMES` and');
  lines.push(' * `FIELD_TOGGLE_NAMES`. They are stored as indexes because spelling every');
  lines.push(' * feature name out per operation would make this file roughly five times');
  lines.push(' * larger for no extra information. `operationFeatures()` in ./endpoints.js');
  lines.push(' * resolves them back to a `{name: boolean}` object.');
  lines.push(' *');
  lines.push(' * @type {Readonly<Record<string, Readonly<{queryId: string, type: string, featureIdx: readonly number[], toggleIdx: readonly number[]}>>>}');
  lines.push(' */');
  lines.push('export const OPERATIONS = Object.freeze({');
  for (const name of opNames) {
    const op = data.operations[name];
    const f = op.features.map((n) => featureIndex.get(n)).filter((i) => i !== undefined);
    const t = op.fieldToggles.map((n) => toggleIndex.get(n)).filter((i) => i !== undefined);
    lines.push(
      `  ${JSON.stringify(name)}: Object.freeze({ queryId: ${JSON.stringify(op.queryId)}, type: ${JSON.stringify(op.type)}, featureIdx: Object.freeze([${f.join(', ')}]), toggleIdx: Object.freeze([${t.join(', ')}]) }),`,
    );
  }
  lines.push('});');
  lines.push('');

  lines.push('/**');
  lines.push(" * x.com's v1.1 REST dispatch table, keyed by path. Recorded so the hand-written");
  lines.push(' * `REST` map in ./endpoints.js can be checked against what the client actually');
  lines.push(' * calls, including the HTTP methods and which of the two hosts serves it.');
  lines.push(' * @type {Readonly<Record<string, Readonly<{methods: readonly string[], url: string}>>>}');
  lines.push(' */');
  lines.push('export const REST_V11 = Object.freeze({');
  for (const [p, spec] of Object.entries(data.v11)) {
    lines.push(`  ${JSON.stringify(p)}: Object.freeze({ methods: Object.freeze([${spec.methods.map((m) => JSON.stringify(m)).join(', ')}]), url: ${JSON.stringify(spec.url)} }),`);
  }
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

function wrapList(names) {
  const out = [];
  let line = ' ';
  for (const name of names) {
    const piece = ` ${JSON.stringify(name)},`;
    if (line.length + piece.length > 110) {
      out.push(line);
      line = ' ';
    }
    line += piece;
  }
  if (line.trim()) out.push(line);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/**
 * Compare the newly fetched upstream data against whatever is committed.
 *
 * @param {Record<string, object>|null} previous  Result of `previousOperations()`
 * @param {Record<string, object>} next
 * @returns {{added: string[], removed: string[], rotated: {name: string, from: string, to: string}[]}}
 */
export function diffOperations(previous, next) {
  if (!previous) return { added: Object.keys(next).sort(), removed: [], rotated: [] };
  const added = Object.keys(next).filter((n) => !(n in previous)).sort();
  const removed = Object.keys(previous).filter((n) => !(n in next)).sort();
  const rotated = Object.keys(next)
    .filter((n) => previous[n] && previous[n].queryId !== next[n].queryId)
    .sort()
    .map((n) => ({ name: n, from: previous[n].queryId, to: next[n].queryId }));
  return { added, removed, rotated };
}

/**
 * Load the committed generated module, if it exists.
 *
 * @param {string} outPath
 * @returns {Promise<{operations: Record<string, object>, featureValues: Record<string, boolean>, upstream: object}|null>}
 */
export async function loadCommitted(outPath) {
  try {
    await fs.access(outPath);
  } catch {
    return null;
  }
  const mod = await import(`${pathToFileURL(outPath).href}?t=${Date.now()}`);
  return { operations: mod.OPERATIONS, featureValues: mod.FEATURE_VALUES, upstream: mod.UPSTREAM };
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

const HELP = `sync-x-endpoints  regenerate the X GraphQL endpoint table

  node scripts/sync-x-endpoints.mjs [--check] [--json] [--fixtures <dir>] [--out <file>]

  --check          do not write; exit 1 if the committed table differs from upstream
  --json           print the report as JSON
  --fixtures <dir> read GraphQL.json, v1.1.json and meta.json from <dir> instead of the network
  --out <file>     write somewhere other than src/scrapers/twitter/http/x-endpoints.generated.js
`;

/**
 * Run one sync.
 *
 * @param {object} [options]
 * @param {boolean} [options.check]
 * @param {string|null} [options.fixtures]
 * @param {string} [options.out]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {string} [options.now] ISO timestamp to record as `fetchedAt`
 * @returns {Promise<object>} report
 */
export async function sync(options = {}) {
  const out = options.out ?? DEFAULT_OUTPUT;
  const raw = options.fixtures ? await readFixtures(options.fixtures) : await fetchUpstream(options);

  const { operations, featureValues, conflicts } = parseGraphQL(raw.graphql);
  if (Object.keys(operations).length === 0) throw new Error('Upstream GraphQL.json yielded no operations');
  const v11 = parseV11(raw.v11);

  const committed = await loadCommitted(out);
  const diff = diffOperations(committed?.operations ?? null, operations);

  const featureDiff = [];
  if (committed) {
    for (const [name, value] of Object.entries(featureValues)) {
      const before = committed.featureValues[name];
      if (before === undefined) featureDiff.push({ name, from: null, to: value });
      else if (before !== value) featureDiff.push({ name, from: before, to: value });
    }
    for (const name of Object.keys(committed.featureValues)) {
      if (!(name in featureValues)) featureDiff.push({ name, from: committed.featureValues[name], to: null });
    }
  }

  const fetchedAt = options.now ?? new Date().toISOString();
  const rendered = renderModule({ operations, featureValues, v11, commit: raw.commit, committedAt: raw.committedAt, fetchedAt });

  let existing = null;
  try {
    existing = await fs.readFile(out, 'utf8');
  } catch {
    existing = null;
  }

  // Compare with the committed file's own `fetchedAt` substituted in, so a
  // re-run that finds nothing new is not reported as drift just because the
  // clock moved.
  const comparable = committed?.upstream?.fetchedAt
    ? renderModule({ operations, featureValues, v11, commit: raw.commit, committedAt: raw.committedAt, fetchedAt: committed.upstream.fetchedAt })
    : rendered;
  const upToDate = existing === comparable;

  const report = {
    upstream: { repo: UPSTREAM_REPO, ref: UPSTREAM_REF, commit: raw.commit, committedAt: raw.committedAt },
    counts: {
      operations: Object.keys(operations).length,
      featureSwitches: Object.keys(featureValues).length,
      restPaths: Object.keys(v11).length,
      committedOperations: committed ? Object.keys(committed.operations).length : 0,
    },
    diff,
    featureDiff,
    conflicts,
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

/**
 * Cross-check the curated table in endpoints.js against the freshly generated
 * data: a curated key whose operation disappeared upstream is a real breakage.
 *
 * @param {string} out Path of the generated module, already written
 * @returns {Promise<{tracked: number, orphaned: string[]}>}
 */
async function crossCheckCurated(out) {
  const endpoints = path.join(path.dirname(out), 'endpoints.js');
  const mod = await import(`${pathToFileURL(endpoints).href}?t=${Date.now()}`);
  const generated = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
  const orphaned = Object.entries(mod.GRAPHQL)
    .filter(([, entry]) => !(entry.operationName in generated.OPERATIONS))
    .map(([key, entry]) => `${key} (${entry.operationName})`);
  return { tracked: Object.keys(mod.GRAPHQL).length, orphaned };
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
    console.error(`sync-x-endpoints failed: ${err.message}`);
    process.exit(2);
  }

  // The cross-check reads the endpoints.js sitting beside the generated module,
  // so it only means anything when the module was written to its usual home.
  let curated = null;
  if (report.out === DEFAULT_OUTPUT && (!args.check || report.upToDate)) {
    try {
      curated = await crossCheckCurated(report.out);
    } catch (err) {
      console.error(`could not cross-check endpoints.js: ${err.message}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ ...report, curated }, null, 2));
  } else {
    printReport(report, curated, args.check);
  }

  if (args.check && !report.upToDate) process.exit(1);
  if (curated?.orphaned.length) process.exit(1);
}

function printReport(report, curated, check) {
  const { counts, diff, featureDiff, upstream } = report;
  console.log(`upstream   ${upstream.repo}@${upstream.commit.slice(0, 12)} committed ${upstream.committedAt}`);
  console.log(`operations ${counts.operations} upstream, ${counts.committedOperations} in the committed table`);
  console.log(`features   ${counts.featureSwitches} switches, ${counts.restPaths} v1.1 REST paths`);

  if (diff.rotated.length) {
    console.log(`\nrotated query IDs (${diff.rotated.length}):`);
    for (const r of diff.rotated) console.log(`  ${r.name.padEnd(38)} ${r.from} -> ${r.to}`);
  }
  if (diff.added.length) console.log(`\nnew operations (${diff.added.length}): ${diff.added.join(', ')}`);
  if (diff.removed.length) console.log(`\nretired operations (${diff.removed.length}): ${diff.removed.join(', ')}`);
  if (featureDiff.length) {
    console.log(`\nfeature switches changed (${featureDiff.length}):`);
    for (const f of featureDiff) console.log(`  ${f.name.padEnd(60)} ${f.from} -> ${f.to}`);
  }
  for (const c of report.conflicts) console.log(`\nupstream disagreement: ${c}`);

  if (curated) {
    console.log(`\ncurated table: ${curated.tracked} operations tracked in endpoints.js`);
    if (curated.orphaned.length) {
      console.log(`  gone from upstream (${curated.orphaned.length}): ${curated.orphaned.join(', ')}`);
    } else {
      console.log('  every curated operation is still shipped by x.com');
    }
  }

  if (report.upToDate) console.log('\nup to date');
  else if (check) console.log(`\nSTALE: ${report.out} does not match upstream. Run: npm run sync:endpoints`);
  else console.log(`\nwrote ${report.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
