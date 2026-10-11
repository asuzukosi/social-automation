// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the analytics processors
 * (api/services/processors/analytics.processors.js).
 *
 * Nothing of ours is mocked. The network is: `fetch` answers GraphQL calls the
 * way x.com does, shaped from the parsers the processors run, and a browser
 * page stands in for Puppeteer where a job reads one of X's web apps. The
 * SQLite store is real, in a temporary home directory.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobContext, isPermanentFailure, JobInputError } from '../../../api/services/processors/context.js';

// The analytics database lives under $HOME/.xactions; keep it out of the real one.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-analytics-'));
process.env.HOME = HOME;

let processors;
beforeAll(async () => {
  processors = (await import('../../../api/services/processors/analytics.processors.js')).default;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  (await import('../../../src/analytics/historyStore.js')).closeDb();
  fs.rmSync(HOME, { recursive: true, force: true });
});

const COOKIE = 'auth_token=tok; ct0=csrf';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const twitterDate = (ms) => new Date(ms).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 +0000 $4');

// ── x.com fixtures ─────────────────────────────────────────────────────────

const PEOPLE = {
  alice: { id: 1, bio: 'Founder building developer tools for data teams', followers: 1200, following: 300, tweets: 5000, location: 'Berlin', website: 'https://alice.dev', verified: true },
  bob: { id: 2, bio: 'Head of growth at a seed-stage startup', followers: 800, following: 400, tweets: 2100, location: 'Austin' },
  carol: { id: 3, bio: 'Engineer', followers: 90, following: 150, tweets: 300 },
  dave: { id: 4, bio: '', followers: 20000, following: 50, tweets: 9000, verified: true },
  erin: { id: 5, bio: 'Analyst. Contact: erin@example.com', followers: 450, following: 420, tweets: 1500, website: 'https://erin.io' },
};

function userResult(username) {
  const p = PEOPLE[username];
  return {
    __typename: 'User',
    rest_id: String(p.id),
    is_blue_verified: Boolean(p.verified),
    core: { screen_name: username, name: username.toUpperCase(), created_at: 'Mon Jan 01 00:00:00 +0000 2018' },
    location: { location: p.location || '' },
    legacy: {
      screen_name: username,
      name: username.toUpperCase(),
      description: p.bio,
      followers_count: p.followers,
      friends_count: p.following,
      statuses_count: p.tweets,
      location: p.location || '',
      url: p.website ? 'https://t.co/site' : null,
      entities: p.website ? { url: { urls: [{ url: 'https://t.co/site', expanded_url: p.website }] } } : {},
      profile_image_url_https: `https://pbs.twimg.com/profile_images/${username}_normal.jpg`,
    },
  };
}

function tweetResult({ id, author, text, at, likes = 0, retweets = 0, replies = 0, views = 0, reply = false, hashtags = [], links = [] }) {
  return {
    __typename: 'Tweet',
    rest_id: String(id),
    core: { user_results: { result: userResult(author) } },
    views: { count: String(views) },
    legacy: {
      id_str: String(id),
      full_text: text,
      created_at: twitterDate(at),
      favorite_count: likes,
      retweet_count: retweets,
      reply_count: replies,
      quote_count: 0,
      bookmark_count: 0,
      lang: 'en',
      in_reply_to_status_id_str: reply ? '999' : undefined,
      entities: {
        hashtags: hashtags.map((text) => ({ text })),
        user_mentions: [],
        urls: links.map((u) => ({ url: 'https://t.co/l', expanded_url: u, display_url: u })),
      },
    },
  };
}

const addEntries = (entries) => [{ type: 'TimelineAddEntries', entries }];
const tweetEntries = (tweets) => tweets.map((t) => ({ entryId: `tweet-${t.id}`, content: { itemContent: { tweet_results: { result: tweetResult(t) } } } }));
const userEntries = (names) => names.map((n) => ({ entryId: `user-${PEOPLE[n].id}`, content: { itemContent: { user_results: { result: userResult(n) } } } }));
const userTimeline = (instructions) => ({ data: { user: { result: { timeline: { timeline: { instructions } } } } } });
const nameOfId = (id) => Object.keys(PEOPLE).find((n) => String(PEOPLE[n].id) === String(id));

/**
 * A fetch that answers like x.com for the given world.
 * `handlers` overrides or adds GraphQL operations: (variables) => body | { status, body }.
 */
function xcom({ posts = {}, followers = {}, following = {}, search = () => [], handlers = {} } = {}, calls = []) {
  const ops = {
    UserByScreenName: (v) => (PEOPLE[v.screen_name.toLowerCase()] ? { data: { user: { result: userResult(v.screen_name.toLowerCase()) } } } : { data: { user: {} } }),
    UserByRestId: (v) => (nameOfId(v.userId) ? { data: { user: { result: userResult(nameOfId(v.userId)) } } } : { data: { user: {} } }),
    UserTweets: (v) => userTimeline(addEntries(tweetEntries(posts[nameOfId(v.userId)] || []))),
    Followers: (v) => userTimeline(addEntries(userEntries(followers[nameOfId(v.userId)] || []))),
    Following: (v) => userTimeline(addEntries(userEntries(following[nameOfId(v.userId)] || []))),
    SearchTimeline: (v) => ({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions: addEntries(tweetEntries(search(v.rawQuery))) } } } } }),
    ...handlers,
  };
  return async (url, init = {}) => {
    const u = new URL(url);
    const op = u.pathname.split('/').pop();
    const variables = init.method === 'POST' ? JSON.parse(init.body).variables : JSON.parse(u.searchParams.get('variables') || '{}');
    calls.push({ op, variables });
    const out = ops[op] ? ops[op](variables) : { status: 404, body: { errors: [{ message: 'Not found' }] } };
    const [status, body] = out && typeof out.status === 'number' ? [out.status, out.body] : [200, out];
    return { status, headers: { get: () => null, getSetCookie: () => [] }, json: async () => body };
  };
}

// ── Browser fixtures ───────────────────────────────────────────────────────

function fakeBrowser({ finalUrl, dom = {}, responses = [] }) {
  const listeners = new Set();
  const visits = [];
  const page = {
    on: (event, fn) => listeners.add(fn),
    off: (event, fn) => listeners.delete(fn),
    goto: async (url) => {
      visits.push(url);
      for (const r of responses) {
        for (const fn of listeners) {
          fn({
            url: () => r.url,
            status: () => 200,
            headers: () => ({ 'content-type': r.contentType || 'application/json' }),
            request: () => ({ resourceType: () => r.type || 'xhr' }),
            json: async () => r.body,
          });
        }
      }
    },
    url: () => finalUrl,
    evaluate: async () => ({ title: 'X', headings: [], regions: [], tables: [], text: '', ...dom }),
    close: async () => {},
  };
  return { browser: async () => ({ createPage: async () => page }), visits };
}

// ── Running a job ──────────────────────────────────────────────────────────

let seq = 0;

function run(type, config = {}, { owner = 'owner-a', fetch, browser, userId, decrypt } = {}) {
  const id = `op-${++seq}`;
  const data = {
    type,
    id,
    config: userId ? { delayMs: 0, ...config } : { sessionCookie: COOKIE, delayMs: 0, ...config },
    ...(userId ? { userId } : { sessionHash: owner }),
  };
  const ctx = createJobContext({ id, name: type, data, progress: () => {} }, { fetch, browser, decrypt });
  return processors[type].run(ctx).finally(() => ctx.dispose());
}

async function failure(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the job to fail');
}

/** Drive a job whose code waits on real timers, under fake ones. */
async function withFakeTimers(start) {
  vi.useFakeTimers();
  const promise = start();
  let done = false;
  promise.then(() => (done = true), () => (done = true));
  while (!done) await vi.advanceTimersByTimeAsync(3000);
  return promise;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('analytics processor registry', () => {
  it('defines every analytics job type except the two removed as unimplementable', () => {
    const expected = [
      'getCreatorAnalytics', 'getAnalyticsHistory', 'storeSnapshot', 'computeGrowthRate', 'creatorAnalytics',
      'creatorRevenue', 'creatorSubscribers', 'creatorStudio', 'creatorSubscriptions', 'getRevenue', 'getSubscribers',
      'graphBuild', 'graphAnalyze', 'graphRecommendations', 'crmSync', 'crmTag', 'crmSearch', 'crmSegment',
      'leadFind', 'leadQualify', 'leadExport', 'leadMonitor', 'leadScore', 'leadEnrich',
      'adsCampaigns', 'adsDashboard', 'adsMediaStudio', 'adsAnalytics', 'xproDashboard', 'xproColumns',
    ];
    expect(Object.keys(processors).sort()).toEqual([...expected].sort());
    for (const def of Object.values(processors)) {
      expect(typeof def.run).toBe('function');
      expect(def.write).toBeFalsy();
    }
    expect(processors.adsBoost).toBeUndefined();
    expect(processors.xproManage).toBeUndefined();
  });
});

describe('snapshots, history and growth rate', () => {
  it('stores snapshots per owner and reports history against live numbers', async () => {
    const fetch = xcom();
    const takenAt = new Date(Date.now() - 3 * DAY).toISOString();
    const stored = await run('storeSnapshot', { snapshot: { username: 'Alice', takenAt, followers: 1000, following: 290, tweets: 4900, verified: true } });
    expect(stored.stored).toMatchObject({ username: 'alice', followers: 1000, takenAt });
    expect(stored.snapshotsForAccount).toBe(1);

    const history = await run('getAnalyticsHistory', { username: 'alice', limit: 30 }, { fetch });
    expect(history.count).toBe(1);
    expect(history.current).toMatchObject({ followers: 1200, following: 300, tweets: 5000 });
    expect(history.changeSinceFirst).toMatchObject({ followers: 200, following: 10, tweets: 100 });

    const other = await run('getAnalyticsHistory', { username: 'alice' }, { fetch, owner: 'owner-b' });
    expect(other.count).toBe(0);
    expect(other.hint).toMatch(/snapshot/);
  });

  it('computes growth from the baseline and records the live reading', async () => {
    const growth = await run('computeGrowthRate', { username: 'alice', period: '7d' }, { fetch: xcom() });
    expect(growth.baseline.followers).toBe(1000);
    expect(growth.current.followers).toBe(1200);
    expect(growth.followers.change).toBe(200);
    expect(growth.followers.percentChange).toBe(20);
    expect(growth.followers.perDay).toBeGreaterThan(66);
    expect(growth.followers.perDay).toBeLessThan(67);
    expect(growth.series.at(-1).followers).toBe(1200);
    expect(growth.snapshotRecorded).toBe(true);
  });

  it('records a baseline and explains itself when there is nothing to compare', async () => {
    const first = await failure(run('computeGrowthRate', { username: 'bob', period: '7d' }, { fetch: xcom(), owner: 'owner-c' }));
    expect(first).toBeInstanceOf(JobInputError);
    expect(first.message).toMatch(/baseline/);
    const second = await run('computeGrowthRate', { username: 'bob', period: '7d' }, { fetch: xcom(), owner: 'owner-c' });
    expect(second.followers.change).toBe(0);
  });

  it('rejects bad input without retrying', async () => {
    const bad = await failure(run('storeSnapshot', { snapshot: { username: 'alice', followers: -3 } }));
    expect(bad).toBeInstanceOf(JobInputError);
    const period = await failure(run('computeGrowthRate', { username: 'alice', period: 'fortnight' }, { fetch: xcom() }));
    expect(period.message).toMatch(/period/);
    const name = await failure(run('getAnalyticsHistory', { username: 'not a handle!' }, { fetch: xcom() }));
    expect(isPermanentFailure(name)).toBe(true);
    const missing = await failure(run('computeGrowthRate', { username: 'ghost' }, { fetch: xcom() }));
    expect(missing).toBeInstanceOf(JobInputError);
    expect(missing.message).toMatch(/@ghost was not found/);
  });
});

describe('creator analytics', () => {
  const now = Date.now();
  const posts = {
    alice: [
      { id: 11, author: 'alice', text: 'Shipping a new release today', at: now - 2 * DAY, likes: 100, retweets: 20, replies: 10, views: 10000, hashtags: ['launch'] },
      { id: 12, author: 'alice', text: 'Replying to feedback', at: now - 3 * DAY, likes: 10, replies: 2, views: 1000, reply: true },
      { id: 13, author: 'alice', text: 'An old thread', at: now - 40 * DAY, likes: 500, views: 50000 },
    ],
  };

  it('summarises post performance for a username inside the period', async () => {
    const result = await run('getCreatorAnalytics', { username: 'alice' }, { fetch: xcom({ posts }) });
    expect(result.period).toBe('28d');
    expect(result.profile).toMatchObject({ username: 'alice', followers: 1200, verified: true });
    const a = result.analytics;
    expect(a.postsInWindow).toBe(2);
    expect(a.totals).toMatchObject({ impressions: 11000, likes: 110, retweets: 20, replies: 12, engagements: 142 });
    expect(a.engagementRate.byImpressions).toBeCloseTo(1.29, 2);
    expect(a.byType.original.posts).toBe(1);
    expect(a.byType.reply.posts).toBe(1);
    expect(a.topPosts[0].id).toBe('11');
    expect(a.coverage.windowFullyRead).toBe(true);
    expect(result.monetizationSignals).toMatchObject({ premium: true, impressionsInWindow: 11000 });
  });

  it('reads the signed-in account for a dashboard user, with its period', async () => {
    const calls = [];
    const result = await run('getCreatorAnalytics', { period: '7d' }, {
      userId: 'u1',
      decrypt: async () => 'auth_token=tok; ct0=csrf; twid=u%3D1',
      fetch: xcom({ posts }, calls),
    });
    expect(result.username).toBe('alice');
    expect(result.period).toBe('7d');
    expect(calls[0]).toMatchObject({ op: 'UserByRestId', variables: { userId: '1' } });
    const via = await run('creatorAnalytics', { period: '7d' }, { fetch: xcom({ posts, handlers: { Viewer: () => ({ data: { viewer: { user_results: { result: userResult('alice') } } } }) } }) });
    expect(via.username).toBe('alice');
    expect(via.analytics.postsInWindow).toBe(2);
  });

  it('fails permanently when X rejects the session', async () => {
    const fetch = xcom({ handlers: { UserByScreenName: () => ({ status: 401, body: { errors: [{ message: 'Could not authenticate you' }] } }) } });
    const err = await failure(run('getCreatorAnalytics', { username: 'alice' }, { fetch }));
    expect(err.name).toBe('AuthError');
    expect(isPermanentFailure(err)).toBe(true);
  });
});

describe('creator subscriptions', () => {
  const viewer = { Viewer: () => ({ data: { viewer: { user_results: { result: userResult('alice') } } } }) };

  it('lists the accounts subscribed to the session account', async () => {
    const calls = [];
    const fetch = xcom({
      handlers: {
        ...viewer,
        UserCreatorSubscribers: () => userTimeline(addEntries([...userEntries(['bob', 'erin']), { entryId: 'cursor-bottom-1', content: { value: 'next' } }])),
      },
    }, calls);
    const result = await run('creatorSubscribers', {}, { fetch });
    expect(result.account.username).toBe('alice');
    expect(result.count).toBe(2);
    expect(result.subscribers.map((s) => s.username)).toEqual(['bob', 'erin']);
    expect(calls.find((c) => c.op === 'UserCreatorSubscribers').variables.userId).toBe('1');
  });

  it('says so when X returns no subscriber timeline at all', async () => {
    const fetch = xcom({ handlers: { ...viewer, UserCreatorSubscriptions: () => ({ data: { user: { result: {} } } }) } });
    const err = await failure(run('creatorSubscriptions', {}, { fetch }));
    expect(err.message).toMatch(/no subscriptions list/);
    expect(isPermanentFailure(err)).toBe(true);
  });
});

describe('social graph', () => {
  const world = {
    followers: { alice: ['bob', 'carol'], bob: ['alice'] },
    following: { alice: ['bob', 'dave'], bob: ['erin', 'dave', 'alice'] },
  };

  it('builds a graph over HTTP, stores it per owner, and analyses it', async () => {
    const built = await withFakeTimers(() => run('graphBuild', { username: 'alice', depth: 1, maxNodes: 50 }, { fetch: xcom(world) }));
    expect(built.nodeCount).toBe(4);
    expect(built.edgeCount).toBe(4);
    expect(built.crawledCount).toBe(1);
    expect(built.status).toBe('complete');
    expect(built.edges).toContainEqual({ source: 'bob', target: 'alice', type: 'follows', weight: 1 });

    const analysis = await run('graphAnalyze', { graphOperationId: built.graphId, metrics: ['mutuals', 'influencers', 'orbits'] });
    expect(analysis.nodeCount).toBe(4);
    expect(analysis.metrics.mutuals.ofSeed).toEqual(['bob']);
    expect(analysis.metrics.influencers[0].username).toBe('alice');
    expect(analysis.metrics.orbits.summary.outerRing).toBe(2);

    const stranger = await failure(run('graphAnalyze', { graphOperationId: built.graphId }, { owner: 'owner-z' }));
    expect(stranger).toBeInstanceOf(JobInputError);
    const metric = await failure(run('graphAnalyze', { graphOperationId: built.graphId, metrics: ['vibes'] }));
    expect(metric.message).toMatch(/unknown metrics: vibes/);
  });

  it('refuses a graph whose seed account cannot be read', async () => {
    const err = await withFakeTimers(() => failure(run('graphBuild', { username: 'nobody', maxNodes: 50 }, { fetch: xcom(world) })));
    expect(err).toBeInstanceOf(JobInputError);
    expect(err.message).toMatch(/@nobody was not found/);
  });

  it('recommends accounts followed by your mutual connections', async () => {
    const result = await run('graphRecommendations', { username: 'alice', limit: 5, basedOn: 'mutual_followers' }, { fetch: xcom(world) });
    expect(result.poolSize).toBe(1);
    expect(result.sampled).toEqual([{ username: 'bob', following: 3 }]);
    expect(result.recommendations.map((r) => r.username)).toEqual(['erin']);
    expect(result.recommendations[0]).toMatchObject({ sharedConnections: 1, followedBy: ['bob'] });

    const bad = await failure(run('graphRecommendations', { username: 'alice', basedOn: 'astrology' }, { fetch: xcom(world) }));
    expect(bad).toBeInstanceOf(JobInputError);
  });
});

describe('CRM', () => {
  const world = { followers: { alice: ['bob', 'carol'] }, following: { alice: ['bob', 'dave'] } };

  it('syncs followers and following into contacts, and notices who left', async () => {
    const first = await run('crmSync', { username: 'alice', syncType: 'both', limit: 1000 }, { fetch: xcom(world), owner: 'crm' });
    expect(first.fetched).toEqual({ followers: 2, following: 2 });
    expect(first).toMatchObject({ added: 3, updated: 0, mutuals: 1, totalContacts: 3 });

    const again = await run('crmSync', { username: 'alice', syncType: 'followers' }, { fetch: xcom({ followers: { alice: ['carol'] } }), owner: 'crm' });
    expect(again.noLongerFollower).toEqual(['bob']);
    expect(again.added).toBe(0);
  });

  it('tags contacts, adding unknown accounts from their profile', async () => {
    const tagged = await run('crmTag', { username: '@Bob', tags: ['VIP', 'investor'] }, { fetch: xcom(), owner: 'crm' });
    expect(tagged).toMatchObject({ username: 'bob', added: ['vip', 'investor'], tags: ['investor', 'vip'], contactAdded: false });
    const fresh = await run('crmTag', { username: 'erin', tags: ['vip'] }, { fetch: xcom(), owner: 'crm' });
    expect(fresh.contactAdded).toBe(true);
    const removed = await run('crmTag', { username: 'bob', tags: ['investor'], remove: true }, { owner: 'crm' });
    expect(removed).toMatchObject({ removed: ['investor'], tags: ['vip'] });
    const missing = await failure(run('crmTag', { username: 'dave', tags: ['x'], remove: true }, { owner: 'crm-empty' }));
    expect(missing.message).toMatch(/not in your CRM/);
  });

  it('searches and segments contacts, never across owners', async () => {
    const byTag = await run('crmSearch', { tags: ['vip'], limit: 50 }, { owner: 'crm' });
    expect(byTag.contacts.map((c) => c.username).sort()).toEqual(['bob', 'erin']);
    expect(byTag.totalContacts).toBe(4);

    const big = await run('crmSearch', { minFollowers: 1000 }, { owner: 'crm' });
    expect(big.contacts.map((c) => c.username)).toEqual(['dave']);
    expect(big.contacts[0]).toMatchObject({ isFollowing: true, isFollower: false, syncedFrom: 'alice' });

    const text = await run('crmSearch', { query: 'growth' }, { owner: 'crm' });
    expect(text.contacts.map((c) => c.username)).toEqual(['bob']);

    const created = await run('crmSegment', { action: 'create', name: 'VIPs', criteria: { tags: ['vip'], minFollowers: 500 } }, { owner: 'crm' });
    expect(created.contacts).toBe(1);
    const got = await run('crmSegment', { action: 'get', name: 'VIPs' }, { owner: 'crm' });
    expect(got.contacts.map((c) => c.username)).toEqual(['bob']);
    const list = await run('crmSegment', { action: 'list' }, { owner: 'crm' });
    expect(list.segments).toEqual([expect.objectContaining({ name: 'VIPs', contacts: 1 })]);

    const badCriteria = await failure(run('crmSegment', { action: 'create', name: 'x', criteria: { mood: 'happy' } }, { owner: 'crm' }));
    expect(badCriteria.message).toMatch(/unknown criteria: mood/);
    const stranger = await failure(run('crmSearch', { query: 'growth' }, { owner: 'crm-stranger' }));
    expect(stranger.message).toMatch(/no contacts/);
  });
});

describe('leads', () => {
  const now = Date.now();
  const searchPosts = [
    { id: 100, author: 'bob', text: 'Looking for a crm tool for our startup, any suggestions?', at: now - HOUR, likes: 4 },
    { id: 101, author: 'carol', text: 'We shipped our crm tool today', at: now - 2 * HOUR, likes: 40 },
  ];
  const search = (rawQuery) => {
    const since = rawQuery.match(/since_id:(\d+)/)?.[1];
    return searchPosts.filter((t) => !since || BigInt(t.id) > BigInt(since));
  };

  it('finds people talking about the keywords and scores intent above reach', async () => {
    const result = await run('leadFind', { keywords: ['crm tool'], limit: 5 }, { fetch: xcom({ search }), owner: 'leads' });
    expect(result).toMatchObject({ postsScanned: 2, candidates: 2, profiled: 2, count: 2 });
    expect(result.leads.map((l) => l.username)).toEqual(['bob', 'carol']);
    expect(result.leads[0].signals.matches[0]).toMatchObject({ tweetId: '100', intent: true, keyword: 'crm tool' });
    expect(result.leads[0].scoreBreakdown.intent).toBe(10);

    const filtered = await run('leadFind', { keywords: 'crm tool', minFollowers: 500 }, { fetch: xcom({ search }), owner: 'leads-2' });
    expect(filtered.leads.map((l) => l.username)).toEqual(['bob']);
    expect(filtered.skipped[0].username).toBe('carol');

    const none = await failure(run('leadFind', {}, { fetch: xcom({ search }) }));
    expect(none.message).toMatch(/keywords is required/);
  });

  it('qualifies accounts against criteria, per account', async () => {
    const result = await run('leadQualify', { usernames: ['bob', 'carol', 'ghost'], criteria: { minFollowers: 500, keywords: ['growth'] } }, { fetch: xcom(), owner: 'leads' });
    expect(result).toMatchObject({ criteriaSource: 'request', checked: 3, qualified: 1 });
    const [bob, carol, ghost] = result.results;
    expect(bob.qualified).toBe(true);
    expect(carol.checks.find((c) => c.criterion === 'minFollowers')).toMatchObject({ passed: false, actual: 90 });
    expect(ghost.error).toMatch(/not found/);

    const recent = await run('leadQualify', { usernames: ['alice'], activeWithinDays: 7 }, {
      fetch: xcom({ posts: { alice: [{ id: 1, author: 'alice', text: 'hi', at: now - DAY }] } }),
      owner: 'leads-q',
    });
    expect(recent.results[0].checks[0]).toMatchObject({ criterion: 'activeWithinDays', passed: true });
  });

  it('rescores, exports and enriches stored leads', async () => {
    const scored = await run('leadScore', {}, { owner: 'leads' });
    expect(scored.scored).toBe(2);
    expect(scored.leads[0]).toMatchObject({ rank: 1, username: 'bob', qualified: true });

    const csv = await run('leadExport', { format: 'csv' }, { owner: 'leads' });
    expect(csv.count).toBe(2);
    expect(csv.data.split('\n')[0]).toBe('username,name,followers,following,tweets,verified,location,website,score,qualified,source,firstSeen,bio');
    expect(csv.data).toContain('bob,BOB,800,400,2100,false,Austin');
    const qualifiedOnly = await run('leadExport', { qualifiedOnly: true }, { owner: 'leads' });
    expect(qualifiedOnly.data.map((l) => l.username)).toEqual(['bob']);

    const enriched = await run('leadEnrich', { username: 'erin' }, {
      fetch: xcom({
        posts: {
          erin: [
            { id: 51, author: 'erin', text: 'Dashboards #analytics', at: now - DAY, likes: 10, views: 500, hashtags: ['analytics'], links: ['https://www.looker.com/x'] },
            { id: 52, author: 'erin', text: 'More #Analytics', at: now - 3 * DAY, likes: 2, views: 100, hashtags: ['Analytics'], reply: true },
          ],
        },
      }),
      owner: 'leads',
    });
    expect(enriched.enrichment.contact.emails).toEqual(['erin@example.com']);
    expect(enriched.enrichment.contact.website).toBe('https://erin.io');
    expect(enriched.enrichment.interests.hashtags).toEqual([{ value: 'analytics', count: 2 }]);
    expect(enriched.enrichment.interests.linkDomains).toEqual([{ value: 'looker.com', count: 1 }]);
    expect(enriched.enrichment.activity).toMatchObject({ postsRead: 2, replyShare: 50, avgEngagements: 6 });

    const format = await failure(run('leadExport', { format: 'xml' }, { owner: 'leads' }));
    expect(format).toBeInstanceOf(JobInputError);
    const empty = await failure(run('leadExport', {}, { owner: 'nobody-home' }));
    expect(empty.message).toMatch(/No leads/);
  });

  it('monitors keywords incrementally from the last post seen', async () => {
    const first = await run('leadMonitor', { keywords: ['crm tool'] }, { fetch: xcom({ search }), owner: 'monitor' });
    expect(first).toMatchObject({ firstRun: true, newPosts: 2, intentPosts: 1, lastSeenTweetId: '101', runs: 1 });
    expect(first.leads.map((l) => l.username).sort()).toEqual(['bob', 'carol']);

    searchPosts.push({ id: 102, author: 'erin', text: 'Anyone know a good crm tool?', at: now, likes: 1 });
    const calls = [];
    const second = await run('leadMonitor', { keywords: ['crm tool'] }, { fetch: xcom({ search }, calls), owner: 'monitor' });
    expect(calls[0].variables.rawQuery).toContain('since_id:101');
    expect(second).toMatchObject({ firstRun: false, newPosts: 1, sinceTweetId: '101', lastSeenTweetId: '102', runs: 2 });
    expect(second.leads.map((l) => l.username)).toEqual(['erin']);
  });
});

describe('web apps read in a browser', () => {
  const adsDom = {
    title: 'Campaigns',
    headings: ['Campaigns'],
    tables: [{ headers: ['Campaign name', 'Status', 'Spend'], rows: [['Spring launch', 'Active', '$120.50'], ['Retarget', 'Paused', '$0.00']] }],
  };
  const adsResponses = [
    { url: 'https://ads.x.com/accounts/18ce54abc/campaigns.json', body: { data: { campaigns: [{ id: 'c1', name: 'Spring launch' }, { id: 'c2', name: 'Retarget' }] } } },
    { url: 'https://ads.x.com/static/app.js', type: 'script', contentType: 'application/javascript', body: {} },
  ];

  it('lists ad campaigns from the rendered table and the ads app JSON', async () => {
    const { browser, visits } = fakeBrowser({ finalUrl: 'https://ads.x.com/campaign_manager/18ce54abc/campaigns', dom: adsDom, responses: adsResponses });
    const result = await run('adsCampaigns', { action: 'list' }, { browser });
    expect(visits).toEqual(['https://ads.x.com/']);
    expect(result.accountId).toBe('18ce54abc');
    expect(result.count).toBe(2);
    expect(result.campaigns[0]).toEqual({ 'Campaign name': 'Spring launch', Status: 'Active', Spend: '$120.50' });
    expect(result.collections[0]).toMatchObject({ path: 'data.campaigns', count: 2 });

    const dashboard = await run('adsDashboard', {}, { browser });
    expect(dashboard.api).toHaveLength(1);
    expect(dashboard.tables[0].records).toHaveLength(2);
  });

  it('filters analytics to one campaign and refuses what it cannot honour', async () => {
    const { browser } = fakeBrowser({ finalUrl: 'https://ads.x.com/campaign_manager/18ce54abc/campaigns', dom: adsDom, responses: adsResponses });
    const one = await run('adsAnalytics', { campaignId: 'c2' }, { browser });
    expect(one.collections[0].items).toEqual([{ id: 'c2', name: 'Retarget' }]);
    const missing = await failure(run('adsAnalytics', { campaignId: 'c9' }, { browser }));
    expect(missing.message).toMatch(/Campaign c9 is not/);
    const range = await failure(run('adsAnalytics', { dateRange: { start: '2026-01-01' } }, { browser }));
    expect(range).toBeInstanceOf(JobInputError);
    const create = await failure(run('adsCampaigns', { action: 'create' }, { browser }));
    expect(create.message).toMatch(/only "list"/);
  });

  it('explains an account with no ads account', async () => {
    const { browser } = fakeBrowser({ finalUrl: 'https://x.com/i/ads_signup' });
    const err = await failure(run('adsDashboard', {}, { browser }));
    expect(err.message).toMatch(/no X Ads account/);
  });

  it('reads monetisation amounts as the page shows them, for revenue', async () => {
    const { browser, visits } = fakeBrowser({
      finalUrl: 'https://x.com/settings/monetization',
      dom: { headings: ['Monetization'], text: 'Creator Revenue\nTotal earnings\n$1,234.56\nNext payout: $210.00\nSubscriptions' },
      responses: [{ url: 'https://x.com/i/api/graphql/abc/CreatorPayouts', body: { data: { payouts: [{ amount: 21000 }] } } }],
    });
    const result = await run('creatorRevenue', {}, {
      browser,
      fetch: xcom({ handlers: { Viewer: () => ({ data: { viewer: { user_results: { result: userResult('alice') } } } }) } }),
    });
    expect(visits).toEqual(['https://x.com/settings/monetization']);
    expect(result.monetizationAvailable).toBe(true);
    expect(result.amounts).toEqual([
      { label: 'Total earnings', amount: '$1,234.56', value: 1234.56, currency: '$' },
      { label: 'Next payout', amount: '$210.00', value: 210, currency: '$' },
    ]);
    expect(result.api[0].operation).toBe('CreatorPayouts');
  });

  it('reads what loaded when a web app never goes network-idle', async () => {
    const { browser } = fakeBrowser({ finalUrl: 'https://studio.x.com/library', responses: [{ url: 'https://studio.x.com/api/library', body: { media: [{ id: 'm1', type: 'video' }] } }] });
    const automation = await browser();
    const page = await automation.createPage();
    const goto = page.goto;
    page.goto = async (url) => {
      await goto(url);
      throw Object.assign(new Error('Navigation timeout of 60000 ms exceeded'), { name: 'TimeoutError' });
    };
    const result = await run('adsMediaStudio', {}, { browser: async () => automation });
    expect(result.count).toBe(1);
    expect(result.media[0]).toMatchObject({ path: 'media', items: [{ id: 'm1', type: 'video' }] });
  });

  it('treats a redirect to the login page as an expired session', async () => {
    const { browser } = fakeBrowser({ finalUrl: 'https://x.com/i/flow/login' });
    const err = await failure(run('xproColumns', {}, { browser }));
    expect(err.name).toBe('XSessionError');
    expect(isPermanentFailure(err)).toBe(true);
  });

  it('reads X Pro columns, and explains a missing Premium subscription', async () => {
    const { browser } = fakeBrowser({
      finalUrl: 'https://pro.x.com/i/decks/123',
      dom: { regions: ['Home', 'Notifications', 'Search: xactions'] },
      responses: [{ url: 'https://pro.x.com/i/api/graphql/q/DeckDetails', body: { data: { deck: { columns: [{ id: 'k1', type: 'home' }] } } } }],
    });
    const result = await run('xproDashboard', {}, { browser });
    expect(result.columns).toEqual(['Home', 'Notifications', 'Search: xactions']);
    expect(result.decks[0]).toMatchObject({ source: 'DeckDetails', path: 'data.deck.columns', count: 1 });

    const premium = fakeBrowser({ finalUrl: 'https://x.com/i/premium_sign_up' });
    const err = await failure(run('xproDashboard', {}, { browser: premium.browser }));
    expect(err.message).toMatch(/X Premium/);
  });
});
