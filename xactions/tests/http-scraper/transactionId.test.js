// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for `x-client-transaction-id` request signing
 *
 * Covers: key-byte index extraction from a captured `ondemand.s` chunk,
 * verification-key and animation-path extraction from captured page markup,
 * ondemand chunk-URL resolution through the shared webpack manifest parser,
 * deterministic ID generation for a fixed method/path/key set, the pair
 * dictionary fast path, the live-parse fallback, cache read/write under a
 * temporary `$XACTIONS_HOME`, the on/off switch, and graceful degradation to
 * an unsigned request when signing cannot be done.
 *
 * Fixtures are real captures from x.com (2026-08-27). No network.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractVerificationKey,
  extractAnimationPaths,
  extractKeyByteIndices,
  resolveOnDemandChunkUrl,
  computeAnimationKey,
  keyToBytes,
  pathToFrameRows,
  floatToHex,
  normalizeSignedPath,
  generateTransactionId,
  discoverFromPairDictionary,
  discoverFromLiveBundles,
  initializeTransactionId,
  getTransactionId,
  isTransactionIdEnabled,
  transactionIdStatus,
  configureTransactionId,
  resetTransactionIdState,
  resolveCachePath,
  loadCache,
  saveCache,
  CACHE_FILENAME,
  PAIR_DICTIONARY_URL,
} from '../../src/scrapers/twitter/http/transactionId.js';
import { TwitterHttpClient } from '../../src/scrapers/twitter/http/client.js';
import { GuestTokenManager } from '../../src/scrapers/twitter/http/guest.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HOME_HTML = fs.readFileSync(path.join(fixtures, 'x-home-transaction.html'), 'utf8');
const ONDEMAND_JS = fs.readFileSync(path.join(fixtures, 'x-ondemand-s.js'), 'utf8');

/** What the fixtures, which are verbatim captures, must keep producing. */
const LIVE = {
  key: 'FLlaTQODQdnjpY6SK8G8RDi46nFwe8pU4OelNyubw6ax0z0iRp2+ofQeeOH0mVQG',
  rowIndex: 30,
  keyByteIndices: [25, 0, 9],
  animationKey: 'fef78f0fd70a3d70a3d70266666666666660266666666666660fd70a3d70a3d700',
  chunkUrl: 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.07294c1654628fe8a.js',
};

/** A published pair, in the shape fa0311's dictionary serves. */
const PAIR = {
  animationKey: '19862e100100',
  verification: 'OVP/YRGGT8OR+Jnhek7E7/YywL1mkDbQcrIGwS1KT4xzYiKU/M3hGgihLnX1BvXM',
};

let tempHome;
let previousHome;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-txid-'));
  previousHome = process.env.XACTIONS_HOME;
  process.env.XACTIONS_HOME = tempHome;
  configureTransactionId({});
});

afterEach(() => {
  configureTransactionId({});
  resetTransactionIdState();
  if (previousHome === undefined) delete process.env.XACTIONS_HOME;
  else process.env.XACTIONS_HOME = previousHome;
  delete process.env.XACTIONS_TRANSACTION_ID;
  delete process.env.XACTIONS_TXID_SOURCE;
  fs.rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A fetch that serves the fixtures and refuses anything else. */
function fixtureFetch({ pairs = [PAIR], failPairs = false, failHome = false, chunk = ONDEMAND_JS } = {}) {
  return vi.fn(async (url) => {
    const target = String(url);
    if (target === PAIR_DICTIONARY_URL) {
      if (failPairs) return { ok: false, status: 503, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(pairs) };
    }
    if (target.startsWith('https://x.com/') || target.startsWith('https://twitter.com/')) {
      if (failHome) return { ok: false, status: 429, text: async () => '' };
      return { ok: true, status: 200, text: async () => HOME_HTML };
    }
    if (target.includes('ondemand.s')) {
      return { ok: true, status: 200, text: async () => chunk };
    }
    return { ok: false, status: 404, text: async () => '' };
  });
}

// ---------------------------------------------------------------------------

describe('key extraction from captured x.com artefacts', () => {
  it('reads the key-byte indices out of a captured ondemand.s chunk', () => {
    const indices = extractKeyByteIndices(ONDEMAND_JS);
    expect(indices).toEqual({ rowIndex: LIVE.rowIndex, keyByteIndices: LIVE.keyByteIndices });
  });

  it('returns null when the chunk carries no index reads', () => {
    expect(extractKeyByteIndices('console.log("nothing to see")')).toBeNull();
    expect(extractKeyByteIndices(null)).toBeNull();
  });

  it('reads the site-verification key out of the page markup', () => {
    expect(extractVerificationKey(HOME_HTML)).toBe(LIVE.key);
    expect(extractVerificationKey('<html><head></head></html>')).toBeNull();
  });

  it('accepts the meta tag with its attributes in either order', () => {
    const reversed = '<meta content="QUJD" name="twitter-site-verification" />';
    expect(extractVerificationKey(reversed)).toBe('QUJD');
  });

  it('reads the four animation paths in document order', () => {
    const paths = extractAnimationPaths(HOME_HTML);
    expect(paths).toHaveLength(4);
    for (const d of paths) expect(d.startsWith('M ')).toBe(true);
    expect(new Set(paths).size).toBe(4);
  });

  it('ignores an animation frame that has no curve path', () => {
    expect(extractAnimationPaths('<svg id="loading-x-anim-0"><g><path d="M 0,0"/></g></svg>')).toEqual([]);
    expect(extractAnimationPaths(undefined)).toEqual([]);
  });

  it('resolves the ondemand chunk URL through the shared webpack manifest parser', () => {
    expect(resolveOnDemandChunkUrl(HOME_HTML)).toBe(LIVE.chunkUrl);
    expect(resolveOnDemandChunkUrl('<html></html>')).toBeNull();
  });

  it('computes the animation key the page and chunk imply', () => {
    const animationKey = computeAnimationKey({
      keyBytes: keyToBytes(LIVE.key),
      rowIndex: LIVE.rowIndex,
      keyByteIndices: LIVE.keyByteIndices,
      paths: extractAnimationPaths(HOME_HTML),
    });
    expect(animationKey).toBe(LIVE.animationKey);
  });

  it('returns null rather than throwing when the markup no longer lines up', () => {
    expect(computeAnimationKey({ keyBytes: [], rowIndex: 0, keyByteIndices: [1], paths: ['M 0,0 C 1,2'] })).toBeNull();
    expect(
      computeAnimationKey({ keyBytes: keyToBytes(LIVE.key), rowIndex: 30, keyByteIndices: [25], paths: [] }),
    ).toBeNull();
    expect(
      computeAnimationKey({ keyBytes: keyToBytes(LIVE.key), rowIndex: 30, keyByteIndices: [25], paths: ['M 1,1 C 2,2'] }),
    ).toBeNull();
  });

  it('splits a curve path into rows of integers', () => {
    const rows = pathToFrameRows('M 10,30 C 121,212 182,217 37,122 h 10 s 200,137 54,30 C 70,226 202,36 156,151');
    expect(rows[0]).toEqual([121, 212, 182, 217, 37, 122, 10, 200, 137, 54, 30]);
    expect(rows).toHaveLength(2);
  });

  it('converts floats to the hex shape the web client produces', () => {
    expect(floatToHex(1)).toBe('1');
    expect(floatToHex(0)).toBe('');
    expect(floatToHex(0.5)).toBe('.8');
  });
});

// ---------------------------------------------------------------------------

describe('transaction ID generation', () => {
  it('is deterministic for a fixed method, path, key set, clock and mask', async () => {
    const args = {
      key: LIVE.key,
      animationKey: LIVE.animationKey,
      method: 'GET',
      path: '/i/api/graphql/abc/UserByScreenName',
      timeNow: 1000,
      randomByte: 42,
    };
    const first = await generateTransactionId(args);
    const second = await generateTransactionId(args);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9+/]+$/);
    expect(first).not.toContain('=');
  });

  it('changes with the method, the path, the clock and the mask', async () => {
    const base = {
      key: LIVE.key,
      animationKey: LIVE.animationKey,
      method: 'GET',
      path: '/i/api/graphql/abc/UserByScreenName',
      timeNow: 1000,
      randomByte: 42,
    };
    const id = await generateTransactionId(base);
    expect(await generateTransactionId({ ...base, method: 'POST' })).not.toBe(id);
    expect(await generateTransactionId({ ...base, path: '/i/api/graphql/abc/TweetDetail' })).not.toBe(id);
    expect(await generateTransactionId({ ...base, timeNow: 1001 })).not.toBe(id);
    expect(await generateTransactionId({ ...base, randomByte: 43 })).not.toBe(id);
  });

  it('signs the pathname only, from a path or a full URL, and uppercases the verb', async () => {
    expect(normalizeSignedPath('https://x.com/i/api/graphql/abc/Op?variables=%7B%7D#frag')).toBe('/i/api/graphql/abc/Op');
    expect(normalizeSignedPath('i/api/graphql/abc/Op?x=1')).toBe('/i/api/graphql/abc/Op');
    expect(normalizeSignedPath('')).toBe('/');

    const fromUrl = await generateTransactionId({
      key: LIVE.key,
      animationKey: LIVE.animationKey,
      method: 'get',
      path: 'https://x.com/i/api/graphql/abc/Op?variables=%7B%7D',
      timeNow: 7,
      randomByte: 1,
    });
    const fromPath = await generateTransactionId({
      key: LIVE.key,
      animationKey: LIVE.animationKey,
      method: 'GET',
      path: '/i/api/graphql/abc/Op',
      timeNow: 7,
      randomByte: 1,
    });
    expect(fromUrl).toBe(fromPath);
  });

  it('carries the masked key bytes, timestamp and hash prefix in the payload', async () => {
    const id = await generateTransactionId({
      key: LIVE.key,
      animationKey: LIVE.animationKey,
      method: 'GET',
      path: '/i/api/graphql/abc/Op',
      timeNow: 1000,
      randomByte: 0,
    });
    const bytes = Buffer.from(id, 'base64');
    const keyBytes = keyToBytes(LIVE.key);
    // mask byte + key + 4 timestamp bytes + 16 hash bytes + 1 constant
    expect(bytes).toHaveLength(1 + keyBytes.length + 4 + 16 + 1);
    expect(bytes[0]).toBe(0); // the mask, unmasked
    expect(Array.from(bytes.subarray(1, 1 + keyBytes.length))).toEqual(keyBytes);
    expect(bytes[bytes.length - 1]).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe('discovery lanes', () => {
  it('takes a known-good pair from the dictionary without parsing any bundle', async () => {
    const fetchFn = fixtureFetch();
    const discovered = await discoverFromPairDictionary({ fetch: fetchFn });
    expect(discovered).toMatchObject({ key: PAIR.verification, animationKey: PAIR.animationKey, source: 'pairs' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe(PAIR_DICTIONARY_URL);
  });

  it('rejects a dictionary that holds nothing usable', async () => {
    await expect(discoverFromPairDictionary({ fetch: fixtureFetch({ pairs: [] }) })).rejects.toThrow(/no pairs/);
    await expect(
      discoverFromPairDictionary({ fetch: fixtureFetch({ pairs: [{ nope: 1 }] }) }),
    ).rejects.toThrow(/no usable/);
  });

  it('parses the live page and chunk when asked for the live lane', async () => {
    const fetchFn = fixtureFetch();
    const discovered = await discoverFromLiveBundles({ fetch: fetchFn, entryUrls: ['https://x.com/home'] });
    expect(discovered).toMatchObject({
      key: LIVE.key,
      animationKey: LIVE.animationKey,
      source: 'live',
      chunkUrl: LIVE.chunkUrl,
    });
  });

  it('reports every entry URL it tried when the live lane cannot read the keys', async () => {
    const fetchFn = fixtureFetch({ failHome: true });
    await expect(
      discoverFromLiveBundles({ fetch: fetchFn, entryUrls: ['https://x.com/home', 'https://x.com/'] }),
    ).rejects.toThrow(/x\.com\/home.*x\.com\//s);
  });

  it('falls back to the live lane when the dictionary is unreachable', async () => {
    const fetchFn = fixtureFetch({ failPairs: true });
    const keys = await initializeTransactionId({ fetch: fetchFn, cacheDir: tempHome });
    expect(keys).toMatchObject({ key: LIVE.key, animationKey: LIVE.animationKey, source: 'live' });
  });

  it('honours XACTIONS_TXID_SOURCE=live by trying the bundles first', async () => {
    process.env.XACTIONS_TXID_SOURCE = 'live';
    const fetchFn = fixtureFetch();
    const keys = await initializeTransactionId({ fetch: fetchFn, cacheDir: tempHome });
    expect(keys.source).toBe('live');
    expect(fetchFn.mock.calls.every((call) => String(call[0]) !== PAIR_DICTIONARY_URL)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('cache under a temporary XACTIONS_HOME', () => {
  it('writes the discovered keys under $XACTIONS_HOME and reads them back', async () => {
    const fetchFn = fixtureFetch();
    await initializeTransactionId({ fetch: fetchFn });

    const cachePath = resolveCachePath();
    expect(cachePath).toBe(path.join(tempHome, CACHE_FILENAME));
    expect(fs.existsSync(cachePath)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    expect(onDisk).toMatchObject({ key: PAIR.verification, animationKey: PAIR.animationKey, source: 'pairs' });
    expect(Date.parse(onDisk.fetchedAt)).not.toBeNaN();
  });

  it('serves a fresh cache from disk without touching the network', async () => {
    saveCache(
      { version: 1, fetchedAt: new Date().toISOString(), key: LIVE.key, animationKey: LIVE.animationKey, source: 'live' },
      tempHome,
    );
    resetTransactionIdState();

    const fetchFn = fixtureFetch();
    const keys = await initializeTransactionId({ fetch: fetchFn, cacheDir: tempHome });
    expect(keys).toMatchObject({ key: LIVE.key, animationKey: LIVE.animationKey });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rediscovers when the cached keys are older than the max age', async () => {
    saveCache(
      {
        version: 1,
        fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        key: LIVE.key,
        animationKey: LIVE.animationKey,
        source: 'live',
      },
      tempHome,
    );
    resetTransactionIdState();

    const fetchFn = fixtureFetch();
    const keys = await initializeTransactionId({ fetch: fetchFn, cacheDir: tempHome });
    expect(keys.source).toBe('pairs');
    expect(fetchFn).toHaveBeenCalled();
  });

  it('ignores a corrupt or half-written cache file', () => {
    fs.writeFileSync(path.join(tempHome, CACHE_FILENAME), '{"key":');
    expect(loadCache(tempHome)).toBeNull();
    fs.writeFileSync(path.join(tempHome, CACHE_FILENAME), JSON.stringify({ key: 'abc' }));
    expect(loadCache(tempHome)).toBeNull();
  });

  it('reports what it holds for diagnostics', async () => {
    expect(transactionIdStatus()).toMatchObject({ cached: false, stale: true, source: null });
    await initializeTransactionId({ fetch: fixtureFetch() });
    expect(transactionIdStatus()).toMatchObject({ cached: true, stale: false, source: 'pairs' });
  });
});

// ---------------------------------------------------------------------------

describe('the on/off switch', () => {
  it('is off under vitest unless asked for', () => {
    expect(isTransactionIdEnabled()).toBe(false);
    expect(isTransactionIdEnabled({ enabled: true })).toBe(true);
  });

  it('is switched off by XACTIONS_TRANSACTION_ID=0', () => {
    process.env.XACTIONS_TRANSACTION_ID = '0';
    expect(isTransactionIdEnabled()).toBe(false);
    process.env.XACTIONS_TRANSACTION_ID = 'off';
    expect(isTransactionIdEnabled()).toBe(false);
    process.env.XACTIONS_TRANSACTION_ID = '1';
    expect(isTransactionIdEnabled()).toBe(true);
  });

  it('returns null without any network call when signing is off', async () => {
    const fetchFn = fixtureFetch();
    configureTransactionId({ fetch: fetchFn, enabled: false });
    expect(await getTransactionId('GET', '/i/api/graphql/abc/Op')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('signs once the keys are available', async () => {
    configureTransactionId({ fetch: fixtureFetch(), enabled: true, cacheDir: tempHome });
    const id = await getTransactionId('GET', 'https://x.com/i/api/graphql/abc/Op?variables=%7B%7D');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------

describe('graceful degradation', () => {
  it('returns null when both discovery lanes fail', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    configureTransactionId({ fetch: fetchFn, enabled: true, cacheDir: tempHome });
    expect(await getTransactionId('GET', '/i/api/graphql/abc/Op')).toBeNull();
    expect(fetchFn).toHaveBeenCalled();
  });

  it('backs off instead of retrying discovery on every request', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    configureTransactionId({ fetch: fetchFn, enabled: true, cacheDir: tempHome });
    await getTransactionId('GET', '/a');
    const afterFirst = fetchFn.mock.calls.length;
    await getTransactionId('GET', '/b');
    expect(fetchFn.mock.calls.length).toBe(afterFirst);
  });

  it('keeps signing with stale keys when a refresh fails', async () => {
    saveCache(
      {
        version: 1,
        fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        key: LIVE.key,
        animationKey: LIVE.animationKey,
        source: 'live',
      },
      tempHome,
    );
    resetTransactionIdState();
    configureTransactionId({
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }),
      enabled: true,
      cacheDir: tempHome,
    });
    expect(typeof (await getTransactionId('GET', '/i/api/graphql/abc/Op'))).toBe('string');
  });

  it('never throws out of getTransactionId', async () => {
    configureTransactionId({ fetch: 'not a function', enabled: true, cacheDir: tempHome });
    await expect(getTransactionId('GET', '/i/api/graphql/abc/Op')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('wiring into the request lanes', () => {
  function primeKeys() {
    saveCache(
      { version: 1, fetchedAt: new Date().toISOString(), key: LIVE.key, animationKey: LIVE.animationKey, source: 'live' },
      tempHome,
    );
    resetTransactionIdState();
  }

  it('signs every GraphQL request the HTTP client sends', async () => {
    primeKeys();
    configureTransactionId({ cacheDir: tempHome });

    const seen = [];
    const fetchFn = vi.fn(async (url, init) => {
      seen.push({ url: String(url), headers: init.headers });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: { user: { result: {} } } }),
      };
    });

    const client = new TwitterHttpClient({ fetch: fetchFn, transactionId: true, autoRefreshQueryIds: false });
    await client.graphql('abc123', 'UserByScreenName', { screen_name: 'nasa' });

    expect(seen).toHaveLength(1);
    const header = seen[0].headers['x-client-transaction-id'];
    expect(typeof header).toBe('string');
    // mask byte + 48 key bytes + 4 timestamp bytes + 16 hash bytes + 1 constant
    expect(Buffer.from(header, 'base64')).toHaveLength(1 + keyToBytes(LIVE.key).length + 4 + 16 + 1);
    expect(seen[0].url).toContain('/i/api/graphql/');
  });

  it('sends the request unsigned rather than failing when signing is unavailable', async () => {
    configureTransactionId({
      cacheDir: tempHome,
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }),
    });

    const seen = [];
    const fetchFn = vi.fn(async (url, init) => {
      seen.push(init.headers);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: {} }) };
    });

    const client = new TwitterHttpClient({ fetch: fetchFn, transactionId: true, autoRefreshQueryIds: false });
    const result = await client.graphql('abc123', 'UserByScreenName', { screen_name: 'nasa' });

    expect(result).toBeTruthy();
    expect(seen[0]['x-client-transaction-id']).toBeUndefined();
  });

  it('leaves the header off entirely when signing is disabled', async () => {
    primeKeys();
    configureTransactionId({ cacheDir: tempHome });

    const seen = [];
    const fetchFn = vi.fn(async (url, init) => {
      seen.push(init.headers);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ data: {} }) };
    });

    const client = new TwitterHttpClient({ fetch: fetchFn, transactionId: false, autoRefreshQueryIds: false });
    await client.graphql('abc123', 'UserByScreenName', { screen_name: 'nasa' });
    expect(seen[0]['x-client-transaction-id']).toBeUndefined();
  });

  it('keeps a header the caller supplied itself', async () => {
    primeKeys();
    configureTransactionId({ cacheDir: tempHome });

    const seen = [];
    const fetchFn = vi.fn(async (url, init) => {
      seen.push(init.headers);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    });

    const client = new TwitterHttpClient({ fetch: fetchFn, transactionId: true, autoRefreshQueryIds: false });
    await client.request('https://x.com/i/api/graphql/abc/Op', {
      headers: { 'x-client-transaction-id': 'caller-supplied' },
    });
    expect(seen[0]['x-client-transaction-id']).toBe('caller-supplied');
  });

  it('signs guest headers when the request being signed is named', async () => {
    primeKeys();
    configureTransactionId({ cacheDir: tempHome });

    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ guest_token: '1234567890' }),
      text: async () => '',
    }));
    const guest = new GuestTokenManager({ fetch: fetchFn });

    const plain = await guest.getHeaders();
    expect(plain['x-client-transaction-id']).toBeUndefined();
    expect(plain['x-guest-token']).toBe('1234567890');

    const signed = await guest.getHeaders({
      method: 'GET',
      path: 'https://x.com/i/api/graphql/abc/UserByScreenName?variables=%7B%7D',
      transactionId: true,
    });
    expect(typeof signed['x-client-transaction-id']).toBe('string');
  });

  it('sends a User-Agent when activating a guest token', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ guest_token: '999' }),
      text: async () => '',
    }));
    const guest = new GuestTokenManager({ fetch: fetchFn });
    await guest.activate();
    // activate.json answers a request with no User-Agent with a misleading 404.
    expect(fetchFn.mock.calls[0][1].headers['user-agent']).toMatch(/Mozilla/);
  });
});
