// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /api/health
 *
 * Health of the edge API surface that xactions.app actually serves. It reports
 * which endpoints answer at the edge and whether a full Node backend origin is
 * configured, so /status shows the truth instead of guessing from a 404.
 *
 * @author nichxbt
 */

import { corsHeaders, jsonResponse, preflightResponse } from '../../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request, env }) {
  return jsonResponse({
    status: 'ok',
    runtime: 'cloudflare-pages-functions',
    edgeEndpoints: [
      'GET /api/health',
      'POST /api/video/extract',
      'POST /api/video/extract-form',
      'GET /api/video/download',
      'POST /api/ask',
      'GET /api/ask/health',
      'GET /api/ai/health',
      'GET /api/ai/pricing',
      'GET /openapi.json',
      'GET /.well-known/x402',
    ],
    originConfigured: Boolean(env.XACTIONS_API_ORIGIN),
    timestamp: new Date().toISOString(),
  }, 200, corsHeaders(request));
}

// A discovery crawler probes with HEAD before it does anything else. Pages
// routes an unclaimed method to functions/api/[[path]].js, whose 503 made every
// endpoint here look like it needed a backend that was not deployed.
export const onRequestHead = onRequestGet;
