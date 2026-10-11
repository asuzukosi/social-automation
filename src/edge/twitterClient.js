// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Guest-token X reads for the edge.
 *
 * Public data on x.com needs no account: activating a guest token is enough for
 * profiles, timelines and single posts. That is what lets the paid API run
 * entirely on Cloudflare with no database, no browser, and no user session to
 * custody.
 *
 * This is deliberately not `TwitterHttpClient`. That client carries rate-limit
 * strategies, an account pool, resumable checkpoints and a transaction-id cache,
 * all of which reach for the Node filesystem, and a Workers bundle refuses to
 * build with `node:fs` in the graph. Everything here is plain `fetch` over two
 * modules that hold no I/O: the generated endpoint table and the pure user
 * parser. A parser fix therefore still lands on the CLI, the MCP server and this
 * at the same time.
 *
 * @module src/edge/twitterClient
 * @author nichxbt
 */

import {
  OPERATIONS,
  FEATURE_NAMES,
  FEATURE_VALUES,
  FIELD_TOGGLE_NAMES,
} from '../scrapers/twitter/http/x-endpoints.generated.js';
import { parseUserData } from '../scrapers/twitter/http/parse/user.js';
import {
  parseTimelineInstructions,
  userTimelineInstructions,
} from '../scrapers/twitter/http/parse/tweet.js';
import {
  NotFoundError,
  AuthError,
  RateLimitError,
  TwitterApiError,
} from '../scrapers/twitter/http/errors.js';

const GRAPHQL_BASE = 'https://x.com/i/api/graphql';
const GUEST_ACTIVATE = 'https://api.x.com/1.1/guest/activate.json';

/**
 * The public bearer embedded in x.com's own web bundle. Same value the web app
 * sends; it authenticates the client application, not a user.
 */
const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/**
 * x.com answers a User-Agent-less guest activation with a misleading 404, so
 * every request here carries a browser UA.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

/** Guest tokens last well beyond a request; one per isolate is plenty. */
let guestTokenPromise = null;

/**
 * Activate a guest token, reusing the isolate's if one is already in flight.
 * A failed activation is not cached, so the next request retries.
 * @returns {Promise<string>}
 */
export function getGuestToken() {
  if (!guestTokenPromise) {
    guestTokenPromise = (async () => {
      const response = await fetch(GUEST_ACTIVATE, {
        method: 'POST',
        headers: { authorization: `Bearer ${BEARER_TOKEN}`, 'user-agent': USER_AGENT },
      });
      if (!response.ok) {
        throw new TwitterApiError(`guest activation failed (HTTP ${response.status})`, {
          status: response.status,
        });
      }
      const { guest_token: token } = await response.json();
      if (!token) throw new TwitterApiError('guest activation returned no token');
      return token;
    })();
    guestTokenPromise.catch(() => {
      guestTokenPromise = null;
    });
  }
  return guestTokenPromise;
}

/**
 * The feature-flag object x.com expects for one operation, rebuilt from the
 * generated table so it stays in step with `npm run sync:endpoints`.
 * @param {{ featureIdx?: number[], toggleIdx?: number[] }} operation
 * @returns {{ features: Record<string, boolean>, fieldToggles: Record<string, boolean> }}
 */
export function operationFlags(operation) {
  const features = {};
  for (const index of operation.featureIdx || []) {
    const name = FEATURE_NAMES[index];
    if (name) features[name] = FEATURE_VALUES[name] ?? false;
  }
  const fieldToggles = {};
  for (const index of operation.toggleIdx || []) {
    const name = FIELD_TOGGLE_NAMES[index];
    if (name) fieldToggles[name] = false;
  }
  return { features, fieldToggles };
}

/**
 * Run one GraphQL query as a guest and return the payload with x.com's `data`
 * envelope already stripped, the same shape the scrapers read.
 *
 * @param {string} operationName - A key of the generated OPERATIONS table.
 * @param {object} variables
 * @returns {Promise<object>}
 */
export async function guestGraphQL(operationName, variables) {
  const operation = OPERATIONS[operationName];
  if (!operation) throw new TwitterApiError(`unknown GraphQL operation ${operationName}`);

  const { features, fieldToggles } = operationFlags(operation);
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });
  if (Object.keys(fieldToggles).length) params.set('fieldToggles', JSON.stringify(fieldToggles));

  const token = await getGuestToken();
  const response = await fetch(`${GRAPHQL_BASE}/${operation.queryId}/${operationName}?${params}`, {
    headers: {
      authorization: `Bearer ${BEARER_TOKEN}`,
      'x-guest-token': token,
      'user-agent': USER_AGENT,
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    },
  });

  if (response.status === 401 || response.status === 403) {
    guestTokenPromise = null;
    throw new AuthError(`x.com refused the guest token (HTTP ${response.status})`, {
      status: response.status,
    });
  }
  if (response.status === 429) {
    throw new RateLimitError('x.com rate-limited this guest token', { status: 429 });
  }
  if (!response.ok) {
    throw new TwitterApiError(`${operationName} failed (HTTP ${response.status})`, {
      status: response.status,
    });
  }

  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length) {
    const message = body.errors.map((error) => error.message).join('; ');
    throw new TwitterApiError(`GraphQL errors: ${message}`, { data: body });
  }
  return body?.data ?? body;
}

/**
 * Fetch a public profile.
 * @param {string} username - Handle without the leading @.
 * @returns {Promise<object>} The XActions profile shape.
 */
export async function getProfile(username) {
  const data = await guestGraphQL('UserByScreenName', {
    screen_name: username,
    withSafetyModeUserFields: false,
  });
  const result = data?.user?.result;
  if (!result) throw new NotFoundError(`User @${username} not found`);
  return parseUserData(result);
}

/**
 * Fetch a user's recent posts.
 *
 * The timeline is addressed by numeric id, so an unknown handle costs one extra
 * round trip to resolve it. Pass `userId` when the caller already knows it.
 *
 * @param {string} username - Handle without the leading @.
 * @param {object} [options]
 * @param {number} [options.limit=20] - Maximum posts to return, capped at 100.
 * @param {string} [options.userId] - Skip the profile lookup.
 * @returns {Promise<{ user: object|null, tweets: object[], cursor: string|null }>}
 */
export async function getTweets(username, { limit = 20, userId } = {}) {
  const count = Math.max(1, Math.min(Number(limit) || 20, 100));
  let user = null;
  let id = userId;
  if (!id) {
    user = await getProfile(username);
    id = user.id;
  }

  const data = await guestGraphQL('UserTweets', {
    userId: String(id),
    count,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  });

  const instructions = userTimelineInstructions(data);
  const { tweets, cursor } = parseTimelineInstructions(instructions);
  return { user, tweets: tweets.slice(0, count), cursor };
}

/**
 * Normalise anything a caller might send as a handle: `@nasa`, `nasa`, or a
 * profile URL.
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeHandle(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(@?\w{1,15})/i);
  const candidate = (fromUrl ? fromUrl[1] : trimmed).replace(/^@/, '');
  return /^\w{1,15}$/.test(candidate) ? candidate : null;
}

/**
 * Map a scraper error onto the status the API should answer with.
 * @param {Error} error
 * @returns {number}
 */
export function statusForError(error) {
  switch (error?.name) {
    case 'NotFoundError':
      return 404;
    case 'AuthError':
      return 403;
    case 'RateLimitError':
      return 429;
    default:
      return 502;
  }
}
