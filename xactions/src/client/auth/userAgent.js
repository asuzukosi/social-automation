// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client - browser identity
 *
 * X rejects requests that do not look like they came from a browser. A bare
 * `fetch()` from Node sends `User-Agent: node` (or omits the header), and
 * `POST /1.1/guest/activate.json` answers with HTTP 404
 * `{"errors":[{"message":"Sorry, that page does not exist","code":34}]}`, a
 * misleading status that reads like a removed endpoint rather than a rejected
 * client. Sending a real browser User-Agent makes the same request return 200
 * with a guest token.
 *
 * Two things changed here, both about looking less unusual rather than more:
 *
 * 1. **The strings are generated, not typed.** They come from
 *    `./userAgents.generated.js`, refreshed by `npm run sync:user-agents` from
 *    the browsers that ship today. A hand-maintained pool is stale the week
 *    after it is written, and a User-Agent two major versions behind is itself
 *    a signal: no real install stays that far back.
 *
 * 2. **One profile per session, not one per request.** The pool used to pick a
 *    random string on every call, so a single session would claim to be Chrome
 *    on Windows, then Firefox on macOS, then Chrome on Linux, from one IP,
 *    inside one cookie jar. That is a stronger tell than any single stale
 *    string: real browsers do not change identity mid-session. The default is
 *    now one profile, chosen once, held for the life of the process, with its
 *    matching client hints. Rotation is still available and still a good idea
 *    when each request really is a different scraping identity (a pool of
 *    accounts, each behind its own proxy), which is why it is an explicit
 *    choice rather than the default.
 *
 * ```javascript
 * import { sessionUserAgent, sessionProfile, clientHintHeaders } from './userAgent.js';
 *
 * sessionUserAgent();                              // same string every call
 * sessionProfile().platform;                       // 'windows'
 * clientHintHeaders();                             // Sec-CH-UA headers that agree with it
 *
 * // Per-identity rotation, opted into:
 * import { configureUserAgent, rotateUserAgent } from './userAgent.js';
 * configureUserAgent({ rotate: true });            // or XACTIONS_ROTATE_USER_AGENT=1
 * rotateUserAgent();                               // a fresh profile per call
 *
 * // Or pin one deliberately:
 * configureUserAgent({ profileId: 'firefox-macos' });
 * ```
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { PROFILES, DEFAULT_PROFILE_ID, USER_AGENT_STRINGS, VERSIONS, UPSTREAM } from './userAgents.generated.js';

/**
 * The browser profiles available: User-Agent plus the headers a real install of
 * that browser sends with it.
 * @type {typeof PROFILES}
 */
export const USER_AGENT_PROFILES = PROFILES;

/**
 * Browser User-Agent strings, one per profile.
 * @type {readonly string[]}
 */
export const USER_AGENTS = USER_AGENT_STRINGS;

/**
 * Where the pool came from and when, for `xactions doctor`.
 * @type {typeof UPSTREAM}
 */
export const USER_AGENT_SOURCE = UPSTREAM;

/**
 * The browser versions the pool represents.
 * @type {typeof VERSIONS}
 */
export const BROWSER_VERSIONS = VERSIONS;

/**
 * The User-Agent used when a caller has not asked for anything in particular.
 * @type {string}
 */
export const DEFAULT_USER_AGENT = profileById(DEFAULT_PROFILE_ID).userAgent;

/** @type {{profileId: string|null, rotate: boolean|null}} */
const config = { profileId: null, rotate: null };

/** @type {object|null} The profile this process settled on, chosen once. */
let session = null;

/**
 * Look a profile up by id.
 *
 * @param {string} id
 * @returns {typeof PROFILES[number]}
 * @throws {Error} when no profile carries that id
 */
export function profileById(id) {
  const found = PROFILES.find((profile) => profile.id === id);
  if (!found) {
    throw new Error(`Unknown user-agent profile "${id}". Available: ${PROFILES.map((p) => p.id).join(', ')}`);
  }
  return found;
}

/**
 * Choose settings for this process.
 *
 * @param {object} [options]
 * @param {string} [options.profileId] Pin a specific profile, e.g. 'firefox-macos'
 * @param {boolean} [options.rotate] Pick a fresh profile per request instead of holding one
 * @returns {typeof PROFILES[number]} the profile now in force
 */
export function configureUserAgent(options = {}) {
  if (options.profileId !== undefined) {
    config.profileId = options.profileId;
    session = options.profileId === null ? null : profileById(options.profileId);
  }
  if (options.rotate !== undefined) config.rotate = options.rotate;
  return sessionProfile();
}

/**
 * Forget the chosen profile and any configuration, so the next call picks
 * again. Mainly for tests and for a long-lived process that has genuinely
 * changed identity (a new proxy, a new account).
 *
 * @returns {void}
 */
export function resetUserAgentSession() {
  session = null;
  config.profileId = null;
  config.rotate = null;
}

/**
 * Whether rotation is on: an explicit `configureUserAgent({ rotate })` wins,
 * otherwise `XACTIONS_ROTATE_USER_AGENT` (`1`, `true`, `yes`), otherwise off.
 *
 * @returns {boolean}
 */
export function isRotationEnabled() {
  if (config.rotate !== null) return config.rotate;
  const env = process.env.XACTIONS_ROTATE_USER_AGENT;
  return env === '1' || env === 'true' || env === 'yes';
}

/**
 * The profile this session presents. Chosen at random once, then held, so every
 * request from this process tells the same story.
 *
 * @returns {typeof PROFILES[number]}
 */
export function sessionProfile() {
  if (!session) {
    session = config.profileId ? profileById(config.profileId) : PROFILES[Math.floor(Math.random() * PROFILES.length)];
  }
  return session;
}

/**
 * The User-Agent this session presents.
 * @returns {string}
 */
export function sessionUserAgent() {
  return sessionProfile().userAgent;
}

/**
 * A profile picked at random, ignoring the session. Use this when each request
 * really is a separate identity, with its own cookies and its own proxy.
 *
 * @returns {typeof PROFILES[number]}
 */
export function rotateProfile() {
  return PROFILES[Math.floor(Math.random() * PROFILES.length)];
}

/**
 * A User-Agent picked at random, ignoring the session.
 * @returns {string}
 */
export function rotateUserAgent() {
  return rotateProfile().userAgent;
}

/**
 * The User-Agent to send.
 *
 * Kept under its original name because callers across the codebase import it,
 * but it no longer rotates by default: it returns the session profile's string
 * unless rotation is switched on with `configureUserAgent({ rotate: true })` or
 * `XACTIONS_ROTATE_USER_AGENT=1`. Pass `{ rotate: true }` to rotate this one
 * call.
 *
 * @param {object} [options]
 * @param {boolean} [options.rotate]
 * @returns {string}
 */
export function randomUserAgent(options = {}) {
  const rotate = options.rotate ?? isRotationEnabled();
  return rotate ? rotateUserAgent() : sessionUserAgent();
}

/**
 * The `Sec-CH-UA` client-hint headers that agree with a profile's User-Agent.
 *
 * Chromium sends these on every request and a fingerprinter compares them
 * against the User-Agent; sending one browser's hints with another's string is
 * worse than sending none. Gecko sends no client hints at all, so a Firefox
 * profile returns an empty object.
 *
 * @param {typeof PROFILES[number]} [profile] defaults to the session profile
 * @returns {Record<string, string>}
 */
export function clientHintHeaders(profile = sessionProfile()) {
  if (!profile.secChUa) return {};
  return {
    'sec-ch-ua': profile.secChUa,
    'sec-ch-ua-mobile': profile.secChUaMobile,
    'sec-ch-ua-platform': profile.secChUaPlatform,
  };
}

/**
 * Every header a profile implies, ready to spread into a request: the
 * User-Agent, the client hints when the browser sends them, and the
 * `Accept-Language` that browser reports.
 *
 * @param {typeof PROFILES[number]} [profile] defaults to the session profile
 * @returns {Record<string, string>}
 */
export function profileHeaders(profile = sessionProfile()) {
  return {
    'user-agent': profile.userAgent,
    'accept-language': profile.acceptLanguage,
    ...clientHintHeaders(profile),
  };
}
