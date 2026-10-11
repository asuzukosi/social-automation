// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Client — Profile Data Model
 *
 * Represents a Twitter user profile from the internal GraphQL API.
 * Use Profile.fromGraphQL(raw) to parse raw API responses.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

/**
 * Represents a Twitter user profile.
 */
export class Profile {
  constructor() {
    /** @type {string} */
    this.id = '';
    /** @type {string} */
    this.username = '';
    /** @type {string} */
    this.name = '';
    /** @type {string} */
    this.bio = '';
    /** @type {string} */
    this.location = '';
    /** @type {string} */
    this.website = '';
    /** @type {Date|null} */
    this.joined = null;
    /** @type {number} */
    this.followersCount = 0;
    /** @type {number} */
    this.followingCount = 0;
    /** @type {number} */
    this.tweetCount = 0;
    /** @type {number} */
    this.likesCount = 0;
    /** @type {number} */
    this.listedCount = 0;
    /** @type {number} */
    this.mediaCount = 0;
    /** @type {string} */
    this.avatar = '';
    /** @type {string} */
    this.banner = '';
    /** @type {boolean} */
    this.verified = false;
    /** @type {boolean} */
    this.protected = false;
    /** @type {Object|null} */
    this.birthdate = null;
    /** @type {string[]} */
    this.pinnedTweetIds = [];
    /** @type {boolean} */
    this.isBlueVerified = false;
    /** @type {boolean} */
    this.isGovernment = false;
    /** @type {boolean} */
    this.isBusiness = false;
    /** @type {number} */
    this.affiliatesCount = 0;
    /** @type {boolean} */
    this.canDm = false;
    /** @type {string} */
    this.platform = 'twitter';
  }

  /**
   * Create a Profile from a raw Twitter GraphQL "user_results.result" object.
   *
   * @param {Object} raw - Raw GraphQL user result
   * @returns {Profile|null} Parsed profile, or null if unparseable
   */
  static fromGraphQL(raw) {
    if (!raw) return null;

    // Handle UserUnavailable
    if (raw.__typename === 'UserUnavailable') return null;

    // X served every field inside a flat `legacy` block for years. During
    // 2026 it moved them into typed sub-objects (core, avatar, banner,
    // location, privacy, profile_bio, relationship_counts, tweet_counts,
    // action_counts, verification) and stopped sending `legacy` at all on
    // UserByScreenName. Requiring `legacy` made every profile read fail with
    // "Could not parse user". Read the typed shape first and fall back to
    // legacy, so both eras parse and a partial response still yields a
    // profile rather than null.
    const legacy = raw.legacy || {};
    const core = raw.core || {};
    const bio = raw.profile_bio || {};
    const rel = raw.relationship_counts || {};
    const tweets = raw.tweet_counts || {};
    const actions = raw.action_counts || {};

    const username = core.screen_name || legacy.screen_name || '';
    const id = raw.rest_id || legacy.id_str || '';
    // Without at least an id or a handle there is nothing usable here.
    if (!id && !username) return null;

    const profile = new Profile();

    // Core fields
    profile.id = id;
    profile.username = username;
    profile.name = core.name || legacy.name || '';
    profile.bio = bio.description ?? legacy.description ?? '';
    profile.location = raw.location?.location ?? legacy.location ?? '';

    // Website — expand t.co URL from entities
    const websiteEntity =
      bio.entities?.url?.urls?.[0] || legacy.entities?.url?.urls?.[0];
    profile.website = websiteEntity?.expanded_url || websiteEntity?.url || raw.website?.url || legacy.url || '';

    // Join date
    const createdAt = core.created_at || legacy.created_at;
    if (createdAt) {
      profile.joined = new Date(createdAt);
    }

    // Counts. The typed shape drops listed_count entirely, so it stays 0
    // unless a legacy block is present rather than being invented.
    const num = (...candidates) => {
      for (const c of candidates) {
        const n = parseInt(c, 10);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };
    profile.followersCount = num(rel.followers, legacy.followers_count);
    profile.followingCount = num(rel.following, legacy.friends_count);
    profile.tweetCount = num(tweets.tweets, legacy.statuses_count);
    profile.likesCount = num(actions.favorites_count, legacy.favourites_count);
    profile.listedCount = num(legacy.listed_count);
    profile.mediaCount = num(tweets.media_tweets, legacy.media_count);

    // Images
    const avatarUrl = raw.avatar?.image_url || legacy.profile_image_url_https || '';
    profile.avatar = avatarUrl.replace('_normal', '_400x400');
    profile.banner = raw.banner?.image_url || legacy.profile_banner_url || '';

    // Verification
    profile.verified = raw.verification?.verified ?? legacy.verified ?? false;
    profile.isBlueVerified = raw.is_blue_verified || false;
    profile.protected = raw.privacy?.protected ?? legacy.protected ?? false;

    // Pinned tweets
    const pinned =
      legacy.pinned_tweet_ids_str ||
      raw.pinned_items?.pinned_tweet_ids_str ||
      [];
    profile.pinnedTweetIds = Array.isArray(pinned) ? pinned.slice() : [];

    // Business/government affiliations
    const affiliateLabels = raw.affiliates_highlighted_label?.label || {};
    const verifiedType = raw.verification?.verified_type || legacy.verified_type || '';
    if (affiliateLabels.userLabelType === 'GovernmentLabel' || verifiedType === 'Government') {
      profile.isGovernment = true;
    } else if (affiliateLabels.userLabelType === 'BusinessLabel' || verifiedType === 'Business') {
      profile.isBusiness = true;
    }
    profile.affiliatesCount = parseInt(raw.business_account?.affiliates_count, 10) || 0;

    // DM ability
    profile.canDm = legacy.can_dm || false;

    // Birthdate
    if (legacy.birthdate) {
      profile.birthdate = {
        day: legacy.birthdate.day || null,
        month: legacy.birthdate.month || null,
        year: legacy.birthdate.year || null,
        visibility: legacy.birthdate.visibility || 'Self',
      };
    }

    return profile;
  }

  /**
   * Full URL to profile on X.
   * @returns {string}
   */
  get profileUrl() {
    return this.username ? `https://x.com/${this.username}` : '';
  }

  /**
   * JSON-serializable representation.
   * @returns {Object}
   */
  toJSON() {
    return {
      id: this.id,
      username: this.username,
      name: this.name,
      bio: this.bio,
      location: this.location,
      website: this.website,
      joined: this.joined?.toISOString() || null,
      followersCount: this.followersCount,
      followingCount: this.followingCount,
      tweetCount: this.tweetCount,
      likesCount: this.likesCount,
      listedCount: this.listedCount,
      mediaCount: this.mediaCount,
      avatar: this.avatar,
      banner: this.banner,
      verified: this.verified,
      isBlueVerified: this.isBlueVerified,
      protected: this.protected,
      pinnedTweetIds: this.pinnedTweetIds,
      isGovernment: this.isGovernment,
      isBusiness: this.isBusiness,
      canDm: this.canDm,
      platform: this.platform,
      profileUrl: this.profileUrl,
    };
  }
}
