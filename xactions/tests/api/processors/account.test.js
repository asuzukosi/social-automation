// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the account processors (api/services/processors/account.processors.js).
 *
 * Nothing of ours is mocked. Each job runs through the real job context and
 * the real HTTP client; only the network is replaced, by a fetch that answers
 * the way x.com (and the QR renderer, and an image host) answer. The one
 * browser-driven processor gets a page object at the browser boundary.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createJobContext, JobInputError } from '../../../api/services/processors/context.js';
import { loadProcessors } from '../../../api/services/processors/registry.js';
import { createAccountProcessors } from '../../../api/services/processors/account.processors.js';

const SESSION = 'auth_token=tok; ct0=csrf';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const TWITTER_DATE = 'Wed Oct 10 20:19:24 +0000 2018';

// ---------------------------------------------------------------------------
// The network boundary
// ---------------------------------------------------------------------------

function response({ status = 200, json, bytes, text, headers = {} }) {
  const body = text ?? (json === undefined ? '' : JSON.stringify(json));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null, getSetCookie: () => [] },
    json: async () => (json === undefined ? JSON.parse(body) : json),
    text: async () => body,
    arrayBuffer: async () => {
      const buf = bytes ?? Buffer.from(body);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

/** A fetch that answers from `routes` ([predicate, handler] pairs) and records every call. */
function network(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url: u, method: init.method || 'GET', body: typeof init.body === 'string' ? new URLSearchParams(init.body) : null };
    calls.push(call);
    for (const [match, handler] of routes) {
      if (match(u, call)) return response(await handler(u, call));
    }
    return response({ status: 404, json: { errors: [{ message: `no fixture for ${u.pathname}` }] } });
  };
  return { fetch, calls };
}

const rest = (path, method) => (u, call) => u.pathname === `/i/api${path}` && (!method || call.method === method);
const gql = (op) => (u) => u.pathname.startsWith('/i/api/graphql/') && u.pathname.endsWith(`/${op}`);
const variablesOf = (call) => JSON.parse(call.url.searchParams.get('variables') ?? call.body?.get('variables') ?? '{}');

/**
 * Run one processor as the queue would.
 * @returns {Promise<{ result?: object, error?: Error, calls: object[], progress: object[] }>}
 */
async function exec(type, config, { routes = [], userId, caps, browser } = {}) {
  const net = network(routes);
  const processors = createAccountProcessors({ fetch: net.fetch, lookup: async () => [{ address: '203.0.113.10' }] });
  const progress = [];
  const data = { type, config: userId ? config : { session: SESSION, ...config }, ...(userId ? { userId } : { sessionHash: 'h1' }) };
  const ctx = createJobContext(
    { id: 'job-1', name: type, data, progress: (p) => progress.push(p) },
    { fetch: net.fetch, caps, browser, decrypt: async () => SESSION },
  );
  try {
    return { result: await processors[type].run(ctx), calls: net.calls, progress };
  } catch (error) {
    return { error, calls: net.calls, progress };
  } finally {
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Fixtures shaped like x.com's answers
// ---------------------------------------------------------------------------

function user({ id, username, name = username, followers = 100, following = 50, tweets = 200, likes = 30, bio = 'Builder of useful things online.', created = TWITTER_DATE, defaultAvatar = false, ...extra }) {
  return {
    __typename: 'User',
    rest_id: id,
    is_blue_verified: false,
    core: { screen_name: username, name, created_at: created },
    legacy: {
      description: bio,
      followers_count: followers,
      friends_count: following,
      statuses_count: tweets,
      favourites_count: likes,
      default_profile_image: defaultAvatar,
      profile_image_url_https: defaultAvatar
        ? 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png'
        : `https://pbs.twimg.com/profile_images/${id}/a_normal.jpg`,
    },
    ...extra,
  };
}

const profileAnswer = (result) => () => ({ json: { data: { user: { result } } } });

function userEntries(users, cursor) {
  const entries = users.map((u) => ({ entryId: `user-${u.rest_id}`, content: { itemContent: { user_results: { result: u } } } }));
  if (cursor) entries.push({ entryId: `cursor-bottom-${cursor}`, content: { value: cursor } });
  return [{ type: 'TimelineAddEntries', entries }];
}

function tweet(id, author, text) {
  return {
    __typename: 'Tweet',
    rest_id: id,
    core: { user_results: { result: author } },
    legacy: { full_text: text, created_at: TWITTER_DATE, favorite_count: 3, retweet_count: 1, reply_count: 0 },
  };
}

const settingsAnswer = (extra = {}) => ({
  json: { screen_name: 'owner', protected: false, allow_dms_from: 'all', discoverable_by_email: true, language: 'en', ...extra },
});

const OWNER = user({ id: '1', username: 'owner', followers: 3, following: 2, likes: 1 });

// ---------------------------------------------------------------------------

describe('account processors: registration', () => {
  it('registers every account type without clashing with another domain', async () => {
    const processors = await loadProcessors();
    for (const type of ['accountBackup', 'auditFollowers', 'getSettings', 'settingsBlockList', 'updateProfile', 'getProfile', 'qrCode']) {
      expect(processors.get(type)?.source).toBe('account.processors.js');
    }
    expect(processors.get('updateProfile').write).toBe(true);
    for (const removed of ['downloadData', 'settingsDownloadData', 'requestDataDownload', 'premiumGift', 'premiumSubscribe', 'uploadContacts', 'appealSuspension']) {
      expect(processors.has(removed)).toBe(false);
    }
  });
});

describe('settings', () => {
  it('reads account settings for an agent and for a dashboard user', async () => {
    const routes = [[rest('/1.1/account/settings.json', 'GET'), () => settingsAnswer()]];
    for (const type of ['settingsGet', 'getAccountSettings']) {
      const { result } = await exec(type, {}, { routes });
      expect(result).toMatchObject({ success: true, username: 'owner', settings: { allow_dms_from: 'all' } });
    }
    const dashboard = await exec('getSettings', {}, { routes, userId: 'u1' });
    expect(dashboard.result.settings.language).toBe('en');
    expect(dashboard.calls[0].url.href).toBe('https://x.com/i/api/1.1/account/settings.json');
  });

  it('fails when X rejects the session', async () => {
    const { error } = await exec('settingsGet', {}, { routes: [[rest('/1.1/account/settings.json'), () => ({ status: 401, json: {} })]] });
    expect(error.name).toBe('AuthError');
  });

  it('protects posts and confirms it from X\'s answer', async () => {
    const { result, calls } = await exec('toggleProtectedTweets', { enabled: true }, {
      routes: [[rest('/1.1/account/settings.json', 'POST'), () => settingsAnswer({ protected: true })]],
    });
    expect(calls[0].body.get('protected')).toBe('true');
    expect(result).toMatchObject({ success: true, protected: true });

    const kept = await exec('settingsProtected', { enabled: false }, {
      routes: [[rest('/1.1/account/settings.json', 'POST'), () => settingsAnswer({ protected: true })]],
    });
    expect(kept.error.message).toMatch(/kept the account protected/);

    const missing = await exec('toggleProtected', {}, { userId: 'u1' });
    expect(missing.error).toBeInstanceOf(JobInputError);
    expect(missing.calls).toHaveLength(0);
  });

  it('changes only recognised settings, accepting camelCase', async () => {
    const { result, calls } = await exec('settingsUpdate', { allowDmsFrom: 'following', discoverable_by_email: false, theme: 'dark' }, {
      routes: [[rest('/1.1/account/settings.json', 'POST'), () => settingsAnswer({ allow_dms_from: 'following', discoverable_by_email: false })]],
    });
    expect(Object.fromEntries(calls[0].body)).toEqual({ allow_dms_from: 'following', discoverable_by_email: 'false' });
    expect(result).toMatchObject({ updated: { allow_dms_from: 'following', discoverable_by_email: false }, ignored: ['theme'] });

    expect((await exec('settingsUpdate', { allow_dms_from: 'everyone' })).error.message).toMatch(/one of: all, following, verified/);
    expect((await exec('settingsUpdate', { theme: 'dark' })).error).toBeInstanceOf(JobInputError);
  });

  it('reads and changes the muted-notification filters', async () => {
    const filters = { filter_not_following: false, filter_new_users: true };
    const read = await exec('settingsAdvanced', {}, { routes: [[rest('/1.1/mutes/advanced_filters.json', 'GET'), () => ({ json: filters })]] });
    expect(read.result).toMatchObject({ changed: false, filters });

    const write = await exec('settingsAdvanced', { filters: { notFollowing: true } }, {
      routes: [[rest('/1.1/mutes/advanced_filters.json', 'POST'), (u, call) => ({ json: { ...filters, filter_not_following: call.body.get('filter_not_following') === 'true' } })]],
    });
    expect(write.result).toMatchObject({ changed: true, updated: { filter_not_following: true }, filters: { filter_not_following: true } });
  });
});

describe('profile', () => {
  const updated = { screen_name: 'owner', name: 'New Name', description: 'New bio', location: 'Earth', url: 'https://t.co/x', entities: { url: { urls: [{ expanded_url: 'https://example.org' }] } } };

  it('updates text fields from the AI route and the dashboard route', async () => {
    const routes = [[rest('/1.1/account/update_profile.json', 'POST'), () => ({ json: updated })]];
    const ai = await exec('updateProfile', { updates: { name: 'New Name', bio: 'New bio' } }, { routes });
    expect(ai.calls[0].body.get('name')).toBe('New Name');
    expect(ai.calls[0].body.get('description')).toBe('New bio');
    expect(ai.result).toMatchObject({ success: true, updated: ['name', 'bio'], profile: { bio: 'New bio', website: 'https://example.org' } });

    const dashboard = await exec('updateProfile', { location: 'Earth', website: 'https://example.org' }, { routes, userId: 'u1' });
    expect(Object.fromEntries(dashboard.calls[0].body)).toMatchObject({ location: 'Earth', url: 'https://example.org' });
    expect(dashboard.result.updated).toEqual(['location', 'website']);
  });

  it('refuses over-long fields and empty updates before calling X', async () => {
    const long = await exec('updateProfile', { name: 'x'.repeat(51) });
    expect(long.error.message).toMatch(/X allows 50/);
    expect((await exec('updateProfile', {})).error).toBeInstanceOf(JobInputError);
    expect(long.calls).toHaveLength(0);
  });

  it('uploads an avatar and a banner fetched from public https URLs', async () => {
    const { result, calls } = await exec('updateProfile', { updates: { avatarUrl: 'https://203.0.113.10/a.png', bannerUrl: 'https://img.example.org/b.png' } }, {
      routes: [
        [(u) => u.hostname === '203.0.113.10' || u.hostname === 'img.example.org', () => ({ bytes: PNG })],
        [rest('/1.1/account/update_profile_image.json', 'POST'), () => ({ json: updated })],
        [rest('/1.1/account/update_profile_banner.json', 'POST'), () => ({ status: 201, text: '' })],
      ],
    });
    expect(result.updated).toEqual(['avatar', 'banner']);
    const avatarCall = calls.find((c) => c.url.pathname.endsWith('update_profile_image.json'));
    expect(Buffer.from(avatarCall.body.get('image'), 'base64').equals(PNG)).toBe(true);
    expect(calls.filter((c) => c.url.pathname.endsWith('update_profile_banner.json'))).toHaveLength(1);
  });

  it('never fetches an image from a private network or over plain http', async () => {
    for (const avatarUrl of ['https://127.0.0.1/a.png', 'https://[::1]/a.png', 'http://203.0.113.10/a.png', 'https://localhost/a.png']) {
      const { error, calls } = await exec('updateProfile', { updates: { avatarUrl } });
      expect(error).toBeInstanceOf(JobInputError);
      expect(calls).toHaveLength(0);
    }
  });

  it('reads a profile for the dashboard', async () => {
    const { result } = await exec('getProfile', { username: '@owner' }, { userId: 'u1', routes: [[gql('UserByScreenName'), profileAnswer(OWNER)]] });
    expect(result.profile).toMatchObject({ id: '1', username: 'owner', followers: 3 });
    const gone = await exec('getProfile', { username: 'gone' }, { userId: 'u1', routes: [[gql('UserByScreenName'), profileAnswer({ __typename: 'UserUnavailable', reason: 'Suspended' })]] });
    expect(gone.error.message).toMatch(/unavailable: Suspended/);
    expect((await exec('getProfile', { username: 'not a name!' }, { userId: 'u1' })).error).toBeInstanceOf(JobInputError);
  });
});

describe('blocked and muted lists', () => {
  const a = user({ id: '10', username: 'alpha' });
  const b = user({ id: '11', username: 'beta' });
  const c = user({ id: '12', username: 'gamma' });

  it('pages the block list and honours the limit', async () => {
    const { result, calls } = await exec('getBlockedAccounts', { limit: 2 }, {
      routes: [[gql('BlockedAccountsAll'), (u, call) => ({
        json: { data: { viewer: { timeline: { timeline: { instructions: variablesOf(call).cursor ? userEntries([c]) : userEntries([a], 'next') } } } } },
      })]],
    });
    expect(result).toMatchObject({ count: 2, limit: 2, truncated: true });
    expect(result.accounts.map((x) => x.username)).toEqual(['alpha', 'gamma']);
    expect(variablesOf(calls[1]).cursor).toBe('next');
  });

  it('reads the muted list from the muting timeline', async () => {
    const { result } = await exec('settingsMuted', {}, {
      routes: [[gql('MutedAccounts'), () => ({ json: { data: { viewer: { muting_timeline: { timeline: { instructions: userEntries([b]) } } } } } })]],
    });
    expect(result.accounts.map((x) => x.username)).toEqual(['beta']);
  });

  it('exports the block list as CSV', async () => {
    const { result } = await exec('settingsBlockList', { format: 'csv' }, {
      routes: [[gql('BlockedAccountsAll'), () => ({ json: { data: { viewer: { timeline: { timeline: { instructions: userEntries([a, b]) } } } } } })]],
    });
    expect(result).toMatchObject({ action: 'export', count: 2 });
    expect(result.csv.split('\n')[0]).toBe('id,username,name,followers,following,posts,verified,protected,joined,bio');
    expect(result.csv).toMatch(/^10,alpha,/m);
  });

  it('imports a block list with a per-account outcome, charging each block', async () => {
    const charged = [];
    const caps = { checkAndRecord: (owner, cls, { count }) => charged.push([owner, cls, count]) };
    const profiles = {
      alpha: a,
      beta: user({ id: '11', username: 'beta', relationship_perspectives: { blocking: true } }),
    };
    const { result, calls } = await exec('settingsBlockList', { action: 'import', usernames: 'alpha, beta ghost', delayMs: 1000 }, {
      caps,
      routes: [
        [gql('UserByScreenName'), (u) => ({ json: { data: { user: { result: profiles[JSON.parse(u.searchParams.get('variables')).screen_name] } } } })],
        [rest('/1.1/blocks/create.json', 'POST'), () => ({ json: { id_str: '10' } })],
      ],
    });
    expect(result.results).toEqual([
      { username: 'alpha', id: '10', status: 'blocked' },
      { username: 'beta', id: '11', status: 'already-blocked' },
      { username: 'ghost', status: 'not-found', error: 'User @ghost not found' },
    ]);
    expect(charged).toEqual([['session:h1', 'block', 1]]);
    expect(calls.find((c) => c.url.pathname.endsWith('blocks/create.json')).body.get('user_id')).toBe('10');
  });

  it('stops an import at the daily cap and on dry runs writes nothing', async () => {
    const caps = { checkAndRecord: () => { throw Object.assign(new Error('block cap of 0 reached'), { name: 'ActionCapExceededError' }); } };
    const routes = [[gql('UserByScreenName'), () => ({ json: { data: { user: { result: user({ id: '10', username: 'alpha' }) } } } })]];
    const capped = await exec('settingsBlockList', { action: 'import', usernames: ['alpha', 'beta'] }, { caps, routes });
    expect(capped.result.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
    expect(capped.result.stoppedReason).toMatch(/cap/);

    const dry = await exec('settingsBlockList', { action: 'import', usernames: ['alpha'], dryRun: true }, { caps, routes });
    expect(dry.result).toMatchObject({ dryRun: true, wouldBlock: 1, blocked: 0 });
    expect((await exec('settingsBlockList', { action: 'import' })).error).toBeInstanceOf(JobInputError);
  });
});

describe('premium and verification', () => {
  const premium = user({
    id: '1',
    username: 'owner',
    is_blue_verified: true,
    verification: { verified: true },
    verification_info: { is_identity_verified: true, reason: { verified_since_msec: '1700000000000' } },
    highlights_info: { can_highlight_tweets: true, highlighted_tweets: '2' },
    creator_subscriptions_count: 4,
    premium_gifting_eligible: true,
    professional: { professional_type: 'Creator', category: [{ name: 'Engineer' }] },
  });
  const routes = [
    [rest('/1.1/account/settings.json'), () => settingsAnswer()],
    [gql('UserByScreenName'), profileAnswer(premium)],
  ];

  it('checks Premium status for a named account or the session', async () => {
    const named = await exec('premiumCheck', { username: 'owner' }, { routes });
    expect(named.result.premium).toMatchObject({
      hasPremium: true,
      tier: 'premium',
      identityVerified: true,
      verifiedSince: new Date(1700000000000).toISOString(),
      canHighlightPosts: true,
      highlightedPosts: 2,
      professional: { type: 'Creator', categories: ['Engineer'] },
    });
    expect(named.calls.some((c) => c.url.pathname.endsWith('settings.json'))).toBe(false);
    const own = await exec('premiumCheck', {}, { routes });
    expect(own.result.premium.username).toBe('owner');
  });

  it('lists the Premium features active on the account', async () => {
    const { result } = await exec('premiumFeatures', {}, { routes });
    expect(result.features).toMatchObject({ checkmark: true, highlights: true, creatorSubscriptions: true, giftPremium: true, professionalProfile: true });
  });

  it('reports ID verification status', async () => {
    const { result } = await exec('verifyIdentity', {}, { routes });
    expect(result).toMatchObject({ username: 'owner', identityVerified: true, blueVerified: true });
    const unverified = await exec('verifyIdentity', {}, { routes: [routes[0], [gql('UserByScreenName'), profileAnswer(OWNER)]] });
    expect(unverified.result.identityVerified).toBe(false);
  });

  it('reads a join date', async () => {
    const { result } = await exec('joinDate', { username: 'owner' }, { routes: [[gql('UserByScreenName'), profileAnswer(OWNER)]] });
    expect(result.joinDate).toBe(new Date(TWITTER_DATE).toISOString());
    expect(result.accountAgeDays).toBeGreaterThan(2500);
    expect((await exec('joinDate', {})).error).toBeInstanceOf(JobInputError);
  });
});

describe('account tools', () => {
  it('audits followers and flags likely bots', async () => {
    const target = user({ id: '1', username: 'owner', followers: 2 });
    const bot = user({ id: '20', username: 'user84736251', followers: 1, following: 900, tweets: 0, bio: '', defaultAvatar: true });
    const human = user({ id: '21', username: 'realperson' });
    const { result } = await exec('auditFollowers', { username: 'owner', limit: 50 }, {
      routes: [
        [gql('UserByScreenName'), profileAnswer(target)],
        [gql('Followers'), () => ({ json: { data: { user: { result: { timeline: { timeline: { instructions: userEntries([bot, human]) } } } } } } })],
      ],
    });
    expect(result.summary).toMatchObject({ audited: 2, defaultAvatar: 1, emptyBio: 1 });
    expect(result.bots.flagged).toBe(1);
    expect(result.bots.suspected[0]).toMatchObject({ username: 'user84736251', signals: expect.arrayContaining(['default_avatar', 'numeric_handle']) });
  });

  it('treats an empty follower list for an account with followers as a failure', async () => {
    const { error } = await exec('auditFollowers', { username: 'owner' }, {
      routes: [
        [gql('UserByScreenName'), profileAnswer(user({ id: '1', username: 'owner', followers: 40 }))],
        [gql('Followers'), () => ({ json: { data: { user: { result: { timeline: { timeline: { instructions: userEntries([]) } } } } } } })],
      ],
    });
    expect(error.message).toMatch(/no followers although the profile reports 40/);
  });

  it('backs up the chosen sections, recording a failed one instead of dropping the rest', async () => {
    const follower = user({ id: '30', username: 'fan' });
    const likedEntry = { entryId: 'tweet-99', content: { itemContent: { tweet_results: { result: tweet('99', OWNER, 'liked, with "quotes"') } } } };
    const liked = [{ type: 'TimelineAddEntries', entries: [likedEntry] }];
    const { result } = await exec('accountBackup', { include: ['followers', 'bookmarks', 'likes'], format: 'csv' }, {
      routes: [
        [rest('/1.1/account/settings.json'), () => settingsAnswer()],
        [gql('UserByScreenName'), profileAnswer(OWNER)],
        [gql('Followers'), () => ({ json: { data: { user: { result: { timeline: { timeline: { instructions: userEntries([follower]) } } } } } } })],
        [gql('Likes'), () => ({ json: { data: { user: { result: { timeline: { timeline: { instructions: liked } } } } } } })],
        [gql('Bookmarks'), () => ({ status: 400, json: { errors: [{ message: 'Bookmarks unavailable' }] } })],
      ],
    });
    expect(result.counts).toEqual({ likes: 1, followers: 1 });
    expect(result.failedSections).toEqual(['bookmarks']);
    expect(result.sections.followers.csv).toMatch(/^30,fan,/m);
    expect(result.sections.likes.csv).toMatch(/"liked, with ""quotes"""/);
    expect(result.sections.bookmarks.error).toMatch(/HTTP 400/);

    expect((await exec('accountBackup', { include: ['dms'] })).error).toBeInstanceOf(JobInputError);
    expect((await exec('accountBackup', { format: 'xml' })).error).toBeInstanceOf(JobInputError);
  });

  it('lists accounts signed in together', async () => {
    const { result } = await exec('multiAccount', {}, {
      routes: [[rest('/1.1/account/multi/list.json'), () => ({ json: { users: [{ user_id: 1, screen_name: 'owner', name: 'Owner', is_auth_valid: true }, { user_id: 2, screen_name: 'alt', is_suspended: true }] } })]],
    });
    expect(result.accounts).toEqual([
      expect.objectContaining({ id: '1', username: 'owner', sessionValid: true, suspended: false }),
      expect.objectContaining({ id: '2', username: 'alt', suspended: true }),
    ]);
    expect((await exec('multiAccount', { action: 'switch' })).error).toBeInstanceOf(JobInputError);
  });

  it('lists connected apps and sessions', async () => {
    const apps = await exec('connectedAccounts', {}, {
      routes: [[rest('/1.1/oauth/list.json'), () => ({ json: { applications: [{ app_id: '7', name: 'Scheduler', approved_at: '2025-01-01' }] } })]],
    });
    expect(apps.result.apps).toEqual([expect.objectContaining({ id: '7', name: 'Scheduler', connectedAt: '2025-01-01' })]);

    const sessions = [{ device: 'Chrome on Mac', location: 'Berlin', last_active: '2026-09-01' }];
    const history = await exec('loginHistory', {}, {
      routes: [[gql('UserSessionsList'), () => ({ json: { data: { viewer: { sessions } } } })]],
    });
    expect(history.result).toMatchObject({ count: 1, sessions });

    const none = await exec('loginHistory', {}, { routes: [[gql('UserSessionsList'), () => ({ json: { data: { viewer: {} } } })]] });
    expect(none.error.message).toMatch(/no session list/);
  });

  it('renders a profile QR code after confirming the account exists', async () => {
    const { result, calls } = await exec('qrCode', { username: 'owner', size: 300 }, {
      routes: [
        [gql('UserByScreenName'), profileAnswer(OWNER)],
        [(u) => u.hostname === 'api.qrserver.com', () => ({ bytes: PNG })],
      ],
    });
    expect(result).toMatchObject({ profileUrl: 'https://x.com/owner', qr: { format: 'png', size: 300 } });
    expect(result.qr.dataUrl).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(calls.at(-1).url.searchParams.get('data')).toBe('https://x.com/owner');

    const down = await exec('qrCode', { username: 'owner' }, {
      routes: [[gql('UserByScreenName'), profileAnswer(OWNER)], [(u) => u.hostname === 'api.qrserver.com', () => ({ status: 503, text: 'down' })]],
    });
    expect(down.error.message).toMatch(/HTTP 503/);
  });
});

describe('delegate access (browser)', () => {
  function browserAt(landedUrl, members) {
    const visited = [];
    const page = {
      goto: async (url) => visited.push(url),
      url: () => landedUrl,
      waitForSelector: async () => ({}),
      evaluate: async () => members,
      close: async () => {},
    };
    return { visited, browser: async () => ({ createPage: async () => page }) };
  }

  it('lists delegate members from the settings page', async () => {
    const { visited, browser } = browserAt('https://x.com/settings/delegate/members', [
      { username: 'editor', name: 'Ed', details: ['Can post'] },
      { username: 'Editor', name: 'Ed', details: ['Can post'] },
    ]);
    const { result } = await exec('delegateAccess', { action: 'list' }, { browser });
    expect(visited).toEqual(['https://x.com/settings/delegate']);
    expect(result).toMatchObject({ count: 1, members: [{ username: 'editor' }] });
  });

  it('fails clearly when the account has no delegation or the session is dead', async () => {
    const off = await exec('delegateAccess', {}, { browser: browserAt('https://x.com/settings/account', []).browser });
    expect(off.error.message).toMatch(/not available on this account/);
    const dead = await exec('delegateAccess', {}, { browser: browserAt('https://x.com/i/flow/login', []).browser });
    expect(dead.error.name).toBe('AuthError');
    expect((await exec('delegateAccess', { action: 'add' })).error).toBeInstanceOf(JobInputError);
  });
});
