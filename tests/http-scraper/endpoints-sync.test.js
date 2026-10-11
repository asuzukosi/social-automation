// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The endpoint table is generated now, so two things have to hold: the
 * generator turns real upstream JSON into the module we expect, and the module
 * every other file imports keeps the shape it has always had.
 *
 * Everything here runs offline against committed excerpts of
 * fa0311/TwitterInternalAPIDocument (MIT), so a test run never depends on
 * GitHub being reachable or on x.com not having rotated a query ID overnight.
 *
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  parseGraphQL,
  parseV11,
  renderModule,
  diffOperations,
  readFixtures,
  sync,
} from '../../scripts/sync-x-endpoints.mjs';

import {
  GRAPHQL,
  TRACKED_OPERATIONS,
  QUERY_ID_PINS,
  MISSING_OPERATIONS,
  SPECIALISED_OPERATIONS,
  REST,
  DEFAULT_FEATURES,
  DEFAULT_FIELD_TOGGLES,
  FEATURE_PINS,
  USER_AGENTS,
  ENDPOINT_TABLE_SOURCE,
  UPSTREAM_OPERATIONS,
  REST_V11,
  resolveGraphQL,
  operationFeatures,
  operationFieldToggles,
  buildGraphQLUrl,
  buildGraphQLVariables,
  validateEndpoints,
} from '../../src/scrapers/twitter/http/endpoints.js';

const FIXTURES = path.resolve(process.cwd(), 'tests/fixtures/upstream/x-endpoints');
const FROZEN_NOW = '2026-08-27T00:00:00.000Z';

let tmpDir;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-endpoints-sync-'));
});

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('sync-x-endpoints: parsing upstream JSON', () => {
  let fixture;

  beforeAll(async () => {
    fixture = await readFixtures(FIXTURES);
  });

  it('collapses the per-bundle entries into one record per operation', () => {
    const { operations } = parseGraphQL(fixture.graphql);
    expect(fixture.graphql.length).toBeGreaterThan(Object.keys(operations).length);
    expect(Object.keys(operations).sort()).toEqual([
      'BirdwatchFetchOneNote',
      'CreateTweet',
      'Favoriters',
      'ListLatestTweetsTimeline',
      'TweetDetail',
      'UserByScreenName',
    ]);
  });

  it('records the operation type and reads feature switch values as booleans', () => {
    const { operations, featureValues } = parseGraphQL(fixture.graphql);
    expect(operations.CreateTweet.type).toBe('mutation');
    expect(operations.UserByScreenName.type).toBe('query');
    for (const value of Object.values(featureValues)) expect(typeof value).toBe('boolean');
    expect(Object.keys(featureValues).length).toBeGreaterThan(0);
  });

  it('reports nothing to reconcile when upstream is self-consistent', () => {
    expect(parseGraphQL(fixture.graphql).conflicts).toEqual([]);
  });

  it('flags an operation that upstream gives two different query IDs', () => {
    const doctored = structuredClone(fixture.graphql);
    const seen = new Set();
    const second = doctored.find((entry) => {
      const name = entry.exports?.operationName;
      if (!name) return false;
      if (seen.has(name)) return true;
      seen.add(name);
      return false;
    });
    expect(second, 'fixture must contain one operation twice').toBeDefined();
    second.exports.queryId = 'AAAAAAAAAAAAAAAAAAAAAA';
    const { conflicts } = parseGraphQL(doctored);
    expect(conflicts.some((c) => c.includes('two query IDs'))).toBe(true);
  });

  it('builds v1.1 paths from the dispatch template and keeps both methods of a dual-method path', () => {
    const rest = parseV11(fixture.v11);
    expect(rest['/1.1/friendships/create.json']).toEqual({
      methods: ['POST'],
      url: 'https://api.x.com/1.1/friendships/create.json',
    });
    expect(rest['/1.1/account/settings.json'].methods.sort()).toEqual(['GET', 'POST']);
    expect(rest['/i/api/1.1/users/email_available.json'].url).toContain('https://x.com/i/api/');
  });

  it('names what changed between two upstream snapshots', () => {
    const previous = { Kept: { queryId: 'a' }, Rotated: { queryId: 'b' }, Retired: { queryId: 'c' } };
    const next = { Kept: { queryId: 'a' }, Rotated: { queryId: 'b2' }, Fresh: { queryId: 'd' } };
    expect(diffOperations(previous, next)).toEqual({
      added: ['Fresh'],
      removed: ['Retired'],
      rotated: [{ name: 'Rotated', from: 'b', to: 'b2' }],
    });
  });

  it('treats a first run with nothing committed as all-new rather than as drift', () => {
    expect(diffOperations(null, { A: { queryId: 'x' } })).toEqual({ added: ['A'], removed: [], rotated: [] });
  });
});

describe('sync-x-endpoints: generation', () => {
  let out;

  beforeAll(async () => {
    out = path.join(tmpDir, 'generated.js');
    await sync({ fixtures: FIXTURES, out, now: FROZEN_NOW });
  });

  it('writes a module that imports and carries the operations', async () => {
    const mod = await import(pathToFileURL(out).href);
    expect(mod.OPERATIONS.UserByScreenName.queryId).toBe('Gb-d6r0vxPOADdG62OEBpQ');
    expect(mod.OPERATIONS.CreateTweet.type).toBe('mutation');
    expect(mod.UPSTREAM.operations).toBe(6);
    expect(mod.USER_AGENTS).toBeUndefined();
  });

  it('records the upstream commit and the fetch time, so provenance is a fact', async () => {
    const mod = await import(pathToFileURL(out).href);
    expect(mod.UPSTREAM.repo).toBe('fa0311/TwitterInternalAPIDocument');
    expect(mod.UPSTREAM.commit).toBe('09d3ae0c48b12b2d24e5ae7a82b75606253fd7fd');
    expect(mod.UPSTREAM.committedAt).toBe('2026-08-27T01:26:28Z');
    expect(mod.UPSTREAM.fetchedAt).toBe(FROZEN_NOW);
    expect(mod.UPSTREAM.files).toContain('docs/json/GraphQL.json');
  });

  it('keeps every feature name resolvable through its index', async () => {
    const mod = await import(pathToFileURL(out).href);
    for (const op of Object.values(mod.OPERATIONS)) {
      for (const index of op.featureIdx) {
        expect(mod.FEATURE_NAMES[index]).toBeTypeOf('string');
        expect(mod.FEATURE_VALUES).toHaveProperty(mod.FEATURE_NAMES[index]);
      }
      for (const index of op.toggleIdx) expect(mod.FIELD_TOGGLE_NAMES[index]).toBeTypeOf('string');
    }
  });

  it('carries the upstream attribution in the file itself', async () => {
    const text = await fs.readFile(out, 'utf8');
    expect(text).toContain('fa0311/TwitterInternalAPIDocument');
    expect(text).toContain('MIT');
    expect(text).toContain('GENERATED FILE');
  });

  it('is deterministic: the same upstream data renders byte-identically', async () => {
    const first = await fs.readFile(out, 'utf8');
    const second = path.join(tmpDir, 'generated-again.js');
    await sync({ fixtures: FIXTURES, out: second, now: FROZEN_NOW });
    expect(await fs.readFile(second, 'utf8')).toBe(first);
  });

  it('renders the same bytes whichever order upstream lists its operations in', async () => {
    const fixture = await readFixtures(FIXTURES);
    const forwards = parseGraphQL(fixture.graphql);
    const backwards = parseGraphQL([...fixture.graphql].reverse());
    const args = { v11: parseV11(fixture.v11), commit: 'x', committedAt: FROZEN_NOW, fetchedAt: FROZEN_NOW };
    expect(renderModule({ ...args, ...backwards })).toBe(renderModule({ ...args, ...forwards }));
  });
});

describe('sync-x-endpoints: --check', () => {
  it('passes when the committed module already matches upstream', async () => {
    const out = path.join(tmpDir, 'check-clean.js');
    await sync({ fixtures: FIXTURES, out, now: FROZEN_NOW });
    const report = await sync({ fixtures: FIXTURES, out, check: true, now: FROZEN_NOW });
    expect(report.upToDate).toBe(true);
    expect(report.written).toBe(false);
  });

  it('passes on a re-run days later, because a moved clock is not drift', async () => {
    const out = path.join(tmpDir, 'check-clock.js');
    await sync({ fixtures: FIXTURES, out, now: FROZEN_NOW });
    const before = await fs.readFile(out, 'utf8');
    const report = await sync({ fixtures: FIXTURES, out, check: true, now: '2026-09-30T11:22:33.000Z' });
    expect(report.upToDate).toBe(true);
    expect(await fs.readFile(out, 'utf8')).toBe(before);
  });

  it('fails when a query ID rotated upstream, and leaves the file alone', async () => {
    const out = path.join(tmpDir, 'check-rotated.js');
    await sync({ fixtures: FIXTURES, out, now: FROZEN_NOW });
    const before = await fs.readFile(out, 'utf8');

    const rotated = path.join(tmpDir, 'rotated-fixtures');
    await fs.mkdir(rotated, { recursive: true });
    for (const name of ['v1.1.json', 'meta.json']) {
      await fs.copyFile(path.join(FIXTURES, name), path.join(rotated, name));
    }
    const graphql = JSON.parse(await fs.readFile(path.join(FIXTURES, 'GraphQL.json'), 'utf8'));
    for (const entry of graphql) {
      if (entry.exports?.operationName === 'TweetDetail') entry.exports.queryId = 'rotatedQueryId000000AA';
    }
    await fs.writeFile(path.join(rotated, 'GraphQL.json'), JSON.stringify(graphql, null, 2));

    const report = await sync({ fixtures: rotated, out, check: true, now: FROZEN_NOW });
    expect(report.upToDate).toBe(false);
    expect(report.diff.rotated).toEqual([
      { name: 'TweetDetail', from: 'XMOz5h24KAZ86qKffKTLdQ', to: 'rotatedQueryId000000AA' },
    ]);
    expect(await fs.readFile(out, 'utf8')).toBe(before);
  });

  it('fails when an operation is retired upstream', async () => {
    const out = path.join(tmpDir, 'check-retired.js');
    await sync({ fixtures: FIXTURES, out, now: FROZEN_NOW });

    const trimmed = path.join(tmpDir, 'retired-fixtures');
    await fs.mkdir(trimmed, { recursive: true });
    for (const name of ['v1.1.json', 'meta.json']) {
      await fs.copyFile(path.join(FIXTURES, name), path.join(trimmed, name));
    }
    const graphql = JSON.parse(await fs.readFile(path.join(FIXTURES, 'GraphQL.json'), 'utf8'));
    await fs.writeFile(
      path.join(trimmed, 'GraphQL.json'),
      JSON.stringify(graphql.filter((e) => e.exports?.operationName !== 'Favoriters'), null, 2),
    );

    const report = await sync({ fixtures: trimmed, out, check: true, now: FROZEN_NOW });
    expect(report.upToDate).toBe(false);
    expect(report.diff.removed).toEqual(['Favoriters']);
  });

  it('fails when a feature switch flipped upstream', async () => {
    const out = path.join(tmpDir, 'check-feature.js');
    await sync({ fixtures: FIXTURES, out, now: FROZEN_NOW });

    const flipped = path.join(tmpDir, 'flipped-fixtures');
    await fs.mkdir(flipped, { recursive: true });
    for (const name of ['v1.1.json', 'meta.json']) {
      await fs.copyFile(path.join(FIXTURES, name), path.join(flipped, name));
    }
    const graphql = JSON.parse(await fs.readFile(path.join(FIXTURES, 'GraphQL.json'), 'utf8'));
    let flippedName = null;
    for (const entry of graphql) {
      const switches = entry.exports?.metadata?.featureSwitch;
      if (!switches) continue;
      for (const [name, spec] of Object.entries(switches)) {
        if (flippedName && name !== flippedName) continue;
        flippedName ??= name;
        spec.value = spec.value === 'true' ? 'false' : 'true';
      }
    }
    expect(flippedName).toBeTypeOf('string');
    await fs.writeFile(path.join(flipped, 'GraphQL.json'), JSON.stringify(graphql, null, 2));

    const report = await sync({ fixtures: flipped, out, check: true, now: FROZEN_NOW });
    expect(report.upToDate).toBe(false);
    expect(report.featureDiff.map((f) => f.name)).toContain(flippedName);
  });

  it('refuses to write a table with no operations in it', async () => {
    const empty = path.join(tmpDir, 'empty-fixtures');
    await fs.mkdir(empty, { recursive: true });
    for (const name of ['v1.1.json', 'meta.json']) {
      await fs.copyFile(path.join(FIXTURES, name), path.join(empty, name));
    }
    await fs.writeFile(path.join(empty, 'GraphQL.json'), '[]');
    await expect(sync({ fixtures: empty, out: path.join(tmpDir, 'never.js') })).rejects.toThrow(/no operations/);
  });
});

describe('endpoints.js: the exports every other module depends on', () => {
  it('still exports the table, the REST paths, the defaults and the helpers', () => {
    expect(GRAPHQL).toBeTypeOf('object');
    expect(REST).toBeTypeOf('object');
    expect(DEFAULT_FEATURES).toBeTypeOf('object');
    expect(DEFAULT_FIELD_TOGGLES).toBeTypeOf('object');
    expect(USER_AGENTS.length).toBeGreaterThan(0);
    expect(resolveGraphQL).toBeTypeOf('function');
    expect(buildGraphQLUrl).toBeTypeOf('function');
    expect(buildGraphQLVariables).toBeTypeOf('function');
    expect(validateEndpoints).toBeTypeOf('function');
  });

  it('keeps every entry shaped {queryId, operationName}, the shape callers destructure', () => {
    for (const [key, entry] of Object.entries(GRAPHQL)) {
      expect(entry.queryId, key).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(entry.operationName, key).toMatch(/^[A-Za-z0-9_]+$/);
      expect(['query', 'mutation', 'subscription']).toContain(entry.type);
    }
  });

  it('keeps the operations the codebase names, including the ones keyed differently', () => {
    for (const key of [
      'UserByScreenName',
      'UserTweets',
      'TweetDetail',
      'SearchTimeline',
      'Followers',
      'Following',
      'CreateTweet',
      'FavoriteTweet',
      'HomeTimeline',
      'NotificationsTimeline',
      'CommunityByRestId',
      'AudioSpaceById',
      'BlueVerifiedFollowers',
      'FollowersYouKnow',
      'UserHighlightsTweets',
      'UserArticlesTweets',
    ]) {
      expect(GRAPHQL, key).toHaveProperty(key);
    }
    expect(GRAPHQL.Likes.operationName).toBe('Favoriters');
    expect(GRAPHQL.UserLikes.operationName).toBe('Likes');
    expect(GRAPHQL.ListTimeline.operationName).toBe('ListLatestTweetsTimeline');
    expect(GRAPHQL.BookmarkTimeline.operationName).toBe('Bookmarks');
  });

  it('tracks every curated key against an operation x.com still ships', () => {
    expect(MISSING_OPERATIONS).toEqual([]);
    for (const [key, operationName] of Object.entries(TRACKED_OPERATIONS)) {
      if (key in QUERY_ID_PINS) continue;
      expect(UPSTREAM_OPERATIONS, `${key} -> ${operationName}`).toHaveProperty(operationName);
    }
  });

  it('takes its query IDs from the generated table unless a human pinned one', () => {
    for (const [key, entry] of Object.entries(GRAPHQL)) {
      const expected = QUERY_ID_PINS[key] ?? UPSTREAM_OPERATIONS[entry.operationName].queryId;
      expect(entry.queryId, key).toBe(expected);
    }
  });

  it('resolves an operation x.com ships that the curated table does not name', () => {
    expect(GRAPHQL).not.toHaveProperty('ListByRestId');
    const resolved = resolveGraphQL('ListByRestId');
    expect(resolved.operationName).toBe('ListByRestId');
    expect(resolved.queryId).toBe(UPSTREAM_OPERATIONS.ListByRestId.queryId);
  });

  it('still refuses a key that is neither tracked nor shipped', () => {
    expect(() => resolveGraphQL('NoSuchOperationAnywhere')).toThrow(/Unknown GraphQL endpoint key/);
  });

  it('answers with the exact switches one operation declares', () => {
    const features = operationFeatures('UserByScreenName');
    expect(Object.keys(features).length).toBeGreaterThan(0);
    for (const value of Object.values(features)) expect(typeof value).toBe('boolean');
    expect(operationFeatures('NotAnOperation')).toEqual({});
    expect(operationFieldToggles('NotAnOperation')).toEqual({});
  });

  it('sends every switch a tracked operation needs, so nothing is ever null', () => {
    for (const operationName of Object.values(TRACKED_OPERATIONS)) {
      if (SPECIALISED_OPERATIONS.includes(operationName)) continue;
      for (const name of Object.keys(operationFeatures(operationName))) {
        expect(DEFAULT_FEATURES, `${operationName} needs ${name}`).toHaveProperty(name);
      }
    }
  });

  it('keeps a specialised operation family out of the default set', () => {
    const birdwatch = Object.keys(operationFeatures('BirdwatchFetchOneNote')).filter((n) => n.includes('birdwatch'));
    expect(birdwatch.length).toBeGreaterThan(0);
    for (const name of birdwatch) expect(DEFAULT_FEATURES).not.toHaveProperty(name);
  });

  it('applies the hand pins over whatever upstream declares', () => {
    for (const [name, value] of Object.entries(FEATURE_PINS)) {
      expect(DEFAULT_FEATURES[name]).toBe(value);
    }
  });

  it('sends only booleans as features and toggles', () => {
    for (const value of Object.values(DEFAULT_FEATURES)) expect(typeof value).toBe('boolean');
    for (const value of Object.values(DEFAULT_FIELD_TOGGLES)) expect(typeof value).toBe('boolean');
    expect(Object.keys(DEFAULT_FIELD_TOGGLES)).toContain('withArticleRichContentState');
    expect(DEFAULT_FIELD_TOGGLES.withArticleRichContentState).toBe(true);
  });

  it('publishes where the table came from, so "last verified" has a source', () => {
    expect(ENDPOINT_TABLE_SOURCE.repo).toBe('fa0311/TwitterInternalAPIDocument');
    expect(ENDPOINT_TABLE_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(ENDPOINT_TABLE_SOURCE.fetchedAt))).toBe(false);
    expect(Number.isNaN(Date.parse(ENDPOINT_TABLE_SOURCE.committedAt))).toBe(false);
    expect(ENDPOINT_TABLE_SOURCE.operations).toBe(Object.keys(UPSTREAM_OPERATIONS).length);
  });

  it('confirms the hand-written REST paths that upstream also dispatches', () => {
    const confirmed = Object.values(REST).filter((p) => `/1.1${p.replace(/^\/1\.1/, '')}` in REST_V11 || p in REST_V11);
    expect(confirmed.length).toBeGreaterThan(0);
    expect(REST_V11['/1.1/friendships/create.json'].methods).toContain('POST');
  });

  it('builds a GraphQL URL that carries the defaults', () => {
    const url = buildGraphQLUrl('qid', 'UserByScreenName', { screen_name: 'nasa' });
    expect(url).toContain('/graphql/qid/UserByScreenName?');
    const params = new URL(url).searchParams;
    expect(JSON.parse(params.get('variables'))).toEqual({ screen_name: 'nasa' });
    expect(JSON.parse(params.get('features'))).toEqual(DEFAULT_FEATURES);
  });
});
