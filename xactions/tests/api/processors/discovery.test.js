// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the discovery processors
 * (api/services/processors/discovery.processors.js): trends, Explore,
 * search, saved searches, Topics, home timelines and the media tools.
 *
 * Only the network boundary is replaced. The job context gets a `fetch` that
 * answers the way x.com does, shaped from the parsers the processors call;
 * requests the processors make outside the X client (a caller's media URL,
 * the credential-free video lanes) go through the global fetch, which is
 * stubbed with the same function. The write-cap ledger is the real one,
 * pointed at a temporary XACTIONS_HOME.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import processors from '../../../api/services/processors/discovery.processors.js';
import { JobInputError, createJobContext, isPermanentFailure } from '../../../api/services/processors/context.js';
import { remaining } from '../../../src/mcp/action-caps.js';

const SESSION = 'auth_token=tok; ct0=csrf';
let home;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-discovery-'));
  process.env.XACTIONS_HOME = home;
});

afterAll(() => {
  delete process.env.XACTIONS_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.XACTIONS_ACTION_CAPS;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The x.com boundary
// ---------------------------------------------------------------------------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * A fetch that answers from a route table. Each route is `[match, answer]`
 * where match is a substring of the URL and answer is a Response, a body, or
 * a function of (url, init, callIndex). Every call is recorded.
 */
function xcom(routes) {
  const calls = [];
  const hits = new Map();
  const fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    const route = routes.find(([match]) => url.includes(match));
    if (!route) return json({ errors: [{ message: `no fixture for ${url}` }] }, 404);
    const n = hits.get(route[0]) || 0;
    hits.set(route[0], n + 1);
    const answer = typeof route[1] === 'function' ? route[1](url, init, n) : route[1];
    return answer instanceof Response ? answer : json(answer);
  };
  return { fetch, calls, called: (match) => calls.filter((c) => c.url.includes(match)) };
}

function run(type, config, x, { sessionHash = 'h1' } = {}) {
  const progress = [];
  const job = { id: 'job-1', name: type, data: { type, id: 'ai-1', sessionHash, config: { session: SESSION, ...config } }, progress: (p) => progress.push(p) };
  const ctx = createJobContext(job, { fetch: x.fetch });
  return processors[type].run(ctx).finally(() => ctx.dispose());
}

const bodyOf = (call) => JSON.parse(call.body);

// ---------------------------------------------------------------------------
// Fixtures shaped from the parsers
// ---------------------------------------------------------------------------

function guideTrends(names) {
  return {
    timeline: {
      instructions: [
        {
          addEntries: {
            entries: [
              {
                content: {
                  timelineModule: {
                    items: names.map((name, i) => ({
                      item: { content: { trend: { name, url: { url: `twitter://search/?query=${encodeURIComponent(name)}` }, trendMetadata: { metaDescription: `${i + 1}K posts`, domainContext: 'Technology' } } } },
                    })),
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function explorePage(names) {
  return {
    data: {
      explore_page: {
        body: {
          initialTimeline: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: names.map((name, i) => ({ entryId: `trend-${i}`, content: { itemContent: { itemType: 'TimelineTrend', name, trend_metadata: { meta_description: '5K posts' } } } })),
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

function rawTweet(id, { user = 'alice', text = 'hello world', media = [], likes = 1, retweets = 0, views = 100, hashtags = [] } = {}) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: { rest_id: `9${id}`, core: { screen_name: user, name: user.toUpperCase() }, legacy: {} } } },
    views: { count: String(views) },
    legacy: {
      id_str: id,
      full_text: text,
      created_at: 'Wed Sep 30 12:00:00 +0000 2026',
      favorite_count: likes,
      retweet_count: retweets,
      reply_count: 0,
      quote_count: 0,
      bookmark_count: 0,
      lang: 'en',
      entities: { hashtags: hashtags.map((h) => ({ text: h })), user_mentions: [], urls: [] },
      ...(media.length ? { extended_entities: { media } } : {}),
    },
  };
}

const photo = (name) => ({ type: 'photo', media_url_https: `https://pbs.twimg.com/media/${name}.jpg`, original_info: { width: 1200, height: 800 } });
const video = (name) => ({
  type: 'video',
  media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/${name}.jpg`,
  original_info: { width: 720, height: 1280 },
  video_info: {
    variants: [
      { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/ext_tw_video/1/pu/pl/${name}.m3u8` },
      { content_type: 'video/mp4', bitrate: 256000, url: `https://video.twimg.com/ext_tw_video/1/pu/vid/320x568/${name}.mp4` },
      { content_type: 'video/mp4', bitrate: 2176000, url: `https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/${name}.mp4` },
    ],
  },
});

const tweetEntry = (tweet, prefix = 'tweet') => ({ entryId: `${prefix}-${tweet.rest_id}`, content: { itemContent: { tweet_results: { result: tweet } } } });
const cursorEntry = (value) => ({ entryId: `cursor-bottom-${value}`, content: { value } });

function timeline(entries) {
  return { instructions: [{ type: 'TimelineAddEntries', entries }] };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** The upload command in a form or multipart body. */
function uploadCommand(body) {
  return body instanceof FormData ? body.get('command') : new URLSearchParams(String(body)).get('command');
}

describe('discovery processors', () => {
  it('defines every job type the discovery routes queue', () => {
    const types = [
      'discoveryTrending', 'discoveryTrendingMonitor', 'discoverySaveSearch', 'discoverySavedSearches', 'discoveryTopics',
      'discoveryExplore', 'discoverySearch', 'discoveryForYou', 'searchTweets', 'getTrends', 'getExploreFeed',
      'timelineView', 'timelineScroll', 'timelineCollect', 'timelineExport', 'timelineSwitchFeed',
      'mediaUpload', 'mediaLibrary', 'mediaAnalytics', 'mediaCaptions', 'mediaStudio', 'mediaDownloadBatch',
    ];
    expect(Object.keys(processors).sort()).toEqual([...types].sort());
    for (const type of types) expect(typeof processors[type].run).toBe('function');
    expect(processors.mediaUpload.write).toBe(true);
    expect(processors.discoveryTopics.write).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trends and Explore
// ---------------------------------------------------------------------------

describe('trends', () => {
  it('reads the trending tab from the Explore guide', async () => {
    const x = xcom([['/2/guide.json', guideTrends(['#AI', 'Solana', 'Rust'])]]);
    const result = await run('discoveryTrending', { limit: 2 }, x);
    expect(result).toMatchObject({ success: true, category: 'trending', source: 'guide:trending', count: 2 });
    expect(result.trends[0]).toMatchObject({ name: '#AI', volume: 1000, context: 'Technology', url: 'https://x.com/search?q=%23AI' });
    expect(x.calls[0].url).toContain('initial_tab_id=trending');
    expect(x.calls[0].headers['x-csrf-token']).toBe('csrf');
  });

  it('fails over to the GraphQL Explore page when the guide is gone', async () => {
    const x = xcom([
      ['/2/guide.json', json({ errors: [{ message: 'gone' }] }, 404)],
      ['/ExplorePage', explorePage(['Mars', 'Venus'])],
    ]);
    const result = await run('discoveryTrending', {}, x);
    expect(result.source).toBe('explorePage');
    expect(result.trends.map((t) => t.name)).toEqual(['Mars', 'Venus']);
    expect(result.failures[0]).toMatch(/^guide:trending/);
  });

  it('asks for a WOEID first when one is given', async () => {
    const x = xcom([['/1.1/trends/place.json', [{ trends: [{ name: 'Tokyo', tweet_volume: 900 }], locations: [{ name: 'Japan', woeid: 23424856 }] }]]]);
    const result = await run('getTrends', { woeid: 23424856 }, x);
    expect(result).toMatchObject({ source: 'woeid:23424856', trends: [{ name: 'Tokyo', volume: 900, rank: 1 }] });
  });

  it('fails when every trend surface is empty or down', async () => {
    const x = xcom([
      ['/2/guide.json', guideTrends([])],
      ['/ExplorePage', json({ errors: [{ message: 'down' }] }, 500)],
      ['/1.1/trends/place.json', json({}, 503)],
    ]);
    await expect(run('discoveryTrending', {}, x)).rejects.toThrow(/no trending trends.*guide:trending: no trends/);
  });

  it('stops at a dead session instead of trying other endpoints', async () => {
    const x = xcom([['/2/guide.json', json({}, 401)]]);
    const err = await run('discoveryTrending', {}, x).catch((e) => e);
    expect(err.name).toBe('AuthError');
    expect(isPermanentFailure(err)).toBe(true);
    expect(x.calls).toHaveLength(1);
  });

  it('rejects an unknown Explore category', async () => {
    await expect(run('getExploreFeed', { category: 'gossip' }, xcom([]))).rejects.toBeInstanceOf(JobInputError);
  });

  it('reads each Explore tab and reports the ones that failed', async () => {
    const x = xcom([['/2/guide.json', (url) => (url.includes('initial_tab_id=sports') ? json({}, 500) : guideTrends(['Election']))]]);
    const result = await run('discoveryExplore', { tabs: 'news,sports', delayMs: 0 }, x);
    expect(Object.keys(result.tabs)).toEqual(['news']);
    expect(result.tabs.news.trends[0].name).toBe('Election');
    expect(result.failures).toEqual([{ tab: 'sports', error: expect.stringMatching(/HTTP 500/) }]);
  });

  it('returns one Explore tab for the dashboard', async () => {
    const x = xcom([['/2/guide.json', guideTrends(['Match day'])]]);
    const result = await run('getExploreFeed', { category: 'sports', limit: 5 }, x);
    expect(result).toMatchObject({ category: 'sports', count: 1, items: [{ name: 'Match day' }] });
  });

  it('monitors trends over time, diffs snapshots and raises keyword alerts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const rounds = [['Bitcoin', 'Rust', 'Weather'], ['Rust', 'AI agents', 'Bitcoin']];
    const x = xcom([['/2/guide.json', (url, init, n) => guideTrends(rounds[Math.min(n, 1)])]]);
    const pending = run('discoveryTrendingMonitor', { snapshots: 2, intervalMinutes: 1, watchKeywords: ['ai'] }, x);
    await vi.advanceTimersByTimeAsync(61_000);
    const result = await pending;
    expect(result.summary).toMatchObject({ snapshotsTaken: 2, uniqueTrends: 4, persistent: ['Bitcoin', 'Rust'] });
    expect(result.snapshots[1].changes.entered).toEqual([{ name: 'AI agents', rank: 2 }]);
    expect(result.snapshots[1].changes.left).toEqual([{ name: 'Weather', lastRank: 3 }]);
    expect(result.snapshots[1].changes.moved).toContainEqual({ name: 'Rust', from: 2, to: 1, change: 1 });
    expect(result.alerts).toEqual([expect.objectContaining({ keyword: 'ai', trend: 'AI agents', rank: 2 })]);
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('search', () => {
  const searchPage = (tweets, cursor) => ({ data: { search_by_raw_query: { search_timeline: { timeline: timeline([...tweets.map((t) => tweetEntry(t)), ...(cursor ? [cursorEntry(cursor)] : [])]) } } } });

  it('searches the Media tab with the implied filter and pages to the limit', async () => {
    const x = xcom([['/SearchTimeline', (url, init, n) => (n === 0 ? searchPage([rawTweet('101'), rawTweet('102')], 'c1') : searchPage([rawTweet('103', { user: 'bob' })], null))]]);
    const result = await run('discoverySearch', { query: 'solana', type: 'photos', limit: 3, lang: 'en' }, x);
    expect(result).toMatchObject({ success: true, type: 'media', count: 3 });
    expect(result.tweets[2]).toMatchObject({ id: '103', url: 'https://x.com/bob/status/103' });
    const first = bodyOf(x.calls[0]);
    expect(x.calls[0].method).toBe('POST');
    expect(first.variables).toMatchObject({ rawQuery: 'solana filter:images lang:en', product: 'Media' });
    expect(bodyOf(x.calls[1]).variables.cursor).toBe('c1');
  });

  it('searches people', async () => {
    const user = { __typename: 'User', rest_id: '55', core: { screen_name: 'bob', name: 'Bob' }, legacy: { followers_count: 5 } };
    const x = xcom([['/SearchTimeline', { data: { search_by_raw_query: { search_timeline: { timeline: timeline([{ entryId: 'user-55', content: { itemContent: { user_results: { result: user } } } }]) } } } }]]);
    const result = await run('discoverySearch', { query: 'bob', type: 'people', limit: 1 }, x);
    expect(result).toMatchObject({ type: 'people', count: 1, users: [{ id: '55', username: 'bob' }] });
    expect(bodyOf(x.calls[0]).variables.product).toBe('People');
  });

  it('takes the dashboard filter=latest as the Latest tab and q as the query', async () => {
    const x = xcom([['/SearchTimeline', searchPage([rawTweet('7')], null)]]);
    const result = await run('searchTweets', { q: 'xactions', filter: 'latest', limit: 50 }, x);
    expect(result.count).toBe(1);
    expect(bodyOf(x.calls[0]).variables).toMatchObject({ rawQuery: 'xactions', product: 'Latest' });
  });

  it('rejects bad search input before calling X', async () => {
    const x = xcom([]);
    await expect(run('discoverySearch', { query: '' }, x)).rejects.toThrow('query is required');
    await expect(run('discoverySearch', { query: 'a', type: 'gifs' }, x)).rejects.toBeInstanceOf(JobInputError);
    await expect(run('searchTweets', { query: 'a', filter: 'bogus' }, x)).rejects.toBeInstanceOf(JobInputError);
    await expect(run('discoverySearch', { query: 'a', since: 'yesterday' }, x)).rejects.toThrow(/since must be a date/);
    expect(x.calls).toHaveLength(0);
  });

  it('surfaces an X failure', async () => {
    const x = xcom([['/SearchTimeline', json({ errors: [{ message: 'over capacity' }] }, 500)]]);
    await expect(run('discoverySearch', { query: 'solana' }, x)).rejects.toThrow(/HTTP 500/);
  });
});

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

describe('saved searches', () => {
  const saved = (id, query) => ({ id, id_str: String(id), name: query, query, created_at: 'Wed Sep 30 12:00:00 +0000 2026' });

  it('saves a new search on the account', async () => {
    const x = xcom([
      ['/saved_searches/list.json', [saved(1, 'rust lang')]],
      ['/saved_searches/create.json', saved(2, 'from:nichxbt ai')],
    ]);
    const result = await run('discoverySaveSearch', { query: 'from:nichxbt ai' }, x);
    expect(result).toMatchObject({ alreadySaved: false, total: 2, savedSearch: { id: '2', query: 'from:nichxbt ai' } });
    const create = x.called('/saved_searches/create.json')[0];
    expect(create.method).toBe('POST');
    expect(new URLSearchParams(create.body).get('query')).toBe('from:nichxbt ai');
  });

  it('does not save a duplicate, and refuses past X cap', async () => {
    const dup = xcom([['/saved_searches/list.json', [saved(1, 'Rust Lang')]]]);
    await expect(run('discoverySaveSearch', { query: 'rust lang' }, dup)).resolves.toMatchObject({ alreadySaved: true, savedSearch: { id: '1' } });
    expect(dup.called('/create.json')).toHaveLength(0);

    const full = xcom([['/saved_searches/list.json', Array.from({ length: 25 }, (_, i) => saved(i + 1, `q${i}`))]]);
    await expect(run('discoverySaveSearch', { query: 'one more' }, full)).rejects.toThrow(/25 saved searches/);
  });

  it('lists, runs and deletes saved searches', async () => {
    const x = xcom([
      ['/saved_searches/list.json', [saved(10, 'rust lang'), saved(11, 'ai agents')]],
      ['/saved_searches/destroy/11.json', saved(11, 'ai agents')],
      ['/SearchTimeline', { data: { search_by_raw_query: { search_timeline: { timeline: timeline([tweetEntry(rawTweet('5'))]) } } } }],
    ]);
    const listed = await run('discoverySavedSearches', {}, x);
    expect(listed).toMatchObject({ count: 2, max: 25 });
    expect(listed.savedSearches[0]).toMatchObject({ id: '10', createdAt: '2026-09-30T12:00:00.000Z', searchUrl: 'https://x.com/search?q=rust%20lang&src=saved_search' });

    const ran = await run('discoverySavedSearches', { action: 'run', id: '10', limit: 1 }, x);
    expect(ran).toMatchObject({ count: 1, savedSearch: { query: 'rust lang' } });

    const dry = await run('discoverySavedSearches', { action: 'delete', query: 'AI agents', dryRun: true }, x);
    expect(dry.wouldDelete.id).toBe('11');
    expect(x.called('/destroy/')).toHaveLength(0);

    const deleted = await run('discoverySavedSearches', { action: 'delete', query: 'AI agents' }, x);
    expect(deleted).toMatchObject({ deleted: { id: '11' }, count: 1 });
    expect(x.called('/destroy/11.json')[0].method).toBe('POST');

    await expect(run('discoverySavedSearches', { action: 'delete', id: '99' }, x)).rejects.toBeInstanceOf(JobInputError);
  });

  it('surfaces an X failure', async () => {
    const x = xcom([['/saved_searches/list.json', json({ errors: [{ code: 88 }] }, 500)]]);
    await expect(run('discoverySavedSearches', {}, x)).rejects.toThrow(/HTTP 500/);
  });
});

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

describe('topics', () => {
  const sidebar = {
    data: {
      viewer: {
        topics_to_follow: timeline([
          { entryId: 'topic-1', content: { itemContent: { __typename: 'TimelineTopic', topic: { topic_id: '848920371311001600', name: 'Technology', description: 'Tech news', following: false } } } },
          { entryId: 'topic-2', content: { itemContent: { __typename: 'TimelineTopic', topic: { topic_id: '1007361429752594432', name: 'Cryptocurrencies', following: true } } } },
        ]),
      },
    },
  };

  it('lists suggested Topics, filtered by keyword', async () => {
    const x = xcom([['/TopicToFollowSidebar', sidebar]]);
    const all = await run('discoveryTopics', {}, x);
    expect(all.topics.map((t) => t.name)).toEqual(['Technology', 'Cryptocurrencies']);
    expect(all.topics[1]).toMatchObject({ following: true, url: 'https://x.com/i/topics/1007361429752594432' });
    const some = await run('discoveryTopics', { action: 'discover', keyword: 'tech' }, x);
    expect(some.topics.map((t) => t.id)).toEqual(['848920371311001600']);
  });

  it('follows Topics, charging the follow cap for each', async () => {
    const x = xcom([['/TopicFollow', { data: { topic_follow_put: 'Done' } }]]);
    const result = await run('discoveryTopics', { action: 'follow', topicIds: ['111111', '222222'], delayMs: 0 }, x, { sessionHash: 'topics-a' });
    expect(result.summary).toMatchObject({ done: 2, failed: 0 });
    expect(x.calls.map((c) => bodyOf(c).variables.topicId)).toEqual(['111111', '222222']);
    expect(remaining('session:topics-a').classes.follow.used).toBe(2);
  });

  it('stops when the follow cap is reached', async () => {
    process.env.XACTIONS_ACTION_CAPS = JSON.stringify({ follow: 1 });
    const x = xcom([['/TopicFollow', { data: { topic_follow_put: 'Done' } }]]);
    const err = await run('discoveryTopics', { action: 'follow', topicIds: '333333,444444', delayMs: 0 }, x, { sessionHash: 'topics-b' }).catch((e) => e);
    expect(err.name).toBe('ActionCapExceededError');
    expect(x.calls).toHaveLength(1);
  });

  it('plans without writing on a dry run, and validates input', async () => {
    const x = xcom([]);
    const dry = await run('discoveryTopics', { action: 'unfollow', topicId: '555555', dryRun: true }, x);
    expect(dry.outcomes).toEqual([{ topicId: '555555', status: 'planned' }]);
    expect(x.calls).toHaveLength(0);
    await expect(run('discoveryTopics', { action: 'follow' }, x)).rejects.toThrow(/topicId/);
    await expect(run('discoveryTopics', { action: 'follow', topicId: 'tech' }, x)).rejects.toThrow(/numeric/);
    await expect(run('discoveryTopics', { action: 'subscribe', topicId: '1' }, x)).rejects.toBeInstanceOf(JobInputError);
  });

  it('records an X failure per Topic', async () => {
    const x = xcom([['/TopicUnfollow', { errors: [{ message: 'Topic not found' }] }]]);
    const result = await run('discoveryTopics', { action: 'unfollow', topicId: '666666' }, x, { sessionHash: 'topics-c' });
    expect(result.success).toBe(false);
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/Topic not found/) });
  });
});

// ---------------------------------------------------------------------------
// Home timelines
// ---------------------------------------------------------------------------

describe('home timelines', () => {
  const homePage = (entries) => ({ data: { home: { home_timeline_urt: timeline(entries) } } });
  const promoted = { ...tweetEntry(rawTweet('900', { user: 'brand' }), 'promoted-tweet'), content: { itemContent: { tweet_results: { result: rawTweet('900', { user: 'brand' }) }, promotedMetadata: { advertiser_results: {} } } } };

  function homeFetch(operation) {
    return xcom([
      [`/${operation}`, (url, init, n) =>
        n === 0
          ? homePage([tweetEntry(rawTweet('1', { text: 'first, "quoted"', hashtags: ['ai'] })), promoted, tweetEntry(rawTweet('2', { user: 'bob', text: '=SUM(A1)' })), cursorEntry('next')])
          : homePage([tweetEntry(rawTweet('3', { hashtags: ['ai'] }))])],
    ]);
  }

  it('reads For You over POST, skipping ads and paging to the limit', async () => {
    const x = homeFetch('HomeTimeline');
    const result = await run('discoveryForYou', { limit: 3, delayMs: 0 }, x);
    expect(result).toMatchObject({ feed: 'for-you', count: 3, pages: 2, promotedSkipped: 1 });
    expect(result.posts.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(x.calls[0].method).toBe('POST');
    expect(x.calls[0].url).toMatch(/\/HomeTimeline$/);
    expect(bodyOf(x.calls[1]).variables.cursor).toBe('next');
  });

  it('reads Following for feed=following and switch-feed', async () => {
    const x = homeFetch('HomeLatestTimeline');
    const viewed = await run('timelineView', { feed: 'following', limit: 2 }, x);
    expect(viewed.feed).toBe('following');
    const switched = await run('timelineSwitchFeed', { limit: 1 }, x);
    expect(switched).toMatchObject({ switchedTo: 'following', count: 1 });
    expect(x.called('/HomeTimeline')).toHaveLength(0);
  });

  it('collects with a summary', async () => {
    const result = await run('timelineCollect', { limit: 5, delayMs: 0 }, homeFetch('HomeTimeline'));
    expect(result.summary).toMatchObject({ posts: 3, uniqueAuthors: 2, topHashtags: [{ name: '#ai', count: 2 }] });
  });

  it('exports CSV with quoting and formula defusing', async () => {
    const result = await run('timelineExport', { format: 'csv', limit: 2, delayMs: 0 }, homeFetch('HomeTimeline'));
    expect(result).toMatchObject({ format: 'csv', count: 2, contentType: 'text/csv' });
    const lines = result.content.trim().split('\r\n');
    expect(lines[0].startsWith('id,url,created_at,username')).toBe(true);
    expect(lines[1]).toContain('"first, ""quoted"""');
    expect(lines[2]).toContain(",'=SUM(A1),");
    expect(result.filename).toMatch(/^timeline-for-you-.*\.csv$/);
  });

  it('exports JSON by default and rejects an unknown format or feed', async () => {
    const result = await run('timelineExport', { limit: 1 }, homeFetch('HomeTimeline'));
    expect(result.content[0]).toMatchObject({ id: '1', url: 'https://x.com/alice/status/1' });
    await expect(run('timelineExport', { format: 'xml' }, xcom([]))).rejects.toBeInstanceOf(JobInputError);
    await expect(run('timelineView', { feed: 'popular' }, xcom([]))).rejects.toBeInstanceOf(JobInputError);
  });

  it('treats an empty timeline as a failure', async () => {
    const x = xcom([['/HomeTimeline', homePage([cursorEntry('c')])]]);
    await expect(run('timelineScroll', { delayMs: 0 }, x)).rejects.toThrow(/came back empty/);
  });

  it('surfaces a GraphQL error from X', async () => {
    const x = xcom([['/HomeTimeline', { errors: [{ message: 'Rate limit exceeded' }] }]]);
    await expect(run('discoveryForYou', {}, x)).rejects.toThrow(/HomeTimeline: Rate limit exceeded/);
  });
});

// ---------------------------------------------------------------------------
// Media library, analytics, studio
// ---------------------------------------------------------------------------

describe('media library and analytics', () => {
  const me = { id_str: '42', screen_name: 'me', name: 'Me', followers_count: 10, friends_count: 5, statuses_count: 99 };
  const mediaTab = {
    data: {
      user: {
        result: {
          timeline: {
            timeline: timeline([
              tweetEntry(rawTweet('201', { user: 'me', media: [photo('p1'), photo('p2')], likes: 10, views: 1000 })),
              tweetEntry(rawTweet('202', { user: 'me', media: [video('v1')], likes: 80, retweets: 20, views: 2000 })),
            ]),
          },
        },
      },
    },
  };
  const mediaFetch = () => xcom([['/account/verify_credentials.json', me], ['/UserMedia', mediaTab]]);

  it('lists the account media, best video variant first, filtered by type', async () => {
    const x = mediaFetch();
    const all = await run('mediaLibrary', {}, x);
    expect(all).toMatchObject({ account: { id: '42', username: 'me' }, posts: 2, count: 3, byType: { photo: 2, video: 1 } });
    expect(all.items[0]).toMatchObject({ type: 'photo', url: 'https://pbs.twimg.com/media/p1.jpg?format=jpg&name=orig', tweetUrl: 'https://x.com/me/status/201' });
    expect(new URL(x.called('/UserMedia')[0].url).searchParams.get('variables')).toContain('"userId":"42"');

    const videos = await run('mediaLibrary', { types: ['video'] }, mediaFetch());
    expect(videos.items).toEqual([expect.objectContaining({ type: 'video', url: expect.stringContaining('/720x1280/v1.mp4') })]);
    await expect(run('mediaLibrary', { types: 'audio' }, mediaFetch())).rejects.toBeInstanceOf(JobInputError);
  });

  it('analyses performance by media type', async () => {
    const result = await run('mediaAnalytics', { top: 1 }, mediaFetch());
    expect(result.analysed).toBe(2);
    expect(result.byType.video).toMatchObject({ posts: 1, views: 2000, engagement: 100, engagementRate: 5 });
    expect(result.byType.photo).toMatchObject({ posts: 1, engagementRate: 1 });
    expect(result.bestType).toBe('video');
    expect(result.top).toEqual([expect.objectContaining({ id: '202', type: 'video' })]);
    expect(result.bottom).toEqual([expect.objectContaining({ id: '201' })]);
  });

  it('analyses specific posts and reports the ones it could not use', async () => {
    const x = xcom([['/TweetResultByRestId', (url) => {
      const id = JSON.parse(new URL(url).searchParams.get('variables')).tweetId;
      if (id === '1000301') return { data: { tweetResult: { result: rawTweet('1000301', { media: [photo('a')] }) } } };
      if (id === '1000302') return { data: { tweetResult: { result: rawTweet('1000302') } } };
      return { data: { tweetResult: {} } };
    }]]);
    const result = await run('mediaAnalytics', { tweetIds: ['1000301', 'https://x.com/a/status/1000302', '1000303'], delayMs: 0 }, x);
    expect(result.analysed).toBe(1);
    expect(result.failures).toEqual([
      { tweetId: '1000302', error: 'The post has no media' },
      { tweetId: '1000303', error: expect.stringMatching(/not found/) },
    ]);
  });

  it('builds the Media Studio overview', async () => {
    const result = await run('mediaStudio', {}, mediaFetch());
    expect(result.library).toMatchObject({ posts: 2, items: 3, byType: { photo: 2, video: 1 } });
    expect(result.library.recent).toHaveLength(3);
    expect(result.insights.bestType).toBe('video');
  });

  it('treats an account with no media as a failure', async () => {
    const x = xcom([['/account/verify_credentials.json', me], ['/UserMedia', { data: { user: { result: { timeline: { timeline: timeline([]) } } } } }]]);
    await expect(run('mediaLibrary', {}, x)).rejects.toThrow(/no media posts/);
  });
});

// ---------------------------------------------------------------------------
// Batch download links
// ---------------------------------------------------------------------------

describe('media download batch', () => {
  it('resolves links through the session and falls back to the public video lanes', async () => {
    const x = xcom([
      ['/TweetResultByRestId', (url) => {
        const id = JSON.parse(new URL(url).searchParams.get('variables')).tweetId;
        if (id === '1000401') return { data: { tweetResult: { result: rawTweet('1000401', { user: 'nichxbt', media: [photo('ph'), video('vv')] }) } } };
        if (id === '1000402') return { data: { tweetResult: { result: rawTweet('1000402') } } };
        return json({}, 404);
      }],
      ['cdn.syndication.twimg.com/tweet-result', (url) =>
        url.includes('id=1000403')
          ? { __typename: 'Tweet', text: 'clip', user: { name: 'Carol', screen_name: 'carol' }, mediaDetails: [video('fallback')] }
          : json({}, 404)],
      ['api.fxtwitter.com', json({ code: 404, message: 'NOT_FOUND' }, 404)],
    ]);
    vi.stubGlobal('fetch', x.fetch);

    const result = await run('mediaDownloadBatch', { tweetIds: ['1000401', 'https://x.com/b/status/1000402', '1000403', '1000404'], delayMs: 0, template: '{username}/{tweet_id}_{num}.{ext}' }, x);
    expect(result.summary).toEqual({ requested: 4, ok: 2, noMedia: 1, failed: 1, skipped: 0, files: 3 });

    const [first, second, third, fourth] = result.results;
    expect(first).toMatchObject({ status: 'ok', source: 'session' });
    expect(first.media[0]).toMatchObject({ type: 'photo', filename: path.join('nichxbt', '1000401_1.jpg') });
    expect(first.media[1]).toMatchObject({ type: 'video', url: expect.stringContaining('/720x1280/vv.mp4'), filename: path.join('nichxbt', '1000401_2.mp4') });
    expect(first.media[1].downloadPath).toMatch(/^\/api\/video\/download\?url=https%3A%2F%2Fvideo\.twimg\.com/);
    expect(second.status).toBe('no_media');
    expect(third).toMatchObject({ status: 'ok', source: 'syndication', sessionError: expect.any(String) });
    expect(third.media[0]).toMatchObject({ type: 'video', filename: path.join('carol', '1000403_1.mp4') });
    expect(fourth).toMatchObject({ status: 'failed' });
  });

  it('filters by type and caps the batch', async () => {
    const x = xcom([['/TweetResultByRestId', { data: { tweetResult: { result: rawTweet('1000501', { media: [photo('a'), video('b')] }) } } }]]);
    const result = await run('mediaDownloadBatch', { tweetIds: '1000501,1000502', types: 'video', maxTweets: 1 }, x);
    expect(result.results[0].media.map((m) => m.type)).toEqual(['video']);
    expect(result.results[1]).toMatchObject({ tweetId: '1000502', status: 'skipped' });
  });

  it('rejects bad ids and template keys before calling X', async () => {
    const x = xcom([]);
    await expect(run('mediaDownloadBatch', {}, x)).rejects.toThrow('tweetIds is required');
    await expect(run('mediaDownloadBatch', { tweetIds: ['not-a-tweet'] }, x)).rejects.toBeInstanceOf(JobInputError);
    await expect(run('mediaDownloadBatch', { tweetIds: ['12345'], template: '{tweetid}.{ext}' }, x)).rejects.toThrow(/Unknown template key/);
    expect(x.calls).toHaveLength(0);
  });

  it('stops the batch when the session is dead', async () => {
    const x = xcom([['/TweetResultByRestId', json({}, 403)]]);
    const err = await run('mediaDownloadBatch', { tweetIds: ['1000601', '1000602'] }, x).catch((e) => e);
    expect(err.name).toBe('AuthError');
  });
});

// ---------------------------------------------------------------------------
// Upload and captions
// ---------------------------------------------------------------------------

describe('media upload', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 2)]);
  const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(64, 3)]);

  function uploadFetch({ finalize = { media_id_string: '777', media_key: '3_777', expires_after_secs: 86400 }, status } = {}) {
    return xcom([
      ['93.184.216.34/cat.png', new Response(PNG, { headers: { 'content-type': 'image/png' } })],
      ['93.184.216.34/clip.mp4', new Response(MP4, { headers: { 'content-type': 'video/mp4' } })],
      ['upload.x.com/i/media/upload.json', (url, init) => {
        if (init.method === 'GET') return status;
        const command = uploadCommand(init.body);
        if (command === 'INIT') return { media_id_string: '777', expires_after_secs: 86400 };
        if (command === 'APPEND') return new Response(null, { status: 204 });
        return finalize;
      }],
      ['/1.1/media/metadata/create.json', new Response('', { status: 200 })],
    ]);
  }

  it('fetches a public URL, uploads it in chunks and sets alt text', async () => {
    const x = uploadFetch();
    vi.stubGlobal('fetch', x.fetch);
    const result = await run('mediaUpload', { mediaUrl: 'https://93.184.216.34/cat.png', altText: 'A cat' }, x);
    expect(result).toMatchObject({ success: true, mediaId: '777', mediaKey: '3_777', mediaType: 'image/png', category: 'tweet_image', bytes: PNG.length, altText: 'A cat' });

    const uploads = x.called('upload.x.com');
    expect(uploads).toHaveLength(3);
    const init = new URLSearchParams(uploads[0].body);
    expect(Object.fromEntries(init)).toMatchObject({ command: 'INIT', total_bytes: String(PNG.length), media_type: 'image/png', media_category: 'tweet_image' });
    expect(uploads[1].body).toBeInstanceOf(FormData);
    expect(Buffer.from(await uploads[1].body.get('media').arrayBuffer()).equals(PNG)).toBe(true);
    const alt = x.called('/media/metadata/create.json')[0];
    expect(bodyOf(alt)).toEqual({ media_id: '777', alt_text: { text: 'A cat' } });
  });

  it('waits for X to process a video', async () => {
    const x = uploadFetch({
      finalize: { media_id_string: '777', processing_info: { state: 'pending', check_after_secs: 1 } },
      status: { media_id_string: '777', media_key: '7_777', processing_info: { state: 'succeeded', progress_percent: 100 } },
    });
    vi.stubGlobal('fetch', x.fetch);
    const result = await run('mediaUpload', { mediaUrl: 'https://93.184.216.34/clip.mp4' }, x);
    expect(result).toMatchObject({ mediaId: '777', mediaKey: '7_777', category: 'tweet_video' });
    expect(x.called('command=STATUS')).toHaveLength(1);
  });

  it('uploads base64 data URIs', async () => {
    const x = uploadFetch();
    const result = await run('mediaUpload', { mediaBase64: `data:image/gif;base64,${GIF.toString('base64')}` }, x);
    expect(result).toMatchObject({ mediaType: 'image/gif', category: 'tweet_gif', source: 'base64' });
  });

  it('refuses private addresses, unknown types and alt text on video', async () => {
    const x = uploadFetch();
    vi.stubGlobal('fetch', x.fetch);
    await expect(run('mediaUpload', { mediaUrl: 'http://127.0.0.1:6379/' }, x)).rejects.toThrow(/not a public address/);
    await expect(run('mediaUpload', { mediaUrl: 'http://[::1]/x.png' }, x)).rejects.toThrow(/not a public address/);
    await expect(run('mediaUpload', { mediaUrl: 'file:///etc/passwd' }, x)).rejects.toThrow(/http and https/);
    await expect(run('mediaUpload', { mediaBase64: Buffer.from('plain text here').toString('base64') }, x)).rejects.toThrow(/Unsupported media type/);
    await expect(run('mediaUpload', { mediaUrl: 'https://93.184.216.34/clip.mp4', altText: 'x' }, x)).rejects.toThrow(/alt text/);
    await expect(run('mediaUpload', {}, x)).rejects.toThrow(/mediaUrl/);
    expect(x.called('upload.x.com')).toHaveLength(0);
  });

  it('surfaces an X upload failure', async () => {
    const x = xcom([['upload.x.com', json({ errors: [{ message: 'Bad media' }] }, 400)]]);
    const err = await run('mediaUpload', { mediaBase64: GIF.toString('base64') }, x).catch((e) => e);
    expect(err.name).toBe('TwitterApiError');
    expect(err.status).toBe(400);
  });
});

describe('media captions', () => {
  const VTT = 'WEBVTT\n\nNOTE made by hand\n\n00:01.000 --> 00:04.000 align:start\nHello there\n\n01:00:05.500 --> 01:00:07.000\nSecond line\n';

  function captionFetch(createStatus = 200) {
    return xcom([
      ['upload.x.com/i/media/upload.json', (url, init) => {
        const command = uploadCommand(init.body);
        if (command === 'APPEND') return new Response(null, { status: 204 });
        return { media_id_string: '888' };
      }],
      ['/1.1/media/subtitles/create.json', createStatus === 200 ? new Response('', { status: 200 }) : json({ errors: [{ message: 'Invalid media' }] }, createStatus)],
    ]);
  }

  it('converts WebVTT, uploads it as subtitles and attaches it to the video', async () => {
    const x = captionFetch();
    const result = await run('mediaCaptions', { mediaId: '123456789', captions: VTT, language: 'en' }, x);
    expect(result).toMatchObject({ success: true, mediaId: '123456789', subtitleMediaId: '888', language: 'en', displayName: 'English', cues: 2 });

    const init = new URLSearchParams(x.called('upload.x.com')[0].body);
    expect(init.get('media_type')).toBe('text/srt');
    expect(init.get('media_category')).toBe('subtitles');
    const srt = Buffer.from(await x.called('upload.x.com')[1].body.get('media').arrayBuffer()).toString('utf8');
    expect(srt).toBe('1\n00:00:01,000 --> 00:00:04,000\nHello there\n\n2\n01:00:05,500 --> 01:00:07,000\nSecond line\n');
    expect(bodyOf(x.called('/subtitles/create.json')[0])).toEqual({
      media_id: '123456789',
      media_category: 'TweetVideo',
      subtitle_info: { subtitles: [{ media_id: '888', language_code: 'EN', display_name: 'English' }] },
    });
  });

  it('validates the video id, language and caption text', async () => {
    const x = xcom([]);
    await expect(run('mediaCaptions', { captions: VTT }, x)).rejects.toThrow('mediaId is required');
    await expect(run('mediaCaptions', { mediaId: 'abc', captions: VTT }, x)).rejects.toBeInstanceOf(JobInputError);
    await expect(run('mediaCaptions', { mediaId: '123456789', captions: VTT, language: 'english!' }, x)).rejects.toBeInstanceOf(JobInputError);
    await expect(run('mediaCaptions', { mediaId: '123456789', captions: 'just words' }, x)).rejects.toThrow(/SRT/);
    expect(x.calls).toHaveLength(0);
  });

  it('surfaces an X failure attaching the captions', async () => {
    await expect(run('mediaCaptions', { mediaId: '123456789', captions: VTT }, captionFetch(400))).rejects.toThrow(/HTTP 400/);
  });
});
