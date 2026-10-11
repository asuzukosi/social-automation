// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for src/scrapers/twitter/http/notifications.js
 *
 * Mocked client, fixture responses, no network.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseNotificationEntry,
  parseNotificationsTimeline,
  scrapeNotifications,
  scrapeMentions,
  scrapeVerifiedNotifications,
} from '../../src/scrapers/twitter/http/notifications.js';
import { GRAPHQL } from '../../src/scrapers/twitter/http/endpoints.js';
import { AuthError } from '../../src/scrapers/twitter/http/errors.js';
import { NOTIFICATIONS_RESPONSE, NOTIFICATIONS_RESPONSE_PAGE2 } from './fixtures/coverage-responses.js';

const INSTRUCTIONS = NOTIFICATIONS_RESPONSE.data.viewer_v2.user_results.result.notification_timeline.timeline.instructions;

function mockClient(handler, authenticated = true) {
  return { graphql: vi.fn(handler), isAuthenticated: vi.fn(() => authenticated) };
}

describe('endpoint table', () => {
  it('has NotificationsTimeline', () => {
    expect(GRAPHQL.NotificationsTimeline.operationName).toBe('NotificationsTimeline');
    expect(GRAPHQL.NotificationsTimeline.queryId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('parseNotificationsTimeline', () => {
  const { items, cursor } = parseNotificationsTimeline(INSTRUCTIONS);

  it('returns every entry as a typed event, in timeline order, with the cursor', () => {
    expect(items.map((e) => e.type)).toEqual(['follow', 'like', 'retweet', 'reply', 'mention', 'quote', 'other']);
    expect(cursor).toBe('NOTIF_PAGE_2');
  });

  it('parses an aggregated follow notification', () => {
    const follow = items[0];
    expect(follow).toMatchObject({
      id: 'n-follow-1',
      type: 'follow',
      icon: 'person_icon',
      message: 'Alice Dev and Bob Codes followed you',
      url: 'https://x.com/i/notifications/n-follow-1',
      platform: 'twitter',
    });
    expect(follow.users.map((u) => u.username)).toEqual(['alice_dev', 'bob_codes']);
    expect(follow.users[0].verified).toBe(true);
    expect(follow.tweets).toEqual([]);
    expect(follow.tweet).toBeNull();
    expect(follow.timestamp).toBe('2025-08-27T10:00:00.000Z');
  });

  it('attaches the target tweet to likes and retweets', () => {
    expect(items[1].tweet.id).toBe('9001');
    expect(items[1].tweet.text).toBe('Shipping the HTTP scraper today.');
    expect(items[1].users[0].username).toBe('carol_ml');
    expect(items[2].type).toBe('retweet');
    expect(items[2].tweet.id).toBe('9001');
  });

  it('parses reply, mention, and quote tweet entries', () => {
    const [reply, mention, quote] = items.slice(3, 6);
    expect(reply).toMatchObject({ id: 'tweet-8001', type: 'reply', message: '@me_user great work on this' });
    expect(reply.users[0].username).toBe('alice_dev');
    expect(reply.tweet.inReplyTo.tweetId).toBe('9001');
    expect(reply.url).toBe('https://x.com/alice_dev/status/8001');
    expect(reply.timestamp).toBe('2026-08-27T10:00:00.000Z');

    expect(mention).toMatchObject({ type: 'mention', message: 'cc @me_user have you seen this' });
    expect(mention.users[0].username).toBe('bob_codes');

    expect(quote.type).toBe('quote');
    expect(quote.tweet.quotedTweet.id).toBe('9001');
  });

  it('falls back to tweet structure when clientEventInfo is missing', () => {
    const strip = (entry) => ({ ...entry, content: { ...entry.content, clientEventInfo: undefined } });
    const [replyEntry, mentionEntry, quoteEntry] = INSTRUCTIONS[1].entries.slice(4, 7).map(strip);
    expect(parseNotificationEntry(replyEntry).type).toBe('reply');
    expect(parseNotificationEntry(mentionEntry).type).toBe('mention');
    expect(parseNotificationEntry(quoteEntry).type).toBe('quote');
  });

  it('classifies unknown icons as other, or by message when no icon', () => {
    expect(items[6]).toMatchObject({ type: 'other', icon: 'bird_icon', users: [] });
    const entry = {
      entryId: 'notification-x',
      content: { itemContent: { itemType: 'TimelineNotification', notification_results: { result: { rest_id: 'x', rich_message: { text: 'Someone liked your reply' } } } } },
    };
    expect(parseNotificationEntry(entry).type).toBe('like');
  });

  it('returns null for entries that are neither notifications nor tweets', () => {
    expect(parseNotificationEntry({ entryId: 'promo', content: { itemContent: { itemType: 'TimelinePromo' } } })).toBeNull();
    expect(parseNotificationsTimeline(undefined)).toEqual({ items: [], cursor: null });
  });
});

describe('scrapeNotifications', () => {
  it('sends timeline_type All and paginates', async () => {
    const client = mockClient(async (_q, _op, vars) => (vars.cursor === 'NOTIF_PAGE_2' ? NOTIFICATIONS_RESPONSE_PAGE2 : NOTIFICATIONS_RESPONSE));
    const events = await scrapeNotifications(client, { limit: 8 });
    expect(events).toHaveLength(8);
    expect(events[7].id).toBe('n-like-2');
    const [queryId, op, vars] = client.graphql.mock.calls[0];
    expect(queryId).toBe(GRAPHQL.NotificationsTimeline.queryId);
    expect(op).toBe('NotificationsTimeline');
    expect(vars).toMatchObject({ timeline_type: 'All' });
    expect(client.graphql.mock.calls[1][2].cursor).toBe('NOTIF_PAGE_2');
  });

  it('honours limit across a single page', async () => {
    const client = mockClient(async () => NOTIFICATIONS_RESPONSE);
    const events = await scrapeNotifications(client, { limit: 3 });
    expect(events.map((e) => e.type)).toEqual(['follow', 'like', 'retweet']);
    expect(client.graphql).toHaveBeenCalledTimes(1);
  });

  it('filters by event type', async () => {
    const client = mockClient(async () => NOTIFICATIONS_RESPONSE_PAGE2);
    const events = await scrapeNotifications(client, { types: ['follow'], limit: 5 });
    expect(events).toEqual([]);
    const client2 = mockClient(async () => NOTIFICATIONS_RESPONSE_PAGE2);
    const likes = await scrapeNotifications(client2, { types: ['like'], limit: 5 });
    expect(likes).toHaveLength(1);
  });

  it('switches tabs for mentions and verified', async () => {
    const client = mockClient(async () => NOTIFICATIONS_RESPONSE_PAGE2);
    await scrapeMentions(client, { limit: 1 });
    expect(client.graphql.mock.calls[0][2].timeline_type).toBe('Mentions');
    await scrapeVerifiedNotifications(client, { limit: 1 });
    expect(client.graphql.mock.calls[1][2].timeline_type).toBe('Verified');
    await scrapeNotifications(client, { type: 'bogus', limit: 1 });
    expect(client.graphql.mock.calls[2][2].timeline_type).toBe('All');
  });

  it('requires auth', async () => {
    const client = mockClient(async () => NOTIFICATIONS_RESPONSE, false);
    await expect(scrapeNotifications(client)).rejects.toThrow(AuthError);
    expect(client.graphql).not.toHaveBeenCalled();
  });
});
