// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * POST or GET /api/thread/unroll
 *
 * Unroll a thread into the posts that make it up, in order. Body
 * `{ "url": "https://x.com/user/status/123" }` or `?url=`.
 *
 * Free, like the reader page it powers. The price in this API is attached to the
 * data, not to the rail: a profile and a timeline cost the same over HTTP as
 * they do over MCP, and a single post, a thread and a video are free on both.
 * Anything else would let an agent arbitrage one interface against the other.
 *
 * Runs entirely at the edge on a guest token, so it needs no backend. x.com
 * refuses TweetDetail to a guest, so the chain is reconstructed by walking
 * reply parents and then the author's own timeline: see src/edge/postReader.js.
 *
 * @author nichxbt
 */

import { getThread, normalizePostId } from '../../../src/edge/postReader.js';
import { statusForError } from '../../../src/edge/twitterClient.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../../../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequest({ request }) {
  const cors = corsHeaders(request);
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (!['GET', 'POST', 'HEAD'].includes(request.method)) {
    return jsonResponse({ error: 'method_not_allowed' }, 405, { ...cors, allow: 'GET, POST, HEAD, OPTIONS' });
  }

  const query = new URL(request.url).searchParams;
  let body = Object.fromEntries(query);
  if (request.method === 'POST') {
    try {
      body = { ...body, ...(await request.json()) };
    } catch {
      // A POST with no body is still a valid probe: fall back to the query.
    }
  }

  const id = normalizePostId(body.url ?? body.post ?? body.tweetId ?? body.id);
  if (!id) {
    return jsonResponse(
      { error: 'INVALID_INPUT', message: 'url is required: a post URL or a post id.' },
      400,
      cors,
    );
  }

  try {
    const thread = await getThread(id, { limit: body.limit });
    return jsonResponse(thread, 200, cors);
  } catch (error) {
    return jsonResponse({ error: error.name || 'THREAD_FAILED', message: error.message }, statusForError(error), cors);
  }
}
