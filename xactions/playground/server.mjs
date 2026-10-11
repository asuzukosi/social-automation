// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Playground - server
 *
 * A deliberately small service: no database, no accounts, no API keys, no
 * session cookies anywhere in the process. It answers guest-tier X queries
 * over HTTP and serves the playground page that drives them.
 *
 * Why it is separate from `api/server.js`: that service needs Postgres, Redis,
 * JWTs and Puppeteer, which is the right shape for the product and the wrong
 * shape for "let a stranger try the tool in two seconds". This one boots in
 * milliseconds, holds no secrets, and can be thrown away and redeployed
 * without touching anything stateful.
 *
 * It also never accepts a credential. There is no code path here that reads a
 * cookie, header or body field and hands it to the scraper, so a visitor
 * cannot be phished into pasting their X session into the demo.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://github.com/nirholas/XActions
 * @license Apache-2.0
 */

import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Scraper } from '../src/client/index.js';
import { buildAccountReport, compareReports } from '../src/analysis/accountReport.js';
import { normalizeUsername, normalizeUsernames, clampParam, QUERIES } from '../src/codegen/queryTranslator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

/** How long an answer stays fresh. X does not change fast enough to matter. */
const CACHE_TTL_MS = Number(process.env.PLAYGROUND_CACHE_TTL_MS) || 5 * 60_000;
/** Cache ceiling, so a crawler walking usernames cannot grow the heap. */
const CACHE_MAX_ENTRIES = Number(process.env.PLAYGROUND_CACHE_MAX) || 500;
/** Simultaneous upstream calls to X. Above this, requests queue. */
const MAX_UPSTREAM_CONCURRENCY = Number(process.env.PLAYGROUND_CONCURRENCY) || 4;
/** Upstream deadline, so a hung X request cannot hold a slot forever. */
const UPSTREAM_TIMEOUT_MS = Number(process.env.PLAYGROUND_TIMEOUT_MS) || 25_000;

// ============================================================================
// Shared scraper
// ============================================================================

/**
 * One scraper for the process, so the guest token is negotiated once and
 * reused rather than re-fetched per request. It is never given cookies.
 */
const scraper = new Scraper();

// ============================================================================
// Cache
// ============================================================================

/** @type {Map<string, {expires: number, value: unknown}>} */
const cache = new Map();

/**
 * Read a live cache entry, promoting it to most-recently-used.
 * @param {string} key
 * @returns {unknown|undefined}
 */
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Re-inserting moves the key to the end of Map iteration order, which is
  // what makes the eviction below least-recently-used rather than arbitrary.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

/**
 * Store a value, evicting the least recently used entry when full.
 * @param {string} key
 * @param {unknown} value
 */
function cacheSet(key, value) {
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

// ============================================================================
// Upstream concurrency
// ============================================================================

let active = 0;
/** @type {Array<() => void>} */
const waiting = [];

/**
 * Run a function with at most MAX_UPSTREAM_CONCURRENCY in flight.
 *
 * Without this, a single burst of playground traffic turns into a burst of
 * requests at X, which is the fastest way to get the shared guest token rate
 * limited for everybody.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withSlot(fn) {
  if (active >= MAX_UPSTREAM_CONCURRENCY) {
    await new Promise((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

/**
 * Reject a promise that outruns the upstream deadline.
 * @template T
 * @param {Promise<T>} promise
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${UPSTREAM_TIMEOUT_MS}ms`);
      error.code = 'UPSTREAM_TIMEOUT';
      reject(error);
    }, UPSTREAM_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// ============================================================================
// Data access
// ============================================================================

/**
 * Fetch a profile, cached.
 * @param {string} username
 * @returns {Promise<object>}
 */
async function fetchProfile(username) {
  const key = `profile:${username.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const profile = await withSlot(() => withTimeout(scraper.getProfile(username), `getProfile(${username})`));
  if (!profile?.id) {
    const error = new Error(`X returned no profile for @${username}`);
    error.code = 'NOT_FOUND';
    throw error;
  }
  cacheSet(key, profile);
  return profile;
}

/**
 * Fetch up to `limit` timeline posts, cached per (user, limit).
 * @param {string} username
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function fetchTimeline(username, limit) {
  const key = `timeline:${username.toLowerCase()}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const tweets = await withSlot(() =>
    withTimeout(
      (async () => {
        const collected = [];
        for await (const tweet of scraper.getTweets(username, limit)) {
          collected.push(tweet);
          if (collected.length >= limit) break;
        }
        return collected;
      })(),
      `getTweets(${username})`
    )
  );

  cacheSet(key, tweets);
  return tweets;
}

/**
 * Strip a tweet down to the fields the playground renders. Keeps the payload
 * small and keeps internal parser shapes out of a public contract.
 * @param {object} tweet
 * @returns {object}
 */
function publicTweet(tweet) {
  return {
    id: tweet.id,
    text: tweet.text || tweet.fullText || '',
    url: `https://x.com/${tweet.username}/status/${tweet.id}`,
    username: tweet.username,
    postedAt: tweet.timeParsed instanceof Date ? tweet.timeParsed.toISOString() : null,
    likes: tweet.likes || 0,
    retweets: tweet.retweets || 0,
    replies: tweet.replies || 0,
    views: tweet.views || 0,
    isRetweet: Boolean(tweet.isRetweet),
    isReply: Boolean(tweet.isReply),
    isQuote: Boolean(tweet.isQuote),
    hashtags: tweet.hashtags || [],
    mentions: tweet.mentions || [],
    photos: (tweet.photos || []).map((p) => ({ url: p.url, alt: p.alt || null })),
    videos: (tweet.videos || []).map((v) => ({ preview: v.preview })),
  };
}

/**
 * Strip a profile down to its public fields.
 * @param {object} profile
 * @returns {object}
 */
function publicProfile(profile) {
  return {
    id: profile.id,
    username: profile.username,
    name: profile.name,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    joined: profile.joined instanceof Date ? profile.joined.toISOString() : profile.joined || null,
    followers: profile.followersCount,
    following: profile.followingCount,
    posts: profile.tweetCount,
    likes: profile.likesCount,
    listed: profile.listedCount,
    media: profile.mediaCount,
    avatar: profile.avatar,
    banner: profile.banner,
    verified: Boolean(profile.verified || profile.isBlueVerified),
    protected: Boolean(profile.protected),
    url: `https://x.com/${profile.username}`,
  };
}

// ============================================================================
// App
// ============================================================================

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // Cloud Run terminates TLS and sets X-Forwarded-For.

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Avatars, banners and post media are served straight from X's CDN.
        imgSrc: ["'self'", 'data:', 'https://pbs.twimg.com', 'https://abs.twimg.com'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(cors({ origin: true, methods: ['GET'], credentials: false }));

/**
 * Per-IP budget. Generous enough that a curious person never sees it, tight
 * enough that a script cannot use the playground as a free X proxy.
 */
const apiLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: Number(process.env.PLAYGROUND_RATE_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limited',
    code: 'RATE_LIMITED',
    hint: 'The playground allows 60 queries per 5 minutes per address. Install the CLI for unlimited local use: npx xactions profile nasa',
  },
});

app.use('/api/playground', apiLimiter);

/**
 * Wrap an async route so a rejection reaches the error handler instead of
 * becoming an unhandled rejection and a hung request.
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} handler
 * @returns {import('express').RequestHandler}
 */
const route = (handler) => (req, res, next) => handler(req, res).catch(next);

app.get(
  '/api/playground/health',
  route(async (req, res) => {
    res.json({
      status: 'ok',
      service: 'xactions-playground',
      tier: 'guest',
      queries: Object.keys(QUERIES),
      cache: { entries: cache.size, ttlMs: CACHE_TTL_MS },
      upstream: { active, queued: waiting.length, max: MAX_UPSTREAM_CONCURRENCY },
      uptimeSeconds: Math.round(process.uptime()),
    });
  })
);

app.get(
  '/api/playground/profile/:username',
  route(async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!username) throw badRequest('Give a username, for example /api/playground/profile/nasa');

    const profile = await fetchProfile(username);
    res.json({ query: { kind: 'profile', username }, profile: publicProfile(profile) });
  })
);

app.get(
  '/api/playground/timeline/:username',
  route(async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!username) throw badRequest('Give a username, for example /api/playground/timeline/nasa');
    const limit = clampParam(req.query.limit, QUERIES.timeline.params[1]);

    const tweets = await fetchTimeline(username, limit);
    res.json({
      query: { kind: 'timeline', username, limit },
      count: tweets.length,
      tweets: tweets.map(publicTweet),
    });
  })
);

app.get(
  '/api/playground/report/:username',
  route(async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!username) throw badRequest('Give a username, for example /api/playground/report/nasa');
    const limit = clampParam(req.query.limit, QUERIES.report.params[1]);

    const [profile, tweets] = await Promise.all([fetchProfile(username), fetchTimeline(username, limit)]);
    res.json({
      query: { kind: 'report', username, limit },
      report: buildAccountReport({ profile, tweets }),
    });
  })
);

app.get(
  '/api/playground/compare',
  route(async (req, res) => {
    const users = normalizeUsernames(req.query.users);
    if (users.length < 2) throw badRequest('Give at least two usernames, for example ?users=nasa,spacex');
    if (users.length > 4) throw badRequest('Compare at most four accounts at once');
    const limit = clampParam(req.query.limit, QUERIES.compare.params[1]);

    // Sequential on purpose. These are four upstream round trips against a
    // shared guest token, and the concurrency gate would serialise them
    // anyway; doing it here keeps the failure attributable to one account.
    const reports = [];
    for (const username of users) {
      const [profile, tweets] = await Promise.all([fetchProfile(username), fetchTimeline(username, limit)]);
      reports.push(buildAccountReport({ profile, tweets }));
    }

    res.json({
      query: { kind: 'compare', users, limit },
      comparison: compareReports(reports),
      reports,
    });
  })
);

// Static playground UI. `index.html` answers both / and /playground so the
// page has a real URL whether it is served here or from the static site.
app.use(
  express.static(PUBLIC_DIR, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get(['/', '/playground'], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND',
    hint: `Known routes: ${['/', '/playground', '/api/playground/health', ...Object.keys(QUERIES).map((k) => `/api/playground/${k}`)].join(', ')}`,
  });
});

/**
 * Build a 400 with a code the client can branch on.
 * @param {string} message
 * @returns {Error}
 */
function badRequest(message) {
  const error = new Error(message);
  error.code = 'BAD_REQUEST';
  return error;
}

/**
 * Map an internal failure onto an HTTP status and a message a visitor can act
 * on. The X-specific codes matter here: a bare 404 from X means "log in",
 * not "no such account", and saying so is the difference between a useful
 * demo and a confusing one.
 */
app.use((error, req, res, _next) => {
  const code = error.code || 'INTERNAL';
  const status =
    {
      BAD_REQUEST: 400,
      INVALID_INPUT: 400,
      NOT_FOUND: 404,
      AUTH_REQUIRED: 501,
      RATE_LIMITED: 429,
      UPSTREAM_TIMEOUT: 504,
    }[code] || 502;

  if (status >= 500) {
    console.error(`[playground] ${req.method} ${req.originalUrl} -> ${code}: ${error.message}`);
  }

  const hints = {
    INVALID_INPUT: 'X usernames are 1 to 15 characters of letters, numbers and underscores.',
    NOT_FOUND: 'Check the spelling. Suspended, renamed and deleted accounts all return nothing.',
    AUTH_REQUIRED:
      'X serves this endpoint to logged-in sessions only, so the playground cannot run it. Install the CLI and run `xactions connect` to use your own session.',
    RATE_LIMITED: 'X is throttling the shared guest token. Try again shortly, or run it locally with the CLI.',
    UPSTREAM_TIMEOUT: 'X did not answer in time. This is usually transient.',
  };

  res.status(status).json({
    error: error.message,
    code,
    hint: hints[code] || 'This is a public demo of the guest tier. Run it locally for the full surface.',
  });
});

// Started directly rather than imported by a test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`XActions playground listening on :${PORT}`);
    console.log(`  UI      http://localhost:${PORT}/playground`);
    console.log(`  Health  http://localhost:${PORT}/api/playground/health`);
  });
}
