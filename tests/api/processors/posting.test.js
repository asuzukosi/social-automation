// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the posting processors (api/services/processors/posting.processors.js).
 *
 * Only the network is replaced: X is a fetch that answers the way x.com does,
 * the web (RSS feeds, media) is a second fetch, DNS is a lookup function, and
 * the browser is a page object with the few methods the processors call.
 * Everything between them and the processors is the real code.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJobContext, isPermanentFailure, JobInputError } from '../../../api/services/processors/context.js';
import postingProcessors, {
  XRejectedError,
  createPostingProcessors,
  deleteScheduledPost,
  listScheduledPosts,
  parseFeed,
  renderFeedPost,
} from '../../../api/services/processors/posting.processors.js';
import { TwitterHttpClient } from '../../../src/scrapers/twitter/http/client.js';

// ---------------------------------------------------------------------------
// Network fakes
// ---------------------------------------------------------------------------

const SESSION = 'auth_token=tok; ct0=csrf';
const ME = { id_str: '100', screen_name: 'me', name: 'Me' };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that routes by URL and records every call with its parsed body. */
function fakeNet(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    let body = init.body;
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      body = Object.fromEntries(body.entries());
    } else if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = Object.fromEntries(new URLSearchParams(body));
      }
    }
    const query = u.includes('?') ? Object.fromEntries(new URL(u).searchParams) : {};
    const variables = body?.variables ?? (query.variables ? JSON.parse(query.variables) : undefined);
    const call = { url: u, method: init.method || 'GET', body, variables };
    calls.push(call);
    for (const [match, respond] of routes) {
      if (typeof match === 'string' ? u.includes(match) : match.test(u)) {
        const out = await respond(call, calls);
        return out instanceof Response ? out : json(out);
      }
    }
    return new Response('no route', { status: 404 });
  };
  return { fetch, calls, named: (op) => calls.filter((c) => new RegExp(`/${op}(\\?|$)`).test(c.url)) };
}

const publicDns = async (host) => (host.endsWith('.internal') ? [{ address: '10.0.0.7' }] : [{ address: '93.184.216.34' }]);

const user = (id, handle) => ({ __typename: 'User', rest_id: id, core: { screen_name: handle, name: handle }, legacy: {} });

function tweet(id, { text = `post ${id}`, authorId = '100', handle = 'me', createdAt = '2025-01-01T12:00:00.000Z', likes = 0, views, retweetOf, article } = {}) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: user(authorId, handle) } },
    ...(views !== undefined ? { views: { count: String(views) } } : {}),
    ...(article ? { article: { article_results: { result: article } } } : {}),
    legacy: {
      id_str: id,
      full_text: text,
      created_at: createdAt,
      favorite_count: likes,
      retweet_count: 1,
      reply_count: 2,
      quote_count: 0,
      bookmark_count: 3,
      ...(retweetOf ? { retweeted_status_result: { result: retweetOf } } : {}),
    },
  };
}

/** A user-timeline response in the shape x.com sends. */
function timeline(tweets, root = 'user') {
  const entries = tweets.map((t) => ({ entryId: `tweet-${t.rest_id}`, content: { itemContent: { tweet_results: { result: t } } } }));
  const instructions = [{ type: 'TimelineAddEntries', entries }];
  if (root === 'bookmarks') return { data: { bookmark_timeline_v2: { timeline: { instructions } } } };
  return { data: { user: { result: { timeline: { timeline: { instructions } } } } } };
}

const created = (id, handle = 'me') => ({
  data: { create_tweet: { tweet_results: { result: { rest_id: id, core: { user_results: { result: user('100', handle) } }, legacy: { id_str: id } } } } },
});

// ---------------------------------------------------------------------------
// Job harness
// ---------------------------------------------------------------------------

function ledger({ capAfter = Infinity } = {}) {
  const charges = [];
  return {
    charges,
    checkAndRecord(account, actionClass, { count }) {
      if (charges.length >= capAfter) {
        throw Object.assign(new Error(`Daily cap reached for "${actionClass}"`), {
          name: 'ActionCapExceededError',
          resetAt: new Date('2030-01-01T00:00:00Z'),
        });
      }
      charges.push([account, actionClass, count]);
    },
  };
}

/**
 * Run one processor as the queue would.
 * @returns {Promise<{ result?: object, error?: Error, progress: object[] }>}
 */
async function runJob(type, config, { x, web, caps = ledger(), browser, procs, userId } = {}) {
  const progress = [];
  const job = {
    id: `op-${type}`,
    name: type,
    data: { type, id: `op-${type}`, userId, sessionHash: userId ? undefined : 'hash1', config: { sessionCookie: SESSION, ...config } },
    progress: (p) => progress.push(p),
  };
  const ctx = createJobContext(job, { fetch: x?.fetch, caps, browser: browser ? async () => ({ createPage: async () => browser }) : undefined });
  const processors = procs ?? createPostingProcessors({ fetch: web?.fetch, lookup: publicDns, minDelayMs: 1 });
  try {
    return { result: await processors[type].run(ctx), progress, caps };
  } catch (error) {
    return { error, progress, caps };
  } finally {
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe('posting processor map', () => {
  it('defines every posting job type with a runner', () => {
    const types = [
      'postTweet', 'postThread', 'createPoll', 'deleteTweet', 'scheduleTweet', 'schedulePost', 'replyTweet',
      'publishArticle', 'clearBookmarks', 'articleCompose', 'articlePublish', 'articleAnalytics', 'articleList',
      'articleDraft', 'scheduleAdd', 'rssAdd', 'rssCheck', 'cleanupDeleteTweets', 'cleanupUnlikeAll',
      'cleanupClearReposts', 'cleanupClearHistory', 'cleanupBulkDelete', 'cleanupArchive',
    ];
    expect(Object.keys(postingProcessors).sort()).toEqual([...types].sort());
    for (const type of types) expect(typeof postingProcessors[type].run).toBe('function');
    expect(postingProcessors.postTweet.write).toBe(true);
    expect(postingProcessors.articleList.write).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

describe('postTweet', () => {
  it('publishes a post and returns its id and URL', async () => {
    const x = fakeNet([[/\/CreateTweet$/, () => created('555')]]);
    const { result, caps } = await runJob('postTweet', { text: 'hello world' }, { x });
    expect(result).toMatchObject({ success: true, tweetId: '555', url: 'https://x.com/me/status/555', replyTo: null });
    expect(x.named('CreateTweet')[0].variables.tweet_text).toBe('hello world');
    expect(caps.charges).toEqual([['session:hash1', 'post', 1]]);
  });

  it('honours the dashboard replyTo and quoteTweetId fields and charges a reply', async () => {
    const x = fakeNet([[/\/CreateTweet$/, () => created('556')]]);
    const { result, caps } = await runJob('postTweet', { text: 'yes', replyTo: 'https://x.com/a/status/42', quoteTweetId: '43' }, { x });
    const vars = x.named('CreateTweet')[0].variables;
    expect(vars.reply.in_reply_to_tweet_id).toBe('42');
    expect(vars.attachment_url).toBe('https://x.com/i/web/status/43');
    expect(result.replyTo).toBe('42');
    expect(caps.charges[0][1]).toBe('reply');
  });

  it('downloads media URLs, uploads them to X and attaches the ids', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const web = fakeNet([['cdn.example.com/cat.png', () => new Response(png, { headers: { 'content-type': 'image/png' } })]]);
    const x = fakeNet([
      ['upload.x.com', (call) => (call.body.command === 'APPEND' ? new Response(null, { status: 204 }) : { media_id_string: 'm1' })],
      [/\/CreateTweet$/, () => created('557')],
    ]);
    const { result } = await runJob('postTweet', { text: 'cat', mediaUrls: ['https://cdn.example.com/cat.png'] }, { x, web });
    expect(result.mediaIds).toEqual(['m1']);
    const commands = x.calls.filter((c) => c.url.includes('upload.x.com')).map((c) => c.body.command);
    expect(commands).toEqual(['INIT', 'APPEND', 'FINALIZE']);
    expect(Buffer.from(await x.calls[1].body.media.arrayBuffer()).equals(png)).toBe(true);
    expect(x.named('CreateTweet')[0].variables.media.media_entities).toEqual([{ media_id: 'm1', tagged_users: [] }]);
  });

  it('refuses media on a private address without calling X', async () => {
    const x = fakeNet([]);
    const { error } = await runJob('postTweet', { text: 'x', mediaUrls: ['http://metadata.internal/latest'] }, { x, web: fakeNet([]) });
    expect(error).toBeInstanceOf(JobInputError);
    expect(error.message).toMatch(/not a public address/);
    expect(x.calls).toHaveLength(0);
  });

  it('fails permanently when X refuses the post', async () => {
    const x = fakeNet([[/\/CreateTweet$/, () => ({ errors: [{ code: 187, message: 'Status is a duplicate.' }] })]]);
    const { error } = await runJob('postTweet', { text: 'again' }, { x });
    expect(error).toBeInstanceOf(XRejectedError);
    expect(error.message).toMatch(/duplicate/);
    expect(isPermanentFailure(error)).toBe(true);
  });

  it('rejects missing text and a malformed reply target', async () => {
    expect((await runJob('postTweet', { text: '' })).error).toBeInstanceOf(JobInputError);
    const { error } = await runJob('postTweet', { text: 'hi', replyToTweetId: 'not-a-post' });
    expect(error.message).toMatch(/replyTo must be a post id/);
  });

  it('explains a missing session', async () => {
    const job = { id: 'j', name: 'postTweet', data: { type: 'postTweet', config: { text: 'hi' } } };
    const ctx = createJobContext(job, { caps: ledger() });
    const error = await postingProcessors.postTweet.run(ctx).catch((e) => e);
    expect(error.code).toBe('NO_SESSION');
  });
});

describe('replyTweet', () => {
  it('replies to the given post', async () => {
    const x = fakeNet([[/\/CreateTweet$/, () => created('600')]]);
    const { result } = await runJob('replyTweet', { text: 'agreed', tweetId: '599' }, { x });
    expect(result).toMatchObject({ tweetId: '600', inReplyTo: '599' });
    expect(x.named('CreateTweet')[0].variables.reply.in_reply_to_tweet_id).toBe('599');
  });
});

describe('postThread', () => {
  it('chains each post as a reply to the previous one', async () => {
    let n = 700;
    const x = fakeNet([[/\/CreateTweet$/, () => created(String(++n))]]);
    const { result, caps } = await runJob('postThread', { tweets: ['one', { text: 'two' }, 'three'], delayMs: 1 }, { x });
    expect(result).toMatchObject({ success: true, threadId: '701', count: 3 });
    expect(result.tweets.map((t) => t.tweetId)).toEqual(['701', '702', '703']);
    const replies = x.named('CreateTweet').map((c) => c.variables.reply?.in_reply_to_tweet_id ?? null);
    expect(replies).toEqual([null, '701', '702']);
    expect(caps.charges).toEqual([['session:hash1', 'post', 3]]);
  });

  it('stops without retrying once part of the thread is live', async () => {
    let n = 0;
    const x = fakeNet([[/\/CreateTweet$/, () => (++n === 2 ? { errors: [{ code: 186, message: 'Tweet needs to be a bit shorter.' }] } : created('801'))]]);
    const { error } = await runJob('postThread', { tweets: ['a', 'b', 'c'], delayMs: 1 }, { x });
    expect(error.message).toMatch(/stopped at post 2 of 3.*Already published: 801/);
    expect(isPermanentFailure(error)).toBe(true);
  });

  it('rejects a one-post thread', async () => {
    expect((await runJob('postThread', { tweets: ['solo'] })).error).toBeInstanceOf(JobInputError);
  });
});

describe('createPoll', () => {
  it('creates the poll card, then the post carrying it', async () => {
    const x = fakeNet([
      ['caps.x.com/v2/cards/create.json', () => ({ card_uri: 'card://1' })],
      [/\/CreateTweet$/, () => created('900')],
    ]);
    const { result } = await runJob('createPoll', { question: 'Best?', options: ['A', 'B', 'C'], durationMinutes: 60 }, { x });
    const card = JSON.parse(x.calls[0].body.card_data);
    expect(card['twitter:card']).toBe('poll3choice_text_only');
    expect(card['twitter:long:duration_minutes']).toBe(60);
    expect(card['twitter:string:choice3_label']).toBe('C');
    expect(x.named('CreateTweet')[0].variables).toMatchObject({ tweet_text: 'Best?', card_uri: 'card://1' });
    expect(result).toMatchObject({ tweetId: '900', options: ['A', 'B', 'C'], durationMinutes: 60, cardUri: 'card://1' });
  });

  it('clamps the duration to what X allows', async () => {
    const x = fakeNet([['caps.x.com', () => ({ card_uri: 'card://2' })], [/\/CreateTweet$/, () => created('901')]]);
    const { result } = await runJob('createPoll', { question: 'Q', options: ['A', 'B'], durationMinutes: 99999 }, { x });
    expect(result.durationMinutes).toBe(10080);
  });

  it('rejects too many options and over-long labels', async () => {
    expect((await runJob('createPoll', { question: 'Q', options: ['1', '2', '3', '4', '5'] })).error.message).toMatch(/2 to 4/);
    expect((await runJob('createPoll', { question: 'Q', options: ['ok', 'x'.repeat(26)] })).error.message).toMatch(/options\[1\]/);
  });

  it('reports a refused card', async () => {
    const x = fakeNet([['caps.x.com', () => ({ errors: [{ code: 32, message: 'Could not authenticate you.' }] })]]);
    const { error } = await runJob('createPoll', { question: 'Q', options: ['A', 'B'] }, { x });
    expect(error.message).toMatch(/poll card: Could not authenticate/);
  });
});

describe('deleteTweet', () => {
  it('deletes the post', async () => {
    const x = fakeNet([[/\/DeleteTweet$/, () => ({ data: { delete_tweet: { tweet_results: {} } } })]]);
    const { result, caps } = await runJob('deleteTweet', { tweetId: '123' }, { x });
    expect(result).toMatchObject({ success: true, tweetId: '123', deleted: true });
    expect(x.named('DeleteTweet')[0].variables.tweet_id).toBe('123');
    expect(caps.charges[0][1]).toBe('delete');
  });

  it('surfaces X saying the post does not exist', async () => {
    const x = fakeNet([[/\/DeleteTweet$/, () => ({ errors: [{ code: 144, message: 'No status found with that ID.' }] })]]);
    const { error } = await runJob('deleteTweet', { tweetId: '124' }, { x });
    expect(error).toBeInstanceOf(XRejectedError);
    expect(error.message).toMatch(/No status found/);
  });
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

describe('scheduled posts', () => {
  const inAnHour = () => new Date(Date.now() + 3_600_000);

  it('hands the post to X\'s scheduler with the time in epoch seconds', async () => {
    const x = fakeNet([[/\/CreateScheduledTweet$/, () => ({ data: { tweet: { rest_id: 's1' } } })]]);
    const at = inAnHour();
    const { result } = await runJob('scheduleTweet', { text: 'later', scheduledAt: at.toISOString(), timezone: 'Europe/Paris' }, { x });
    const vars = x.named('CreateScheduledTweet')[0].variables;
    expect(vars.execute_at).toBe(Math.floor(at.getTime() / 1000));
    expect(vars.post_tweet_request.status).toBe('later');
    expect(result).toMatchObject({ scheduledTweetId: 's1', scheduledAt: at.toISOString(), timezone: 'Europe/Paris', publishedBy: 'x' });
  });

  it('schedules the dashboard schedulePost the same way', async () => {
    const x = fakeNet([[/\/CreateScheduledTweet$/, () => ({ data: { tweet: { rest_id: 's2' } } })]]);
    const { result } = await runJob('schedulePost', { text: 'x', scheduledAt: inAnHour().toISOString() }, { x });
    expect(result.scheduledTweetId).toBe('s2');
  });

  it('schedules a cron expression at its next run in the given zone', async () => {
    const x = fakeNet([[/\/CreateScheduledTweet$/, () => ({ data: { tweet: { rest_id: 's3' } } })]]);
    const { result } = await runJob('scheduleAdd', { text: 'weekly', cron: '0 9 * * 1', timezone: 'America/New_York' }, { x });
    const when = new Date(result.scheduledAt);
    const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).format(when);
    expect(local).toBe('Mon, 09');
    expect(when.getTime()).toBeGreaterThan(Date.now());
    expect(result.cron).toBe('0 9 * * 1');
  });

  it('refuses past times, bad zones, bad cron and recurring requests before calling X', async () => {
    const x = fakeNet([]);
    expect((await runJob('scheduleTweet', { text: 'x', scheduledAt: '2020-01-01T00:00:00Z' }, { x })).error.message).toMatch(/future/);
    expect((await runJob('scheduleTweet', { text: 'x', scheduledAt: inAnHour().toISOString(), timezone: 'Mars/Base' }, { x })).error.message).toMatch(/time zone/);
    expect((await runJob('scheduleAdd', { text: 'x', cron: 'not cron' }, { x })).error.message).toMatch(/Invalid cron/);
    expect((await runJob('scheduleAdd', { text: 'x', cron: '* * * * *', repeat: true }, { x })).error).toBeInstanceOf(JobInputError);
    expect(x.calls).toHaveLength(0);
  });

  it('lists and cancels scheduled posts through X', async () => {
    const x = fakeNet([
      [/\/FetchScheduledTweets\?/, () => ({
        data: { viewer: { scheduled_tweet_list: [
          { rest_id: 's1', scheduling_info: { execute_at: 1893456000000, state: 'Scheduled' }, tweet_create_request: { status: 'hello', media_ids: [] } },
        ] } },
      })],
      [/\/DeleteScheduledTweet$/, () => ({ data: { scheduledtweet_delete: 'Done' } })],
    ]);
    const client = new TwitterHttpClient({ cookies: SESSION, fetch: x.fetch });
    await expect(listScheduledPosts(client)).resolves.toEqual([
      { scheduleId: 's1', text: 'hello', scheduledAt: '2030-01-01T00:00:00.000Z', state: 'Scheduled', mediaIds: [] },
    ]);
    await expect(deleteScheduledPost(client, 's1')).resolves.toEqual({ scheduleId: 's1', removed: true });
    expect(x.named('DeleteScheduledTweet')[0].variables).toEqual({ scheduled_tweet_id: 's1' });
  });
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

describe('clearBookmarks', () => {
  it('counts bookmarks on a dry run without clearing them', async () => {
    const x = fakeNet([[/\/Bookmarks\?/, () => timeline([tweet('1', { authorId: '9', handle: 'a' }), tweet('2', { authorId: '9', handle: 'a' })], 'bookmarks')]]);
    const { result } = await runJob('clearBookmarks', { dryRun: true }, { x });
    expect(result).toMatchObject({ dryRun: true, count: 2, countIsLowerBound: false });
    expect(result.bookmarks[0]).toMatchObject({ id: '1', author: 'a', status: 'would-remove' });
    expect(x.named('BookmarksAllDelete')).toHaveLength(0);
  });

  it('clears every bookmark and checks none remain', async () => {
    const x = fakeNet([
      [/\/BookmarksAllDelete$/, () => ({ data: { bookmark_all_delete: 'Done' } })],
      [/\/Bookmarks\?/, () => timeline([], 'bookmarks')],
    ]);
    const { result, caps } = await runJob('clearBookmarks', {}, { x });
    expect(result).toMatchObject({ dryRun: false, cleared: true, remaining: 0 });
    expect(caps.charges[0][1]).toBe('delete');
  });
});

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

/** A page that behaves like the X Articles editor for the calls writeArticle makes. */
function articleEditor({ offersEditor = true, confirmsPublish = true } = {}) {
  const state = { url: '', focus: null, fields: { title: '', body: '' }, clicks: [], dialog: false };
  const onEdit = () => state.url.includes('/compose/articles/edit/');
  const element = (name) => ({
    click: async () => {
      state.clicks.push(name);
      if (name === 'title' || name === 'body') state.focus = name;
      if (name === 'create') state.url = 'https://x.com/compose/articles/edit/1790000000000000001';
      if (name === 'publish') state.dialog = true;
      if (name === 'confirm' && confirmsPublish) state.url = 'https://x.com/me/article/1790000000000000001';
    },
    evaluate: async (fn) => fn({ getAttribute: () => null, textContent: '' }),
  });
  const selectors = {
    '[data-testid="articleTitle"]': () => onEdit() && element('title'),
    '[data-testid="articleBody"]': () => onEdit() && element('body'),
    '[data-testid="empty_state_button_text"]': () => offersEditor && !onEdit() && element('create'),
    '[data-testid="articlePublish"]': () => onEdit() && element('publish'),
    '[data-testid="articleSaveDraft"]': () => onEdit() && element('save'),
    '[data-testid="confirmationSheetConfirm"]': () => state.dialog && element('confirm'),
  };
  const page = {
    goto: async (url) => {
      state.url = url;
    },
    url: () => state.url,
    $: async (selector) => selectors[selector]?.() || null,
    $$: async () => [],
    keyboard: {
      down: async () => {},
      up: async () => {},
      press: async (key) => {
        if (key === 'Backspace') state.fields[state.focus] = '';
        if (key === 'Enter') state.fields[state.focus] += '\n';
      },
      sendCharacter: async (text) => {
        state.fields[state.focus] += text;
      },
    },
    close: async () => {},
  };
  return { page, state };
}

describe('articles in the browser editor', () => {
  it('writes a new article and saves it as a draft', async () => {
    const { page, state } = articleEditor();
    const { result, caps } = await runJob('publishArticle', { title: 'My piece', body: 'First para.\nSecond para.', publish: false }, { browser: page });
    expect(result).toMatchObject({ success: true, articleId: '1790000000000000001', status: 'draft', wordCount: 4 });
    expect(state.fields).toEqual({ title: 'My piece', body: 'First para.\nSecond para.' });
    expect(state.clicks).toContain('save');
    expect(caps.charges).toEqual([]);
  });

  it('publishes an article and returns where it landed', async () => {
    const { page, state } = articleEditor();
    const { result, caps } = await runJob('articlePublish', { title: 'Launch', content: 'Body text' }, { browser: page });
    expect(result).toMatchObject({ status: 'published', articleId: '1790000000000000001', url: 'https://x.com/me/article/1790000000000000001' });
    expect(state.clicks).toEqual(expect.arrayContaining(['publish', 'confirm']));
    expect(caps.charges[0][1]).toBe('post');
  });

  it('composes and drafts through the articles routes', async () => {
    for (const type of ['articleCompose', 'articleDraft']) {
      const { page } = articleEditor();
      const { result } = await runJob(type, { title: 'T', content: 'C' }, { browser: page });
      expect(result.status).toBe('draft');
    }
  });

  it('fails clearly when the account has no Articles editor', async () => {
    const { page } = articleEditor({ offersEditor: false });
    const { error } = await runJob('articleDraft', { title: 'T', content: 'C' }, { browser: page });
    expect(error).toBeInstanceOf(XRejectedError);
    expect(error.message).toMatch(/Premium\+/);
  });

  it('rejects a new article without a title before opening a browser', async () => {
    const { error } = await runJob('articleCompose', { content: 'C' });
    expect(error.message).toBe('title is required');
  });
});

describe('articleList and articleAnalytics', () => {
  const articles = () => timeline([
    tweet('11', { views: 1000, likes: 50, article: { rest_id: 'a1', title: 'First', preview_text: 'p1' } }),
    tweet('12', { views: 200, likes: 4, article: { rest_id: 'a2', title: 'Second', preview_text: 'p2' } }),
  ]);
  const net = () => fakeNet([['verify_credentials.json', () => ME], [/\/UserArticlesTweets\?/, articles]]);

  it('lists the account\'s articles with metrics', async () => {
    const x = net();
    const { result } = await runJob('articleList', {}, { x });
    expect(result).toMatchObject({ account: 'me', count: 2 });
    expect(result.articles[0]).toMatchObject({ articleId: 'a1', tweetId: '11', title: 'First', url: 'https://x.com/i/article/a1' });
    expect(x.named('UserArticlesTweets')[0].variables.userId).toBe('100');
  });

  it('totals views and engagement, and ranks the top article', async () => {
    const { result } = await runJob('articleAnalytics', {}, { x: net() });
    expect(result.totals).toMatchObject({ views: 1200, likes: 54, reposts: 2, replies: 4, bookmarks: 6 });
    expect(result.top.articleId).toBe('a1');
    expect(result.top.engagementRate).toBe(5.6);
    const one = await runJob('articleAnalytics', { articleId: 'a2' }, { x: net() });
    expect(one.result.count).toBe(1);
  });

  it('treats an empty Articles tab as an error, not zero', async () => {
    const x = fakeNet([['verify_credentials.json', () => ME], [/\/UserArticlesTweets\?/, () => timeline([])]]);
    const { error } = await runJob('articleList', {}, { x });
    expect(error.message).toMatch(/no published articles for @me/);
  });
});

// ---------------------------------------------------------------------------
// RSS
// ---------------------------------------------------------------------------

describe('RSS feeds', () => {
  let home;
  const previousHome = process.env.XACTIONS_HOME;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-rss-'));
    process.env.XACTIONS_HOME = home;
  });
  afterAll(() => {
    if (previousHome === undefined) delete process.env.XACTIONS_HOME;
    else process.env.XACTIONS_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const rss = (items) => `<?xml version="1.0"?><rss><channel><title>Dev Blog</title>${items
    .map((i) => `<item><title><![CDATA[${i.title}]]></title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${i.date}</pubDate></item>`)
    .join('')}</channel></rss>`;
  const first = [
    { title: 'Old one &amp; only', link: 'https://blog.example.com/1', date: 'Mon, 01 Jan 2024 00:00:00 GMT' },
    { title: 'Older', link: 'https://blog.example.com/0', date: 'Sun, 31 Dec 2023 00:00:00 GMT' },
  ];

  it('parses RSS and Atom and fits a post into 280 characters', () => {
    const parsed = parseFeed(rss(first));
    expect(parsed.title).toBe('Dev Blog');
    expect(parsed.items[0]).toMatchObject({ title: 'Old one & only', link: 'https://blog.example.com/1', key: 'https://blog.example.com/1' });
    const atom = parseFeed('<feed><title>A</title><entry><title>E</title><link rel="alternate" href="https://a.example/e"/><id>urn:1</id></entry></feed>');
    expect(atom.items[0]).toMatchObject({ title: 'E', link: 'https://a.example/e', key: 'urn:1' });
    const text = renderFeedPost('{{title}} {{url}}', { title: 'x'.repeat(400), link: 'https://a.example/e' });
    expect(text.length).toBeLessThanOrEqual(280);
    expect(text.endsWith('... https://a.example/e')).toBe(true);
  });

  it('saves a feed without posting its backlog, then posts only new items', async () => {
    let items = first;
    const web = fakeNet([['blog.example.com/feed', () => new Response(rss(items), { headers: { 'content-type': 'application/rss+xml' } })]]);
    const x = fakeNet([[/\/CreateTweet$/, () => created('1001')]]);

    const added = await runJob('rssAdd', { url: 'https://blog.example.com/feed', postTemplate: 'New: {{title}} {{url}}', maxPerDay: 3 }, { x, web });
    expect(added.result).toMatchObject({ feedId: 'op-rssAdd', title: 'Dev Blog', itemCount: 2, maxPerDay: 3 });
    expect(added.result.drafts[0].text).toBe('New: Old one & only https://blog.example.com/1');
    expect(x.calls).toHaveLength(0);

    items = [{ title: 'Fresh', link: 'https://blog.example.com/2', date: 'Tue, 02 Jan 2024 00:00:00 GMT' }, ...first];
    const checked = await runJob('rssCheck', { feedId: 'op-rssAdd' }, { x, web });
    expect(checked.result).toMatchObject({ saved: true, newItems: 1, remainingToday: 2 });
    expect(checked.result.posted).toEqual([{ title: 'Fresh', link: 'https://blog.example.com/2', tweetId: '1001', url: 'https://x.com/me/status/1001' }]);
    expect(x.named('CreateTweet')[0].variables.tweet_text).toBe('New: Fresh https://blog.example.com/2');

    const again = await runJob('rssCheck', { url: 'https://blog.example.com/feed' }, { x, web });
    expect(again.result.newItems).toBe(0);
    expect(x.named('CreateTweet')).toHaveLength(1);

    const stored = JSON.parse(fs.readFileSync(path.join(home, 'api-rss-feeds.json'), 'utf8'));
    expect(Object.keys(stored.owners)).toEqual(['session:hash1']);
    expect(stored.owners['session:hash1']['op-rssAdd'].seen).toContain('https://blog.example.com/2');
  });

  it('keeps feeds per caller and reads unsaved URLs without posting', async () => {
    const web = fakeNet([['news.example.com', () => new Response(rss(first))]]);
    const x = fakeNet([]);
    const { result } = await runJob('rssCheck', { url: 'https://news.example.com/rss' }, { x, web });
    expect(result).toMatchObject({ saved: false, itemCount: 2, posted: [] });
    expect(x.calls).toHaveLength(0);
    const other = await runJob('rssCheck', { feedId: 'op-rssAdd' }, { x, web, userId: 'someone-else' });
    expect(other.error.message).toMatch(/No saved feed op-rssAdd/);
  });

  it('refuses private URLs, redirects into the private network, and non-feeds', async () => {
    const web = fakeNet([
      ['hop.example.com', () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:6379/' } })],
      ['page.example.com', () => new Response('<html><body>hi</body></html>')],
    ]);
    expect((await runJob('rssAdd', { url: 'http://router.internal/feed' }, { web })).error.message).toMatch(/not a public address/);
    expect((await runJob('rssAdd', { url: 'https://hop.example.com/feed' }, { web })).error.message).toMatch(/127\.0\.0\.1 is not a public address/);
    expect((await runJob('rssAdd', { url: 'https://page.example.com/' }, { web })).error.message).toMatch(/no RSS or Atom items/);
    expect((await runJob('rssAdd', { url: 'file:///etc/passwd' }, { web })).error).toBeInstanceOf(JobInputError);
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('cleanup', () => {
  const OLD = '2023-06-01T00:00:00.000Z';
  const NEW = '2025-06-01T00:00:00.000Z';
  const ownTimeline = () => timeline([
    tweet('1', { createdAt: NEW, text: 'recent post' }),
    tweet('2', { createdAt: OLD, text: 'old post about cats' }),
    tweet('3', { createdAt: OLD, text: 'old popular post', likes: 900 }),
    tweet('4', { createdAt: OLD, retweetOf: tweet('77', { authorId: '9', handle: 'friend' }) }),
    tweet('5', { createdAt: OLD, authorId: '9', handle: 'friend', text: 'someone else in the thread' }),
  ]);

  it('deletes the account\'s own posts older than beforeDate, sparing popular ones', async () => {
    const x = fakeNet([
      ['verify_credentials.json', () => ME],
      [/\/UserTweetsAndReplies\?/, ownTimeline],
      [/\/DeleteTweet$/, () => ({ data: { delete_tweet: {} } })],
    ]);
    const { result, caps } = await runJob('cleanupDeleteTweets', { beforeDate: '2024-01-01', maxLikes: 100, delayMs: 1 }, { x });
    expect(result).toMatchObject({ scanned: 4, matched: 1, deleted: 1, failed: 0, stopped: null });
    expect(result.items).toEqual([expect.objectContaining({ id: '2', status: 'deleted' })]);
    expect(x.named('DeleteTweet').map((c) => c.variables.tweet_id)).toEqual(['2']);
    expect(caps.charges).toEqual([['session:hash1', 'delete', 1]]);
  });

  it('previews on a dry run and can include reposts', async () => {
    const x = fakeNet([['verify_credentials.json', () => ME], [/\/UserTweetsAndReplies\?/, ownTimeline]]);
    const { result } = await runJob('cleanupDeleteTweets', { beforeDate: '2024-01-01', includeRetweets: true, dryRun: true }, { x });
    expect(result.items.map((i) => [i.id, i.status])).toEqual([['2', 'would-delete'], ['3', 'would-delete'], ['4', 'would-delete']]);
    expect(x.named('DeleteTweet')).toHaveLength(0);
  });

  it('bulk-deletes by id, records a failure and carries on', async () => {
    const x = fakeNet([
      [/\/DeleteTweet$/, (call) => (call.variables.tweet_id === '21' ? { errors: [{ code: 144, message: 'No status found with that ID.' }] } : { data: {} })],
    ]);
    const { result } = await runJob('cleanupBulkDelete', { tweetIds: ['20', 'https://x.com/me/status/21', '22'], delayMs: 1 }, { x });
    expect(result).toMatchObject({ matched: 3, deleted: 2, failed: 1 });
    expect(result.items[1]).toMatchObject({ id: '21', status: 'failed' });
    expect(result.items[1].error).toMatch(/No status found/);
  });

  it('stops at the daily cap and reports what was done', async () => {
    const x = fakeNet([[/\/DeleteTweet$/, () => ({ data: {} })]]);
    const { result } = await runJob('cleanupBulkDelete', { tweetIds: ['30', '31', '32'], delayMs: 1 }, { x, caps: ledger({ capAfter: 2 }) });
    expect(result).toMatchObject({ deleted: 2, stopped: { reason: 'daily-cap', actionClass: 'delete', resetAt: '2030-01-01T00:00:00.000Z' } });
  });

  it('unlikes every liked post', async () => {
    const x = fakeNet([
      ['verify_credentials.json', () => ME],
      [/\/Likes\?/, () => timeline([tweet('41', { authorId: '9', handle: 'a' }), tweet('42', { authorId: '8', handle: 'b' })])],
      [/\/UnfavoriteTweet$/, () => ({ data: { unfavorite_tweet: 'Done' } })],
    ]);
    const { result, caps } = await runJob('cleanupUnlikeAll', { delayMs: 1 }, { x });
    expect(result).toMatchObject({ scanned: 2, unliked: 2, failed: 0 });
    expect(x.named('UnfavoriteTweet').map((c) => c.variables.tweet_id)).toEqual(['41', '42']);
    expect(caps.charges.map((c) => c[1])).toEqual(['like', 'like']);
  });

  it('undoes reposts using the original post id', async () => {
    const x = fakeNet([
      ['verify_credentials.json', () => ME],
      [/\/UserTweets\?/, ownTimeline],
      [/\/DeleteRetweet$/, () => ({ data: { unretweet: {} } })],
    ]);
    const { result } = await runJob('cleanupClearReposts', { delayMs: 1 }, { x });
    expect(result).toMatchObject({ reposts: 1, removed: 1 });
    expect(x.named('DeleteRetweet')[0].variables.source_tweet_id).toBe('77');
  });

  it('archives the account\'s posts and can delete them afterwards', async () => {
    const x = fakeNet([
      ['verify_credentials.json', () => ME],
      [/\/UserTweetsAndReplies\?/, ownTimeline],
      [/\/DeleteTweet$/, () => ({ data: {} })],
      [/\/DeleteRetweet$/, () => ({ data: {} })],
    ]);
    const archived = await runJob('cleanupArchive', {}, { x });
    expect(archived.result.archive).toMatchObject({ account: { id: '100', username: 'me' }, count: 4 });
    expect(archived.result.archive.tweets.map((t) => t.id)).toEqual(['1', '2', '3', '4']);
    expect(x.named('DeleteTweet')).toHaveLength(0);

    const purged = await runJob('cleanupArchive', { deleteAfter: true, delayMs: 1 }, { x });
    expect(purged.result).toMatchObject({ deleted: 4, failed: 0 });
    expect(x.named('DeleteRetweet')[0].variables.source_tweet_id).toBe('77');
  });

  it('fails the job when the session is dead', async () => {
    const x = fakeNet([['verify_credentials.json', () => new Response('{}', { status: 401 })]]);
    const { error } = await runJob('cleanupUnlikeAll', {}, { x });
    expect(error.name).toBe('AuthError');
    expect(isPermanentFailure(error)).toBe(true);
  });
});

describe('cleanupClearHistory', () => {
  function searchPage({ recent = 3, offersClear = true } = {}) {
    const state = { recent, clicks: [], dialog: false };
    const el = (name, text = '') => ({
      click: async () => {
        state.clicks.push(name);
        if (name === 'clear') state.dialog = true;
        if (name === 'confirm') state.recent = 0;
      },
      evaluate: async (fn) => fn({ getAttribute: () => null, textContent: text }),
    });
    const page = {
      goto: async () => {},
      url: () => 'https://x.com/explore',
      $: async (sel) => {
        if (sel === '[data-testid="SearchBox_Search_Input"]') return el('search');
        if (sel === '[data-testid="confirmationSheetConfirm"]' && state.dialog) return el('confirm');
        return null;
      },
      $$: async (sel) => {
        if (sel.includes('typeaheadRecentSearchesItem')) return Array.from({ length: state.recent }, () => el('item'));
        return offersClear && state.recent ? [el('other', 'Search'), el('clear', 'Clear all')] : [];
      },
      close: async () => {},
    };
    return { page, state };
  }

  it('clears recent searches and verifies the list is empty', async () => {
    const { page, state } = searchPage();
    const { result } = await runJob('cleanupClearHistory', {}, { browser: page });
    expect(result).toMatchObject({ cleared: true, removed: 3, remaining: 0 });
    expect(state.clicks).toEqual(expect.arrayContaining(['clear', 'confirm']));
  });

  it('reports an account with no recent searches', async () => {
    const { page } = searchPage({ recent: 0 });
    const { result } = await runJob('cleanupClearHistory', {}, { browser: page });
    expect(result).toMatchObject({ cleared: true, removed: 0 });
  });

  it('fails when X lists searches but offers no way to clear them', async () => {
    const { page } = searchPage({ offersClear: false });
    const { error } = await runJob('cleanupClearHistory', {}, { browser: page });
    expect(error).toBeInstanceOf(XRejectedError);
  });
});
