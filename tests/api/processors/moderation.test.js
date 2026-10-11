// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the moderation processors
 * (api/services/processors/moderation.processors.js): blocking, muting,
 * follower removal, reporting, shadowban checks, reply restrictions, lists,
 * bookmarks and topics.
 *
 * Only the network boundary is replaced. The job context is the real one,
 * built with a `fetch` that answers the way x.com does, so every request goes
 * through the real HTTP client, query-ID resolution, parsers and the real
 * daily-cap ledger (kept in a temporary XACTIONS_HOME). The two browser
 * flows get a stand-in for the Puppeteer page, the browser's network edge.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import processors, { scoreBot } from '../../../api/services/processors/moderation.processors.js';
import { createJobContext, JobInputError } from '../../../api/services/processors/context.js';
import { remaining } from '../../../src/mcp/action-caps.js';

const SESSION = 'auth_token=tok; ct0=csrf';
const OWNER = 'session:mod-test';

// ---------------------------------------------------------------------------
// x.com fixtures, shaped the way the parsers read them
// ---------------------------------------------------------------------------

const CREATED = 'Wed Oct 10 20:19:24 +0000 2018';

function rawUser({
  id,
  username,
  name = username,
  bio = 'Writes about things.',
  followers = 500,
  following = 300,
  tweets = 1200,
  createdAt = CREATED,
  avatar = `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg`,
  verified = false,
  protectedAccount = false,
}) {
  return {
    __typename: 'User',
    rest_id: id,
    is_blue_verified: verified,
    legacy: {
      screen_name: username,
      name,
      description: bio,
      followers_count: followers,
      friends_count: following,
      statuses_count: tweets,
      created_at: createdAt,
      profile_image_url_https: avatar,
      protected: protectedAccount,
    },
  };
}

function rawTweet({ id, text, user, replyTo = null }) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: user } },
    legacy: {
      id_str: id,
      full_text: text,
      created_at: CREATED,
      favorite_count: 3,
      retweet_count: 1,
      reply_count: 0,
      entities: { urls: [], hashtags: [], user_mentions: [] },
      ...(replyTo ? { in_reply_to_status_id_str: replyTo, in_reply_to_screen_name: 'someone' } : {}),
    },
  };
}

const cursorEntry = (cursor) => ({ entryId: `cursor-bottom-${cursor}`, content: { value: cursor } });

function userEntries(users, cursor) {
  const entries = users.map((u) => ({
    entryId: `user-${u.rest_id}`,
    content: { itemContent: { user_results: { result: u } } },
  }));
  if (cursor) entries.push(cursorEntry(cursor));
  return { instructions: [{ type: 'TimelineAddEntries', entries }] };
}

function tweetEntries(tweets, cursor) {
  const entries = tweets.map((t) => ({
    entryId: `tweet-${t.rest_id}`,
    content: { itemContent: { tweet_results: { result: t } } },
  }));
  if (cursor) entries.push(cursorEntry(cursor));
  return { instructions: [{ type: 'TimelineAddEntries', entries }] };
}

const ME = rawUser({ id: '100', username: 'me_account' });
const VERIFY = { id_str: '100', screen_name: 'me_account', name: 'Me' };

// ---------------------------------------------------------------------------
// The fake x.com
// ---------------------------------------------------------------------------

function respond(status, body) {
  return { status, headers: { get: () => null, getSetCookie: () => [] }, json: async () => body };
}

/**
 * A fetch that routes like x.com: GraphQL by operation name, REST by path
 * (without the /i/api prefix). A handler returns a body, or `[status, body]`.
 */
function xcom(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const op = u.pathname.match(/\/i\/api\/graphql\/[^/]+\/([^/]+)$/)?.[1] ?? null;
    const restPath = op ? null : u.pathname.replace(/^\/i\/api/, '');
    let variables = {};
    let form = {};
    if (op && init.method === 'POST') variables = JSON.parse(init.body).variables;
    else if (op) variables = JSON.parse(u.searchParams.get('variables') || '{}');
    else if (init.body) form = Object.fromEntries(new URLSearchParams(init.body));
    const call = { op, path: restPath, query: Object.fromEntries(u.searchParams), variables, form, method: init.method || 'GET' };
    calls.push(call);
    const handler = routes[op ?? restPath];
    if (!handler) return respond(500, { errors: [{ message: `unexpected request ${op ?? restPath}` }] });
    const out = await handler(call);
    return Array.isArray(out) ? respond(out[0], out[1]) : respond(200, out);
  };
  return { fetch, calls, of: (key) => calls.filter((c) => (c.op ?? c.path) === key) };
}

const byScreenName = (users) => (call) => {
  const user = users.find((u) => u.legacy.screen_name.toLowerCase() === String(call.variables.screen_name).toLowerCase());
  return { data: { user: user ? { result: user } : {} } };
};

function job(type, config, progress = []) {
  return {
    id: 'job-1',
    name: type,
    data: { type, id: 'op-1', sessionHash: 'mod-test', config: { session: SESSION, ...config } },
    progress: (p) => progress.push(p),
  };
}

/** Run a processor with fake timers advanced until it settles. */
async function run(type, config, deps = {}) {
  const ctx = createJobContext(job(type, config), deps);
  const promise = processors[type].run(ctx);
  let settled = false;
  promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  while (!settled) await vi.advanceTimersByTimeAsync(500);
  try {
    return await promise;
  } finally {
    await ctx.dispose();
  }
}

const used = (cls) => remaining(OWNER).classes[cls].used;

let home;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-moderation-'));
  process.env.XACTIONS_HOME = home;
  delete process.env.XACTIONS_ACTION_CAPS;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.XACTIONS_HOME;
  delete process.env.XACTIONS_ACTION_CAPS;
  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('moderation processor registration', () => {
  it('defines every moderation job type with a run function', () => {
    expect(Object.keys(processors).sort()).toEqual(
      [
        'blockBots', 'massBlock', 'massUnblock', 'massUnmute', 'muteKeywords', 'mutedWords', 'removeFollowers',
        'reportSpam', 'shadowbanCheck', 'verifiedOnly', 'blockedList', 'mutedList', 'getLists', 'getListMembers',
        'bookmarksExport', 'bookmarksFolders', 'bookmarksOrganize', 'bookmarksSearch', 'bookmarksClear',
        'bookmarksImport', 'getBookmarks', 'createBookmarkFolder', 'topicFollow', 'topicUnfollow', 'topicDiscover',
        'topicList',
      ].sort(),
    );
    for (const def of Object.values(processors)) expect(typeof def.run).toBe('function');
    expect(processors.massBlock.write).toBe(true);
    expect(processors.blockedList.write).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Relationship batches
// ---------------------------------------------------------------------------

describe('massBlock / massUnblock / removeFollowers', () => {
  const alice = rawUser({ id: '201', username: 'alice' });

  it('blocks resolved accounts, charges the block cap and reports missing ones', async () => {
    const x = xcom({ UserByScreenName: byScreenName([alice]), '/1.1/blocks/create.json': () => ({ id_str: '201' }) });
    const result = await run('massBlock', { usernames: ['@alice', 'ghost_user', 'alice', 'not a name!'], delayMs: 0 }, { fetch: x.fetch });

    expect(result.results).toEqual([
      { username: 'alice', userId: '201', status: 'blocked' },
      { username: 'ghost_user', userId: null, status: 'failed', error: '@ghost_user does not exist or is suspended' },
    ]);
    expect(result.counts).toEqual({ blocked: 1, failed: 1 });
    expect(result.invalid).toEqual(['not a name!']);
    expect(x.of('/1.1/blocks/create.json').map((c) => c.form.user_id)).toEqual(['201']);
    expect(used('block')).toBe(1);
  });

  it('refuses a job with no usable usernames', async () => {
    await expect(run('massBlock', { usernames: [] })).rejects.toBeInstanceOf(JobInputError);
    await expect(run('massBlock', { usernames: ['***'] })).rejects.toThrow('no valid X usernames');
  });

  it('writes nothing on a dry run', async () => {
    const x = xcom({ UserByScreenName: byScreenName([alice]) });
    const result = await run('massBlock', { usernames: ['alice'], dryRun: true }, { fetch: x.fetch });
    expect(result.results[0].status).toBe('would_be_blocked');
    expect(x.of('/1.1/blocks/create.json')).toHaveLength(0);
    expect(used('block')).toBe(0);
  });

  it('stops the batch at the daily cap and keeps what it did', async () => {
    process.env.XACTIONS_ACTION_CAPS = JSON.stringify({ block: 1 });
    const bob = rawUser({ id: '202', username: 'bob' });
    const x = xcom({ UserByScreenName: byScreenName([alice, bob]), '/1.1/blocks/create.json': () => ({}) });
    const result = await run('massBlock', { usernames: ['alice', 'bob', 'carol'], delayMs: 0 }, { fetch: x.fetch });
    expect(result.results.map((r) => r.status)).toEqual(['blocked', 'failed', 'skipped']);
    expect(result.stopped.reason).toBe('ActionCapExceededError');
    expect(x.of('/1.1/blocks/create.json')).toHaveLength(1);
  });

  it('fails the job when X rejects the session before anything is done', async () => {
    const x = xcom({ UserByScreenName: byScreenName([alice]), '/1.1/blocks/destroy.json': () => [401, {}] });
    await expect(run('massUnblock', { usernames: ['alice'] }, { fetch: x.fetch })).rejects.toMatchObject({ name: 'AuthError' });
  });

  it('removes followers with the RemoveFollower mutation and records X errors per account', async () => {
    const bob = rawUser({ id: '202', username: 'bob' });
    const x = xcom({
      UserByScreenName: byScreenName([alice, bob]),
      RemoveFollower: (call) =>
        call.variables.target_user_id === '201'
          ? { data: { remove_follower: { unfollow_success_reason: 'Success' } } }
          : { errors: [{ message: 'This user does not follow you' }] },
    });
    const result = await run('removeFollowers', { usernames: ['alice', 'bob'], delayMs: 0 }, { fetch: x.fetch });
    expect(result.results).toEqual([
      { username: 'alice', userId: '201', status: 'removed' },
      { username: 'bob', userId: null, status: 'failed', error: 'This user does not follow you' },
    ]);
    expect(x.of('RemoveFollower').map((c) => c.variables)).toEqual([{ target_user_id: '201' }, { target_user_id: '202' }]);
  });
});

describe('massUnmute', () => {
  it('unmutes every muted account when no usernames are given', async () => {
    const muted = [rawUser({ id: '301', username: 'loud1' }), rawUser({ id: '302', username: 'loud2' })];
    const x = xcom({
      MutedAccounts: () => ({ data: { viewer: { muting_timeline: { timeline: userEntries(muted) } } } }),
      '/1.1/mutes/users/destroy.json': () => ({}),
    });
    const result = await run('massUnmute', { delayMs: 0 }, { fetch: x.fetch });
    expect(result.scope).toBe('all_muted');
    expect(result.mutedFound).toBe(2);
    expect(result.counts).toEqual({ unmuted: 2 });
    expect(x.of('/1.1/mutes/users/destroy.json').map((c) => c.form.user_id)).toEqual(['301', '302']);
    expect(x.of('UserByScreenName')).toHaveLength(0);
    expect(used('mute')).toBe(2);
  });

  it('unmutes only the listed accounts when usernames are given', async () => {
    const x = xcom({
      UserByScreenName: byScreenName([rawUser({ id: '301', username: 'loud1' })]),
      '/1.1/mutes/users/destroy.json': () => ({}),
    });
    const result = await run('massUnmute', { usernames: ['loud1'] }, { fetch: x.fetch });
    expect(result.scope).toBe('listed');
    expect(result.results).toEqual([{ username: 'loud1', userId: '301', status: 'unmuted' }]);
  });
});

describe('blockBots', () => {
  it('scores profiles from their signals', () => {
    const now = Date.parse('2026-09-30T00:00:00Z');
    const bot = scoreBot(
      { username: 'user84629173', avatar: 'https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png', bio: '', followers: 1, following: 900, tweets: 0, joined: '2026-09-20T00:00:00Z', verified: false },
      now,
    );
    expect(bot.score).toBe(1);
    expect(bot.signals).toEqual(expect.arrayContaining(['default_avatar', 'no_bio', 'extreme_follow_ratio', 'no_posts', 'new_account', 'numeric_handle', 'few_followers']));
    const person = scoreBot({ username: 'dana', avatar: 'https://pbs.twimg.com/p.jpg', bio: 'Painter', followers: 800, following: 200, tweets: 3000, joined: '2015-01-01T00:00:00Z', verified: true }, now);
    expect(person).toEqual({ score: 0, signals: ['verified'] });
  });

  it('blocks followers over the threshold and leaves the rest alone', async () => {
    const bot = rawUser({
      id: '401', username: 'promo98127364', bio: '', followers: 2, following: 4000, tweets: 0,
      avatar: 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png',
    });
    const human = rawUser({ id: '402', username: 'real_person' });
    const x = xcom({
      '/1.1/account/verify_credentials.json': () => VERIFY,
      Followers: (call) => {
        expect(call.variables.userId).toBe('100');
        return { data: { user: { result: { timeline: { timeline: userEntries([bot, human]) } } } } };
      },
      '/1.1/blocks/create.json': () => ({}),
    });
    const result = await run('blockBots', { threshold: 0.7, limit: 50, delayMs: 0 }, { fetch: x.fetch });
    expect(result.account).toBe('me_account');
    expect(result.scanned).toBe(2);
    expect(result.suspects).toBe(1);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]).toMatchObject({ username: 'promo98127364', userId: '401', status: 'blocked' });
    expect(result.accounts[0].score).toBeGreaterThanOrEqual(0.7);
    expect(x.of('/1.1/blocks/create.json').map((c) => c.form.user_id)).toEqual(['401']);
  });

  it('fails when X answers the followers query without a timeline', async () => {
    const x = xcom({
      '/1.1/account/verify_credentials.json': () => VERIFY,
      Followers: () => ({ errors: [{ message: 'Dependency: Unspecified' }] }),
    });
    await expect(run('blockBots', {}, { fetch: x.fetch })).rejects.toThrow('Dependency: Unspecified');
  });
});

describe('muteKeywords', () => {
  it('mutes the authors of matching posts, never the account itself', async () => {
    const spammer = rawUser({ id: '501', username: 'giveaway_bot' });
    const other = rawUser({ id: '502', username: 'bystander' });
    const x = xcom({
      '/1.1/account/verify_credentials.json': () => VERIFY,
      SearchTimeline: (call) => {
        expect(call.variables.rawQuery).toBe('"free crypto"');
        return {
          data: {
            search_by_raw_query: {
              search_timeline: {
                timeline: tweetEntries([
                  rawTweet({ id: '9001', text: 'FREE CRYPTO for everyone', user: spammer }),
                  rawTweet({ id: '9002', text: 'free crypto is a scam, careful', user: ME }),
                  rawTweet({ id: '9003', text: 'unrelated post', user: other }),
                ]),
              },
            },
          },
        };
      },
      '/1.1/mutes/users/create.json': () => ({}),
    });
    const result = await run('muteKeywords', { keywords: ['free crypto'], delayMs: 0 }, { fetch: x.fetch });
    expect(result.results).toEqual([
      { username: 'giveaway_bot', userId: '501', status: 'muted', keyword: 'free crypto', tweetId: '9001' },
    ]);
    expect(result.postsScanned).toEqual({ 'free crypto': 3 });
    expect(x.of('/1.1/mutes/users/create.json').map((c) => c.form.user_id)).toEqual(['501']);
  });

  it('requires keywords', async () => {
    await expect(run('muteKeywords', { keywords: [] })).rejects.toBeInstanceOf(JobInputError);
  });
});

describe('mutedWords', () => {
  const words = [
    { id: '11', keyword: 'spoilers', created_at: '1700000000000', mute_surfaces: ['home_timeline'], mute_options: [] },
    { id: '12', keyword: 'giveaway', created_at: '1700000000001', mute_surfaces: ['home_timeline'], mute_options: [] },
  ];

  it('lists muted words', async () => {
    const x = xcom({ '/1.1/mutes/keywords/list.json': () => ({ muted_keywords: words }) });
    const result = await run('mutedWords', {}, { fetch: x.fetch });
    expect(result.count).toBe(2);
    expect(result.mutedWords[0]).toMatchObject({ id: '11', keyword: 'spoilers' });
  });

  it('adds words with the chosen duration and returns the new list', async () => {
    const store = [...words];
    const x = xcom({
      '/1.1/mutes/keywords/list.json': () => ({ muted_keywords: store }),
      '/1.1/mutes/keywords/create.json': (call) => {
        store.push({ id: '13', keyword: call.form.keyword });
        return { muted_keywords: [store.at(-1)] };
      },
    });
    const result = await run('mutedWords', { action: 'add', words: ['launch leak'], duration: '7d', excludeFollowing: true }, { fetch: x.fetch });
    expect(x.of('/1.1/mutes/keywords/create.json')[0].form).toEqual({
      keyword: 'launch leak',
      mute_surfaces: 'notifications,home_timeline,tweet_replies',
      mute_option: 'exclude_following_accounts',
      duration: String(7 * 24 * 60 * 60 * 1000),
    });
    expect(result.counts).toEqual({ muted: 1 });
    expect(result.mutedWords.map((w) => w.keyword)).toContain('launch leak');
    expect(used('mute')).toBe(1);
  });

  it('removes named words and reports the ones that were not muted', async () => {
    let store = [...words];
    const x = xcom({
      '/1.1/mutes/keywords/list.json': () => ({ muted_keywords: store }),
      '/1.1/mutes/keywords/destroy.json': (call) => {
        const ids = call.form.ids.split(',');
        store = store.filter((w) => !ids.includes(w.id));
        return {};
      },
    });
    const result = await run('mutedWords', { action: 'remove', words: ['Giveaway', 'never-muted'] }, { fetch: x.fetch });
    expect(x.of('/1.1/mutes/keywords/destroy.json')[0].form.ids).toBe('12');
    expect(result.removed).toEqual(['giveaway']);
    expect(result.notMuted).toEqual(['never-muted']);
    expect(result.count).toBe(1);
  });

  it('rejects an unknown action and a malformed answer from X', async () => {
    await expect(run('mutedWords', { action: 'explode' })).rejects.toBeInstanceOf(JobInputError);
    const x = xcom({ '/1.1/mutes/keywords/list.json': () => ({ something: 'else' }) });
    await expect(run('mutedWords', {}, { fetch: x.fetch })).rejects.toThrow('without a muted_keywords array');
  });
});

// ---------------------------------------------------------------------------
// Shadowban check and reply restrictions
// ---------------------------------------------------------------------------

describe('shadowbanCheck', () => {
  const target = rawUser({ id: '601', username: 'target_acct' });
  const other = rawUser({ id: '602', username: 'someone' });
  const timeline = tweetEntries([
    rawTweet({ id: '7001', text: 'a post', user: target }),
    rawTweet({ id: '7002', text: 'a reply', user: target, replyTo: '6999' }),
    rawTweet({ id: '6999', text: 'the parent', user: other }),
  ]);

  function routes({ searchable, suggested }) {
    return {
      UserByScreenName: byScreenName([target]),
      '/1.1/search/typeahead.json': (call) => {
        expect(call.query).toMatchObject({ q: 'target_acct', result_type: 'users' });
        return { users: suggested ? [{ screen_name: 'target_acct' }] : [{ screen_name: 'target_acct_fan' }] };
      },
      UserTweetsAndReplies: () => ({ data: { user: { result: { timeline: { timeline } } } } }),
      SearchTimeline: (call) => {
        const replies = call.variables.rawQuery.includes('filter:replies');
        const tweets = !searchable ? [] : replies
          ? [rawTweet({ id: '7002', text: 'a reply', user: target, replyTo: '6999' })]
          : [rawTweet({ id: '7001', text: 'a post', user: target })];
        return { data: { search_by_raw_query: { search_timeline: { timeline: tweetEntries(tweets) } } } };
      },
    };
  }

  it('reports a clean account', async () => {
    const x = xcom(routes({ searchable: true, suggested: true }));
    const result = await run('shadowbanCheck', { username: '@target_acct' }, { fetch: x.fetch });
    expect(result.verdict).toBe('clean');
    expect(result.flags).toEqual([]);
    expect(result.recent).toEqual({ posts: 1, replies: 1 });
    expect(Object.values(result.tests).map((t) => t.status)).toEqual(['pass', 'pass', 'pass']);
    expect(x.of('SearchTimeline').map((c) => c.variables.rawQuery)).toEqual(['from:target_acct', 'from:target_acct filter:replies']);
  });

  it('flags a search ban and a suggestion ban', async () => {
    const x = xcom(routes({ searchable: false, suggested: false }));
    const result = await run('shadowbanCheck', { username: 'target_acct' }, { fetch: x.fetch });
    expect(result.verdict).toBe('restricted');
    expect(result.flags).toEqual(['search_ban', 'search_suggestion_ban', 'reply_deboosting']);
  });

  it('reports a suspended account without running searches', async () => {
    const x = xcom({
      UserByScreenName: () => ({ data: { user: { result: { __typename: 'UserUnavailable', reason: 'Suspended' } } } }),
    });
    const result = await run('shadowbanCheck', { username: 'gone' }, { fetch: x.fetch });
    expect(result).toMatchObject({ verdict: 'suspended', suspended: true, flags: ['suspended'] });
    expect(x.of('SearchTimeline')).toHaveLength(0);
  });

  it('does not test a protected account', async () => {
    const locked = rawUser({ id: '603', username: 'locked', protectedAccount: true });
    const x = xcom({ UserByScreenName: byScreenName([locked]) });
    const result = await run('shadowbanCheck', { username: 'locked' }, { fetch: x.fetch });
    expect(result.verdict).toBe('protected');
  });

  it('rejects a malformed username', async () => {
    await expect(run('shadowbanCheck', { username: 'bad name' })).rejects.toBeInstanceOf(JobInputError);
  });
});

describe('verifiedOnly', () => {
  it('restricts replies on the listed posts to verified accounts', async () => {
    const x = xcom({ ConversationControlChange: () => ({ data: { tweet_conversation_control_put: 'Done' } }) });
    const result = await run('verifiedOnly', { tweetIds: ['https://x.com/me_account/status/8001', '8002'], delayMs: 0 }, { fetch: x.fetch });
    expect(x.of('ConversationControlChange').map((c) => c.variables)).toEqual([
      { tweet_id: '8001', mode: 'Verified' },
      { tweet_id: '8002', mode: 'Verified' },
    ]);
    expect(result).toMatchObject({ enabled: true, replyAudience: 'verified', counts: { verified_only: 2 } });
  });

  it('opens replies again on the latest original posts when disabled', async () => {
    const x = xcom({
      '/1.1/account/verify_credentials.json': () => VERIFY,
      UserByScreenName: byScreenName([ME]),
      UserTweets: () => ({
        data: {
          user: {
            result: {
              timeline: {
                timeline: tweetEntries([
                  rawTweet({ id: '8101', text: 'mine', user: ME }),
                  rawTweet({ id: '8102', text: 'my reply', user: ME, replyTo: '1' }),
                ]),
              },
            },
          },
        },
      }),
      ConversationControlDelete: () => ({ data: { tweet_conversation_control_delete: 'Done' } }),
    });
    const result = await run('verifiedOnly', { enabled: false, limit: 5 }, { fetch: x.fetch });
    expect(x.of('ConversationControlDelete').map((c) => c.variables.tweet_id)).toEqual(['8101']);
    expect(result.results).toEqual([{ tweetId: '8101', status: 'everyone' }]);
  });

  it('records a post X refuses to change', async () => {
    const x = xcom({
      ConversationControlChange: () => ({ errors: [{ message: 'Only X Premium subscribers can limit replies to verified accounts' }] }),
    });
    const result = await run('verifiedOnly', { tweetIds: ['8001'] }, { fetch: x.fetch });
    expect(result.results[0]).toMatchObject({ tweetId: '8001', status: 'failed' });
    expect(result.results[0].error).toMatch(/Premium/);
  });
});

// ---------------------------------------------------------------------------
// Blocked and muted lists, X lists
// ---------------------------------------------------------------------------

describe('blockedList / mutedList', () => {
  it('pages through blocked accounts until the limit and returns the next cursor', async () => {
    const page1 = [rawUser({ id: '1', username: 'b1' }), rawUser({ id: '2', username: 'b2' })];
    const page2 = [rawUser({ id: '3', username: 'b3' }), rawUser({ id: '4', username: 'b4' })];
    const x = xcom({
      BlockedAccountsAll: (call) => ({
        data: { viewer: { timeline: { timeline: call.variables.cursor === 'c1' ? userEntries(page2, 'c2') : userEntries(page1, 'c1') } } },
      }),
    });
    const result = await run('blockedList', { limit: 3 }, { fetch: x.fetch });
    expect(result.accounts.map((a) => a.username)).toEqual(['b1', 'b2', 'b3']);
    expect(result.nextCursor).toBe('c2');
    expect(x.of('BlockedAccountsAll')).toHaveLength(2);
  });

  it('returns an honest empty list when the timeline has no accounts', async () => {
    const x = xcom({ MutedAccounts: () => ({ data: { viewer: { muting_timeline: { timeline: userEntries([], 'end') } } } }) });
    const result = await run('mutedList', {}, { fetch: x.fetch });
    expect(result).toMatchObject({ count: 0, accounts: [], nextCursor: null });
  });

  it('fails when X sends no timeline at all', async () => {
    const x = xcom({ MutedAccounts: () => ({ data: { viewer: {} } }) });
    await expect(run('mutedList', {}, { fetch: x.fetch })).rejects.toThrow('without a timeline');
  });
});

describe('getLists / getListMembers', () => {
  const list = (id, name, owner) => ({
    entryId: `list-${id}`,
    content: {
      itemContent: {
        list: { id_str: id, name, description: `${name} desc`, member_count: 12, subscriber_count: 3, mode: 'Private', created_at: 1700000000000, following: false, user_results: { result: owner } },
      },
    },
  });

  it('reads the session account lists when no username is given', async () => {
    const x = xcom({
      '/1.1/account/verify_credentials.json': () => VERIFY,
      CombinedLists: (call) => {
        expect(call.variables.userId).toBe('100');
        return { data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [list('55', 'Builders', ME)] }] } } } } } };
      },
    });
    const result = await run('getLists', { username: null, limit: 50 }, { fetch: x.fetch });
    expect(result.username).toBe('me_account');
    expect(result.lists).toEqual([
      expect.objectContaining({ id: '55', name: 'Builders', private: true, memberCount: 12, owner: { id: '100', username: 'me_account', name: 'me_account' }, url: 'https://x.com/i/lists/55' }),
    ]);
  });

  it('reads another account lists by username', async () => {
    const dana = rawUser({ id: '700', username: 'dana' });
    const x = xcom({
      UserByScreenName: byScreenName([dana]),
      CombinedLists: (call) => {
        expect(call.variables.userId).toBe('700');
        return { data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [list('56', 'Art', dana)] }] } } } } } };
      },
    });
    const result = await run('getLists', { username: 'dana' }, { fetch: x.fetch });
    expect(result).toMatchObject({ username: 'dana', count: 1 });
  });

  it('pages list members and resumes from a cursor', async () => {
    const members = [rawUser({ id: '801', username: 'm1' }), rawUser({ id: '802', username: 'm2' })];
    const x = xcom({
      ListMembers: (call) => {
        expect(call.variables).toMatchObject({ listId: '55', cursor: 'start' });
        return { data: { list: { members_timeline: { timeline: userEntries(members, 'more') } } } };
      },
    });
    const result = await run('getListMembers', { listId: '55', limit: 2, cursor: 'start' }, { fetch: x.fetch });
    expect(result.members.map((m) => m.username)).toEqual(['m1', 'm2']);
    expect(result.nextCursor).toBe('more');
  });

  it('rejects a missing or non-numeric list ID', async () => {
    await expect(run('getListMembers', {})).rejects.toThrow('listId or listUrl is required');
    await expect(run('getListMembers', { listId: 'abc' })).rejects.toBeInstanceOf(JobInputError);
  });
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

describe('bookmarks', () => {
  const author = rawUser({ id: '901', username: 'writer', name: 'The Writer' });
  const bookmarks = [
    rawTweet({ id: '1001', text: 'A long thread about Rust, performance and memory', user: author }),
    rawTweet({ id: '1002', text: 'Photos from the trip, "quoted", with commas', user: ME }),
  ];
  const bookmarkRoute = () => ({ data: { bookmark_timeline_v2: { timeline: tweetEntries(bookmarks, 'b-end') } } });
  const folders = { data: { viewer: { user_results: { result: { bookmark_collections_slice: { items: [{ id: 'f1', name: 'Reading' }], slice_info: {} } } } } } };

  it('exports bookmarks as CSV', async () => {
    const x = xcom({ Bookmarks: bookmarkRoute });
    const result = await run('bookmarksExport', { format: 'csv' }, { fetch: x.fetch });
    expect(result.count).toBe(2);
    expect(result.bookmarks[0]).toMatchObject({ id: '1001', url: 'https://x.com/writer/status/1001', author: { username: 'writer' } });
    const lines = result.csv.split('\n');
    expect(lines[0]).toBe('id,url,author,authorName,text,createdAt,likes,retweets,replies,views,media,links');
    expect(lines[2]).toContain('"Photos from the trip, ""quoted"", with commas"');
  });

  it('serves the dashboard read as JSON and rejects unknown formats', async () => {
    const x = xcom({ Bookmarks: bookmarkRoute });
    const result = await run('getBookmarks', { limit: 1, format: 'json' }, { fetch: x.fetch });
    expect(result.count).toBe(1);
    expect(result.csv).toBeUndefined();
    await expect(run('getBookmarks', { format: 'xml' })).rejects.toBeInstanceOf(JobInputError);
  });

  it('searches bookmark text and authors', async () => {
    const x = xcom({ Bookmarks: bookmarkRoute });
    const hit = await run('bookmarksSearch', { query: 'rust memory' }, { fetch: x.fetch });
    expect(hit.bookmarks.map((b) => b.id)).toEqual(['1001']);
    const byAuthor = await run('bookmarksSearch', { query: 'trip', from: '@me_account' }, { fetch: x.fetch });
    expect(byAuthor.bookmarks.map((b) => b.id)).toEqual(['1002']);
    const none = await run('bookmarksSearch', { query: '"not there"' }, { fetch: x.fetch });
    expect(none).toMatchObject({ scanned: 2, totalMatches: 0, bookmarks: [] });
    await expect(run('bookmarksSearch', {})).rejects.toBeInstanceOf(JobInputError);
  });

  it('lists, creates, renames and deletes folders', async () => {
    const x = xcom({
      BookmarkFoldersSlice: () => folders,
      createBookmarkFolder: (call) => ({ data: { bookmark_collection_create: { id: 'f2', name: call.variables.name } } }),
      EditBookmarkFolder: () => ({ data: { bookmark_collection_update: { id: 'f1', name: 'Later' } } }),
      DeleteBookmarkFolder: () => ({ data: { bookmark_collection_delete: 'Done' } }),
    });
    expect((await run('bookmarksFolders', {}, { fetch: x.fetch })).folders).toEqual([{ id: 'f1', name: 'Reading' }]);
    expect((await run('bookmarksFolders', { name: 'Ideas' }, { fetch: x.fetch })).folder).toEqual({ id: 'f2', name: 'Ideas' });
    expect((await run('bookmarksFolders', { folderId: 'f1', name: 'Later' }, { fetch: x.fetch })).action).toBe('rename');
    expect((await run('bookmarksFolders', { action: 'delete', folderId: 'f1' }, { fetch: x.fetch })).deleted).toBe(true);
    expect((await run('createBookmarkFolder', { name: 'Recipes' }, { fetch: x.fetch })).folder).toEqual({ id: 'f2', name: 'Recipes' });
    await expect(run('createBookmarkFolder', { name: 'x'.repeat(26) })).rejects.toBeInstanceOf(JobInputError);
  });

  it('surfaces X refusing folders to accounts without Premium', async () => {
    const x = xcom({ createBookmarkFolder: () => ({ errors: [{ message: 'Bookmark folders are available to Premium subscribers' }] }) });
    await expect(run('createBookmarkFolder', { name: 'Ideas' }, { fetch: x.fetch })).rejects.toThrow('Premium subscribers');
  });

  it('organizes bookmarks by rule, creating a missing folder', async () => {
    const x = xcom({
      Bookmarks: bookmarkRoute,
      BookmarkFoldersSlice: () => folders,
      createBookmarkFolder: (call) => ({ data: { bookmark_collection_create: { id: 'f9', name: call.variables.name } } }),
      bookmarkTweetToFolder: () => ({ data: { bookmark_collection_tweet_put: 'Done' } }),
    });
    const result = await run(
      'bookmarksOrganize',
      { rules: [{ folder: 'Reading', authors: ['@writer'] }, { folder: 'Travel', keywords: ['trip'] }], delayMs: 0 },
      { fetch: x.fetch },
    );
    expect(result.foldersCreated).toEqual(['Travel']);
    expect(result.results).toEqual([
      { tweetId: '1001', folder: 'Reading', folderId: 'f1', status: 'moved' },
      { tweetId: '1002', folder: 'Travel', folderId: 'f9', status: 'moved' },
    ]);
    expect(x.of('bookmarkTweetToFolder').map((c) => c.variables)).toEqual([
      { tweet_id: '1001', bookmark_collection_id: 'f1' },
      { tweet_id: '1002', bookmark_collection_id: 'f9' },
    ]);
  });

  it('plans explicit moves on a dry run without writing', async () => {
    const x = xcom({ BookmarkFoldersSlice: () => folders });
    const result = await run('bookmarksOrganize', { tweetIds: ['1001'], folder: 'reading', dryRun: true }, { fetch: x.fetch });
    expect(result.results).toEqual([{ tweetId: '1001', folder: 'Reading', status: 'would_move' }]);
    await expect(run('bookmarksOrganize', {})).rejects.toBeInstanceOf(JobInputError);
    await expect(run('bookmarksOrganize', { rules: [{ folder: 'X' }] })).rejects.toThrow('needs keywords or authors');
  });

  it('clears every bookmark and charges one delete', async () => {
    const x = xcom({ BookmarksAllDelete: () => ({ data: { bookmark_all_delete: 'Done' } }) });
    const result = await run('bookmarksClear', {}, { fetch: x.fetch });
    expect(result).toMatchObject({ cleared: true, response: 'Done' });
    expect(x.of('BookmarksAllDelete')).toHaveLength(1);
    expect(used('delete')).toBe(1);
  });

  it('imports bookmarks from IDs, URLs and export rows into a folder', async () => {
    const x = xcom({
      BookmarkFoldersSlice: () => folders,
      CreateBookmark: () => ({ data: { tweet_bookmark_put: 'Done' } }),
      bookmarkTweetToFolder: () => ({ data: { bookmark_collection_tweet_put: 'Done' } }),
    });
    const result = await run(
      'bookmarksImport',
      { bookmarks: ['1001', { url: 'https://x.com/writer/status/1003' }, 'not a post'], folder: 'Reading', delayMs: 0 },
      { fetch: x.fetch },
    );
    expect(result.unreadable).toBe(1);
    expect(result.results).toEqual([
      { tweetId: '1001', status: 'bookmarked', folder: 'Reading' },
      { tweetId: '1003', status: 'bookmarked', folder: 'Reading' },
    ]);
    expect(x.of('CreateBookmark').map((c) => c.variables.tweet_id)).toEqual(['1001', '1003']);
    expect(used('like')).toBe(2);
    await expect(run('bookmarksImport', { bookmarks: ['nope'] })).rejects.toBeInstanceOf(JobInputError);
  });
});

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

describe('topics', () => {
  const topic = (id, name, following) => ({
    entryId: `topic-${id}`,
    content: { itemContent: { itemType: 'TimelineTopic', topic: { topic_id: id, name, description: `${name} news`, following, not_interested: false } } },
  });

  it('follows and unfollows a topic', async () => {
    const x = xcom({
      TopicFollow: () => ({ data: { topic_follow: 'Done' } }),
      TopicUnfollow: () => ({ data: { topic_unfollow: 'Done' } }),
    });
    expect(await run('topicFollow', { topicId: '848920371311001600' }, { fetch: x.fetch })).toMatchObject({ following: true });
    expect(await run('topicUnfollow', { topicId: '848920371311001600' }, { fetch: x.fetch })).toMatchObject({ following: false });
    expect(x.of('TopicFollow')[0].variables).toEqual({ topicId: '848920371311001600' });
    expect(used('follow')).toBe(1);
    expect(used('unfollow')).toBe(1);
    await expect(run('topicFollow', { topicId: 'crypto' })).rejects.toBeInstanceOf(JobInputError);
  });

  it('fails a follow X refuses', async () => {
    const x = xcom({ TopicFollow: () => ({ errors: [{ message: 'Topic not found' }] }) });
    await expect(run('topicFollow', { topicId: '1' }, { fetch: x.fetch })).rejects.toThrow('Topic not found');
  });

  it('discovers suggested topics filtered by keyword', async () => {
    const x = xcom({
      TopicToFollowSidebar: () => ({
        data: { viewer: { topics_to_follow_sidebar: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [topic('1', 'Cryptocurrency', false), topic('2', 'Gardening', false)] }] } } } },
      }),
    });
    const result = await run('topicDiscover', { keyword: 'crypto' }, { fetch: x.fetch });
    expect(result.suggested).toBe(2);
    expect(result.topics).toEqual([expect.objectContaining({ id: '1', name: 'Cryptocurrency', url: 'https://x.com/i/topics/1' })]);
  });

  it('lists followed topics from the responses the topics page loads', async () => {
    const handlers = new Set();
    const visited = [];
    const page = {
      on: (event, fn) => event === 'response' && handlers.add(fn),
      off: (event, fn) => handlers.delete(fn),
      goto: async (url) => {
        visited.push(url);
        const responses = [
          { url: () => 'https://abs.twimg.com/responsive-web/client-web/main.js', json: async () => ({ topic_id: '9', name: 'Ignored', following: true }) },
          {
            url: () => 'https://x.com/i/api/graphql/abc/ViewingOtherUsersTopicsPage',
            json: async () => ({ data: { user: { result: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [topic('1', 'Cryptocurrency', true), topic('2', 'Gardening', false)] }] } } } } }),
          },
        ];
        for (const response of responses) for (const fn of handlers) fn(response);
      },
      close: async () => {},
    };
    const x = xcom({ '/1.1/account/verify_credentials.json': () => VERIFY });
    const result = await run('topicList', {}, { fetch: x.fetch, browser: async () => ({ createPage: async () => page }) });
    expect(visited).toEqual(['https://x.com/me_account/topics']);
    expect(result.topics.map((t) => t.name)).toEqual(['Cryptocurrency']);
    expect(handlers.size).toBe(0);
  });

  it('fails when the topics page loads no timeline', async () => {
    const page = { on: () => {}, off: () => {}, goto: async () => {}, close: async () => {} };
    const x = xcom({ '/1.1/account/verify_credentials.json': () => VERIFY });
    await expect(
      run('topicList', {}, { fetch: x.fetch, browser: async () => ({ createPage: async () => page }) }),
    ).rejects.toThrow('without the followed-topics timeline');
  });
});

// ---------------------------------------------------------------------------
// Reporting (browser)
// ---------------------------------------------------------------------------

describe('reportSpam', () => {
  /**
   * A stand-in for the Puppeteer page: a profile with a menu, and a report
   * dialog that walks through `steps` ({ choices, buttons }) as buttons are
   * pressed.
   */
  function reportPage({ steps, hasMenu = true }) {
    let stage = 'closed';
    const clicked = [];
    const handle = (text, onClick) => ({
      evaluate: async (fn) => fn({ innerText: text, textContent: text }),
      click: async () => {
        clicked.push(text);
        onClick();
      },
    });
    const page = {
      clicked,
      goto: async () => {
        stage = 'profile';
      },
      waitForSelector: async (selector) => {
        if (selector === '[data-testid="userActions"]' && hasMenu) return handle('menu', () => { stage = 'menu'; });
        throw new Error('Waiting for selector failed: timeout');
      },
      $: async (selector) => (selector === '[role="dialog"]' && typeof stage === 'number' ? {} : null),
      $$: async (selector) => {
        if (selector === '[role="menuitem"]' && stage === 'menu') {
          return [handle('Add/remove from Lists', () => {}), handle('Report @target', () => { stage = 0; })];
        }
        if (typeof stage !== 'number') return [];
        const step = steps[stage];
        if (selector.includes('label')) return step.choices.map((c) => handle(c, () => {}));
        if (selector.includes('button')) {
          return step.buttons.map((b) => handle(b, () => { stage = stage + 1 < steps.length ? stage + 1 : 'closed'; }));
        }
        return [];
      },
      close: async () => {},
    };
    return page;
  }

  it('walks the report dialog, choosing spam answers, and submits', async () => {
    const page = reportPage({
      steps: [
        { choices: ['Hate', 'Spam'], buttons: ['Next'] },
        { choices: ['Fake engagement', 'Scams'], buttons: ['Submit'] },
        { choices: [], buttons: ['Done'] },
      ],
    });
    const result = await run('reportSpam', { usernames: ['target'] }, { browser: async () => ({ createPage: async () => page }) });
    expect(result.results).toEqual([
      { username: 'target', status: 'reported', steps: ['Report @target', 'Spam', 'Next', 'Fake engagement', 'Submit', 'Done'] },
    ]);
    expect(page.clicked).not.toContain('Hate');
    expect(used('block')).toBe(1);
  });

  it('records a profile whose menu never loads', async () => {
    const page = reportPage({ steps: [], hasMenu: false });
    const result = await run('reportSpam', { usernames: ['missing'] }, { browser: async () => ({ createPage: async () => page }) });
    expect(result.results[0]).toMatchObject({ username: 'missing', status: 'failed' });
    expect(result.counts).toEqual({ failed: 1 });
  });

  it('refuses to guess when the flow offers no spam answer', async () => {
    const page = reportPage({ steps: [{ choices: ['Hate', 'Privacy'], buttons: ['Next'] }] });
    const result = await run('reportSpam', { usernames: ['target'] }, { browser: async () => ({ createPage: async () => page }) });
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toMatch(/no spam answer/);
    expect(page.clicked).not.toContain('Next');
  });

  it('caps a report job at 25 accounts', async () => {
    const usernames = Array.from({ length: 26 }, (_, i) => `user${i}`);
    await expect(run('reportSpam', { usernames })).rejects.toThrow('At most 25 usernames');
  });
});
