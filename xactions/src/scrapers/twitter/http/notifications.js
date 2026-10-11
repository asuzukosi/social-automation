// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter/X Notifications via HTTP (GraphQL)
 *
 * Reads the All / Verified / Mentions notification tabs through the
 * `NotificationsTimeline` GraphQL operation (query ID read from the live
 * x.com bundle on 2026-08-27) and turns every entry into a typed event:
 * `follow`, `like`, `retweet`, `reply`, `mention`, `quote`, or `other`.
 *
 * The timeline mixes two entry kinds. Aggregated notifications
 * (`notification-*`, e.g. "A and 3 others liked your post") carry an icon,
 * a rich-text message, the acting users, and the target tweets. Tweet
 * entries (`tweet-*`) are replies, mentions, and quotes rendered as the
 * tweet itself, with the reason in `clientEventInfo.element`.
 *
 * Depends on: endpoints.js, paging.js, tweets.js, relationships.js
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { GRAPHQL } from './endpoints.js';
import { parseTweetData } from './tweets.js';
import { parseUserEntry } from './relationships.js';
import { flattenEntries, paginate, requireAuth } from './paging.js';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Notification icon id to event type */
const ICON_TYPES = {
  heart_icon: 'like',
  retweet_icon: 'retweet',
  person_icon: 'follow',
  reply_icon: 'reply',
  mention_icon: 'mention',
};

/** `clientEventInfo.element` values for tweet entries */
const ELEMENT_TYPES = [
  [/quoted/i, 'quote'],
  [/replied|reply/i, 'reply'],
  [/mention/i, 'mention'],
  [/retweet/i, 'retweet'],
  [/like|favorite/i, 'like'],
  [/follow/i, 'follow'],
];

/** Fallback classification from the rich-text message */
const MESSAGE_TYPES = [
  [/\bfollowed you\b/i, 'follow'],
  [/\bliked\b/i, 'like'],
  [/\brepost|retweet/i, 'retweet'],
  [/\bquoted\b/i, 'quote'],
  [/\breplied\b/i, 'reply'],
  [/\bmentioned\b/i, 'mention'],
];

/**
 * Map a regex table over a string.
 * @param {Array<[RegExp, string]>} table
 * @param {string} value
 * @returns {string|null}
 */
function classify(table, value) {
  if (!value) return null;
  for (const [re, type] of table) {
    if (re.test(value)) return type;
  }
  return null;
}

/**
 * Parse an epoch-ms string / number to ISO-8601.
 * @param {string|number|null} raw
 * @returns {string|null}
 */
function toISODate(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(Number(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Entry parsers
// ---------------------------------------------------------------------------

/**
 * Parse an aggregated `notification-*` entry.
 *
 * @param {object} entry Flattened timeline entry
 * @returns {object|null} Event
 */
function parseAggregatedNotification(entry) {
  const raw = entry?.content?.itemContent?.notification_results?.result;
  if (!raw) return null;

  const template = raw.template ?? {};
  const users = (template.from_users ?? [])
    .map((u) => parseUserEntry(u?.user_results?.result))
    .filter(Boolean);
  const tweets = (template.target_objects ?? [])
    .map((t) => parseTweetData(t?.tweet_results?.result))
    .filter((t) => t && t.id);

  const message = raw.rich_message?.text ?? raw.message?.text ?? '';
  const type =
    ICON_TYPES[raw.notification_icon] ??
    classify(MESSAGE_TYPES, message) ??
    'other';

  return {
    id: raw.rest_id ?? raw.id ?? entry.entryId ?? null,
    type,
    timestamp: toISODate(raw.timestamp_ms),
    message,
    users,
    tweets,
    tweet: tweets[0] ?? null,
    url: raw.notification_url?.url ?? null,
    icon: raw.notification_icon ?? null,
    platform: 'twitter',
  };
}

/**
 * Parse a `tweet-*` entry (reply / mention / quote rendered as a tweet).
 *
 * @param {object} entry Flattened timeline entry
 * @returns {object|null} Event
 */
function parseTweetNotification(entry) {
  const result = entry?.content?.itemContent?.tweet_results?.result;
  if (!result) return null;
  const tweet = parseTweetData(result);
  if (!tweet || !tweet.id) return null;

  const element = entry.clientEventInfo?.element ?? entry.content?.clientEventInfo?.element ?? '';
  const type =
    classify(ELEMENT_TYPES, element) ??
    (tweet.quotedTweet ? 'quote' : tweet.isReply ? 'reply' : 'mention');

  const author = tweet.author?.username
    ? {
        id: tweet.author.id ?? null,
        username: tweet.author.username,
        name: tweet.author.name ?? null,
        avatar: tweet.author.avatar ?? null,
        verified: Boolean(tweet.author.verified),
        platform: 'twitter',
      }
    : null;

  return {
    id: entry.entryId ?? `tweet-${tweet.id}`,
    type,
    timestamp: tweet.createdAt ?? null,
    message: tweet.text ?? '',
    users: author ? [author] : [],
    tweets: [tweet],
    tweet,
    url: author ? `https://x.com/${author.username}/status/${tweet.id}` : null,
    icon: null,
    platform: 'twitter',
  };
}

/**
 * Parse one timeline entry into a notification event.
 *
 * @param {object} entry Timeline entry (as returned by `flattenEntries`)
 * @returns {object|null} `{ id, type, timestamp, message, users, tweets, tweet, url }`
 */
export function parseNotificationEntry(entry) {
  const itemType = entry?.content?.itemContent?.itemType ?? entry?.content?.itemContent?.__typename ?? '';
  if (itemType === 'TimelineNotification' || entry?.content?.itemContent?.notification_results) {
    return parseAggregatedNotification(entry);
  }
  if (itemType === 'TimelineTweet' || entry?.content?.itemContent?.tweet_results) {
    return parseTweetNotification(entry);
  }
  return null;
}

/**
 * Parse a notifications timeline into events plus the bottom cursor.
 *
 * @param {object[]} instructions `timeline.instructions`
 * @returns {{ items: object[], cursor: string|null }}
 */
export function parseNotificationsTimeline(instructions) {
  const { entries, cursor } = flattenEntries(instructions);
  const items = [];
  for (const entry of entries) {
    const event = parseNotificationEntry(entry);
    if (event) items.push(event);
  }
  return { items, cursor };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const TIMELINE_TYPES = { all: 'All', mentions: 'Mentions', verified: 'Verified' };

/**
 * Scrape the authenticated user's notifications (`NotificationsTimeline`).
 *
 * @param {object} client TwitterHttpClient instance (authenticated)
 * @param {object} [options]
 * @param {'all'|'mentions'|'verified'} [options.type='all'] Which tab
 * @param {number} [options.limit=50] Maximum events
 * @param {string|null} [options.cursor=null] Resume from cursor
 * @param {string[]} [options.types] Keep only these event types (e.g. `['follow','like']`)
 * @param {Function} [options.onProgress] `({ fetched, limit, page })`
 * @returns {Promise<object[]>} Events, newest first
 *
 * @example
 * const events = await scrapeNotifications(client, { type: 'mentions', limit: 20 });
 * for (const e of events) console.log(e.type, e.users.map((u) => u.username), e.tweet?.text);
 */
export async function scrapeNotifications(client, options = {}) {
  requireAuth(client, 'NotificationsTimeline');
  const timelineType = TIMELINE_TYPES[options.type ?? 'all'] ?? 'All';
  const wanted = Array.isArray(options.types) && options.types.length ? new Set(options.types) : null;

  const parsePage = (instructions) => {
    const { items, cursor } = parseNotificationsTimeline(instructions);
    return { items: wanted ? items.filter((e) => wanted.has(e.type)) : items, cursor };
  };

  return paginate(
    client,
    GRAPHQL.NotificationsTimeline,
    { timeline_type: timelineType },
    parsePage,
    {
      limit: 50,
      ...options,
      path: 'data.viewer_v2.user_results.result.notification_timeline.timeline.instructions',
    },
  );
}

/**
 * Mentions tab only.
 * @param {object} client
 * @param {object} [options] Same as `scrapeNotifications` minus `type`
 * @returns {Promise<object[]>}
 */
export function scrapeMentions(client, options = {}) {
  return scrapeNotifications(client, { ...options, type: 'mentions' });
}

/**
 * Verified tab only.
 * @param {object} client
 * @param {object} [options] Same as `scrapeNotifications` minus `type`
 * @returns {Promise<object[]>}
 */
export function scrapeVerifiedNotifications(client, options = {}) {
  return scrapeNotifications(client, { ...options, type: 'verified' });
}
