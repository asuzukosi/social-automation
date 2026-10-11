// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the Communities, Community Notes and Spaces processors
 * (api/services/processors/community.processors.js).
 *
 * Only the network boundary is replaced: a fetch that answers the way x.com's
 * GraphQL API does (fixture shapes from tests/http-scraper/fixtures), and for
 * the one browser-read operation a Puppeteer-shaped page that emits x.com's
 * GraphQL responses. The HTTP client, parsers, job context and write-cap
 * ledger are the real ones.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import processors from '../../../api/services/processors/community.processors.js';
import { createJobContext, isPermanentFailure, JobInputError } from '../../../api/services/processors/context.js';
import { remaining } from '../../../src/mcp/action-caps.js';
import { AuthError, TwitterApiError } from '../../../src/scrapers/twitter/http/errors.js';
import {
  ALICE,
  BOB,
  CAROL,
  AUDIO_SPACE_RESPONSE,
  COMMUNITY_MEMBERSHIPS_RESPONSE,
  addEntries,
  cursorEntry,
  rawCommunity,
  rawTweet,
  tweetEntry,
} from '../../http-scraper/fixtures/coverage-responses.js';

const SESSION = 'auth_token=tok; ct0=csrf';
const OWNER = 'session:hash1';

// ---------------------------------------------------------------------------
// x.com at the network boundary
// ---------------------------------------------------------------------------

function reply(status, body) {
  return {
    status,
    ok: status < 400,
    headers: { get: () => null, getSetCookie: () => [] },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * A fetch that answers GraphQL operations by name and records each call.
 * A route value is a body, `{ status, body }`, or `(variables) => either`.
 */
function fakeX(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const op = u.pathname.split('/').pop();
    const body = init.body ? JSON.parse(init.body) : null;
    const variables = body?.variables ?? JSON.parse(u.searchParams.get('variables') || '{}');
    calls.push({ op, method: init.method || 'GET', variables });
    const route = routes[op];
    if (route === undefined) return reply(404, { errors: [{ message: `unexpected ${op}` }] });
    const out = typeof route === 'function' ? route(variables, calls) : route;
    return out && typeof out.status === 'number' ? reply(out.status, out.body) : reply(200, out);
  };
  return { fetch, calls, ops: () => calls.map((c) => c.op) };
}

function context(type, config, x, deps = {}) {
  const progress = [];
  const job = {
    id: `job-${type}`,
    name: type,
    data: { type, sessionHash: 'hash1', config: { session: SESSION, ...config } },
    progress: (p) => progress.push(p),
  };
  const ctx = createJobContext(job, { fetch: x.fetch, ...deps });
  return { ctx, progress };
}

const run = (type, config, x, deps) => processors[type].run(context(type, config, x, deps).ctx);

const used = (cls) => remaining(OWNER).classes[cls].used;

const byId = (community) => ({ data: { communityResults: { result: community } } });

function communityEntry(community) {
  return {
    entryId: `community-${community.rest_id}`,
    content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineCommunity', community_results: { result: community } } },
  };
}

function listResponse(communities, rootKey = 'viewer') {
  return {
    data: {
      [rootKey]: {
        explore_communities_timeline: { timeline: { instructions: addEntries(communities.map(communityEntry)) } },
      },
    },
  };
}

function postInCommunity(id, author, text, community) {
  return { ...rawTweet(id, author, text), community_results: { result: community } };
}

function searchResponse(tweets, cursor) {
  const entries = tweets.map((t) => tweetEntry(t));
  if (cursor) entries.push(cursorEntry('bottom', cursor));
  return { data: { search_by_raw_query: { search_timeline: { timeline: { instructions: addEntries(entries) } } } } };
}

function sharingSpace(id, author, spaceId) {
  const tweet = rawTweet(id, author, 'Join us live');
  tweet.legacy.entities.urls = [
    { url: `https://t.co/${spaceId}`, expanded_url: `https://x.com/i/spaces/${spaceId}`, display_url: `x.com/i/spaces/${spaceId}` },
  ];
  return tweet;
}

function spaceResponse(id, state, extra = {}) {
  const base = AUDIO_SPACE_RESPONSE.data.audioSpace;
  return { data: { audioSpace: { ...base, metadata: { ...base.metadata, rest_id: id, state, ...extra } } } };
}

let home;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-community-'));
  process.env.XACTIONS_HOME = home;
});
afterEach(() => {
  delete process.env.XACTIONS_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

describe('community processors', () => {
  it('defines every job type the community and spaces routes queue', () => {
    expect(Object.keys(processors).sort()).toEqual(
      [
        'communityCreate', 'communityJoin', 'communityLeave', 'communityLeaveAll', 'communityList',
        'communityManage', 'communityMembers', 'communityNotes', 'communitySearch',
        'getLiveSpaces', 'getScheduledSpaces', 'scrapeSpace', 'spaceJoin',
      ].sort(),
    );
    for (const type of ['communityJoin', 'communityLeave', 'communityLeaveAll', 'communityCreate', 'communityManage', 'spaceJoin']) {
      expect(processors[type].write, type).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Join / leave
// ---------------------------------------------------------------------------

describe('communityJoin', () => {
  const OPEN = rawCommunity('1493446837214187523', 'Build in Public', { role: 'NonMember' });

  it('joins an open Community by id and charges one follow', async () => {
    const x = fakeX({
      CommunityByRestId: byId(OPEN),
      JoinCommunity: { data: { community_join: { ...OPEN, role: 'Member' } } },
    });
    const result = await run('communityJoin', { communityId: 'https://x.com/i/communities/1493446837214187523' }, x);
    expect(result).toMatchObject({ success: true, action: 'joined', role: 'Member', communityId: '1493446837214187523', matchedBy: 'id' });
    expect(x.ops()).toEqual(['CommunityByRestId', 'JoinCommunity']);
    expect(x.calls[1]).toMatchObject({ method: 'POST', variables: { communityId: '1493446837214187523' } });
    expect(used('follow')).toBe(1);
  });

  it('asks to join a restricted Community instead', async () => {
    const restricted = { ...OPEN, join_policy: 'RestrictedJoinRequestsRequireModeratorApproval' };
    const x = fakeX({
      CommunityByRestId: byId(restricted),
      RequestToJoinCommunity: { data: { community_request_to_join: restricted } },
    });
    const result = await run('communityJoin', { communityId: '1493446837214187523' }, x);
    expect(result).toMatchObject({ action: 'requested', pendingApproval: true });
    expect(x.ops()).toContain('RequestToJoinCommunity');
  });

  it('does nothing when already a member', async () => {
    const x = fakeX({ CommunityByRestId: byId({ ...OPEN, role: 'Moderator' }) });
    const result = await run('communityJoin', { communityId: '1493446837214187523' }, x);
    expect(result).toMatchObject({ action: 'none', alreadyMember: true, role: 'Moderator' });
    expect(x.ops()).toEqual(['CommunityByRestId']);
    expect(used('follow')).toBe(0);
  });

  it('joins the best name match for a keyword', async () => {
    const rust = rawCommunity('1600000000000000001', 'Rust Builders', { role: 'NonMember', members: 900 });
    const art = rawCommunity('1600000000000000002', 'Pixel Art', { role: 'NonMember' });
    const x = fakeX({
      CommunityDiscoveryTimeline: listResponse([art, rust]),
      GlobalCommunitiesPostSearchTimeline: searchResponse([postInCommunity('8001', BOB, 'rust borrow checker tips', art)]),
      JoinCommunity: { data: { community_join: { ...rust, role: 'Member' } } },
    });
    const result = await run('communityJoin', { keyword: 'rust' }, x);
    expect(result).toMatchObject({ action: 'joined', communityId: '1600000000000000001', matchedBy: 'keyword', keyword: 'rust' });
    expect(x.calls.find((c) => c.op === 'JoinCommunity').variables.communityId).toBe('1600000000000000001');
  });

  it('refuses to guess when no Community name matches the keyword', async () => {
    const x = fakeX({
      CommunityDiscoveryTimeline: listResponse([rawCommunity('1600000000000000002', 'Pixel Art')]),
      GlobalCommunitiesPostSearchTimeline: searchResponse([]),
    });
    const err = await run('communityJoin', { keyword: 'quantum' }, x).catch((e) => e);
    expect(err.message).toMatch(/No Community whose name or description mentions "quantum"/);
    expect(isPermanentFailure(err)).toBe(true);
    expect(x.ops()).not.toContain('JoinCommunity');
  });

  it('rejects missing and malformed input without calling X', async () => {
    const x = fakeX({});
    await expect(run('communityJoin', {}, x)).rejects.toBeInstanceOf(JobInputError);
    await expect(run('communityJoin', { communityId: 'not-an-id' }, x)).rejects.toThrow(/not a Community id/);
    expect(x.calls).toHaveLength(0);
  });

  it('surfaces the error X returns for the join', async () => {
    const x = fakeX({
      CommunityByRestId: byId(OPEN),
      JoinCommunity: { errors: [{ message: 'You are blocked from this Community' }] },
    });
    const err = await run('communityJoin', { communityId: '1493446837214187523' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(TwitterApiError);
    expect(err.message).toMatch(/blocked from this Community/);
  });

  it('fails permanently when X rejects the session', async () => {
    const x = fakeX({ CommunityByRestId: { status: 401, body: {} } });
    const err = await run('communityJoin', { communityId: '1493446837214187523' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(isPermanentFailure(err)).toBe(true);
  });
});

describe('communityLeave', () => {
  it('leaves a Community the session belongs to', async () => {
    const member = rawCommunity('1493446837214187523', 'Build in Public', { role: 'Member' });
    const x = fakeX({
      CommunityByRestId: byId(member),
      LeaveCommunity: { data: { community_leave: { ...member, role: 'NonMember' } } },
    });
    const result = await run('communityLeave', { communityId: '1493446837214187523' }, x);
    expect(result).toMatchObject({ action: 'left', wasMember: true, previousRole: 'Member' });
    expect(used('unfollow')).toBe(1);
  });

  it('refuses to leave a Community the session administers', async () => {
    const x = fakeX({ CommunityByRestId: byId(rawCommunity('1500000000000000000', 'JavaScript', { role: 'Admin' })) });
    const err = await run('communityLeave', { communityId: '1500000000000000000' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(JobInputError);
    expect(err.message).toMatch(/admin/);
    expect(x.ops()).not.toContain('LeaveCommunity');
  });

  it('reports a Community the session is not in', async () => {
    const x = fakeX({ CommunityByRestId: byId(rawCommunity('1500000000000000009', 'Elsewhere')) });
    const result = await run('communityLeave', { communityId: '1500000000000000009' }, x);
    expect(result).toMatchObject({ action: 'none', wasMember: false });
  });
});

describe('communityLeaveAll', () => {
  const memberships = () => {
    const response = structuredClone(COMMUNITY_MEMBERSHIPS_RESPONSE);
    const entries = response.data.user.result.communities_timeline.timeline.instructions[0].entries;
    response.data.user.result.communities_timeline.timeline.instructions[0].entries = entries.filter((e) => !e.entryId.startsWith('cursor'));
    return response;
  };

  it('leaves every Community except the ones the session administers', async () => {
    const x = fakeX({
      CommunitiesMembershipsTimeline: memberships(),
      LeaveCommunity: (v) => ({ data: { community_leave: rawCommunity(v.communityId, 'Left', { role: 'NonMember' }) } }),
    });
    const result = await run('communityLeaveAll', { delayMs: 0 }, x);
    expect(result).toMatchObject({ success: true, total: 2, left: 1, skipped: 1, failed: 0 });
    expect(result.results).toEqual([
      { communityId: '1493446837214187523', name: 'Build in Public', role: 'Member', status: 'left' },
      { communityId: '1500000000000000000', name: 'JavaScript', role: 'Admin', status: 'skipped', reason: 'admins cannot leave their own Community' },
    ]);
    expect(used('unfollow')).toBe(1);
  });

  it('only reports what it would do on a dry run', async () => {
    const x = fakeX({ CommunitiesMembershipsTimeline: memberships() });
    const result = await run('communityLeaveAll', { dryRun: true }, x);
    expect(result).toMatchObject({ dryRun: true, wouldLeave: 1, skipped: 1, left: 0 });
    expect(x.ops()).toEqual(['CommunitiesMembershipsTimeline']);
  });

  it('records a per-Community failure and carries on', async () => {
    const x = fakeX({
      CommunitiesMembershipsTimeline: memberships(),
      LeaveCommunity: { errors: [{ message: 'Try again later' }] },
    });
    const result = await run('communityLeaveAll', { delayMs: 0 }, x);
    expect(result).toMatchObject({ left: 0, failed: 1, skipped: 1 });
    expect(result.results[0].error).toMatch(/Try again later/);
  });
});

// ---------------------------------------------------------------------------
// Create / manage
// ---------------------------------------------------------------------------

describe('communityCreate', () => {
  const created = rawCommunity('1700000000000000001', 'Agents Guild', { role: 'Admin', members: 1 });

  it('creates the Community, then adds each rule', async () => {
    const x = fakeX({
      CreateCommunity: { data: { community_create: created } },
      CommunityCreateRule: (v) => (v.name === 'No spam' ? { errors: [{ message: 'Rule name taken' }] } : { data: { community_create_rule: created } }),
    });
    const result = await run(
      'communityCreate',
      { name: 'Agents Guild', description: 'People building agents', rules: ['Be kind', { name: 'No spam', description: 'Obvious' }], delayMs: 0 },
      x,
    );
    expect(result).toMatchObject({ success: true, communityId: '1700000000000000001', url: 'https://x.com/i/communities/1700000000000000001', rulesAdded: 1 });
    expect(result.rules).toEqual([
      { name: 'Be kind', description: '', status: 'added' },
      { name: 'No spam', description: 'Obvious', status: 'failed', error: 'CommunityCreateRule failed: Rule name taken' },
    ]);
    expect(x.calls[0]).toMatchObject({ op: 'CreateCommunity', method: 'POST', variables: { name: 'Agents Guild', description: 'People building agents' } });
    expect(x.calls[1].variables).toEqual({ communityId: '1700000000000000001', name: 'Be kind', description: '' });
    expect(used('post')).toBe(1);
  });

  it('passes on the reason X refuses to create one', async () => {
    const x = fakeX({ CreateCommunity: { errors: [{ message: 'Only Premium subscribers can create Communities' }] } });
    const err = await run('communityCreate', { name: 'Agents Guild' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(TwitterApiError);
    expect(err.message).toMatch(/Premium/);
  });

  it('validates the name and rules before calling X', async () => {
    const x = fakeX({});
    await expect(run('communityCreate', {}, x)).rejects.toThrow('name is required');
    await expect(run('communityCreate', { name: 'A', rules: Array.from({ length: 11 }, (_, i) => `r${i}`) }, x)).rejects.toThrow(/at most 10/);
    expect(x.calls).toHaveLength(0);
  });
});

describe('communityManage', () => {
  const administered = rawCommunity('1500000000000000000', 'JavaScript', { role: 'Admin' });

  it('shows the Community by default', async () => {
    const x = fakeX({ CommunityByRestId: byId(administered) });
    const result = await run('communityManage', { communityId: '1500000000000000000' }, x);
    expect(result).toMatchObject({ action: 'view', community: { name: 'JavaScript', role: 'Admin' } });
  });

  it('promotes a member to moderator as the admin', async () => {
    const x = fakeX({
      CommunityByRestId: byId(administered),
      UserByScreenName: { data: { user: { result: BOB } } },
      CommunityUpdateRole: { data: { community_update_role: { __typename: 'Community', rest_id: '1500000000000000000' } } },
    });
    const result = await run('communityManage', { communityId: '1500000000000000000', action: 'promote', targetUsername: '@bob_codes' }, x);
    expect(result).toMatchObject({ action: 'promote', newRole: 'Moderator', target: { id: '2002', username: 'bob_codes' } });
    expect(x.calls.find((c) => c.op === 'CommunityUpdateRole').variables).toEqual({ communityId: '1500000000000000000', userId: '2002', role: 'Moderator' });
  });

  it('invites a user as a member', async () => {
    const x = fakeX({
      CommunityByRestId: byId({ ...administered, role: 'Member' }),
      UserByScreenName: { data: { user: { result: CAROL } } },
      CommunityUserInvite: { data: { community_invite_user: {} } },
    });
    const result = await run('communityManage', { communityId: '1500000000000000000', action: 'invite', targetUsername: 'carol_ml' }, x);
    expect(result).toMatchObject({ action: 'invite', target: { username: 'carol_ml' } });
    expect(used('dm')).toBe(1);
  });

  it('refuses role changes from a non-admin and unknown actions', async () => {
    const x = fakeX({ CommunityByRestId: byId({ ...administered, role: 'Member' }) });
    await expect(run('communityManage', { communityId: '1500000000000000000', action: 'demote', targetUsername: 'bob_codes' }, x)).rejects.toThrow(/Only the admin/);
    await expect(run('communityManage', { communityId: '1500000000000000000', action: 'nuke' }, x)).rejects.toThrow(/action must be one of/);
    expect(x.ops()).not.toContain('CommunityUpdateRole');
  });
});

// ---------------------------------------------------------------------------
// Community Notes
// ---------------------------------------------------------------------------

describe('communityNotes', () => {
  const NOTES_RESPONSE = {
    data: {
      tweet_result_by_rest_id: {
        result: {
          birdwatch_pivot: {
            note: { rest_id: '1800000000000000001' },
            title: 'Readers added context',
            subtitle: { text: 'The chart is from 2019.' },
            destinationUrl: 'https://x.com/i/birdwatch/n/1800000000000000001',
          },
          misleading_birdwatch_notes: {
            notes: [
              {
                rest_id: '1800000000000000001',
                data_v1: { summary: { text: 'The chart is from 2019.' }, classification: 'MisinformedOrPotentiallyMisleading', misleading_tags: ['OutdatedInformation'], trustworthy_sources: true },
                rating_status: 'CurrentlyRatedHelpful',
                helpful_tags: ['GoodSources'],
                created_at: 1756285200000,
              },
            ],
          },
          not_misleading_birdwatch_notes: {
            notes: [{ rest_id: '1800000000000000002', data_v1: { summary: { text: 'Accurate as posted.' }, classification: 'NotMisleading' }, rating_status: 'NeedsMoreRatings' }],
          },
        },
      },
    },
  };

  it('reads every note on a post and the one X shows', async () => {
    const x = fakeX({ BirdwatchFetchNotes: NOTES_RESPONSE });
    const result = await run('communityNotes', { tweetId: 'https://x.com/alice_dev/status/1234567890123' }, x);
    expect(x.calls[0].variables).toEqual({ tweet_id: '1234567890123' });
    expect(result.shownNote).toEqual({
      id: '1800000000000000001',
      title: 'Readers added context',
      text: 'The chart is from 2019.',
      url: 'https://x.com/i/birdwatch/n/1800000000000000001',
    });
    expect(result.count).toBe(2);
    const byGroup = Object.fromEntries(result.notes.map((n) => [n.group, n]));
    expect(byGroup.misleading).toMatchObject({ status: 'CurrentlyRatedHelpful', misleadingTags: ['OutdatedInformation'], createdAt: '2025-08-27T09:00:00.000Z' });
    expect(byGroup.not_misleading).toMatchObject({ text: 'Accurate as posted.', status: 'NeedsMoreRatings' });
  });

  it('says so when a post has no notes', async () => {
    const x = fakeX({ BirdwatchFetchNotes: { data: { tweet_result_by_rest_id: { result: { __typename: 'Tweet' } } } } });
    const result = await run('communityNotes', { tweetId: '1234567890123' }, x);
    expect(result).toMatchObject({ count: 0, shownNote: null, message: 'Post 1234567890123 has no Community Notes.' });
  });

  it('requests a note on a post', async () => {
    const x = fakeX({ BirdwatchCreateBatSignal: { data: { birdwatch_create_bat_signal: 'Done' } } });
    const result = await run('communityNotes', { tweetId: '1234567890123', action: 'request' }, x);
    expect(result).toMatchObject({ success: true, action: 'request', tweetId: '1234567890123' });
    expect(x.calls[0]).toMatchObject({ method: 'POST', variables: { tweet_id: '1234567890123' } });
  });

  it('rejects a missing post and an unknown action', async () => {
    const x = fakeX({});
    await expect(run('communityNotes', { action: 'view' }, x)).rejects.toThrow('tweetId is required');
    await expect(run('communityNotes', { tweetId: '1234567890123', action: 'rate' }, x)).rejects.toThrow(/"view" or "request"/);
  });

  it('fails when X returns nothing for the post', async () => {
    const x = fakeX({ BirdwatchFetchNotes: { data: {} } });
    await expect(run('communityNotes', { tweetId: '1234567890123' }, x)).rejects.toThrow(/no Community Notes data/);
  });
});

// ---------------------------------------------------------------------------
// Listing and search
// ---------------------------------------------------------------------------

describe('communityList', () => {
  it('lists memberships with a count per role', async () => {
    const x = fakeX({ CommunitiesMembershipsTimeline: COMMUNITY_MEMBERSHIPS_RESPONSE });
    const result = await run('communityList', {}, x);
    expect(result).toMatchObject({ count: 2, byRole: { Member: 1, Admin: 1 } });
    expect(result.communities.map((c) => c.name)).toEqual(['Build in Public', 'JavaScript']);
  });

  it('treats an empty membership list as a finding, not a zero', async () => {
    const x = fakeX({ CommunitiesMembershipsTimeline: { data: { user: { result: { communities_timeline: { timeline: { instructions: [] } } } } } } });
    const err = await run('communityList', {}, x).catch((e) => e);
    expect(err.message).toBe('This account is not a member of any Community.');
    expect(isPermanentFailure(err)).toBe(true);
  });
});

describe('communitySearch', () => {
  it('ranks name matches first and fills in Communities known only from posts', async () => {
    const partial = { __typename: 'Community', rest_id: '1600000000000000003', name: 'Rustaceans' };
    const full = rawCommunity('1600000000000000003', 'Rustaceans', { members: 5000 });
    const other = rawCommunity('1600000000000000004', 'Systems Programming', { members: 20000 });
    const x = fakeX({
      CommunityDiscoveryTimeline: listResponse([rawCommunity('1600000000000000001', 'Rust Builders', { members: 900 })]),
      GlobalCommunitiesPostSearchTimeline: searchResponse([
        postInCommunity('8001', ALICE, 'rust 2026 edition', partial),
        postInCommunity('8002', BOB, 'rust in the kernel', other),
        postInCommunity('8003', CAROL, 'rust async', other),
      ]),
      CommunityByRestId: byId(full),
    });
    const result = await run('communitySearch', { query: 'Rust', limit: 5 }, x);
    expect(result.communities.map((c) => c.name)).toEqual(['Rustaceans', 'Rust Builders', 'Systems Programming']);
    expect(result.communities[0]).toMatchObject({ memberCount: 5000, matchingPosts: 1, foundVia: 'posts' });
    expect(result.communities[2]).toMatchObject({ matchingPosts: 2, relevance: 0 });
  });

  it('fails clearly when nothing matches', async () => {
    const x = fakeX({ CommunityDiscoveryTimeline: listResponse([]), GlobalCommunitiesPostSearchTimeline: searchResponse([]) });
    await expect(run('communitySearch', { query: 'zzz' }, x)).rejects.toThrow(/No Communities found for "zzz"/);
  });
});

// ---------------------------------------------------------------------------
// Members (browser)
// ---------------------------------------------------------------------------

class FakePage extends EventEmitter {
  constructor(pages, { landing } = {}) {
    super();
    this.pages = pages;
    this.landing = landing;
    this.current = 'about:blank';
    this.closed = false;
  }

  async goto(url) {
    this.current = this.landing || url;
    this.emitNext();
  }

  url() {
    return this.current;
  }

  async evaluate() {
    this.emitNext();
  }

  emitNext() {
    // x.com fires unrelated GraphQL calls on every page; they must be ignored.
    this.emit('response', { url: () => 'https://x.com/i/api/graphql/q1/UserByScreenName?variables=%7B%7D', json: async () => ({ data: { user: { result: CAROL } } }) });
    const body = this.pages.shift();
    if (body) this.emit('response', { url: () => 'https://x.com/i/api/graphql/q2/membersSliceTimeline_Query?variables=%7B%7D', json: async () => body });
  }

  async close() {
    this.closed = true;
  }
}

describe('communityMembers', () => {
  const community = rawCommunity('1493446837214187523', 'Build in Public', { members: 4 });
  const slice = (items) => ({ data: { communityResults: { result: { members_slice: { items_results: items } } } } });

  it('reads members from the members page GraphQL responses', async () => {
    const page = new FakePage([
      slice([{ result: ALICE }, { user_results: { result: BOB }, community_role: 'Moderator' }]),
      slice([{ result: { ...ALICE } }, { user_results: { result: CAROL }, community_role: 'Member' }]),
    ]);
    const x = fakeX({ CommunityByRestId: byId(community) });
    const { ctx } = context('communityMembers', { communityId: '1493446837214187523', limit: 3 }, x, {
      browser: async () => ({ createPage: async (token) => (token === 'tok' ? page : null) }),
    });
    const result = await processors.communityMembers.run(ctx);
    await ctx.dispose();
    expect(result.members.map((m) => [m.username, m.role])).toEqual([
      ['alice_dev', null],
      ['bob_codes', 'Moderator'],
      ['carol_ml', 'Member'],
    ]);
    expect(result).toMatchObject({ count: 3, complete: false, community: { memberCount: 4 } });
    expect(page.current).toBe('https://x.com/i/communities/1493446837214187523/members');
    expect(page.closed).toBe(true);
    expect(page.listenerCount('response')).toBe(0);
  });

  it('fails as an expired session when x.com redirects to login', async () => {
    const page = new FakePage([], { landing: 'https://x.com/i/flow/login' });
    const x = fakeX({ CommunityByRestId: byId(community) });
    const { ctx } = context('communityMembers', { communityId: '1493446837214187523' }, x, {
      browser: async () => ({ createPage: async () => page }),
    });
    const err = await processors.communityMembers.run(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
  });
});

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

describe('scrapeSpace', () => {
  it('reads a Space from a URL (dashboard) or an id (agents)', async () => {
    const x = fakeX({ AudioSpaceById: AUDIO_SPACE_RESPONSE });
    const fromUrl = await run('scrapeSpace', { url: 'https://x.com/i/spaces/1YqKDqWZrVZKV/peek' }, x);
    const fromId = await run('scrapeSpace', { spaceId: '1YqKDqWZrVZKV' }, x);
    expect(fromUrl.space).toMatchObject({ id: '1YqKDqWZrVZKV', title: 'Shipping HTTP scrapers', state: 'Ended', participantCount: 4 });
    expect(fromId.space.speakers[0].username).toBe('bob_codes');
    expect(x.calls[0].variables).toMatchObject({ id: '1YqKDqWZrVZKV', withListeners: true });
  });

  it('rejects input that is not a Space', async () => {
    const x = fakeX({});
    await expect(run('scrapeSpace', {}, x)).rejects.toThrow('spaceUrl or spaceId is required');
    await expect(run('scrapeSpace', { spaceUrl: 'https://x.com/home' }, x)).rejects.toBeInstanceOf(JobInputError);
  });

  it('fails when the Space does not exist', async () => {
    const x = fakeX({ AudioSpaceById: { data: { audioSpace: {} } } });
    await expect(run('scrapeSpace', { spaceId: '1YqKDqWZrVZKV' }, x)).rejects.toThrow(/not found/);
  });
});

describe('getLiveSpaces / getScheduledSpaces', () => {
  const states = { '1LiveSpaceAAA': 'Running', '1EndedSpaceBB': 'Ended', '1SoonSpaceCCC': 'NotStarted' };
  const spacesX = () =>
    fakeX({
      SearchTimeline: (v) => {
        expect(v.rawQuery).toMatch(/filter:spaces$/);
        return searchResponse([
          sharingSpace('9001', ALICE, '1LiveSpaceAAA'),
          sharingSpace('9002', BOB, '1EndedSpaceBB'),
          sharingSpace('9003', CAROL, '1SoonSpaceCCC'),
          sharingSpace('9004', ALICE, '1LiveSpaceAAA'),
        ]);
      },
      AudioSpaceById: (v) => spaceResponse(v.id, states[v.id], states[v.id] === 'NotStarted' ? { started_at: null, ended_at: null } : {}),
    });

  it('returns only Spaces X reports as running', async () => {
    const x = spacesX();
    const result = await run('getLiveSpaces', { topic: 'ai agents', limit: 20 }, x);
    expect(result).toMatchObject({ topic: 'ai agents', count: 1, spacesChecked: 3, postsSearched: 4 });
    expect(result.spaces[0]).toMatchObject({ id: '1LiveSpaceAAA', state: 'Running', sharedBy: 'alice_dev', sharedInPost: '9001' });
    expect(x.calls[0].variables.rawQuery).toBe('ai agents filter:spaces');
  });

  it('returns only Spaces that have not started', async () => {
    const result = await run('getScheduledSpaces', { limit: 20 }, spacesX());
    expect(result.spaces.map((s) => s.id)).toEqual(['1SoonSpaceCCC']);
    expect(result.topic).toBeNull();
  });

  it('fails clearly when no shared Space is live', async () => {
    const x = fakeX({
      SearchTimeline: searchResponse([sharingSpace('9002', BOB, '1EndedSpaceBB')]),
      AudioSpaceById: spaceResponse('1EndedSpaceBB', 'Ended'),
    });
    const err = await run('getLiveSpaces', { topic: 'rust' }, x).catch((e) => e);
    expect(err.message).toBe('No live Spaces found about "rust": 1 recent posts shared 1 Spaces and none is live.');
    expect(isPermanentFailure(err)).toBe(true);
  });
});

describe('spaceJoin', () => {
  let savedKey;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });

  it('refuses a Space that is not live', async () => {
    const x = fakeX({ AudioSpaceById: spaceResponse('1EndedSpaceBB', 'Ended') });
    const err = await run('spaceJoin', { spaceUrl: 'https://x.com/i/spaces/1EndedSpaceBB', provider: 'openai' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(JobInputError);
    expect(err.message).toMatch(/not live \(state: Ended\)/);
  });

  it('names the env var the chosen provider needs', async () => {
    delete process.env.OPENAI_API_KEY;
    const x = fakeX({ AudioSpaceById: spaceResponse('1LiveSpaceAAA', 'Running') });
    const err = await run('spaceJoin', { spaceId: '1LiveSpaceAAA', provider: 'openai' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(JobInputError);
    expect(err.message).toMatch(/^OPENAI_API_KEY is not set on this server/);
  });

  it('tells the operator to install xspace-agent when it is missing', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const x = fakeX({ AudioSpaceById: spaceResponse('1LiveSpaceAAA', 'Running') });
    const err = await run('spaceJoin', { spaceId: '1LiveSpaceAAA', provider: 'openai' }, x).catch((e) => e);
    expect(err).toBeInstanceOf(JobInputError);
    expect(err.message).toMatch(/xspace-agent is not installed\. Run: npm install xspace-agent/);
    expect(isPermanentFailure(err)).toBe(true);
  });

  it('rejects an unknown provider before calling X', async () => {
    const x = fakeX({});
    await expect(run('spaceJoin', { spaceId: '1LiveSpaceAAA', provider: 'mystery' }, x)).rejects.toThrow(/provider must be one of openai, claude, groq/);
    expect(x.calls).toHaveLength(0);
  });
});
