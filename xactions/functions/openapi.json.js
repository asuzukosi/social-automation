// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /openapi.json
 *
 * The OpenAPI 3.1 description of what this deployment serves, generated in
 * src/edge/openapi.js. Discovery crawlers read it to decide what to probe, so
 * it documents the endpoints that actually answer here rather than every
 * operation the self-hosted Node server can run.
 *
 * @author nichxbt
 */

import { loadApiModules } from '../src/edge/apiModules.js';
import { generateEdgeSpec } from '../src/edge/openapi.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request, env }) {
  const api = await loadApiModules(env);
  const { origin } = new URL(request.url);
  return jsonResponse(
    generateEdgeSpec({ origin, buildAccepts: api.buildAccepts }),
    200,
    corsHeaders(request),
  );
}

// A discovery crawler probes with HEAD before it does anything else. Pages
// routes an unclaimed method to functions/api/[[path]].js, whose 503 made every
// endpoint here look like it needed a backend that was not deployed.
export const onRequestHead = onRequestGet;
