// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Target resolution: what "download this" means.
 *
 * A caller names a target the way they would say it out loud, and this turns
 * it into a flat list of media items the engine can fetch:
 *
 *   @nichxbt                    the media tab
 *   @nichxbt:avatar             profile picture, full resolution
 *   @nichxbt:banner             header image
 *   @nichxbt:all                media tab plus avatar and banner
 *   1234567890                  one tweet
 *   https://x.com/u/status/123  the same tweet, pasted
 *   search:from:nichxbt filter:images
 *   community:1234567890
 *
 * Avatars are requested at their original size: X serves a 48px `_normal`
 * thumbnail by default, and an archive full of 48px avatars is not an archive.
 *
 * @module media/sources
 * by nichxbt
 */

import { parseMediaEntity } from '../scrapers/twitter/http/media.js';

/** The forms a target string can take. */
export const TARGET_KINDS = Object.freeze(['profile', 'avatar', 'banner', 'tweet', 'search', 'community']);

/**
 * Strip X's size suffix so the CDN serves the original upload:
 * `..._normal.jpg` and `..._400x400.jpg` both become `....jpg`.
 */
export function originalImageUrl(url) {
  if (!url) return null;
  return String(url).replace(/_(normal|bigger|mini|\d+x\d+)(\.[a-z]+)(?=$|\?)/i, '$2');
}

/** A banner is served without a size; asking for /1500x500 gets the large one. */
export function originalBannerUrl(url) {
  if (!url) return null;
  return /\/\d+x\d+$/.test(url) ? url : `${url}/1500x500`;
}

/**
 * Parse a target string into `{ kind, value, modifier }`.
 *
 * @param {string} target
 */
export function parseTarget(target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('A download target is required (e.g. @nichxbt, a tweet URL, or search:<query>)');

  if (/^search:/i.test(raw)) return { kind: 'search', value: raw.slice(7).trim() };
  if (/^community:/i.test(raw)) return { kind: 'community', value: raw.slice(10).trim() };

  const statusUrl = raw.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/i);
  if (statusUrl) return { kind: 'tweet', value: statusUrl[1] };
  if (/^\d{5,25}$/.test(raw)) return { kind: 'tweet', value: raw };

  const profileUrl = raw.match(/(?:twitter|x)\.com\/@?([A-Za-z0-9_]{1,15})\/?$/i);
  const handle = profileUrl ? profileUrl[1] : raw.replace(/^@/, '');
  const [name, modifier = 'media'] = handle.split(':');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(name)) throw new Error(`Not a target I recognise: "${raw}"`);

  if (modifier === 'avatar') return { kind: 'avatar', value: name };
  if (modifier === 'banner') return { kind: 'banner', value: name };
  if (modifier === 'all') return { kind: 'profile', value: name, modifier: 'all' };
  return { kind: 'profile', value: name };
}

/** Normalise one parsed media entity into the shape the engine and templates expect. */
function toItem(entity, { username, userId, createdAt, num, kind = 'media' }) {
  return {
    kind,
    url: entity.url,
    mediaType: entity.mediaType,
    tweetId: entity.tweetId,
    username,
    userId,
    createdAt,
    num,
    width: entity.width,
    height: entity.height,
    bitrate: entity.bitrate ?? 0,
    altText: entity.altText ?? null,
  };
}

/**
 * One media entry in the shape toItem reads, from any of the three shapes a
 * tweet can carry: already normalised by parseMediaEntity, raw GraphQL
 * (`media_url_https`, `video_info`), or parseTweetData's own
 * (`{ type, url, videoUrl }`). The last one used to be re-parsed as raw
 * GraphQL, found no `media_url_https`, and was dropped, so downloading a
 * tweet, a search or a profile's posts saved nothing.
 */
function mediaEntityOf(entry, tweetId) {
  if (!entry) return null;
  if (entry.mediaType) return entry;
  if (entry.media_url_https || entry.media_url || entry.video_info) return parseMediaEntity(entry, tweetId);
  const type = entry.type || 'photo';
  const isVideo = type === 'video' || type === 'animated_gif';
  let url = isVideo ? entry.videoUrl || null : entry.url || null;
  if (type === 'photo' && url && !url.includes('?format=')) url = `${originalImageUrl(url)}?format=jpg&name=orig`;
  return {
    tweetId,
    mediaType: type,
    url,
    width: entry.width ?? 0,
    height: entry.height ?? 0,
    altText: entry.altText ?? null,
  };
}

/** Pull every media item out of one parsed tweet. */
export function itemsFromTweet(tweet) {
  const media =
    tweet?.media ??
    tweet?.extended_entities?.media ??
    tweet?.legacy?.extended_entities?.media ??
    tweet?.entities?.media ??
    [];
  const username = tweet.username || tweet.user?.username || tweet.author?.username || 'unknown';
  const userId = tweet.userId || tweet.user?.id || tweet.author?.id || '0';
  const createdAt = tweet.createdAt || tweet.created_at || null;
  const tweetId = tweet.id || tweet.tweetId || tweet.rest_id || '0';

  return media
    .map((entry, index) => {
      const entity = mediaEntityOf(entry, tweetId);
      if (!entity?.url) return null;
      return toItem(entity, { username, userId, createdAt, num: index + 1 });
    })
    .filter(Boolean);
}

/**
 * Resolve a target into media items.
 *
 * `scrapers` is the object `createHttpScraper()` returns, so this module never
 * builds a client of its own and inherits whatever session, pool or checkpoint
 * the caller already configured.
 *
 * @param {object} target  from parseTarget
 * @param {object} scrapers
 * @param {{ limit?: number, types?: string[], since?: Date|null, until?: Date|null }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function collectItems(target, scrapers, options = {}) {
  const { limit = 100 } = options;
  const items = [];

  if (target.kind === 'avatar' || target.kind === 'banner' || target.modifier === 'all') {
    const profile = await scrapers.scrapeProfile(target.value);
    const username = profile.username || target.value;
    const userId = profile.id || profile.userId || '0';

    if (target.kind === 'avatar' || target.modifier === 'all') {
      const url = originalImageUrl(profile.avatar);
      if (url) items.push({ kind: 'avatar', url, mediaType: 'photo', tweetId: userId, username, userId, createdAt: profile.createdAt || null, num: 1, width: 0, height: 0 });
    }
    if (target.kind === 'banner' || target.modifier === 'all') {
      const url = originalBannerUrl(profile.header);
      if (url) items.push({ kind: 'banner', url, mediaType: 'photo', tweetId: userId, username, userId, createdAt: profile.createdAt || null, num: 1, width: 0, height: 0 });
    }
    if (target.kind !== 'profile') return items;
  }

  if (target.kind === 'profile') {
    const media = await scrapers.scrapeMedia(target.value, { limit });
    for (const entry of media) {
      const tweetId = entry.tweetId || entry.id || '0';
      const username = entry.username || target.value;
      const perTweet = entry.media ? itemsFromTweet(entry) : [toItem(entry, { username, userId: entry.userId || '0', createdAt: entry.createdAt || null, num: entry.num ?? 1 })];
      items.push(...perTweet);
    }
  } else if (target.kind === 'tweet') {
    const tweet = await scrapers.scrapeTweetById(target.value);
    items.push(...itemsFromTweet(tweet));
  } else if (target.kind === 'search') {
    const tweets = await scrapers.searchTweets(target.value, { limit });
    for (const tweet of tweets) items.push(...itemsFromTweet(tweet));
  } else if (target.kind === 'community') {
    const tweets = await scrapers.scrapeCommunityMedia(target.value, { limit });
    for (const tweet of tweets) items.push(...itemsFromTweet(tweet));
  }

  return applyFilters(items, options);
}

/**
 * Apply `--type` and date filters. Kept separate so the CLI, the MCP tool and
 * tests all filter identically.
 */
export function applyFilters(items, { types, since, until } = {}) {
  let out = items;
  if (types?.length) {
    const wanted = new Set(types.map((t) => (t === 'gif' ? 'animated_gif' : t)));
    out = out.filter((item) => wanted.has(item.mediaType));
  }
  if (since) out = out.filter((item) => !item.createdAt || new Date(item.createdAt) >= since);
  if (until) out = out.filter((item) => !item.createdAt || new Date(item.createdAt) <= until);
  return out;
}
