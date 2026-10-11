// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter/X Communities via HTTP (GraphQL)
 *
 * Community details, community post timelines (latest / top / media),
 * post search across communities, the communities you belong to, the
 * discovery feed, and the join / leave / request-to-join mutations.
 *
 * Query IDs were read from the live x.com bundles on 2026-08-27
 * (`discoverQueryIds({ scope: 'full' })`). The classic bundle carries no
 * member-list, moderator-list, or community-name-search operation, so those
 * are not offered here: `CommunityMemberRelationshipTypeahead` is a prefix
 * typeahead, not a listing, and the only search operations are post
 * searches (`GlobalCommunitiesPostSearchTimeline`).
 *
 * Depends on: endpoints.js, paging.js, tweets.js, relationships.js
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { GRAPHQL } from './endpoints.js';
import { NotFoundError, TwitterApiError } from './errors.js';
import { parseTweetData } from './tweets.js';
import { parseUserEntry } from './relationships.js';
import { flattenEntries, paginate, requireAuth } from './paging.js';

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse Twitter's `created_at` (epoch ms or date string) to ISO-8601.
 * @param {number|string|null} raw
 * @returns {string|null}
 */
function toISODate(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pick the largest banner URL out of a community media object.
 * @param {object|null} media `custom_banner_media` or `default_banner_media`
 * @returns {string|null}
 */
function bannerUrl(media) {
  const info = media?.media_info ?? media;
  return info?.original_img_url ?? info?.url ?? null;
}

/**
 * Parse a raw `Community` result into the XActions community format.
 *
 * @param {object} raw `community_results.result` / `communityResults.result`
 * @returns {object|null} null when the community is unavailable
 */
export function parseCommunity(raw) {
  if (!raw || raw.__typename === 'CommunityUnavailable') return null;

  const topic = raw.primary_community_topic ?? {};
  return {
    id: raw.rest_id ?? raw.id_str ?? null,
    name: raw.name ?? '',
    description: raw.description ?? '',
    createdAt: toISODate(raw.created_at),
    memberCount: raw.member_count ?? 0,
    moderatorCount: raw.moderator_count ?? 0,
    joinPolicy: raw.join_policy ?? null,
    invitesPolicy: raw.invites_policy ?? null,
    role: raw.role ?? 'NonMember',
    isNsfw: Boolean(raw.is_nsfw),
    isPinned: Boolean(raw.is_pinned),
    topic: topic.topic_name ?? null,
    topicId: topic.topic_id ?? null,
    banner: bannerUrl(raw.custom_banner_media) ?? bannerUrl(raw.default_banner_media),
    admin: parseUserEntry(raw.admin_results?.result),
    creator: parseUserEntry(raw.creator_results?.result),
    rules: (raw.rules ?? []).map((r) => ({ id: r.rest_id ?? null, name: r.name ?? '', description: r.description ?? '' })),
    url: raw.rest_id ? `https://x.com/i/communities/${raw.rest_id}` : null,
    platform: 'twitter',
  };
}

/**
 * Extract a community result from a timeline entry, wherever it sits.
 * @param {object} entry
 * @returns {object|null}
 */
function communityFromEntry(entry) {
  const ic = entry?.content?.itemContent ?? {};
  return ic.community_results?.result ?? ic.communityResults?.result ?? entry?.content?.community_results?.result ?? null;
}

/**
 * Parse a communities list timeline (memberships / discovery) into
 * community objects plus the bottom cursor.
 *
 * @param {object[]} instructions
 * @returns {{ items: object[], cursor: string|null }}
 */
export function parseCommunityList(instructions) {
  const { entries, cursor } = flattenEntries(instructions);
  const items = [];
  for (const entry of entries) {
    const parsed = parseCommunity(communityFromEntry(entry));
    if (parsed && parsed.id) items.push(parsed);
  }
  return { items, cursor };
}

/**
 * Parse a tweet timeline (community posts / search) into tweet objects.
 *
 * @param {object[]} instructions
 * @returns {{ items: object[], cursor: string|null }}
 */
export function parseCommunityTweets(instructions) {
  const { entries, cursor } = flattenEntries(instructions);
  const items = [];
  for (const entry of entries) {
    const result = entry?.content?.itemContent?.tweet_results?.result;
    if (!result) continue;
    const parsed = parseTweetData(result);
    if (parsed && parsed.id) items.push(parsed);
  }
  return { items, cursor };
}

// ---------------------------------------------------------------------------
// Community details
// ---------------------------------------------------------------------------

/**
 * Fetch a community by ID (`CommunityByRestId`).
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} communityId
 * @returns {Promise<object>} Parsed community
 * @throws {NotFoundError} when the community does not exist or is unavailable
 */
export async function scrapeCommunity(client, communityId) {
  requireAuth(client, 'CommunityByRestId');
  const { queryId, operationName } = GRAPHQL.CommunityByRestId;
  const response = await client.graphql(queryId, operationName, { communityId: String(communityId) });

  const raw = response?.data?.communityResults?.result ?? response?.data?.community_results?.result;
  const parsed = parseCommunity(raw);
  if (!parsed) {
    throw new NotFoundError(`Community ${communityId} not found or unavailable`, { endpoint: operationName });
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Community timelines
// ---------------------------------------------------------------------------

/**
 * Scrape a community's post timeline (`CommunityTweetsTimeline`).
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} communityId
 * @param {object} [options]
 * @param {'latest'|'top'} [options.ranking='latest'] Recency or relevance ordering
 * @param {number} [options.limit=100]
 * @param {string|null} [options.cursor=null]
 * @param {Function} [options.onProgress]
 * @returns {Promise<object[]>} Parsed tweets
 */
export async function scrapeCommunityTweets(client, communityId, options = {}) {
  requireAuth(client, 'CommunityTweetsTimeline');
  const rankingMode = options.ranking === 'top' ? 'Relevance' : 'Recency';
  return paginate(
    client,
    GRAPHQL.CommunityTweetsTimeline,
    { communityId: String(communityId), displayLocation: 'Community', rankingMode, withCommunity: true },
    parseCommunityTweets,
    { ...options, path: 'data.communityResults.result.ranked_community_timeline.timeline.instructions' },
  );
}

/**
 * Scrape a community's media posts (`CommunityMediaTimeline`).
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} communityId
 * @param {object} [options] `{ limit, cursor, onProgress }`
 * @returns {Promise<object[]>} Parsed tweets with media
 */
export async function scrapeCommunityMedia(client, communityId, options = {}) {
  requireAuth(client, 'CommunityMediaTimeline');
  return paginate(
    client,
    GRAPHQL.CommunityMediaTimeline,
    { communityId: String(communityId), withCommunity: true },
    parseCommunityTweets,
    { ...options, path: 'data.communityResults.result.community_media_timeline.timeline.instructions' },
  );
}

/**
 * Search posts across all communities (`GlobalCommunitiesPostSearchTimeline`
 * / `GlobalCommunitiesLatestPostSearchTimeline`).
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} query Search query (advanced syntax allowed)
 * @param {object} [options]
 * @param {'top'|'latest'} [options.ranking='top']
 * @param {number} [options.limit=100]
 * @param {string|null} [options.cursor=null]
 * @param {Function} [options.onProgress]
 * @returns {Promise<object[]>} Parsed tweets
 */
export async function searchCommunityTweets(client, query, options = {}) {
  if (!query || typeof query !== 'string') {
    throw new TwitterApiError('searchCommunityTweets requires a non-empty query');
  }
  requireAuth(client, 'GlobalCommunitiesPostSearchTimeline');
  const endpoint = options.ranking === 'latest'
    ? GRAPHQL.GlobalCommunitiesLatestPostSearchTimeline
    : GRAPHQL.GlobalCommunitiesPostSearchTimeline;
  return paginate(
    client,
    endpoint,
    { rawQuery: query, querySource: 'typed_query', withCommunity: true },
    parseCommunityTweets,
    { ...options, path: 'data.search_by_raw_query.search_timeline.timeline.instructions' },
  );
}

// ---------------------------------------------------------------------------
// Community lists
// ---------------------------------------------------------------------------

/**
 * Communities the authenticated user belongs to
 * (`CommunitiesMembershipsTimeline`).
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {object} [options] `{ limit, cursor, onProgress }`
 * @param {string} [options.userId] Restrict to this user's memberships (defaults to the viewer)
 * @returns {Promise<object[]>} Parsed communities
 */
export async function scrapeMyCommunities(client, options = {}) {
  requireAuth(client, 'CommunitiesMembershipsTimeline');
  const variables = { withCommunity: true };
  if (options.userId) variables.userId = String(options.userId);
  return paginate(client, GRAPHQL.CommunitiesMembershipsTimeline, variables, parseCommunityList, {
    ...options,
    path: 'data.user.result.communities_timeline.timeline.instructions',
  });
}

/**
 * The communities discovery feed (`CommunityDiscoveryTimeline`), which is
 * the closest the current bundle offers to browsing communities by name.
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {object} [options] `{ limit, cursor, onProgress }`
 * @returns {Promise<object[]>} Parsed communities
 */
export async function scrapeCommunityDiscovery(client, options = {}) {
  requireAuth(client, 'CommunityDiscoveryTimeline');
  return paginate(client, GRAPHQL.CommunityDiscoveryTimeline, { withCommunity: true }, parseCommunityList, {
    ...options,
    path: 'data.viewer.explore_communities_timeline.timeline.instructions',
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Run a community mutation and return the community it echoes back.
 * @param {object} client
 * @param {{queryId: string, operationName: string}} endpoint
 * @param {string} communityId
 * @param {object} [extraVariables]
 * @returns {Promise<{success: boolean, communityId: string, role: string|null, community: object|null}>}
 */
async function communityMutation(client, endpoint, communityId, extraVariables = {}) {
  requireAuth(client, endpoint.operationName);
  const response = await client.graphql(
    endpoint.queryId,
    endpoint.operationName,
    { communityId: String(communityId), ...extraVariables },
    { mutation: true },
  );

  if (response?.errors?.length) {
    const msg = response.errors.map((e) => e.message).join('; ');
    throw new TwitterApiError(`${endpoint.operationName} failed: ${msg}`, { data: response });
  }

  const data = response?.data ?? {};
  const raw = data.community_join ?? data.community_leave ?? data.community_request_to_join
    ?? Object.values(data).find((v) => v && typeof v === 'object' && (v.rest_id || v.__typename === 'Community'));
  const parsed = parseCommunity(raw);
  return {
    success: Boolean(parsed),
    communityId: String(communityId),
    role: parsed?.role ?? null,
    community: parsed,
  };
}

/**
 * Join an open community (`JoinCommunity`).
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} communityId
 * @returns {Promise<{success: boolean, communityId: string, role: string|null, community: object|null}>}
 */
export function joinCommunity(client, communityId) {
  return communityMutation(client, GRAPHQL.JoinCommunity, communityId);
}

/**
 * Leave a community (`LeaveCommunity`).
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} communityId
 * @returns {Promise<{success: boolean, communityId: string, role: string|null, community: object|null}>}
 */
export function leaveCommunity(client, communityId) {
  return communityMutation(client, GRAPHQL.LeaveCommunity, communityId);
}

/**
 * Ask to join a restricted community (`RequestToJoinCommunity`).
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {string} communityId
 * @param {object} [options]
 * @param {string} [options.answer] Answer to the community's join question
 * @returns {Promise<{success: boolean, communityId: string, role: string|null, community: object|null}>}
 */
export function requestToJoinCommunity(client, communityId, options = {}) {
  return communityMutation(client, GRAPHQL.RequestToJoinCommunity, communityId, options.answer ? { answer: options.answer } : {});
}
