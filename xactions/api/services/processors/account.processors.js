// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Account processors: profile, settings, privacy lists, Premium status,
 * account backup and audit, sessions, connected apps, and profile QR codes.
 *
 * Everything here goes through the session's own X web API (the HTTP client
 * from the job context): `account/settings.json` for settings and the
 * protected flag, `account/update_profile*.json` for the profile,
 * `mutes/advanced_filters.json` for the notification filters, and the GraphQL
 * timelines x.com's settings pages read (BlockedAccountsAll, MutedAccounts,
 * UserSessionsList, Followers, Likes, Bookmarks). Only the delegate member
 * list, which x.com's client serves through no API this repo tracks, is read
 * from the rendered settings page.
 *
 * Operations X does not let a session perform (paying for or gifting
 * Premium, requesting the data archive behind a password and emailed code,
 * uploading an address book, filing a suspension appeal) have no processor
 * and no route.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import dns from 'node:dns';
import net from 'node:net';
import { JobInputError } from './context.js';
import { GRAPHQL, resolveGraphQL, operationFeatures, DEFAULT_FEATURES } from '../../../src/scrapers/twitter/http/endpoints.js';
import { paginate, flattenEntries } from '../../../src/scrapers/twitter/http/paging.js';
import { parseUserData } from '../../../src/scrapers/twitter/http/parse/user.js';
import { parseTimelineInstructions } from '../../../src/scrapers/twitter/http/parse/tweet.js';
import { scrapeTweets } from '../../../src/scrapers/twitter/http/tweets.js';
import { blockUser } from '../../../src/scrapers/twitter/http/engagement.js';
import { mimeFromBuffer } from '../../../src/scrapers/twitter/http/media.js';
import { AuthError, NotFoundError, TwitterApiError } from '../../../src/scrapers/twitter/http/errors.js';

const REST_WEB_BASE = 'https://x.com/i/api';
const DAY_MS = 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;

/** Profile field limits x.com enforces on account/update_profile.json. */
const PROFILE_LIMITS = { name: 50, description: 160, location: 30, url: 100 };
/** account/update_profile_image.json refuses images of 700 KB or more. */
const AVATAR_MAX_BYTES = 700 * 1024;
/** account/update_profile_banner.json accepts up to 5 MB. */
const BANNER_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

const BACKUP_SECTIONS = ['tweets', 'likes', 'bookmarks', 'followers', 'following'];

/**
 * Settings account/settings.json accepts, with the value each takes. Keys are
 * X's own; `aliases` lets callers send the camelCase form.
 */
const SETTINGS_SCHEMA = {
  protected: { type: 'boolean', alias: 'protected' },
  allow_dms_from: { type: ['all', 'following', 'verified'], alias: 'allowDmsFrom' },
  allow_dm_groups_from: { type: ['all', 'following'], alias: 'allowDmGroupsFrom' },
  allow_media_tagging: { type: ['all', 'following', 'none'], alias: 'allowMediaTagging' },
  dm_receipt_setting: { type: ['all_enabled', 'all_disabled'], alias: 'dmReceiptSetting' },
  dm_quality_filter: { type: ['enabled', 'disabled'], alias: 'dmQualityFilter' },
  discoverable_by_email: { type: 'boolean', alias: 'discoverableByEmail' },
  discoverable_by_mobile_phone: { type: 'boolean', alias: 'discoverableByMobilePhone' },
  display_sensitive_media: { type: 'boolean', alias: 'displaySensitiveMedia' },
  nsfw_user: { type: 'boolean', alias: 'nsfwUser' },
  geo_enabled: { type: 'boolean', alias: 'geoEnabled' },
  personalized_trends: { type: 'boolean', alias: 'personalizedTrends' },
  allow_ads_personalization: { type: 'boolean', alias: 'allowAdsPersonalization' },
  allow_logged_out_device_personalization: { type: 'boolean', alias: 'allowLoggedOutDevicePersonalization' },
  allow_location_history_personalization: { type: 'boolean', alias: 'allowLocationHistoryPersonalization' },
  allow_sharing_data_for_third_party_personalization: { type: 'boolean', alias: 'allowSharingDataForThirdPartyPersonalization' },
  use_cookie_personalization: { type: 'boolean', alias: 'useCookiePersonalization' },
  lang: { type: 'string', alias: 'language' },
  time_zone: { type: 'string', alias: 'timeZone' },
  trend_location_woeid: { type: 'integer', alias: 'trendLocationWoeid' },
};

/** Muted-notification filters (Settings, Notifications, Filters, Muted notifications). */
const ADVANCED_FILTERS_SCHEMA = {
  filter_not_following: { type: 'boolean', alias: 'notFollowing' },
  filter_not_followed_by: { type: 'boolean', alias: 'notFollowedBy' },
  filter_new_users: { type: 'boolean', alias: 'newUsers' },
  filter_default_profile_image: { type: 'boolean', alias: 'defaultProfileImage' },
  filter_no_confirmed_email: { type: 'boolean', alias: 'noConfirmedEmail' },
  filter_no_confirmed_phone: { type: 'boolean', alias: 'noConfirmedPhone' },
};

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

/** A screen name from `@name`, `name`, or a profile URL. */
function cleanUsername(value, label = 'username') {
  const raw = String(value ?? '').trim();
  const fromUrl = raw.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/?#]+)/i)?.[1];
  const name = (fromUrl ?? raw).replace(/^@/, '');
  if (!USERNAME_RE.test(name)) throw new JobInputError(`${label} "${raw}" is not a valid X username`);
  return name;
}

/** A positive integer within bounds, or the default when absent. */
function boundedInt(value, fallback, max, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) throw new JobInputError(`${label} must be a positive integer`);
  return Math.min(n, max);
}

function toBoolean(value, label) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw new JobInputError(`${label} must be true or false`);
}

/**
 * Pick the fields of `schema` present in `source` (by X key or camelCase
 * alias), validated and in the form X's form endpoints take.
 *
 * @returns {{ values: Record<string, string|number|boolean>, ignored: string[] }}
 */
function pickSchemaFields(source, schema) {
  const values = {};
  const known = new Set();
  for (const [key, spec] of Object.entries(schema)) {
    known.add(key);
    known.add(spec.alias);
    const value = source[key] !== undefined ? source[key] : source[spec.alias];
    if (value === undefined || value === null) continue;
    if (spec.type === 'boolean') values[key] = toBoolean(value, key);
    else if (spec.type === 'integer') values[key] = boundedInt(value, undefined, Number.MAX_SAFE_INTEGER, key);
    else if (spec.type === 'string') {
      if (typeof value !== 'string' || !value.trim()) throw new JobInputError(`${key} must be a non-empty string`);
      values[key] = value.trim();
    } else if (!spec.type.includes(value)) {
      throw new JobInputError(`${key} must be one of: ${spec.type.join(', ')}`);
    } else values[key] = value;
  }
  const envelope = new Set(['session', 'sessionCookie', 'authToken', 'cookie', 'settings', 'filters', 'action']);
  const ignored = Object.keys(source).filter((k) => !known.has(k) && !envelope.has(k));
  return { values, ignored };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const header = columns.map(([name]) => name).join(',');
  const lines = rows.map((row) => columns.map(([, get]) => csvEscape(get(row))).join(','));
  return [header, ...lines].join('\n');
}

const USER_COLUMNS = [
  ['id', (u) => u.id],
  ['username', (u) => u.username],
  ['name', (u) => u.name],
  ['followers', (u) => u.followers],
  ['following', (u) => u.following],
  ['posts', (u) => u.tweets],
  ['verified', (u) => u.verified],
  ['protected', (u) => u.protected],
  ['joined', (u) => u.joined],
  ['bio', (u) => u.bio],
];

const TWEET_COLUMNS = [
  ['id', (t) => t.id],
  ['createdAt', (t) => t.createdAt],
  ['author', (t) => t.author?.username],
  ['text', (t) => t.text],
  ['likes', (t) => t.metrics?.likes],
  ['reposts', (t) => t.metrics?.retweets],
  ['replies', (t) => t.metrics?.replies],
  ['views', (t) => t.metrics?.views],
  ['url', (t) => (t.id && t.author?.username ? `https://x.com/${t.author.username}/status/${t.id}` : '')],
];

// ---------------------------------------------------------------------------
// X access helpers
// ---------------------------------------------------------------------------

/** An error retrying cannot fix (the account lacks a feature, X said no). */
function permanent(err) {
  err.retryable = false;
  return err;
}

/**
 * Call one of x.com's v1.1 REST endpoints and surface an `errors` array as a
 * failure instead of a result.
 */
async function xRest(client, path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const json = await client.rest(`${path}${qs}`, { method, body });
  if (Array.isArray(json?.errors) && json.errors.length) {
    const message = json.errors.map((e) => e.message || `code ${e.code}`).join('; ');
    throw permanent(new TwitterApiError(`X rejected ${path}: ${message}`, { endpoint: path, data: json }));
  }
  return json ?? {};
}

/**
 * POST a form (account/update_profile_banner.json answers success with an
 * empty body, which the client reads as `{}`). A refusal is final.
 */
async function postForm(client, path, body) {
  let json;
  try {
    json = await client.request(`${REST_WEB_BASE}${path}`, { method: 'POST', body: new URLSearchParams(body) });
  } catch (err) {
    if (err instanceof TwitterApiError) {
      const message = err.data?.errors?.map((e) => e.message).join('; ') || `HTTP ${err.status}`;
      throw permanent(new TwitterApiError(`X rejected ${path}: ${message}`, { status: err.status, endpoint: path, data: err.data }));
    }
    throw err;
  }
  if (json.errors?.length) {
    const message = json.errors.map((e) => e.message).join('; ');
    throw permanent(new TwitterApiError(`X rejected ${path}: ${message}`, { endpoint: path, data: json }));
  }
  return json;
}

/** The session's own account settings (account/settings.json). */
async function readSettings(client) {
  const settings = await xRest(client, '/1.1/account/settings.json');
  if (!settings.screen_name) {
    throw new TwitterApiError('X answered account/settings.json without the account screen name', { data: settings });
  }
  return settings;
}

/** The raw GraphQL user result for a screen name. */
async function rawUser(client, username) {
  const { queryId, operationName } = resolveGraphQL('UserByScreenName');
  const response = await client.graphql(queryId, operationName, { screen_name: username, withSafetyModeUserFields: true }, { features: DEFAULT_FEATURES });
  const result = response?.data?.user?.result;
  if (!result) throw permanent(new NotFoundError(`User @${username} not found`));
  if (result.__typename === 'UserUnavailable') {
    throw permanent(new NotFoundError(`User @${username} is unavailable: ${result.reason || result.message || 'suspended or deactivated'}`));
  }
  return result;
}

/** The session's own account: screen name from settings, full user from GraphQL. */
async function ownAccount(client) {
  const settings = await readSettings(client);
  const raw = await rawUser(client, settings.screen_name);
  return { settings, raw, profile: parseUserData(raw) };
}

/** Parse a user timeline page (Followers, BlockedAccountsAll, MutedAccounts, ...). */
function usersFromInstructions(instructions) {
  const { entries, cursor } = flattenEntries(instructions);
  const items = [];
  for (const entry of entries) {
    const raw = entry.content?.itemContent?.user_results?.result;
    if (!raw || raw.__typename === 'UserUnavailable') continue;
    const user = parseUserData(raw);
    if (!user.username) continue;
    user.defaultAvatar = Boolean(raw.legacy?.default_profile_image) || /default_profile_images/.test(user.avatar || '');
    items.push(user);
  }
  return { items, cursor };
}

function tweetsFromInstructions(instructions) {
  const { tweets, cursor } = parseTimelineInstructions(instructions);
  return { items: tweets, cursor };
}

/**
 * Page a GraphQL user list. Operations the codebase does not track are sent
 * exactly the feature switches x.com's client declares for them.
 */
function pageUsers(ctx, client, key, variables, limit, label) {
  const untracked = !(key in GRAPHQL);
  return paginate(client, resolveGraphQL(key), variables, usersFromInstructions, {
    limit,
    keyOf: (u) => u.id ?? u.username,
    ...(untracked ? { features: operationFeatures(key) } : {}),
    onProgress: ({ fetched }) => ctx.progress(`${label}: ${fetched} of up to ${limit}`, { fetched, limit }),
  });
}

function pageTweets(ctx, client, key, variables, limit, label) {
  return paginate(client, resolveGraphQL(key), variables, tweetsFromInstructions, {
    limit,
    onProgress: ({ fetched }) => ctx.progress(`${label}: ${fetched} of up to ${limit}`, { fetched, limit }),
  });
}

/**
 * X answering an empty list for an account whose profile counts say it has
 * some is a failed read, not a result.
 */
function assertNotSilentlyEmpty(items, expected, label) {
  if (items.length === 0 && expected > 0) {
    throw new TwitterApiError(`X returned no ${label} although the profile reports ${expected}`);
  }
  return items;
}

/** First array of objects anywhere in a payload (breadth first). */
function firstObjectArray(payload) {
  const queue = [payload];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      if (node.length && node.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return node;
      queue.push(...node);
      continue;
    }
    queue.push(...Object.values(node));
  }
  return null;
}

function isoFromMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Premium status (read from the account's own GraphQL user record)
// ---------------------------------------------------------------------------

function premiumStatus(raw) {
  const legacy = raw.legacy || {};
  const blueVerified = Boolean(raw.is_blue_verified);
  const verifiedType = raw.verification?.verified_type ?? legacy.verified_type ?? null;
  const tier =
    verifiedType === 'Business'
      ? 'verified-organization'
      : verifiedType === 'Government'
        ? 'government'
        : blueVerified
          ? 'premium'
          : 'none';
  const highlights = raw.highlights_info;
  return {
    id: raw.rest_id ?? null,
    username: raw.core?.screen_name ?? legacy.screen_name ?? null,
    hasPremium: blueVerified || Boolean(verifiedType),
    tier,
    blueVerified,
    verified: Boolean(raw.verification?.verified ?? legacy.verified ?? blueVerified),
    verifiedType,
    identityVerified: raw.verification_info?.is_identity_verified ?? null,
    verifiedSince: isoFromMs(raw.verification_info?.reason?.verified_since_msec),
    affiliation: raw.affiliates_highlighted_label?.label?.description ?? null,
    canHighlightPosts: highlights?.can_highlight_tweets ?? null,
    highlightedPosts: highlights ? Number(highlights.highlighted_tweets ?? 0) : null,
    creatorSubscriptions: raw.creator_subscriptions_count ?? null,
    superFollowEligible: raw.super_follow_eligible ?? null,
    premiumGiftingEligible: raw.premium_gifting_eligible ?? null,
    professional: raw.professional
      ? {
          type: raw.professional.professional_type ?? null,
          categories: (raw.professional.category || []).map((c) => c.name).filter(Boolean),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Follower audit
// ---------------------------------------------------------------------------

/** Heuristic bot signals for one follower, 0 to 100. */
function botSignals(user, now) {
  const signals = [];
  let score = 0;
  const add = (signal, weight) => {
    signals.push(signal);
    score += weight;
  };
  if (user.defaultAvatar) add('default_avatar', 25);
  if (!user.bio || user.bio.trim().length < 10) add('empty_bio', 15);
  if (user.tweets < 5) add('almost_no_posts', 15);
  if (user.following > 100 && user.following > user.followers * 10) add('follows_far_more_than_followed', 20);
  if (user.followers < 5) add('almost_no_followers', 10);
  const joined = Date.parse(user.joined || '');
  if (Number.isFinite(joined) && now - joined < 30 * DAY_MS) add('new_account', 15);
  if (/\d{5,}$/.test(user.username)) add('numeric_handle', 10);
  return { score: Math.min(100, score), signals };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------------------------------------------------------------------------
// Outbound fetches outside x.com (profile images, QR codes)
// ---------------------------------------------------------------------------

const PRIVATE_RANGES = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) PRIVATE_RANGES.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  PRIVATE_RANGES.addSubnet(addr, prefix, 'ipv6');
}

function isPrivateAddress(address) {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return PRIVATE_RANGES.check(mapped, 'ipv4');
  return PRIVATE_RANGES.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

/** Refuse a URL whose host resolves inside a private or loopback network. */
async function assertPublicHost(hostname, lookup, label) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new JobInputError(`${label} must point to a public host`);
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new JobInputError(`${label} must point to a public host`);
  }
}

/**
 * Download an image a caller named by URL, following at most three redirects
 * and re-checking every hop, so a profile update can never be used to reach
 * the server's own network.
 */
async function downloadImage(deps, rawUrl, { maxBytes, label }) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new JobInputError(`${label} is not a valid URL`);
  }
  for (let hop = 0; hop <= 3; hop++) {
    if (url.protocol !== 'https:') throw new JobInputError(`${label} must be an https URL`);
    await assertPublicHost(url.hostname, deps.lookup, label);
    const res = await deps.fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.get?.('location');
      if (!location) throw new JobInputError(`${label} redirected without a location`);
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new JobInputError(`${label} answered HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new JobInputError(`${label} is ${Math.ceil(buffer.length / 1024)} KB; X accepts at most ${Math.floor(maxBytes / 1024)} KB`);
    }
    const mime = mimeFromBuffer(buffer);
    if (!PROFILE_IMAGE_TYPES.includes(mime)) throw new JobInputError(`${label} must be a JPEG, PNG or GIF image`);
    return { buffer, mime };
  }
  throw new JobInputError(`${label} redirected too many times`);
}

// ---------------------------------------------------------------------------
// Shared operations (several routes queue the same work under different names)
// ---------------------------------------------------------------------------

async function getSettingsOp(ctx) {
  const client = await ctx.http();
  ctx.progress('Reading account settings');
  const settings = await readSettings(client);
  return { success: true, username: settings.screen_name, settings };
}

async function setProtectedOp(ctx) {
  if (ctx.config.enabled === undefined) throw new JobInputError('enabled (boolean) is required');
  const enabled = toBoolean(ctx.config.enabled, 'enabled');
  const client = await ctx.http();
  ctx.progress(`${enabled ? 'Protecting' : 'Unprotecting'} posts`);
  const answer = await xRest(client, '/1.1/account/settings.json', { method: 'POST', body: { protected: enabled } });
  const confirmed = typeof answer.protected === 'boolean' ? answer : await readSettings(client);
  if (confirmed.protected !== enabled) {
    throw permanent(new TwitterApiError(`X kept the account ${confirmed.protected ? 'protected' : 'public'}`, { data: confirmed }));
  }
  return {
    success: true,
    username: confirmed.screen_name ?? null,
    protected: confirmed.protected,
    message: `Posts are now ${enabled ? 'protected' : 'public'}`,
  };
}

function relationshipListOp(key, label, defaultLimit) {
  return async (ctx) => {
    const limit = boundedInt(ctx.config.limit, defaultLimit, 5000, 'limit');
    const client = await ctx.http();
    ctx.progress(`Reading ${label}`);
    const accounts = await pageUsers(ctx, client, key, { includePromotedContent: false, withSafetyModeUserFields: false }, limit, label);
    return { success: true, count: accounts.length, limit, truncated: accounts.length >= limit, accounts };
  };
}

async function updateProfileOp(ctx, deps) {
  const source = ctx.config.updates && typeof ctx.config.updates === 'object' ? ctx.config.updates : ctx.config;
  const fields = {
    name: source.name,
    description: source.bio ?? source.description,
    location: source.location,
    url: source.website ?? source.url,
  };
  const body = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text.length > PROFILE_LIMITS[key]) {
      throw new JobInputError(`${key === 'description' ? 'bio' : key === 'url' ? 'website' : key} is ${text.length} characters; X allows ${PROFILE_LIMITS[key]}`);
    }
    body[key] = text;
  }
  const avatarUrl = source.avatarUrl;
  const bannerUrl = source.bannerUrl;
  if (!Object.keys(body).length && !avatarUrl && !bannerUrl) {
    throw new JobInputError('At least one of name, bio, location, website, avatarUrl or bannerUrl is required');
  }

  // Download images before touching the profile, so a bad URL changes nothing.
  const avatar = avatarUrl ? await downloadImage(deps, avatarUrl, { maxBytes: AVATAR_MAX_BYTES, label: 'avatarUrl' }) : null;
  const banner = bannerUrl ? await downloadImage(deps, bannerUrl, { maxBytes: BANNER_MAX_BYTES, label: 'bannerUrl' }) : null;

  const client = await ctx.http();
  const updated = [];
  let user = null;
  if (Object.keys(body).length) {
    ctx.progress('Updating profile fields');
    user = await xRest(client, '/1.1/account/update_profile.json', { method: 'POST', body: { ...body, skip_status: 'true' } });
    updated.push(...Object.keys(body).map((k) => ({ description: 'bio', url: 'website' })[k] ?? k));
  }
  if (avatar) {
    ctx.throwIfCancelled();
    ctx.progress('Uploading avatar');
    user = await xRest(client, '/1.1/account/update_profile_image.json', {
      method: 'POST',
      body: { image: avatar.buffer.toString('base64'), skip_status: 'true' },
    });
    updated.push('avatar');
  }
  if (banner) {
    ctx.throwIfCancelled();
    ctx.progress('Uploading banner');
    await postForm(client, '/1.1/account/update_profile_banner.json', { banner: banner.buffer.toString('base64') });
    updated.push('banner');
  }

  const profile = user?.screen_name
    ? {
        username: user.screen_name,
        name: user.name ?? null,
        bio: user.description ?? null,
        location: user.location ?? null,
        website: user.entities?.url?.urls?.[0]?.expanded_url ?? user.url ?? null,
        avatar: user.profile_image_url_https ?? null,
      }
    : null;
  return { success: true, updated, profile };
}

async function blockListImport(ctx, client) {
  const raw = ctx.config.usernames ?? ctx.config.accounts ?? ctx.config.blockList;
  const list = typeof raw === 'string' ? raw.split(/[\s,]+/) : Array.isArray(raw) ? raw : [];
  const names = [...new Set(list.map((item) => (typeof item === 'object' && item ? item.username : item)).filter(Boolean).map((n) => cleanUsername(n, 'usernames entry')))];
  if (!names.length) throw new JobInputError('usernames (array or comma-separated list) is required to import a block list');
  const max = boundedInt(ctx.config.max ?? ctx.config.limit, 200, 1000, 'max');
  const targets = names.slice(0, max);
  const dryRun = ctx.config.dryRun === true || ctx.config.dryRun === 'true';
  const delayMs = Math.max(1000, boundedInt(ctx.config.delayMs, 2500, 60_000, 'delayMs'));

  const results = [];
  let stoppedReason = null;
  for (let i = 0; i < targets.length; i++) {
    ctx.throwIfCancelled();
    const username = targets[i];
    ctx.progress(`${dryRun ? 'Checking' : 'Blocking'} @${username} (${i + 1}/${targets.length})`, { done: i, total: targets.length });
    let user;
    try {
      user = await rawUser(client, username);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      results.push({ username, status: err instanceof NotFoundError ? 'not-found' : 'failed', error: err.message });
      continue;
    }
    const alreadyBlocked = Boolean(user.relationship_perspectives?.blocking ?? user.legacy?.blocking);
    if (alreadyBlocked) {
      results.push({ username, id: user.rest_id, status: 'already-blocked' });
      continue;
    }
    if (dryRun) {
      results.push({ username, id: user.rest_id, status: 'would-block' });
      continue;
    }
    try {
      await ctx.charge('block');
    } catch (err) {
      if (err.name !== 'ActionCapExceededError') throw err;
      stoppedReason = err.message;
      for (const rest of targets.slice(i)) results.push({ username: rest, status: 'skipped', error: 'daily block cap reached' });
      break;
    }
    try {
      await blockUser(client, user.rest_id);
      results.push({ username, id: user.rest_id, status: 'blocked' });
    } catch (err) {
      if (err instanceof AuthError) throw err;
      results.push({ username, id: user.rest_id, status: 'failed', error: err.message });
    }
    if (i < targets.length - 1) await ctx.sleep(delayMs);
  }

  const tally = (status) => results.filter((r) => r.status === status).length;
  return {
    success: true,
    action: 'import',
    dryRun,
    requested: names.length,
    processed: results.length,
    blocked: tally('blocked'),
    alreadyBlocked: tally('already-blocked'),
    wouldBlock: tally('would-block'),
    notFound: tally('not-found'),
    failed: tally('failed'),
    skippedOverMax: names.length - targets.length,
    stoppedReason,
    results,
  };
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

/**
 * Build the account processors. The defaults reach the real network; tests
 * pass the same fetch stub they give the job context.
 *
 * @param {object} [deps]
 * @param {typeof fetch} [deps.fetch] - for image downloads and QR rendering
 * @param {(host: string, opts: object) => Promise<Array<{address: string}>>} [deps.lookup] - DNS
 */
export function createAccountProcessors(deps = {}) {
  const io = {
    fetch: deps.fetch || ((...args) => globalThis.fetch(...args)),
    lookup: deps.lookup || ((host, opts) => dns.promises.lookup(host, opts)),
  };

  return {
    accountBackup: {
      description: 'Back up the account: posts, likes, bookmarks, followers, following',
      concurrency: 1,
      run: async (ctx) => {
        const requested = Array.isArray(ctx.config.include)
          ? ctx.config.include
          : String(ctx.config.include ?? BACKUP_SECTIONS.slice(0, 4).join(',')).split(',');
        const wanted = requested.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
        const include = BACKUP_SECTIONS.filter((s) => wanted.includes(s));
        if (!include.length) throw new JobInputError(`include must name at least one of: ${BACKUP_SECTIONS.join(', ')}`);
        const format = String(ctx.config.format ?? 'json').toLowerCase();
        if (!['json', 'csv'].includes(format)) throw new JobInputError('format must be json or csv');
        const limit = boundedInt(ctx.config.limit, 1000, 3200, 'limit');

        const client = await ctx.http();
        ctx.progress('Reading account');
        const { profile } = await ownAccount(client);

        const readers = {
          // No emptiness check: the profile's post count includes replies,
          // which the UserTweets timeline leaves out.
          tweets: () =>
            scrapeTweets(client, profile.username, {
              limit,
              onProgress: ({ fetched }) => ctx.progress(`posts: ${fetched} of up to ${limit}`, { fetched, limit }),
            }),
          likes: async () =>
            assertNotSilentlyEmpty(
              await pageTweets(ctx, client, 'UserLikes', {
                userId: profile.id,
                includePromotedContent: false,
                withClientEventToken: false,
                withBirdwatchNotes: false,
                withVoice: true,
              }, limit, 'likes'),
              profile.likes,
              'likes',
            ),
          bookmarks: () => pageTweets(ctx, client, 'BookmarkTimeline', { includePromotedContent: false }, limit, 'bookmarks'),
          followers: async () =>
            assertNotSilentlyEmpty(
              await pageUsers(ctx, client, 'Followers', { userId: profile.id, includePromotedContent: false }, limit, 'followers'),
              profile.followers,
              'followers',
            ),
          following: async () =>
            assertNotSilentlyEmpty(
              await pageUsers(ctx, client, 'Following', { userId: profile.id, includePromotedContent: false }, limit, 'following'),
              profile.following,
              'following',
            ),
        };

        const sections = {};
        const counts = {};
        for (const section of include) {
          ctx.throwIfCancelled();
          ctx.progress(`Backing up ${section}`);
          try {
            const items = await readers[section]();
            counts[section] = items.length;
            const columns = section === 'followers' || section === 'following' ? USER_COLUMNS : TWEET_COLUMNS;
            sections[section] = format === 'csv' ? { count: items.length, csv: toCsv(columns, items) } : { count: items.length, items };
          } catch (err) {
            if (err instanceof AuthError || err.name === 'JobCancelledError') throw err;
            sections[section] = { count: 0, error: err.message };
          }
        }
        const failed = include.filter((s) => sections[s].error);
        if (failed.length === include.length) {
          throw new TwitterApiError(`Backup failed for every section: ${failed.map((s) => `${s} (${sections[s].error})`).join('; ')}`);
        }
        return {
          success: true,
          username: profile.username,
          userId: profile.id,
          generatedAt: new Date().toISOString(),
          format,
          limitPerSection: limit,
          profile,
          counts,
          failedSections: failed,
          sections,
        };
      },
    },

    auditFollowers: {
      description: 'Audit an account’s followers for likely bots and inactive accounts',
      run: async (ctx) => {
        const limit = boundedInt(ctx.config.limit, 200, 2000, 'limit');
        const checkBots = ctx.config.checkBots === undefined ? true : toBoolean(ctx.config.checkBots, 'checkBots');
        const client = await ctx.http();
        const username = ctx.config.username ? cleanUsername(ctx.config.username) : (await readSettings(client)).screen_name;
        ctx.progress(`Reading @${username}`);
        const target = parseUserData(await rawUser(client, username));
        const followers = assertNotSilentlyEmpty(
          await pageUsers(ctx, client, 'Followers', { userId: target.id, includePromotedContent: false }, limit, 'followers'),
          target.followers,
          'followers',
        );

        const now = Date.now();
        const scored = followers.map((u) => ({ user: u, ...botSignals(u, now) }));
        const count = (fn) => followers.filter(fn).length;
        const summary = {
          audited: followers.length,
          totalFollowers: target.followers,
          verified: count((u) => u.verified),
          protected: count((u) => u.protected),
          defaultAvatar: count((u) => u.defaultAvatar),
          emptyBio: count((u) => !u.bio || u.bio.trim().length < 10),
          almostNoPosts: count((u) => u.tweets < 5),
          newAccounts: count((u) => Number.isFinite(Date.parse(u.joined || '')) && now - Date.parse(u.joined) < 30 * DAY_MS),
          medianFollowers: median(followers.map((u) => u.followers)),
          averageFollowers: followers.length ? Math.round(followers.reduce((s, u) => s + u.followers, 0) / followers.length) : 0,
        };

        const result = { success: true, username, userId: target.id, summary };
        if (checkBots) {
          const suspected = scored
            .filter((s) => s.score >= 50)
            .sort((a, b) => b.score - a.score)
            .map((s) => ({
              id: s.user.id,
              username: s.user.username,
              name: s.user.name,
              followers: s.user.followers,
              following: s.user.following,
              posts: s.user.tweets,
              joined: s.user.joined,
              botScore: s.score,
              signals: s.signals,
            }));
          result.bots = {
            method: 'Heuristic score from default avatar, empty bio, post count, follow ratio, follower count, account age and numeric handle; 50 or more is flagged.',
            flagged: suspected.length,
            flaggedPercent: followers.length ? Math.round((suspected.length / followers.length) * 1000) / 10 : 0,
            suspected,
          };
        }
        return result;
      },
    },

    delegateAccess: {
      description: 'List the members the account has delegated access to',
      run: async (ctx) => {
        const action = String(ctx.config.action ?? 'list');
        if (action !== 'list') throw new JobInputError('Only action "list" is supported');
        const page = await ctx.page();
        ctx.progress('Opening delegate settings');
        await page.goto('https://x.com/settings/delegate', { waitUntil: 'networkidle2', timeout: 45_000 });
        const landed = new URL(page.url());
        if (/\/login|\/i\/flow\/login/.test(landed.pathname)) {
          throw new AuthError('x.com sent the session to the login page; save a fresh session cookie');
        }
        if (!landed.pathname.startsWith('/settings/delegate')) {
          throw permanent(new TwitterApiError(`Delegation is not available on this account: x.com redirected /settings/delegate to ${landed.pathname}`));
        }
        await page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 20_000 });
        await page.waitForSelector('[data-testid="primaryColumn"] [data-testid="UserCell"]', { timeout: 8000 }).catch(() => null);
        const members = await page.evaluate(() => {
          const out = [];
          for (const cell of document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="UserCell"]')) {
            const link = [...cell.querySelectorAll('a[href^="/"]')].find((a) => /^\/[A-Za-z0-9_]{1,15}$/.test(a.getAttribute('href')));
            if (!link) continue;
            const username = link.getAttribute('href').slice(1);
            const lines = cell.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
            const name = lines[0] || username;
            const details = lines.filter((l) => l !== name && l !== `@${username}`);
            out.push({ username, name, details });
          }
          return out;
        });
        const seen = new Set();
        const unique = members.filter((m) => !seen.has(m.username.toLowerCase()) && seen.add(m.username.toLowerCase()));
        return { success: true, action, count: unique.length, members: unique };
      },
    },

    verifyIdentity: {
      description: 'Report whether the account has passed X ID verification',
      run: async (ctx) => {
        const client = await ctx.http();
        ctx.progress('Reading verification status');
        const { raw } = await ownAccount(client);
        const status = premiumStatus(raw);
        return {
          success: true,
          username: status.username,
          identityVerified: status.identityVerified === true,
          verifiedSince: status.verifiedSince,
          blueVerified: status.blueVerified,
          verifiedType: status.verifiedType,
        };
      },
    },

    multiAccount: {
      description: 'List the accounts signed in alongside this session',
      run: async (ctx) => {
        const action = String(ctx.config.action ?? 'list');
        if (action !== 'list') throw new JobInputError('Only action "list" is supported');
        const client = await ctx.http();
        const json = await xRest(client, '/1.1/account/multi/list.json');
        const users = Array.isArray(json) ? json : json.users ?? json.accounts;
        if (!Array.isArray(users)) {
          throw new TwitterApiError('X answered account/multi/list.json without an account list', { data: json });
        }
        const accounts = users.map((u) => ({
          id: String(u.user_id ?? u.id_str ?? u.id ?? '') || null,
          username: u.screen_name ?? u.username ?? null,
          name: u.name ?? null,
          avatar: u.avatar_image_url ?? u.profile_image_url_https ?? null,
          verified: Boolean(u.is_blue_verified ?? u.is_verified ?? u.verified),
          protected: Boolean(u.is_protected ?? u.protected),
          suspended: Boolean(u.is_suspended ?? u.suspended),
          sessionValid: u.is_auth_valid ?? null,
        }));
        return { success: true, action, count: accounts.length, accounts };
      },
    },

    joinDate: {
      description: 'When an account joined X',
      concurrency: 3,
      run: async (ctx) => {
        const username = cleanUsername(ctx.require('username'));
        const client = await ctx.http();
        const profile = parseUserData(await rawUser(client, username));
        if (!profile.joined) throw new TwitterApiError(`X returned no creation date for @${username}`);
        const ageDays = Math.floor((Date.now() - Date.parse(profile.joined)) / DAY_MS);
        return {
          success: true,
          username: profile.username,
          userId: profile.id,
          joinDate: profile.joined,
          accountAgeDays: ageDays,
          accountAgeYears: Math.round((ageDays / 365.25) * 10) / 10,
        };
      },
    },

    loginHistory: {
      description: 'Sessions signed in to the account (Settings, Security, Apps and sessions)',
      run: async (ctx) => {
        const client = await ctx.http();
        const { queryId, operationName } = resolveGraphQL('UserSessionsList');
        ctx.progress('Reading sessions');
        const response = await client.graphql(queryId, operationName, {}, { features: operationFeatures('UserSessionsList') });
        if (response.errors?.length) {
          throw new TwitterApiError(`X rejected UserSessionsList: ${response.errors.map((e) => e.message).join('; ')}`, { data: response });
        }
        const sessions = firstObjectArray(response.data);
        if (!sessions) throw new TwitterApiError('X returned no session list', { data: response });
        return { success: true, count: sessions.length, sessions };
      },
    },

    connectedAccounts: {
      description: 'Apps connected to the account (Settings, Security, Connected apps)',
      run: async (ctx) => {
        const client = await ctx.http();
        const json = await xRest(client, '/1.1/oauth/list.json');
        const apps = Array.isArray(json) ? json : json.applications ?? json.apps ?? json.data;
        if (!Array.isArray(apps)) throw new TwitterApiError('X answered oauth/list.json without an app list', { data: json });
        const connected = apps.map((a) => ({
          id: String(a.app_id ?? a.id_str ?? a.id ?? '') || null,
          name: a.name ?? a.app_name ?? null,
          description: a.description ?? null,
          url: a.url ?? a.website ?? null,
          organization: a.organization?.name ?? a.organization_name ?? null,
          permissions: a.access_level ?? a.permissions ?? null,
          connectedAt: a.approved_at ?? a.created_at ?? null,
          image: a.image_url ?? a.icon_url ?? null,
        }));
        return { success: true, count: connected.length, apps: connected };
      },
    },

    qrCode: {
      description: 'A QR code for an X profile',
      concurrency: 3,
      run: async (ctx) => {
        const size = boundedInt(ctx.config.size, 512, 1000, 'size');
        const client = await ctx.http();
        const username = ctx.config.username ? cleanUsername(ctx.config.username) : (await readSettings(client)).screen_name;
        const profile = parseUserData(await rawUser(client, username));
        const profileUrl = `https://x.com/${profile.username}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&format=png&margin=8&data=${encodeURIComponent(profileUrl)}`;
        ctx.progress('Rendering QR code');
        const res = await io.fetch(qrUrl, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`QR renderer answered HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (mimeFromBuffer(buffer) !== 'image/png') throw new Error('QR renderer did not return a PNG');
        return {
          success: true,
          username: profile.username,
          name: profile.name,
          profileUrl,
          qr: { format: 'png', size, bytes: buffer.length, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` },
        };
      },
    },

    premiumCheck: {
      description: 'Premium and verification status of an account',
      concurrency: 3,
      run: async (ctx) => {
        const client = await ctx.http();
        const username = ctx.config.username ? cleanUsername(ctx.config.username) : (await readSettings(client)).screen_name;
        return { success: true, premium: premiumStatus(await rawUser(client, username)) };
      },
    },

    premiumFeatures: {
      description: 'Premium features active on the session’s account',
      run: async (ctx) => {
        const client = await ctx.http();
        const { raw } = await ownAccount(client);
        const status = premiumStatus(raw);
        return {
          success: true,
          username: status.username,
          tier: status.tier,
          features: {
            checkmark: status.blueVerified || Boolean(status.verifiedType),
            identityVerified: status.identityVerified,
            highlights: status.canHighlightPosts,
            creatorSubscriptions: status.creatorSubscriptions === null ? null : status.creatorSubscriptions > 0,
            superFollows: status.superFollowEligible,
            giftPremium: status.premiumGiftingEligible,
            affiliateBadge: Boolean(status.affiliation),
            professionalProfile: Boolean(status.professional),
          },
          premium: status,
        };
      },
    },

    updateProfile: {
      description: 'Update profile name, bio, location, website, avatar and banner',
      write: true,
      run: (ctx) => updateProfileOp(ctx, io),
    },

    getAccountSettings: { description: 'Read account settings', concurrency: 3, run: getSettingsOp },
    settingsGet: { description: 'Read account settings', concurrency: 3, run: getSettingsOp },
    getSettings: { description: 'Read account settings', concurrency: 3, run: getSettingsOp },

    settingsUpdate: {
      description: 'Change account settings',
      write: true,
      run: async (ctx) => {
        const source = ctx.config.settings && typeof ctx.config.settings === 'object' ? ctx.config.settings : ctx.config;
        const { values, ignored } = pickSchemaFields(source, SETTINGS_SCHEMA);
        if (!Object.keys(values).length) {
          throw new JobInputError(`No recognised setting to change. Accepted: ${Object.keys(SETTINGS_SCHEMA).join(', ')}`);
        }
        const client = await ctx.http();
        ctx.progress(`Updating ${Object.keys(values).join(', ')}`);
        const settings = await xRest(client, '/1.1/account/settings.json', { method: 'POST', body: values });
        return { success: true, updated: values, ignored, settings };
      },
    },

    toggleProtectedTweets: { description: 'Protect or unprotect posts', write: true, run: setProtectedOp },
    toggleProtected: { description: 'Protect or unprotect posts', write: true, run: setProtectedOp },
    settingsProtected: { description: 'Protect or unprotect posts', write: true, run: setProtectedOp },

    getBlockedAccounts: { description: 'List blocked accounts', run: relationshipListOp('BlockedAccountsAll', 'blocked accounts', 100) },
    getBlocked: { description: 'List blocked accounts', run: relationshipListOp('BlockedAccountsAll', 'blocked accounts', 200) },
    settingsBlocked: { description: 'List blocked accounts', run: relationshipListOp('BlockedAccountsAll', 'blocked accounts', 1000) },
    getMuted: { description: 'List muted accounts', run: relationshipListOp('MutedAccounts', 'muted accounts', 200) },
    settingsMuted: { description: 'List muted accounts', run: relationshipListOp('MutedAccounts', 'muted accounts', 1000) },

    settingsAdvanced: {
      description: 'Read or change the muted-notification filters',
      write: true,
      run: async (ctx) => {
        const source = ctx.config.filters && typeof ctx.config.filters === 'object' ? ctx.config.filters : ctx.config;
        const { values, ignored } = pickSchemaFields(source, ADVANCED_FILTERS_SCHEMA);
        const client = await ctx.http();
        const path = '/1.1/mutes/advanced_filters.json';
        if (!Object.keys(values).length) {
          ctx.progress('Reading notification filters');
          return { success: true, changed: false, ignored, filters: await xRest(client, path) };
        }
        ctx.progress(`Updating ${Object.keys(values).join(', ')}`);
        const filters = await xRest(client, path, { method: 'POST', body: values });
        return { success: true, changed: true, updated: values, ignored, filters };
      },
    },

    settingsBlockList: {
      description: 'Export the block list, or import one by blocking each account',
      write: true,
      concurrency: 1,
      run: async (ctx) => {
        const action = String(ctx.config.action ?? 'export').toLowerCase();
        if (!['export', 'import'].includes(action)) throw new JobInputError('action must be export or import');
        const client = await ctx.http();
        if (action === 'import') return blockListImport(ctx, client);
        const format = String(ctx.config.format ?? 'json').toLowerCase();
        if (!['json', 'csv'].includes(format)) throw new JobInputError('format must be json or csv');
        const limit = boundedInt(ctx.config.limit, 1000, 5000, 'limit');
        const accounts = await pageUsers(ctx, client, 'BlockedAccountsAll', { includePromotedContent: false, withSafetyModeUserFields: false }, limit, 'blocked accounts');
        const base = { success: true, action, format, count: accounts.length, truncated: accounts.length >= limit, exportedAt: new Date().toISOString() };
        return format === 'csv' ? { ...base, csv: toCsv(USER_COLUMNS, accounts) } : { ...base, accounts };
      },
    },

    getProfile: {
      description: 'Read an X profile',
      concurrency: 3,
      run: async (ctx) => {
        const username = cleanUsername(ctx.require('username'));
        const client = await ctx.http();
        return { success: true, profile: parseUserData(await rawUser(client, username)) };
      },
    },
  };
}

export default createAccountProcessors();
