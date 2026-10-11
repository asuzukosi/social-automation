// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — DM API
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { Message } from '../models/Message.js';
import {
  latestMessageFor,
  parseGroupMetadata,
  parseParticipants,
  unreadCountFor,
} from './dmConversation.js';

/**
 * Send a DM in an existing conversation.
 *
 * @param {Object} http
 * @param {string} conversationId
 * @param {string} text
 * @returns {Promise<{id: string, text: string, createdAt: string}>}
 */
export async function sendDm(http, conversationId, text) {
  const body = new URLSearchParams({
    conversation_id: conversationId,
    text,
    cards_platform: 'Web-12',
    include_cards: '1',
    include_quote_count: 'true',
    dm_users: 'false',
  });

  const data = await http.post('https://x.com/i/api/1.1/dm/new2.json', body.toString(), {
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  const entries = data?.entries || [];
  const msg = entries[0]?.message;
  return {
    id: msg?.id?.toString() || '',
    text: msg?.message_data?.text || text,
    createdAt: msg?.time ? new Date(Number(msg.time)).toISOString() : new Date().toISOString(),
  };
}

/**
 * Send a DM to a user by their ID (creates a new conversation if needed).
 *
 * @param {Object} http
 * @param {string} userId
 * @param {string} text
 * @returns {Promise<{id: string, text: string, createdAt: string}>}
 */
export async function sendDmToUser(http, userId, text) {
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  const body = new URLSearchParams({
    text,
    cards_platform: 'Web-12',
    include_cards: '1',
    include_quote_count: 'true',
    dm_users: 'false',
    recipient_ids: 'false',
    request_id: requestId,
  });

  // Twitter expects comma-separated IDs in a specific JSON format
  const payload = JSON.stringify({
    conversation_id: `${userId}`,
    recipient_ids: [userId],
    text,
    cards_platform: 'Web-12',
    include_cards: 1,
    include_quote_count: true,
    dm_users: false,
    request_id: requestId,
  });

  const data = await http.post('https://x.com/i/api/1.1/dm/new2.json', payload, {
    'Content-Type': 'application/json',
  });

  const entries = data?.entries || [];
  const msg = entries[0]?.message;
  return {
    id: msg?.id?.toString() || '',
    text: msg?.message_data?.text || text,
    createdAt: msg?.time ? new Date(Number(msg.time)).toISOString() : new Date().toISOString(),
  };
}

const INBOX_PARAMS = {
  nsfw_filtering_enabled: 'false',
  filter_low_quality: 'false',
  include_quality: 'all',
  include_profile_interstitial_type: '1',
  include_blocking: '1',
  include_blocked_by: '1',
  include_followed_by: '1',
  include_want_retweets: '1',
  include_mute_edge: '1',
  include_can_dm: '1',
  include_can_media_tag: '1',
  include_ext_has_nft_avatar: '1',
  skip_status: '1',
  dm_secret_conversations_enabled: 'false',
  krs_registration_enabled: 'true',
  cards_platform: 'Web-12',
  include_cards: '1',
  include_ext_alt_text: 'true',
  include_quote_count: 'true',
  include_reply_count: '1',
  tweet_mode: 'extended',
  dm_users: 'true',
  include_groups: 'true',
  include_inbox_timelines: 'true',
  include_ext_media_color: 'true',
  supports_reactions: 'true',
  ext: 'mediaColor,altText,mediaStats,highlightedLabel,voiceInfo',
};

/**
 * Normalise one raw inbox conversation.
 *
 * @param {string} convId
 * @param {Object} conv - raw conversation
 * @param {Array} entries - the inbox page's message entries
 * @returns {DmConversation}
 */
export function normalizeConversation(convId, conv, entries = []) {
  const latest = latestMessageFor(entries, convId);
  const lastMessage = latest?.message_data?.text ?? conv.last_message?.message_data?.text ?? '';
  const updatedAt = conv.sort_timestamp
    ? new Date(Number(conv.sort_timestamp)).toISOString()
    : latest?.time
      ? new Date(Number(latest.time)).toISOString()
      : '';

  return {
    id: convId,
    type: conv.type || 'ONE_TO_ONE',
    participants: parseParticipants(conv.participants),
    lastMessage,
    updatedAt,
    unreadCount: unreadCountFor(conv, entries, convId),
    ...parseGroupMetadata(conv),
  };
}

/**
 * Get DM conversations, following the inbox cursor until `count` are yielded
 * or the inbox is exhausted.
 *
 * @typedef {Object} DmConversation
 * @property {string} id
 * @property {string} type - 'ONE_TO_ONE' or 'GROUP_DM'
 * @property {string[]} participants - user ids
 * @property {string} lastMessage
 * @property {string} updatedAt - ISO timestamp, or '' when X omits it
 * @property {number} unreadCount
 * @property {string} [name] - GROUP_DM only
 * @property {string} [avatar] - GROUP_DM only
 * @property {string[]} [adminUserIds] - GROUP_DM only
 *
 * @param {Object} http
 * @param {number} [count=50]
 * @returns {AsyncGenerator<DmConversation>}
 */
export async function* getDmConversations(http, count = 50) {
  const params = new URLSearchParams(INBOX_PARAMS);
  const data = await http.get(
    `https://x.com/i/api/1.1/dm/inbox_initial_state.json?${params.toString()}`,
  );

  let page = data?.inbox_initial_state || {};
  let timeline = page.inbox_timelines?.trusted;
  let requestedMaxId = null;
  const seen = new Set();
  let yielded = 0;

  for (;;) {
    for (const [convId, conv] of Object.entries(page.conversations || {})) {
      if (yielded >= count) return;
      if (seen.has(convId)) continue;
      seen.add(convId);
      yield normalizeConversation(convId, conv, page.entries);
      yielded++;
    }

    if (yielded >= count || timeline?.status !== 'HAS_MORE' || !timeline.min_entry_id) return;
    // A page that hands back the cursor it was asked for would loop forever.
    if (timeline.min_entry_id === requestedMaxId) return;

    requestedMaxId = timeline.min_entry_id;
    const next = new URLSearchParams({ ...INBOX_PARAMS, max_id: requestedMaxId });
    const more = await http.get(
      `https://x.com/i/api/1.1/dm/inbox_timeline/trusted.json?${next.toString()}`,
    );
    page = more?.inbox_timeline || {};
    timeline = page;
  }
}

/**
 * Get messages in a DM conversation, newest first, paging back through
 * `max_id` until `count` are yielded or the conversation's start is reached.
 *
 * @param {Object} http
 * @param {string} conversationId
 * @param {number} [count=50]
 * @returns {AsyncGenerator<Message>}
 */
export async function* getDmMessages(http, conversationId, count = 50) {
  const seen = new Set();
  let maxId = null;
  let yielded = 0;

  while (yielded < count) {
    const params = new URLSearchParams({
      include_profile_interstitial_type: '1',
      include_blocking: '1',
      include_blocked_by: '1',
      include_followed_by: '1',
      include_want_retweets: '1',
      include_mute_edge: '1',
      include_can_dm: '1',
      include_can_media_tag: '1',
      include_ext_has_nft_avatar: '1',
      skip_status: '1',
      cards_platform: 'Web-12',
      include_cards: '1',
      include_ext_alt_text: 'true',
      include_quote_count: 'true',
      include_reply_count: '1',
      tweet_mode: 'extended',
      dm_users: 'false',
      include_groups: 'true',
      include_inbox_timelines: 'true',
      include_ext_media_color: 'true',
      supports_reactions: 'true',
      count: String(Math.min(count - yielded, 50)),
      ext: 'mediaColor,altText,mediaStats,highlightedLabel,voiceInfo',
    });
    if (maxId) params.set('max_id', maxId);

    const data = await http.get(
      `https://x.com/i/api/1.1/dm/conversation/${conversationId}.json?${params.toString()}`,
    );
    const timeline = data?.conversation_timeline || {};

    let fresh = 0;
    for (const entry of timeline.entries || []) {
      if (yielded >= count) return;
      const raw = entry.message;
      if (!raw?.message_data) continue;
      // max_id is inclusive, so each page repeats the previous page's oldest message.
      const id = String(raw.id ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      fresh++;
      yield Message.fromRaw(raw, conversationId);
      yielded++;
    }

    if (timeline.status !== 'HAS_MORE' || !timeline.min_entry_id || fresh === 0) return;
    maxId = timeline.min_entry_id;
  }
}
