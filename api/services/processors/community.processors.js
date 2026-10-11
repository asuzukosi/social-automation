// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * X Communities, Community Notes and Spaces.
 *
 * Every read and write here goes through the session's GraphQL client
 * (src/scrapers/twitter/http), the same calls x.com's own web client makes.
 * Two operations reach past it: the member list of a Community, which the
 * classic GraphQL bundle does not expose, is read from the members page in a
 * logged-in browser (only the page's own GraphQL responses are parsed, never
 * the DOM); and an AI voice agent joins a Space through the optional
 * `xspace-agent` package (src/spaces/agent.js).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JobInputError } from './context.js';
import {
  joinCommunity,
  leaveCommunity,
  parseCommunity,
  requestToJoinCommunity,
  scrapeCommunity,
  scrapeCommunityDiscovery,
  scrapeMyCommunities,
} from '../../../src/scrapers/twitter/http/communities.js';
import { scrapeAudioSpace } from '../../../src/scrapers/twitter/http/explore.js';
import { searchTweets } from '../../../src/scrapers/twitter/http/search.js';
import { scrapeProfile } from '../../../src/scrapers/twitter/http/profile.js';
import { parseUserData } from '../../../src/scrapers/twitter/http/parse/user.js';
import { findInstructions, flattenEntries } from '../../../src/scrapers/twitter/http/paging.js';
import { GRAPHQL, operationFeatures, resolveGraphQL } from '../../../src/scrapers/twitter/http/endpoints.js';
import { AuthError, NotFoundError, TwitterApiError } from '../../../src/scrapers/twitter/http/errors.js';

// ---------------------------------------------------------------------------
// Errors and input
// ---------------------------------------------------------------------------

/**
 * X answered, and the answer was empty. Retrying the same read gives the same
 * answer, so the job fails once with a message that says what was searched.
 */
class NoResultsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoResultsError';
    this.retryable = false;
  }
}

/** Roles that make the session a member of a Community. */
const MEMBER_ROLES = new Set(['Member', 'Moderator', 'Admin']);

/**
 * An integer config value clamped to a range.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 */
function clampInt(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Milliseconds to wait between writes. A caller may set `delayMs` (0 turns
 * pacing off); otherwise the default gets up to 50% jitter.
 * @param {object} config
 * @param {number} fallback
 */
function pacingOf(config, fallback) {
  const explicit = Number.parseInt(config.delayMs, 10);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return fallback + Math.floor(Math.random() * fallback * 0.5);
}

/**
 * A Community id from an id or a community URL.
 * @param {unknown} value
 */
function communityIdOf(value) {
  const s = String(value ?? '').trim();
  const fromUrl = s.match(/\/i\/communities\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  if (/^\d{5,25}$/.test(s)) return s;
  throw new JobInputError(`"${s}" is not a Community id or https://x.com/i/communities/<id> URL`);
}

/**
 * A post id from an id or a status URL.
 * @param {unknown} value
 */
function tweetIdOf(value) {
  const s = String(value ?? '').trim();
  const fromUrl = s.match(/\/status(?:es)?\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  if (/^\d{5,25}$/.test(s)) return s;
  throw new JobInputError(`"${s}" is not a post id or https://x.com/<user>/status/<id> URL`);
}

/**
 * A bare username from `@name`, `name` or a profile URL.
 * @param {unknown} value
 */
function usernameOf(value) {
  const s = String(value ?? '').trim();
  const fromUrl = s.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/);
  const name = fromUrl ? fromUrl[1] : s.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(name)) throw new JobInputError(`"${s}" is not an X username`);
  return name;
}

const SPACE_URL_RE = /\/i\/spaces\/([A-Za-z0-9]+)/;

/**
 * A Space id from `spaceId`, `spaceUrl` or `url`.
 * @param {object} config
 */
function spaceIdOf(config) {
  const raw = config.spaceId || config.spaceUrl || config.url;
  if (!raw) throw new JobInputError('spaceUrl or spaceId is required');
  const s = String(raw).trim();
  const fromUrl = s.match(SPACE_URL_RE);
  if (fromUrl) return fromUrl[1];
  if (/^[A-Za-z0-9]{8,24}$/.test(s)) return s;
  throw new JobInputError(`"${s}" is not a Space id or https://x.com/i/spaces/<id> URL`);
}

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

/**
 * Run a GraphQL mutation x.com ships but the curated table does not wrap, and
 * fail with X's own message when it refuses.
 *
 * @param {object} client
 * @param {string} operationName
 * @param {object} variables
 * @returns {Promise<object>} the response's `data`
 */
async function mutate(client, operationName, variables) {
  const { queryId } = resolveGraphQL(operationName);
  const features = operationFeatures(operationName);
  const response = await client.graphql(queryId, operationName, variables, {
    mutation: true,
    ...(Object.keys(features).length ? { features } : {}),
  });
  if (response?.errors?.length) {
    const message = response.errors.map((e) => e.message).join('; ');
    throw new TwitterApiError(`${operationName} failed: ${message}`, { endpoint: operationName, data: response });
  }
  return response?.data ?? {};
}

/**
 * The first Community object anywhere in a mutation's `data`.
 * @param {object} data
 * @returns {object|null}
 */
function findCommunityObject(data) {
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const node = stack.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (node.__typename === 'Community' || (node.rest_id && typeof node.name === 'string' && 'member_count' in node)) {
      return node;
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
  }
  return null;
}

/**
 * Communities referenced by posts matching a query, from the global community
 * post search. Each post carries the Community it was posted in.
 *
 * @param {object} client
 * @param {string} query
 * @param {number} maxPages
 * @returns {Promise<Map<string, {community: object, partial: boolean, posts: number}>>}
 */
async function communitiesFromPosts(client, query, maxPages) {
  const { queryId, operationName } = GRAPHQL.GlobalCommunitiesPostSearchTimeline;
  const refs = new Map();
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const variables = { rawQuery: query, count: 20, querySource: 'typed_query', withCommunity: true };
    if (cursor) variables.cursor = cursor;
    const response = await client.graphql(queryId, operationName, variables);
    const instructions = findInstructions(response, 'data.search_by_raw_query.search_timeline.timeline.instructions');
    const { entries, cursor: next } = flattenEntries(instructions);
    for (const entry of entries) {
      let tweet = entry?.content?.itemContent?.tweet_results?.result;
      if (tweet?.__typename === 'TweetWithVisibilityResults') tweet = tweet.tweet;
      const raw = tweet?.community_results?.result ?? tweet?.author_community_relationship?.community_results?.result;
      const community = parseCommunity(raw);
      if (!community?.id) continue;
      const known = refs.get(community.id);
      if (known) known.posts += 1;
      else refs.set(community.id, { community, partial: raw.member_count == null, posts: 1 });
    }
    if (!next || entries.length === 0) break;
    cursor = next;
  }
  return refs;
}

/**
 * How well a Community matches a search term: 3 name, 2 description, 1 topic.
 * @param {object} community
 * @param {string} needle lower-cased
 */
function matchScore(community, needle) {
  if (community.name.toLowerCase().includes(needle)) return 3;
  if (community.description.toLowerCase().includes(needle)) return 2;
  if ((community.topic || '').toLowerCase().includes(needle)) return 1;
  return 0;
}

/**
 * Find Communities for a search term. X has no Community-name search, so this
 * reads the two surfaces that do list Communities: the discovery feed, and
 * the Communities that posts matching the term were made in. Results are
 * ranked by name match, then how many matching posts each has, then size.
 *
 * @param {object} ctx
 * @param {object} client
 * @param {string} query
 * @param {number} limit
 */
async function findCommunities(ctx, client, query, limit) {
  const needle = query.toLowerCase();
  ctx.progress(`Reading the Communities discovery feed for "${query}"`);
  const discovered = await scrapeCommunityDiscovery(client, { limit: 100 });
  ctx.throwIfCancelled();
  ctx.progress(`Searching Community posts for "${query}"`);
  const fromPosts = await communitiesFromPosts(client, query, 3);

  const candidates = new Map();
  for (const community of discovered) {
    const score = matchScore(community, needle);
    if (score > 0) candidates.set(community.id, { community, partial: false, posts: 0, source: 'discovery' });
  }
  for (const [id, ref] of fromPosts) {
    const known = candidates.get(id);
    if (known) known.posts = ref.posts;
    else candidates.set(id, { ...ref, source: 'posts' });
  }

  const ranked = [...candidates.values()].sort(
    (a, b) =>
      matchScore(b.community, needle) - matchScore(a.community, needle) ||
      b.posts - a.posts ||
      b.community.memberCount - a.community.memberCount,
  );

  const results = [];
  for (const candidate of ranked) {
    if (results.length >= limit) break;
    ctx.throwIfCancelled();
    let { community } = candidate;
    if (candidate.partial) {
      try {
        community = await scrapeCommunity(client, community.id);
      } catch (err) {
        if (err instanceof NotFoundError) continue;
        throw err;
      }
    }
    results.push({ ...community, matchingPosts: candidate.posts, foundVia: candidate.source, relevance: matchScore(community, needle) });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Community Notes
// ---------------------------------------------------------------------------

/**
 * @param {number|string|null} raw epoch ms
 */
function isoFromMs(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(Number(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One Community Note in the XActions shape.
 * @param {object} raw
 * @param {string} group `misleading` / `not_misleading` / the key it came from
 */
function parseNote(raw, group) {
  const body = raw.data_v1 ?? raw;
  const id = raw.rest_id ?? raw.note_id ?? null;
  return {
    id,
    group,
    text: body.summary?.text ?? '',
    classification: body.classification ?? null,
    misleadingTags: body.misleading_tags ?? [],
    notMisleadingTags: body.not_misleading_tags ?? [],
    trustworthySources: body.trustworthy_sources ?? null,
    status: raw.rating_status ?? raw.status ?? null,
    helpfulTags: raw.helpful_tags ?? [],
    notHelpfulTags: raw.not_helpful_tags ?? [],
    language: raw.language ?? null,
    createdAt: isoFromMs(raw.created_at),
    url: id ? `https://x.com/i/birdwatch/n/${id}` : null,
  };
}

/**
 * Pull every note list (`*_birdwatch_notes.notes`) and the note X shows under
 * the post (`birdwatch_pivot`) out of a BirdwatchFetchNotes response.
 * @param {object} data
 */
function extractNotes(data) {
  const notes = [];
  let shown = null;
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith('birdwatch_notes') && Array.isArray(value?.notes)) {
        const group = key.replace(/_?birdwatch_notes$/, '') || 'notes';
        for (const raw of value.notes) if (raw && typeof raw === 'object') notes.push(parseNote(raw, group));
      } else if (key === 'birdwatch_pivot' && value && typeof value === 'object' && !shown) {
        const noteId = value.note?.rest_id ?? null;
        shown = {
          id: noteId,
          title: value.title ?? value.shorttitle ?? null,
          text: value.subtitle?.text ?? '',
          url: value.destinationUrl ?? (noteId ? `https://x.com/i/birdwatch/n/${noteId}` : null),
        };
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return { notes, shown };
}

// ---------------------------------------------------------------------------
// Community members (browser)
// ---------------------------------------------------------------------------

const MEMBER_OPERATION_RE = /\/i\/api\/graphql\/[^/]+\/[^/?]*(?:member|moderator)/i;

/**
 * Record every user in a members-page GraphQL response, with the Community
 * role X attaches to it when there is one.
 * @param {object} json
 * @param {Map<string, object>} members
 */
function collectMembers(json, members) {
  // Breadth first, so members keep the order the page lists them in.
  const queue = [json];
  const seen = new Set();
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const wrapped = node.user_results?.result ?? node.result;
    const user = wrapped?.__typename === 'User' ? wrapped : node.__typename === 'User' ? node : null;
    if (user?.rest_id && !members.has(user.rest_id)) {
      try {
        const profile = parseUserData(user);
        const role = user === wrapped ? node.community_role ?? node.role ?? null : null;
        members.set(user.rest_id, {
          id: profile.id,
          username: profile.username,
          name: profile.name,
          bio: profile.bio ?? '',
          verified: Boolean(profile.verified),
          followersCount: profile.followersCount ?? 0,
          avatar: profile.avatar ?? null,
          role,
        });
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') queue.push(value);
  }
}

/**
 * Read a Community's member list from its members page, scrolling until the
 * limit is reached or three scrolls in a row add nobody.
 *
 * @param {object} ctx
 * @param {string} communityId
 * @param {number} limit
 */
async function membersFromBrowser(ctx, communityId, limit) {
  const page = await ctx.page();
  const members = new Map();
  const pending = [];
  const onResponse = (response) => {
    if (!MEMBER_OPERATION_RE.test(response.url())) return;
    pending.push(
      response
        .json()
        .then((json) => collectMembers(json, members))
        .catch(() => {}),
    );
  };
  page.on('response', onResponse);
  try {
    const target = `https://x.com/i/communities/${communityId}/members`;
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 45_000 });
    if (/\/(?:i\/flow\/)?login/.test(page.url())) {
      throw new AuthError('x.com sent the session to the login page; the session has expired.', { endpoint: target });
    }
    await Promise.all(pending.splice(0));
    let idle = 0;
    while (members.size < limit && idle < 3) {
      ctx.throwIfCancelled();
      const before = members.size;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3));
      await ctx.sleep(1500);
      await Promise.all(pending.splice(0));
      idle = members.size === before ? idle + 1 : 0;
      ctx.progress(`Read ${members.size} members`, { fetched: members.size, limit });
    }
  } finally {
    page.off('response', onResponse);
  }
  return [...members.values()].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

/**
 * Space ids linked from a post (its expanded URLs, quoted post and text).
 * @param {object} tweet parsed tweet
 * @returns {string[]}
 */
function spaceIdsIn(tweet) {
  const sources = [
    tweet.text,
    ...(tweet.urls ?? []).map((u) => u.expandedUrl),
    ...(tweet.quotedTweet?.urls ?? []).map((u) => u.expandedUrl),
  ];
  const ids = [];
  for (const source of sources) {
    const match = typeof source === 'string' && source.match(SPACE_URL_RE);
    if (match) ids.push(match[1]);
  }
  return ids;
}

const SPACE_ENDED_STATES = new Set(['Ended', 'Canceled', 'TimedOut']);

const isLive = (space) => space.state === 'Running';
const isScheduled = (space) =>
  space.state === 'NotStarted' ||
  (Boolean(space.scheduledStart) && !space.startedAt && !space.endedAt && !SPACE_ENDED_STATES.has(space.state));

/**
 * Find Spaces in a given state. X's search indexes the posts that share a
 * Space (`filter:spaces`); each linked Space is then read with AudioSpaceById,
 * so every result carries X's own current state rather than a guess from the
 * post's age.
 *
 * @param {object} ctx
 * @param {(space: object) => boolean} wanted
 * @param {string} label for progress and errors
 */
async function findSpaces(ctx, wanted, label) {
  const client = await ctx.http();
  const limit = clampInt(ctx.config.limit, 20, 50);
  const topic = typeof ctx.config.topic === 'string' ? ctx.config.topic.trim() : '';
  const query = topic ? `${topic} filter:spaces` : 'filter:spaces';

  ctx.progress(`Searching posts that share Spaces${topic ? ` about "${topic}"` : ''}`);
  const tweets = await searchTweets(client, query, { type: 'Latest', limit: Math.min(Math.max(limit * 5, 40), 200) });

  const candidates = [];
  const seen = new Set();
  for (const tweet of tweets) {
    for (const id of spaceIdsIn(tweet)) {
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push({ id, sharedBy: tweet.author?.username || null, postId: tweet.id });
    }
  }

  const spaces = [];
  let checked = 0;
  for (const candidate of candidates) {
    if (spaces.length >= limit) break;
    ctx.throwIfCancelled();
    if (checked > 0) await ctx.sleep(250);
    checked += 1;
    let space;
    try {
      space = await scrapeAudioSpace(client, candidate.id);
    } catch (err) {
      if (err instanceof NotFoundError) continue;
      throw err;
    }
    if (wanted(space)) {
      spaces.push({ ...space, sharedBy: candidate.sharedBy, sharedInPost: candidate.postId });
      ctx.progress(`Found ${spaces.length} ${label} Spaces`, { found: spaces.length, checked });
    }
  }

  if (spaces.length === 0) {
    throw new NoResultsError(
      `No ${label} Spaces found${topic ? ` about "${topic}"` : ''}: ${tweets.length} recent posts shared ${candidates.length} Spaces and none is ${label}.`,
    );
  }
  return { success: true, topic: topic || null, count: spaces.length, postsSearched: tweets.length, spacesChecked: checked, spaces };
}

/** The API key each xspace-agent LLM provider needs. */
const SPACE_PROVIDER_KEYS = Object.freeze({ openai: 'OPENAI_API_KEY', claude: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY' });

/**
 * @param {unknown} value
 * @returns {'openai'|'claude'|'groq'}
 */
function spaceProviderOf(value) {
  const name = String(value || 'openai').trim().toLowerCase();
  const provider = name === 'anthropic' ? 'claude' : name;
  if (!SPACE_PROVIDER_KEYS[provider]) {
    throw new JobInputError(`provider must be one of ${Object.keys(SPACE_PROVIDER_KEYS).join(', ')} (got "${value}")`);
  }
  return provider;
}

/**
 * @param {string} header
 * @returns {Record<string, string>}
 */
function cookiesOf(header) {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([name, value]) => name && value)
      .map(([name, ...rest]) => [name, rest.join('=')]),
  );
}

/**
 * Wait, returning false instead of throwing when the job is cancelled, so a
 * Space session can leave cleanly and keep its transcript.
 * @param {object} ctx
 * @param {number} ms
 */
async function waitUnlessCancelled(ctx, ms) {
  try {
    await ctx.sleep(ms);
    return true;
  } catch (err) {
    if (err?.name === 'JobCancelledError') return false;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Community write helpers
// ---------------------------------------------------------------------------

/**
 * Rules as `{ name, description }`, from an array of strings or objects, or
 * a newline-separated string. X allows at most ten.
 * @param {unknown} rules
 */
function rulesOf(rules) {
  if (rules == null || rules === '') return [];
  const list = typeof rules === 'string' ? rules.split('\n') : Array.isArray(rules) ? rules : null;
  if (!list) throw new JobInputError('rules must be an array of strings or { name, description } objects');
  const parsed = list
    .map((rule) =>
      typeof rule === 'string'
        ? { name: rule.trim(), description: '' }
        : { name: String(rule?.name ?? '').trim(), description: String(rule?.description ?? '').trim() },
    )
    .filter((rule) => rule.name);
  if (parsed.length > 10) throw new JobInputError(`X allows at most 10 Community rules (got ${parsed.length})`);
  return parsed;
}

const MANAGE_ACTIONS = Object.freeze({
  view: 'view',
  info: 'view',
  invite: 'invite',
  promote: 'promote',
  'make-moderator': 'promote',
  'add-moderator': 'promote',
  demote: 'demote',
  'remove-moderator': 'demote',
});

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

export default {
  communityJoin: {
    run: async (ctx) => {
      const client = await ctx.http();
      const keyword = typeof ctx.config.keyword === 'string' ? ctx.config.keyword.trim() : '';
      let community;
      if (ctx.config.communityId) {
        community = await scrapeCommunity(client, communityIdOf(ctx.config.communityId));
      } else {
        if (!keyword) throw new JobInputError('communityId or keyword is required');
        const matches = await findCommunities(ctx, client, keyword, 10);
        community = matches.find((c) => c.relevance >= 2);
        if (!community) {
          throw new NoResultsError(
            `No Community whose name or description mentions "${keyword}" was found. Pass communityId to join a specific one.`,
          );
        }
      }

      const base = { communityId: community.id, matchedBy: ctx.config.communityId ? 'id' : 'keyword', keyword: keyword || null };
      if (MEMBER_ROLES.has(community.role)) {
        return { success: true, action: 'none', alreadyMember: true, role: community.role, community, ...base };
      }

      const restricted = Boolean(community.joinPolicy) && community.joinPolicy !== 'Open';
      await ctx.charge('follow');
      ctx.progress(`${restricted ? 'Requesting to join' : 'Joining'} ${community.name}`);
      const outcome = restricted
        ? await requestToJoinCommunity(client, community.id)
        : await joinCommunity(client, community.id);
      if (!outcome.success) {
        throw new TwitterApiError(`X did not confirm the ${restricted ? 'join request' : 'join'} for Community ${community.id}`, {
          endpoint: restricted ? 'RequestToJoinCommunity' : 'JoinCommunity',
        });
      }
      return {
        success: true,
        action: restricted ? 'requested' : 'joined',
        pendingApproval: restricted,
        role: outcome.role,
        community: outcome.community ?? community,
        ...base,
      };
    },
    write: true,
    description: 'Join a Community by id, or the best match for a keyword',
  },

  communityLeave: {
    run: async (ctx) => {
      const client = await ctx.http();
      const communityId = communityIdOf(ctx.require('communityId'));
      const community = await scrapeCommunity(client, communityId);
      if (!MEMBER_ROLES.has(community.role)) {
        return { success: true, action: 'none', wasMember: false, communityId, community };
      }
      if (community.role === 'Admin') {
        throw new JobInputError(`You are the admin of ${community.name}; X does not let an admin leave their own Community.`);
      }
      await ctx.charge('unfollow');
      const outcome = await leaveCommunity(client, communityId);
      if (!outcome.success) {
        throw new TwitterApiError(`X did not confirm leaving Community ${communityId}`, { endpoint: 'LeaveCommunity' });
      }
      return { success: true, action: 'left', wasMember: true, previousRole: community.role, communityId, community: outcome.community };
    },
    write: true,
    description: 'Leave one Community',
  },

  communityLeaveAll: {
    run: async (ctx) => {
      const client = await ctx.http();
      const max = clampInt(ctx.config.max ?? ctx.config.limit, 500, 1000);
      const dryRun = ctx.config.dryRun === true;
      ctx.progress('Reading your Communities');
      const communities = await scrapeMyCommunities(client, { limit: max });
      const joined = communities.filter((c) => MEMBER_ROLES.has(c.role));

      const results = [];
      let stoppedReason = null;
      for (const [index, community] of joined.entries()) {
        ctx.throwIfCancelled();
        const item = { communityId: community.id, name: community.name, role: community.role };
        if (community.role === 'Admin') {
          results.push({ ...item, status: 'skipped', reason: 'admins cannot leave their own Community' });
          continue;
        }
        if (dryRun) {
          results.push({ ...item, status: 'would-leave' });
          continue;
        }
        if (results.some((r) => r.status === 'left' || r.status === 'failed')) await ctx.sleep(pacingOf(ctx.config, 3000));
        try {
          await ctx.charge('unfollow');
        } catch (err) {
          if (err?.name !== 'ActionCapExceededError') throw err;
          stoppedReason = err.message;
          for (const rest of joined.slice(index)) {
            results.push({ communityId: rest.id, name: rest.name, role: rest.role, status: 'not-attempted' });
          }
          break;
        }
        try {
          const outcome = await leaveCommunity(client, community.id);
          results.push({ ...item, status: outcome.success ? 'left' : 'failed', ...(outcome.success ? {} : { error: 'X did not confirm the leave' }) });
        } catch (err) {
          if (err instanceof AuthError) throw err;
          results.push({ ...item, status: 'failed', error: err.message });
        }
        ctx.progress(`Left ${results.filter((r) => r.status === 'left').length} of ${joined.length}`);
      }

      const count = (status) => results.filter((r) => r.status === status).length;
      return {
        success: true,
        dryRun,
        total: joined.length,
        left: count('left'),
        wouldLeave: count('would-leave'),
        skipped: count('skipped'),
        failed: count('failed'),
        notAttempted: count('not-attempted'),
        ...(stoppedReason ? { stoppedReason } : {}),
        results,
      };
    },
    write: true,
    concurrency: 1,
    description: 'Leave every Community the account belongs to (admins are skipped)',
  },

  communityCreate: {
    run: async (ctx) => {
      const name = String(ctx.require('name')).trim();
      if (!name) throw new JobInputError('name is required');
      const description = ctx.config.description ? String(ctx.config.description).trim() : '';
      const rules = rulesOf(ctx.config.rules);
      const client = await ctx.http();

      await ctx.charge('post');
      ctx.progress(`Creating Community "${name}"`);
      const data = await mutate(client, 'CreateCommunity', { name, description });
      const community = parseCommunity(findCommunityObject(data));
      if (!community?.id) {
        throw new TwitterApiError('X accepted CreateCommunity but returned no Community', { endpoint: 'CreateCommunity', data });
      }

      const ruleResults = [];
      for (const rule of rules) {
        ctx.throwIfCancelled();
        await ctx.sleep(pacingOf(ctx.config, 1500));
        try {
          await mutate(client, 'CommunityCreateRule', { communityId: community.id, name: rule.name, description: rule.description });
          ruleResults.push({ ...rule, status: 'added' });
        } catch (err) {
          if (err instanceof AuthError) throw err;
          ruleResults.push({ ...rule, status: 'failed', error: err.message });
        }
      }

      return {
        success: true,
        communityId: community.id,
        url: community.url,
        community,
        rulesAdded: ruleResults.filter((r) => r.status === 'added').length,
        rules: ruleResults,
      };
    },
    write: true,
    concurrency: 1,
    description: 'Create a Community, with its rules',
  },

  communityManage: {
    run: async (ctx) => {
      const communityId = communityIdOf(ctx.require('communityId'));
      const requested = String(ctx.config.action || 'view').trim().toLowerCase();
      const action = MANAGE_ACTIONS[requested];
      if (!action) {
        throw new JobInputError(`action must be one of ${Object.keys(MANAGE_ACTIONS).join(', ')} (got "${ctx.config.action}")`);
      }
      const client = await ctx.http();
      const community = await scrapeCommunity(client, communityId);
      if (action === 'view') return { success: true, action, communityId, community };

      const username = usernameOf(ctx.require('targetUsername'));
      if ((action === 'promote' || action === 'demote') && community.role !== 'Admin') {
        throw new JobInputError(`Only the admin of ${community.name} can change moderator roles (your role: ${community.role}).`);
      }
      if (action === 'invite' && !MEMBER_ROLES.has(community.role)) {
        throw new JobInputError(`Join ${community.name} before inviting others to it.`);
      }
      const target = await scrapeProfile(client, username);

      if (action === 'invite') {
        await ctx.charge('dm');
        await mutate(client, 'CommunityUserInvite', { communityId, userId: target.id });
      } else {
        await ctx.charge('follow');
        await mutate(client, 'CommunityUpdateRole', {
          communityId,
          userId: target.id,
          role: action === 'promote' ? 'Moderator' : 'Member',
        });
      }
      return {
        success: true,
        action,
        communityId,
        community: { id: community.id, name: community.name, url: community.url },
        target: { id: target.id, username: target.username, name: target.name },
        ...(action === 'invite' ? {} : { newRole: action === 'promote' ? 'Moderator' : 'Member' }),
      };
    },
    write: true,
    description: 'View a Community, invite a user, or promote/demote a moderator',
  },

  communityNotes: {
    run: async (ctx) => {
      const tweetId = tweetIdOf(ctx.require('tweetId'));
      const action = String(ctx.config.action || 'view').trim().toLowerCase();
      if (action !== 'view' && action !== 'request') {
        throw new JobInputError(`action must be "view" or "request" (got "${ctx.config.action}")`);
      }
      const client = await ctx.http();

      if (action === 'request') {
        await ctx.charge('post');
        await mutate(client, 'BirdwatchCreateBatSignal', { tweet_id: tweetId });
        return { success: true, action, tweetId, url: `https://x.com/i/status/${tweetId}` };
      }

      const operationName = 'BirdwatchFetchNotes';
      const { queryId } = resolveGraphQL(operationName);
      const response = await client.graphql(queryId, operationName, { tweet_id: tweetId }, { features: operationFeatures(operationName) });
      if (response?.errors?.length && !response?.data) {
        const message = response.errors.map((e) => e.message).join('; ');
        throw new TwitterApiError(`${operationName} failed: ${message}`, { endpoint: operationName, data: response });
      }
      const data = response?.data;
      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        throw new NotFoundError(`X returned no Community Notes data for post ${tweetId}`, { endpoint: operationName });
      }
      const { notes, shown } = extractNotes(data);
      return {
        success: true,
        action,
        tweetId,
        shownNote: shown,
        count: notes.length,
        notes,
        ...(notes.length === 0 && !shown ? { message: `Post ${tweetId} has no Community Notes.` } : {}),
      };
    },
    description: 'Read the Community Notes on a post, or request one',
  },

  communityList: {
    run: async (ctx) => {
      const client = await ctx.http();
      const communities = await scrapeMyCommunities(client, { limit: clampInt(ctx.config.limit, 200, 1000) });
      if (communities.length === 0) throw new NoResultsError('This account is not a member of any Community.');
      const byRole = {};
      for (const c of communities) byRole[c.role] = (byRole[c.role] ?? 0) + 1;
      return { success: true, count: communities.length, byRole, communities };
    },
    concurrency: 3,
    description: 'List the Communities the account belongs to',
  },

  communityMembers: {
    run: async (ctx) => {
      const communityId = communityIdOf(ctx.require('communityId'));
      const limit = clampInt(ctx.config.limit, 100, 1000);
      const client = await ctx.http();
      const community = await scrapeCommunity(client, communityId);
      ctx.progress(`Reading members of ${community.name}`);
      const members = await membersFromBrowser(ctx, communityId, limit);
      if (members.length === 0) {
        throw new NoResultsError(
          `x.com listed no members for ${community.name} (${communityId}). The member list may be visible to members only.`,
        );
      }
      return {
        success: true,
        communityId,
        community: { id: community.id, name: community.name, memberCount: community.memberCount, url: community.url },
        count: members.length,
        complete: members.length >= community.memberCount,
        members,
      };
    },
    concurrency: 1,
    description: 'List the members of a Community',
  },

  communitySearch: {
    run: async (ctx) => {
      const query = String(ctx.require('query')).trim();
      if (!query) throw new JobInputError('query is required');
      const limit = clampInt(ctx.config.limit, 20, 100);
      const client = await ctx.http();
      const communities = await findCommunities(ctx, client, query, limit);
      if (communities.length === 0) {
        throw new NoResultsError(`No Communities found for "${query}" in the discovery feed or in Community posts.`);
      }
      return { success: true, query, count: communities.length, communities };
    },
    concurrency: 3,
    description: 'Find Communities by name, description or what their members post',
  },

  scrapeSpace: {
    run: async (ctx) => {
      const spaceId = spaceIdOf(ctx.config);
      const client = await ctx.http();
      const space = await scrapeAudioSpace(client, spaceId);
      return { success: true, space };
    },
    concurrency: 3,
    description: 'Read a Space: state, host, speakers, listeners and counts',
  },

  getLiveSpaces: {
    run: (ctx) => findSpaces(ctx, isLive, 'live'),
    concurrency: 2,
    description: 'Find live Spaces, optionally about a topic',
  },

  getScheduledSpaces: {
    run: (ctx) => findSpaces(ctx, isScheduled, 'scheduled'),
    concurrency: 2,
    description: 'Find scheduled Spaces, optionally about a topic',
  },

  spaceJoin: {
    run: async (ctx) => {
      const spaceId = spaceIdOf(ctx.config);
      const url = `https://x.com/i/spaces/${spaceId}`;
      const provider = spaceProviderOf(ctx.config.provider);
      const client = await ctx.http();

      const space = await scrapeAudioSpace(client, spaceId);
      if (!isLive(space)) {
        throw new JobInputError(`Space ${spaceId} is not live (state: ${space.state}); an agent can only join a running Space.`);
      }
      const envVar = SPACE_PROVIDER_KEYS[provider];
      const apiKey = process.env[envVar];
      if (!apiKey) {
        throw new JobInputError(`${envVar} is not set on this server; the ${provider} provider needs it to listen and speak in a Space.`);
      }
      const cookies = cookiesOf(await ctx.cookieHeader());

      const agent = await import('../../../src/spaces/agent.js');
      ctx.progress(`Joining Space "${space.title}"`);
      let joined;
      try {
        joined = await agent.joinSpace({
          url,
          provider,
          apiKey,
          systemPrompt: ctx.config.systemPrompt || undefined,
          model: ctx.config.model || undefined,
          authToken: cookies.auth_token,
          ct0: cookies.ct0,
        });
      } catch (err) {
        // A missing package or a Space agent already running here fail the
        // same way on every retry.
        if (/xspace-agent is not installed|already active in a Space/.test(err.message)) throw new JobInputError(err.message);
        throw err;
      }

      const joinedAt = new Date().toISOString();
      let transcript = [];
      let endedBy = 'space-ended';
      let summary = null;
      const snapshot = () => {
        const current = agent.getSpaceTranscript({ limit: Number.MAX_SAFE_INTEGER });
        if (current.success) transcript = current.transcriptions;
      };
      try {
        for (;;) {
          const status = agent.getSpaceAgentStatus();
          if (!status.active) break;
          snapshot();
          ctx.progress(`In Space "${space.title}"`, {
            transcriptions: status.transcriptions,
            responses: status.responses,
            duration: status.duration,
          });
          if (!(await waitUnlessCancelled(ctx, 5000))) {
            endedBy = 'left';
            break;
          }
        }
      } finally {
        if (agent.getSpaceAgentStatus().active) {
          snapshot();
          summary = await agent.leaveSpace();
        }
      }

      return {
        success: true,
        spaceId,
        url,
        title: space.title,
        host: space.creator?.username ?? null,
        provider: joined.provider,
        joinedAt,
        leftAt: new Date().toISOString(),
        endedBy,
        duration: summary?.duration ?? null,
        responses: summary?.responses ?? null,
        transcript: transcript.map((e) => ({ speaker: e.speaker ?? 'unknown', text: e.text ?? '', timestamp: e.timestamp ?? null })),
      };
    },
    write: true,
    concurrency: 1,
    description: 'Join a live Space with an AI voice agent until it ends or the job is cancelled',
  },
};
