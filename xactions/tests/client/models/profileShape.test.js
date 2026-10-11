// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Regression: Profile.fromGraphQL must parse both User shapes X serves.
 *
 * For years every field arrived inside a flat `legacy` block. During 2026 X
 * moved them into typed sub-objects (core, avatar, banner, location, privacy,
 * profile_bio, relationship_counts, tweet_counts, action_counts, verification)
 * and stopped sending `legacy` at all on UserByScreenName. The parser required
 * `legacy` and returned null without it, so `xactions profile nasa`, the first
 * command in the README, failed with "Could not parse user" for every account.
 *
 * TYPED_USER below is the real response x.com served for @NASA on 2026-08-27,
 * trimmed to the fields the parser reads. Do not "tidy" it: its job is to be
 * what the wire actually carried.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import { Profile } from '../../../src/client/models/Profile.js';

/** Captured live from UserByScreenName on 2026-08-27. */
const TYPED_USER = {
  __typename: 'User',
  rest_id: '11348282',
  id: 'VXNlcjoxMTM0ODI4Mg==',
  is_blue_verified: true,
  action_counts: { favorites_count: 16948 },
  avatar: { image_url: 'https://pbs.twimg.com/profile_images/1321163587679784960/0ZxKlEKB_normal.jpg' },
  banner: { image_url: 'https://pbs.twimg.com/profile_banners/11348282/1775567134' },
  business_account: { affiliates_count: 87 },
  core: { created_at: 'Wed Dec 19 20:20:32 +0000 2007', name: 'NASA', screen_name: 'NASA' },
  dm_permissions: { can_dm: false },
  location: { location: 'Pale Blue Dot' },
  privacy: { protected: false },
  profile_bio: {
    description: 'Making the seemingly impossible, possible. ✨',
    entities: {
      description: {},
      url: {
        urls: [
          {
            display_url: 'nasa.gov',
            expanded_url: 'http://www.nasa.gov/',
            indices: [0, 23],
            url: 'https://t.co/9NkQJKAVks',
          },
        ],
      },
    },
  },
  relationship_counts: { followers: 92355682, following: 117 },
  tweet_counts: { media_tweets: 28095, tweets: 74197 },
  verification: { verified: false, verified_type: 'Government' },
};

/** The shape X served before the 2026 migration. */
const LEGACY_USER = {
  __typename: 'User',
  rest_id: '11348282',
  is_blue_verified: true,
  legacy: {
    screen_name: 'NASA',
    name: 'NASA',
    description: 'Making the seemingly impossible, possible.',
    location: 'Pale Blue Dot',
    created_at: 'Wed Dec 19 20:20:32 +0000 2007',
    followers_count: 92355682,
    friends_count: 117,
    statuses_count: 74197,
    favourites_count: 16948,
    listed_count: 97000,
    media_count: 28095,
    profile_image_url_https: 'https://pbs.twimg.com/profile_images/1321163587679784960/0ZxKlEKB_normal.jpg',
    profile_banner_url: 'https://pbs.twimg.com/profile_banners/11348282/1775567134',
    verified: true,
    protected: false,
    pinned_tweet_ids_str: ['1234567890'],
    entities: { url: { urls: [{ expanded_url: 'http://www.nasa.gov/' }] } },
  },
};

describe('Profile.fromGraphQL: the typed shape X serves now', () => {
  it('parses a user that carries no legacy block at all', () => {
    const p = Profile.fromGraphQL(TYPED_USER);

    expect(p).not.toBeNull();
    expect(p.id).toBe('11348282');
    expect(p.username).toBe('NASA');
    expect(p.name).toBe('NASA');
    expect(p.bio).toBe('Making the seemingly impossible, possible. ✨');
    expect(p.location).toBe('Pale Blue Dot');
    expect(p.website).toBe('http://www.nasa.gov/');
    expect(p.joined.getUTCFullYear()).toBe(2007);
    expect(p.followersCount).toBe(92355682);
    expect(p.followingCount).toBe(117);
    expect(p.tweetCount).toBe(74197);
    expect(p.likesCount).toBe(16948);
    expect(p.mediaCount).toBe(28095);
    expect(p.avatar).toContain('_400x400');
    expect(p.banner).toContain('profile_banners');
    expect(p.isBlueVerified).toBe(true);
    expect(p.protected).toBe(false);
  });

  it('reads the Government label out of verification.verified_type', () => {
    expect(Profile.fromGraphQL(TYPED_USER).isGovernment).toBe(true);
    const business = { ...TYPED_USER, verification: { verified: false, verified_type: 'Business' } };
    expect(Profile.fromGraphQL(business).isBusiness).toBe(true);
  });

  it('reports listedCount as 0 rather than inventing one, since the typed shape drops it', () => {
    expect(Profile.fromGraphQL(TYPED_USER).listedCount).toBe(0);
  });
});

describe('Profile.fromGraphQL: the legacy shape still parses', () => {
  it('reads every field from a legacy block', () => {
    const p = Profile.fromGraphQL(LEGACY_USER);

    expect(p.username).toBe('NASA');
    expect(p.followersCount).toBe(92355682);
    expect(p.tweetCount).toBe(74197);
    expect(p.listedCount).toBe(97000);
    expect(p.verified).toBe(true);
    expect(p.pinnedTweetIds).toEqual(['1234567890']);
    expect(p.website).toBe('http://www.nasa.gov/');
  });

  it('prefers the typed fields when a response carries both', () => {
    const both = { ...TYPED_USER, legacy: { ...LEGACY_USER.legacy, screen_name: 'stale', followers_count: 1 } };
    const p = Profile.fromGraphQL(both);
    expect(p.username).toBe('NASA');
    expect(p.followersCount).toBe(92355682);
    // A field only legacy carries still comes through
    expect(p.listedCount).toBe(97000);
  });
});

describe('Profile.fromGraphQL: refusals', () => {
  it('returns null for nothing, for UserUnavailable, and for a result with no id or handle', () => {
    expect(Profile.fromGraphQL(null)).toBeNull();
    expect(Profile.fromGraphQL({ __typename: 'UserUnavailable' })).toBeNull();
    expect(Profile.fromGraphQL({ __typename: 'User' })).toBeNull();
  });

  it('still parses a partial response rather than throwing it away', () => {
    const partial = { __typename: 'User', rest_id: '42', core: { screen_name: 'someone' } };
    const p = Profile.fromGraphQL(partial);
    expect(p).not.toBeNull();
    expect(p.username).toBe('someone');
    expect(p.followersCount).toBe(0);
  });
});
