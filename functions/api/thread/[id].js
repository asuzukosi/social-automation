// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /api/thread/:id
 *
 * The same unrolled thread as POST /api/thread/unroll, addressed by post id, so
 * a link like /thread/1002103360646823936 resolves without a body. Free.
 *
 * @author nichxbt
 */

import { getThread, normalizePostId } from '../../../src/edge/postReader.js';
import { statusForError } from '../../../src/edge/twitterClient.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../../../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request, params }) {
  const cors = corsHeaders(request);
  const id = normalizePostId(params?.id);
  if (!id) {
    return jsonResponse({ error: 'INVALID_INPUT', message: 'not a post id' }, 400, cors);
  }
  try {
    const limit = new URL(request.url).searchParams.get('limit');
    const thread = await getThread(id, { limit });
    return jsonResponse(thread, 200, cors);
  } catch (error) {
    return jsonResponse({ error: error.name || 'THREAD_FAILED', message: error.message }, statusForError(error), cors);
  }
}

export const onRequestHead = onRequestGet;
