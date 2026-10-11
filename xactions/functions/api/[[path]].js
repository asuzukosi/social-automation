// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Catch-all for /api/* on xactions.app.
 *
 * The endpoints implemented at the edge (health, the video downloader) have
 * their own files and win this route. Everything else in api/routes/ needs the
 * full Node backend: Postgres, Redis, Puppeteer. When one is deployed, set
 * XACTIONS_API_ORIGIN on the Pages project and those routes proxy through
 * here; until then they answer a JSON 503 that says so, rather than the site's
 * HTML 404 page, which no API client can parse.
 *
 * @author nichxbt
 */

import { corsHeaders, jsonResponse, preflightResponse } from '../../src/video/edgeHttp.js';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade']);

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequest({ request, env }) {
  const cors = corsHeaders(request);
  const origin = (env.XACTIONS_API_ORIGIN || '').replace(/\/+$/, '');
  const url = new URL(request.url);

  if (!origin) {
    return jsonResponse({
      error: 'This endpoint needs the XActions Node backend, which is not deployed for this site.',
      path: url.pathname,
      edgeEndpoints: ['GET /api/health', 'POST /api/video/extract', 'GET /api/video/download'],
      selfHost: 'https://github.com/nirholas/XActions#self-hosting',
    }, 503, cors);
  }

  const upstream = new URL(origin + url.pathname + url.search);
  const headers = new Headers(request.headers);
  headers.delete('host');
  for (const name of HOP_BY_HOP) headers.delete(name);

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const outHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) outHeaders.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outHeaders });
}
