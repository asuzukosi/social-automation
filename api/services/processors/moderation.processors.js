// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Moderation processors: blocking, muting, removing followers, reporting,
 * shadowban checks, reply restrictions, lists, bookmarks and topics.
 *
 * Everything that X's web client does over its internal API runs here over
 * the same API through the job's logged-in HTTP client (ctx.http()): the
 * GraphQL operations and v1.1 REST paths are the ones x.com itself calls, with
 * query IDs and feature switches resolved from x.com's bundles
 * (src/scrapers/twitter/http/endpoints.js). Two operations have no endpoint a
 * session can call directly and drive a browser page instead: reporting an
 * account (X's report flow is an interactive dialog) and listing followed
 * topics (read from the responses the topics page loads).
 *
 * Bulk writes are charged against the account's daily caps before each
 * action, keep a jittered human delay between actions, honour dryRun, and
 * return a per-item outcome list. A dead session, a cap or a rate limit stops
 * a batch: with nothing done yet the job fails, otherwise it returns what it
 * did and marks the rest skipped.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JobInputError } from './context.js';
import { REST, resolveGraphQL, operationFeatures } from '../../../src/scrapers/twitter/http/endpoints.js';
import { NotFoundError, RateLimitError, TwitterApiError } from '../../../src/scrapers/twitter/http/errors.js';
import { findInstructions, flattenEntries } from '../../../src/scrapers/twitter/http/paging.js';
import { parseUserData } from '../../../src/scrapers/twitter/http/parse/user.js';
import { parseTimelineInstructions } from '../../../src/scrapers/twitter/http/parse/tweet.js';
import { scrapeProfile } from '../../../src/scrapers/twitter/http/profile.js';
import { scrapeTweets, scrapeTweetsAndReplies } from '../../../src/scrapers/twitter/http/tweets.js';
import { searchTweets } from '../../../src/scrapers/twitter/http/search.js';
import {
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
  bookmarkTweet,
} from '../../../src/scrapers/twitter/http/engagement.js';
import { toCSV } from '../../../src/portability/exporter.js';

// ---------------------------------------------------------------------------
// Limits and pacing
// ---------------------------------------------------------------------------

/** No write goes out sooner than this after the previous one, whatever delayMs says. */
const MIN_WRITE_DELAY_MS = 1000;

/** Most accounts one relationship job may act on. */
const MAX_BULK_USERS = 500;

/** Reports are slow, deliberate and reviewed by X; keep a job small. */
const MAX_REPORTS = 25;
const MIN_REPORT_DELAY_MS = 5000;

/** Pause between the clicks of one browser flow, so the page can render. */
const UI_STEP_MS = 1200;

/** Page-level timeouts for browser flows. */
const NAV_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 15_000;

/** Errors after which no later item in a batch can succeed. */
const BATCH_STOPPERS = new Set(['AuthError', 'XSessionError', 'ActionCapExceededError', 'RateLimitError']);

const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const NUMERIC_ID = /^\d{1,25}$/;

/** Surfaces a muted word applies to, as the settings page sends them. */
const MUTE_SURFACES = 'notifications,home_timeline,tweet_replies';

/** Muted-word durations X offers, in milliseconds. */
const MUTE_DURATIONS = {
  forever: '',
  '24h': String(24 * 60 * 60 * 1000),
  '7d': String(7 * 24 * 60 * 60 * 1000),
  '30d': String(30 * 24 * 60 * 60 * 1000),
};

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

/**
 * An integer config value clamped to a range, or the default when absent.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function intIn(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * A number config value clamped to a range, or the default when absent.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 */
function numberIn(value, fallback, min, max) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** A config flag: true only when the caller sent true (or "true"). */
function flag(value) {
  return value === true || value === 'true';
}

/**
 * A screen name from `@name`, `name` or a profile URL, or null when it is not one.
 * @param {unknown} value
 * @returns {string|null}
 */
function cleanUsername(value) {
  const name = String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  return X_USERNAME.test(name) ? name : null;
}

/**
 * Validate and de-duplicate a list of usernames.
 * @param {unknown} value - array, or a comma/space separated string
 * @param {number} max
 * @returns {{ valid: string[], invalid: string[] }}
 */
function normalizeUsernames(value, max) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const entry of list) {
    if (entry === null || entry === undefined || String(entry).trim() === '') continue;
    const name = cleanUsername(entry);
    if (!name) {
      invalid.push(String(entry));
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(name);
  }
  if (valid.length > max) throw new JobInputError(`At most ${max} usernames per job (got ${valid.length}).`);
  return { valid, invalid };
}

/**
 * Non-empty trimmed strings from an array (or a single string), de-duplicated.
 * @param {unknown} value
 * @param {number} max
 * @param {string} label
 */
function stringList(value, max, label) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out = [...new Set(list.map((v) => String(v ?? '').trim()).filter(Boolean))];
  if (out.length > max) throw new JobInputError(`At most ${max} ${label} per job (got ${out.length}).`);
  return out;
}

/**
 * A tweet ID from an ID, a status URL, or an object carrying one.
 * @param {unknown} value
 * @returns {string|null}
 */
function tweetIdOf(value) {
  if (value && typeof value === 'object') {
    return tweetIdOf(value.id ?? value.tweetId ?? value.tweet_id ?? value.url ?? value.link);
  }
  const text = String(value ?? '').trim();
  if (NUMERIC_ID.test(text)) return text;
  const match = text.match(/\/status(?:es)?\/(\d{1,25})/);
  return match ? match[1] : null;
}

/** Search terms: quoted phrases stay whole, everything else splits on spaces. */
function searchTerms(query) {
  const terms = [];
  for (const match of String(query).matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (match[1] ?? match[2]).trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

/** A delay of about `ms` (plus or minus 30 percent), never under `floor`. */
function humanDelay(ms, floor) {
  return Math.max(floor, Math.round(ms * (0.7 + Math.random() * 0.6)));
}

// ---------------------------------------------------------------------------
// X access
// ---------------------------------------------------------------------------

/**
 * Call one GraphQL operation by the name x.com gives it.
 *
 * The query ID comes from the live-bundle cache or the generated table, and
 * the feature switches are exactly the ones the operation declares. A
 * mutation that answers with `errors` failed; a query fails only when it
 * carries no data at all.
 *
 * @param {import('../../../src/scrapers/twitter/http/client.js').TwitterHttpClient} client
 * @param {string} operationName
 * @param {object} variables
 * @param {{ mutation?: boolean }} [options]
 * @returns {Promise<object|null>} the `data` payload
 */
async function gql(client, operationName, variables, { mutation = false } = {}) {
  const { queryId } = resolveGraphQL(operationName);
  const response = await client.graphql(queryId, operationName, variables, {
    mutation,
    features: operationFeatures(operationName),
  });
  const errors = Array.isArray(response?.errors) ? response.errors : [];
  // A query body with no `data` key is passed through whole by the client, so
  // "no data" means no payload or a payload that is only the errors.
  const data = response?.data;
  const noData = !data || typeof data !== 'object' || Object.keys(data).every((key) => key === 'errors');
  if (errors.length && (mutation || noData)) {
    const message = errors.map((e) => e?.message).filter(Boolean).join('; ') || `${operationName} failed`;
    const ErrorClass = /rate limit|too many requests/i.test(message) ? RateLimitError : TwitterApiError;
    throw new ErrorClass(message, { endpoint: operationName, data: response });
  }
  return response?.data ?? null;
}

const viewers = new WeakMap();

/**
 * The account the job's session belongs to.
 * @param {object} ctx
 * @returns {Promise<{ id: string, username: string, name: string }>}
 */
function viewer(ctx) {
  if (!viewers.has(ctx)) {
    viewers.set(
      ctx,
      (async () => {
        const client = await ctx.http();
        const me = await client.rest(REST.verifyCredentials, { method: 'GET' });
        if (!me?.id_str || !me?.screen_name) {
          throw new TwitterApiError('X did not identify the account behind this session.', {
            endpoint: REST.verifyCredentials,
            data: me,
          });
        }
        return { id: me.id_str, username: me.screen_name, name: me.name ?? '' };
      })(),
    );
  }
  return viewers.get(ctx);
}

/**
 * Depth-first search for the first value stored under `key`.
 * @param {unknown} root
 * @param {string} key
 */
function findKey(root, key) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Object.prototype.hasOwnProperty.call(node, key)) return node[key];
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
  }
  return undefined;
}

/**
 * Page through a GraphQL timeline.
 *
 * @param {object} ctx
 * @param {string} operationName
 * @param {object} baseVariables - sent on every page; count and cursor are added
 * @param {(instructions: object[]) => { items: object[], cursor: string|null }} parsePage
 * @param {{ limit: number, cursor?: string|null, pageSize?: number }} options
 * @returns {Promise<{ items: object[], nextCursor: string|null, pages: number }>}
 */
async function pageTimeline(ctx, operationName, baseVariables, parsePage, { limit, cursor = null, pageSize = 20 }) {
  const client = await ctx.http();
  const items = new Map();
  let next = cursor;
  let pages = 0;
  let exhausted = false;

  while (items.size < limit) {
    ctx.throwIfCancelled();
    const variables = { ...baseVariables, count: pageSize };
    if (next) variables.cursor = next;
    const data = await gql(client, operationName, variables);
    const instructions = findInstructions({ data });
    if (pages === 0 && instructions.length === 0) {
      throw new TwitterApiError(`X answered ${operationName} without a timeline.`, { endpoint: operationName, data });
    }
    const { items: found, cursor: bottom } = parsePage(instructions);
    let added = 0;
    for (const item of found) {
      if (items.size >= limit) break;
      if (!items.has(item.id)) {
        items.set(item.id, item);
        added++;
      }
    }
    pages++;
    ctx.progress(`${operationName}: ${items.size} fetched`, { fetched: items.size, limit });
    if (!bottom || added === 0 || bottom === next) {
      exhausted = true;
      break;
    }
    next = bottom;
  }

  return { items: [...items.values()], nextCursor: exhausted ? null : next, pages };
}

// ---------------------------------------------------------------------------
// Parsers and output shapes
// ---------------------------------------------------------------------------

/** The public fields of a parsed profile. */
function userSummary(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    bio: user.bio,
    verified: user.verified,
    protected: user.protected,
    followers: user.followers,
    following: user.following,
    tweets: user.tweets,
    joined: user.joined,
    avatar: user.avatar,
  };
}

/** Users out of a user-timeline page (followers, blocked, muted, list members). */
function parseUsersPage(instructions) {
  const { entries, cursor } = flattenEntries(instructions);
  const items = [];
  for (const entry of entries) {
    const raw = entry.content?.itemContent?.user_results?.result;
    if (!raw || raw.__typename === 'UserUnavailable') continue;
    const user = parseUserData(raw);
    if (user.id && user.username) items.push(userSummary(user));
  }
  return { items, cursor };
}

/** The fields of a post worth keeping in an export or search result. */
function tweetSummary(tweet) {
  const username = tweet.author?.username || 'i';
  return {
    id: tweet.id,
    url: `https://x.com/${username}/status/${tweet.id}`,
    text: tweet.text,
    createdAt: tweet.createdAt,
    author: {
      id: tweet.author?.id ?? null,
      username: tweet.author?.username ?? '',
      name: tweet.author?.name ?? '',
      verified: Boolean(tweet.author?.verified),
    },
    metrics: tweet.metrics,
    media: (tweet.media || []).map((m) => ({ type: m.type, url: m.videoUrl || m.url })),
    links: (tweet.urls || []).map((u) => u.expandedUrl).filter(Boolean),
    hashtags: tweet.hashtags || [],
    isReply: Boolean(tweet.isReply),
    inReplyTo: tweet.inReplyTo,
    quotedTweetId: tweet.quotedTweet?.id ?? null,
  };
}

/** Posts out of a tweet-timeline page. */
function parseTweetsPage(instructions) {
  const { tweets, cursor } = parseTimelineInstructions(instructions);
  return { items: tweets.filter((t) => t.id && !t.tombstone).map(tweetSummary), cursor };
}

/** One list object as X returns it, in a stable shape. */
function listSummary(list) {
  const owner = list.user_results?.result;
  const ownerLegacy = owner?.legacy || {};
  const ownerCore = owner?.core || {};
  const created = Number(list.created_at);
  return {
    id: list.id_str,
    name: list.name ?? '',
    description: list.description ?? '',
    mode: list.mode ?? null,
    private: String(list.mode || '').toLowerCase() === 'private',
    memberCount: list.member_count ?? 0,
    subscriberCount: list.subscriber_count ?? 0,
    createdAt: Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : null,
    following: Boolean(list.following),
    isMember: Boolean(list.is_member),
    owner: owner
      ? { id: owner.rest_id ?? null, username: ownerCore.screen_name ?? ownerLegacy.screen_name ?? '', name: ownerCore.name ?? ownerLegacy.name ?? '' }
      : null,
    url: `https://x.com/i/lists/${list.id_str}`,
  };
}

/** Lists out of a list-timeline page. */
function parseListsPage(instructions) {
  const { entries, cursor } = flattenEntries(instructions);
  const items = [];
  for (const entry of entries) {
    const list = entry.content?.itemContent?.list;
    if (list?.id_str) items.push(listSummary(list));
  }
  return { items, cursor };
}

/**
 * Every topic object anywhere in a response, keyed by topic ID.
 * @param {unknown} root
 * @param {Map<string, object>} [into]
 */
function collectTopics(root, into = new Map()) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (typeof node.topic_id === 'string' && typeof node.name === 'string') {
      into.set(node.topic_id, {
        id: node.topic_id,
        name: node.name,
        description: node.description ?? '',
        following: Boolean(node.following),
        notInterested: Boolean(node.not_interested),
        iconUrl: node.icon_url ?? null,
        url: `https://x.com/i/topics/${node.topic_id}`,
      });
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
  }
  return into;
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/**
 * Run one write per item, in order, with a human delay between them.
 *
 * @param {object} ctx
 * @param {Array} items
 * @param {object} options
 * @param {number} options.delayMs - pause between items (jittered)
 * @param {boolean} [options.paced=true] - false for dry runs, which write nothing
 * @param {number} [options.floor] - shortest pause between two writes
 * @param {string} options.label - progress label
 * @param {(item: any) => object} options.refOf - identifying fields for an outcome row
 * @param {(item: any, index: number) => Promise<object>} options.act - returns an outcome row
 * @returns {Promise<{ results: object[], stopped: { reason: string, error: string }|null }>}
 */
async function runBatch(ctx, items, { delayMs, paced = true, floor = MIN_WRITE_DELAY_MS, label, refOf, act }) {
  const results = [];
  let stopped = null;
  let succeeded = 0;

  for (let i = 0; i < items.length; i++) {
    ctx.throwIfCancelled();
    if (stopped) {
      results.push({ ...refOf(items[i]), status: 'skipped', reason: `stopped after ${stopped.reason}` });
      continue;
    }
    if (i > 0 && paced) await ctx.sleep(humanDelay(delayMs, floor));
    try {
      const row = await act(items[i], i);
      results.push(row);
      if (row.status !== 'failed' && row.status !== 'skipped') succeeded++;
    } catch (err) {
      if (err?.name === 'JobCancelledError') throw err;
      if (BATCH_STOPPERS.has(err?.name)) {
        if (succeeded === 0) throw err;
        stopped = { reason: err.name, error: err.message };
      }
      results.push({ ...refOf(items[i]), status: 'failed', error: err?.message || String(err) });
    }
    ctx.progress(`${label}: ${i + 1}/${items.length}`, { done: i + 1, total: items.length });
  }

  return { results, stopped };
}

/** Count outcome rows by status. */
function tally(results) {
  const counts = {};
  for (const row of results) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

/**
 * Block, unblock, mute, unmute or remove each target account.
 *
 * @param {object} ctx
 * @param {Array<{ username: string, id?: string }>} targets - an ID skips the lookup
 * @param {object} spec
 * @param {string} spec.verb - past-tense outcome, e.g. "blocked"
 * @param {string} spec.actionClass - daily cap class charged per action
 * @param {(client: object, userId: string) => Promise<unknown>} spec.perform
 * @param {number} spec.delayMs
 * @param {boolean} spec.dryRun
 */
async function relationshipBatch(ctx, targets, { verb, actionClass, perform, delayMs, dryRun }) {
  const client = await ctx.http();
  const { results, stopped } = await runBatch(ctx, targets, {
    delayMs,
    paced: !dryRun,
    label: verb,
    refOf: (t) => ({ username: t.username, userId: t.id ?? null }),
    act: async (target) => {
      let { id, username } = target;
      if (!id) {
        try {
          const profile = await scrapeProfile(client, username);
          id = profile.id;
          username = profile.username || username;
        } catch (err) {
          if (err instanceof NotFoundError) {
            return { username, userId: null, status: 'failed', error: `@${username} does not exist or is suspended` };
          }
          throw err;
        }
      }
      if (dryRun) return { username, userId: id, status: `would_be_${verb}` };
      await ctx.charge(actionClass);
      await perform(client, id);
      return { username, userId: id, status: verb };
    },
  });
  return { results, stopped };
}

/** The common result envelope of a relationship batch. */
function batchResult(action, { results, stopped }, extra = {}) {
  const counts = tally(results);
  return {
    success: true,
    action,
    requested: results.length,
    counts,
    results,
    stopped,
    ...extra,
  };
}

/**
 * A processor that applies one relationship action to `config.usernames`.
 * @param {object} spec
 */
function usernamesAction({ verb, actionClass, perform, defaultDelay }) {
  return async (ctx) => {
    const { valid, invalid } = normalizeUsernames(ctx.require('usernames'), MAX_BULK_USERS);
    if (!valid.length) throw new JobInputError('usernames contains no valid X usernames.');
    const dryRun = flag(ctx.config.dryRun);
    const delayMs = intIn(ctx.config.delayMs, defaultDelay, 0, 120_000);
    const outcome = await relationshipBatch(
      ctx,
      valid.map((username) => ({ username })),
      { verb, actionClass, perform, delayMs, dryRun },
    );
    return batchResult(verb, outcome, { dryRun, invalid });
  };
}

// ---------------------------------------------------------------------------
// Bot scoring
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How bot-like an account looks, from its profile alone.
 *
 * Each signal adds a weight; the sum is clamped to 0..1. A verified account
 * is discounted. The signals are the ones every XActions bot heuristic uses
 * (default avatar, empty bio, extreme follow ratio, no posts) plus account
 * age, a trailing-digits handle and a near-empty audience.
 *
 * @param {object} user - userSummary()
 * @param {number} [now]
 * @returns {{ score: number, signals: string[] }}
 */
export function scoreBot(user, now = Date.now()) {
  const signals = [];
  let score = 0;
  const add = (signal, weight) => {
    signals.push(signal);
    score += weight;
  };

  if (!user.avatar || /default_profile/.test(user.avatar)) add('default_avatar', 0.25);
  if (!String(user.bio || '').trim()) add('no_bio', 0.15);

  const followers = Number(user.followers) || 0;
  const following = Number(user.following) || 0;
  const ratio = following / Math.max(followers, 1);
  if (following >= 100 && ratio >= 20) add('extreme_follow_ratio', 0.2);
  else if (following >= 50 && ratio >= 5) add('high_follow_ratio', 0.1);

  const tweets = Number(user.tweets) || 0;
  if (tweets === 0) add('no_posts', 0.15);
  else if (tweets < 5) add('few_posts', 0.05);

  const joined = user.joined ? Date.parse(user.joined) : NaN;
  if (Number.isFinite(joined)) {
    const ageDays = (now - joined) / DAY_MS;
    if (ageDays < 30) add('new_account', 0.15);
    else if (ageDays < 90) add('young_account', 0.05);
  }

  if (/\d{5,}$/.test(user.username || '')) add('numeric_handle', 0.15);
  if (followers < 5) add('few_followers', 0.1);
  if (user.verified) {
    signals.push('verified');
    score -= 0.2;
  }

  return { score: Math.round(Math.min(Math.max(score, 0), 1) * 100) / 100, signals };
}

// ---------------------------------------------------------------------------
// Muted words (v1.1 REST, as x.com/settings/muted_keywords calls it)
// ---------------------------------------------------------------------------

/** One muted keyword in a stable shape. */
function mutedWordSummary(entry) {
  return {
    id: String(entry.id ?? entry.id_str ?? ''),
    keyword: entry.keyword ?? '',
    createdAt: entry.created_at ?? null,
    validUntil: entry.valid_until ?? null,
    surfaces: entry.mute_surfaces ?? [],
    options: entry.mute_options ?? [],
  };
}

async function listMutedWords(client) {
  const response = await client.rest('/1.1/mutes/keywords/list.json', { method: 'GET' });
  if (!Array.isArray(response?.muted_keywords)) {
    throw new TwitterApiError('X answered the muted words list without a muted_keywords array.', {
      endpoint: '/1.1/mutes/keywords/list.json',
      data: response,
    });
  }
  return response.muted_keywords.map(mutedWordSummary);
}

async function destroyMutedWords(client, ids) {
  for (let i = 0; i < ids.length; i += 100) {
    await client.rest('/1.1/mutes/keywords/destroy.json', { method: 'POST', body: { ids: ids.slice(i, i + 100).join(',') } });
  }
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/** Read up to `limit` bookmarks, newest first. */
async function fetchBookmarks(ctx, limit) {
  const { items } = await pageTimeline(ctx, 'Bookmarks', { includePromotedContent: false }, parseTweetsPage, { limit });
  return items;
}

/** Every bookmark folder on the account. */
async function listBookmarkFolders(ctx) {
  const client = await ctx.http();
  const folders = new Map();
  let cursor = null;
  for (let page = 0; page < 25; page++) {
    ctx.throwIfCancelled();
    const data = await gql(client, 'BookmarkFoldersSlice', cursor ? { cursor } : {});
    const slice = findKey(data, 'bookmark_collections_slice');
    if (!slice || !Array.isArray(slice.items)) {
      throw new TwitterApiError('X answered BookmarkFoldersSlice without a folder list.', {
        endpoint: 'BookmarkFoldersSlice',
        data,
      });
    }
    for (const item of slice.items) {
      const id = item.id ?? item.rest_id;
      if (id) folders.set(String(id), { id: String(id), name: item.name ?? '' });
    }
    const next = slice.slice_info?.next_cursor;
    if (!next || next === cursor || slice.items.length === 0) break;
    cursor = next;
  }
  return [...folders.values()];
}

async function createFolder(ctx, name) {
  const client = await ctx.http();
  const data = await gql(client, 'createBookmarkFolder', { name }, { mutation: true });
  const created = data?.bookmark_collection_create;
  if (!created?.id) {
    throw new TwitterApiError('X did not return the new bookmark folder.', { endpoint: 'createBookmarkFolder', data });
  }
  return { id: String(created.id), name: created.name ?? name };
}

async function moveToFolder(client, tweetId, folderId) {
  await gql(client, 'bookmarkTweetToFolder', { tweet_id: tweetId, bookmark_collection_id: folderId }, { mutation: true });
}

/** Validate a folder name the way X's dialog does (1 to 25 characters). */
function folderName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new JobInputError('name is required');
  if (name.length > 25) throw new JobInputError('Bookmark folder names are at most 25 characters.');
  return name;
}

/**
 * The bookmark export shared by the AI export route and the dashboard.
 * @param {object} ctx
 */
async function exportBookmarks(ctx) {
  const format = String(ctx.config.format || 'json').toLowerCase();
  if (!['json', 'csv'].includes(format)) throw new JobInputError('format must be "json" or "csv".');
  const limit = intIn(ctx.config.limit, 500, 1, 5000);
  ctx.progress('Reading bookmarks');
  const bookmarks = await fetchBookmarks(ctx, limit);
  const result = {
    success: true,
    format,
    count: bookmarks.length,
    exportedAt: new Date().toISOString(),
    bookmarks,
  };
  if (format === 'csv') {
    result.csv = toCSV(
      bookmarks.map((b) => ({
        id: b.id,
        url: b.url,
        author: b.author.username,
        authorName: b.author.name,
        text: b.text,
        createdAt: b.createdAt,
        likes: b.metrics?.likes ?? 0,
        retweets: b.metrics?.retweets ?? 0,
        replies: b.metrics?.replies ?? 0,
        views: b.metrics?.views ?? 0,
        media: b.media.map((m) => m.url).join(' '),
        links: b.links.join(' '),
      })),
    );
  }
  return result;
}

/**
 * Find a folder by ID or by name (case-insensitive).
 * @param {object[]} folders
 * @param {string} ref
 */
function findFolder(folders, ref) {
  const wanted = String(ref).trim();
  return (
    folders.find((f) => f.id === wanted) ||
    folders.find((f) => f.name.toLowerCase() === wanted.toLowerCase()) ||
    null
  );
}

// ---------------------------------------------------------------------------
// Browser flows
// ---------------------------------------------------------------------------

/**
 * The trimmed text of every element matching `selector`.
 * @param {object} page - Puppeteer page
 * @param {string} selector
 */
async function textsOf(page, selector) {
  const handles = await page.$$(selector);
  const out = [];
  for (const handle of handles) {
    const text = await handle.evaluate((el) => (el.innerText || el.textContent || '').trim());
    out.push({ handle, text });
  }
  return out;
}

/**
 * Click the first element matching `selector` whose text matches one of the
 * patterns, trying the patterns in order.
 * @returns {Promise<string|null>} the clicked text
 */
async function clickByText(page, selector, patterns) {
  const candidates = await textsOf(page, selector);
  for (const pattern of patterns) {
    const hit = candidates.find((c) => pattern.test(c.text));
    if (hit) {
      await hit.handle.click();
      return hit.text;
    }
  }
  return null;
}

const DIALOG = '[role="dialog"]';
const DIALOG_CHOICES = `${DIALOG} label, ${DIALOG} [role="radio"], ${DIALOG} [role="option"]`;
const DIALOG_BUTTONS = `${DIALOG} [role="button"], ${DIALOG} button`;
/** Which answer to give when the report flow asks what the problem is. */
const SPAM_CHOICES = [/^spam\b/i, /\bspam\b/i, /fake engagement/i, /fake account/i];

/**
 * Report one account as spam through the profile menu's report dialog.
 *
 * @param {object} ctx
 * @param {object} page
 * @param {string} username
 * @returns {Promise<{ status: string, error?: string, steps: string[] }>}
 */
async function reportAccount(ctx, page, username) {
  const steps = [];
  await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const menu = await page.waitForSelector('[data-testid="userActions"]', { timeout: SELECTOR_TIMEOUT_MS }).catch(() => null);
  if (!menu) return { status: 'failed', error: 'The profile menu did not load (the account may not exist).', steps };
  await menu.click();
  await ctx.sleep(UI_STEP_MS);
  const opened = await clickByText(page, '[role="menuitem"]', [/^report\b/i]);
  if (!opened) return { status: 'failed', error: 'The profile menu has no Report option.', steps };
  steps.push(opened);
  await ctx.sleep(UI_STEP_MS);

  let submitted = false;
  for (let step = 0; step < 8; step++) {
    ctx.throwIfCancelled();
    const dialog = await page.$(DIALOG);
    if (!dialog) {
      return submitted
        ? { status: 'reported', steps }
        : { status: 'failed', error: 'The report dialog closed before the report was submitted.', steps };
    }
    const choices = submitted ? [] : await textsOf(page, DIALOG_CHOICES);
    if (choices.length) {
      const picked = await clickByText(page, DIALOG_CHOICES, SPAM_CHOICES);
      if (!picked) {
        return {
          status: 'failed',
          error: `The report flow asked a question with no spam answer: ${choices.map((c) => c.text).slice(0, 6).join(' / ')}`,
          steps,
        };
      }
      steps.push(picked);
      await ctx.sleep(UI_STEP_MS);
    }
    const pressed = await clickByText(page, DIALOG_BUTTONS, [/^(submit|report)$/i, /^next$/i, /^(done|close)$/i]);
    if (!pressed) {
      return submitted
        ? { status: 'reported', steps }
        : { status: 'failed', error: 'The report dialog offered no Next or Submit button.', steps };
    }
    steps.push(pressed);
    if (/^(submit|report)$/i.test(pressed)) submitted = true;
    await ctx.sleep(UI_STEP_MS);
    if (/^(done|close)$/i.test(pressed)) {
      return submitted
        ? { status: 'reported', steps }
        : { status: 'failed', error: 'The report dialog closed before the report was submitted.', steps };
    }
  }
  return submitted
    ? { status: 'reported', steps }
    : { status: 'failed', error: 'The report flow did not finish within 8 steps.', steps };
}

/**
 * Load a page and collect every GraphQL JSON response it fetches.
 * @param {object} page
 * @param {string} url
 */
async function captureGraphql(page, url) {
  const pending = [];
  const onResponse = (response) => {
    if (!/\/i\/api\/graphql\//.test(response.url())) return;
    pending.push(response.json().catch(() => null));
  };
  page.on('response', onResponse);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  } finally {
    page.off('response', onResponse);
  }
  return (await Promise.all(pending)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export default {
  // ---- Blocking and muting ------------------------------------------------

  blockBots: {
    run: async (ctx) => {
      const threshold = numberIn(ctx.config.threshold, 0.7, 0, 1);
      const limit = intIn(ctx.config.limit, 100, 1, 1000);
      const dryRun = flag(ctx.config.dryRun);
      const delayMs = intIn(ctx.config.delayMs, 2000, 0, 120_000);
      const me = await viewer(ctx);

      ctx.progress(`Scanning up to ${limit} followers of @${me.username}`);
      const { items: followers } = await pageTimeline(
        ctx,
        'Followers',
        { userId: me.id, includePromotedContent: false },
        parseUsersPage,
        { limit },
      );

      const now = Date.now();
      const suspects = followers
        .map((user) => ({ user, ...scoreBot(user, now) }))
        .filter((s) => s.score >= threshold)
        .sort((a, b) => b.score - a.score);

      const details = new Map(suspects.map((s) => [s.user.id, s]));
      const outcome = await relationshipBatch(
        ctx,
        suspects.map((s) => ({ id: s.user.id, username: s.user.username })),
        { verb: 'blocked', actionClass: 'block', perform: blockUser, delayMs, dryRun },
      );
      const accounts = outcome.results.map((row) => {
        const s = details.get(row.userId);
        return { ...row, score: s?.score ?? null, signals: s?.signals ?? [], followers: s?.user.followers, following: s?.user.following };
      });

      return {
        success: true,
        account: me.username,
        dryRun,
        threshold,
        scanned: followers.length,
        suspects: suspects.length,
        counts: tally(outcome.results),
        accounts,
        stopped: outcome.stopped,
      };
    },
    write: true,
    description: 'Score followers for bot signals and block those over the threshold',
  },

  massBlock: {
    run: usernamesAction({ verb: 'blocked', actionClass: 'block', perform: blockUser, defaultDelay: 2000 }),
    write: true,
    description: 'Block a list of accounts',
  },

  massUnblock: {
    run: usernamesAction({ verb: 'unblocked', actionClass: 'block', perform: unblockUser, defaultDelay: 2000 }),
    write: true,
    description: 'Unblock a list of accounts',
  },

  massUnmute: {
    run: async (ctx) => {
      const dryRun = flag(ctx.config.dryRun);
      const delayMs = intIn(ctx.config.delayMs, 2000, 0, 120_000);
      const given = ctx.config.usernames;
      const hasList = Array.isArray(given) ? given.length > 0 : typeof given === 'string' && given.trim() !== '';

      if (hasList) {
        const { valid, invalid } = normalizeUsernames(given, MAX_BULK_USERS);
        if (!valid.length) throw new JobInputError('usernames contains no valid X usernames.');
        const outcome = await relationshipBatch(ctx, valid.map((username) => ({ username })), {
          verb: 'unmuted',
          actionClass: 'mute',
          perform: unmuteUser,
          delayMs,
          dryRun,
        });
        return batchResult('unmuted', outcome, { dryRun, invalid, scope: 'listed' });
      }

      // No list: unmute everyone currently muted.
      const limit = intIn(ctx.config.limit, MAX_BULK_USERS, 1, MAX_BULK_USERS);
      ctx.progress('Reading muted accounts');
      const { items: muted } = await pageTimeline(ctx, 'MutedAccounts', { includePromotedContent: false }, parseUsersPage, { limit });
      const outcome = await relationshipBatch(ctx, muted.map((u) => ({ id: u.id, username: u.username })), {
        verb: 'unmuted',
        actionClass: 'mute',
        perform: unmuteUser,
        delayMs,
        dryRun,
      });
      return batchResult('unmuted', outcome, { dryRun, invalid: [], scope: 'all_muted', mutedFound: muted.length });
    },
    write: true,
    description: 'Unmute listed accounts, or every muted account',
  },

  muteKeywords: {
    run: async (ctx) => {
      const keywords = stringList(ctx.require('keywords'), 20, 'keywords');
      if (!keywords.length) throw new JobInputError('keywords is required');
      const maxMutes = intIn(ctx.config.maxMutes, 50, 1, 200);
      const scanLimit = intIn(ctx.config.scanLimit, 50, 1, 200);
      const dryRun = flag(ctx.config.dryRun);
      const delayMs = intIn(ctx.config.delayMs, 2000, 0, 120_000);
      const client = await ctx.http();
      const me = await viewer(ctx);

      const candidates = new Map();
      const scanned = {};
      for (const keyword of keywords) {
        if (candidates.size >= maxMutes) break;
        ctx.throwIfCancelled();
        ctx.progress(`Searching posts for "${keyword}"`);
        const query = /\s/.test(keyword) ? `"${keyword}"` : keyword;
        const tweets = await searchTweets(client, query, { limit: scanLimit, type: 'Latest' });
        scanned[keyword] = tweets.length;
        const needle = keyword.toLowerCase();
        for (const tweet of tweets) {
          const authorId = tweet.author?.id;
          if (!authorId || authorId === me.id || candidates.has(authorId)) continue;
          if (!String(tweet.text || '').toLowerCase().includes(needle)) continue;
          candidates.set(authorId, {
            id: authorId,
            username: tweet.author.username,
            keyword,
            tweetId: tweet.id,
          });
          if (candidates.size >= maxMutes) break;
        }
      }

      const targets = [...candidates.values()];
      const outcome = await relationshipBatch(ctx, targets, {
        verb: 'muted',
        actionClass: 'mute',
        perform: muteUser,
        delayMs,
        dryRun,
      });
      const matched = new Map(targets.map((t) => [t.id, t]));
      const results = outcome.results.map((row) => ({
        ...row,
        keyword: matched.get(row.userId)?.keyword ?? null,
        tweetId: matched.get(row.userId)?.tweetId ?? null,
      }));
      return batchResult('muted', { results, stopped: outcome.stopped }, { dryRun, keywords, postsScanned: scanned });
    },
    write: true,
    description: 'Mute the authors of recent posts containing keywords',
  },

  mutedWords: {
    run: async (ctx) => {
      const action = String(ctx.config.action || 'list').toLowerCase();
      const client = await ctx.http();

      if (action === 'list') {
        const words = await listMutedWords(client);
        return { success: true, action, count: words.length, mutedWords: words };
      }

      if (action === 'add') {
        const words = stringList(ctx.config.words ?? ctx.config.keywords, 100, 'words');
        if (!words.length) throw new JobInputError('words is required to add muted words');
        const duration = String(ctx.config.duration || 'forever').toLowerCase();
        if (!(duration in MUTE_DURATIONS)) {
          throw new JobInputError(`duration must be one of: ${Object.keys(MUTE_DURATIONS).join(', ')}.`);
        }
        const excludeFollowing = flag(ctx.config.excludeFollowing);
        const delayMs = intIn(ctx.config.delayMs, 1000, 0, 60_000);
        const { results, stopped } = await runBatch(ctx, words, {
          delayMs,
          label: 'muting words',
          refOf: (word) => ({ keyword: word }),
          act: async (word) => {
            await ctx.charge('mute');
            await client.rest('/1.1/mutes/keywords/create.json', {
              method: 'POST',
              body: {
                keyword: word,
                mute_surfaces: MUTE_SURFACES,
                mute_option: excludeFollowing ? 'exclude_following_accounts' : '',
                duration: MUTE_DURATIONS[duration],
              },
            });
            return { keyword: word, status: 'muted' };
          },
        });
        const current = await listMutedWords(client);
        return { success: true, action, duration, excludeFollowing, counts: tally(results), results, stopped, mutedWords: current };
      }

      if (action === 'remove' || action === 'clear') {
        const current = await listMutedWords(client);
        let targets = current;
        let missing = [];
        if (action === 'remove') {
          const words = stringList(ctx.config.words ?? ctx.config.keywords, 500, 'words');
          if (!words.length) throw new JobInputError('words is required to remove muted words');
          const wanted = new Set(words.map((w) => w.toLowerCase()));
          targets = current.filter((w) => wanted.has(w.keyword.toLowerCase()));
          const found = new Set(targets.map((w) => w.keyword.toLowerCase()));
          missing = words.filter((w) => !found.has(w.toLowerCase()));
        }
        if (targets.length) await destroyMutedWords(client, targets.map((w) => w.id));
        const after = await listMutedWords(client);
        return {
          success: true,
          action,
          removed: targets.map((w) => w.keyword),
          notMuted: missing,
          count: after.length,
          mutedWords: after,
        };
      }

      throw new JobInputError('action must be one of: list, add, remove, clear.');
    },
    write: true,
    description: 'List, add, remove or clear muted words',
  },

  removeFollowers: {
    run: usernamesAction({
      verb: 'removed',
      actionClass: 'block',
      perform: (client, userId) => gql(client, 'RemoveFollower', { target_user_id: userId }, { mutation: true }),
      defaultDelay: 3000,
    }),
    write: true,
    description: 'Remove accounts from your followers without blocking them',
  },

  reportSpam: {
    run: async (ctx) => {
      const { valid, invalid } = normalizeUsernames(ctx.require('usernames'), MAX_REPORTS);
      if (!valid.length) throw new JobInputError('usernames contains no valid X usernames.');
      const delayMs = intIn(ctx.config.delayMs, 8000, 0, 120_000);
      const page = await ctx.page();
      const { results, stopped } = await runBatch(ctx, valid, {
        delayMs,
        floor: MIN_REPORT_DELAY_MS,
        label: 'reporting',
        refOf: (username) => ({ username }),
        act: async (username) => {
          await ctx.charge('block');
          const outcome = await reportAccount(ctx, page, username);
          return { username, ...outcome };
        },
      });
      return { success: true, action: 'reported', requested: valid.length, invalid, counts: tally(results), results, stopped };
    },
    concurrency: 1,
    write: true,
    description: 'Report accounts as spam through X report flow',
  },

  shadowbanCheck: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      if (!username) throw new JobInputError('username is not a valid X username.');
      const client = await ctx.http();
      const checkedAt = new Date().toISOString();

      let profile;
      try {
        profile = await scrapeProfile(client, username);
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        const suspended = /suspend/i.test(err.message);
        return {
          success: true,
          username,
          exists: suspended,
          suspended,
          verdict: suspended ? 'suspended' : 'not_found',
          flags: suspended ? ['suspended'] : [],
          tests: {},
          checkedAt,
        };
      }

      const base = { success: true, username: profile.username, userId: profile.id, exists: true, suspended: false, checkedAt };
      if (profile.protected) {
        return {
          ...base,
          protected: true,
          verdict: 'protected',
          flags: [],
          tests: {},
          note: 'Protected accounts never appear in search, so search visibility cannot be tested.',
        };
      }

      const lower = profile.username.toLowerCase();
      const byUser = (t) => String(t.author?.username || '').toLowerCase() === lower;
      const tests = {};

      ctx.progress('Checking search suggestions');
      const params = new URLSearchParams({ q: profile.username, src: 'search_box', result_type: 'users' });
      const typeahead = await client.rest(`/1.1/search/typeahead.json?${params}`, { method: 'GET' });
      const suggested = (typeahead?.users || []).some((u) => String(u.screen_name || '').toLowerCase() === lower);
      tests.searchSuggestion = suggested
        ? { status: 'pass', detail: 'The account appears in search suggestions.' }
        : { status: 'fail', detail: 'The account does not appear in search suggestions for its own handle.' };

      ctx.throwIfCancelled();
      ctx.progress('Reading recent posts');
      const timeline = await scrapeTweetsAndReplies(client, profile.username, { limit: 40 });
      const own = timeline.filter((t) => byUser(t) && !t.isRetweet);
      const posts = own.filter((t) => !t.isReply);
      const replies = own.filter((t) => t.isReply);

      ctx.throwIfCancelled();
      ctx.progress('Searching for recent posts');
      const found = (await searchTweets(client, `from:${profile.username}`, { limit: 20, type: 'Latest' })).filter(byUser);
      tests.searchBan =
        own.length === 0
          ? { status: 'unknown', detail: 'No recent posts to look for in search.' }
          : found.length > 0
            ? { status: 'pass', detail: `${found.length} recent posts are visible in Latest search.`, found: found.length }
            : { status: 'fail', detail: `${own.length} recent posts exist but none are visible in Latest search.`, found: 0 };

      ctx.throwIfCancelled();
      ctx.progress('Searching for recent replies');
      const foundReplies = (
        await searchTweets(client, `from:${profile.username} filter:replies`, { limit: 20, type: 'Latest' })
      ).filter(byUser);
      tests.replyVisibility =
        replies.length === 0
          ? { status: 'unknown', detail: 'No recent replies to look for in search.' }
          : foundReplies.length > 0
            ? { status: 'pass', detail: `${foundReplies.length} recent replies are visible in search.`, found: foundReplies.length }
            : { status: 'fail', detail: `${replies.length} recent replies exist but none are visible in search.`, found: 0 };

      const flags = [];
      if (tests.searchBan.status === 'fail') flags.push('search_ban');
      if (tests.searchSuggestion.status === 'fail') flags.push('search_suggestion_ban');
      if (tests.replyVisibility.status === 'fail') flags.push('reply_deboosting');
      const unknown = Object.values(tests).filter((t) => t.status === 'unknown').length;
      const verdict = flags.length ? 'restricted' : unknown ? 'inconclusive' : 'clean';

      return {
        ...base,
        protected: false,
        verdict,
        flags,
        tests,
        recent: { posts: posts.length, replies: replies.length },
      };
    },
    concurrency: 3,
    description: 'Check an account for search, suggestion and reply visibility restrictions',
  },

  verifiedOnly: {
    run: async (ctx) => {
      const enabled = ctx.config.enabled === undefined ? true : flag(ctx.config.enabled);
      const delayMs = intIn(ctx.config.delayMs, 1500, 0, 60_000);
      const client = await ctx.http();

      let tweetIds;
      if (ctx.config.tweetIds !== undefined) {
        const given = Array.isArray(ctx.config.tweetIds) ? ctx.config.tweetIds : [ctx.config.tweetIds];
        tweetIds = [...new Set(given.map(tweetIdOf).filter(Boolean))];
        if (!tweetIds.length) throw new JobInputError('tweetIds contains no valid post IDs or URLs.');
        if (tweetIds.length > 100) throw new JobInputError('At most 100 posts per job.');
      } else {
        const limit = intIn(ctx.config.limit, 20, 1, 100);
        const me = await viewer(ctx);
        ctx.progress(`Reading the latest ${limit} posts of @${me.username}`);
        const tweets = await scrapeTweets(client, me.username, { limit: limit * 2 });
        tweetIds = tweets
          .filter((t) => t.author?.id === me.id && !t.isRetweet && !t.isReply)
          .slice(0, limit)
          .map((t) => t.id);
      }

      const { results, stopped } = await runBatch(ctx, tweetIds, {
        delayMs,
        label: enabled ? 'restricting replies' : 'opening replies',
        refOf: (tweetId) => ({ tweetId }),
        act: async (tweetId) => {
          if (enabled) {
            await gql(client, 'ConversationControlChange', { tweet_id: tweetId, mode: 'Verified' }, { mutation: true });
          } else {
            await gql(client, 'ConversationControlDelete', { tweet_id: tweetId }, { mutation: true });
          }
          return { tweetId, status: enabled ? 'verified_only' : 'everyone' };
        },
      });

      return {
        success: true,
        enabled,
        replyAudience: enabled ? 'verified' : 'everyone',
        posts: tweetIds.length,
        counts: tally(results),
        results,
        stopped,
      };
    },
    write: true,
    description: 'Limit replies on your posts to verified accounts, or open them again',
  },

  blockedList: {
    run: async (ctx) => {
      const limit = intIn(ctx.config.limit, 1000, 1, 5000);
      const { items, nextCursor } = await pageTimeline(
        ctx,
        'BlockedAccountsAll',
        { includePromotedContent: false, withSafetyModeUserFields: false },
        parseUsersPage,
        { limit, cursor: ctx.config.cursor || null },
      );
      return { success: true, count: items.length, accounts: items, nextCursor };
    },
    concurrency: 3,
    description: 'List blocked accounts',
  },

  mutedList: {
    run: async (ctx) => {
      const limit = intIn(ctx.config.limit, 1000, 1, 5000);
      const { items, nextCursor } = await pageTimeline(
        ctx,
        'MutedAccounts',
        { includePromotedContent: false },
        parseUsersPage,
        { limit, cursor: ctx.config.cursor || null },
      );
      return { success: true, count: items.length, accounts: items, nextCursor };
    },
    concurrency: 3,
    description: 'List muted accounts',
  },

  // ---- Lists --------------------------------------------------------------

  getLists: {
    run: async (ctx) => {
      const limit = intIn(ctx.config.limit, 50, 1, 200);
      let owner;
      if (ctx.config.username) {
        const username = cleanUsername(ctx.config.username);
        if (!username) throw new JobInputError('username is not a valid X username.');
        const profile = await scrapeProfile(await ctx.http(), username);
        owner = { id: profile.id, username: profile.username };
      } else {
        owner = await viewer(ctx);
      }
      ctx.progress(`Reading lists of @${owner.username}`);
      const { items } = await pageTimeline(ctx, 'CombinedLists', { userId: owner.id }, parseListsPage, {
        limit,
        pageSize: 100,
      });
      return { success: true, username: owner.username, userId: owner.id, count: items.length, lists: items };
    },
    concurrency: 3,
    description: 'Lists an account owns or subscribes to',
  },

  getListMembers: {
    run: async (ctx) => {
      const listId = String(ctx.require('listId', 'listId or listUrl')).trim();
      if (!NUMERIC_ID.test(listId)) throw new JobInputError('listId must be the numeric ID of an X list.');
      const limit = intIn(ctx.config.limit, 100, 1, 500);
      const { items, nextCursor } = await pageTimeline(ctx, 'ListMembers', { listId }, parseUsersPage, {
        limit,
        cursor: ctx.config.cursor || null,
      });
      return { success: true, listId, count: items.length, members: items, nextCursor };
    },
    concurrency: 3,
    description: 'Members of an X list',
  },

  // ---- Bookmarks ----------------------------------------------------------

  bookmarksExport: {
    run: exportBookmarks,
    concurrency: 3,
    description: 'Export bookmarks as JSON or CSV',
  },

  getBookmarks: {
    run: exportBookmarks,
    concurrency: 3,
    description: 'Read bookmarks for the dashboard',
  },

  bookmarksFolders: {
    run: async (ctx) => {
      const implied = ctx.config.name ? (ctx.config.folderId ? 'rename' : 'create') : 'list';
      const action = String(ctx.config.action || implied).toLowerCase();
      const client = await ctx.http();

      if (action === 'list') {
        const folders = await listBookmarkFolders(ctx);
        return { success: true, action, count: folders.length, folders };
      }
      if (action === 'create') {
        const folder = await createFolder(ctx, folderName(ctx.config.name));
        return { success: true, action, folder };
      }
      if (action === 'rename') {
        const folderId = String(ctx.require('folderId')).trim();
        const name = folderName(ctx.config.name);
        await gql(client, 'EditBookmarkFolder', { bookmark_collection_id: folderId, name }, { mutation: true });
        return { success: true, action, folder: { id: folderId, name } };
      }
      if (action === 'delete') {
        const folderId = String(ctx.require('folderId')).trim();
        await gql(client, 'DeleteBookmarkFolder', { bookmark_collection_id: folderId }, { mutation: true });
        return { success: true, action, folderId, deleted: true };
      }
      throw new JobInputError('action must be one of: list, create, rename, delete.');
    },
    write: true,
    description: 'List, create, rename or delete bookmark folders',
  },

  createBookmarkFolder: {
    run: async (ctx) => {
      const folder = await createFolder(ctx, folderName(ctx.require('name', 'Folder name')));
      return { success: true, folder };
    },
    write: true,
    description: 'Create a bookmark folder',
  },

  bookmarksOrganize: {
    run: async (ctx) => {
      const dryRun = flag(ctx.config.dryRun);
      const createMissing = ctx.config.createMissing !== false && ctx.config.createMissing !== 'false';
      const delayMs = intIn(ctx.config.delayMs, 1500, 0, 60_000);
      const client = await ctx.http();

      // Either explicit moves (tweetIds + folder) or rules applied to the bookmarks.
      let plan;
      if (ctx.config.tweetIds !== undefined) {
        const folderRef = ctx.config.folderId ?? ctx.config.folder;
        if (!folderRef) throw new JobInputError('folderId or folder is required with tweetIds.');
        const given = Array.isArray(ctx.config.tweetIds) ? ctx.config.tweetIds : [ctx.config.tweetIds];
        const ids = [...new Set(given.map(tweetIdOf).filter(Boolean))];
        if (!ids.length) throw new JobInputError('tweetIds contains no valid post IDs or URLs.');
        if (ids.length > 500) throw new JobInputError('At most 500 posts per job.');
        plan = { rules: [{ folder: String(folderRef) }], moves: ids.map((tweetId) => ({ tweetId, rule: 0 })), scanned: null };
      } else {
        const rules = Array.isArray(ctx.config.rules) ? ctx.config.rules : [];
        if (!rules.length) throw new JobInputError('Send rules ([{ folder, keywords?, authors? }]) or tweetIds with a folder.');
        const normalized = rules.map((rule, i) => {
          const folder = rule?.folderId ?? rule?.folder;
          const keywords = stringList(rule?.keywords, 50, 'keywords').map((k) => k.toLowerCase());
          const authors = stringList(rule?.authors, 100, 'authors').map((a) => (cleanUsername(a) || a).toLowerCase());
          if (!folder) throw new JobInputError(`rules[${i}] needs a folder.`);
          if (!keywords.length && !authors.length) throw new JobInputError(`rules[${i}] needs keywords or authors.`);
          return { folder: String(folder), keywords, authors };
        });
        const scanLimit = intIn(ctx.config.scanLimit, 200, 1, 2000);
        ctx.progress('Reading bookmarks');
        const bookmarks = await fetchBookmarks(ctx, scanLimit);
        const moves = [];
        for (const b of bookmarks) {
          const text = String(b.text || '').toLowerCase();
          const author = String(b.author.username || '').toLowerCase();
          const rule = normalized.findIndex((r) => r.authors.includes(author) || r.keywords.some((k) => text.includes(k)));
          if (rule !== -1) moves.push({ tweetId: b.id, rule, url: b.url });
        }
        plan = { rules: normalized, moves, scanned: bookmarks.length };
      }

      // Resolve each rule's folder, creating missing ones by name.
      const folders = await listBookmarkFolders(ctx);
      const resolved = [];
      const created = [];
      for (const rule of plan.rules) {
        let folder = findFolder(folders, rule.folder);
        if (!folder) {
          if (NUMERIC_ID.test(rule.folder) || !createMissing) {
            throw new JobInputError(`No bookmark folder "${rule.folder}" exists on this account.`);
          }
          if (dryRun) {
            folder = { id: null, name: folderName(rule.folder) };
          } else {
            folder = await createFolder(ctx, folderName(rule.folder));
            folders.push(folder);
          }
          created.push(folder.name);
        }
        resolved.push(folder);
      }

      const { results, stopped } = await runBatch(ctx, plan.moves, {
        delayMs,
        paced: !dryRun,
        label: 'organizing bookmarks',
        refOf: (m) => ({ tweetId: m.tweetId, folder: resolved[m.rule].name }),
        act: async (move) => {
          const folder = resolved[move.rule];
          if (dryRun) return { tweetId: move.tweetId, folder: folder.name, status: 'would_move' };
          await moveToFolder(client, move.tweetId, folder.id);
          return { tweetId: move.tweetId, folder: folder.name, folderId: folder.id, status: 'moved' };
        },
      });

      return {
        success: true,
        dryRun,
        scanned: plan.scanned,
        matched: plan.moves.length,
        foldersCreated: created,
        counts: tally(results),
        results,
        stopped,
      };
    },
    write: true,
    description: 'Move bookmarks into folders by rule or by ID',
  },

  bookmarksSearch: {
    run: async (ctx) => {
      const query = String(ctx.require('query')).trim();
      const terms = searchTerms(query);
      if (!terms.length) throw new JobInputError('query is required');
      const from = ctx.config.from ? cleanUsername(ctx.config.from) : null;
      if (ctx.config.from && !from) throw new JobInputError('from is not a valid X username.');
      const limit = intIn(ctx.config.limit, 50, 1, 500);
      const scanLimit = intIn(ctx.config.scanLimit, 500, 1, 2000);

      ctx.progress('Reading bookmarks');
      const bookmarks = await fetchBookmarks(ctx, scanLimit);
      const matches = bookmarks.filter((b) => {
        if (from && b.author.username.toLowerCase() !== from.toLowerCase()) return false;
        const haystack = `${b.text} @${b.author.username} ${b.author.name} ${b.links.join(' ')}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      return {
        success: true,
        query,
        from,
        scanned: bookmarks.length,
        count: Math.min(matches.length, limit),
        totalMatches: matches.length,
        bookmarks: matches.slice(0, limit),
      };
    },
    concurrency: 3,
    description: 'Search the text, authors and links of bookmarks',
  },

  bookmarksClear: {
    run: async (ctx) => {
      const client = await ctx.http();
      await ctx.charge('delete');
      const data = await gql(client, 'BookmarksAllDelete', {}, { mutation: true });
      return { success: true, cleared: true, response: data?.bookmark_all_delete ?? null };
    },
    write: true,
    description: 'Remove every bookmark',
  },

  bookmarksImport: {
    run: async (ctx) => {
      const source = ctx.config.tweetIds ?? ctx.config.bookmarks ?? ctx.config.urls ?? ctx.config.items;
      const list = Array.isArray(source) ? source : source === undefined || source === null ? [] : [source];
      if (!list.length) throw new JobInputError('Send the posts to bookmark as tweetIds, urls or bookmarks (an export).');
      const parsed = list.map(tweetIdOf);
      const ids = [...new Set(parsed.filter(Boolean))];
      const unreadable = parsed.filter((id) => !id).length;
      if (!ids.length) throw new JobInputError('None of the items is a post ID or post URL.');
      if (ids.length > 500) throw new JobInputError('At most 500 bookmarks per job.');
      const dryRun = flag(ctx.config.dryRun);
      const delayMs = intIn(ctx.config.delayMs, 1500, 0, 60_000);
      const client = await ctx.http();

      let folder = null;
      const folderRef = ctx.config.folderId ?? ctx.config.folder;
      if (folderRef) {
        folder = findFolder(await listBookmarkFolders(ctx), folderRef);
        if (!folder) throw new JobInputError(`No bookmark folder "${folderRef}" exists on this account.`);
      }

      const { results, stopped } = await runBatch(ctx, ids, {
        delayMs,
        paced: !dryRun,
        label: 'importing bookmarks',
        refOf: (tweetId) => ({ tweetId }),
        act: async (tweetId) => {
          if (dryRun) return { tweetId, status: 'would_bookmark' };
          await ctx.charge('like');
          await bookmarkTweet(client, tweetId);
          if (folder) {
            await moveToFolder(client, tweetId, folder.id);
            return { tweetId, status: 'bookmarked', folder: folder.name };
          }
          return { tweetId, status: 'bookmarked' };
        },
      });

      return { success: true, dryRun, requested: ids.length, unreadable, folder, counts: tally(results), results, stopped };
    },
    write: true,
    description: 'Bookmark a list of posts, optionally into a folder',
  },

  // ---- Topics -------------------------------------------------------------

  topicFollow: {
    run: async (ctx) => {
      const topicId = String(ctx.require('topicId')).trim();
      if (!NUMERIC_ID.test(topicId)) throw new JobInputError('topicId must be the numeric ID of an X topic.');
      const client = await ctx.http();
      await ctx.charge('follow');
      await gql(client, 'TopicFollow', { topicId }, { mutation: true });
      return { success: true, topicId, following: true, url: `https://x.com/i/topics/${topicId}` };
    },
    write: true,
    description: 'Follow an X topic',
  },

  topicUnfollow: {
    run: async (ctx) => {
      const topicId = String(ctx.require('topicId')).trim();
      if (!NUMERIC_ID.test(topicId)) throw new JobInputError('topicId must be the numeric ID of an X topic.');
      const client = await ctx.http();
      await ctx.charge('unfollow');
      await gql(client, 'TopicUnfollow', { topicId }, { mutation: true });
      return { success: true, topicId, following: false, url: `https://x.com/i/topics/${topicId}` };
    },
    write: true,
    description: 'Unfollow an X topic',
  },

  topicDiscover: {
    run: async (ctx) => {
      const keyword = String(ctx.config.keyword ?? ctx.config.query ?? '').trim();
      const limit = intIn(ctx.config.limit, 50, 1, 200);
      const client = await ctx.http();
      const data = await gql(client, 'TopicToFollowSidebar', {});
      const topics = [...collectTopics(data).values()];
      if (!topics.length && findInstructions({ data }).length === 0) {
        throw new TwitterApiError('X answered TopicToFollowSidebar without topic suggestions.', {
          endpoint: 'TopicToFollowSidebar',
          data,
        });
      }
      const needle = keyword.toLowerCase();
      const matches = needle
        ? topics.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(needle))
        : topics;
      return {
        success: true,
        keyword: keyword || null,
        suggested: topics.length,
        count: Math.min(matches.length, limit),
        topics: matches.slice(0, limit),
      };
    },
    concurrency: 3,
    description: 'Topics X suggests to the account, filtered by keyword',
  },

  topicList: {
    run: async (ctx) => {
      const me = await viewer(ctx);
      const page = await ctx.page();
      ctx.progress(`Loading the topics page of @${me.username}`);
      const responses = await captureGraphql(page, `https://x.com/${me.username}/topics`);
      const topics = new Map();
      for (const body of responses) collectTopics(body, topics);
      const sawTimeline = responses.some((body) => findInstructions(body).length > 0);
      if (!topics.size && !sawTimeline) {
        throw new TwitterApiError('The topics page loaded without the followed-topics timeline.', {
          endpoint: `https://x.com/${me.username}/topics`,
        });
      }
      const followed = [...topics.values()].filter((t) => t.following);
      return { success: true, username: me.username, count: followed.length, topics: followed };
    },
    concurrency: 1,
    description: 'Topics the account follows',
  },
};
