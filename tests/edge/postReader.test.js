// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Edge post reader tests.
 *
 * Both rails are driven over a fetch stub carrying response bodies captured
 * from x.com, including the current typed User shape (handle under `core`, no
 * `legacy` blob), which is what broke reads the last time X rolled it out.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPost, getThread, normalizePostId } from '../../src/edge/postReader.js';

const ID = '2092648130856571283';
const PARENT_ID = '2092648130856571200';
const CDN = 'https://video.twimg.com/amplify_video/2092647926593953792';

const graphPost = (id, { replyTo = null } = {}) => ({
  data: {
    tweetResult: {
      result: {
        __typename: 'Tweet',
        rest_id: id,
        core: {
          user_results: {
            result: {
              rest_id: '34743251',
              core: { name: 'SpaceX', screen_name: 'SpaceX' },
              avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' },
              is_blue_verified: true,
              verification: { verified_type: 'Business' },
            },
          },
        },
        views: { count: '1272673' },
        legacy: {
          id_str: id,
          created_at: 'Wed Aug 26 15:04:05 +0000 2026',
          full_text: `post ${id}`,
          lang: 'en',
          favorite_count: 10926,
          retweet_count: 1329,
          reply_count: 345,
          quote_count: 158,
          bookmark_count: 447,
          conversation_id_str: PARENT_ID,
          in_reply_to_status_id_str: replyTo,
          in_reply_to_screen_name: replyTo ? 'SpaceX' : null,
          entities: { hashtags: [{ text: 'Starship' }], urls: [{ url: 'https://t.co/x', expanded_url: 'https://spacex.com', display_url: 'spacex.com' }], user_mentions: [{ screen_name: 'NASA' }], symbols: [] },
          extended_entities: {
            media: [{
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/thumb.jpg',
              original_info: { width: 3840, height: 2160 },
              video_info: {
                duration_millis: 28542,
                variants: [
                  { content_type: 'application/x-mpegURL', url: `${CDN}/pl/a.m3u8` },
                  { content_type: 'video/mp4', bitrate: 256000, url: `${CDN}/vid/avc1/480x270/a.mp4` },
                  { content_type: 'video/mp4', bitrate: 25128000, url: `${CDN}/vid/avc1/3840x2160/b.mp4?tag=29` },
                ],
              },
            }],
          },
        },
      },
    },
  },
});

function stub(routes) {
  const calls = [];
  vi.stubGlobal('fetch', async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    for (const [fragment, respond] of routes) {
      if (url.includes(fragment)) return respond(url);
    }
    return new Response('', { status: 503 });
  });
  return calls;
}

const guestOk = () => new Response(JSON.stringify({ guest_token: '1' }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizePostId', () => {
  it('accepts IDs, status URLs, and i/web URLs', () => {
    expect(normalizePostId(ID)).toBe(ID);
    expect(normalizePostId(`https://x.com/SpaceX/status/${ID}?s=20&t=abc`)).toBe(ID);
    expect(normalizePostId(`https://twitter.com/i/web/status/${ID}`)).toBe(ID);
    expect(normalizePostId('https://x.com/SpaceX')).toBeNull();
    expect(normalizePostId(42)).toBeNull();
  });
});

describe('getPost', () => {
  it('reads the GraphQL rail, including the typed user shape and views', async () => {
    stub([['guest/activate', guestOk], ['TweetResultByRestId', () => new Response(JSON.stringify(graphPost(ID)), { status: 200 })]]);
    const post = await getPost(`https://x.com/SpaceX/status/${ID}`);

    expect(post.source).toBe('graphql');
    expect(post.author).toMatchObject({ username: 'SpaceX', name: 'SpaceX', verified: true, verifiedType: 'Business' });
    expect(post.author.avatar).not.toContain('_normal');
    expect(post.metrics).toEqual({ likes: 10926, reposts: 1329, replies: 345, quotes: 158, bookmarks: 447, views: 1272673 });
    expect(post.entities).toEqual({
      hashtags: ['Starship'],
      symbols: [],
      mentions: ['NASA'],
      urls: [{ url: 'https://t.co/x', expanded: 'https://spacex.com', display: 'spacex.com' }],
    });
    expect(post.createdAt).toBe('2026-08-26T15:04:05.000Z');
  });

  it('returns video variants best first, without the HLS playlist or query strings', async () => {
    stub([['guest/activate', guestOk], ['TweetResultByRestId', () => new Response(JSON.stringify(graphPost(ID)), { status: 200 })]]);
    const post = await getPost(ID);

    const video = post.media[0];
    expect(video.type).toBe('video');
    expect(video.durationMs).toBe(28542);
    expect(video.variants.map((v) => v.quality)).toEqual(['4K', '360p']);
    expect(video.variants[0].url).toBe(`${CDN}/vid/avc1/3840x2160/b.mp4`);
    expect(video.variants.some((v) => v.url.includes('.m3u8'))).toBe(false);
  });

  it('falls back to syndication when the guest rail is rate-limited', async () => {
    stub([
      ['guest/activate', guestOk],
      ['TweetResultByRestId', () => new Response('', { status: 429 })],
      ['cdn.syndication.twimg.com', () => new Response(JSON.stringify({
        __typename: 'Tweet', id_str: ID, text: 'from syndication', created_at: '2026-08-26T15:04:05.000Z',
        user: { id_str: '1', screen_name: 'SpaceX', name: 'SpaceX' }, favorite_count: 5, conversation_count: 2,
        entities: {}, mediaDetails: [],
      }), { status: 200 })],
    ]);

    const post = await getPost(ID);
    expect(post.source).toBe('syndication');
    expect(post.text).toBe('from syndication');
    expect(post.metrics.likes).toBe(5);
  });

  it('reports a deleted post as not found without trying the other rail', async () => {
    const calls = stub([
      ['guest/activate', guestOk],
      ['TweetResultByRestId', () => new Response(JSON.stringify({ data: { tweetResult: { result: { __typename: 'TweetTombstone' } } } }), { status: 200 })],
    ]);
    await expect(getPost(ID)).rejects.toThrow(/unavailable/i);
    expect(calls.some((url) => url.includes('syndication'))).toBe(false);
  });

  it('rejects input that is not a post reference', async () => {
    await expect(getPost('https://x.com/SpaceX')).rejects.toThrow(/post ID or an x\.com status URL/);
  });
});

describe('getThread', () => {
  it('walks up to the root and continues through the author\'s own replies', async () => {
    const CHILD_ID = '2092648130856571299';
    stub([
      ['guest/activate', guestOk],
      ['TweetResultByRestId', (url) => {
        const requested = decodeURIComponent(url).match(/"tweetId":"(\d+)"/)[1];
        const replyTo = requested === ID ? PARENT_ID : requested === CHILD_ID ? ID : null;
        return new Response(JSON.stringify(graphPost(requested, { replyTo })), { status: 200 });
      }],
    ]);

    const thread = await getThread(ID, {
      timelineReader: async () => ({ tweets: [{ id: CHILD_ID, inReplyToStatusId: ID }] }),
    });

    expect(thread.posts.map((p) => p.id)).toEqual([PARENT_ID, ID, CHILD_ID]);
    expect(thread.focal.id).toBe(ID);
    expect(thread.author.username).toBe('SpaceX');
    expect(thread.truncated).toBe(false);
  });

  it('flags truncation instead of implying the thread ended', async () => {
    stub([
      ['guest/activate', guestOk],
      ['TweetResultByRestId', (url) => {
        const requested = decodeURIComponent(url).match(/"tweetId":"(\d+)"/)[1];
        return new Response(JSON.stringify(graphPost(requested, { replyTo: String(BigInt(requested) - 1n) })), { status: 200 });
      }],
    ]);

    const thread = await getThread(ID, { limit: 3, timelineReader: async () => ({ tweets: [] }) });
    expect(thread.posts).toHaveLength(3);
    expect(thread.truncated).toBe(true);
  });
});
