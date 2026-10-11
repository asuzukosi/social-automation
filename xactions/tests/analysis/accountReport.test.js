// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The account analyser is the one place in the codebase where a wrong number
 * is invisible: it looks like a plausible statistic either way. These tests
 * pin the arithmetic to worked examples so a regression shows up as a failing
 * assertion rather than as a confidently wrong report.
 *
 * The fixtures are synthetic and deterministic on purpose. Asserting against
 * live X data would make the suite fail whenever an account posts.
 */

import { describe, it, expect } from 'vitest';

import {
  buildAccountReport,
  compareReports,
  classifyPost,
  engagementOf,
  formatCount,
  median,
  mean,
  ratio,
  round,
  medianGapHours,
  topValues,
  tweetDate,
  WEEKDAYS,
} from '../../src/analysis/accountReport.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');

/**
 * @param {object} overrides
 * @returns {object}
 */
function profile(overrides = {}) {
  return {
    id: '1',
    username: 'testaccount',
    name: 'Test Account',
    bio: 'A fixture',
    followersCount: 10_000,
    followingCount: 500,
    tweetCount: 3650,
    listedCount: 40,
    joined: new Date('2016-07-31T12:00:00.000Z'),
    ...overrides,
  };
}

/**
 * @param {object} overrides
 * @returns {object}
 */
function tweet(overrides = {}) {
  return {
    id: '100',
    text: 'hello',
    username: 'testaccount',
    timeParsed: new Date('2026-07-30T10:00:00.000Z'),
    likes: 100,
    retweets: 10,
    replies: 5,
    views: 0,
    hashtags: [],
    mentions: [],
    urls: [],
    photos: [],
    videos: [],
    isRetweet: false,
    isReply: false,
    isQuote: false,
    ...overrides,
  };
}

describe('numeric helpers', () => {
  it('returns 0 rather than NaN or Infinity for empty or zero input', () => {
    expect(median([])).toBe(0);
    expect(mean([])).toBe(0);
    expect(ratio(5, 0)).toBe(0);
    expect(round(Number.NaN)).toBe(0);
    expect(round(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('takes the midpoint of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('does not mutate the list it is given', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it('is resistant to a single outlier, which the mean is not', () => {
    const posts = [10, 10, 10, 10, 100_000];
    expect(median(posts)).toBe(10);
    expect(mean(posts)).toBeGreaterThan(19_000);
  });
});

describe('formatCount', () => {
  it('abbreviates at the thresholds a reader expects', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1500)).toBe('1,500');
    expect(formatCount(15_000)).toBe('15K');
    expect(formatCount(2_400_000)).toBe('2.4M');
    expect(formatCount(3_100_000_000)).toBe('3.1B');
  });

  it('keeps two decimals for small ratios', () => {
    expect(formatCount(1.345)).toBe('1.35');
    expect(formatCount(0)).toBe('0');
  });
});

describe('tweetDate', () => {
  it('accepts a Date, an ISO string and a unix timestamp', () => {
    const iso = '2026-07-30T10:00:00.000Z';
    expect(tweetDate({ timeParsed: new Date(iso) }).toISOString()).toBe(iso);
    expect(tweetDate({ timeParsed: iso }).toISOString()).toBe(iso);
    expect(tweetDate({ timestamp: Date.parse(iso) / 1000 }).toISOString()).toBe(iso);
  });

  it('returns null for an undated or unparseable post', () => {
    expect(tweetDate({})).toBeNull();
    expect(tweetDate({ timeParsed: 'not a date' })).toBeNull();
    expect(tweetDate(null)).toBeNull();
  });
});

describe('classifyPost', () => {
  it('puts each post in exactly one bucket, retweet first', () => {
    expect(classifyPost({ isRetweet: true, isReply: true })).toBe('retweet');
    expect(classifyPost({ isReply: true, isQuote: true })).toBe('reply');
    expect(classifyPost({ isQuote: true })).toBe('quote');
    expect(classifyPost({})).toBe('original');
  });
});

describe('engagementOf', () => {
  it('sums the three public interaction counts and ignores views', () => {
    expect(engagementOf({ likes: 10, retweets: 5, replies: 2, views: 9999 })).toBe(17);
  });

  it('treats missing counters as zero', () => {
    expect(engagementOf({})).toBe(0);
  });
});

describe('medianGapHours', () => {
  it('needs two posts before a gap exists', () => {
    expect(medianGapHours([new Date()])).toBe(0);
  });

  it('is order independent', () => {
    const a = new Date('2026-07-30T00:00:00Z');
    const b = new Date('2026-07-30T04:00:00Z');
    const c = new Date('2026-07-30T06:00:00Z');
    expect(medianGapHours([a, b, c])).toBe(medianGapHours([c, a, b]));
    expect(medianGapHours([a, b, c])).toBe(3);
  });
});

describe('topValues', () => {
  it('counts case-insensitively but reports the original casing', () => {
    const result = topValues([['NASA', 'space'], ['nasa'], ['#NASA']]);
    expect(result[0]).toEqual({ value: 'NASA', count: 3 });
  });

  it('drops empty entries and honours the limit', () => {
    const result = topValues([['a', '', '  ', 'b', 'c']], 2);
    expect(result).toHaveLength(2);
  });
});

describe('buildAccountReport', () => {
  it('refuses input it cannot analyse', () => {
    expect(() => buildAccountReport({ profile: null })).toThrow(TypeError);
    expect(() => buildAccountReport({ profile: {} })).toThrow(/username/);
  });

  it('survives an account with no posts and says why', () => {
    const report = buildAccountReport({ profile: profile(), tweets: [], now: NOW });
    expect(report.meta.sampleSize).toBe(0);
    expect(report.engagement.rate).toBe(0);
    expect(report.output.postsPerDay).toBe(0);
    expect(report.timing.bestHourUTC).toBeNull();
    expect(report.signals).toHaveLength(1);
    expect(report.signals[0].title).toMatch(/No public posts/);
  });

  it('explains an empty sample differently for a protected account', () => {
    const report = buildAccountReport({ profile: profile({ protected: true }), tweets: [], now: NOW });
    expect(report.signals[0].detail).toMatch(/protected/);
  });

  it('excludes retweets from engagement so other people\'s reach is not credited', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1', likes: 100, retweets: 0, replies: 0 }),
        tweet({ id: '2', likes: 200, retweets: 0, replies: 0 }),
        tweet({ id: '3', likes: 1_000_000, retweets: 0, replies: 0, isRetweet: true }),
      ],
      now: NOW,
    });

    expect(report.mix.retweets).toBe(1);
    expect(report.engagement.medianPerOriginal).toBe(150);
    expect(report.engagement.bestPost).toBe(200);
  });

  it('computes the engagement rate against followers', () => {
    const report = buildAccountReport({
      profile: profile({ followersCount: 1000 }),
      tweets: [tweet({ likes: 20, retweets: 0, replies: 0 })],
      now: NOW,
    });
    expect(report.engagement.medianPerOriginal).toBe(20);
    expect(report.engagement.rate).toBe(2);
  });

  it('reports the content mix as percentages of the whole sample', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1' }),
        tweet({ id: '2', isReply: true }),
        tweet({ id: '3', isRetweet: true }),
        tweet({ id: '4', isQuote: true }),
      ],
      now: NOW,
    });

    expect(report.mix.originalShare).toBe(25);
    expect(report.mix.replyShare).toBe(25);
    expect(report.mix.retweetShare).toBe(25);
    expect(report.mix.quoteShare).toBe(25);
  });

  it('measures media, link and hashtag share over authored posts only', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1', photos: [{ url: 'a' }] }),
        tweet({ id: '2', urls: ['https://example.com'] }),
        tweet({ id: '3', isRetweet: true, photos: [{ url: 'b' }] }),
      ],
      now: NOW,
    });

    // Two authored posts, one with media and one with a link.
    expect(report.mix.mediaShare).toBe(50);
    expect(report.mix.linkShare).toBe(50);
    expect(report.mix.hashtagShare).toBe(0);
  });

  it('will not name a best hour without enough posts in it', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1', timeParsed: new Date('2026-07-30T03:00:00Z'), likes: 100_000 }),
        tweet({ id: '2', timeParsed: new Date('2026-07-29T09:00:00Z') }),
        tweet({ id: '3', timeParsed: new Date('2026-07-28T09:00:00Z') }),
      ],
      now: NOW,
    });

    // 03:00 has the runaway post but only one sample, so it cannot win.
    expect(report.timing.bestHourUTC).toBeNull();
  });

  it('names the best hour once a bucket clears the minimum sample', () => {
    const at = (day, hour, likes) =>
      tweet({
        id: `${day}${hour}`,
        timeParsed: new Date(Date.UTC(2026, 6, day, hour)),
        likes,
        retweets: 0,
        replies: 0,
      });

    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        at(20, 9, 500),
        at(21, 9, 600),
        at(22, 9, 700),
        at(20, 3, 10),
        at(21, 3, 12),
        at(22, 3, 14),
      ],
      now: NOW,
    });

    expect(report.timing.bestHourUTC).toBe(9);
    expect(report.timing.bestHourMedianEngagement).toBe(600);
    expect(report.timing.byHourUTC).toHaveLength(24);
    expect(report.timing.byWeekday).toHaveLength(7);
    expect(report.timing.byWeekday[0].label).toBe(WEEKDAYS[0]);
  });

  it('only reports a view rate over the posts that actually carry views', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1', likes: 10, retweets: 0, replies: 0, views: 1000 }),
        tweet({ id: '2', likes: 10, retweets: 0, replies: 0, views: 0 }),
      ],
      now: NOW,
    });

    expect(report.engagement.viewSampleSize).toBe(1);
    expect(report.engagement.medianViews).toBe(1000);
    expect(report.engagement.viewRate).toBe(1);
  });

  it('ranks top posts by engagement and links each one', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1', likes: 10 }),
        tweet({ id: '2', likes: 900 }),
        tweet({ id: '3', likes: 50 }),
      ],
      now: NOW,
    });

    expect(report.topPosts.map((p) => p.id)).toEqual(['2', '3', '1']);
    expect(report.topPosts[0].url).toBe('https://x.com/testaccount/status/2');
  });

  it('derives the sample window from the posts, not from the clock', () => {
    const report = buildAccountReport({
      profile: profile(),
      tweets: [
        tweet({ id: '1', timeParsed: new Date('2026-07-20T00:00:00Z') }),
        tweet({ id: '2', timeParsed: new Date('2026-07-30T00:00:00Z') }),
      ],
      now: NOW,
    });

    expect(report.meta.sampleSpanDays).toBe(10);
    expect(report.output.postsPerDay).toBe(0.2);
    expect(report.output.daysSinceLastPost).toBe(1.5);
  });

  it('marks itself as guest tier, which is the whole point', () => {
    const report = buildAccountReport({ profile: profile(), tweets: [tweet()], now: NOW });
    expect(report.meta.tier).toBe('guest');
    expect(report.meta.generatedAt).toBe(NOW.toISOString());
  });

  it('flags a low engagement rate on a large account', () => {
    const report = buildAccountReport({
      profile: profile({ followersCount: 5_000_000 }),
      tweets: [tweet({ likes: 10, retweets: 0, replies: 0 })],
      now: NOW,
    });
    // 10 interactions against 5M followers rounds to 0.000% at the precision
    // the report carries, so the observation has to key off the interaction
    // count rather than off the rounded rate.
    expect(report.engagement.rate).toBe(0);
    const watch = report.signals.find((s) => s.level === 'watch');
    expect(watch.title).toMatch(/Engagement rate below/);
    expect(watch.detail).toMatch(/10 interactions against 5M followers/);
  });
});

describe('compareReports', () => {
  const build = (username, followers, likes) =>
    buildAccountReport({
      profile: profile({ username, followersCount: followers }),
      tweets: [tweet({ likes, retweets: 0, replies: 0 })],
      now: NOW,
    });

  it('needs at least two reports', () => {
    expect(() => compareReports([build('a', 10, 1)])).toThrow(TypeError);
    expect(() => compareReports(null)).toThrow(TypeError);
  });

  it('names a leader per metric', () => {
    const result = compareReports([build('small', 1000, 100), build('big', 100_000, 200)]);

    expect(result.accounts).toHaveLength(2);
    expect(result.leaders.followers).toBe('big');
    // The smaller account converts a far larger share of its audience.
    expect(result.leaders.engagementRate).toBe('small');
    expect(result.leaders.medianEngagement).toBe('big');
  });

  it('carries the sample size so an uneven comparison is visible', () => {
    const result = compareReports([build('a', 10, 1), build('b', 20, 2)]);
    expect(result.accounts.every((a) => a.sampleSize === 1)).toBe(true);
  });
});
