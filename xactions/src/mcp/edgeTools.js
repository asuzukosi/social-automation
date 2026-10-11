// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The tools the hosted XActions MCP server exposes at https://xactions.app/mcp.
 *
 * Every one of them reads public X data with no account, no API key and no
 * browser, through the same credential-free rails the site's own endpoints use.
 * A tool is a plain object with a JSON Schema and a handler, so the transport
 * (`functions/mcp/[[route]].js`) stays a transport and this file stays testable
 * without a network or a server.
 *
 * Handlers return `{ text, data }`. The server wraps `text` as the model-facing
 * content block and `data` as `structuredContent`, so a client that understands
 * structured tool output gets typed JSON and an older one still gets prose.
 *
 * @module src/mcp/edgeTools
 * @author nichxbt
 */

import { getProfile, getTweets, normalizeHandle, statusForError } from '../edge/twitterClient.js';
import { getPost, getThread, normalizePostId } from '../edge/postReader.js';
import { extractTweetVideo } from '../video/edgeExtractor.js';

const SITE = 'https://xactions.app';

/** Input rejected before a network call: the message is for a model to act on. */
export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolInputError';
  }
}

function requireHandle(input, field = 'handle') {
  const handle = normalizeHandle(input);
  if (!handle) {
    throw new ToolInputError(`${field} must be an X handle, @handle, or profile URL. Got: ${JSON.stringify(input)}`);
  }
  return handle;
}

function requirePostId(input, field = 'post') {
  const id = normalizePostId(input);
  if (!id) {
    throw new ToolInputError(`${field} must be a post ID or an x.com status URL. Got: ${JSON.stringify(input)}`);
  }
  return id;
}

function clamp(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
}

function compactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function postLine(post) {
  const when = post.createdAt ? post.createdAt.slice(0, 10) : 'unknown date';
  const stats = `${compactNumber(post.metrics.likes)} likes, ${compactNumber(post.metrics.reposts)} reposts`;
  const media = post.media.length ? ` [${post.media.map((m) => m.type).join(', ')}]` : '';
  return `- ${when} ${post.url}${media}\n  ${post.text.replace(/\s+/g, ' ').trim()}\n  ${stats}`;
}

/**
 * Timeline entries come from the scraper parser, which uses its own field
 * names. Flatten them to the shape the tool documents.
 */
function timelinePost(tweet) {
  return {
    id: String(tweet.id ?? tweet.id_str ?? ''),
    url: tweet.url || `https://x.com/i/web/status/${tweet.id ?? tweet.id_str}`,
    createdAt: tweet.createdAt || tweet.created_at || null,
    text: tweet.text || tweet.full_text || '',
    metrics: {
      likes: Number(tweet.likes ?? tweet.favorite_count ?? 0),
      reposts: Number(tweet.retweets ?? tweet.retweet_count ?? 0),
      replies: Number(tweet.replies ?? tweet.reply_count ?? 0),
      views: Number(tweet.views ?? 0),
    },
    isReply: Boolean(tweet.inReplyToStatusId || tweet.in_reply_to_status_id_str),
    media: tweet.media || [],
  };
}

export const EDGE_TOOLS = [
  {
    name: 'x_profile',
    title: 'Read an X profile',
    description:
      'Public profile for one X/Twitter account: display name, bio, location, website, join date, follower and following counts, post count, avatar and banner, verification, and pinned post. Accepts a handle, @handle, or profile URL. No API key, no login.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Handle, @handle, or profile URL. Example: "nasa", "@nasa", "https://x.com/nasa".' },
      },
      required: ['handle'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler({ handle }) {
      const username = requireHandle(handle);
      const profile = await getProfile(username);
      const text = [
        `@${profile.username} (${profile.name})`,
        profile.description || '',
        `${compactNumber(profile.followers)} followers, ${compactNumber(profile.following)} following, ${compactNumber(profile.tweets)} posts`,
        profile.location ? `Location: ${profile.location}` : '',
        profile.website ? `Website: ${profile.website}` : '',
        profile.createdAt ? `Joined: ${String(profile.createdAt).slice(0, 10)}` : '',
        `https://x.com/${profile.username}`,
      ].filter(Boolean).join('\n');
      return { text, data: { profile } };
    },
  },

  {
    name: 'x_posts',
    title: 'Read an account\'s recent posts',
    description:
      'The most recent posts from one X/Twitter account, newest first, with text, timestamps, engagement metrics, and media. Use this to see what someone has been posting about before writing about them or replying to them.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Handle, @handle, or profile URL.' },
        limit: { type: 'integer', description: 'How many posts to return, 1 to 100. Default 20.', minimum: 1, maximum: 100 },
      },
      required: ['handle'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler({ handle, limit }) {
      const username = requireHandle(handle);
      const count = clamp(limit, 20, 100);
      const { user, tweets } = await getTweets(username, { limit: count });
      const posts = tweets.map(timelinePost);
      const text = posts.length
        ? `${posts.length} recent posts from @${username}:\n\n${posts.map((post) => postLine({ ...post, media: post.media })).join('\n\n')}`
        : `@${username} has no public posts to show.`;
      return { text, data: { handle: username, count: posts.length, user, posts } };
    },
  },

  {
    name: 'x_post',
    title: 'Read one post',
    description:
      'One public X/Twitter post in full: text (including long-form posts past 280 characters), author, timestamp, every public metric (likes, reposts, replies, quotes, bookmarks, views), attached media with direct URLs, hashtags, mentions, expanded links, and the quoted post if there is one.',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'string', description: 'Post ID or x.com status URL.' },
      },
      required: ['post'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler({ post }) {
      const id = requirePostId(post);
      const result = await getPost(id);
      const text = [
        `@${result.author.username} (${result.author.name}) on ${result.createdAt?.slice(0, 10) || 'unknown date'}`,
        '',
        result.text,
        '',
        `${compactNumber(result.metrics.likes)} likes, ${compactNumber(result.metrics.reposts)} reposts, ${compactNumber(result.metrics.replies)} replies, ${compactNumber(result.metrics.views)} views`,
        result.media.length ? `Media: ${result.media.map((m) => `${m.type} ${m.url}`).join(', ')}` : '',
        result.quoted ? `Quotes @${result.quoted.author.username}: ${result.quoted.text.slice(0, 200)}` : '',
        result.url,
      ].filter(Boolean).join('\n');
      return { text, data: { post: result } };
    },
  },

  {
    name: 'x_thread',
    title: 'Read a whole thread',
    description:
      'The conversation around a post, in order: every post above it up to the root, and the author\'s own continuation below it. Give it any post in a thread and it returns the thread. Use this instead of x_post when the post you have is part of a longer argument.',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'string', description: 'Any post ID or x.com status URL in the thread.' },
        limit: { type: 'integer', description: 'Maximum posts to return, 1 to 50. Default 25.', minimum: 1, maximum: 50 },
      },
      required: ['post'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler({ post, limit }) {
      const id = requirePostId(post);
      const thread = await getThread(id, { limit: clamp(limit, 25, 50) });
      const body = thread.posts
        .map((entry, index) => `${index + 1}/${thread.posts.length} ${entry.text.trim()}\n   ${entry.url}`)
        .join('\n\n');
      const text = [
        `Thread by @${thread.author.username} (${thread.posts.length} posts):`,
        '',
        body,
        thread.truncated ? '\n(Truncated: the thread continues past what the public timeline exposes.)' : '',
      ].filter(Boolean).join('\n');
      return { text, data: thread };
    },
  },

  {
    name: 'x_video',
    title: 'Get downloadable video from a post',
    description:
      'Every downloadable MP4 for a post that contains a video or GIF, best quality first, with width, height and bitrate, plus a ready-to-use download link that streams the file with a proper filename. Returns a clear error when the post holds no video.',
    inputSchema: {
      type: 'object',
      properties: {
        post: { type: 'string', description: 'Post ID or x.com status URL.' },
      },
      required: ['post'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler({ post }) {
      const id = requirePostId(post);
      const url = /^https?:/i.test(String(post).trim()) ? String(post).trim() : `https://x.com/i/web/status/${id}`;
      const result = await extractTweetVideo(url);
      const withLinks = result.videos.map((video) => ({
        ...video,
        downloadUrl: `${SITE}/api/video/download?url=${encodeURIComponent(video.url)}&author=${encodeURIComponent(result.username)}&tweetId=${encodeURIComponent(result.tweetId)}`,
      }));
      const text = [
        `${withLinks.length} video variant(s) from @${result.username}:`,
        ...withLinks.map((video) => `- ${video.quality} (${video.width}x${video.height}) ${video.downloadUrl}`),
      ].join('\n');
      return { text, data: { ...result, videos: withLinks } };
    },
  },

  {
    name: 'xactions_docs',
    title: 'Search the XActions documentation',
    description:
      'Search everything XActions ships: guides, tutorials, the CLI and API reference, all 49 agent skills, and every browser script, returning the matching passages with their source URLs. Use this before writing XActions code, or when the user asks how to automate something on X.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you want to know. A natural question works better than keywords.' },
        limit: { type: 'integer', description: 'How many passages to return, 1 to 20. Default 6.', minimum: 1, maximum: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler({ query, limit }, ctx) {
      const question = String(query || '').trim();
      if (!question) throw new ToolInputError('query is required.');
      const searcher = await ctx.getSearcher();
      // The retrieval index stores short keys to keep the asset small. Expand
      // them here so the tool's output is self-describing to a model.
      const results = searcher.search(question, { limit: clamp(limit, 6, 20) }).map((chunk) => ({
        title: chunk.t,
        url: chunk.u,
        path: chunk.p,
        kind: chunk.k,
        text: chunk.x,
        score: chunk.score,
      }));
      if (!results.length) {
        return {
          text: `Nothing in the XActions docs matched "${question}". Try naming the action (unfollow, scrape, schedule, download) or the surface (CLI, MCP, browser script).`,
          data: { query: question, results: [] },
        };
      }
      const text = results
        .map((source, index) => `${index + 1}. ${source.title} (${source.url})\n${String(source.text || '').trim()}`)
        .join('\n\n');
      return { text, data: { query: question, results } };
    },
  },
];

/**
 * Map a thrown error onto the message an agent should see. Tool failures are
 * results, not protocol errors, so the wording has to be actionable on its own.
 * @param {Error} error
 * @returns {string}
 */
export function toolErrorMessage(error) {
  if (error instanceof ToolInputError) return error.message;
  // Errors carry the upstream status directly when they have one. Reading it
  // first means a 429 raised anywhere in a fallback chain still produces the
  // actionable message, not the last rail's raw wording.
  const status = Number(error?.status) || statusForError(error);
  if (status === 404) return `Not found: ${error.message}`;
  if (status === 429) return 'X is rate-limiting anonymous reads right now. Wait about a minute and try again.';
  if (status === 403) return 'X refused this read without an account. Only public profiles, posts and timelines are available here.';
  return error?.message || 'The read failed.';
}

/** @type {Map<string, object>} */
export const TOOLS_BY_NAME = new Map(EDGE_TOOLS.map((tool) => [tool.name, tool]));
