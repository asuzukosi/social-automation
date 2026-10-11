// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /api/ask/health
 *
 * Reports whether the retrieval index loaded and which LLM lanes are in the
 * chain for this deployment. The /ask page calls it before the first question
 * so it can say "unavailable" honestly instead of failing mid-stream.
 *
 * @author nichxbt
 */

import { askHealth } from '../ask.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../../../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request, env }) {
  return askHealth(request, env, new URL(request.url));
}

export async function onRequestPost({ request }) {
  return jsonResponse({ error: 'method_not_allowed' }, 405, corsHeaders(request));
}

// A discovery crawler probes with HEAD before it does anything else. Pages
// routes an unclaimed method to functions/api/[[path]].js, whose 503 made every
// endpoint here look like it needed a backend that was not deployed.
export const onRequestHead = onRequestGet;
