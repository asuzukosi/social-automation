// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for src/scrapers/twitter/http/explore.js
 *
 * Mocked client, fixture responses, no network.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseTrend,
  parseTrendTimeline,
  parseGuideTrends,
  parseAudioSpace,
  scrapeTrends,
  scrapeTrendsByWoeid,
  scrapeTrendLocations,
  scrapeExplorePage,
  scrapeHighlights,
  scrapeArticles,
  scrapeVerifiedFollowers,
  scrapeFollowersYouKnow,
  scrapeAudioSpace,
} from '../../src/scrapers/twitter/http/explore.js';
import { GRAPHQL, REST } from '../../src/scrapers/twitter/http/endpoints.js';
import { AuthError, NotFoundError, TwitterApiError } from '../../src/scrapers/twitter/http/errors.js';
import {
  EXPLORE_PAGE_RESPONSE,
  GUIDE_RESPONSE,
  TRENDS_PLACE_RESPONSE,
  TRENDS_AVAILABLE_RESPONSE,
  HIGHLIGHTS_RESPONSE,
  HIGHLIGHTS_RESPONSE_PAGE2,
  VERIFIED_FOLLOWERS_RESPONSE,
  USER_RESOLVE_RESPONSE,
  AUDIO_SPACE_RESPONSE,
  AUDIO_SPACE_MISSING_RESPONSE,
} from './fixtures/coverage-responses.js';

function mockClient({ graphql, request } = {}, authenticated = true) {
  return {
    graphql: vi.fn(graphql ?? (async () => ({}))),
    request: vi.fn(request ?? (async () => ({}))),
    isAuthenticated: vi.fn(() => authenticated),
  };
}

describe('endpoint table', () => {
  it('carries every explore operation with a live-discovered ID', () => {
    for (const key of ['ExplorePage', 'UserHighlightsTweets', 'UserArticlesTweets', 'BlueVerifiedFollowers', 'FollowersYouKnow', 'AudioSpaceById']) {
      expect(GRAPHQL[key], key).toBeDefined();
      expect(GRAPHQL[key].queryId).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(GRAPHQL[key].operationName).toBe(key);
    }
  });
});

describe('parseTrend', () => {
  it('normalises a GraphQL TimelineTrend', () => {
    const t = parseTrend({
      name: '#BuildInPublic',
      trend_url: { url: 'twitter://search/?query=%23BuildInPublic&src=trend_click' },
      trend_metadata: { domain_context: 'Trending in Technology', meta_description: '12.3K posts' },
    });
    expect(t).toEqual({
      name: '#BuildInPublic',
      url: 'https://x.com/search?q=%23BuildInPublic&src=trend_click',
      query: '#BuildInPublic',
      volume: 12300,
      volumeText: '12.3K posts',
      context: 'Trending in Technology',
      rank: null,
      promoted: false,
      platform: 'twitter',
    });
  });

  it('normalises a /1.1/trends/place trend', () => {
    const t = parseTrend(TRENDS_PLACE_RESPONSE[0].trends[0]);
    expect(t.name).toBe('#BuildInPublic');
    expect(t.volume).toBe(12300);
    expect(t.query).toBe('%23BuildInPublic');
    expect(t.url).toBe('http://twitter.com/search?q=%23BuildInPublic');
  });

  it('parses volume text with commas, K, and M, and returns null when absent', () => {
    expect(parseTrend({ name: 'a', trend_metadata: { meta_description: '4,210 posts' } }).volume).toBe(4210);
    expect(parseTrend({ name: 'a', trend_metadata: { meta_description: '1.5M posts' } }).volume).toBe(1500000);
    expect(parseTrend({ name: 'a', trend_metadata: { meta_description: 'Trending' } }).volume).toBeNull();
    expect(parseTrend({ name: 'a' }).volume).toBeNull();
    expect(parseTrend(null)).toBeNull();
    expect(parseTrend({ trend_metadata: {} })).toBeNull();
  });
});

describe('parseTrendTimeline / parseGuideTrends', () => {
  it('collects trends from modules and single items with ranks and the cursor', () => {
    const { items, cursor } = parseTrendTimeline(EXPLORE_PAGE_RESPONSE.data.explore_page.body.initialTimeline.timeline.timeline.instructions);
    expect(items.map((t) => t.name)).toEqual(['#BuildInPublic', 'Node 26', 'OpenAI']);
    expect(items.map((t) => t.rank)).toEqual([1, 2, 3]);
    expect(items[2].volume).toBe(250000);
    expect(cursor).toBe('EXPLORE_PAGE_2');
  });

  it('reads guide.json modules', () => {
    const trends = parseGuideTrends(GUIDE_RESPONSE);
    expect(trends.map((t) => t.name)).toEqual(['#BuildInPublic', 'Node 26']);
    expect(trends[0]).toMatchObject({ rank: 1, volume: 12300, context: 'Trending in Technology', url: 'https://x.com/search?q=%23BuildInPublic' });
    expect(trends[1].query).toBe('"Node+26"');
    expect(parseGuideTrends({})).toEqual([]);
  });
});

describe('trends', () => {
  it('scrapeTrendsByWoeid calls /1.1/trends/place.json and works without auth', async () => {
    const client = mockClient({ request: async () => TRENDS_PLACE_RESPONSE }, false);
    const result = await scrapeTrendsByWoeid(client, 1);
    expect(client.request.mock.calls[0][0]).toBe(`https://x.com/i/api${REST.trendsPlace}?id=1`);
    expect(result.location).toEqual({ name: 'Worldwide', woeid: 1 });
    expect(result.asOf).toBe('2026-08-27T10:00:00Z');
    expect(result.trends.map((t) => t.rank)).toEqual([1, 2]);
    expect(result.trends[1].volume).toBeNull();
  });

  it('scrapeTrendsByWoeid throws NotFoundError on an empty body', async () => {
    const client = mockClient({ request: async () => [] });
    await expect(scrapeTrendsByWoeid(client, 999)).rejects.toThrow(NotFoundError);
  });

  it('scrapeTrendLocations maps /1.1/trends/available.json', async () => {
    const client = mockClient({ request: async () => TRENDS_AVAILABLE_RESPONSE });
    const places = await scrapeTrendLocations(client);
    expect(places).toEqual([
      { name: 'Worldwide', woeid: 1, country: null, countryCode: null, placeType: 'Supername', parentId: 0 },
      { name: 'United States', woeid: 23424977, country: 'United States', countryCode: 'US', placeType: 'Country', parentId: 1 },
    ]);
  });

  it('scrapeTrends hits guide.json with the tab and limit', async () => {
    const client = mockClient({ request: async () => GUIDE_RESPONSE });
    const trends = await scrapeTrends(client, { tab: 'news', limit: 1 });
    expect(trends).toHaveLength(1);
    const url = client.request.mock.calls[0][0];
    expect(url).toContain(REST.guide);
    expect(url).toContain('initial_tab_id=news');
    expect(url).toContain('count=1');
  });

  it('scrapeTrends rejects an unknown tab and requires auth', async () => {
    await expect(scrapeTrends(mockClient(), { tab: 'nope' })).rejects.toThrow(TwitterApiError);
    await expect(scrapeTrends(mockClient({}, false))).rejects.toThrow(AuthError);
  });

  it('scrapeExplorePage paginates the GraphQL explore timeline and dedups by name', async () => {
    const client = mockClient({ graphql: async () => EXPLORE_PAGE_RESPONSE });
    const trends = await scrapeExplorePage(client, { limit: 10 });
    expect(trends.map((t) => t.name)).toEqual(['#BuildInPublic', 'Node 26', 'OpenAI']);
    expect(client.graphql).toHaveBeenCalledTimes(2);
    expect(client.graphql.mock.calls[0][1]).toBe('ExplorePage');
    expect(client.graphql.mock.calls[1][2].cursor).toBe('EXPLORE_PAGE_2');
  });
});

describe('profile side-timelines', () => {
  it('scrapeHighlights resolves the username then pages UserHighlightsTweets', async () => {
    const client = mockClient({
      graphql: async (_q, op, vars) => {
        if (op === 'UserByScreenName') return USER_RESOLVE_RESPONSE;
        return vars.cursor === 'HIGHLIGHTS_PAGE_2' ? HIGHLIGHTS_RESPONSE_PAGE2 : HIGHLIGHTS_RESPONSE;
      },
    });
    const tweets = await scrapeHighlights(client, 'alice_dev', { limit: 3 });
    expect(tweets.map((t) => t.id)).toEqual(['6001', '6002', '6003']);
    expect(client.graphql.mock.calls[0][1]).toBe('UserByScreenName');
    expect(client.graphql.mock.calls[1][1]).toBe('UserHighlightsTweets');
    expect(client.graphql.mock.calls[1][2]).toMatchObject({ userId: '2001', includePromotedContent: true, withVoice: true });
  });

  it('accepts a numeric id or { userId } without resolving', async () => {
    const client = mockClient({ graphql: async () => HIGHLIGHTS_RESPONSE_PAGE2 });
    await scrapeArticles(client, '44196397', { limit: 1 });
    expect(client.graphql).toHaveBeenCalledTimes(1);
    expect(client.graphql.mock.calls[0][1]).toBe('UserArticlesTweets');
    expect(client.graphql.mock.calls[0][2].userId).toBe('44196397');
    await scrapeArticles(client, { userId: 7 }, { limit: 1 });
    expect(client.graphql.mock.calls[1][2].userId).toBe('7');
  });

  it('throws NotFoundError for an unknown username', async () => {
    const client = mockClient({ graphql: async () => ({ data: { user: {} } }) });
    await expect(scrapeHighlights(client, 'ghost')).rejects.toThrow(NotFoundError);
  });

  it('scrapeVerifiedFollowers and scrapeFollowersYouKnow return users', async () => {
    const client = mockClient({ graphql: async () => VERIFIED_FOLLOWERS_RESPONSE });
    const verified = await scrapeVerifiedFollowers(client, { userId: '1001' }, { limit: 10 });
    expect(verified.map((u) => u.username)).toEqual(['alice_dev', 'carol_ml']);
    expect(verified[0].verified).toBe(true);
    expect(client.graphql.mock.calls[0][1]).toBe('BlueVerifiedFollowers');

    const known = await scrapeFollowersYouKnow(client, { userId: '1001' }, { limit: 1 });
    expect(known).toHaveLength(1);
    expect(client.graphql.mock.calls.at(-1)[1]).toBe('FollowersYouKnow');
  });

  it('requires auth', async () => {
    const client = mockClient({}, false);
    await expect(scrapeHighlights(client, 'a')).rejects.toThrow(AuthError);
    await expect(scrapeArticles(client, 'a')).rejects.toThrow(AuthError);
    await expect(scrapeVerifiedFollowers(client, 'a')).rejects.toThrow(AuthError);
    await expect(scrapeFollowersYouKnow(client, 'a')).rejects.toThrow(AuthError);
  });
});

describe('spaces', () => {
  it('parseAudioSpace maps metadata and participants', () => {
    const space = parseAudioSpace(AUDIO_SPACE_RESPONSE.data.audioSpace);
    expect(space).toMatchObject({
      id: '1YqKDqWZrVZKV',
      title: 'Shipping HTTP scrapers',
      state: 'Ended',
      liveListeners: 57,
      replayWatched: 340,
      participating: 4,
      replayAvailable: true,
      locked: false,
      participantCount: 4,
      url: 'https://x.com/i/spaces/1YqKDqWZrVZKV',
    });
    expect(space.startedAt).toBe('2025-08-27T09:01:00.000Z');
    expect(space.endedAt).toBe('2025-08-27T10:01:00.000Z');
    expect(space.creator.username).toBe('alice_dev');
    expect(space.admins[0]).toMatchObject({ id: '2001', username: 'alice_dev', verified: true, periscopeUserId: '1AliceP' });
    expect(space.speakers[0].username).toBe('bob_codes');
    expect(space.listeners[1]).toMatchObject({ id: '2999', username: 'anon_listener', name: 'Anon', verified: false });
    expect(space.listeners[1].avatar).toContain('2999');
    expect(parseAudioSpace({})).toBeNull();
  });

  it('scrapeAudioSpace sends the id and flags', async () => {
    const client = mockClient({ graphql: async () => AUDIO_SPACE_RESPONSE });
    const space = await scrapeAudioSpace(client, '1YqKDqWZrVZKV');
    expect(space.id).toBe('1YqKDqWZrVZKV');
    const [queryId, op, vars] = client.graphql.mock.calls[0];
    expect(queryId).toBe(GRAPHQL.AudioSpaceById.queryId);
    expect(op).toBe('AudioSpaceById');
    expect(vars).toEqual({ id: '1YqKDqWZrVZKV', isMetatagsQuery: false, withReplays: true, withListeners: true });
  });

  it('throws NotFoundError when the Space is missing, and requires auth', async () => {
    await expect(scrapeAudioSpace(mockClient({ graphql: async () => AUDIO_SPACE_MISSING_RESPONSE }), 'x')).rejects.toThrow(NotFoundError);
    await expect(scrapeAudioSpace(mockClient({}, false), 'x')).rejects.toThrow(AuthError);
  });
});
