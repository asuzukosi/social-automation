// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * X Session Service
 * Builds a logged-in X HTTP client from the session a user saved through
 * POST /api/session/save-session, and reads their DM inbox with it.
 *
 * The dashboard stores the auth_token cookie, encrypted, in User.sessionCookie.
 * X's HTTP API also wants the ct0 CSRF cookie, which x.com issues to any
 * request carrying a live auth_token, so it is minted per client rather than
 * stored. A saved value that is a full cookie header with ct0 is used as is.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { Scraper } from '../../src/client/index.js';
import { sessionUserAgent } from '../../src/client/auth/userAgent.js';
import { getDecryptedSessionCookie } from '../routes/session-auth.js';

/** Upper bound on conversations scanned to find groups, so one call stays bounded. */
const MAX_CONVERSATIONS_SCANNED = 500;

export class XSessionError extends Error {
  /**
   * @param {string} code - NO_SESSION, SESSION_EXPIRED or CSRF_UNAVAILABLE
   * @param {string} message
   * @param {number} status - HTTP status the API should answer with
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'XSessionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Parse `name=value; name2=value2` into a map.
 * @param {string} header
 * @returns {Record<string, string>}
 */
function parseCookieHeader(header) {
  const cookies = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

/**
 * Ask x.com for a CSRF token for this auth_token.
 *
 * @param {string} authToken
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>} the ct0 value
 */
export async function mintCsrfToken(authToken, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl('https://x.com/', {
    method: 'GET',
    headers: { Cookie: `auth_token=${authToken}`, 'User-Agent': sessionUserAgent() },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

  const issued = {};
  for (const line of res.headers.getSetCookie?.() || []) {
    Object.assign(issued, parseCookieHeader(line.split(';')[0]));
  }

  if (issued.ct0) return issued.ct0;
  // x.com answers a dead auth_token by expiring it (and ct0) in Set-Cookie.
  if (issued.auth_token === '') {
    throw new XSessionError(
      'SESSION_EXPIRED',
      'X rejected the saved session. Log in to x.com and save a fresh session cookie.',
      401,
    );
  }
  throw new XSessionError(
    'CSRF_UNAVAILABLE',
    `x.com answered ${res.status} without issuing a CSRF token. Try again shortly.`,
    502,
  );
}

/**
 * Turn a stored session value into a cookie header carrying auth_token and ct0.
 *
 * @param {string} stored - a bare auth_token, or a cookie header string
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string>}
 */
export async function sessionCookieHeader(stored, fetchImpl = globalThis.fetch) {
  const value = stored.trim();
  const cookies = value.includes('=') ? parseCookieHeader(value) : { auth_token: value };
  if (!cookies.auth_token) {
    throw new XSessionError('NO_SESSION', 'The saved session has no auth_token cookie. Save it again.', 400);
  }
  if (!cookies.ct0) cookies.ct0 = await mintCsrfToken(cookies.auth_token, fetchImpl);
  return Object.entries(cookies)
    .map(([name, v]) => `${name}=${v}`)
    .join('; ');
}

/**
 * A logged-in client for a user's saved session.
 *
 * @param {string} userId
 * @param {{ fetch?: typeof fetch }} [options]
 * @returns {Promise<Scraper>}
 */
export async function clientForUser(userId, options = {}) {
  const stored = await getDecryptedSessionCookie(userId);
  if (!stored) {
    throw new XSessionError(
      'NO_SESSION',
      'No X session is connected. Save one with POST /api/session/save-session first.',
      400,
    );
  }
  const scraper = new Scraper(options.fetch ? { fetch: options.fetch } : {});
  await scraper.setCookies(await sessionCookieHeader(stored, options.fetch));
  return scraper;
}

/**
 * The user's DM conversations, newest first.
 *
 * @param {Scraper} scraper - a logged-in client
 * @param {number} limit
 * @returns {Promise<import('../../src/client/api/dms.js').DmConversation[]>}
 */
export async function listDmConversations(scraper, limit) {
  const conversations = [];
  for await (const conv of scraper.getDmConversations(limit)) conversations.push(conv);
  return conversations;
}

/**
 * The user's group DMs, newest first. One-to-one conversations are skipped,
 * so up to MAX_CONVERSATIONS_SCANNED conversations are read to find `limit`
 * groups.
 *
 * @param {Scraper} scraper - a logged-in client
 * @param {number} limit
 * @returns {Promise<Array<{ id: string, name: string, avatar: string, participants: string[], adminUserIds: string[], lastMessage: string, unreadCount: number, updatedAt: string }>>}
 */
export async function listDmGroups(scraper, limit) {
  const groups = [];
  for await (const conv of scraper.getDmConversations(MAX_CONVERSATIONS_SCANNED)) {
    if (conv.type !== 'GROUP_DM') continue;
    groups.push({
      id: conv.id,
      name: conv.name,
      avatar: conv.avatar,
      participants: conv.participants,
      adminUserIds: conv.adminUserIds,
      lastMessage: conv.lastMessage,
      unreadCount: conv.unreadCount,
      updatedAt: conv.updatedAt,
    });
    if (groups.length >= limit) break;
  }
  return groups;
}

/**
 * The bare auth_token of a user's saved session, decrypted, or undefined when
 * none is saved. For engines that take a token rather than a client.
 *
 * @param {string|undefined} userId
 * @returns {Promise<string|undefined>}
 */
export async function authTokenForUser(userId) {
  if (!userId) return undefined;
  const stored = await getDecryptedSessionCookie(userId);
  if (!stored) return undefined;
  const { authTokenOf } = await import('./processors/context.js');
  return authTokenOf(stored) || undefined;
}
