// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Timeline Response Parsers
 *
 * Shared utilities for parsing Twitter's GraphQL timeline responses.
 * Used by tweets, users, lists, and search API modules.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { Tweet } from '../models/Tweet.js';
import { Profile } from '../models/Profile.js';

/**
 * Resolve a dot-separated path on an object.
 * @param {Object} obj
 * @param {string} path - e.g. 'data.user.result.timeline_v2.timeline'
 * @returns {*}
 * @private
 */
function resolvePath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Candidate paths to a user's tweet timeline.
 *
 * x.com renamed the container from `timeline_v2` to `timeline`; both are tried
 * so the client keeps working whichever one an account is served today.
 * @type {string[]}
 */
export const USER_TIMELINE_PATHS = [
  'data.user.result.timeline.timeline',
  'data.user.result.timeline_v2.timeline',
];

/**
 * Resolve the first candidate path that lands on a timeline with instructions.
 * @param {Object} obj
 * @param {string|string[]} paths
 * @returns {Object|null}
 * @private
 */
function resolveTimeline(obj, paths) {
  for (const path of Array.isArray(paths) ? paths : [paths]) {
    const node = resolvePath(obj, path);
    if (node?.instructions) return node;
  }
  return null;
}

/**
 * Parse timeline entries and cursor from a GraphQL response.
 *
 * @param {Object} data - Raw GraphQL response
 * @param {string|string[]} timelinePath - Dot-path(s) to the timeline object,
 *   e.g. `USER_TIMELINE_PATHS`. The first path holding `instructions` wins.
 * @returns {{ entries: Object[], cursor: string|null }}
 */
export function parseTimelineEntries(data, timelinePath) {
  const timeline = resolveTimeline(data, timelinePath);
  const instructions = timeline?.instructions || [];

  let entries = [];
  let cursor = null;

  for (const instruction of instructions) {
    if (instruction.type === 'TimelineAddEntries') {
      entries = instruction.entries || [];
    } else if (instruction.type === 'TimelineReplaceEntry') {
      // Handle cursor replacement entries
      const entry = instruction.entry;
      if (entry?.content?.cursorType === 'Bottom') {
        cursor = entry.content.value;
      }
    }
  }

  // Extract bottom cursor from entries if not found in replace instructions
  if (!cursor) {
    for (const entry of entries) {
      if (
        entry.entryId?.startsWith('cursor-bottom') &&
        entry.content?.value
      ) {
        cursor = entry.content.value;
      }
    }
  }

  return { entries, cursor };
}

/**
 * Parse a single timeline entry into a Tweet.
 *
 * @param {Object} entry - A timeline entry object
 * @returns {Tweet|null}
 */
export function parseTweetEntry(entry) {
  const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
  if (!tweetResult) return null;

  let result = tweetResult;
  // Unwrap TweetWithVisibilityResults
  if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
    result = result.tweet;
  }

  return Tweet.fromGraphQL(result);
}

/**
 * Parse a conversation module entry (multi-tweet thread) into an array of Tweets.
 *
 * @param {Object} entry - A TimelineTimelineModule entry
 * @returns {Tweet[]}
 */
export function parseModuleEntry(entry) {
  const items = entry?.content?.items || [];
  const tweets = [];

  for (const item of items) {
    const tweetResult = item?.item?.itemContent?.tweet_results?.result;
    if (!tweetResult) continue;

    let result = tweetResult;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) {
      result = result.tweet;
    }

    const tweet = Tweet.fromGraphQL(result);
    if (tweet) tweets.push(tweet);
  }

  return tweets;
}

/**
 * Parse a single timeline entry into a Profile.
 *
 * @param {Object} entry - A timeline entry object
 * @returns {Profile|null}
 */
export function parseUserEntry(entry) {
  const userResult = entry?.content?.itemContent?.user_results?.result;
  if (!userResult) return null;

  return Profile.fromGraphQL(userResult);
}

/**
 * Extract a cursor value from timeline entries.
 *
 * @param {Object[]} entries - Array of timeline entries
 * @param {'top'|'bottom'} direction - Cursor direction
 * @returns {string|null}
 */
export function extractCursor(entries, direction = 'bottom') {
  for (const entry of entries) {
    if (
      entry.entryId?.startsWith(`cursor-${direction}`) &&
      entry.content?.value
    ) {
      return entry.content.value;
    }
  }
  return null;
}
