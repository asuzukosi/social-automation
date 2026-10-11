// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — engagement sweep engine tests
// by nichxbt

import { describe, it, expect, vi } from 'vitest';
import {
  resolveSource,
  readSource,
  collectTweets,
  selectTweets,
  runEngage,
  nextDelay,
  isRateLimit,
  slug,
} from '../../src/engage/runner.js';

const tweet = (id, extra = {}) => ({
  id,
  text: `post ${id}`,
  username: 'nasa',
  name: 'NASA',
  likes: 10,
  isRetweet: false,
  isReply: false,
  timeParsed: new Date('2026-08-20T00:00:00Z'),
  photos: [],
  videos: [],
  ...extra,
});

const ALL = { like: true, repost: true, comment: true };

/** A Scraper stand-in: records every write and can be told to fail. */
function fakeScraper({ tweets = [], failOn = {} } = {}) {
  const calls = { likeTweet: [], retweet: [], sendTweet: [] };
  const maybeFail = (name) => {
    const err = failOn[name];
    if (!err) return;
    if (typeof err === 'function') { const e = err(); if (e) throw e; return; }
    throw err;
  };
  return {
    calls,
    async *getTweets() { yield* tweets; },
    async *getTweetsAndReplies() { yield* tweets; },
    async *searchTweets() { yield* tweets; },
    async *getListTweets() { yield* tweets; },
    async likeTweet(id) { maybeFail('likeTweet'); calls.likeTweet.push(id); },
    async retweet(id) { maybeFail('retweet'); calls.retweet.push(id); },
    async sendTweet(text, opts) { maybeFail('sendTweet'); calls.sendTweet.push({ text, ...opts }); },
  };
}

const noWait = async () => {};

describe('resolveSource', () => {
  it('describes a profile sweep', () => {
    const source = resolveSource({ username: '@NASA' });
    expect(source).toMatchObject({ kind: 'profile', username: 'NASA', label: '@NASA', stateKey: 'profile-nasa' });
  });

  it('marks the replies tab in the label', () => {
    expect(resolveSource({ username: 'nasa', includeReplies: true }).label).toBe('@nasa (with replies)');
  });

  it('describes search and list sweeps with distinct state keys', () => {
    const search = resolveSource({ search: 'open source AI' });
    expect(search).toMatchObject({ kind: 'search', query: 'open source AI', stateKey: 'search-open-source-ai' });
    const list = resolveSource({ list: '1234567890' });
    expect(list).toMatchObject({ kind: 'list', listId: '1234567890', stateKey: 'list-1234567890' });
    expect(search.stateKey).not.toBe(list.stateKey);
  });

  it('refuses no source, two sources, and malformed identifiers', () => {
    expect(() => resolveSource({})).toThrow(/Nothing to sweep/);
    expect(() => resolveSource({ username: 'nasa', search: 'x' })).toThrow(/Pick one source/);
    expect(() => resolveSource({ username: 'not a handle!' })).toThrow(/not a valid X handle/);
    expect(() => resolveSource({ list: 'x.com/i/lists/99' })).toThrow(/not a list ID/);
  });
});

describe('slug', () => {
  it('makes a query safe and short for a file name', () => {
    expect(slug('Open Source / AI?')).toBe('open-source-ai');
    expect(slug('!!!')).toBe('query');
    expect(slug('a'.repeat(80)).length).toBe(48);
  });
});

describe('readSource', () => {
  it('routes each kind to its scraper method', async () => {
    const scraper = {
      getTweets: vi.fn(async function* () { yield tweet('1'); }),
      getTweetsAndReplies: vi.fn(async function* () { yield tweet('2'); }),
      searchTweets: vi.fn(async function* () { yield tweet('3'); }),
      getListTweets: vi.fn(async function* () { yield tweet('4'); }),
    };
    const drain = async (it) => { const out = []; for await (const t of it) out.push(t.id); return out; };

    expect(await drain(readSource(scraper, resolveSource({ username: 'nasa' }), 5))).toEqual(['1']);
    expect(await drain(readSource(scraper, resolveSource({ username: 'nasa', includeReplies: true }), 5))).toEqual(['2']);
    expect(await drain(readSource(scraper, resolveSource({ search: 'ai' }), 5))).toEqual(['3']);
    expect(await drain(readSource(scraper, resolveSource({ list: '77' }), 5))).toEqual(['4']);
    expect(scraper.searchTweets).toHaveBeenCalledWith('ai', 5, 'Latest');
  });
});

describe('selectTweets filters', () => {
  it('applies author allow and block lists', () => {
    const tweets = [tweet('1', { username: 'nasa' }), tweet('2', { username: 'spammer' }), tweet('3', { username: 'esa' })];
    expect(selectTweets(tweets, { actions: ALL, skipUsers: ['@Spammer'] }).selected.map((t) => t.id)).toEqual(['1', '3']);
    expect(selectTweets(tweets, { actions: ALL, onlyFrom: ['esa'] }).selected.map((t) => t.id)).toEqual(['3']);
  });

  it('never engages your own posts', () => {
    const { selected, skipped } = selectTweets([tweet('1', { username: 'me' }), tweet('2')], { actions: ALL, self: '@Me' });
    expect(selected.map((t) => t.id)).toEqual(['2']);
    expect(skipped[0]).toEqual({ id: '1', why: 'your own post' });
  });

  it('applies keyword and skip-keyword matching case-insensitively', () => {
    const tweets = [tweet('1', { text: 'Solana is fast' }), tweet('2', { text: 'free airdrop giveaway' }), tweet('3', { text: 'rust compiler' })];
    expect(selectTweets(tweets, { actions: ALL, keywords: ['SOLANA', 'rust'] }).selected.map((t) => t.id)).toEqual(['1', '3']);
    expect(selectTweets(tweets, { actions: ALL, skipKeywords: ['airdrop'] }).selected.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('applies like floors and ceilings, reading either shape of metric', () => {
    const tweets = [tweet('1', { likes: 5 }), tweet('2', { likes: 500 }), tweet('3', { likes: undefined, metrics: { likes: 50 } })];
    expect(selectTweets(tweets, { actions: ALL, minLikes: 10 }).selected.map((t) => t.id)).toEqual(['2', '3']);
    expect(selectTweets(tweets, { actions: ALL, maxLikes: 100 }).selected.map((t) => t.id)).toEqual(['1', '3']);
    expect(selectTweets(tweets, { actions: ALL, minLikes: 10, maxLikes: 100 }).selected.map((t) => t.id)).toEqual(['3']);
  });

  it('explains every rejection', () => {
    const { skipped } = selectTweets(
      [tweet('1', { isRetweet: true }), tweet('2', { likes: 1 })],
      { actions: ALL, minLikes: 10 },
    );
    expect(skipped).toEqual([
      { id: '1', why: 'repost' },
      { id: '2', why: 'only 1 likes, below the floor' },
    ]);
  });
});

describe('collectTweets', () => {
  it('reads past the limit so filtered posts do not starve the run', async () => {
    // Four in five posts are replies: a naive read of `limit` would return one.
    const feed = Array.from({ length: 40 }, (_, i) => tweet(String(i), { isReply: i % 5 !== 0 }));
    const scraper = fakeScraper({ tweets: feed });
    const { fetched, selected } = await collectTweets(scraper, resolveSource({ username: 'nasa' }), { actions: ALL }, 5);
    expect(selected).toHaveLength(5);
    expect(fetched.length).toBeGreaterThan(5);
  });

  it('reports progress as it reads', async () => {
    const scraper = fakeScraper({ tweets: [tweet('1'), tweet('2')] });
    const seen = [];
    await collectTweets(scraper, resolveSource({ username: 'nasa' }), { actions: ALL }, 10, (n) => seen.push(n));
    expect(seen).toEqual([1, 2]);
  });

  it('returns the skip reasons when a filter matched nothing', async () => {
    const scraper = fakeScraper({ tweets: [tweet('1', { text: 'nothing relevant' })] });
    const { selected, skipped } = await collectTweets(scraper, resolveSource({ search: 'x' }), { actions: ALL, keywords: ['solana'] }, 5);
    expect(selected).toEqual([]);
    expect(skipped).toEqual([{ id: '1', why: 'no keyword match' }]);
  });
});

describe('runEngage', () => {
  const source = resolveSource({ username: 'nasa' });

  it('performs each enabled action and records progress', async () => {
    const scraper = fakeScraper();
    const done = {};
    const saved = [];
    const report = await runEngage({
      scraper,
      source,
      tweets: [tweet('1'), tweet('2')],
      actions: ALL,
      done,
      templates: ['Nice work {name}', 'Good detail here'],
      wait: noWait,
      onProgressSaved: (id) => saved.push(id),
    });

    expect(report).toMatchObject({ processed: 2, liked: 2, reposted: 2, commented: 2, failed: 0 });
    expect(scraper.calls.likeTweet).toEqual(['1', '2']);
    expect(scraper.calls.retweet).toEqual(['1', '2']);
    expect(scraper.calls.sendTweet.map((c) => c.replyTo)).toEqual(['1', '2']);
    expect(saved).toEqual(['1', '2']);
    expect(done['1']).toMatchObject({ liked: true, reposted: true, commented: true });
  });

  it('writes nothing on a dry run but still reports the replies it would post', async () => {
    const scraper = fakeScraper();
    const done = {};
    const report = await runEngage({
      scraper, source, tweets: [tweet('1')], actions: ALL, done,
      templates: ['Nice work {name}'], dryRun: true, wait: noWait,
    });
    expect(scraper.calls).toEqual({ likeTweet: [], retweet: [], sendTweet: [] });
    expect(report.results[0].comment).toBe('Nice work NASA');
    expect(report.results[0].actions).toEqual(['like', 'repost', 'comment']);
    expect(report.liked).toBe(0);
    expect(done).toEqual({});
  });

  it('skips the actions a previous run already did', async () => {
    const scraper = fakeScraper();
    const done = { 1: { liked: true, reposted: false, commented: true } };
    const report = await runEngage({
      scraper, source, tweets: [tweet('1')], actions: ALL, done,
      templates: ['x'], wait: noWait,
    });
    expect(scraper.calls.likeTweet).toEqual([]);
    expect(scraper.calls.sendTweet).toEqual([]);
    expect(scraper.calls.retweet).toEqual(['1']);
    expect(report.reposted).toBe(1);
  });

  it('retries once after a rate limit, then continues', async () => {
    let attempts = 0;
    const scraper = fakeScraper({
      failOn: {
        likeTweet: () => {
          attempts += 1;
          if (attempts === 1) return Object.assign(new Error('Rate limit exceeded'), { name: 'RateLimitError', retryAfter: 60 });
          return null;
        },
      },
    });
    const events = [];
    const report = await runEngage({
      scraper, source, tweets: [tweet('1')], actions: { like: true, repost: false, comment: false },
      wait: noWait, onEvent: (e) => events.push(e.type),
    });
    expect(report.liked).toBe(1);
    expect(report.failed).toBe(0);
    expect(events).toContain('ratelimit');
  });

  it('records a failed action without abandoning the rest of the post', async () => {
    const scraper = fakeScraper({ failOn: { retweet: new Error('repost blocked') } });
    const report = await runEngage({
      scraper, source, tweets: [tweet('1')], actions: ALL, templates: ['x'], wait: noWait,
    });
    expect(report.failed).toBe(1);
    expect(report.liked).toBe(1);
    expect(report.commented).toBe(1);
    expect(report.results[0].errors).toEqual(['repost: repost blocked']);
  });

  it('falls back to a template when the model fails, and gives up when there is none', async () => {
    const generator = { generate: async () => { throw new Error('provider down'); } };
    const withTemplate = await runEngage({
      scraper: fakeScraper(), source, tweets: [tweet('1')],
      actions: { like: false, repost: false, comment: true },
      generator, templates: ['Solid, {name}'], wait: noWait,
    });
    expect(withTemplate.commented).toBe(1);
    expect(withTemplate.results[0].comment).toBe('Solid, NASA');

    const without = await runEngage({
      scraper: fakeScraper(), source, tweets: [tweet('1')],
      actions: { like: false, repost: false, comment: true },
      generator, templates: [], wait: noWait,
    });
    expect(without.commented).toBe(0);
    expect(without.results[0].errors).toEqual(['comment: provider down']);
  });

  it('uses the generated comment and labels a regenerated one', async () => {
    const generator = { generate: async () => ({ text: 'The 40ms number is the headline.', model: 'm', attempts: 2 }) };
    const scraper = fakeScraper();
    const report = await runEngage({
      scraper, source, tweets: [tweet('1')],
      actions: { like: false, repost: false, comment: true },
      generator, wait: noWait,
    });
    expect(scraper.calls.sendTweet[0].text).toBe('The 40ms number is the headline.');
    expect(report.results[0].commentSource).toBe('ai (2nd try)');
  });

  it('stops when asked and says so', async () => {
    let seen = 0;
    const report = await runEngage({
      scraper: fakeScraper(), source,
      tweets: [tweet('1'), tweet('2'), tweet('3')],
      actions: { like: true, repost: false, comment: false },
      wait: noWait,
      shouldStop: () => { seen += 1; return seen > 2; },
    });
    expect(report.processed).toBe(2);
    expect(report.stoppedEarly).toBe(true);
  });
});

describe('pacing helpers', () => {
  it('keeps the delay inside the jitter band and never under a second', () => {
    expect(nextDelay(20, 10, () => 0)).toBe(10000);
    expect(nextDelay(20, 10, () => 1)).toBe(30000);
    expect(nextDelay(0, 0, () => 0.5)).toBe(1000);
  });

  it('recognises the several shapes of a rate-limit error', () => {
    expect(isRateLimit(Object.assign(new Error('nope'), { name: 'RateLimitError' }))).toBe(true);
    expect(isRateLimit(new Error('Too Many Requests'))).toBe(true);
    expect(isRateLimit(new Error('429 from upstream'))).toBe(true);
    expect(isRateLimit(new Error('not found'))).toBe(false);
    expect(isRateLimit(undefined)).toBe(false);
  });
});
