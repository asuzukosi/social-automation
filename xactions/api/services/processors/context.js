// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Job context: everything a queue processor needs, resolved once per job.
 *
 * Jobs arrive from two kinds of route. Dashboard routes (api/routes/*.js) run
 * for a signed-in user, whose X session is stored encrypted on the User row;
 * the job carries the userId and the session is decrypted here. AI routes
 * (api/routes/ai/*.js) are called by agents with no account, who send their
 * own cookie with the request; that raw cookie travels in the job config.
 * Processors never touch either form directly: they ask the context for a
 * client, and get one logged in as the right account.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { createHash } from 'node:crypto';

/** A problem with the job's input. Retrying cannot fix it. */
export class JobInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JobInputError';
    this.retryable = false;
  }
}

/** Thrown by ctx.throwIfCancelled() once the job has been cancelled. */
export class JobCancelledError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'JobCancelledError';
    this.retryable = false;
  }
}

/** Config keys routes use for a caller-supplied session. */
export const SESSION_KEYS = ['sessionCookie', 'session', 'authToken', 'cookie'];

/**
 * A stable, non-reversible tag for the session in a job config, so an agent
 * can find its own operations and stored state and nobody else's. The queue
 * stamps it on every job as `sessionHash`.
 *
 * @param {object} config
 * @returns {string|null}
 */
export function sessionHashOf(config) {
  const value = SESSION_KEYS.map((key) => config?.[key]).find((v) => typeof v === 'string' && v.trim());
  return value ? createHash('sha256').update(value.trim()).digest('hex').slice(0, 32) : null;
}

/**
 * The ownerKey a job queued with this cookie runs under, for routes that read
 * what such a job stored.
 *
 * @param {string} cookie
 * @returns {string|null}
 */
export function ownerKeyForSession(cookie) {
  const hash = sessionHashOf({ sessionCookie: cookie });
  return hash ? `session:${hash}` : null;
}

/**
 * The session a job should act as, before any network call.
 *
 * @param {{ userId?: string, config?: object }} data - job data
 * @param {{ decrypt?: (userId: string) => Promise<string|null> }} [deps]
 * @returns {Promise<string|null>} a bare auth_token or a cookie header
 */
export async function resolveSessionValue(data, deps = {}) {
  // A cookie sent with the request is the caller's explicit choice.
  for (const key of SESSION_KEYS) {
    const value = data.config?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (data.userId) {
    const decrypt = deps.decrypt || (await import('../../routes/session-auth.js')).getDecryptedSessionCookie;
    const stored = await decrypt(data.userId);
    if (stored) return stored;
  }
  return null;
}

/**
 * The auth_token value inside a stored session (browser automation sets only
 * that cookie).
 * @param {string} value
 * @returns {string}
 */
export function authTokenOf(value) {
  if (!value.includes('=')) return value;
  const match = value.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? match[1].trim() : '';
}

/**
 * Build the context for one job.
 *
 * @param {object} job - the Bull job (`data`, `progress`)
 * @param {object} [deps]
 * @param {(id: string) => boolean} [deps.isCancelled]
 * @param {(userId: string) => Promise<string|null>} [deps.decrypt]
 * @param {typeof fetch} [deps.fetch] - network boundary, for the HTTP clients
 * @param {() => Promise<object>} [deps.browser] - returns browserAutomation
 */
export function createJobContext(job, deps = {}) {
  const data = job.data || {};
  const config = data.config || {};
  const operationId = data.operationId || data.id || String(job.id);
  const disposers = [];
  const memo = new Map();

  const once = (key, build) => {
    if (!memo.has(key)) memo.set(key, build());
    return memo.get(key);
  };

  const ctx = {
    type: data.type || job.name,
    operationId,
    userId: data.userId || null,
    /**
     * Who owns anything this job stores (personas, tags, monitors, webhooks):
     * the dashboard user, or for an agent a hash of the session it sent. Never
     * store per-caller state under any other key.
     */
    ownerKey: data.userId ? `user:${data.userId}` : data.sessionHash ? `session:${data.sessionHash}` : null,
    config,
    data,

    /** Report progress to pollers and the dashboard socket. */
    progress(message, extra = {}) {
      const payload = typeof message === 'string' ? { status: 'running', message, ...extra } : message;
      return job.progress?.(payload);
    },

    cancelled() {
      return deps.isCancelled ? deps.isCancelled(operationId) : false;
    },

    throwIfCancelled() {
      if (ctx.cancelled()) throw new JobCancelledError();
    },

    /** Wait, waking early (and throwing) if the job is cancelled. */
    async sleep(ms) {
      const step = 500;
      for (let waited = 0; waited < ms; waited += step) {
        ctx.throwIfCancelled();
        await new Promise((resolve) => setTimeout(resolve, Math.min(step, ms - waited)));
      }
      ctx.throwIfCancelled();
    },

    /**
     * Charge write actions against the account's rolling 24 hour cap (the
     * same ledger the MCP server uses). Throws ActionCapExceededError, which
     * is not retried, when the cap would be exceeded.
     *
     * @param {'post'|'reply'|'like'|'repost'|'follow'|'unfollow'|'dm'|'block'|'mute'|'delete'} actionClass
     * @param {number} [count=1]
     */
    async charge(actionClass, count = 1) {
      const caps = deps.caps || (await import('../../../src/mcp/action-caps.js'));
      return caps.checkAndRecord(ctx.ownerKey || 'default', actionClass, { count });
    },

    /** Read a required config field, or fail the job without retrying. */
    require(field, label = field) {
      const value = config[field];
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        throw new JobInputError(`${label} is required`);
      }
      return value;
    },

    /** Whether any session is available for this job. */
    async hasSession() {
      return Boolean(await once('sessionValue', () => resolveSessionValue(data, deps)));
    },

    /**
     * The session as a cookie header carrying auth_token and ct0.
     * @returns {Promise<string>}
     */
    cookieHeader() {
      return once('cookieHeader', async () => {
        const { XSessionError, sessionCookieHeader } = await import('../xSession.js');
        const value = await once('sessionValue', () => resolveSessionValue(data, deps));
        if (!value) {
          throw new XSessionError(
            'NO_SESSION',
            data.userId
              ? 'No X session is connected. Save one with POST /api/session/save-session first.'
              : 'Provide your X session as sessionCookie in the body or the X-Session-Cookie header.',
            400,
          );
        }
        return sessionCookieHeader(value, deps.fetch);
      });
    },

    /** The bare auth_token, for browser automation. */
    async authToken() {
      const value = await once('sessionValue', () => resolveSessionValue(data, deps));
      return value ? authTokenOf(value) : '';
    },

    /**
     * The HTTP scraper client (src/scrapers/twitter/http), logged in.
     * @returns {Promise<import('../../../src/scrapers/twitter/http/client.js').TwitterHttpClient>}
     */
    http() {
      return once('http', async () => {
        const { TwitterHttpClient } = await import('../../../src/scrapers/twitter/http/client.js');
        return new TwitterHttpClient({
          cookies: await ctx.cookieHeader(),
          rateLimitStrategy: 'wait',
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
        });
      });
    },

    /**
     * The client-library Scraper (src/client), logged in. Carries the DM API.
     * @returns {Promise<import('../../../src/client/Scraper.js').Scraper>}
     */
    scraper() {
      return once('scraper', async () => {
        const { Scraper } = await import('../../../src/client/index.js');
        const scraper = new Scraper(deps.fetch ? { fetch: deps.fetch } : {});
        await scraper.setCookies(await ctx.cookieHeader());
        return scraper;
      });
    },

    /**
     * A Puppeteer page logged in as the session, closed when the job ends.
     * Only for what X's HTTP API cannot do.
     */
    page() {
      return once('page', async () => {
        const automation = deps.browser ? await deps.browser() : (await import('../browserAutomation.js')).default;
        const token = await ctx.authToken();
        if (!token) await ctx.cookieHeader(); // raises the NO_SESSION error
        const page = await automation.createPage(token);
        disposers.push(() => page.close().catch(() => {}));
        return page;
      });
    },

    /** Release browser pages and anything else the job opened. */
    async dispose() {
      await Promise.allSettled(disposers.splice(0).map((fn) => fn()));
    },
  };

  return ctx;
}

/**
 * Whether a failure should stop retries.
 * @param {Error} err
 */
export function isPermanentFailure(err) {
  return (
    err?.retryable === false ||
    ['XSessionError', 'AuthError', 'ActionCapExceededError', 'JobInputError'].includes(err?.name)
  );
}
