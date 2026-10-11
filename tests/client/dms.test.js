// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the client DM fetchers (src/client/api/dms.js) and the shared
 * conversation parsing (src/client/api/dmConversation.js).
 *
 * The HTTP layer is replaced at its boundary with a recorder that serves
 * payloads in the shapes x.com returns from inbox_initial_state.json,
 * inbox_timeline/trusted.json and conversation/{id}.json.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getDmConversations, getDmMessages } from '../../src/client/api/dms.js';
import {
  compareIds,
  parseAdminUserIds,
  parseParticipants,
} from '../../src/client/api/dmConversation.js';
import { getInbox } from '../../src/scrapers/twitter/http/dm.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GROUP_ID = '1700000000000000001';
const ONE_TO_ONE_ID = '111-222';

function messageEntry(id, conversationId, text, senderId = '111', time = '1700000000000') {
  return {
    message: {
      id,
      time,
      conversation_id: conversationId,
      message_data: { id, time, sender_id: senderId, text },
    },
  };
}

function groupConversation(overrides = {}) {
  return {
    conversation_id: GROUP_ID,
    type: 'GROUP_DM',
    sort_event_id: '1800000000000000009',
    sort_timestamp: '1727000000000',
    name: 'Launch crew',
    avatar_image_https: 'https://pbs.twimg.com/dm_group_img/1/abc.jpg',
    participants: [
      { user_id: '111', join_time: '1700000000000', is_admin: true },
      { user_id: '222', join_time: '1700000000000', is_admin: false },
      { user_id: '333', join_time: '1700000000000' },
    ],
    last_read_event_id: '1800000000000000007',
    ...overrides,
  };
}

function oneToOneConversation() {
  return {
    conversation_id: ONE_TO_ONE_ID,
    type: 'ONE_TO_ONE',
    sort_timestamp: '1726000000000',
    participants: [{ user_id: '111' }, { user_id: '222' }],
    last_read_event_id: '1800000000000000005',
  };
}

/**
 * An `http` stand-in that answers by URL path and records every request.
 * @param {(url: URL) => object} route
 */
function recorder(route) {
  const calls = [];
  return {
    calls,
    async get(url) {
      const u = new URL(url);
      calls.push(u);
      return route(u);
    },
  };
}

async function collect(gen) {
  const out = [];
  for await (const item of gen) out.push(item);
  return out;
}

// ---------------------------------------------------------------------------
// Participant parsing
// ---------------------------------------------------------------------------

describe('parseParticipants', () => {
  it('returns user ids, not array indexes, for the array-of-objects shape', () => {
    expect(parseParticipants(groupConversation().participants)).toEqual(['111', '222', '333']);
  });

  it('reads the object keyed by user id', () => {
    expect(parseParticipants({ 444: { is_admin: true }, 555: {} })).toEqual(['444', '555']);
  });

  it('accepts bare ids and ignores empty slots', () => {
    expect(parseParticipants(['1', 2, null, ''])).toEqual(['1', '2']);
    expect(parseParticipants(undefined)).toEqual([]);
  });

  it('finds admins in either shape', () => {
    expect(parseAdminUserIds(groupConversation().participants)).toEqual(['111']);
    expect(parseAdminUserIds({ 444: { is_admin: true }, 555: { is_admin: false } })).toEqual(['444']);
  });

  it('orders snowflake ids beyond Number precision', () => {
    expect(compareIds('1800000000000000009', '1800000000000000008')).toBeGreaterThan(0);
    expect(compareIds('999', '1000')).toBeLessThan(0);
    expect(compareIds('42', '42')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDmConversations
// ---------------------------------------------------------------------------

describe('getDmConversations', () => {
  it('surfaces group ids, name, avatar, admins, preview and unread count', async () => {
    const http = recorder(() => ({
      inbox_initial_state: {
        inbox_timelines: { trusted: { status: 'AT_END', min_entry_id: '1' } },
        conversations: {
          [GROUP_ID]: groupConversation(),
          [ONE_TO_ONE_ID]: oneToOneConversation(),
        },
        entries: [
          messageEntry('1800000000000000008', GROUP_ID, 'older unread'),
          messageEntry('1800000000000000009', GROUP_ID, 'ship it', '222'),
          messageEntry('1800000000000000006', GROUP_ID, 'already read'),
          messageEntry('1800000000000000004', ONE_TO_ONE_ID, 'hey'),
        ],
      },
    }));

    const conversations = await collect(getDmConversations(http, 10));
    const group = conversations.find((c) => c.id === GROUP_ID);
    const direct = conversations.find((c) => c.id === ONE_TO_ONE_ID);

    expect(group).toEqual({
      id: GROUP_ID,
      type: 'GROUP_DM',
      participants: ['111', '222', '333'],
      lastMessage: 'ship it',
      updatedAt: new Date(1727000000000).toISOString(),
      unreadCount: 2,
      name: 'Launch crew',
      avatar: 'https://pbs.twimg.com/dm_group_img/1/abc.jpg',
      adminUserIds: ['111'],
    });
    expect(direct.participants).toEqual(['111', '222']);
    expect(direct.lastMessage).toBe('hey');
    expect(direct.unreadCount).toBe(0);
    expect(direct).not.toHaveProperty('name');
    expect(http.calls).toHaveLength(1);
  });

  it('prefers an explicit unread_count and falls back to last_message for the preview', async () => {
    const http = recorder(() => ({
      inbox_initial_state: {
        conversations: {
          [GROUP_ID]: groupConversation({
            unread_count: 5,
            last_message: { message_data: { text: 'from last_message' } },
          }),
        },
        entries: [],
      },
    }));
    const [group] = await collect(getDmConversations(http, 10));
    expect(group.unreadCount).toBe(5);
    expect(group.lastMessage).toBe('from last_message');
  });

  it('follows the trusted inbox cursor, de-duplicates, and stops at the count', async () => {
    const http = recorder((u) => {
      if (u.pathname.endsWith('/inbox_initial_state.json')) {
        return {
          inbox_initial_state: {
            inbox_timelines: { trusted: { status: 'HAS_MORE', min_entry_id: '500' } },
            conversations: { a: oneToOneConversation(), b: oneToOneConversation() },
            entries: [],
          },
        };
      }
      if (u.searchParams.get('max_id') === '500') {
        return {
          inbox_timeline: {
            status: 'HAS_MORE',
            min_entry_id: '400',
            conversations: { b: oneToOneConversation(), c: groupConversation(), d: oneToOneConversation() },
            entries: [],
          },
        };
      }
      throw new Error(`unplanned request ${u}`);
    });

    const conversations = await collect(getDmConversations(http, 3));
    expect(conversations.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(http.calls.map((u) => u.pathname)).toEqual([
      '/i/api/1.1/dm/inbox_initial_state.json',
      '/i/api/1.1/dm/inbox_timeline/trusted.json',
    ]);
    expect(http.calls[1].searchParams.get('include_groups')).toBe('true');
  });

  it('stops when the inbox is exhausted or the cursor stops moving', async () => {
    const http = recorder((u) => {
      if (u.pathname.endsWith('/inbox_initial_state.json')) {
        return {
          inbox_initial_state: {
            inbox_timelines: { trusted: { status: 'HAS_MORE', min_entry_id: '500' } },
            conversations: { a: oneToOneConversation() },
          },
        };
      }
      return { inbox_timeline: { status: 'HAS_MORE', min_entry_id: '500', conversations: { b: oneToOneConversation() } } };
    });

    const conversations = await collect(getDmConversations(http, 50));
    expect(conversations.map((c) => c.id)).toEqual(['a', 'b']);
    expect(http.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getDmMessages
// ---------------------------------------------------------------------------

describe('getDmMessages', () => {
  function pages(byMaxId) {
    return recorder((u) => {
      const page = byMaxId[u.searchParams.get('max_id') ?? 'first'];
      if (!page) throw new Error(`unplanned request ${u}`);
      return { conversation_timeline: page };
    });
  }

  it('pages back through max_id past 50 and skips the repeated boundary message', async () => {
    const first = Array.from({ length: 50 }, (_, i) => messageEntry(String(1100 - i), GROUP_ID, `m${1100 - i}`));
    const second = Array.from({ length: 30 }, (_, i) => messageEntry(String(1051 - i), GROUP_ID, `m${1051 - i}`));
    const http = pages({
      first: { status: 'HAS_MORE', min_entry_id: '1051', entries: first },
      1051: { status: 'AT_END', min_entry_id: '1022', entries: second },
    });

    const messages = await collect(getDmMessages(http, GROUP_ID, 75));
    const ids = messages.map((m) => m.id);
    expect(ids).toHaveLength(75);
    expect(new Set(ids).size).toBe(75);
    expect(ids[0]).toBe('1100');
    expect(ids[74]).toBe('1026');
    expect(messages[0].conversationId).toBe(GROUP_ID);
    expect(http.calls.map((u) => u.searchParams.get('count'))).toEqual(['50', '25']);
  });

  it('stops at the start of the conversation and on a page with nothing new', async () => {
    const http = pages({
      first: { status: 'HAS_MORE', min_entry_id: '10', entries: [messageEntry('11', GROUP_ID, 'b'), messageEntry('10', GROUP_ID, 'a')] },
      10: { status: 'HAS_MORE', min_entry_id: '10', entries: [messageEntry('10', GROUP_ID, 'a')] },
    });
    const messages = await collect(getDmMessages(http, GROUP_ID, 100));
    expect(messages.map((m) => m.text)).toEqual(['b', 'a']);
    expect(http.calls).toHaveLength(2);
  });

  it('skips entries that are not messages', async () => {
    const http = pages({
      first: {
        status: 'AT_END',
        entries: [{ join_conversation: { id: '5' } }, messageEntry('4', GROUP_ID, 'hi')],
      },
    });
    const messages = await collect(getDmMessages(http, GROUP_ID, 10));
    expect(messages.map((m) => m.text)).toEqual(['hi']);
  });
});

// ---------------------------------------------------------------------------
// HTTP scraper inbox parsing shares the same rules
// ---------------------------------------------------------------------------

describe('scraper getInbox group metadata', () => {
  it('surfaces group name, avatar and admins and reads the keyed participants shape', async () => {
    const client = {
      isAuthenticated: () => true,
      request: async () => ({
        inbox_initial_state: {
          conversations: {
            [GROUP_ID]: groupConversation({ participants: { 111: { is_admin: true }, 222: {} } }),
          },
          entries: [],
          users: { 111: { screen_name: 'alice' } },
        },
      }),
    };
    const { conversations } = await getInbox(client);
    expect(conversations[0]).toMatchObject({
      conversationId: GROUP_ID,
      type: 'group',
      name: 'Launch crew',
      adminUserIds: ['111'],
      participants: [
        { id: '111', username: 'alice' },
        { id: '222', username: '' },
      ],
    });
  });
});
