// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for api/services/xSession.js: turning a saved session into a
 * logged-in client, and reading group DMs through it.
 *
 * The real Scraper and DM client run; only fetch is replaced, answering the
 * way x.com, api.x.com and the DM endpoints do.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { Scraper } from '../../src/client/index.js';
import {
  XSessionError,
  listDmGroups,
  mintCsrfToken,
  sessionCookieHeader,
} from '../../api/services/xSession.js';

function response(status, body, setCookies = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => null,
      getSetCookie: () => setCookies,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const LIVE_SESSION = [
  'ct0=freshcsrf123; Max-Age=21600; Path=/; Domain=.x.com; Secure; SameSite=Lax',
  'guest_id=v1%3A1; Max-Age=34214400; Path=/; Domain=.x.com; Secure; SameSite=None',
];
const DEAD_SESSION = [
  'ct0=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/; Domain=.x.com; Secure',
  'auth_token=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Path=/; Domain=.x.com; Secure',
];

describe('mintCsrfToken', () => {
  it('returns the ct0 x.com issues for a live auth_token', async () => {
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, init });
      return response(200, {}, LIVE_SESSION);
    };
    await expect(mintCsrfToken('tok', fetch)).resolves.toBe('freshcsrf123');
    expect(requests[0].url).toBe('https://x.com/');
    expect(requests[0].init.headers.Cookie).toBe('auth_token=tok');
  });

  it('reports a revoked session as SESSION_EXPIRED, not a server fault', async () => {
    const error = await mintCsrfToken('dead', async () => response(200, {}, DEAD_SESSION)).catch((e) => e);
    expect(error).toBeInstanceOf(XSessionError);
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(error.status).toBe(401);
  });

  it('reports a response with neither signal as CSRF_UNAVAILABLE', async () => {
    const error = await mintCsrfToken('tok', async () => response(503, {}, [])).catch((e) => e);
    expect(error.code).toBe('CSRF_UNAVAILABLE');
    expect(error.status).toBe(502);
  });
});

describe('sessionCookieHeader', () => {
  it('keeps a full cookie header that already carries ct0 without a network call', async () => {
    const fetch = async () => {
      throw new Error('should not fetch');
    };
    await expect(sessionCookieHeader(' auth_token=a; ct0=b; twid=u%3D1 ', fetch)).resolves.toBe(
      'auth_token=a; ct0=b; twid=u%3D1',
    );
  });

  it('mints ct0 for a bare auth_token and for a header missing it', async () => {
    const fetch = async () => response(200, {}, LIVE_SESSION);
    await expect(sessionCookieHeader('tok', fetch)).resolves.toBe('auth_token=tok; ct0=freshcsrf123');
    await expect(sessionCookieHeader('auth_token=tok; twid=1', fetch)).resolves.toBe(
      'auth_token=tok; twid=1; ct0=freshcsrf123',
    );
  });

  it('refuses a header with no auth_token', async () => {
    const error = await sessionCookieHeader('ct0=only', async () => response(200, {})).catch((e) => e);
    expect(error.code).toBe('NO_SESSION');
  });
});

describe('listDmGroups', () => {
  function inboxFetch(calls) {
    return async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/guest/activate.json')) return response(200, { guest_token: '1' });
      if (url.includes('/dm/inbox_initial_state.json')) {
        return response(200, {
          inbox_initial_state: {
            inbox_timelines: { trusted: { status: 'AT_END' } },
            conversations: {
              '10-20': { type: 'ONE_TO_ONE', participants: [{ user_id: '10' }, { user_id: '20' }] },
              g1: {
                type: 'GROUP_DM',
                name: 'Builders',
                avatar_image_https: 'https://pbs.twimg.com/dm_group_img/g1.jpg',
                sort_timestamp: '1727000000000',
                participants: [{ user_id: '10', is_admin: true }, { user_id: '30' }],
                unread_count: 1,
              },
              g2: { type: 'GROUP_DM', name: 'Second', participants: [{ user_id: '40' }] },
            },
            entries: [
              { message: { id: '9', conversation_id: 'g1', message_data: { text: 'gm', sender_id: '30' } } },
            ],
          },
        });
      }
      throw new Error(`unplanned request ${url}`);
    };
  }

  it('returns only group DMs with ids, admins and preview, through the real client', async () => {
    const calls = [];
    const scraper = new Scraper({ fetch: inboxFetch(calls) });
    await scraper.setCookies('auth_token=tok; ct0=csrf');

    const groups = await listDmGroups(scraper, 50);
    expect(groups).toEqual([
      {
        id: 'g1',
        name: 'Builders',
        avatar: 'https://pbs.twimg.com/dm_group_img/g1.jpg',
        participants: ['10', '30'],
        adminUserIds: ['10'],
        lastMessage: 'gm',
        unreadCount: 1,
        updatedAt: new Date(1727000000000).toISOString(),
      },
      {
        id: 'g2',
        name: 'Second',
        avatar: '',
        participants: ['40'],
        adminUserIds: [],
        lastMessage: '',
        unreadCount: 0,
        updatedAt: '',
      },
    ]);

    const inbox = calls.find((c) => c.url.includes('inbox_initial_state'));
    expect(inbox.init.headers.Cookie).toBe('auth_token=tok; ct0=csrf');
    expect(inbox.init.headers['x-csrf-token']).toBe('csrf');
  });

  it('stops once the limit is reached', async () => {
    const scraper = new Scraper({ fetch: inboxFetch([]) });
    await scraper.setCookies('auth_token=tok; ct0=csrf');
    const groups = await listDmGroups(scraper, 1);
    expect(groups.map((g) => g.id)).toEqual(['g1']);
  });
});
