// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client: DM conversation parsing shared by the client and the
 * HTTP scraper.
 *
 * X serves a conversation's `participants` in two shapes: an array of
 * `{ user_id, is_admin, join_time, ... }` objects (inbox_initial_state and
 * inbox_timeline), and an object keyed by user id on other surfaces. Reading
 * the array with `Object.keys` yields its indexes ("0", "1", ...) instead of
 * user ids, which is the bug these helpers exist to prevent.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Normalise either participants shape to `[userId, participant]` pairs.
 *
 * @param {Array|Object|undefined} participants
 * @returns {Array<[string, Object]>}
 */
function participantEntries(participants) {
  if (Array.isArray(participants)) {
    return participants
      .map((p) => (p && typeof p === 'object' ? [p.user_id ?? p.id, p] : [p, {}]))
      .filter(([id]) => id !== undefined && id !== null && id !== '')
      .map(([id, p]) => [String(id), p]);
  }
  if (participants && typeof participants === 'object') {
    return Object.entries(participants).map(([id, p]) => [String(id), p || {}]);
  }
  return [];
}

/**
 * User ids of everyone in a conversation.
 *
 * @param {Array|Object|undefined} participants
 * @returns {string[]}
 */
export function parseParticipants(participants) {
  return participantEntries(participants).map(([id]) => id);
}

/**
 * User ids of a group's admins.
 *
 * @param {Array|Object|undefined} participants
 * @returns {string[]}
 */
export function parseAdminUserIds(participants) {
  return participantEntries(participants)
    .filter(([, p]) => p.is_admin === true || p.is_admin === 'true')
    .map(([id]) => id);
}

/**
 * Group metadata for a GROUP_DM conversation, or null for a one-to-one.
 *
 * @param {Object} conv - raw conversation object
 * @returns {{ name: string, avatar: string, adminUserIds: string[] }|null}
 */
export function parseGroupMetadata(conv) {
  if (conv?.type !== 'GROUP_DM') return null;
  return {
    name: conv.name || '',
    avatar: conv.avatar_image_https || conv.avatar?.image?.original_info?.url || '',
    adminUserIds: parseAdminUserIds(conv.participants),
  };
}

/**
 * The newest message entry for one conversation among an inbox's entries.
 * X lists a conversation's messages in `entries`, not on the conversation, and
 * some responses omit `last_message` entirely.
 *
 * @param {Array} entries - inbox `entries`
 * @param {string} conversationId
 * @returns {Object|null} the entry's `message` object
 */
export function latestMessageFor(entries, conversationId) {
  let latest = null;
  for (const entry of entries || []) {
    const msg = entry?.message;
    if (!msg || msg.conversation_id !== conversationId || !msg.message_data) continue;
    if (!latest || compareIds(msg.id, latest.id) > 0) latest = msg;
  }
  return latest;
}

/**
 * Unread message count. X sends `unread_count` on some responses; otherwise
 * it is the number of loaded messages newer than `last_read_event_id`.
 *
 * @param {Object} conv - raw conversation object
 * @param {Array} entries - inbox `entries`
 * @param {string} conversationId
 * @returns {number}
 */
export function unreadCountFor(conv, entries, conversationId) {
  if (conv?.unread_count !== undefined && conv.unread_count !== null) {
    return Number(conv.unread_count) || 0;
  }
  const lastRead = conv?.last_read_event_id;
  if (!lastRead) return 0;
  let unread = 0;
  for (const entry of entries || []) {
    const msg = entry?.message;
    if (msg?.conversation_id === conversationId && msg.message_data && compareIds(msg.id, lastRead) > 0) {
      unread++;
    }
  }
  return unread;
}

/**
 * Compare two snowflake ids numerically. They exceed 2^53, so they are
 * compared as strings of digits rather than as Numbers.
 *
 * @param {string|number} a
 * @param {string|number} b
 * @returns {number} negative, zero or positive
 */
export function compareIds(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}
