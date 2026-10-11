// GENERATED FILE. Do not edit.
// Source: src/analysis/accountReport.js
// Rebuild: npm run build:playground

// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Analysis - Account Report
 *
 * Turns a public profile plus a sample of its timeline into a quantified
 * report: engagement rates, posting cadence, content mix, the hours and
 * weekdays that actually perform, and the posts that carried the account.
 *
 * Everything here is pure. It takes data in and returns a plain object, so
 * the same numbers back the CLI (`xactions report`), the MCP tool
 * (`x_account_report`), and the web playground. One implementation means the
 * three surfaces can never disagree about what an engagement rate is.
 *
 * The whole report is computable from the guest tier, which is the point: no
 * login, no API key, no account. Profile and user timeline are the only two
 * endpoints X still serves to a logged-out client.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://github.com/nirholas/XActions
 * @license Apache-2.0
 */

const HOURS_PER_DAY = 24;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Weekday labels, indexed to match `Date.prototype.getUTCDay()`. */
export const WEEKDAYS = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]);

/**
 * A timing bucket needs at least this many posts before its median is allowed
 * to name a "best" hour or weekday. One lucky post in a quiet hour otherwise
 * wins every time, which is the classic way these reports lie.
 */
const MIN_BUCKET_SAMPLE = 3;

/**
 * Arithmetic mean, rounded to `places`.
 * @param {number[]} values
 * @param {number} [places=2]
 * @returns {number} 0 for an empty list
 */
export function mean(values, places = 2) {
  if (!values.length) return 0;
  const total = values.reduce((sum, n) => sum + n, 0);
  return round(total / values.length, places);
}

/**
 * Median of a numeric list. Does not mutate the input.
 * @param {number[]} values
 * @returns {number} 0 for an empty list
 */
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Round to a fixed number of decimal places without float drift artefacts.
 * @param {number} value
 * @param {number} [places=2]
 * @returns {number}
 */
export function round(value, places = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Divide safely. A zero or missing denominator yields 0 rather than
 * Infinity or NaN, both of which serialise to junk in JSON.
 * @param {number} numerator
 * @param {number} denominator
 * @param {number} [places=2]
 * @returns {number}
 */
export function ratio(numerator, denominator, places = 2) {
  if (!denominator) return 0;
  return round(numerator / denominator, places);
}

/**
 * Resolve a tweet's post time to a Date, whatever shape the parser produced.
 *
 * `timeParsed` is a Date, `timestamp` is seconds since the epoch, and some
 * transports (JSON over the wire, a cached report) hand back an ISO string.
 * All three appear in practice.
 *
 * @param {object} tweet
 * @returns {Date|null} null when the tweet carries no usable time
 */
export function tweetDate(tweet) {
  if (tweet?.timeParsed instanceof Date && !Number.isNaN(tweet.timeParsed.getTime())) {
    return tweet.timeParsed;
  }
  if (typeof tweet?.timeParsed === 'string') {
    const parsed = new Date(tweet.timeParsed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (Number.isFinite(tweet?.timestamp)) {
    const parsed = new Date(tweet.timestamp * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * Total public interactions on a post.
 *
 * Views are deliberately excluded: X reports them for recent posts only, so
 * including them would make old posts look worse purely because the metric
 * did not exist yet.
 *
 * @param {object} tweet
 * @returns {number}
 */
export function engagementOf(tweet) {
  return (tweet?.likes || 0) + (tweet?.retweets || 0) + (tweet?.replies || 0);
}

/**
 * Classify a post into exactly one content bucket.
 * Order matters: a retweet of a reply is a retweet, not a reply.
 * @param {object} tweet
 * @returns {'retweet'|'reply'|'quote'|'original'}
 */
export function classifyPost(tweet) {
  if (tweet?.isRetweet) return 'retweet';
  if (tweet?.isReply) return 'reply';
  if (tweet?.isQuote) return 'quote';
  return 'original';
}

/**
 * Count list entries into a descending frequency table.
 * @param {string[][]} lists - One list per post
 * @param {number} [limit=8]
 * @returns {Array<{value: string, count: number}>}
 */
export function topValues(lists, limit = 8) {
  const counts = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const value = raw.trim().replace(/^[#@]/, '');
      if (!value) continue;
      const key = value.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { value, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, limit);
}

/**
 * Bucket posts by a key function and summarise each bucket.
 *
 * @param {object[]} posts
 * @param {(date: Date) => number} keyOf - Bucket index from a post's date
 * @param {number} size - Number of buckets
 * @returns {Array<{index: number, posts: number, medianEngagement: number, totalEngagement: number}>}
 */
function bucketByTime(posts, keyOf, size) {
  const buckets = Array.from({ length: size }, (_, index) => ({ index, values: [] }));
  for (const post of posts) {
    const date = tweetDate(post);
    if (!date) continue;
    buckets[keyOf(date)].values.push(engagementOf(post));
  }
  return buckets.map(({ index, values }) => ({
    index,
    posts: values.length,
    medianEngagement: round(median(values)),
    totalEngagement: values.reduce((sum, n) => sum + n, 0),
  }));
}

/**
 * Pick the best-performing bucket by median engagement, ignoring buckets with
 * too small a sample to mean anything.
 * @param {Array<{index: number, posts: number, medianEngagement: number}>} buckets
 * @returns {{index: number, posts: number, medianEngagement: number}|null}
 */
function bestBucket(buckets) {
  const eligible = buckets.filter((b) => b.posts >= MIN_BUCKET_SAMPLE);
  if (!eligible.length) return null;
  return eligible.reduce((best, b) => (b.medianEngagement > best.medianEngagement ? b : best));
}

/**
 * Median hours between consecutive posts, which describes cadence far better
 * than a mean does when an account posts in bursts.
 * @param {Date[]} dates - Any order
 * @returns {number} 0 when there are fewer than two dated posts
 */
export function medianGapHours(dates) {
  if (dates.length < 2) return 0;
  const sorted = [...dates].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push((sorted[i] - sorted[i - 1]) / MS_PER_HOUR);
  }
  return round(median(gaps));
}

/**
 * Derive plain-language observations from the computed numbers.
 *
 * These are descriptive, not prescriptive. Each one names the figure it came
 * from so a reader can check it rather than take it on faith.
 *
 * @param {object} report - The report being built, minus `signals`
 * @returns {Array<{level: 'good'|'watch'|'info', title: string, detail: string}>}
 */
function deriveSignals(report) {
  const signals = [];
  const { audience, output, engagement, mix, meta, timing } = report;

  if (meta.sampleSize === 0) {
    signals.push({
      level: 'info',
      title: 'No public posts in the sample',
      detail:
        report.identity.protected
          ? 'This account is protected, so X serves no timeline to a logged-out client.'
          : 'X returned no timeline posts. The account may have never posted, or may have deleted its history.',
    });
    return signals;
  }

  if (audience.followerRatio >= 2) {
    signals.push({
      level: 'good',
      title: 'Followed far more than it follows',
      detail: `${formatCount(audience.followers)} followers against ${formatCount(audience.following)} following is a ratio of ${audience.followerRatio}, which reads as an account people seek out.`,
    });
  } else if (audience.following > 1000 && audience.followerRatio < 1) {
    signals.push({
      level: 'watch',
      title: 'Follows more accounts than follow back',
      detail: `A ratio of ${audience.followerRatio} across ${formatCount(audience.following)} follows is the pattern of follow-for-follow growth rather than pull.`,
    });
  }

  if (engagement.rate >= 1) {
    signals.push({
      level: 'good',
      title: `Engagement rate of ${engagement.rate}%`,
      detail: `A median original post draws ${formatCount(engagement.medianPerOriginal)} interactions against ${formatCount(audience.followers)} followers. Anything above 1% is strong at this size.`,
    });
  } else if (engagement.rate > 0 && engagement.rate < 0.1 && audience.followers > 10_000) {
    signals.push({
      level: 'watch',
      title: `Engagement rate of ${engagement.rate}%`,
      detail: 'Below 0.1% at this follower count usually means reach is being throttled, the audience is stale, or the follower number is inflated.',
    });
  }

  if (mix.retweetShare >= 50) {
    signals.push({
      level: 'watch',
      title: `${mix.retweetShare}% of the timeline is retweets`,
      detail: 'Most of what this account publishes is other people\'s work, so treat the timeline as a curation feed rather than original output.',
    });
  }

  if (mix.replyShare >= 40) {
    signals.push({
      level: 'info',
      title: `${mix.replyShare}% of posts are replies`,
      detail: 'This is a conversational account. Replies reach a narrower audience than top-level posts, which usually depresses the headline engagement rate.',
    });
  }

  if (mix.mediaShare >= 50) {
    signals.push({
      level: 'good',
      title: `${mix.mediaShare}% of posts carry media`,
      detail: 'Image and video posts consistently out-reach text-only posts on X.',
    });
  }

  if (output.postsPerDay >= 10) {
    signals.push({
      level: 'info',
      title: `About ${output.postsPerDay} posts a day`,
      detail: `Measured across the ${meta.sampleSpanDays}-day window this sample covers. A median gap of ${output.medianGapHours} hours between posts.`,
    });
  } else if (output.postsPerDay > 0 && output.postsPerDay < 0.2) {
    signals.push({
      level: 'watch',
      title: 'Posts less than once every five days',
      detail: `The ${meta.sampleSize} sampled posts span ${meta.sampleSpanDays} days. Infrequent posting tends to compound into lower reach per post.`,
    });
  }

  if (timing.bestHourUTC !== null) {
    signals.push({
      level: 'info',
      title: `Best hour is ${String(timing.bestHourUTC).padStart(2, '0')}:00 UTC`,
      detail: `Posts in that hour carry a median of ${formatCount(timing.bestHourMedianEngagement)} interactions, against ${formatCount(engagement.medianPerPost)} across all sampled posts.`,
    });
  }

  if (audience.followersPerDay >= 100) {
    signals.push({
      level: 'good',
      title: `Averaging ${formatCount(audience.followersPerDay)} new followers a day`,
      detail: `Lifetime average across ${formatCount(audience.accountAgeDays)} days since ${report.identity.joined?.slice(0, 10) || 'the account opened'}. It is an average, so it flattens any spike.`,
    });
  }

  return signals;
}

/**
 * Format a number the way a person would read it aloud.
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
  const value = Number(n) || 0;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${round(value / 1_000_000_000, 1)}B`;
  if (abs >= 1_000_000) return `${round(value / 1_000_000, 1)}M`;
  if (abs >= 10_000) return `${round(value / 1000, 1)}K`;
  if (abs >= 1000) return value.toLocaleString('en-US');
  return String(round(value, 2));
}

/**
 * Build the full account report.
 *
 * @param {object} input
 * @param {object} input.profile - A Profile, or any object with its fields
 * @param {object[]} [input.tweets=[]] - Timeline sample, newest first or any order
 * @param {Date} [input.now] - Injectable clock, so tests are deterministic
 * @returns {object} The report
 */
export function buildAccountReport({ profile, tweets = [], now = new Date() }) {
  if (!profile || !profile.username) {
    throw new TypeError('buildAccountReport requires a profile with a username');
  }

  const posts = Array.isArray(tweets) ? tweets.filter(Boolean) : [];
  const dates = posts.map(tweetDate).filter(Boolean);
  const newest = dates.length ? new Date(Math.max(...dates)) : null;
  const oldest = dates.length ? new Date(Math.min(...dates)) : null;
  const spanDays = newest && oldest ? Math.max(round((newest - oldest) / MS_PER_DAY, 1), 0) : 0;

  const joined = profile.joined ? new Date(profile.joined) : null;
  const accountAgeDays =
    joined && !Number.isNaN(joined.getTime()) ? Math.max(Math.round((now - joined) / MS_PER_DAY), 1) : 0;

  const byKind = { original: [], reply: [], retweet: [], quote: [] };
  for (const post of posts) byKind[classifyPost(post)].push(post);

  // Retweets carry the original author's numbers, so counting them as this
  // account's engagement would credit it with other people's reach.
  const authored = [...byKind.original, ...byKind.reply, ...byKind.quote];
  const originals = byKind.original;

  const originalEngagements = originals.map(engagementOf);
  const authoredEngagements = authored.map(engagementOf);
  const withViews = authored.filter((t) => (t.views || 0) > 0);

  const followers = profile.followersCount || 0;
  const following = profile.followingCount || 0;

  const hourBuckets = bucketByTime(authored, (d) => d.getUTCHours(), HOURS_PER_DAY);
  const weekdayBuckets = bucketByTime(authored, (d) => d.getUTCDay(), WEEKDAYS.length);
  const bestHour = bestBucket(hourBuckets);
  const bestWeekday = bestBucket(weekdayBuckets);

  const medianOriginal = round(median(originalEngagements));

  const report = {
    identity: {
      username: profile.username,
      name: profile.name || profile.username,
      bio: profile.bio || '',
      location: profile.location || '',
      website: profile.website || '',
      avatar: profile.avatar || '',
      banner: profile.banner || '',
      verified: Boolean(profile.verified || profile.isBlueVerified),
      protected: Boolean(profile.protected),
      joined: joined && !Number.isNaN(joined.getTime()) ? joined.toISOString() : null,
      url: `https://x.com/${profile.username}`,
    },
    audience: {
      followers,
      following,
      listed: profile.listedCount || 0,
      followerRatio: ratio(followers, following),
      accountAgeDays,
      followersPerDay: accountAgeDays ? round(followers / accountAgeDays, 1) : 0,
    },
    output: {
      lifetimePosts: profile.tweetCount || 0,
      lifetimePostsPerDay: accountAgeDays ? round((profile.tweetCount || 0) / accountAgeDays, 2) : 0,
      postsPerDay: spanDays > 0 ? round(posts.length / spanDays, 2) : 0,
      medianGapHours: medianGapHours(dates),
      newestPost: newest ? newest.toISOString() : null,
      oldestPost: oldest ? oldest.toISOString() : null,
      daysSinceLastPost: newest ? round((now - newest) / MS_PER_DAY, 1) : null,
    },
    engagement: {
      medianPerPost: round(median(authoredEngagements)),
      medianPerOriginal: medianOriginal,
      meanPerOriginal: mean(originalEngagements),
      bestPost: originalEngagements.length ? Math.max(...originalEngagements) : 0,
      medianLikes: round(median(originals.map((t) => t.likes || 0))),
      medianRetweets: round(median(originals.map((t) => t.retweets || 0))),
      medianReplies: round(median(originals.map((t) => t.replies || 0))),
      // Percentage of the follower base that interacts with a median original.
      rate: followers ? round((medianOriginal / followers) * 100, 3) : 0,
      // Only meaningful where X reported views, so the sample is stated.
      medianViews: round(median(withViews.map((t) => t.views || 0))),
      viewRate: withViews.length
        ? round((median(withViews.map(engagementOf)) / median(withViews.map((t) => t.views || 0))) * 100, 2)
        : 0,
      viewSampleSize: withViews.length,
    },
    mix: {
      originals: originals.length,
      replies: byKind.reply.length,
      retweets: byKind.retweet.length,
      quotes: byKind.quote.length,
      originalShare: posts.length ? round((originals.length / posts.length) * 100, 1) : 0,
      replyShare: posts.length ? round((byKind.reply.length / posts.length) * 100, 1) : 0,
      retweetShare: posts.length ? round((byKind.retweet.length / posts.length) * 100, 1) : 0,
      quoteShare: posts.length ? round((byKind.quote.length / posts.length) * 100, 1) : 0,
      mediaShare: authored.length
        ? round(
            (authored.filter((t) => (t.photos?.length || 0) + (t.videos?.length || 0) > 0).length / authored.length) *
              100,
            1
          )
        : 0,
      linkShare: authored.length
        ? round((authored.filter((t) => (t.urls?.length || 0) > 0).length / authored.length) * 100, 1)
        : 0,
      hashtagShare: authored.length
        ? round((authored.filter((t) => (t.hashtags?.length || 0) > 0).length / authored.length) * 100, 1)
        : 0,
    },
    timing: {
      byHourUTC: hourBuckets,
      byWeekday: weekdayBuckets.map((b) => ({ ...b, label: WEEKDAYS[b.index] })),
      bestHourUTC: bestHour ? bestHour.index : null,
      bestHourMedianEngagement: bestHour ? bestHour.medianEngagement : 0,
      bestWeekday: bestWeekday ? WEEKDAYS[bestWeekday.index] : null,
      bestWeekdayMedianEngagement: bestWeekday ? bestWeekday.medianEngagement : 0,
      minimumBucketSample: MIN_BUCKET_SAMPLE,
    },
    topPosts: [...authored]
      .sort((a, b) => engagementOf(b) - engagementOf(a))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        text: t.text || t.fullText || '',
        url: `https://x.com/${profile.username}/status/${t.id}`,
        likes: t.likes || 0,
        retweets: t.retweets || 0,
        replies: t.replies || 0,
        views: t.views || 0,
        engagement: engagementOf(t),
        kind: classifyPost(t),
        postedAt: tweetDate(t)?.toISOString() || null,
        hasMedia: (t.photos?.length || 0) + (t.videos?.length || 0) > 0,
      })),
    topHashtags: topValues(authored.map((t) => t.hashtags || [])),
    topMentions: topValues(authored.map((t) => t.mentions || [])),
    meta: {
      sampleSize: posts.length,
      sampleSpanDays: spanDays,
      datedPosts: dates.length,
      tier: 'guest',
      generatedAt: now.toISOString(),
      source: 'x.com public GraphQL, no session',
    },
  };

  report.signals = deriveSignals(report);
  return report;
}

/**
 * Compare two or more reports on the fields that survive a like-for-like
 * comparison. Anything that depends on sample size is reported alongside the
 * sample so a reader can see when a comparison is uneven.
 *
 * @param {object[]} reports - Output of buildAccountReport
 * @returns {{accounts: object[], leaders: Record<string, string>}}
 */
export function compareReports(reports) {
  if (!Array.isArray(reports) || reports.length < 2) {
    throw new TypeError('compareReports needs at least two reports');
  }

  const accounts = reports.map((r) => ({
    username: r.identity.username,
    name: r.identity.name,
    avatar: r.identity.avatar,
    verified: r.identity.verified,
    followers: r.audience.followers,
    following: r.audience.following,
    followerRatio: r.audience.followerRatio,
    followersPerDay: r.audience.followersPerDay,
    accountAgeDays: r.audience.accountAgeDays,
    lifetimePosts: r.output.lifetimePosts,
    postsPerDay: r.output.postsPerDay,
    medianEngagement: r.engagement.medianPerOriginal,
    engagementRate: r.engagement.rate,
    mediaShare: r.mix.mediaShare,
    originalShare: r.mix.originalShare,
    sampleSize: r.meta.sampleSize,
  }));

  /**
   * @param {string} field
   * @returns {string} Username of the account leading on that field
   */
  const leaderOn = (field) =>
    accounts.reduce((best, a) => (a[field] > best[field] ? a : best)).username;

  return {
    accounts,
    leaders: {
      followers: leaderOn('followers'),
      followerRatio: leaderOn('followerRatio'),
      followersPerDay: leaderOn('followersPerDay'),
      medianEngagement: leaderOn('medianEngagement'),
      engagementRate: leaderOn('engagementRate'),
      postsPerDay: leaderOn('postsPerDay'),
      mediaShare: leaderOn('mediaShare'),
    },
  };
}
