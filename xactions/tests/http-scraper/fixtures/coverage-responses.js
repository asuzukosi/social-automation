// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Fixture responses for communities, notifications, and explore modules.
 *
 * Shapes follow the x.com web client's GraphQL and REST payloads as of
 * 2026-08-27 (CommunityByRestId, CommunityTweetsTimeline,
 * CommunitiesMembershipsTimeline, JoinCommunity, NotificationsTimeline,
 * ExplorePage, /2/guide.json, /1.1/trends/place.json, AudioSpaceById,
 * UserHighlightsTweets, BlueVerifiedFollowers). Data is fictional.
 *
 * @author nich (@nichxbt)
 */

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function rawUser(id, username, name, extra = {}) {
  return {
    __typename: 'User',
    id: `VXNlcjo${id}`,
    rest_id: String(id),
    is_blue_verified: extra.verified ?? false,
    legacy: {
      screen_name: username,
      name,
      description: extra.bio ?? `Bio of ${name}`,
      followers_count: extra.followers ?? 100,
      friends_count: extra.following ?? 50,
      protected: false,
      verified: false,
      profile_image_url_https: `https://pbs.twimg.com/profile_images/${id}/photo_normal.jpg`,
    },
  };
}

export function rawTweet(id, author, text, extra = {}) {
  const legacy = {
    id_str: String(id),
    full_text: text,
    created_at: extra.createdAt ?? 'Wed Aug 27 10:00:00 +0000 2026',
    favorite_count: extra.likes ?? 3,
    retweet_count: 1,
    reply_count: 0,
    quote_count: 0,
    bookmark_count: 0,
    lang: 'en',
    entities: { urls: [], hashtags: [], user_mentions: extra.mentions ?? [] },
  };
  if (extra.inReplyTo) {
    legacy.in_reply_to_status_id_str = extra.inReplyTo.tweetId;
    legacy.in_reply_to_user_id_str = extra.inReplyTo.userId;
    legacy.in_reply_to_screen_name = extra.inReplyTo.username;
  }
  const tweet = {
    __typename: 'Tweet',
    rest_id: String(id),
    core: { user_results: { result: author } },
    views: { count: '120' },
    legacy,
  };
  if (extra.quoted) tweet.quoted_status_result = { result: extra.quoted };
  return tweet;
}

export function tweetEntry(tweet, element) {
  return {
    entryId: `tweet-${tweet.rest_id}`,
    sortIndex: tweet.rest_id,
    content: {
      entryType: 'TimelineTimelineItem',
      __typename: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        __typename: 'TimelineTweet',
        tweet_results: { result: tweet },
        tweetDisplayType: 'Tweet',
      },
      ...(element ? { clientEventInfo: { component: 'notification', element } } : {}),
    },
  };
}

export function userEntry(user) {
  return {
    entryId: `user-${user.rest_id}`,
    sortIndex: user.rest_id,
    content: {
      entryType: 'TimelineTimelineItem',
      __typename: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineUser',
        __typename: 'TimelineUser',
        user_results: { result: user },
        userDisplayType: 'User',
      },
    },
  };
}

export function cursorEntry(direction, value) {
  return {
    entryId: `cursor-${direction}-${value.length}`,
    sortIndex: '0',
    content: {
      entryType: 'TimelineTimelineCursor',
      __typename: 'TimelineTimelineCursor',
      value,
      cursorType: direction === 'bottom' ? 'Bottom' : 'Top',
    },
  };
}

export function addEntries(entries) {
  return [{ type: 'TimelineAddEntries', entries }];
}

// ---------------------------------------------------------------------------
// Users / tweets used across fixtures
// ---------------------------------------------------------------------------

export const ALICE = rawUser('2001', 'alice_dev', 'Alice Dev', { verified: true, followers: 5400 });
export const BOB = rawUser('2002', 'bob_codes', 'Bob Codes');
export const CAROL = rawUser('2003', 'carol_ml', 'Carol ML', { verified: true });
export const ME = rawUser('1001', 'me_user', 'Me', { followers: 900 });

export const MY_TWEET = rawTweet('9001', ME, 'Shipping the HTTP scraper today.');

// ---------------------------------------------------------------------------
// Communities
// ---------------------------------------------------------------------------

export function rawCommunity(id, name, extra = {}) {
  return {
    __typename: 'Community',
    id: `Q29tbXVuaXR5OjE${id}`,
    rest_id: String(id),
    name,
    description: extra.description ?? `${name} description`,
    created_at: 1700000000000,
    member_count: extra.members ?? 1200,
    moderator_count: 3,
    role: extra.role ?? 'NonMember',
    join_policy: extra.joinPolicy ?? 'Open',
    invites_policy: 'MemberInvitesAllowed',
    is_nsfw: false,
    is_pinned: false,
    primary_community_topic: { topic_id: '848', topic_name: 'Technology' },
    custom_banner_media: {
      media_info: { original_img_url: `https://pbs.twimg.com/community_banner_img/${id}/banner`, original_img_width: 1500, original_img_height: 500 },
    },
    admin_results: { result: ALICE },
    creator_results: { result: ALICE },
    rules: [
      { rest_id: 'r1', name: 'Be kind', description: 'Treat others with respect.' },
      { rest_id: 'r2', name: 'Stay on topic', description: '' },
    ],
  };
}

export const COMMUNITY = rawCommunity('1493446837214187523', 'Build in Public', { role: 'Member', members: 48210 });

export const COMMUNITY_BY_ID_RESPONSE = {
  data: { communityResults: { result: COMMUNITY } },
};

export const COMMUNITY_UNAVAILABLE_RESPONSE = {
  data: { communityResults: { result: { __typename: 'CommunityUnavailable', reason: 'Deleted' } } },
};

export const COMMUNITY_TWEETS_RESPONSE = {
  data: {
    communityResults: {
      result: {
        __typename: 'Community',
        ranked_community_timeline: {
          timeline: {
            instructions: addEntries([
              tweetEntry(rawTweet('7001', ALICE, 'Day 12 of building in public.')),
              tweetEntry(rawTweet('7002', BOB, 'Launched my MVP.')),
              cursorEntry('top', 'TOP'),
              cursorEntry('bottom', 'COMMUNITY_PAGE_2'),
            ]),
          },
        },
      },
    },
  },
};

export const COMMUNITY_TWEETS_RESPONSE_PAGE2 = {
  data: {
    communityResults: {
      result: {
        __typename: 'Community',
        ranked_community_timeline: {
          timeline: {
            instructions: addEntries([
              tweetEntry(rawTweet('7003', CAROL, 'Metrics update.')),
            ]),
          },
        },
      },
    },
  },
};

export const COMMUNITY_MEMBERSHIPS_RESPONSE = {
  data: {
    user: {
      result: {
        __typename: 'User',
        communities_timeline: {
          timeline: {
            instructions: addEntries([
              {
                entryId: 'community-1493446837214187523',
                content: {
                  entryType: 'TimelineTimelineItem',
                  itemContent: { itemType: 'TimelineCommunity', community_results: { result: COMMUNITY } },
                },
              },
              {
                entryId: 'community-1500000000000000000',
                content: {
                  entryType: 'TimelineTimelineItem',
                  itemContent: { itemType: 'TimelineCommunity', community_results: { result: rawCommunity('1500000000000000000', 'JavaScript', { role: 'Admin' }) } },
                },
              },
              cursorEntry('bottom', 'MEMBERSHIPS_PAGE_2'),
            ]),
          },
        },
      },
    },
  },
};

export const JOIN_COMMUNITY_RESPONSE = {
  data: { community_join: { ...COMMUNITY, role: 'Member' } },
};

export const LEAVE_COMMUNITY_RESPONSE = {
  data: { community_leave: { ...COMMUNITY, role: 'NonMember' } },
};

export const REQUEST_TO_JOIN_RESPONSE = {
  data: { community_request_to_join: { ...COMMUNITY, role: 'NonMember', join_policy: 'RestrictedJoinRequestsRequireModeratorApproval' } },
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function notificationEntry(id, icon, text, fromUsers, targetTweets = [], timestampMs = '1756288800000') {
  return {
    entryId: `notification-${id}`,
    sortIndex: id,
    content: {
      entryType: 'TimelineTimelineItem',
      __typename: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineNotification',
        __typename: 'TimelineNotification',
        id,
        notification_icon: icon,
        rich_message: {
          text,
          entities: fromUsers.slice(0, 1).map((u) => ({
            fromIndex: 0,
            toIndex: u.legacy.name.length,
            ref: { type: 'TimelineRichTextUser', user_results: { result: u } },
          })),
        },
        notification_url: { url: `https://x.com/i/notifications/${id}`, urlType: 'ExternalUrl' },
        template: {
          __typename: 'NotificationAggregateUserActionsV1',
          from_users: fromUsers.map((u) => ({ user_results: { result: u } })),
          target_objects: targetTweets.map((t) => ({ tweet_results: { result: t } })),
        },
        notification_results: {
          result: {
            __typename: 'Notification',
            id,
            rest_id: id,
            timestamp_ms: timestampMs,
            notification_icon: icon,
            rich_message: { text },
            notification_url: { url: `https://x.com/i/notifications/${id}` },
            template: {
              __typename: 'NotificationAggregateUserActionsV1',
              from_users: fromUsers.map((u) => ({ user_results: { result: u } })),
              target_objects: targetTweets.map((t) => ({ tweet_results: { result: t } })),
            },
          },
        },
      },
    },
  };
}

export const NOTIFICATIONS_RESPONSE = {
  data: {
    viewer_v2: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: '1001',
          notification_timeline: {
            id: 'NotificationTimeline',
            timeline: {
              instructions: [
                { type: 'TimelineClearCache' },
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    cursorEntry('top', 'NOTIF_TOP'),
                    notificationEntry('n-follow-1', 'person_icon', 'Alice Dev and Bob Codes followed you', [ALICE, BOB]),
                    notificationEntry('n-like-1', 'heart_icon', 'Carol ML liked your post', [CAROL], [MY_TWEET]),
                    notificationEntry('n-rt-1', 'retweet_icon', 'Bob Codes reposted your post', [BOB], [MY_TWEET]),
                    tweetEntry(
                      rawTweet('8001', ALICE, '@me_user great work on this', {
                        inReplyTo: { tweetId: '9001', userId: '1001', username: 'me_user' },
                        mentions: [{ screen_name: 'me_user', id_str: '1001' }],
                      }),
                      'user_replied_to_your_tweet',
                    ),
                    tweetEntry(
                      rawTweet('8002', BOB, 'cc @me_user have you seen this', { mentions: [{ screen_name: 'me_user', id_str: '1001' }] }),
                      'user_mentioned_you',
                    ),
                    tweetEntry(rawTweet('8003', CAROL, 'This is exactly right', { quoted: MY_TWEET }), 'user_quoted_your_tweet'),
                    notificationEntry('n-other-1', 'bird_icon', 'There was a login to your account', []),
                    cursorEntry('bottom', 'NOTIF_PAGE_2'),
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },
};

export const NOTIFICATIONS_RESPONSE_PAGE2 = {
  data: {
    viewer_v2: {
      user_results: {
        result: {
          __typename: 'User',
          rest_id: '1001',
          notification_timeline: {
            timeline: {
              instructions: addEntries([
                notificationEntry('n-like-2', 'heart_icon', 'Alice Dev liked your post', [ALICE], [MY_TWEET], '1756202400000'),
              ]),
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Explore / trends
// ---------------------------------------------------------------------------

function trendItemContent(name, volumeText, context) {
  return {
    itemType: 'TimelineTrend',
    __typename: 'TimelineTrend',
    name,
    trend_url: { url: `twitter://search/?query=${encodeURIComponent(name)}&src=trend_click`, urlType: 'DeepLink' },
    trend_metadata: { domain_context: context, meta_description: volumeText, url: { url: `twitter://search/?query=${encodeURIComponent(name)}` } },
  };
}

export const EXPLORE_PAGE_RESPONSE = {
  data: {
    explore_page: {
      body: {
        initialTimeline: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    {
                      entryId: 'trends-module-1',
                      content: {
                        entryType: 'TimelineTimelineModule',
                        displayType: 'Vertical',
                        items: [
                          { entryId: 'trend-1', item: { itemContent: trendItemContent('#BuildInPublic', '12.3K posts', 'Trending in Technology') } },
                          { entryId: 'trend-2', item: { itemContent: trendItemContent('Node 26', '4,210 posts', 'Technology · Trending') } },
                        ],
                      },
                    },
                    { entryId: 'trend-3', content: { entryType: 'TimelineTimelineItem', itemContent: trendItemContent('OpenAI', '250K posts', 'Trending') } },
                    cursorEntry('bottom', 'EXPLORE_PAGE_2'),
                  ],
                },
              ],
            },
          },
        },
      },
    },
  },
};

export const GUIDE_RESPONSE = {
  globalObjects: {},
  timeline: {
    id: 'guide',
    instructions: [
      {
        addEntries: {
          entries: [
            {
              entryId: 'trends',
              content: {
                timelineModule: {
                  items: [
                    { entryId: 'trends-t1', item: { content: { trend: { name: '#BuildInPublic', url: { url: 'twitter://search/?query=%23BuildInPublic', urlType: 'DeepLink' }, trendMetadata: { domainContext: 'Trending in Technology', metaDescription: '12.3K posts', url: { url: 'twitter://search/?query=%23BuildInPublic' } } } } } },
                    { entryId: 'trends-t2', item: { content: { trend: { name: 'Node 26', url: { url: 'twitter://search/?query=%22Node+26%22' }, trendMetadata: { domainContext: 'Technology', metaDescription: '4,210 posts' } } } } },
                  ],
                },
              },
            },
          ],
        },
      },
    ],
  },
};

export const TRENDS_PLACE_RESPONSE = [
  {
    trends: [
      { name: '#BuildInPublic', url: 'http://twitter.com/search?q=%23BuildInPublic', promoted_content: null, query: '%23BuildInPublic', tweet_volume: 12300 },
      { name: 'Node 26', url: 'http://twitter.com/search?q=%22Node+26%22', promoted_content: null, query: '%22Node+26%22', tweet_volume: null },
    ],
    as_of: '2026-08-27T10:00:00Z',
    created_at: '2026-08-27T09:55:00Z',
    locations: [{ name: 'Worldwide', woeid: 1 }],
  },
];

export const TRENDS_AVAILABLE_RESPONSE = [
  { name: 'Worldwide', placeType: { code: 19, name: 'Supername' }, url: 'http://where.yahooapis.com/v1/place/1', parentid: 0, country: '', woeid: 1, countryCode: null },
  { name: 'United States', placeType: { code: 12, name: 'Country' }, url: 'http://where.yahooapis.com/v1/place/23424977', parentid: 1, country: 'United States', woeid: 23424977, countryCode: 'US' },
];

// ---------------------------------------------------------------------------
// Profile side-timelines
// ---------------------------------------------------------------------------

export const HIGHLIGHTS_RESPONSE = {
  data: {
    user: {
      result: {
        __typename: 'User',
        timeline: {
          timeline: {
            instructions: addEntries([
              tweetEntry(rawTweet('6001', ALICE, 'My most important thread.')),
              tweetEntry(rawTweet('6002', ALICE, 'The launch post.')),
              cursorEntry('bottom', 'HIGHLIGHTS_PAGE_2'),
            ]),
          },
        },
      },
    },
  },
};

export const HIGHLIGHTS_RESPONSE_PAGE2 = {
  data: {
    user: {
      result: {
        __typename: 'User',
        timeline: {
          timeline: {
            instructions: addEntries([tweetEntry(rawTweet('6003', ALICE, 'One more.'))]),
          },
        },
      },
    },
  },
};

export const VERIFIED_FOLLOWERS_RESPONSE = {
  data: {
    user: {
      result: {
        __typename: 'User',
        timeline: {
          timeline: {
            instructions: addEntries([userEntry(ALICE), userEntry(CAROL), cursorEntry('bottom', 'VERIFIED_PAGE_2')]),
          },
        },
      },
    },
  },
};

export const USER_RESOLVE_RESPONSE = {
  data: { user: { result: ALICE } },
};

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export const AUDIO_SPACE_RESPONSE = {
  data: {
    audioSpace: {
      metadata: {
        rest_id: '1YqKDqWZrVZKV',
        state: 'Ended',
        title: 'Shipping HTTP scrapers',
        media_key: '28_1760000000000000000',
        created_at: 1756285200000,
        scheduled_start: 1756285200000,
        started_at: 1756285260000,
        ended_at: '1756288860000',
        updated_at: 1756288900000,
        total_replay_watched: 340,
        total_live_listeners: 57,
        total_participating: 4,
        is_space_available_for_replay: true,
        is_locked: false,
        disallow_join: false,
        conversation_controls: 0,
        creator_results: { result: ALICE },
      },
      participants: {
        total: 4,
        admins: [
          { periscope_user_id: '1AliceP', user_results: { rest_id: '2001', result: ALICE }, display_name: 'Alice Dev', twitter_screen_name: 'alice_dev', avatar_url: 'https://pbs.twimg.com/profile_images/2001/photo_normal.jpg', is_verified: true },
        ],
        speakers: [
          { periscope_user_id: '1BobP', user_results: { rest_id: '2002', result: BOB }, display_name: 'Bob Codes', twitter_screen_name: 'bob_codes', avatar_url: 'https://pbs.twimg.com/profile_images/2002/photo_normal.jpg', is_verified: false },
        ],
        listeners: [
          { periscope_user_id: '1CarolP', user_results: { rest_id: '2003', result: CAROL }, display_name: 'Carol ML', twitter_screen_name: 'carol_ml', is_verified: true },
          { periscope_user_id: '1AnonP', user_results: { rest_id: '2999' }, display_name: 'Anon', twitter_screen_name: 'anon_listener', avatar_url: 'https://pbs.twimg.com/profile_images/2999/photo_normal.jpg', is_verified: false },
        ],
      },
      sharings: { items: [], slice_info: {} },
    },
  },
};

export const AUDIO_SPACE_MISSING_RESPONSE = { data: { audioSpace: {} } };
