// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * POST /api/ask
 *
 * Ask XActions, answered at the edge. The retrieval index is a static asset
 * (/data/ask-index.json, built by scripts/build-ask-index.mjs) and every LLM
 * lane is reached with plain fetch, so this needs no Node backend, no database
 * and no API key: three lanes in the chain are keyless. Keyed lanes join the
 * chain automatically when their variable is set on the Pages project.
 *
 * The answer streams back as Server-Sent Events, the same event shape the
 * dashboard's ask.js already consumes.
 *
 * @author nichxbt
 */

import { ask, createSearcher, SUGGESTED_QUESTIONS } from '../../src/ask/engine.js';
import { buildLaneChain } from '../../src/ask/lanes.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../../src/video/edgeHttp.js';

/**
 * The index is a few MB of JSON, so it is parsed once per isolate and reused.
 * A failed load is not cached, so the next request retries.
 * @type {Promise<{ searcher: object, digest: string, counts: object }>|null}
 */
let indexPromise = null;

/**
 * Load and cache the retrieval index from the site's own static assets.
 * @param {{ ASSETS: { fetch: (req: Request) => Promise<Response> } }} env
 * @param {URL} url
 */
export function loadAskIndex(env, url) {
  if (!indexPromise) {
    indexPromise = env.ASSETS.fetch(new Request(new URL('/data/ask-index.json', url)))
      .then(async (res) => {
        if (!res.ok) throw new Error(`ask index asset HTTP ${res.status}`);
        const index = await res.json();
        return { searcher: createSearcher(index), digest: index.digest, counts: index.counts };
      });
    indexPromise.catch(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}

/** Health of the Ask surface, used by /ask and by the status page. */
export async function askHealth(request, env, url) {
  const cors = corsHeaders(request);
  try {
    const { searcher, digest, counts } = await loadAskIndex(env, url);
    return jsonResponse(
      {
        status: 'ok',
        runtime: 'cloudflare-pages-functions',
        index: { chunks: searcher.size, digest, counts },
        lanes: buildLaneChain(env).map((lane) => lane.name),
        suggested: SUGGESTED_QUESTIONS,
      },
      200,
      cors,
    );
  } catch (error) {
    return jsonResponse({ status: 'error', message: error.message }, 503, cors);
  }
}

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request }) {
  return jsonResponse(
    { error: 'method_not_allowed', message: 'POST a { question } body to /api/ask.' },
    405,
    corsHeaders(request),
  );
}

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request);
  const url = new URL(request.url);

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { question, history, byok } = body || {};
  if (typeof question !== 'string' || !question.trim()) {
    return jsonResponse({ error: 'INVALID_INPUT', message: 'question is required' }, 400, cors);
  }

  let searcher;
  try {
    ({ searcher } = await loadAskIndex(env, url));
  } catch (error) {
    return jsonResponse({ error: 'INDEX_UNAVAILABLE', message: error.message }, 503, cors);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        await ask({
          question,
          history: Array.isArray(history) ? history : [],
          searcher,
          env,
          byok: byok && typeof byok === 'object' ? byok : undefined,
          onEvent: send,
          signal: request.signal,
        });
      } catch (error) {
        send({ type: 'error', message: error.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
}

// A discovery crawler probes with HEAD first; Pages would otherwise route that
// to functions/api/[[path]].js and answer 503 for an endpoint that is live.
export const onRequestHead = onRequestGet;
