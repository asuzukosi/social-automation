// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The engagement sweep engine.
 *
 * One implementation of "walk a feed and like, repost, and reply to what is
 * on it", shared by the `xactions engage` CLI command and the
 * `x_engage_profile` MCP tool. It runs on the HTTP client, so there is no
 * browser, no DOM, and no page Content-Security-Policy between it and an LLM
 * provider.
 *
 * The engine emits events rather than printing: the CLI renders them with
 * colour and spinners, the MCP tool collects them into a report, and a test
 * asserts on them directly.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

/** Feeds a sweep can run over. */
export const SOURCE_KINDS = Object.freeze(['profile', 'search', 'list']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Normalise the source options into one descriptor.
 *
 * Exactly one of username / search / list identifies the feed; passing more
 * than one is a mistake worth catching before a single write happens.
 *
 * @param {object} opts
 * @param {string} [opts.username] - Profile to sweep (with or without @)
 * @param {string} [opts.search] - Search query to sweep
 * @param {string} [opts.list] - List ID to sweep
 * @param {boolean} [opts.includeReplies=false] - Profile only: read the replies tab
 * @param {string} [opts.mode='Latest'] - Search only: Latest | Top
 * @returns {{ kind: string, username?: string, query?: string, listId?: string, includeReplies: boolean, mode: string, label: string, stateKey: string }}
 */
export function resolveSource(opts = {}) {
  const given = [
    opts.username ? 'username' : null,
    opts.search ? 'search' : null,
    opts.list ? 'list' : null,
  ].filter(Boolean);

  if (given.length === 0) {
    throw new Error('Nothing to sweep: pass a username, --search <query>, or --list <id>');
  }
  if (given.length > 1) {
    throw new Error(`Pick one source, not ${given.length}: ${given.join(' and ')} were all given`);
  }

  const includeReplies = Boolean(opts.includeReplies);
  const mode = opts.mode || 'Latest';

  if (opts.username) {
    const username = String(opts.username).replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
      throw new Error(`"${opts.username}" is not a valid X handle`);
    }
    return {
      kind: 'profile',
      username,
      includeReplies,
      mode,
      label: `@${username}${includeReplies ? ' (with replies)' : ''}`,
      stateKey: `profile-${username.toLowerCase()}`,
    };
  }

  if (opts.search) {
    const query = String(opts.search).trim();
    return {
      kind: 'search',
      query,
      includeReplies,
      mode,
      label: `search "${query}"`,
      stateKey: `search-${slug(query)}`,
    };
  }

  const listId = String(opts.list).trim();
  if (!/^\d+$/.test(listId)) {
    throw new Error(`"${opts.list}" is not a list ID. Take the digits from x.com/i/lists/<id>.`);
  }
  return {
    kind: 'list',
    listId,
    includeReplies,
    mode,
    label: `list ${listId}`,
    stateKey: `list-${listId}`,
  };
}

/**
 * A file-name-safe slug for a search query, short enough to stay readable.
 * @param {string} text
 * @returns {string}
 */
export function slug(text) {
  const cleaned = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned.slice(0, 48) || 'query';
}

/**
 * Read tweets from whichever feed the source names.
 *
 * @param {object} scraper - An xactions Scraper
 * @param {ReturnType<typeof resolveSource>} source
 * @param {number} count
 * @returns {AsyncIterable<object>}
 */
export function readSource(scraper, source, count) {
  if (source.kind === 'search') return scraper.searchTweets(source.query, count, source.mode);
  if (source.kind === 'list') return scraper.getListTweets(source.listId, count);
  return source.includeReplies
    ? scraper.getTweetsAndReplies(source.username, count)
    : scraper.getTweets(source.username, count);
}

/**
 * Total engagement on a tweet, used by the min/max filters.
 * @param {object} tweet
 * @returns {number}
 */
function likeCount(tweet) {
  return Number(tweet?.likes ?? tweet?.metrics?.likes ?? 0) || 0;
}

/**
 * Pick the posts a run should touch, and say why each rejected one was skipped.
 *
 * Every filter is evaluated in the order a person would apply them: what the
 * post is, who wrote it, what it says, then how much it already has. The
 * `why` strings are surfaced verbatim in the report, so a sweep that engages
 * nothing explains itself instead of looking broken.
 *
 * @param {object[]} tweets - Tweet models from the client
 * @param {object} opts
 * @param {{like:boolean, repost:boolean, comment:boolean}} opts.actions
 * @param {boolean} [opts.includeReplies=false]
 * @param {boolean} [opts.includeReposts=false]
 * @param {Date|null} [opts.since=null]
 * @param {number} [opts.limit=Infinity]
 * @param {Record<string, object>} [opts.done={}] - Prior state, keyed by tweet id
 * @param {string[]} [opts.onlyFrom=[]] - Only these authors (handles, no @)
 * @param {string[]} [opts.skipUsers=[]] - Never these authors
 * @param {string[]} [opts.keywords=[]] - Post must contain one of these
 * @param {string[]} [opts.skipKeywords=[]] - Post must contain none of these
 * @param {number} [opts.minLikes=0]
 * @param {number} [opts.maxLikes=0] - 0 means no ceiling
 * @param {string} [opts.self] - Your own handle, never engaged
 * @returns {{ selected: object[], skipped: Array<{ id: string, why: string }> }}
 */
export function selectTweets(tweets, opts) {
  const {
    actions,
    includeReplies = false,
    includeReposts = false,
    since = null,
    limit = Infinity,
    done = {},
    onlyFrom = [],
    skipUsers = [],
    keywords = [],
    skipKeywords = [],
    minLikes = 0,
    maxLikes = 0,
    self = '',
  } = opts;

  const lower = (list) => list.map((s) => String(s).replace(/^@/, '').toLowerCase());
  const only = lower(onlyFrom);
  const blocked = new Set(lower(skipUsers));
  const me = String(self).replace(/^@/, '').toLowerCase();
  const wants = keywords.map((k) => k.toLowerCase());
  const avoids = skipKeywords.map((k) => k.toLowerCase());

  const selected = [];
  const skipped = [];

  for (const tweet of tweets) {
    if (selected.length >= limit) break;
    if (!tweet?.id) continue;

    const author = String(tweet.username || '').toLowerCase();
    const text = String(tweet.text || '');
    const lowerText = text.toLowerCase();
    const push = (why) => skipped.push({ id: tweet.id, why });

    if (tweet.isRetweet && !includeReposts) { push('repost'); continue; }
    if (tweet.isReply && !includeReplies) { push('reply'); continue; }
    if (me && author === me) { push('your own post'); continue; }
    if (blocked.has(author)) { push(`author @${author} is on the skip list`); continue; }
    if (only.length > 0 && !only.includes(author)) { push(`author @${author} is not on the only-from list`); continue; }
    if (since && tweet.timeParsed && new Date(tweet.timeParsed) < since) { push('older than --since'); continue; }
    if (wants.length > 0 && !wants.some((k) => lowerText.includes(k))) { push('no keyword match'); continue; }
    if (avoids.length > 0 && avoids.some((k) => lowerText.includes(k))) { push('matched a skip keyword'); continue; }

    const likes = likeCount(tweet);
    if (minLikes && likes < minLikes) { push(`only ${likes} likes, below the floor`); continue; }
    if (maxLikes && likes > maxLikes) { push(`${likes} likes, above the ceiling`); continue; }

    const record = done[tweet.id];
    if (record) {
      const remaining = (actions.like && !record.liked) || (actions.repost && !record.reposted) || (actions.comment && !record.commented);
      if (!remaining) { push('already done'); continue; }
    }

    if (!text && !(tweet.photos?.length || tweet.videos?.length)) { push('empty'); continue; }

    selected.push(tweet);
  }

  return { selected, skipped };
}

/**
 * Parse reply templates from repeated flags and an optional file.
 * One template per line; blank lines and `#` comments are ignored.
 *
 * @param {string[]} [fromFlags=[]]
 * @param {string} [fileContents='']
 * @returns {string[]}
 */
export function parseTemplates(fromFlags = [], fileContents = '') {
  const lines = String(fileContents).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  return [...fromFlags.map((t) => String(t).trim()).filter(Boolean), ...lines];
}

/**
 * Choose the next template, never the same one twice in a row, and fill in
 * the placeholders.
 *
 * @param {string[]} templates
 * @param {{ username?: string, name?: string }} tweet
 * @param {number} lastIndex
 * @param {() => number} [random=Math.random]
 * @returns {{ text: string, index: number }}
 */
export function pickTemplate(templates, tweet, lastIndex, random = Math.random) {
  if (templates.length === 0) return { text: '', index: -1 };
  let index = 0;
  if (templates.length > 1) {
    do { index = Math.floor(random() * templates.length); } while (index === lastIndex);
  }
  const text = templates[index]
    .replace(/\{author\}/g, `@${tweet.username || ''}`)
    .replace(/\{name\}/g, tweet.name || (tweet.username ? `@${tweet.username}` : ''));
  return { text, index };
}

/** Milliseconds to wait before the next post: base plus symmetric jitter. */
export function nextDelay(baseSeconds, jitterSeconds, random = Math.random) {
  const spread = (random() * 2 - 1) * jitterSeconds;
  return Math.max(1000, Math.round((baseSeconds + spread) * 1000));
}

/**
 * True when an error is X telling us to slow down.
 * @param {Error} err
 * @returns {boolean}
 */
export function isRateLimit(err) {
  return err?.name === 'RateLimitError' || /rate limit|too many requests|429/i.test(err?.message || '');
}

/**
 * Read enough of the feed to fill the run after filtering.
 *
 * Reading exactly `limit` posts starves a filtered sweep: on a profile where
 * four in five posts are replies, a limit of 20 would engage four. This reads
 * a multiple and stops as soon as the quota is genuinely filled.
 *
 * @param {object} scraper
 * @param {ReturnType<typeof resolveSource>} source
 * @param {object} filters - Passed through to selectTweets
 * @param {number} limit
 * @param {(count: number) => void} [onProgress]
 * @returns {Promise<{ fetched: object[], selected: object[], skipped: Array<{id:string,why:string}> }>}
 */
export async function collectTweets(scraper, source, filters, limit, onProgress) {
  const readLimit = Math.min(3000, Math.max(limit * 3, limit + 20));
  const fetched = [];
  let outcome = { selected: [], skipped: [] };

  for await (const tweet of readSource(scraper, source, readLimit)) {
    fetched.push(tweet);
    if (onProgress) onProgress(fetched.length);
    outcome = selectTweets(fetched, { ...filters, limit });
    if (outcome.selected.length >= limit) break;
    if (fetched.length >= readLimit) break;
  }

  if (fetched.length > 0 && outcome.selected.length === 0) {
    outcome = selectTweets(fetched, { ...filters, limit });
  }
  return { fetched, ...outcome };
}

/**
 * Run the sweep.
 *
 * @param {object} options
 * @param {object} options.scraper - Authenticated xactions Scraper
 * @param {ReturnType<typeof resolveSource>} options.source
 * @param {object[]} options.tweets - Already-selected tweets, in order
 * @param {{like:boolean, repost:boolean, comment:boolean}} options.actions
 * @param {Record<string, object>} [options.done={}] - Prior state, mutated as the run proceeds
 * @param {string[]} [options.templates=[]]
 * @param {{ generate: Function }|null} [options.generator=null] - From createCommentGenerator
 * @param {boolean} [options.fallbackToTemplates=true]
 * @param {boolean} [options.dryRun=false]
 * @param {number} [options.delay=20] - Seconds between posts
 * @param {number} [options.jitter=10]
 * @param {(event: object) => void} [options.onEvent] - Progress events
 * @param {(id: string, record: object) => Promise<void>|void} [options.onProgressSaved] - Called after each post
 * @param {() => boolean} [options.shouldStop] - Return true to end the run early
 * @param {(ms: number) => Promise<void>} [options.wait=sleep] - Injectable for tests
 * @returns {Promise<object>} Report
 */
export async function runEngage(options) {
  const {
    scraper,
    source,
    tweets,
    actions,
    done = {},
    templates = [],
    generator = null,
    fallbackToTemplates = true,
    dryRun = false,
    delay = 20,
    jitter = 10,
    onEvent = () => {},
    onProgressSaved,
    shouldStop,
    wait = sleep,
  } = options;

  const report = {
    source: source.label,
    kind: source.kind,
    dryRun,
    actions,
    processed: 0,
    liked: 0,
    reposted: 0,
    commented: 0,
    failed: 0,
    stoppedEarly: false,
    results: [],
  };

  let lastTemplate = -1;

  for (let i = 0; i < tweets.length; i++) {
    if (shouldStop && shouldStop()) { report.stoppedEarly = true; break; }

    const tweet = tweets[i];
    const record = done[tweet.id] || { liked: false, reposted: false, commented: false };
    const preview = String(tweet.text || '').replace(/\s+/g, ' ').slice(0, 120);
    const result = {
      id: tweet.id,
      url: `https://x.com/${tweet.username || 'i/web'}/status/${tweet.id}`,
      author: tweet.username || '',
      text: preview,
      actions: [],
      errors: [],
    };

    onEvent({ type: 'post', index: i, total: tweets.length, tweet, preview });

    const step = async (name, wanted, fn) => {
      if (!wanted) return;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const detail = await fn();
          result.actions.push(name);
          if (detail?.text) result.comment = detail.text;
          if (detail?.source) result.commentSource = detail.source;
          onEvent({ type: 'action', action: name, dryRun, detail, tweetId: tweet.id });
          return;
        } catch (err) {
          if (isRateLimit(err) && attempt === 0) {
            const waitSec = Math.min(900, Math.max(60, err.retryAfter || 300));
            onEvent({ type: 'ratelimit', action: name, waitSeconds: waitSec, tweetId: tweet.id });
            await wait(waitSec * 1000);
            continue;
          }
          result.errors.push(`${name}: ${err.message}`);
          onEvent({ type: 'error', action: name, message: err.message, tweetId: tweet.id });
          return;
        }
      }
    };

    await step('like', actions.like && !record.liked, async () => {
      if (dryRun) return { line: 'would like' };
      await scraper.likeTweet(tweet.id);
      record.liked = true;
      report.liked++;
      return { line: 'liked' };
    });

    await step('repost', actions.repost && !record.reposted, async () => {
      if (dryRun) return { line: 'would repost' };
      await scraper.retweet(tweet.id);
      record.reposted = true;
      report.reposted++;
      return { line: 'reposted' };
    });

    await step('comment', actions.comment && !record.commented, async () => {
      let text = '';
      let commentSource = 'template';
      if (generator) {
        try {
          const gen = await generator.generate({
            text: tweet.text,
            author: tweet.username,
            authorName: tweet.name,
            quotedText: tweet.quotedStatus?.text,
            hasMedia: Boolean(tweet.photos?.length || tweet.videos?.length),
          });
          text = gen.text;
          commentSource = gen.attempts > 1 ? 'ai (2nd try)' : 'ai';
        } catch (err) {
          if (!fallbackToTemplates || templates.length === 0) throw err;
          onEvent({ type: 'fallback', message: err.message, tweetId: tweet.id });
        }
      }
      if (!text) {
        const picked = pickTemplate(templates, tweet, lastTemplate);
        lastTemplate = picked.index;
        text = picked.text;
      }
      if (!text) throw new Error('no comment text available');
      if (dryRun) return { text, source: commentSource, line: 'would reply' };
      await scraper.sendTweet(text, { replyTo: tweet.id });
      record.commented = true;
      report.commented++;
      return { text, source: commentSource, line: 'replied' };
    });

    report.processed++;
    if (result.errors.length) report.failed++;
    report.results.push(result);

    if (!dryRun) {
      record.at = new Date().toISOString();
      done[tweet.id] = record;
      if (onProgressSaved) await onProgressSaved(tweet.id, record);
    }

    if (i < tweets.length - 1) {
      const ms = nextDelay(delay, jitter);
      onEvent({ type: 'wait', ms });
      await wait(ms);
    }
  }

  return report;
}
