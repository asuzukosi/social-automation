// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests — src/client/auth/TokenManager.js
 *
 * Regression coverage for the header X silently requires. Every request the
 * HTTP-only client makes must carry a browser User-Agent: without one,
 * `POST /1.1/guest/activate.json` answers HTTP 404 "Sorry, that page does not
 * exist", which reads like a removed endpoint and took the whole HTTP client
 * offline until someone thought to compare headers with curl.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import { TokenManager } from '../../../src/client/auth/TokenManager.js';
import { USER_AGENTS, randomUserAgent } from '../../../src/client/auth/userAgent.js';

/**
 * Build a fetch stub that records every request it receives.
 * @param {object} [response] - JSON body to answer with
 * @returns {{fetch: Function, calls: Array<{url: string, init: object}>}}
 */
function recordingFetch(response = { guest_token: '1234567890' }) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => response,
      text: async () => JSON.stringify(response),
      headers: { get: () => null },
    };
  };
  return { fetch, calls };
}

describe('TokenManager user agent', () => {
  it('picks a browser User-Agent from the pool', () => {
    const manager = new TokenManager();
    expect(USER_AGENTS).toContain(manager.userAgent);
    expect(manager.userAgent).toMatch(/^Mozilla\/5\.0 /);
  });

  it('sends a User-Agent when activating a guest token', async () => {
    const { fetch, calls } = recordingFetch();
    const manager = new TokenManager(fetch);

    await manager.activateGuestToken();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('guest/activate.json');
    expect(calls[0].init.headers['User-Agent']).toBe(manager.userAgent);
    expect(calls[0].init.headers.Authorization).toContain('Bearer ');
  });

  it('includes the User-Agent in guest request headers', () => {
    const manager = new TokenManager();
    manager.guestToken = 'abc';

    const headers = manager.getHeaders(false);

    expect(headers['User-Agent']).toBe(manager.userAgent);
    expect(headers['x-guest-token']).toBe('abc');
  });

  it('includes the User-Agent in authenticated request headers', () => {
    const manager = new TokenManager();
    manager.setCsrfToken('ct0-value');

    const headers = manager.getHeaders(true);

    expect(headers['User-Agent']).toBe(manager.userAgent);
    expect(headers['x-csrf-token']).toBe('ct0-value');
    expect(headers['x-twitter-auth-type']).toBe('OAuth2Session');
  });

  it('keeps one User-Agent for the lifetime of a session', async () => {
    const { fetch, calls } = recordingFetch();
    const manager = new TokenManager(fetch);

    await manager.activateGuestToken();
    manager.invalidateGuestToken();
    await manager.activateGuestToken();

    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers['User-Agent']).toBe(calls[1].init.headers['User-Agent']);
  });
});

describe('randomUserAgent', () => {
  it('only ever returns strings from the pool', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(USER_AGENTS).toContain(randomUserAgent());
    }
  });
});
