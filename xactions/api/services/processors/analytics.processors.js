// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Analytics processors: account analytics, snapshot history and growth rate,
 * creator monetisation, the social graph, the CRM, leads, ads and X Pro.
 *
 * Reads go through the logged-in HTTP client (src/scrapers/twitter/http).
 * Surfaces that exist only in X's web apps (the monetisation settings page,
 * ads.x.com, Media Studio, X Pro) are read in a browser page logged in as the
 * session: the JSON the web app itself loads and the tables it renders are
 * reported as X served them, never reshaped into numbers X did not show.
 *
 * Everything a job keeps (snapshots, graphs, CRM contacts, tags, segments,
 * leads, lead monitors) lives in the analytics SQLite database that
 * src/analytics already uses, in tables keyed by ctx.ownerKey, so one caller
 * never sees another's data.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { JobInputError } from './context.js';

const DAY_MS = 86_400_000;

/** X answered, but not with anything usable. Retrying gets the same answer. */
class XRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XRefusedError';
    this.retryable = false;
  }
}

// ── Input ──────────────────────────────────────────────────────────────────

function cleanUsername(value, label = 'username') {
  if (typeof value !== 'string' || !value.trim()) throw new JobInputError(`${label} is required`);
  const name = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(name)) throw new JobInputError(`${label} "${value}" is not a valid X username`);
  return name;
}

/** An array, or a comma-separated string, as a list of distinct trimmed strings. */
function listOf(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(items.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
}

function intIn(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

function numberOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new JobInputError(`${label} must be a number`);
  return n;
}

function boolOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return value === true || value === 'true' || value === 1 || value === '1';
}

const PERIOD_UNITS = { h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS, m: 30 * DAY_MS };

/** '7d', '24h', '4w', '3m' as milliseconds. */
function parsePeriod(value, fallback = '28d') {
  const raw = String(value ?? fallback).trim().toLowerCase();
  const match = raw.match(/^(\d{1,3})\s*([hdwm])$/);
  if (!match) {
    throw new JobInputError(`period "${value}" is not valid: use a number and a unit, such as 24h, 7d, 4w or 3m`);
  }
  const ms = Number(match[1]) * PERIOD_UNITS[match[2]];
  if (ms <= 0 || ms > 365 * DAY_MS) throw new JobInputError('period must be between 1h and 365d');
  return { label: `${match[1]}${match[2]}`, ms };
}

/** The pause between X requests: the route's delayMs, or the default, with jitter. */
function delayOf(ctx, fallback) {
  return intIn(ctx.config.delayMs, fallback, 0, 60_000);
}

async function pause(ctx, ms) {
  if (ms > 0) await ctx.sleep(ms + Math.floor(Math.random() * ms * 0.5));
  else ctx.throwIfCancelled();
}

const round2 = (n) => Math.round(n * 100) / 100;
const percent = (num, den) => (den > 0 ? round2((num / den) * 100) : null);

// ── X over HTTP ────────────────────────────────────────────────────────────

const x = {
  profile: () => import('../../../src/scrapers/twitter/http/profile.js'),
  tweets: () => import('../../../src/scrapers/twitter/http/tweets.js'),
  relationships: () => import('../../../src/scrapers/twitter/http/relationships.js'),
  search: () => import('../../../src/scrapers/twitter/http/search.js'),
  endpoints: () => import('../../../src/scrapers/twitter/http/endpoints.js'),
  errors: () => import('../../../src/scrapers/twitter/http/errors.js'),
};

/** The public fields of a parsed profile. */
function profileSummary(p) {
  return {
    id: p.id ?? null,
    username: p.username,
    name: p.name ?? null,
    bio: p.bio ?? null,
    followers: p.followers ?? p.followersCount ?? 0,
    following: p.following ?? p.followingCount ?? 0,
    tweets: p.tweets ?? null,
    verified: Boolean(p.verified),
    protected: Boolean(p.protected),
    location: p.location || null,
    website: p.website || null,
    joined: p.joined ?? null,
    avatar: p.avatar ?? null,
  };
}

const viewers = new WeakMap();

/** The account the job's session is logged in as (memoised per job). */
function viewerOf(ctx) {
  if (!viewers.has(ctx)) viewers.set(ctx, loadViewer(ctx));
  return viewers.get(ctx);
}

async function loadViewer(ctx) {
  const client = await ctx.http();
  const { scrapeProfileById, parseUserData } = await x.profile();
  const twid = (await ctx.cookieHeader()).match(/(?:^|;\s*)twid=([^;]+)/);
  const id = twid ? decodeURIComponent(twid[1]).replace(/^u=/, '') : '';
  if (/^\d+$/.test(id)) return scrapeProfileById(client, id);

  const { resolveGraphQL, operationFeatures } = await x.endpoints();
  const { queryId, operationName } = resolveGraphQL('Viewer');
  const response = await client.graphql(
    queryId,
    operationName,
    { withCommunitiesMemberships: true },
    { features: operationFeatures(operationName) },
  );
  const raw = response?.data?.viewer?.user_results?.result;
  if (!raw) {
    throw new JobInputError('X did not say which account this session belongs to. The session may be logged out: save a fresh one.');
  }
  return parseUserData(raw);
}

async function readProfile(ctx, username) {
  const { scrapeProfile } = await x.profile();
  return scrapeProfile(await ctx.http(), username);
}

/** Whether an X error means "this one account is unavailable", not "stop". */
async function isUnavailable(err) {
  const { NotFoundError } = await x.errors();
  return err instanceof NotFoundError;
}

/** A missing or suspended account is the caller's input, not a reason to retry. */
async function asInputError(err, username) {
  if (await isUnavailable(err)) return new JobInputError(`@${username} was not found on X: ${err.message}`);
  return err;
}

/** The profile of the account a job is about. */
async function readTarget(ctx, username) {
  try {
    return await readProfile(ctx, username);
  } catch (err) {
    throw await asInputError(err, username);
  }
}

/** The first `instructions` array anywhere in a GraphQL payload. */
function findInstructions(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node.instructions)) return node.instructions;
  for (const value of Object.values(node)) {
    const found = findInstructions(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Users and the bottom cursor from a user-timeline's instructions. */
function usersFromInstructions(instructions, parseUserData) {
  const users = [];
  let cursor = null;
  const take = (raw) => {
    if (!raw || raw.__typename === 'UserUnavailable') return;
    const user = parseUserData(raw);
    if (user.username) users.push(user);
  };
  for (const instruction of instructions) {
    for (const entry of instruction.entries || []) {
      const id = entry.entryId || '';
      if (id.startsWith('cursor-bottom-')) cursor = entry.content?.value ?? entry.content?.itemContent?.value ?? null;
      take(entry.content?.itemContent?.user_results?.result);
      for (const item of entry.content?.items || []) take(item?.item?.itemContent?.user_results?.result);
    }
    for (const item of instruction.moduleItems || []) take(item?.item?.itemContent?.user_results?.result);
  }
  return { users, cursor };
}

/**
 * Page through a GraphQL user timeline keyed by the session's own user id
 * (UserCreatorSubscribers, UserCreatorSubscriptions).
 */
async function viewerUserTimeline(ctx, operationName, label, limit) {
  const viewer = await viewerOf(ctx);
  const client = await ctx.http();
  const { resolveGraphQL, operationFeatures } = await x.endpoints();
  const { parseUserData } = await x.profile();
  const { queryId } = resolveGraphQL(operationName);

  const users = new Map();
  let cursor = null;
  let answered = false;
  while (users.size < limit) {
    ctx.throwIfCancelled();
    const variables = { userId: viewer.id, count: 20, includePromotedContent: false };
    if (cursor) variables.cursor = cursor;
    const response = await client.graphql(queryId, operationName, variables, { features: operationFeatures(operationName) });
    const instructions = findInstructions(response?.data);
    if (!instructions) break;
    answered = true;
    const page = usersFromInstructions(instructions, parseUserData);
    for (const user of page.users) {
      if (users.size >= limit) break;
      users.set(user.username.toLowerCase(), user);
    }
    ctx.progress(`Read ${users.size} ${label}`);
    if (!page.cursor || page.users.length === 0 || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  if (!answered) {
    throw new XRefusedError(
      `X returned no ${label} list for @${viewer.username}. Creator Subscriptions may not be available on this account.`,
    );
  }
  return {
    account: profileSummary(viewer),
    count: users.size,
    [label]: [...users.values()].map(profileSummary),
  };
}

// ── Account analytics ──────────────────────────────────────────────────────

const engagementOf = (m) => (m.likes || 0) + (m.retweets || 0) + (m.replies || 0) + (m.quotes || 0) + (m.bookmarks || 0);

/**
 * Performance of an account's own posts inside a time window.
 *
 * @param {object[]} tweets - parsed tweets, newest first
 * @param {object} profile
 * @param {number} since - window start (ms)
 * @param {boolean} timelineEnded - fewer posts came back than were asked for
 */
export function summarisePosts(tweets, profile, since, timelineEnded) {
  const own = tweets.filter((t) => !t.isRetweet && t.id && t.createdAt);
  const inWindow = own.filter((t) => Date.parse(t.createdAt) >= since);
  const oldest = own.reduce((min, t) => Math.min(min, Date.parse(t.createdAt)), Infinity);

  const totals = { impressions: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0, engagements: 0 };
  const types = { original: [], reply: [], quote: [], media: [] };
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, posts: 0, engagements: 0 }));

  for (const t of inWindow) {
    const m = t.metrics || {};
    const engagement = engagementOf(m);
    totals.impressions += m.views || 0;
    totals.likes += m.likes || 0;
    totals.retweets += m.retweets || 0;
    totals.replies += m.replies || 0;
    totals.quotes += m.quotes || 0;
    totals.bookmarks += m.bookmarks || 0;
    totals.engagements += engagement;
    types[t.isReply ? 'reply' : t.quotedTweet ? 'quote' : 'original'].push(engagement);
    if (t.media?.length) types.media.push(engagement);
    const bucket = hours[new Date(t.createdAt).getUTCHours()];
    bucket.posts++;
    bucket.engagements += engagement;
  }

  const n = inWindow.length;
  const windowDays = Math.max((Date.now() - since) / DAY_MS, 1 / 24);
  const avg = (list) => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : 0);

  return {
    windowStart: new Date(since).toISOString(),
    postsInWindow: n,
    coverage: {
      postsRead: own.length,
      windowFullyRead: timelineEnded || oldest <= since,
    },
    totals,
    averages: {
      impressionsPerPost: n ? Math.round(totals.impressions / n) : 0,
      engagementsPerPost: n ? Math.round(totals.engagements / n) : 0,
    },
    engagementRate: {
      byImpressions: percent(totals.engagements, totals.impressions),
      byFollowers: n ? percent(totals.engagements / n, profile.followers || 0) : null,
    },
    postsPerDay: round2(n / windowDays),
    byType: Object.fromEntries(
      Object.entries(types).map(([type, list]) => [type, { posts: list.length, avgEngagements: avg(list) }]),
    ),
    bestHoursUtc: hours
      .filter((h) => h.posts > 0)
      .map((h) => ({ hour: h.hour, posts: h.posts, avgEngagements: Math.round(h.engagements / h.posts) }))
      .sort((a, b) => b.avgEngagements - a.avgEngagements)
      .slice(0, 3),
    topPosts: [...inWindow]
      .sort((a, b) => engagementOf(b.metrics || {}) - engagementOf(a.metrics || {}))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        url: `https://x.com/${profile.username}/status/${t.id}`,
        text: t.text.slice(0, 280),
        createdAt: t.createdAt,
        metrics: t.metrics,
        engagements: engagementOf(t.metrics || {}),
      })),
  };
}

async function accountAnalytics(ctx, username, periodValue) {
  const window = parsePeriod(periodValue);
  const limit = intIn(ctx.config.limit, 200, 20, 400);
  const client = await ctx.http();
  const { scrapeTweets } = await x.tweets();

  ctx.progress(`Reading @${username}`);
  const profile = await readTarget(ctx, username);
  const tweets = await scrapeTweets(client, username, {
    limit,
    onProgress: ({ fetched }) => ctx.progress(`Read ${fetched} posts from @${username}`),
  });
  const since = Date.now() - window.ms;
  const analytics = summarisePosts(tweets, profile, since, tweets.length < limit);

  return {
    username: profile.username || username,
    period: window.label,
    profile: profileSummary(profile),
    analytics,
    monetizationSignals: {
      premium: Boolean(profile.verified),
      followers: profile.followers || 0,
      impressionsInWindow: analytics.totals.impressions,
      windowDays: round2(window.ms / DAY_MS),
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function targetUsername(ctx) {
  if (ctx.config.username) return cleanUsername(ctx.config.username);
  return (await viewerOf(ctx)).username.toLowerCase();
}

// ── Owner-keyed storage ────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS api_account_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_key TEXT NOT NULL,
    username TEXT NOT NULL,
    followers INTEGER NOT NULL,
    following INTEGER NOT NULL,
    tweets INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    taken_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_api_snapshots_owner ON api_account_snapshots(owner_key, username, taken_at);

  CREATE TABLE IF NOT EXISTS api_graphs (
    owner_key TEXT NOT NULL,
    graph_id TEXT NOT NULL,
    seed TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, graph_id)
  );

  CREATE TABLE IF NOT EXISTS api_crm_contacts (
    owner_key TEXT NOT NULL,
    username TEXT NOT NULL,
    user_id TEXT,
    name TEXT,
    bio TEXT,
    followers INTEGER DEFAULT 0,
    following INTEGER DEFAULT 0,
    tweets INTEGER,
    verified INTEGER DEFAULT 0,
    protected INTEGER DEFAULT 0,
    location TEXT,
    website TEXT,
    avatar TEXT,
    is_follower INTEGER,
    is_following INTEGER,
    source_account TEXT,
    score INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, username)
  );

  CREATE TABLE IF NOT EXISTS api_crm_tags (
    owner_key TEXT NOT NULL,
    username TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, username, tag)
  );

  CREATE TABLE IF NOT EXISTS api_crm_segments (
    owner_key TEXT NOT NULL,
    name TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, name)
  );

  CREATE TABLE IF NOT EXISTS api_leads (
    owner_key TEXT NOT NULL,
    username TEXT NOT NULL,
    user_id TEXT,
    name TEXT,
    bio TEXT,
    followers INTEGER,
    following INTEGER,
    tweets INTEGER,
    verified INTEGER DEFAULT 0,
    location TEXT,
    website TEXT,
    avatar TEXT,
    profiled INTEGER DEFAULT 0,
    signals_json TEXT NOT NULL DEFAULT '{"matches":[],"keywords":[]}',
    qualified INTEGER,
    qualification_json TEXT,
    enrichment_json TEXT,
    score INTEGER DEFAULT 0,
    score_json TEXT,
    source TEXT,
    first_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, username)
  );

  CREATE TABLE IF NOT EXISTS api_lead_monitors (
    owner_key TEXT NOT NULL,
    monitor_key TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    last_seen_id TEXT,
    runs INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_run_at TEXT,
    PRIMARY KEY (owner_key, monitor_key)
  );
`;

let storePromise = null;

/** The analytics database (src/analytics/historyStore.js) with this file's tables. */
function store() {
  if (!storePromise) {
    storePromise = (async () => {
      const { getDatabase } = await import('../../../src/analytics/historyStore.js');
      const db = getDatabase();
      db.exec(SCHEMA);
      return db;
    })().catch((err) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

function ownerOf(ctx) {
  if (!ctx.ownerKey) {
    throw new JobInputError('This job carries no session or signed-in user, so there is no owner to keep its data for.');
  }
  return ctx.ownerKey;
}

const nowIso = () => new Date().toISOString();

// ── Snapshots ──────────────────────────────────────────────────────────────

function saveSnapshot(db, owner, snapshot) {
  const row = {
    owner,
    username: snapshot.username,
    followers: snapshot.followers,
    following: snapshot.following,
    tweets: snapshot.tweets,
    verified: snapshot.verified ? 1 : 0,
    takenAt: snapshot.takenAt || nowIso(),
  };
  db.prepare(
    `INSERT INTO api_account_snapshots (owner_key, username, followers, following, tweets, verified, taken_at)
     VALUES (@owner, @username, @followers, @following, @tweets, @verified, @takenAt)`,
  ).run(row);
  return snapshotOut({ ...row, taken_at: row.takenAt });
}

function snapshotOut(row) {
  return {
    username: row.username,
    followers: row.followers,
    following: row.following,
    tweets: row.tweets,
    verified: Boolean(row.verified),
    takenAt: row.taken_at,
  };
}

function snapshotFromProfile(profile, username) {
  return {
    username,
    followers: profile.followers || 0,
    following: profile.following || 0,
    tweets: profile.tweets || 0,
    verified: Boolean(profile.verified),
  };
}

function countField(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new JobInputError(`${label} must be a whole number of at least 0`);
  return n;
}

// ── Graph ──────────────────────────────────────────────────────────────────

/**
 * The scraper interface src/graph/builder.js crawls with, answered over HTTP.
 * Every failure is recorded so a build can report which accounts it missed.
 */
function httpGraphScrapers(client, errors, http) {
  const note = (label) => (err) => {
    errors.push({ account: label, error: err.message, cause: err });
    throw err;
  };
  const toNode = (u) => ({
    username: u.username,
    name: u.name,
    bio: u.bio,
    followers: u.followersCount ?? 0,
    following: u.followingCount ?? 0,
    verified: Boolean(u.verified),
  });
  const handle = { close: async () => {} };
  return {
    createBrowser: async () => handle,
    createPage: async () => handle,
    loginWithCookie: async () => {},
    scrapeProfile: (page, username) =>
      http.scrapeProfile(client, username)
        .then((p) => ({ ...p, profileImage: p.avatar, joinDate: p.joined }))
        .catch(note(username)),
    scrapeFollowers: (page, username, { limit }) =>
      http.scrapeFollowers(client, username, { limit }).then((users) => users.map(toNode)).catch(note(username)),
    scrapeFollowing: (page, username, { limit }) =>
      http.scrapeFollowing(client, username, { limit }).then((users) => users.map(toNode)).catch(note(username)),
  };
}

const slimNode = (node) =>
  node && {
    username: node.username,
    name: node.name,
    followers: node.followers,
    following: node.following,
    verified: Boolean(node.verified),
    depth: node.depth,
  };

async function loadGraph(ctx, graphId) {
  const db = await store();
  const row = db.prepare('SELECT data_json FROM api_graphs WHERE owner_key = ? AND graph_id = ?').get(ownerOf(ctx), graphId);
  if (!row) return null;
  const { deserializeGraph } = await import('../../../src/graph/builder.js');
  return deserializeGraph(JSON.parse(row.data_json));
}

const GRAPH_METRICS = ['communities', 'influencers', 'bridges', 'mutuals', 'ghosts', 'orbits'];

async function graphMetric(metric, graph) {
  const analyzer = await import('../../../src/graph/analyzer.js');
  const seed = graph.seed.toLowerCase().replace(/^@/, '');
  switch (metric) {
    case 'communities':
      return analyzer.detectClusters(graph).map((c) => ({ ...c, members: c.members.slice(0, 200) }));
    case 'influencers':
      return analyzer.getInfluenceRanking(graph, 25).map((r) => ({ username: r.username, influenceScore: r.influenceScore, node: slimNode(r.node) }));
    case 'bridges':
      return analyzer.findBridgeAccounts(graph, 15).map((b) => ({ username: b.username, betweenness: b.betweenness, node: slimNode(b.node) }));
    case 'mutuals': {
      const all = analyzer.findMutualConnections(graph);
      return { total: all.length, ofSeed: analyzer.getMutualConnectionsFor(graph, seed), pairs: all.slice(0, 500) };
    }
    case 'ghosts':
      return analyzer.findGhostFollowers(graph, seed).map((g) => ({ username: g.username, edgesInGraph: g.edgesInGraph, node: slimNode(g.node) }));
    case 'orbits':
      return analyzer.analyzeOrbits(graph, seed);
  }
  throw new JobInputError(`metric "${metric}" is not supported: use ${GRAPH_METRICS.join(', ')}`);
}

// ── CRM ────────────────────────────────────────────────────────────────────

/** A 0 to 100 relationship score, the heuristics of src/analytics/followerCRM.js. */
export function contactScore(c) {
  let score = Math.min(20, Math.log10(Math.max(1, c.followers || 0)) * 5);
  score += c.tweets == null ? 0 : Math.min(20, Math.log10(Math.max(1, c.tweets)) * 5);
  if (c.is_follower && c.is_following) score += 15;
  else if (c.is_follower) score += 10;
  if (c.bio && c.bio.length > 20) score += 10;
  else if (c.bio) score += 5;
  if (c.verified) score += 10;
  if (c.location) score += 5;
  if (c.website) score += 5;
  const ratio = (c.following || 0) > 0 ? (c.followers || 0) / c.following : 1;
  score += Math.min(15, ratio * 3);
  return Math.round(Math.min(100, score));
}

function upsertContact(db, owner, user, { sourceAccount = null, isFollower = null, isFollowing = null } = {}) {
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM api_crm_contacts WHERE owner_key = ? AND username = ?').get(owner, user.username);
  const merged = {
    owner,
    username: user.username,
    user_id: user.id ?? existing?.user_id ?? null,
    name: user.name ?? existing?.name ?? null,
    bio: user.bio ?? existing?.bio ?? null,
    followers: user.followers ?? user.followersCount ?? existing?.followers ?? 0,
    following: user.following ?? user.followingCount ?? existing?.following ?? 0,
    tweets: user.tweets ?? existing?.tweets ?? null,
    verified: user.verified ? 1 : 0,
    protected: user.protected ? 1 : 0,
    location: user.location || existing?.location || null,
    website: user.website || existing?.website || null,
    avatar: user.avatar || existing?.avatar || null,
    is_follower: isFollower ?? existing?.is_follower ?? null,
    is_following: isFollowing ?? existing?.is_following ?? null,
    source_account: sourceAccount ?? existing?.source_account ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  merged.score = contactScore(merged);
  db.prepare(
    `INSERT INTO api_crm_contacts (owner_key, username, user_id, name, bio, followers, following, tweets, verified, protected,
       location, website, avatar, is_follower, is_following, source_account, score, created_at, updated_at)
     VALUES (@owner, @username, @user_id, @name, @bio, @followers, @following, @tweets, @verified, @protected,
       @location, @website, @avatar, @is_follower, @is_following, @source_account, @score, @created_at, @updated_at)
     ON CONFLICT(owner_key, username) DO UPDATE SET
       user_id = excluded.user_id, name = excluded.name, bio = excluded.bio, followers = excluded.followers,
       following = excluded.following, tweets = excluded.tweets, verified = excluded.verified,
       protected = excluded.protected, location = excluded.location, website = excluded.website,
       avatar = excluded.avatar, is_follower = excluded.is_follower, is_following = excluded.is_following,
       source_account = excluded.source_account, score = excluded.score, updated_at = excluded.updated_at`,
  ).run(merged);
  return { created: !existing };
}

const TAG_SEPARATOR = '\u001f';

function contactOut(row) {
  const flag = (v) => (v === null || v === undefined ? null : Boolean(v));
  return {
    username: row.username,
    userId: row.user_id,
    name: row.name,
    bio: row.bio,
    followers: row.followers,
    following: row.following,
    tweets: row.tweets,
    verified: Boolean(row.verified),
    protected: Boolean(row.protected),
    location: row.location,
    website: row.website,
    avatar: row.avatar,
    isFollower: flag(row.is_follower),
    isFollowing: flag(row.is_following),
    syncedFrom: row.source_account,
    score: row.score,
    tags: row.tags ? row.tags.split(TAG_SEPARATOR).sort() : [],
    addedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CONTACT_FILTERS = ['query', 'tags', 'minFollowers', 'maxFollowers', 'verified', 'isFollower', 'isFollowing', 'minScore', 'bioContains', 'location', 'sortBy'];
const CONTACT_SORTS = { score: 'c.score DESC', followers: 'c.followers DESC', username: 'c.username ASC', updated: 'c.updated_at DESC' };

const likeOf = (text) => `%${String(text).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

function normaliseTag(tag) {
  const clean = String(tag).trim().toLowerCase();
  if (!clean || clean.length > 50) throw new JobInputError(`tag "${tag}" must be 1 to 50 characters`);
  return clean;
}

/** The owner's contacts matching a filter object (a search or a segment). */
function filterContacts(db, owner, filters, limit) {
  const where = ['c.owner_key = @owner'];
  const params = { owner, limit };
  if (filters.query) {
    where.push("(c.username LIKE @query ESCAPE '\\' OR c.name LIKE @query ESCAPE '\\' OR c.bio LIKE @query ESCAPE '\\')");
    params.query = likeOf(filters.query);
  }
  const tags = listOf(filters.tags).map(normaliseTag);
  if (tags.length) {
    const names = tags.map((tag, i) => {
      params[`tag${i}`] = tag;
      return `@tag${i}`;
    });
    where.push(`c.username IN (SELECT t.username FROM api_crm_tags t WHERE t.owner_key = @owner AND t.tag IN (${names.join(', ')}))`);
  }
  const numeric = { minFollowers: 'c.followers >= ', maxFollowers: 'c.followers <= ', minScore: 'c.score >= ' };
  for (const [key, clause] of Object.entries(numeric)) {
    const value = numberOrNull(filters[key], key);
    if (value !== null) {
      where.push(`${clause}@${key}`);
      params[key] = value;
    }
  }
  const flags = { verified: 'c.verified', isFollower: 'c.is_follower', isFollowing: 'c.is_following' };
  for (const [key, column] of Object.entries(flags)) {
    const value = boolOrNull(filters[key]);
    if (value !== null) {
      where.push(`${column} = @${key}`);
      params[key] = value ? 1 : 0;
    }
  }
  if (filters.bioContains) {
    where.push("c.bio LIKE @bioContains ESCAPE '\\'");
    params.bioContains = likeOf(filters.bioContains);
  }
  if (filters.location) {
    where.push("c.location LIKE @location ESCAPE '\\'");
    params.location = likeOf(filters.location);
  }
  const sort = CONTACT_SORTS[filters.sortBy] || CONTACT_SORTS.score;
  const clause = where.join(' AND ');
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT GROUP_CONCAT(t.tag, char(31)) FROM api_crm_tags t WHERE t.owner_key = c.owner_key AND t.username = c.username) AS tags
       FROM api_crm_contacts c WHERE ${clause} ORDER BY ${sort} LIMIT @limit`,
    )
    .all(params);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM api_crm_contacts c WHERE ${clause}`).get(params);
  return { total, contacts: rows.map(contactOut) };
}

function contactCount(db, owner) {
  return db.prepare('SELECT COUNT(*) AS n FROM api_crm_contacts WHERE owner_key = ?').get(owner).n;
}

function requireContacts(db, owner) {
  const n = contactCount(db, owner);
  if (n === 0) throw new JobInputError('Your CRM has no contacts yet. Fill it with POST /api/ai/crm/sync first.');
  return n;
}

// ── Leads ──────────────────────────────────────────────────────────────────

/** Phrases that mark a post as someone asking for a solution. */
const INTENT = /\b(looking for|recommend(?:ation)?s?\b|any (?:suggestions|recs|tips)|need (?:a|an|some|help)\b|alternatives? to|who (?:can|should|do you)|what(?:'s| is) the best|switching (?:from|to)|frustrated with|anyone (?:know|use|tried|using)|how do (?:i|you))/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** 0 to 100: reach, activity, credibility, audience ratio and buying intent. */
export function scoreLead(lead) {
  const matches = lead.signals?.matches || [];
  const intentHits = matches.filter((m) => m.intent).length;
  const profiled = Boolean(lead.profiled);
  const followers = lead.followers || 0;
  const credibility =
    (lead.verified ? 8 : 0) + (lead.website ? 7 : 0) + (lead.bio && lead.bio.length > 20 ? 5 : 0) + (lead.location ? 3 : 0);
  const breakdown = {
    reach: profiled ? Math.min(25, Math.log10(followers + 1) * 5) : 0,
    activity: profiled ? Math.min(15, Math.log10((lead.tweets || 0) + 1) * 3) : 0,
    credibility: Math.min(20, credibility),
    audienceRatio: profiled && followers > 0 ? Math.min(10, (followers / Math.max(lead.following || 0, 1)) * 2) : 0,
    intent: Math.min(30, intentHits * 10 + (matches.length - intentHits) * 3),
  };
  for (const key of Object.keys(breakdown)) breakdown[key] = Math.round(breakdown[key]);
  return { score: Math.min(100, Object.values(breakdown).reduce((s, v) => s + v, 0)), breakdown };
}

function leadRow(db, owner, username) {
  return db.prepare('SELECT * FROM api_leads WHERE owner_key = ? AND username = ?').get(owner, username);
}

function leadFromRow(row) {
  return {
    username: row.username,
    userId: row.user_id,
    name: row.name,
    bio: row.bio,
    followers: row.followers,
    following: row.following,
    tweets: row.tweets,
    verified: Boolean(row.verified),
    location: row.location,
    website: row.website,
    avatar: row.avatar,
    profiled: Boolean(row.profiled),
    signals: JSON.parse(row.signals_json),
    qualified: row.qualified === null ? null : Boolean(row.qualified),
    qualification: row.qualification_json ? JSON.parse(row.qualification_json) : null,
    enrichment: row.enrichment_json ? JSON.parse(row.enrichment_json) : null,
    score: row.score,
    scoreBreakdown: row.score_json ? JSON.parse(row.score_json) : null,
    source: row.source,
    firstSeen: row.first_seen,
    updatedAt: row.updated_at,
  };
}

/**
 * Create or update a lead, merging new signal matches with stored ones, and
 * rescore it. `profile` is a parsed profile, or a post author (profiled false).
 */
function saveLead(db, owner, { profile, profiled, matches = [], keywords = [], source, qualification, enrichment }) {
  const username = profile.username.toLowerCase();
  const existing = leadRow(db, owner, username);
  const prior = existing ? leadFromRow(existing) : null;
  const seen = new Set();
  const mergedMatches = [...matches, ...(prior?.signals.matches || [])]
    .filter((m) => (seen.has(m.tweetId) ? false : seen.add(m.tweetId)))
    .slice(0, 20);
  const take = (value, fallback) => (profiled ? value : fallback ?? value);
  const lead = {
    username,
    userId: profile.id ?? prior?.userId ?? null,
    name: profile.name || prior?.name || null,
    bio: take(profile.bio ?? null, prior?.bio),
    followers: take(profile.followers ?? null, prior?.followers),
    following: take(profile.following ?? null, prior?.following),
    tweets: take(profile.tweets ?? null, prior?.tweets),
    verified: Boolean(profile.verified || (!profiled && prior?.verified)),
    location: take(profile.location || null, prior?.location),
    website: take(profile.website || null, prior?.website),
    avatar: profile.avatar || prior?.avatar || null,
    profiled: profiled || Boolean(prior?.profiled),
    signals: { matches: mergedMatches, keywords: [...new Set([...keywords, ...(prior?.signals.keywords || [])])] },
    qualified: qualification ? qualification.qualified : prior?.qualified ?? null,
    qualification: qualification ?? prior?.qualification ?? null,
    enrichment: enrichment ?? prior?.enrichment ?? null,
    source: prior?.source ?? source,
    firstSeen: prior?.firstSeen ?? nowIso(),
  };
  const { score, breakdown } = scoreLead(lead);
  const now = nowIso();
  db.prepare(
    `INSERT INTO api_leads (owner_key, username, user_id, name, bio, followers, following, tweets, verified, location, website,
       avatar, profiled, signals_json, qualified, qualification_json, enrichment_json, score, score_json, source, first_seen, updated_at)
     VALUES (@owner, @username, @userId, @name, @bio, @followers, @following, @tweets, @verified, @location, @website,
       @avatar, @profiled, @signals, @qualified, @qualification, @enrichment, @score, @scoreJson, @source, @firstSeen, @now)
     ON CONFLICT(owner_key, username) DO UPDATE SET
       user_id = excluded.user_id, name = excluded.name, bio = excluded.bio, followers = excluded.followers,
       following = excluded.following, tweets = excluded.tweets, verified = excluded.verified, location = excluded.location,
       website = excluded.website, avatar = excluded.avatar, profiled = excluded.profiled, signals_json = excluded.signals_json,
       qualified = excluded.qualified, qualification_json = excluded.qualification_json,
       enrichment_json = excluded.enrichment_json, score = excluded.score, score_json = excluded.score_json,
       updated_at = excluded.updated_at`,
  ).run({
    owner,
    ...lead,
    verified: lead.verified ? 1 : 0,
    profiled: lead.profiled ? 1 : 0,
    signals: JSON.stringify(lead.signals),
    qualified: lead.qualified === null ? null : lead.qualified ? 1 : 0,
    qualification: lead.qualification ? JSON.stringify(lead.qualification) : null,
    enrichment: lead.enrichment ? JSON.stringify(lead.enrichment) : null,
    score,
    scoreJson: JSON.stringify(breakdown),
    now,
  });
  return leadFromRow(leadRow(db, owner, username));
}

function matchOf(tweet, keyword) {
  return {
    tweetId: tweet.id,
    url: `https://x.com/${tweet.author.username}/status/${tweet.id}`,
    text: tweet.text.slice(0, 280),
    keyword,
    intent: INTENT.test(tweet.text),
    createdAt: tweet.createdAt,
    engagements: engagementOf(tweet.metrics || {}),
  };
}

/** A search query that matches any of the keywords. */
function anyOf(keywords) {
  return keywords.map((k) => (/\s/.test(k) ? `"${k.replace(/"/g, '')}"` : k)).join(' OR ');
}

function keywordsOf(ctx) {
  const keywords = listOf(ctx.config.keywords ?? ctx.config.keyword ?? ctx.config.query);
  if (!keywords.length) throw new JobInputError('keywords is required: send an array of words or phrases');
  if (keywords.length > 10) throw new JobInputError('send at most 10 keywords');
  return keywords;
}

const idAfter = (a, b) => !b || (/^\d+$/.test(a) && /^\d+$/.test(b) && BigInt(a) > BigInt(b));

function csvOf(rows, columns) {
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join('; ') : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n');
}

// ── Web apps in a browser ──────────────────────────────────────────────────

/** Runs inside the page: the headings, labelled regions, tables and text it shows. */
function extractDom() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cellsOf = (row) =>
    Array.from(row.querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"], [role="rowheader"]'))
      .map((c) => clean(c.textContent));
  const tables = Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]'))
    .slice(0, 10)
    .map((table) => {
      const rows = Array.from(table.querySelectorAll('tr, [role="row"]')).map(cellsOf).filter((r) => r.length);
      return { headers: rows[0] || [], rows: rows.slice(1, 501) };
    })
    .filter((t) => t.headers.length || t.rows.length);
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
    .map((h) => clean(h.textContent))
    .filter(Boolean);
  const regions = Array.from(document.querySelectorAll('section[aria-label], [role="region"][aria-label]'))
    .map((el) => clean(el.getAttribute('aria-label')))
    .filter(Boolean);
  const main = document.querySelector('main, [role="main"]') || document.body;
  return {
    title: document.title,
    headings: [...new Set(headings)].slice(0, 100),
    regions: [...new Set(regions)].slice(0, 100),
    tables,
    text: (main?.innerText || '').slice(0, 20000),
  };
}

const MAX_PAYLOADS = 25;
const MAX_PAYLOAD_BYTES = 100_000;

/** The GraphQL operation name in an x.com API URL, if it is one. */
function operationOf(url) {
  const match = url.match(/\/graphql\/[^/]+\/([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

/**
 * Open a web app page as the session, recording the JSON its own scripts load
 * and what it renders.
 */
async function captureWebApp(ctx, url) {
  const page = await ctx.page();
  const payloads = [];
  const reads = [];
  const onResponse = (response) => {
    const type = response.request().resourceType();
    const contentType = response.headers()['content-type'] || '';
    if ((type !== 'xhr' && type !== 'fetch') || !contentType.includes('json') || payloads.length + reads.length >= MAX_PAYLOADS) return;
    reads.push(
      response
        .json()
        .then((body) => {
          const bytes = JSON.stringify(body).length;
          payloads.push({
            url: response.url(),
            status: response.status(),
            operation: operationOf(response.url()),
            body: bytes <= MAX_PAYLOAD_BYTES ? body : { omitted: true, bytes },
          });
        })
        .catch(() => null),
    );
  };

  page.on('response', onResponse);
  try {
    ctx.progress(`Opening ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    } catch (err) {
      // Web apps that keep a request open never go idle; what loaded is still read.
      if (err.name !== 'TimeoutError') throw err;
    }
    await ctx.sleep(delayOf(ctx, 2500));
    await Promise.allSettled(reads);
    const finalUrl = page.url();
    if (/\/(?:i\/flow\/)?login\b|\/logout\b/.test(new URL(finalUrl).pathname)) {
      const { XSessionError } = await import('../xSession.js');
      throw new XSessionError('SESSION_EXPIRED', `X sent this session to its login page (${finalUrl}). Save a fresh session.`, 401);
    }
    const dom = await page.evaluate(extractDom);
    return { requestedUrl: url, finalUrl, ...dom, payloads };
  } finally {
    page.off('response', onResponse);
  }
}

const hostOf = (url) => new URL(url).hostname;

/** Arrays of records under keys matching a pattern, anywhere in the captured JSON. */
export function findCollections(payloads, pattern) {
  const found = [];
  const walk = (node, path, source, depth) => {
    if (!node || typeof node !== 'object' || depth > 10 || found.length >= 20) return;
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        if (pattern.test(key) && value.length && value.every((v) => v && typeof v === 'object')) {
          found.push({ source, path: here, count: value.length, items: value.slice(0, 100) });
        } else {
          value.forEach((item, i) => walk(item, `${here}.${i}`, source, depth + 1));
        }
      } else {
        walk(value, here, source, depth + 1);
      }
    }
  };
  for (const payload of payloads) walk(payload.body, '', payload.operation || payload.url, 0);
  return found;
}

/** A rendered table as records keyed by its header cells. */
function tableRecords(table) {
  const headers = table.headers.map((h, i) => h || `column${i + 1}`);
  return table.rows.map((row) => Object.fromEntries(row.map((cell, i) => [headers[i] || `column${i + 1}`, cell])));
}

const apiSummary = (payloads) => payloads.map(({ url, status, operation, body }) => ({ url, status, operation, body }));

/** Lines of page text that carry a money amount, labelled by the line before. */
export function moneyLines(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const amount = /([$€£¥])\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(USD|EUR|GBP)\b/;
  const out = [];
  lines.forEach((line, i) => {
    const match = line.match(amount);
    if (!match) return;
    const inline = line.replace(match[0], '').replace(/[:\s]+$/, '').trim();
    out.push({
      label: inline || lines[i - 1] || null,
      amount: match[0],
      value: Number((match[2] || match[3]).replace(/,/g, '')),
      currency: match[1] || match[4],
    });
  });
  return out;
}

async function monetizationPage(ctx) {
  const capture = await captureWebApp(ctx, 'https://x.com/settings/monetization');
  const available = new URL(capture.finalUrl).pathname.startsWith('/settings/monetization');
  return {
    url: capture.finalUrl,
    monetizationAvailable: available,
    ...(available ? {} : { redirectedTo: capture.finalUrl }),
    amounts: moneyLines(capture.text),
    sections: capture.headings,
    tables: capture.tables.map((t) => ({ headers: t.headers, records: tableRecords(t) })),
    text: capture.text,
    api: apiSummary(capture.payloads),
    capturedAt: nowIso(),
  };
}

async function adsCapture(ctx, url = 'https://ads.x.com/') {
  const capture = await captureWebApp(ctx, url);
  if (!hostOf(capture.finalUrl).startsWith('ads.')) {
    throw new JobInputError(`ads.x.com sent this account to ${capture.finalUrl}: it has no X Ads account. Create one at https://ads.x.com first.`);
  }
  const accountId = new URL(capture.finalUrl).pathname.match(/\/(?:campaign_manager|accounts?|analytics)\/([a-z0-9]+)/i)?.[1] ?? null;
  return { capture, accountId };
}

/** Campaign records from the rendered tables and from the JSON the ads app loaded. */
function campaignsOf(capture) {
  const tables = capture.tables.filter((t) => t.headers.some((h) => /campaign/i.test(h)));
  return {
    rows: tables.flatMap(tableRecords),
    collections: findCollections(capture.payloads, /campaign/i),
  };
}

function onlyListAction(ctx, what) {
  const action = ctx.config.action ?? 'list';
  if (action !== 'list') {
    throw new JobInputError(`action "${action}" is not supported for ${what}: only "list" reads it. Changes are made in X's own app.`);
  }
}

async function xproCapture(ctx) {
  const capture = await captureWebApp(ctx, 'https://pro.x.com/');
  if (hostOf(capture.finalUrl) !== 'pro.x.com') {
    throw new JobInputError(`X Pro sent this account to ${capture.finalUrl}: X Pro needs an X Premium subscription on the account.`);
  }
  return {
    url: capture.finalUrl,
    columns: capture.regions,
    decks: findCollections(capture.payloads, /deck|column/i),
    capture,
  };
}

// ── Lead helpers that read X ───────────────────────────────────────────────

async function latestPostAt(ctx, username) {
  const { scrapeTweets } = await x.tweets();
  const tweets = await scrapeTweets(await ctx.http(), username, { limit: 5 });
  const times = tweets.filter((t) => t.createdAt).map((t) => Date.parse(t.createdAt));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

const QUALIFY_KEYS = ['minFollowers', 'maxFollowers', 'keywords', 'verified', 'requireWebsite', 'minTweets', 'activeWithinDays'];

function qualifyCriteria(config) {
  const source = config.criteria && typeof config.criteria === 'object' ? config.criteria : config;
  const criteria = {};
  for (const key of QUALIFY_KEYS) {
    if (source[key] === undefined || source[key] === null || source[key] === '') continue;
    if (key === 'keywords') criteria.keywords = listOf(source.keywords).map((k) => k.toLowerCase());
    else if (key === 'verified' || key === 'requireWebsite') criteria[key] = boolOrNull(source[key]);
    else criteria[key] = numberOrNull(source[key], key);
  }
  if (Object.keys(criteria).length) return { criteria, criteriaSource: 'request' };
  return { criteria: { minFollowers: 100, activeWithinDays: 30 }, criteriaSource: 'default' };
}

function checkCriteria(profile, criteria, lastPostAt) {
  const checks = [];
  const check = (criterion, expected, actual, passed) => checks.push({ criterion, expected, actual, passed });
  if (criteria.minFollowers != null) check('minFollowers', criteria.minFollowers, profile.followers, profile.followers >= criteria.minFollowers);
  if (criteria.maxFollowers != null) check('maxFollowers', criteria.maxFollowers, profile.followers, profile.followers <= criteria.maxFollowers);
  if (criteria.minTweets != null) check('minTweets', criteria.minTweets, profile.tweets, (profile.tweets || 0) >= criteria.minTweets);
  if (criteria.verified != null) check('verified', criteria.verified, Boolean(profile.verified), Boolean(profile.verified) === criteria.verified);
  if (criteria.requireWebsite) check('requireWebsite', true, profile.website || null, Boolean(profile.website));
  if (criteria.keywords?.length) {
    const bio = (profile.bio || '').toLowerCase();
    const hits = criteria.keywords.filter((k) => bio.includes(k));
    check('keywords', criteria.keywords, hits, hits.length > 0);
  }
  if (criteria.activeWithinDays != null) {
    const days = lastPostAt ? round2((Date.now() - Date.parse(lastPostAt)) / DAY_MS) : null;
    check('activeWithinDays', criteria.activeWithinDays, days, days !== null && days <= criteria.activeWithinDays);
  }
  return checks;
}

const LEAD_COLUMNS = ['username', 'name', 'followers', 'following', 'tweets', 'verified', 'location', 'website', 'score', 'qualified', 'source', 'firstSeen', 'bio'];

// ── Processors ─────────────────────────────────────────────────────────────

async function creatorAnalyticsRun(ctx) {
  const username = await targetUsername(ctx);
  return { success: true, ...(await accountAnalytics(ctx, username, ctx.config.period)) };
}

async function revenueRun(ctx) {
  const viewer = await viewerOf(ctx);
  return { success: true, account: viewer.username, ...(await monetizationPage(ctx)) };
}

async function subscribersRun(ctx) {
  const limit = intIn(ctx.config.limit, 100, 1, 1000);
  return { success: true, ...(await viewerUserTimeline(ctx, 'UserCreatorSubscribers', 'subscribers', limit)) };
}

export default {
  // ── Account analytics and history ──
  getCreatorAnalytics: {
    run: creatorAnalyticsRun,
    concurrency: 3,
    description: 'Post performance, reach and monetisation signals for an account over a period',
  },

  creatorAnalytics: {
    run: creatorAnalyticsRun,
    concurrency: 3,
    description: 'Creator analytics for the session account, or the username sent',
  },

  getAnalyticsHistory: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const limit = intIn(ctx.config.limit, 30, 1, 90);
      const owner = ownerOf(ctx);
      const db = await store();
      const rows = db
        .prepare('SELECT * FROM api_account_snapshots WHERE owner_key = ? AND username = ? ORDER BY taken_at DESC LIMIT ?')
        .all(owner, username, limit)
        .reverse();
      const profile = await readTarget(ctx, username);
      const current = { ...snapshotFromProfile(profile, username), takenAt: nowIso() };
      const snapshots = rows.map(snapshotOut);
      const first = snapshots[0];
      return {
        success: true,
        username,
        current,
        count: snapshots.length,
        snapshots,
        changeSinceFirst: first
          ? {
              since: first.takenAt,
              days: round2((Date.now() - Date.parse(first.takenAt)) / DAY_MS),
              followers: current.followers - first.followers,
              following: current.following - first.following,
              tweets: current.tweets - first.tweets,
            }
          : null,
        ...(first ? {} : { hint: 'No snapshots are stored for this account yet. Take them with POST /api/ai/analytics/snapshot.' }),
      };
    },
    concurrency: 3,
    description: 'Stored follower snapshots for an account, with its live numbers',
  },

  storeSnapshot: {
    run: async (ctx) => {
      const snapshot = ctx.require('snapshot');
      if (typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new JobInputError('snapshot must be an object');
      const takenAt = snapshot.takenAt ? new Date(snapshot.takenAt) : new Date();
      if (Number.isNaN(takenAt.getTime())) throw new JobInputError('snapshot.takenAt must be a date');
      const row = {
        username: cleanUsername(snapshot.username, 'snapshot.username'),
        followers: countField(snapshot.followers, 'snapshot.followers'),
        following: countField(snapshot.following ?? 0, 'snapshot.following'),
        tweets: countField(snapshot.tweets ?? 0, 'snapshot.tweets'),
        verified: Boolean(snapshot.verified),
        takenAt: takenAt.toISOString(),
      };
      const owner = ownerOf(ctx);
      const db = await store();
      const stored = saveSnapshot(db, owner, row);
      const { n } = db
        .prepare('SELECT COUNT(*) AS n FROM api_account_snapshots WHERE owner_key = ? AND username = ?')
        .get(owner, row.username);
      return { success: true, stored, snapshotsForAccount: n };
    },
    concurrency: 5,
    description: 'Keep a follower snapshot for later history and growth reports',
  },

  computeGrowthRate: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const window = parsePeriod(ctx.config.period, '7d');
      const owner = ownerOf(ctx);
      const db = await store();
      const windowStart = new Date(Date.now() - window.ms).toISOString();

      const profile = await readTarget(ctx, username);
      const inWindow = db
        .prepare('SELECT * FROM api_account_snapshots WHERE owner_key = ? AND username = ? AND taken_at >= ? ORDER BY taken_at ASC')
        .all(owner, username, windowStart);
      const before = db
        .prepare('SELECT * FROM api_account_snapshots WHERE owner_key = ? AND username = ? AND taken_at < ? ORDER BY taken_at DESC LIMIT 1')
        .get(owner, username, windowStart);
      const current = saveSnapshot(db, owner, snapshotFromProfile(profile, username));

      const baseline = before || inWindow[0];
      if (!baseline) {
        throw new JobInputError(
          `No earlier snapshot of @${username} is stored for this session, so there is nothing to measure growth against. ` +
            `Its current numbers (${current.followers} followers) were just recorded as the baseline: call growth-rate again later.`,
        );
      }
      const days = Math.max((Date.parse(current.takenAt) - Date.parse(baseline.taken_at)) / DAY_MS, 1 / 24);
      const change = current.followers - baseline.followers;
      const perDay = change / days;
      const series = [...(before ? [before] : []), ...inWindow].map(snapshotOut).concat(current);
      return {
        success: true,
        username,
        period: window.label,
        baseline: snapshotOut(baseline),
        current,
        baselineOutsideWindow: Boolean(before),
        days: round2(days),
        followers: {
          change,
          percentChange: percent(change, baseline.followers),
          perDay: round2(perDay),
          projected30d: Math.round(current.followers + perDay * 30),
        },
        following: { change: current.following - baseline.following },
        tweets: { change: current.tweets - baseline.tweets, perDay: round2((current.tweets - baseline.tweets) / days) },
        series,
        snapshotRecorded: true,
      };
    },
    concurrency: 3,
    description: 'Follower growth between the stored snapshots and now',
  },

  // ── Creator monetisation ──
  creatorRevenue: {
    run: revenueRun,
    concurrency: 1,
    description: "Read the account's monetisation page: earnings, payouts and eligibility as X shows them",
  },

  getRevenue: {
    run: revenueRun,
    concurrency: 1,
    description: "Read the account's monetisation page",
  },

  creatorSubscribers: {
    run: subscribersRun,
    concurrency: 3,
    description: "List the accounts subscribed to the session account's Creator Subscription",
  },

  getSubscribers: {
    run: subscribersRun,
    concurrency: 3,
    description: 'List Creator Subscription subscribers',
  },

  creatorSubscriptions: {
    run: async (ctx) => {
      const limit = intIn(ctx.config.limit, 100, 1, 1000);
      return { success: true, ...(await viewerUserTimeline(ctx, 'UserCreatorSubscriptions', 'subscriptions', limit)) };
    },
    concurrency: 3,
    description: 'List the creators the session account subscribes to',
  },

  creatorStudio: {
    run: async (ctx) => {
      const viewer = await viewerOf(ctx);
      const sections = {
        analytics: () => accountAnalytics(ctx, viewer.username.toLowerCase(), ctx.config.period ?? '28d'),
        subscribers: () => viewerUserTimeline(ctx, 'UserCreatorSubscribers', 'subscribers', 100),
        subscriptions: () => viewerUserTimeline(ctx, 'UserCreatorSubscriptions', 'subscriptions', 100),
        revenue: () => monetizationPage(ctx),
      };
      const out = { success: true, account: profileSummary(viewer) };
      const failures = [];
      for (const [name, read] of Object.entries(sections)) {
        ctx.throwIfCancelled();
        ctx.progress(`Reading ${name}`);
        try {
          out[name] = await read();
        } catch (err) {
          if (err.name === 'JobCancelledError') throw err;
          failures.push(err);
          out[name] = { error: err.message };
        }
      }
      if (failures.length === Object.keys(sections).length) throw failures[0];
      return out;
    },
    concurrency: 1,
    description: 'Creator dashboard: analytics, subscribers, subscriptions and revenue together',
  },

  // ── Social graph ──
  graphBuild: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const depth = intIn(ctx.config.depth, 1, 1, 2);
      const maxNodes = intIn(ctx.config.maxNodes, 500, 10, 2000);
      const owner = ownerOf(ctx);
      const client = await ctx.http();
      const [profileMod, relationships, builder] = await Promise.all([
        x.profile(),
        x.relationships(),
        import('../../../src/graph/builder.js'),
      ]);
      const errors = [];
      const scrapers = httpGraphScrapers(client, errors, { ...profileMod, ...relationships });
      const graph = await builder.buildGraph(username, {
        depth,
        maxNodes,
        scrapers,
        onProgress: (p) => ctx.progress({ status: 'running', message: `Graph: ${p.nodesCount} accounts, ${p.edgesCount} links`, ...p }),
        isCancelled: () => ctx.cancelled(),
      });
      ctx.throwIfCancelled();
      if (!graph.nodes.get(username)?.crawled) {
        const seedError = errors.find((e) => e.account.toLowerCase() === username);
        if (seedError) throw await asInputError(seedError.cause, username);
        throw new XRefusedError(`Could not read @${username} to start the graph`);
      }
      graph.id = ctx.operationId;
      const data = builder.serializeGraph(graph);
      const db = await store();
      db.prepare(
        `INSERT INTO api_graphs (owner_key, graph_id, seed, data_json, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(owner_key, graph_id) DO UPDATE SET seed = excluded.seed, data_json = excluded.data_json, created_at = excluded.created_at`,
      ).run(owner, graph.id, username, JSON.stringify(data), nowIso());

      const { getInfluenceRanking } = await import('../../../src/graph/analyzer.js');
      return {
        success: true,
        graphId: graph.id,
        username,
        depth,
        maxNodes,
        status: graph.metadata.status,
        nodeCount: data.nodes.length,
        edgeCount: data.edges.length,
        crawledCount: data.nodes.filter((n) => n.crawled).length,
        errors: errors.slice(0, 20).map(({ account, error }) => ({ account, error })),
        topInfluencers: getInfluenceRanking(graph, 10).map((r) => ({ username: r.username, influenceScore: r.influenceScore })),
        nodes: data.nodes.map(slimNode),
        edges: data.edges,
        analyzeWith: { endpoint: '/api/ai/graph/analyze', graphOperationId: graph.id },
      };
    },
    concurrency: 1,
    description: "Crawl an account's follower and following network into a graph",
  },

  graphAnalyze: {
    run: async (ctx) => {
      const graphId = String(ctx.require('graphOperationId'));
      const metrics = listOf(ctx.config.metrics);
      const wanted = metrics.length ? metrics : ['communities', 'influencers', 'bridges'];
      const unknown = wanted.filter((m) => !GRAPH_METRICS.includes(m));
      if (unknown.length) throw new JobInputError(`unknown metrics: ${unknown.join(', ')}. Use ${GRAPH_METRICS.join(', ')}`);
      const graph = await loadGraph(ctx, graphId);
      if (!graph) {
        throw new JobInputError(`No graph ${graphId} was built with this session. Build one with POST /api/ai/graph/build.`);
      }
      const results = {};
      for (const metric of wanted) results[metric] = await graphMetric(metric, graph);
      return {
        success: true,
        graphId,
        seed: graph.seed,
        nodeCount: graph.nodes.size,
        edgeCount: graph.edges.length,
        metrics: results,
        analyzedAt: nowIso(),
      };
    },
    concurrency: 3,
    description: 'Communities, influencers, bridges, mutuals, ghosts and orbits of a built graph',
  },

  graphRecommendations: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const limit = intIn(ctx.config.limit, 20, 1, 50);
      const basedOn = ctx.config.basedOn ?? 'mutual_followers';
      const bases = ['mutual_followers', 'following', 'followers', 'graph'];
      if (!bases.includes(basedOn)) throw new JobInputError(`based_on must be one of ${bases.join(', ')}`);

      if (basedOn === 'graph') {
        const db = await store();
        const row = db
          .prepare('SELECT graph_id FROM api_graphs WHERE owner_key = ? AND seed = ? ORDER BY created_at DESC LIMIT 1')
          .get(ownerOf(ctx), username);
        if (!row) throw new JobInputError(`No graph of @${username} was built with this session. Build one with POST /api/ai/graph/build.`);
        const graph = await loadGraph(ctx, row.graph_id);
        const { getRecommendations } = await import('../../../src/graph/recommendations.js');
        const recs = getRecommendations(graph, username);
        const slim = (list) => list.slice(0, limit).map(({ node, ...rest }) => ({ ...rest, node: slimNode(node) }));
        return {
          success: true,
          username,
          basedOn,
          graphId: row.graph_id,
          recommendations: slim(recs.followSuggestions),
          engage: slim(recs.engageSuggestions),
          competitorWatch: slim(recs.competitorWatch),
          safeToUnfollow: slim(recs.safeToUnfollow),
        };
      }

      const client = await ctx.http();
      const { scrapeFollowers, scrapeFollowing } = await x.relationships();
      const delay = delayOf(ctx, 1500);
      const sampleSize = intIn(ctx.config.sampleSize, 15, 3, 30);

      ctx.progress(`Reading who @${username} follows`);
      const following = await scrapeFollowing(client, username, { limit: 1000 });
      const followingSet = new Set(following.map((u) => u.username.toLowerCase()));
      let pool = following;
      if (basedOn !== 'following') {
        await pause(ctx, delay);
        ctx.progress(`Reading @${username}'s followers`);
        const followers = await scrapeFollowers(client, username, { limit: 1000 });
        pool = basedOn === 'followers' ? followers : followers.filter((u) => followingSet.has(u.username.toLowerCase()));
      }
      if (!pool.length) {
        throw new JobInputError(`@${username} has no ${basedOn.replace('_', ' ')} to base recommendations on. Try based_on "following".`);
      }

      const sample = [...pool].sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0)).slice(0, sampleSize);
      const candidates = new Map();
      const sampled = [];
      for (const account of sample) {
        await pause(ctx, delay);
        ctx.progress(`Reading who @${account.username} follows (${sampled.length + 1}/${sample.length})`);
        try {
          const theirs = await scrapeFollowing(client, account.username, { limit: 100 });
          sampled.push({ username: account.username, following: theirs.length });
          for (const user of theirs) {
            const key = user.username.toLowerCase();
            if (key === username || followingSet.has(key)) continue;
            const entry = candidates.get(key) || { user, followedBy: [] };
            entry.followedBy.push(account.username);
            candidates.set(key, entry);
          }
        } catch (err) {
          if (err.name === 'JobCancelledError' || !(err.name === 'AuthError' || (await isUnavailable(err)))) throw err;
          sampled.push({ username: account.username, error: err.message });
        }
      }
      if (!sampled.some((s) => !s.error)) throw new XRefusedError(`X refused every sampled account's following list: ${sampled[0].error}`);
      const recommendations = [...candidates.values()]
        .sort((a, b) => b.followedBy.length - a.followedBy.length || (b.user.followersCount || 0) - (a.user.followersCount || 0))
        .slice(0, limit)
        .map(({ user, followedBy }) => ({
          ...profileSummary(user),
          sharedConnections: followedBy.length,
          followedBy: followedBy.slice(0, 5),
          reason: `Followed by ${followedBy.length} of the ${sampled.length} accounts sampled from @${username}'s ${basedOn.replace('_', ' ')}`,
        }));
      if (!recommendations.length) {
        throw new XRefusedError(`Every account the sampled ${basedOn.replace('_', ' ')} follow is already followed by @${username}.`);
      }
      return {
        success: true,
        username,
        basedOn,
        followingRead: following.length,
        poolSize: pool.length,
        sampled,
        recommendations,
      };
    },
    concurrency: 1,
    description: 'Accounts to follow, from who your connections follow',
  },

  // ── CRM ──
  crmSync: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const syncType = ['followers', 'following', 'both'].includes(ctx.config.syncType) ? ctx.config.syncType : 'followers';
      const limit = intIn(ctx.config.limit, 1000, 1, 10_000);
      const owner = ownerOf(ctx);
      const client = await ctx.http();
      const { scrapeFollowers, scrapeFollowing } = await x.relationships();

      const profile = await readTarget(ctx, username);
      const lists = {};
      const read = async (kind, fn, expected) => {
        const users = await fn(client, username, {
          limit,
          onProgress: ({ fetched }) => ctx.progress(`Read ${fetched} ${kind} of @${username}`),
        });
        if (!users.length && expected > 0) {
          throw new XRefusedError(`X returned no ${kind} for @${username}, whose profile shows ${expected}. The account may be protected.`);
        }
        lists[kind] = users;
      };
      if (syncType !== 'following') await read('followers', scrapeFollowers, profile.followers);
      if (syncType !== 'followers') {
        if (lists.followers) await pause(ctx, delayOf(ctx, 2000));
        await read('following', scrapeFollowing, profile.following);
      }

      const db = await store();
      const followerSet = lists.followers && new Set(lists.followers.map((u) => u.username.toLowerCase()));
      const followingSet = lists.following && new Set(lists.following.map((u) => u.username.toLowerCase()));
      const everyone = new Map();
      for (const user of [...(lists.followers || []), ...(lists.following || [])]) everyone.set(user.username.toLowerCase(), user);

      const stale = { followers: [], following: [] };
      let added = 0;
      db.transaction(() => {
        for (const [key, user] of everyone) {
          const { created } = upsertContact(db, owner, { ...user, username: key }, {
            sourceAccount: username,
            isFollower: followerSet ? (followerSet.has(key) ? 1 : 0) : null,
            isFollowing: followingSet ? (followingSet.has(key) ? 1 : 0) : null,
          });
          if (created) added++;
        }
        // A list read to its end tells us who is no longer on it.
        const complete = { followers: lists.followers && lists.followers.length < limit, following: lists.following && lists.following.length < limit };
        for (const [kind, column, set] of [['followers', 'is_follower', followerSet], ['following', 'is_following', followingSet]]) {
          if (!complete[kind]) continue;
          const marked = db
            .prepare(`SELECT username FROM api_crm_contacts WHERE owner_key = ? AND source_account = ? AND ${column} = 1`)
            .all(owner, username);
          for (const { username: gone } of marked) {
            if (set.has(gone)) continue;
            db.prepare(`UPDATE api_crm_contacts SET ${column} = 0, updated_at = ? WHERE owner_key = ? AND username = ?`).run(nowIso(), owner, gone);
            stale[kind].push(gone);
          }
        }
      })();

      return {
        success: true,
        username,
        syncType,
        fetched: {
          followers: lists.followers?.length ?? null,
          following: lists.following?.length ?? null,
        },
        mutuals: followerSet && followingSet ? [...followerSet].filter((u) => followingSet.has(u)).length : null,
        added,
        updated: everyone.size - added,
        noLongerFollower: stale.followers,
        noLongerFollowed: stale.following,
        totalContacts: contactCount(db, owner),
      };
    },
    concurrency: 1,
    description: "Pull an account's followers and following into the CRM",
  },

  crmTag: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const tags = listOf(ctx.require('tags')).map(normaliseTag);
      if (!tags.length) throw new JobInputError('tags must hold at least one tag');
      const remove = Boolean(ctx.config.remove);
      const owner = ownerOf(ctx);
      const db = await store();

      let contactAdded = false;
      if (!db.prepare('SELECT 1 FROM api_crm_contacts WHERE owner_key = ? AND username = ?').get(owner, username)) {
        if (remove) throw new JobInputError(`@${username} is not in your CRM`);
        upsertContact(db, owner, { ...(await readTarget(ctx, username)), username });
        contactAdded = true;
      }
      const now = nowIso();
      const changed = [];
      db.transaction(() => {
        for (const tag of tags) {
          const result = remove
            ? db.prepare('DELETE FROM api_crm_tags WHERE owner_key = ? AND username = ? AND tag = ?').run(owner, username, tag)
            : db.prepare('INSERT OR IGNORE INTO api_crm_tags (owner_key, username, tag, created_at) VALUES (?, ?, ?, ?)').run(owner, username, tag, now);
          if (result.changes) changed.push(tag);
        }
      })();
      const current = db
        .prepare('SELECT tag FROM api_crm_tags WHERE owner_key = ? AND username = ? ORDER BY tag')
        .all(owner, username)
        .map((r) => r.tag);
      return {
        success: true,
        username,
        [remove ? 'removed' : 'added']: changed,
        unchanged: tags.filter((t) => !changed.includes(t)),
        tags: current,
        contactAdded,
      };
    },
    concurrency: 5,
    description: 'Add or remove tags on a CRM contact',
  },

  crmSearch: {
    run: async (ctx) => {
      const owner = ownerOf(ctx);
      const db = await store();
      const totalContacts = requireContacts(db, owner);
      const limit = intIn(ctx.config.limit, 50, 1, 500);
      const filters = {};
      for (const key of CONTACT_FILTERS) if (ctx.config[key] !== undefined && ctx.config[key] !== null) filters[key] = ctx.config[key];
      const { total, contacts } = filterContacts(db, owner, filters, limit);
      return { success: true, filters, totalContacts, matches: total, count: contacts.length, contacts };
    },
    concurrency: 5,
    description: 'Search CRM contacts by text, tags and follower counts',
  },

  crmSegment: {
    run: async (ctx) => {
      const action = ctx.config.action ?? 'get';
      const owner = ownerOf(ctx);
      const db = await store();
      const run = (criteria) => filterContacts(db, owner, criteria, intIn(criteria.limit ?? ctx.config.limit, 500, 1, 5000));

      if (action === 'list') {
        const segments = db.prepare('SELECT * FROM api_crm_segments WHERE owner_key = ? ORDER BY name').all(owner);
        return {
          success: true,
          count: segments.length,
          segments: segments.map((s) => {
            const criteria = JSON.parse(s.criteria_json);
            return { name: s.name, criteria, contacts: run(criteria).total, createdAt: s.created_at, updatedAt: s.updated_at };
          }),
        };
      }

      const name = String(ctx.require('name')).trim();
      if (!name || name.length > 80) throw new JobInputError('name must be 1 to 80 characters');

      if (action === 'create') {
        const criteria = ctx.require('criteria');
        if (typeof criteria !== 'object' || Array.isArray(criteria)) throw new JobInputError('criteria must be an object');
        const unknown = Object.keys(criteria).filter((k) => !CONTACT_FILTERS.includes(k) && k !== 'limit');
        if (unknown.length) throw new JobInputError(`unknown criteria: ${unknown.join(', ')}. Use ${CONTACT_FILTERS.join(', ')}`);
        if (!Object.keys(criteria).length) throw new JobInputError('criteria must set at least one filter');
        const preview = run(criteria);
        const now = nowIso();
        db.prepare(
          `INSERT INTO api_crm_segments (owner_key, name, criteria_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(owner_key, name) DO UPDATE SET criteria_json = excluded.criteria_json, updated_at = excluded.updated_at`,
        ).run(owner, name, JSON.stringify(criteria), now, now);
        return { success: true, action, name, criteria, contacts: preview.total, sample: preview.contacts.slice(0, 20) };
      }

      if (action === 'get') {
        const segment = db.prepare('SELECT * FROM api_crm_segments WHERE owner_key = ? AND name = ?').get(owner, name);
        if (!segment) throw new JobInputError(`No segment named "${name}". Create it with action "create".`);
        const criteria = JSON.parse(segment.criteria_json);
        const { total, contacts } = run(criteria);
        return { success: true, action, name, criteria, matches: total, count: contacts.length, contacts };
      }

      throw new JobInputError('action must be one of get, create, list');
    },
    concurrency: 5,
    description: 'Create, run or list saved CRM segments',
  },

  // ── Leads ──
  leadFind: {
    run: async (ctx) => {
      const keywords = keywordsOf(ctx);
      const limit = intIn(ctx.config.limit, 25, 1, 100);
      const perKeyword = intIn(ctx.config.maxTweets, 60, 10, 200);
      const minFollowers = numberOrNull(ctx.config.minFollowers, 'minFollowers');
      const maxFollowers = numberOrNull(ctx.config.maxFollowers, 'maxFollowers');
      const delay = delayOf(ctx, 1500);
      const owner = ownerOf(ctx);
      const client = await ctx.http();
      const { searchTweets } = await x.search();

      const candidates = new Map();
      let postsScanned = 0;
      for (const [i, keyword] of keywords.entries()) {
        if (i) await pause(ctx, delay);
        ctx.progress(`Searching "${keyword}"`);
        const tweets = await searchTweets(client, keyword, { limit: perKeyword, type: 'Latest' });
        postsScanned += tweets.length;
        for (const tweet of tweets) {
          if (tweet.isRetweet || !tweet.author?.username) continue;
          const key = tweet.author.username.toLowerCase();
          const entry = candidates.get(key) || { author: tweet.author, matches: [], keywords: new Set() };
          entry.matches.push(matchOf(tweet, keyword));
          entry.keywords.add(keyword);
          candidates.set(key, entry);
        }
      }
      if (!candidates.size) throw new JobInputError(`No recent posts on X match ${keywords.join(', ')}. Try broader keywords.`);

      const ranked = [...candidates.values()].sort(
        (a, b) =>
          b.matches.filter((m) => m.intent).length - a.matches.filter((m) => m.intent).length ||
          b.matches.length - a.matches.length ||
          Math.max(...b.matches.map((m) => m.engagements)) - Math.max(...a.matches.map((m) => m.engagements)),
      );

      const db = await store();
      const leads = [];
      const skipped = [];
      let profiled = 0;
      for (const candidate of ranked.slice(0, Math.min(100, limit * 2))) {
        if (leads.length >= limit) break;
        if (profiled) await pause(ctx, delay);
        ctx.progress(`Profiling @${candidate.author.username} (${leads.length}/${limit} leads)`);
        let profile;
        try {
          profile = await readProfile(ctx, candidate.author.username);
          profiled++;
        } catch (err) {
          if (!(await isUnavailable(err))) throw err;
          skipped.push({ username: candidate.author.username, reason: err.message });
          continue;
        }
        if ((minFollowers !== null && profile.followers < minFollowers) || (maxFollowers !== null && profile.followers > maxFollowers)) {
          skipped.push({ username: profile.username, reason: `${profile.followers} followers is outside the requested range` });
          continue;
        }
        leads.push(saveLead(db, owner, {
          profile,
          profiled: true,
          matches: candidate.matches,
          keywords: [...candidate.keywords],
          source: 'find',
        }));
      }
      return {
        success: true,
        keywords,
        postsScanned,
        candidates: candidates.size,
        profiled,
        count: leads.length,
        leads: leads.sort((a, b) => b.score - a.score),
        skipped,
      };
    },
    concurrency: 1,
    description: 'Find people asking about your keywords on X and keep them as scored leads',
  },

  leadQualify: {
    run: async (ctx) => {
      const usernames = listOf(ctx.require('usernames')).map((u) => cleanUsername(u, 'usernames'));
      if (usernames.length > 100) throw new JobInputError('send at most 100 usernames');
      const { criteria, criteriaSource } = qualifyCriteria(ctx.config);
      const delay = delayOf(ctx, 1500);
      const owner = ownerOf(ctx);
      const db = await store();

      const results = [];
      for (const [i, username] of usernames.entries()) {
        if (i) await pause(ctx, delay);
        ctx.progress(`Qualifying @${username} (${i + 1}/${usernames.length})`);
        try {
          const profile = await readProfile(ctx, username);
          const lastPostAt = criteria.activeWithinDays != null ? await latestPostAt(ctx, username) : null;
          const checks = checkCriteria(profile, criteria, lastPostAt);
          const qualification = { qualified: checks.every((c) => c.passed), checks, lastPostAt, criteria, checkedAt: nowIso() };
          const lead = saveLead(db, owner, { profile, profiled: true, source: 'qualify', qualification });
          results.push({ username, qualified: qualification.qualified, checks, score: lead.score, lead });
        } catch (err) {
          if (!(await isUnavailable(err))) throw err;
          results.push({ username, qualified: false, error: err.message });
        }
      }
      if (results.every((r) => r.error)) throw new XRefusedError(`None of the accounts could be read: ${results[0].error}`);
      return {
        success: true,
        criteria,
        criteriaSource,
        checked: results.length,
        qualified: results.filter((r) => r.qualified).length,
        results,
      };
    },
    concurrency: 2,
    description: 'Check accounts against lead criteria and keep the verdicts',
  },

  leadExport: {
    run: async (ctx) => {
      const format = ctx.config.format ?? 'json';
      if (!['json', 'csv'].includes(format)) throw new JobInputError('format must be json or csv');
      const minScore = numberOrNull(ctx.config.minScore, 'minScore') ?? 0;
      const qualifiedOnly = Boolean(boolOrNull(ctx.config.qualifiedOnly));
      const limit = intIn(ctx.config.limit, 1000, 1, 10_000);
      const owner = ownerOf(ctx);
      const db = await store();
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM api_leads WHERE owner_key = ?').get(owner);
      if (!n) throw new JobInputError('No leads are stored for this session yet. Find some with POST /api/ai/leads/find or /qualify.');
      const leads = db
        .prepare(`SELECT * FROM api_leads WHERE owner_key = ? AND score >= ? ${qualifiedOnly ? 'AND qualified = 1' : ''} ORDER BY score DESC LIMIT ?`)
        .all(owner, minScore, limit)
        .map(leadFromRow);
      return {
        success: true,
        format,
        totalLeads: n,
        count: leads.length,
        ...(format === 'csv'
          ? { contentType: 'text/csv', data: csvOf(leads, LEAD_COLUMNS) }
          : { contentType: 'application/json', data: leads }),
        exportedAt: nowIso(),
      };
    },
    concurrency: 5,
    description: 'Export stored leads as JSON or CSV',
  },

  leadMonitor: {
    run: async (ctx) => {
      const keywords = keywordsOf(ctx);
      const limit = intIn(ctx.config.limit, 50, 10, 200);
      const owner = ownerOf(ctx);
      const db = await store();
      const monitorKey = keywords.map((k) => k.toLowerCase()).sort().join('|');
      const monitor = db.prepare('SELECT * FROM api_lead_monitors WHERE owner_key = ? AND monitor_key = ?').get(owner, monitorKey);
      const lastSeen = monitor?.last_seen_id || null;

      const { searchTweets } = await x.search();
      const query = `(${anyOf(keywords)})${lastSeen ? ` since_id:${lastSeen}` : ''}`;
      ctx.progress(`Scanning ${keywords.join(', ')}${lastSeen ? ' for new posts' : ''}`);
      const tweets = await searchTweets(await ctx.http(), query, { limit, type: 'Latest' });
      const fresh = tweets.filter((t) => !t.isRetweet && t.author?.username && idAfter(t.id, lastSeen));

      const newest = fresh.reduce((max, t) => (idAfter(t.id, max) ? t.id : max), lastSeen);
      const byAuthor = new Map();
      for (const tweet of fresh) {
        const lower = tweet.text.toLowerCase();
        const keyword = keywords.find((k) => lower.includes(k.toLowerCase())) || keywords[0];
        const entry = byAuthor.get(tweet.author.username.toLowerCase()) || { author: tweet.author, matches: [], keywords: new Set() };
        entry.matches.push(matchOf(tweet, keyword));
        entry.keywords.add(keyword);
        byAuthor.set(tweet.author.username.toLowerCase(), entry);
      }
      const leads = db.transaction(() =>
        [...byAuthor.values()].map((e) =>
          saveLead(db, owner, { profile: e.author, profiled: false, matches: e.matches, keywords: [...e.keywords], source: 'monitor' }),
        ),
      )();

      const now = nowIso();
      db.prepare(
        `INSERT INTO api_lead_monitors (owner_key, monitor_key, keywords_json, last_seen_id, runs, created_at, last_run_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(owner_key, monitor_key) DO UPDATE SET last_seen_id = excluded.last_seen_id, runs = runs + 1, last_run_at = excluded.last_run_at`,
      ).run(owner, monitorKey, JSON.stringify(keywords), newest, now, now);

      return {
        success: true,
        monitor: monitorKey,
        keywords,
        firstRun: !monitor,
        runs: (monitor?.runs || 0) + 1,
        previousCheck: monitor?.last_run_at || null,
        sinceTweetId: lastSeen,
        lastSeenTweetId: newest,
        newPosts: fresh.length,
        intentPosts: fresh.filter((t) => INTENT.test(t.text)).length,
        matches: fresh.map((t) => matchOf(t, keywords.find((k) => t.text.toLowerCase().includes(k.toLowerCase())) || keywords[0])),
        leads: leads.sort((a, b) => b.score - a.score),
        next: 'Queue the same keywords again to receive only posts newer than lastSeenTweetId.',
      };
    },
    concurrency: 2,
    description: 'Scan keyword conversations for new posts since the last scan and keep their authors as leads',
  },

  leadScore: {
    run: async (ctx) => {
      const usernames = listOf(ctx.config.usernames).map((u) => cleanUsername(u, 'usernames'));
      const owner = ownerOf(ctx);
      const db = await store();
      const delay = delayOf(ctx, 1500);
      const failures = [];

      if (usernames.length) {
        if (usernames.length > 100) throw new JobInputError('send at most 100 usernames');
        for (const [i, username] of usernames.entries()) {
          if (i) await pause(ctx, delay);
          ctx.progress(`Scoring @${username} (${i + 1}/${usernames.length})`);
          try {
            saveLead(db, owner, { profile: await readProfile(ctx, username), profiled: true, source: 'score' });
          } catch (err) {
            if (!(await isUnavailable(err))) throw err;
            failures.push({ username, error: err.message });
          }
        }
        if (failures.length === usernames.length) throw new XRefusedError(`None of the accounts could be read: ${failures[0].error}`);
      } else {
        const rows = db.prepare('SELECT * FROM api_leads WHERE owner_key = ?').all(owner);
        if (!rows.length) {
          throw new JobInputError('No leads are stored for this session. Send usernames, or find leads with POST /api/ai/leads/find first.');
        }
        db.transaction(() => {
          for (const row of rows) {
            const { score, breakdown } = scoreLead(leadFromRow(row));
            db.prepare('UPDATE api_leads SET score = ?, score_json = ?, updated_at = ? WHERE owner_key = ? AND username = ?')
              .run(score, JSON.stringify(breakdown), nowIso(), owner, row.username);
          }
        })();
      }

      const scope = usernames.length ? usernames.filter((u) => !failures.some((f) => f.username === u)) : null;
      const leads = (scope
        ? scope.map((u) => leadRow(db, owner, u))
        : db.prepare('SELECT * FROM api_leads WHERE owner_key = ? ORDER BY score DESC LIMIT 500').all(owner)
      )
        .map(leadFromRow)
        .sort((a, b) => b.score - a.score);
      const tiers = { hot: leads.filter((l) => l.score >= 60).length, warm: leads.filter((l) => l.score >= 35 && l.score < 60).length };
      return {
        success: true,
        scored: leads.length,
        tiers: { ...tiers, cold: leads.length - tiers.hot - tiers.warm },
        leads: leads.map((l, i) => ({ rank: i + 1, username: l.username, name: l.name, score: l.score, breakdown: l.scoreBreakdown, followers: l.followers, qualified: l.qualified })),
        failures,
      };
    },
    concurrency: 2,
    description: 'Score and rank leads by reach, credibility and buying intent',
  },

  leadEnrich: {
    run: async (ctx) => {
      const username = cleanUsername(ctx.require('username'));
      const postLimit = intIn(ctx.config.tweets ?? ctx.config.limit, 40, 5, 100);
      const owner = ownerOf(ctx);
      const client = await ctx.http();
      const { scrapeTweets } = await x.tweets();

      const profile = await readTarget(ctx, username);
      ctx.progress(`Reading @${username}'s recent posts`);
      const tweets = await scrapeTweets(client, username, { limit: postLimit });
      const own = tweets.filter((t) => !t.isRetweet && t.createdAt);

      const counts = (items) => {
        const tally = new Map();
        for (const item of items) tally.set(item, (tally.get(item) || 0) + 1);
        return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, count]) => ({ value, count }));
      };
      const times = own.map((t) => Date.parse(t.createdAt)).sort((a, b) => a - b);
      const spanDays = times.length > 1 ? (times.at(-1) - times[0]) / DAY_MS : null;
      const linkDomains = own.flatMap((t) => (t.urls || []).map((u) => {
        try {
          return new URL(u.expandedUrl).hostname.replace(/^www\./, '');
        } catch {
          return null;
        }
      })).filter(Boolean);

      const enrichment = {
        contact: {
          emails: [...new Set((profile.bio || '').match(EMAIL) || [])],
          website: profile.website || null,
          bioLinks: (profile.bioEntities?.urls || []).map((u) => u.expanded).filter(Boolean),
          location: profile.location || null,
        },
        activity: {
          postsRead: own.length,
          lastPostAt: times.length ? new Date(times.at(-1)).toISOString() : null,
          postsPerDay: spanDays ? round2(own.length / spanDays) : null,
          replyShare: own.length ? percent(own.filter((t) => t.isReply).length, own.length) : null,
          avgEngagements: own.length ? Math.round(own.reduce((s, t) => s + engagementOf(t.metrics || {}), 0) / own.length) : 0,
          avgImpressions: own.length ? Math.round(own.reduce((s, t) => s + (t.metrics?.views || 0), 0) / own.length) : 0,
        },
        interests: {
          hashtags: counts(own.flatMap((t) => (t.hashtags || []).map((h) => h.toLowerCase()))),
          mentions: counts(own.flatMap((t) => (t.mentions || []).map((m) => (m.username || '').toLowerCase()).filter(Boolean))),
          linkDomains: counts(linkDomains),
          languages: counts(own.map((t) => t.lang).filter(Boolean)),
        },
        enrichedAt: nowIso(),
      };
      const db = await store();
      const lead = saveLead(db, owner, { profile, profiled: true, source: 'enrich', enrichment });
      return { success: true, username, profile: profileSummary(profile), enrichment, score: lead.score, lead };
    },
    concurrency: 2,
    description: 'Add contact details, activity and interests to a lead',
  },

  // ── Ads ──
  adsDashboard: {
    run: async (ctx) => {
      const { capture, accountId } = await adsCapture(ctx);
      return {
        success: true,
        accountId,
        url: capture.finalUrl,
        title: capture.title,
        sections: capture.headings,
        tables: capture.tables.map((t) => ({ headers: t.headers, records: tableRecords(t) })),
        campaigns: campaignsOf(capture),
        collections: findCollections(capture.payloads, /campaign|line_?item|funding|promoted|account/i),
        api: apiSummary(capture.payloads),
        capturedAt: nowIso(),
      };
    },
    concurrency: 1,
    description: 'Read the ads.x.com dashboard as the session',
  },

  adsCampaigns: {
    run: async (ctx) => {
      onlyListAction(ctx, 'ad campaigns');
      const { capture, accountId } = await adsCapture(ctx);
      const campaigns = campaignsOf(capture);
      return {
        success: true,
        action: 'list',
        accountId,
        url: capture.finalUrl,
        count: campaigns.rows.length || campaigns.collections.reduce((s, c) => s + c.count, 0),
        campaigns: campaigns.rows,
        collections: campaigns.collections,
        capturedAt: nowIso(),
      };
    },
    concurrency: 1,
    description: 'List ad campaigns from ads.x.com',
  },

  adsAnalytics: {
    run: async (ctx) => {
      const { campaignId, dateRange } = ctx.config;
      if (dateRange !== undefined && dateRange !== null && dateRange !== '') {
        throw new JobInputError('dateRange cannot be applied: ads.x.com reports the date range selected in its own app. Omit dateRange to read that view.');
      }
      const { capture, accountId } = await adsCapture(ctx);
      const campaigns = campaignsOf(capture);
      const matches = (record) => JSON.stringify(record).includes(String(campaignId));
      const rows = campaignId ? campaigns.rows.filter(matches) : campaigns.rows;
      const collections = campaignId
        ? campaigns.collections.map((c) => ({ ...c, items: c.items.filter(matches) })).filter((c) => c.items.length)
        : campaigns.collections;
      if (campaignId && !rows.length && !collections.length) {
        throw new JobInputError(`Campaign ${campaignId} is not in the campaign list of ads account ${accountId ?? 'shown at ' + capture.finalUrl}`);
      }
      return {
        success: true,
        accountId,
        campaignId: campaignId ?? null,
        url: capture.finalUrl,
        metrics: rows,
        collections,
        metricCollections: findCollections(capture.payloads, /metric|stat|analytic/i),
        capturedAt: nowIso(),
      };
    },
    concurrency: 1,
    description: 'Campaign performance as ads.x.com reports it',
  },

  adsMediaStudio: {
    run: async (ctx) => {
      onlyListAction(ctx, 'Media Studio');
      const capture = await captureWebApp(ctx, 'https://studio.x.com/library');
      if (!hostOf(capture.finalUrl).startsWith('studio.')) {
        throw new JobInputError(`Media Studio sent this account to ${capture.finalUrl}: the account has no access to Media Studio.`);
      }
      const collections = findCollections(capture.payloads, /media|librar|item|video|image/i);
      return {
        success: true,
        action: 'list',
        url: capture.finalUrl,
        count: collections.reduce((s, c) => s + c.count, 0),
        media: collections,
        tables: capture.tables.map((t) => ({ headers: t.headers, records: tableRecords(t) })),
        sections: capture.headings,
        capturedAt: nowIso(),
      };
    },
    concurrency: 1,
    description: 'List the Media Studio library',
  },

  // ── X Pro ──
  xproDashboard: {
    run: async (ctx) => {
      const { url, columns, decks, capture } = await xproCapture(ctx);
      return {
        success: true,
        url,
        title: capture.title,
        columns,
        decks,
        api: apiSummary(capture.payloads),
        capturedAt: nowIso(),
      };
    },
    concurrency: 1,
    description: "Read the account's X Pro deck and its columns",
  },

  xproColumns: {
    run: async (ctx) => {
      onlyListAction(ctx, 'X Pro columns');
      const { url, columns, decks } = await xproCapture(ctx);
      return { success: true, action: 'list', url, count: columns.length, columns, decks, capturedAt: nowIso() };
    },
    concurrency: 1,
    description: 'List the columns on the account\'s X Pro deck',
  },
};
