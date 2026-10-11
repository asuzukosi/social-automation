// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for src/scrapers/twitter/http/communities.js
 *
 * Mocked client, fixture responses, no network.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseCommunity,
  parseCommunityList,
  parseCommunityTweets,
  scrapeCommunity,
  scrapeCommunityTweets,
  scrapeCommunityMedia,
  searchCommunityTweets,
  scrapeMyCommunities,
  scrapeCommunityDiscovery,
  joinCommunity,
  leaveCommunity,
  requestToJoinCommunity,
} from '../../src/scrapers/twitter/http/communities.js';
import { GRAPHQL } from '../../src/scrapers/twitter/http/endpoints.js';
import { AuthError, NotFoundError, TwitterApiError } from '../../src/scrapers/twitter/http/errors.js';
import {
  COMMUNITY,
  COMMUNITY_BY_ID_RESPONSE,
  COMMUNITY_UNAVAILABLE_RESPONSE,
  COMMUNITY_TWEETS_RESPONSE,
  COMMUNITY_TWEETS_RESPONSE_PAGE2,
  COMMUNITY_MEMBERSHIPS_RESPONSE,
  JOIN_COMMUNITY_RESPONSE,
  LEAVE_COMMUNITY_RESPONSE,
  REQUEST_TO_JOIN_RESPONSE,
} from './fixtures/coverage-responses.js';

function mockClient(handler, authenticated = true) {
  return {
    graphql: vi.fn(handler),
    request: vi.fn(),
    isAuthenticated: vi.fn(() => authenticated),
  };
}

describe('endpoint table', () => {
  it('carries every community operation with a live-discovered ID', () => {
    for (const key of [
      'CommunityByRestId',
      'CommunityTweetsTimeline',
      'CommunityMediaTimeline',
      'GlobalCommunitiesPostSearchTimeline',
      'GlobalCommunitiesLatestPostSearchTimeline',
      'CommunitiesMembershipsTimeline',
      'CommunityDiscoveryTimeline',
      'JoinCommunity',
      'LeaveCommunity',
      'RequestToJoinCommunity',
    ]) {
      expect(GRAPHQL[key], key).toBeDefined();
      expect(GRAPHQL[key].queryId).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(GRAPHQL[key].operationName).toBe(key);
    }
  });
});

describe('parseCommunity', () => {
  it('maps a raw Community to the XActions shape', () => {
    const c = parseCommunity(COMMUNITY);
    expect(c).toMatchObject({
      id: '1493446837214187523',
      name: 'Build in Public',
      memberCount: 48210,
      moderatorCount: 3,
      role: 'Member',
      joinPolicy: 'Open',
      topic: 'Technology',
      url: 'https://x.com/i/communities/1493446837214187523',
      platform: 'twitter',
    });
    expect(c.createdAt).toBe('2023-11-14T22:13:20.000Z');
    expect(c.banner).toContain('community_banner_img');
    expect(c.admin.username).toBe('alice_dev');
    expect(c.creator.verified).toBe(true);
    expect(c.rules).toHaveLength(2);
    expect(c.rules[0]).toEqual({ id: 'r1', name: 'Be kind', description: 'Treat others with respect.' });
  });

  it('returns null for unavailable or empty input', () => {
    expect(parseCommunity(null)).toBeNull();
    expect(parseCommunity({ __typename: 'CommunityUnavailable' })).toBeNull();
  });
});

describe('parseCommunityList / parseCommunityTweets', () => {
  it('reads communities and the bottom cursor out of a memberships timeline', () => {
    const instructions = COMMUNITY_MEMBERSHIPS_RESPONSE.data.user.result.communities_timeline.timeline.instructions;
    const { items, cursor } = parseCommunityList(instructions);
    expect(items.map((c) => c.name)).toEqual(['Build in Public', 'JavaScript']);
    expect(items[1].role).toBe('Admin');
    expect(cursor).toBe('MEMBERSHIPS_PAGE_2');
  });

  it('reads tweets and the bottom cursor out of a community timeline', () => {
    const instructions = COMMUNITY_TWEETS_RESPONSE.data.communityResults.result.ranked_community_timeline.timeline.instructions;
    const { items, cursor } = parseCommunityTweets(instructions);
    expect(items.map((t) => t.id)).toEqual(['7001', '7002']);
    expect(items[0].author.username).toBe('alice_dev');
    expect(cursor).toBe('COMMUNITY_PAGE_2');
  });

  it('tolerates a non-array', () => {
    expect(parseCommunityList(undefined)).toEqual({ items: [], cursor: null });
    expect(parseCommunityTweets(null)).toEqual({ items: [], cursor: null });
  });
});

describe('scrapeCommunity', () => {
  it('fetches by id with CommunityByRestId', async () => {
    const client = mockClient(async () => COMMUNITY_BY_ID_RESPONSE);
    const c = await scrapeCommunity(client, 1493446837214187523n.toString());
    expect(c.name).toBe('Build in Public');
    const [queryId, op, vars] = client.graphql.mock.calls[0];
    expect(queryId).toBe(GRAPHQL.CommunityByRestId.queryId);
    expect(op).toBe('CommunityByRestId');
    expect(vars).toEqual({ communityId: '1493446837214187523' });
  });

  it('throws NotFoundError for an unavailable community', async () => {
    const client = mockClient(async () => COMMUNITY_UNAVAILABLE_RESPONSE);
    await expect(scrapeCommunity(client, '1')).rejects.toThrow(NotFoundError);
  });

  it('requires auth', async () => {
    const client = mockClient(async () => COMMUNITY_BY_ID_RESPONSE, false);
    await expect(scrapeCommunity(client, '1')).rejects.toThrow(AuthError);
    expect(client.graphql).not.toHaveBeenCalled();
  });
});

describe('scrapeCommunityTweets', () => {
  it('paginates with the cursor and honours limit', async () => {
    const client = mockClient(async (_q, _op, vars) =>
      vars.cursor === 'COMMUNITY_PAGE_2' ? COMMUNITY_TWEETS_RESPONSE_PAGE2 : COMMUNITY_TWEETS_RESPONSE,
    );
    const tweets = await scrapeCommunityTweets(client, '1493446837214187523', { limit: 3 });
    expect(tweets.map((t) => t.id)).toEqual(['7001', '7002', '7003']);
    expect(client.graphql).toHaveBeenCalledTimes(2);
    expect(client.graphql.mock.calls[1][2].cursor).toBe('COMMUNITY_PAGE_2');
  });

  it('sends Recency by default and Relevance for ranking: top', async () => {
    const client = mockClient(async () => COMMUNITY_TWEETS_RESPONSE_PAGE2);
    await scrapeCommunityTweets(client, '5', { limit: 1 });
    expect(client.graphql.mock.calls[0][2]).toMatchObject({ communityId: '5', rankingMode: 'Recency', displayLocation: 'Community' });
    await scrapeCommunityTweets(client, '5', { limit: 1, ranking: 'top' });
    expect(client.graphql.mock.calls[1][2].rankingMode).toBe('Relevance');
  });

  it('stops when a page has no cursor', async () => {
    const client = mockClient(async () => COMMUNITY_TWEETS_RESPONSE_PAGE2);
    const tweets = await scrapeCommunityTweets(client, '5', { limit: 50 });
    expect(tweets).toHaveLength(1);
    expect(client.graphql).toHaveBeenCalledTimes(1);
  });

  it('reports progress', async () => {
    const client = mockClient(async () => COMMUNITY_TWEETS_RESPONSE_PAGE2);
    const onProgress = vi.fn();
    await scrapeCommunityTweets(client, '5', { limit: 10, onProgress });
    expect(onProgress).toHaveBeenCalledWith({ fetched: 1, limit: 10, page: 0 });
  });
});

describe('scrapeCommunityMedia / searchCommunityTweets', () => {
  it('uses CommunityMediaTimeline and finds the instructions under any path', async () => {
    const response = { data: { communityResults: { result: { community_media_timeline: COMMUNITY_TWEETS_RESPONSE.data.communityResults.result.ranked_community_timeline } } } };
    const client = mockClient(async () => response);
    const tweets = await scrapeCommunityMedia(client, '5', { limit: 2 });
    expect(tweets).toHaveLength(2);
    expect(client.graphql.mock.calls[0][1]).toBe('CommunityMediaTimeline');
  });

  it('picks the Top or Latest search operation', async () => {
    const response = { data: { search_by_raw_query: { search_timeline: { timeline: COMMUNITY_TWEETS_RESPONSE_PAGE2.data.communityResults.result.ranked_community_timeline.timeline } } } };
    const client = mockClient(async () => response);
    await searchCommunityTweets(client, 'mvp launch', { limit: 1 });
    expect(client.graphql.mock.calls[0][1]).toBe('GlobalCommunitiesPostSearchTimeline');
    expect(client.graphql.mock.calls[0][2].rawQuery).toBe('mvp launch');
    await searchCommunityTweets(client, 'mvp launch', { limit: 1, ranking: 'latest' });
    expect(client.graphql.mock.calls[1][1]).toBe('GlobalCommunitiesLatestPostSearchTimeline');
  });

  it('rejects an empty query', async () => {
    const client = mockClient(async () => ({}));
    await expect(searchCommunityTweets(client, '')).rejects.toThrow(TwitterApiError);
  });
});

describe('scrapeMyCommunities / scrapeCommunityDiscovery', () => {
  it('returns the viewer communities', async () => {
    const client = mockClient(async () => COMMUNITY_MEMBERSHIPS_RESPONSE);
    const communities = await scrapeMyCommunities(client, { limit: 2 });
    expect(communities.map((c) => c.id)).toEqual(['1493446837214187523', '1500000000000000000']);
    expect(client.graphql.mock.calls[0][1]).toBe('CommunitiesMembershipsTimeline');
  });

  it('passes userId through when given', async () => {
    const client = mockClient(async () => COMMUNITY_MEMBERSHIPS_RESPONSE);
    await scrapeMyCommunities(client, { limit: 1, userId: 1001 });
    expect(client.graphql.mock.calls[0][2].userId).toBe('1001');
  });

  it('reads the discovery feed from a differently-nested response', async () => {
    const response = { data: { viewer: { explore_communities_timeline: { timeline: COMMUNITY_MEMBERSHIPS_RESPONSE.data.user.result.communities_timeline.timeline } } } };
    const client = mockClient(async () => response);
    const communities = await scrapeCommunityDiscovery(client, { limit: 5 });
    expect(communities).toHaveLength(2);
    expect(client.graphql.mock.calls[0][1]).toBe('CommunityDiscoveryTimeline');
  });
});

describe('mutations', () => {
  it('joins via POST and echoes the new role', async () => {
    const client = mockClient(async () => JOIN_COMMUNITY_RESPONSE);
    const result = await joinCommunity(client, '1493446837214187523');
    expect(result).toMatchObject({ success: true, communityId: '1493446837214187523', role: 'Member' });
    expect(result.community.name).toBe('Build in Public');
    const [queryId, op, vars, opts] = client.graphql.mock.calls[0];
    expect(queryId).toBe(GRAPHQL.JoinCommunity.queryId);
    expect(op).toBe('JoinCommunity');
    expect(vars).toEqual({ communityId: '1493446837214187523' });
    expect(opts).toEqual({ mutation: true });
  });

  it('leaves', async () => {
    const client = mockClient(async () => LEAVE_COMMUNITY_RESPONSE);
    const result = await leaveCommunity(client, '1493446837214187523');
    expect(result.role).toBe('NonMember');
    expect(client.graphql.mock.calls[0][1]).toBe('LeaveCommunity');
  });

  it('requests to join with an optional answer', async () => {
    const client = mockClient(async () => REQUEST_TO_JOIN_RESPONSE);
    const result = await requestToJoinCommunity(client, '1493446837214187523', { answer: 'I ship daily' });
    expect(result.success).toBe(true);
    expect(client.graphql.mock.calls[0][2]).toEqual({ communityId: '1493446837214187523', answer: 'I ship daily' });
  });

  it('surfaces GraphQL errors', async () => {
    const client = mockClient(async () => ({ errors: [{ message: 'Community is not open' }] }));
    await expect(joinCommunity(client, '1')).rejects.toThrow(/Community is not open/);
  });

  it('requires auth', async () => {
    const client = mockClient(async () => JOIN_COMMUNITY_RESPONSE, false);
    await expect(joinCommunity(client, '1')).rejects.toThrow(AuthError);
    await expect(leaveCommunity(client, '1')).rejects.toThrow(AuthError);
    await expect(requestToJoinCommunity(client, '1')).rejects.toThrow(AuthError);
  });
});
