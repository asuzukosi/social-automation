// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the engagement processors
 * (api/services/processors/engagement.processors.js).
 *
 * Only the network is replaced: every job runs through the real job context,
 * the real HTTP client and parsers, the real action-cap ledger and follow
 * ledger (in a temporary XACTIONS_HOME), against a fetch that answers the way
 * x.com does.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { createJobContext, isPermanentFailure, JobInputError } from '../../../api/services/processors/context.js';
import { loadProcessors } from '../../../api/services/processors/registry.js';
import processors, {
  analyticsViaOAuth,
  describeAudience,
  followsOf,
  parseBulkActions,
  periodMs,
  recordFollows,
  tweetIdOf,
  usernameOf,
} from '../../../api/services/processors/engagement.processors.js';

// ---------------------------------------------------------------------------
// x.com, as the parsers read it
// ---------------------------------------------------------------------------

const ME = '100';
const SESSION = `auth_token=tok; ct0=csrf; twid=u%3D${ME}`;
const OLD = 'Mon Jan 01 00:00:00 +0000 2018';
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toUTCString();

function rawUser(id, username, extra = {}) {
  const { followers = 500, following = 300, bio = 'building things', verified = false, statuses = 900, joined = OLD } = extra;
  return {
    __typename: 'User',
    rest_id: id,
    is_blue_verified: verified,
    legacy: {
      screen_name: username,
      name: username.toUpperCase(),
      description: bio,
      followers_count: followers,
      friends_count: following,
      statuses_count: statuses,
      created_at: joined,
      location: extra.location ?? '',
      protected: Boolean(extra.protected),
      profile_image_url_https: extra.defaultAvatar
        ? 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'
        : `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg`,
      ...(extra.followedBy !== undefined ? { followed_by: extra.followedBy } : {}),
      ...(extra.youFollow !== undefined ? { following: extra.youFollow } : {}),
    },
  };
}

function rawTweet(id, user, extra = {}) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: user } },
    legacy: {
      id_str: id,
      full_text: extra.text ?? `post ${id}`,
      created_at: extra.created ?? daysAgo(1),
      favorite_count: extra.likes ?? 10,
      retweet_count: extra.retweets ?? 2,
      reply_count: extra.replies ?? 1,
      quote_count: 0,
      entities: { hashtags: (extra.hashtags || []).map((text) => ({ text })), user_mentions: [], urls: [] },
      retweeted: Boolean(extra.retweeted),
      ...(extra.replyTo ? { in_reply_to_status_id_str: extra.replyTo } : {}),
    },
  };
}

const timeline = (entries, cursor) => [
  {
    type: 'TimelineAddEntries',
    entries: [...entries, ...(cursor ? [{ entryId: 'cursor-bottom-1', content: { value: cursor } }] : [])],
  },
];
const userEntries = (users) =>
  users.map((u) => ({ entryId: `user-${u.rest_id}`, content: { itemContent: { user_results: { result: u } } } }));
const tweetEntries = (tweets) =>
  tweets.map((t) => ({ entryId: `tweet-${t.rest_id}`, content: { itemContent: { tweet_results: { result: t } } } }));

const userList = (users, cursor) => ({ data: { user: { result: { timeline: { timeline: { instructions: timeline(userEntries(users), cursor) } } } } } });
const profileOf = (user) => ({ data: { user: { result: user } } });
const searchOf = (tweets) => ({
  data: { search_by_raw_query: { search_timeline: { timeline: { instructions: timeline(tweetEntries(tweets)) } } } },
});
const userTweetsOf = (tweets) => ({ data: { user: { result: { timeline: { timeline: { instructions: timeline(tweetEntries(tweets)) } } } } } });
const created = (id) => ({ data: { create_tweet: { tweet_results: { result: { rest_id: id, legacy: { id_str: id } } } } } });

function res(body, status = 200) {
  return { status, ok: status < 400, headers: { get: () => null, getSetCookie: () => [] }, json: async () => body };
}

/**
 * A fetch that answers like x.com. `routes` maps a GraphQL operation name or a
 * REST path (e.g. "/1.1/friendships/create.json") to a body, a function of the
 * request, or a [body, status] pair. Every request is recorded.
 */
function xcom(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const op = u.pathname.match(/\/graphql\/[^/]+\/([^/]+)$/)?.[1];
    const key = op || u.pathname.replace(/^\/i\/api/, '');
    let variables = null;
    let form = null;
    if (op && u.searchParams.get('variables')) variables = JSON.parse(u.searchParams.get('variables'));
    else if (op && init.body) variables = JSON.parse(init.body).variables;
    else if (init.body) form = Object.fromEntries(new URLSearchParams(init.body));
    const call = { key, method: init.method || 'GET', variables, form };
    calls.push(call);
    let answer = routes[key];
    if (typeof answer === 'function') answer = answer(call, calls);
    if (answer === undefined) return res({ errors: [{ message: `no route for ${key}` }] }, 418);
    return Array.isArray(answer) ? res(answer[0], answer[1]) : res(answer);
  };
  return { fetch, calls, of: (key) => calls.filter((c) => c.key === key) };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

let owner = 0;
let home;
const previousHome = process.env.XACTIONS_HOME;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-engagement-'));
  process.env.XACTIONS_HOME = home;
});

afterAll(() => {
  if (previousHome === undefined) delete process.env.XACTIONS_HOME;
  else process.env.XACTIONS_HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});

/**
 * Run one job through the real context. Each job gets its own owner, so
 * ledgers never leak between tests.
 */
async function run(type, config, x, { progress = [], sessionHash, deps = {}, data = {} } = {}) {
  const hash = sessionHash || `owner${++owner}`;
  const job = {
    id: `job-${owner}`,
    name: type,
    data: { type, sessionHash: hash, config: { sessionCookie: SESSION, ...config }, ...data },
    progress: (p) => progress.push(p),
  };
  const ctx = createJobContext(job, { fetch: x.fetch, ...deps });
  try {
    return await processors[type].run(ctx);
  } finally {
    await ctx.dispose();
  }
}

const failure = (promise) => promise.then(
  () => {
    throw new Error('expected the job to fail');
  },
  (err) => err,
);

function ledgerOf(ownerKey) {
  const file = path.join(home, 'action-ledger.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8')).accounts[ownerKey] || {};
}

// ---------------------------------------------------------------------------

describe('registry', () => {
  it('registers every engagement job type, with writes marked', async () => {
    const all = await loadProcessors();
    const types = [
      'followUser', 'unfollowUser', 'likeTweet', 'unlikeTweet', 'retweetTweet', 'quoteTweet', 'autoFollow',
      'smartUnfollow', 'autoRetweet', 'bulkExecute', 'muteUser', 'unmuteUser', 'bookmarkTweet', 'replyToTweet',
      'getNotifications', 'smartTarget', 'audienceInsights', 'engagementAnalytics',
    ];
    for (const type of types) expect(all.get(type)?.source).toBe('engagement.processors.js');
    expect(all.get('likeTweet').write).toBe(true);
    expect(all.get('bulkExecute').write).toBe(true);
    expect(all.get('getNotifications').write).toBe(false);
  });
});

describe('input parsing', () => {
  it('reads post ids and usernames from the forms callers send', () => {
    expect(tweetIdOf('https://x.com/nasa/status/1789?s=20')).toBe('1789');
    expect(tweetIdOf(' 42 ')).toBe('42');
    expect(() => tweetIdOf('abc')).toThrow(JobInputError);
    expect(usernameOf('@NASA')).toBe('NASA');
    expect(usernameOf('https://twitter.com/nasa/with_replies')).toBe('nasa');
    expect(() => usernameOf('no spaces allowed')).toThrow(JobInputError);
  });

  it('parses periods', () => {
    expect(periodMs('24h')).toBe(86_400_000);
    expect(periodMs('2w')).toBe(14 * 86_400_000);
    expect(() => periodMs('forever')).toThrow(JobInputError);
    expect(() => periodMs('2y')).toThrow(/up to a year/);
  });
});

describe('single actions', () => {
  it('follows an account, charges the follow cap and records the follow', async () => {
    const x = xcom({
      UserByScreenName: profileOf(rawUser('7', 'nasa', { followers: 90_000_000, verified: true })),
      '/1.1/friendships/create.json': { id_str: '7' },
    });
    const result = await run('followUser', { username: 'nasa' }, x, { sessionHash: 'follow-owner' });
    expect(result).toMatchObject({ success: true, action: 'follow', username: 'nasa', userId: '7', verified: true, requested: false });
    expect(x.of('/1.1/friendships/create.json')[0].form.user_id).toBe('7');
    expect(ledgerOf('session:follow-owner').follow).toHaveLength(1);
    expect(followsOf('session:follow-owner')['7'].username).toBe('nasa');
  });

  it('unfollows and forgets the recorded follow', async () => {
    recordFollows('session:unfollow-owner', [{ id: '8', username: 'esa' }]);
    const x = xcom({
      UserByScreenName: profileOf(rawUser('8', 'esa')),
      '/1.1/friendships/destroy.json': { id_str: '8' },
    });
    const result = await run('unfollowUser', { username: '@esa' }, x, { sessionHash: 'unfollow-owner' });
    expect(result).toMatchObject({ success: true, action: 'unfollow', userId: '8' });
    expect(followsOf('session:unfollow-owner')['8']).toBeUndefined();
  });

  it('fails without retrying for a bad username or an account that does not exist', async () => {
    const x = xcom({ UserByScreenName: { data: { user: {} } } });
    const bad = await failure(run('followUser', { username: 'two words' }, x));
    expect(bad).toBeInstanceOf(JobInputError);
    const missing = await failure(run('muteUser', { username: 'ghost' }, x));
    expect(missing.message).toMatch(/does not exist/);
    expect(isPermanentFailure(missing)).toBe(true);
    expect(x.of('/1.1/mutes/users/create.json')).toHaveLength(0);
  });

  it('mutes and unmutes by user id', async () => {
    const x = xcom({
      UserByScreenName: profileOf(rawUser('9', 'loud')),
      '/1.1/mutes/users/create.json': {},
      '/1.1/mutes/users/destroy.json': {},
    });
    await run('muteUser', { username: 'loud' }, x);
    await run('unmuteUser', { username: 'loud' }, x);
    expect(x.of('/1.1/mutes/users/create.json')[0].form.user_id).toBe('9');
    expect(x.of('/1.1/mutes/users/destroy.json')[0].form.user_id).toBe('9');
  });

  it('likes, unlikes, reposts and bookmarks a post', async () => {
    const x = xcom({
      FavoriteTweet: { data: { favorite_tweet: 'Done' } },
      UnfavoriteTweet: { data: { unfavorite_tweet: 'Done' } },
      CreateRetweet: { data: { create_retweet: { retweet_results: { result: { rest_id: '2' } } } } },
      CreateBookmark: { data: { tweet_bookmark_put: 'Done' } },
    });
    const url = 'https://x.com/nasa/status/555';
    expect(await run('likeTweet', { tweetId: url }, x)).toMatchObject({ success: true, action: 'like', tweetId: '555' });
    await run('unlikeTweet', { tweetId: '555' }, x);
    await run('retweetTweet', { tweetId: '555' }, x);
    await run('bookmarkTweet', { tweetId: '555' }, x);
    expect(x.of('FavoriteTweet')[0].variables).toEqual({ tweet_id: '555' });
    expect(x.of('UnfavoriteTweet')).toHaveLength(1);
    expect(x.of('CreateRetweet')[0].variables.tweet_id).toBe('555');
    expect(x.of('CreateBookmark')).toHaveLength(1);
  });

  it('acts as a dashboard user through their decrypted saved session', async () => {
    const x = xcom({ FavoriteTweet: { data: { favorite_tweet: 'Done' } } });
    const job = { id: 'd1', name: 'likeTweet', data: { type: 'likeTweet', userId: 'dash-1', config: { tweetId: '77' } } };
    const ctx = createJobContext(job, { fetch: x.fetch, decrypt: async (id) => (id === 'dash-1' ? SESSION : null) });
    await processors.likeTweet.run(ctx);
    expect(x.of('FavoriteTweet')).toHaveLength(1);
    expect(ledgerOf('user:dash-1').like).toHaveLength(1);
  });

  it('surfaces a dead session as a permanent failure', async () => {
    const x = xcom({ FavoriteTweet: [{ errors: [{ message: 'Could not authenticate you' }] }, 401] });
    const err = await failure(run('likeTweet', { tweetId: '1' }, x));
    expect(err.name).toBe('AuthError');
    expect(isPermanentFailure(err)).toBe(true);
  });

  it('refuses a write over the daily cap before it reaches X', async () => {
    const x = xcom({ FavoriteTweet: { data: { favorite_tweet: 'Done' } } });
    process.env.XACTIONS_ACTION_CAPS = JSON.stringify({ like: 1 });
    try {
      await run('likeTweet', { tweetId: '1' }, x, { sessionHash: 'capped' });
      const err = await failure(run('likeTweet', { tweetId: '2' }, x, { sessionHash: 'capped' }));
      expect(err.name).toBe('ActionCapExceededError');
    } finally {
      delete process.env.XACTIONS_ACTION_CAPS;
    }
    expect(x.of('FavoriteTweet')).toHaveLength(1);
  });

  it('quotes and replies, returning the new post', async () => {
    const x = xcom({ CreateTweet: (call) => created(call.variables.reply ? '901' : '900') });
    const quoted = await run('quoteTweet', { tweetId: '555', text: 'worth reading' }, x);
    expect(quoted).toMatchObject({ success: true, quoteId: '900', tweetId: '555' });
    expect(x.of('CreateTweet')[0].variables.attachment_url).toBe('https://x.com/i/web/status/555');
    const replied = await run('replyToTweet', { tweetId: '555', text: 'agreed' }, x);
    expect(replied).toMatchObject({ success: true, replyId: '901' });
    expect(x.of('CreateTweet')[1].variables.reply.in_reply_to_tweet_id).toBe('555');
  });

  it('reports X rejecting a post without retrying it', async () => {
    const x = xcom({ CreateTweet: { errors: [{ message: 'Status is a duplicate. (187)' }] } });
    const err = await failure(run('replyToTweet', { tweetId: '555', text: 'again' }, x));
    expect(err.message).toMatch(/duplicate/);
    expect(isPermanentFailure(err)).toBe(true);
    const noText = await failure(run('quoteTweet', { tweetId: '555', text: ' ' }, x));
    expect(noText).toBeInstanceOf(JobInputError);
  });
});

describe('autoFollow', () => {
  const followers = [
    rawUser(ME, 'me'),
    rawUser('11', 'already', { youFollow: true }),
    rawUser('12', 'tiny', { followers: 3 }),
    rawUser('13', 'alice', { youFollow: false }),
    rawUser('14', 'bob'),
    rawUser('15', 'carol'),
  ];

  it("follows a user's followers that pass the filters, and records them", async () => {
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me')),
      UserByScreenName: profileOf(rawUser('10', 'source')),
      Followers: userList(followers),
      '/1.1/friendships/create.json': {},
    });
    const progress = [];
    const result = await run(
      'autoFollow',
      { target: { type: 'username', value: 'source' }, maxFollows: 2, delayMs: 0, filters: { minFollowers: 10 } },
      x,
      { progress, sessionHash: 'auto-follow' },
    );
    expect(result).toMatchObject({ success: true, followed: 2, eligible: 2, scanned: 6, account: 'me' });
    expect(result.skipped).toEqual({ 'your own account': 1, 'already following': 1, 'below minFollowers': 1 });
    expect(x.of('/1.1/friendships/create.json').map((c) => c.form.user_id)).toEqual(['13', '14']);
    expect(Object.keys(followsOf('session:auto-follow')).sort()).toEqual(['13', '14']);
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 });

    const again = await run(
      'autoFollow',
      { target: { type: 'username', value: 'source' }, maxFollows: 5, delayMs: 0, dryRun: true },
      x,
      { sessionHash: 'auto-follow' },
    );
    expect(again.wouldFollow).toBe(2);
    expect(again.items.filter((i) => i.outcome === 'would follow').map((i) => i.username)).toEqual(['tiny', 'carol']);
    expect(again.skipped['followed earlier by XActions']).toBe(2);
    expect(x.of('/1.1/friendships/create.json')).toHaveLength(2);
  });

  it('stops at a rate limit and reports what it had done', async () => {
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me')),
      SearchTimeline: searchOf([
        rawTweet('1', rawUser('21', 'dev1')),
        rawTweet('2', rawUser('22', 'dev2')),
        rawTweet('3', rawUser('23', 'dev3')),
        rawTweet('4', rawUser('21', 'dev1')),
      ]),
      '/1.1/friendships/create.json': (call, calls) =>
        calls.filter((c) => c.key === call.key).length > 1
          ? { errors: [{ message: 'You are unable to follow more people at this time. Rate limit exceeded.' }] }
          : {},
    });
    const result = await run('autoFollow', { target: { type: 'hashtag', value: 'buildinpublic' }, delayMs: 0 }, x);
    expect(x.of('SearchTimeline')[0].variables.rawQuery).toBe('#buildinpublic');
    expect(result.stoppedReason).toBe('rate limited by X');
    expect(result.items.slice(0, 3).map((i) => i.outcome)).toEqual(['followed', 'failed', 'not attempted']);
  });

  it('fails the job when the very first follow hits the rate limit', async () => {
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me')),
      SearchTimeline: searchOf([rawTweet('1', rawUser('21', 'dev1'))]),
      '/1.1/friendships/create.json': { errors: [{ message: 'Rate limit exceeded' }] },
    });
    const err = await failure(run('autoFollow', { target: { type: 'keyword', value: 'rust' }, delayMs: 0 }, x));
    expect(err.name).toBe('RateLimitError');
  });

  it('rejects a malformed target', async () => {
    const err = await failure(run('autoFollow', { target: { type: 'planet', value: 'mars' } }, xcom({})));
    expect(err).toBeInstanceOf(JobInputError);
  });
});

describe('smartUnfollow', () => {
  it('unfollows long-standing non-followers and keeps the grace period and filters', async () => {
    recordFollows('session:smart', [{ id: '33', username: 'recent' }]);
    const following = [
      rawUser('30', 'mutual', { followedBy: true }),
      rawUser('33', 'recent', { followedBy: false }),
      rawUser('34', 'bluecheck', { followedBy: false, verified: true }),
      rawUser('35', 'unknown'),
      rawUser('36', 'newer', { followedBy: false }),
      rawUser('37', 'oldest', { followedBy: false }),
    ];
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me', { following: 6, followers: 2 })),
      Following: userList(following),
      Followers: userList([rawUser('30', 'mutual'), rawUser('35', 'unknown')]),
      '/1.1/friendships/destroy.json': {},
    });
    const result = await run(
      'smartUnfollow',
      { maxUnfollows: 10, delayMs: 0, minDaysSinceFollow: 7, skipVerified: true },
      x,
      { sessionHash: 'smart' },
    );
    expect(x.of('Following')[0].variables.userId).toBe(ME);
    expect(result).toMatchObject({ success: true, mutuals: 2, unfollowed: 2, notFollowingBack: 4 });
    expect(result.scan).toMatchObject({ scanned: 6, complete: true, followersChecked: 2 });
    expect(x.of('/1.1/friendships/destroy.json').map((c) => c.form.user_id)).toEqual(['37', '36']);
    expect(result.skipped).toEqual({ verified: 1, 'grace period (7 days left)': 1 });
    expect(followsOf('session:smart')['33']).toBeDefined();
  });

  it('lists what it would unfollow on a dry run and charges nothing', async () => {
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me', { following: 1 })),
      Following: userList([rawUser('40', 'quiet', { followedBy: false, bio: 'hello' })]),
    });
    const result = await run('smartUnfollow', { dryRun: true, skipWithBio: false }, x, { sessionHash: 'smart-dry' });
    expect(result.wouldUnfollow).toBe(1);
    expect(result.items[0]).toMatchObject({ username: 'quiet', outcome: 'would unfollow' });
    expect(ledgerOf('session:smart-dry')).toEqual({});
  });
});

describe('autoRetweet', () => {
  it('reposts matching posts, skipping its own, replies and ones already reposted', async () => {
    const other = rawUser('50', 'writer');
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me')),
      SearchTimeline: searchOf([
        rawTweet('61', other),
        rawTweet('62', rawUser(ME, 'me')),
        rawTweet('63', other, { retweeted: true }),
        rawTweet('64', other, { replyTo: '1' }),
        rawTweet('65', other),
      ]),
      CreateRetweet: { data: { create_retweet: { retweet_results: { result: { rest_id: '9' } } } } },
    });
    const result = await run('autoRetweet', { target: { type: 'keyword', value: 'webgpu' }, maxRetweets: 5, delayMs: 0 }, x);
    expect(x.of('SearchTimeline')[0].variables.rawQuery).toBe('webgpu -filter:retweets -filter:replies');
    expect(x.of('CreateRetweet').map((c) => c.variables.tweet_id)).toEqual(['61', '65']);
    expect(result.skipped).toEqual({ 'your own post': 1, 'already reposted': 1, 'is a reply': 1 });
  });

  it("reads a user's own timeline for a username target", async () => {
    const author = rawUser('70', 'author');
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me')),
      UserByScreenName: profileOf(author),
      UserTweets: userTweetsOf([rawTweet('71', author), rawTweet('72', author)]),
    });
    const result = await run('autoRetweet', { target: { type: 'username', value: 'author' }, maxRetweets: 1, dryRun: true }, x);
    expect(x.of('UserTweets')[0].variables.userId).toBe('70');
    expect(result).toMatchObject({ dryRun: true, wouldRetweet: 1, eligible: 1 });
    expect(x.of('CreateRetweet')).toHaveLength(0);
  });
});

describe('bulkExecute', () => {
  it('parses objects and strings, and names every invalid item', () => {
    expect(parseBulkActions([{ action: 'like', target: '1' }, 'follow:@nasa', 'repost 5', { type: 'reply', tweetId: '2', text: 'hi' }])).toEqual([
      { index: 0, action: 'like', tweetId: '1' },
      { index: 1, action: 'follow', username: 'nasa' },
      { index: 2, action: 'retweet', tweetId: '5' },
      { index: 3, action: 'reply', tweetId: '2', text: 'hi' },
    ]);
    expect(() => parseBulkActions([{ action: 'dance', target: '1' }, { action: 'like' }, { action: 'quote', target: '3' }])).toThrow(
      /#0: unknown action "dance".*#1: target must be.*#2: text for quote is required/,
    );
  });

  it('runs every action, records failures and carries on', async () => {
    const x = xcom({
      FavoriteTweet: (call) => (call.variables.tweet_id === '2' ? { errors: [{ message: 'Something went wrong' }] } : { data: {} }),
      UserByScreenName: profileOf(rawUser('80', 'nasa')),
      '/1.1/friendships/create.json': {},
      CreateTweet: created('990'),
    });
    const result = await run(
      'bulkExecute',
      {
        actions: [
          { action: 'like', target: '1' },
          { action: 'like', target: '2' },
          { action: 'follow', target: 'nasa' },
          { action: 'reply', target: '3', text: 'nice' },
        ],
        delayMs: 0,
      },
      x,
      { sessionHash: 'bulk' },
    );
    expect(result).toMatchObject({ success: false, total: 4, succeeded: 3, failed: 1, stoppedReason: null });
    expect(result.items.map((i) => i.outcome)).toEqual(['liked', 'failed', 'followed', 'replied']);
    expect(result.items[3].resultId).toBe('990');
    expect(ledgerOf('session:bulk')).toMatchObject({ like: expect.any(Array), follow: expect.any(Array), reply: expect.any(Array) });
    expect(followsOf('session:bulk')['80'].username).toBe('nasa');
  });

  it('stops at the first failure when asked to', async () => {
    const x = xcom({ FavoriteTweet: { errors: [{ message: 'Something went wrong' }] } });
    const result = await run('bulkExecute', { actions: ['like:1', 'like:2', 'like:3'], stopOnError: true, delayMs: 0 }, x);
    expect(result.stoppedReason).toBe('stopOnError');
    expect(result.items.map((i) => i.outcome)).toEqual(['failed', 'not attempted', 'not attempted']);
    expect(x.of('FavoriteTweet')).toHaveLength(1);
  });

  it('stops when cancelled and keeps what it did', async () => {
    let cancelled = false;
    const x = xcom({
      FavoriteTweet: () => {
        cancelled = true;
        return { data: {} };
      },
    });
    const result = await run('bulkExecute', { actions: ['like:1', 'like:2'], delayMs: 0 }, x, {
      deps: { isCancelled: () => cancelled },
    });
    expect(result.stoppedReason).toBe('cancelled');
    expect(result.items.map((i) => i.outcome)).toEqual(['liked', 'not attempted']);
  });

  it('runs nothing when any action is invalid', async () => {
    const x = xcom({});
    const err = await failure(run('bulkExecute', { actions: ['like:1', 'like:nope'] }, x));
    expect(err).toBeInstanceOf(JobInputError);
    expect(x.calls).toHaveLength(0);
  });
});

describe('getNotifications', () => {
  const notification = (id, icon, user) => ({
    entryId: `notification-${id}`,
    content: {
      itemContent: {
        itemType: 'TimelineNotification',
        notification_results: {
          result: {
            rest_id: id,
            notification_icon: icon,
            rich_message: { text: `${user.legacy.screen_name} did something` },
            timestamp_ms: String(Date.now() - Number(id) * 1000),
            template: { from_users: [{ user_results: { result: user } }], target_objects: [] },
          },
        },
      },
    },
  });
  const feed = {
    data: {
      viewer_v2: {
        user_results: {
          result: {
            notification_timeline: {
              timeline: {
                instructions: timeline([
                  notification('1', 'heart_icon', rawUser('91', 'fan')),
                  notification('2', 'person_icon', rawUser('92', 'newbie')),
                  notification('3', 'heart_icon', rawUser('93', 'fan2')),
                ]),
              },
            },
          },
        },
      },
    },
  };

  it('reads notifications, and filters by type', async () => {
    const x = xcom({ NotificationsTimeline: feed });
    const all = await run('getNotifications', { limit: 10, filter: 'all' }, x);
    expect(all).toMatchObject({ count: 3, byType: { like: 2, follow: 1 } });
    expect(x.of('NotificationsTimeline')[0].variables.timeline_type).toBe('All');
    const likes = await run('getNotifications', { limit: 10, filter: 'likes' }, x);
    expect(likes.count).toBe(2);
    expect(likes.notifications.every((n) => n.type === 'like')).toBe(true);
    await run('getNotifications', { filter: 'mentions' }, x);
    expect(x.of('NotificationsTimeline')[2].variables.timeline_type).toBe('Mentions');
  });

  it('rejects an unknown filter and treats an empty feed as an error', async () => {
    expect(await failure(run('getNotifications', { filter: 'gossip' }, xcom({})))).toBeInstanceOf(JobInputError);
    const empty = xcom({ NotificationsTimeline: { data: { viewer_v2: { user_results: { result: { notification_timeline: { timeline: { instructions: [] } } } } } } } });
    expect((await failure(run('getNotifications', {}, empty))).message).toMatch(/no notifications/);
  });
});

describe('smartTarget', () => {
  it('ranks the accounts in a niche by the chosen goals', async () => {
    const busy = rawUser('201', 'busy', { followers: 5000, following: 4000, bio: 'rust compilers' });
    const star = rawUser('202', 'star', { followers: 2_000_000, following: 10 });
    const x = xcom({
      UserByRestId: profileOf(rawUser(ME, 'me')),
      SearchTimeline: searchOf([
        rawTweet('301', busy, { likes: 200 }),
        rawTweet('302', busy, { likes: 150 }),
        rawTweet('303', star, { likes: 900 }),
        rawTweet('304', rawUser(ME, 'me'), { likes: 5000 }),
      ]),
    });
    const growth = await run('smartTarget', { niche: 'rust compilers', goals: ['followers'], limit: 5 }, x);
    expect(x.of('SearchTimeline')[0].variables.product).toBe('Top');
    expect(growth.targets.map((t) => t.username)).toEqual(['busy', 'star']);
    expect(growth.targets[0]).toMatchObject({ rank: 1, postsInSample: 2, suggestedActions: ['follow', 'reply to their best recent post'] });
    expect(growth.targets[0].bestPost.id).toBe('301');

    const reach = await run('smartTarget', { niche: 'rust compilers', goals: 'reach', limit: 5 }, x);
    expect(reach.targets[0].username).toBe('star');
  });

  it('rejects unknown goals', async () => {
    const err = await failure(run('smartTarget', { niche: 'rust', goals: ['fame'] }, xcom({})));
    expect(err.message).toMatch(/goals must be from/);
  });
});

describe('audienceInsights', () => {
  it("describes an audience from a sample of the account's followers", async () => {
    const sample = [
      rawUser('401', 'dev', { followers: 1500, bio: 'Rust developer #rustlang', location: 'Berlin' }),
      rawUser('402', 'dev2', { followers: 800, bio: 'rust and wasm developer', location: 'berlin' }),
      rawUser('403', 'bot', { followers: 1, following: 4000, bio: '', statuses: 0, defaultAvatar: true }),
      rawUser('404', 'big', { followers: 250_000, verified: true, bio: 'developer advocate' }),
    ];
    const x = xcom({ UserByScreenName: profileOf(rawUser('400', 'crab', { followers: 4 })), Followers: userList(sample) });
    const result = await run('audienceInsights', { username: 'crab', sampleSize: 50 }, x);
    expect(x.of('Followers')[0].variables.userId).toBe('400');
    expect(result.sample).toMatchObject({ requested: 50, analysed: 4, coverage: 100 });
    expect(result.audience.verifiedShare).toBe(25);
    expect(result.interests.bioKeywords[0]).toEqual({ value: 'developer', count: 3 });
    expect(result.interests.bioHashtags).toEqual([{ value: '#rustlang', count: 1 }]);
    expect(result.topLocations[0]).toEqual({ value: 'berlin', count: 2 });
    expect(result.topFollowers[0].username).toBe('big');
    expect(result.quality.lowSignalShare).toBe(25);
  });

  it('fails clearly for an account with no followers', async () => {
    const x = xcom({ UserByScreenName: profileOf(rawUser('410', 'lonely', { followers: 0 })) });
    expect(await failure(run('audienceInsights', { username: 'lonely' }, x))).toBeInstanceOf(JobInputError);
  });

  it('computes account age and activity from join dates', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const out = describeAudience({ followers: 10 }, [
      { id: '1', username: 'a', followers: 10, following: 10, tweets: 730, joined: '2024-01-01T00:00:00Z', bio: '' },
      { id: '2', username: 'b', followers: 10, following: 10, tweets: 5, joined: '2025-07-01T00:00:00Z', bio: '' },
    ], now);
    expect(out.age.tiers.find((t) => t.label === '1-3 years').count).toBe(1);
    expect(out.age.tiers.find((t) => t.label === 'under 1 year').count).toBe(1);
    expect(out.activity.dormantShare).toBe(50);
  });
});

describe('engagementAnalytics', () => {
  it("reports on the session account's posts in the period", async () => {
    const me = rawUser(ME, 'me', { followers: 1000 });
    const x = xcom({
      '/1.1/account/verify_credentials.json': { id_str: ME, screen_name: 'me' },
      UserByRestId: profileOf(me),
      UserByScreenName: profileOf(me),
      UserTweets: userTweetsOf([
        rawTweet('501', me, { likes: 40, created: daysAgo(1), hashtags: ['webgpu'] }),
        rawTweet('502', me, { likes: 10, created: daysAgo(3) }),
        rawTweet('503', me, { likes: 99, created: daysAgo(20) }),
      ]),
    });
    const result = await run('engagementAnalytics', { period: '7d', sessionCookie: 'auth_token=tok; ct0=csrf' }, x);
    expect(x.of('/1.1/account/verify_credentials.json')).toHaveLength(1);
    expect(result).toMatchObject({ success: true, engine: 'session', account: 'me', period: '7d' });
    expect(result.coverage).toMatchObject({ postsRead: 3, postsInPeriod: 2, complete: true });
    expect(result.totals).toMatchObject({ posts: 2, likes: 50 });
    expect(result.report.topPosts[0].id).toBe('501');
    expect(result.report.topHashtags[0]).toEqual({ value: 'webgpu', count: 1 });
  });

  it('rejects a malformed period before touching X', async () => {
    const x = xcom({});
    expect(await failure(run('engagementAnalytics', { period: 'last week' }, x))).toBeInstanceOf(JobInputError);
    expect(x.calls).toHaveLength(0);
  });

  it('reads through the X API v2 for an OAuth-connected account', async () => {
    const requests = [];
    const answer = (config) => {
      requests.push(config);
      const url = config.url;
      const data = url === '/users/me'
        ? { data: { id: '600', username: 'oauthed', name: 'O', created_at: '2020-01-01T00:00:00.000Z', public_metrics: { followers_count: 200, following_count: 50, tweet_count: 90 } } }
        : config.params.pagination_token
          ? { data: [{ id: '702', text: 'second page', created_at: new Date(Date.now() - 86_400_000).toISOString(), public_metrics: { like_count: 5, retweet_count: 0, reply_count: 0, quote_count: 0, impression_count: 100 } }], meta: {} }
          : { data: [{ id: '701', text: 'first', created_at: new Date().toISOString(), public_metrics: { like_count: 20, retweet_count: 3, reply_count: 1, quote_count: 0, impression_count: 900 }, referenced_tweets: [{ type: 'quoted', id: '1' }] }], meta: { next_token: 'p2' } };
      return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
    };
    const api = axios.create({ baseURL: 'https://api.x.com/2', adapter: answer });
    const result = await analyticsViaOAuth(api, { period: '7d' });
    expect(requests.map((r) => r.url)).toEqual(['/users/me', '/users/600/tweets', '/users/600/tweets']);
    expect(requests[1].params.start_time).toBeDefined();
    expect(result).toMatchObject({ engine: 'oauth', account: 'oauthed', coverage: { postsRead: 2, postsInPeriod: 2, complete: true } });
    expect(result.totals).toMatchObject({ likes: 25, views: 1000 });
    expect(result.report.mix.quotes).toBe(1);
  });
});
