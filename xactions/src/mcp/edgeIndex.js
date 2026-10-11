// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The docs corpus, loaded once per isolate.
 *
 * `/data/ask-index.json` ships as a static asset of the site, so the MCP server
 * reads it through the Pages `ASSETS` binding instead of over the network: no
 * database, no cold-start fetch to another host, and the index is always the
 * one that shipped with this deployment.
 *
 * @module src/mcp/edgeIndex
 * @author nichxbt
 */

import { createSearcher } from '../ask/engine.js';
import { buildResourceIndex } from './edgeServer.js';

/** @type {Promise<{ searcher: object, resources: Map<string, object>, digest: string }>|null} */
let indexPromise = null;

/**
 * Build (or reuse) the docs searcher and the MCP resource map.
 *
 * A failed load is not cached, so a transient asset read does not poison the
 * isolate for the rest of its life.
 *
 * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> } }} env
 * @param {URL} url Any URL on this origin; only its origin is used.
 * @returns {Promise<{ searcher: object, resources: Map<string, object>, digest: string }>}
 */
export function loadDocsIndex(env, url) {
  if (!indexPromise) {
    indexPromise = (async () => {
      const response = await env.ASSETS.fetch(new Request(new URL('/data/ask-index.json', url)));
      if (!response.ok) throw new Error(`docs index asset HTTP ${response.status}`);
      const index = await response.json();
      return {
        searcher: createSearcher(index),
        resources: buildResourceIndex(index),
        digest: index.digest,
      };
    })();
    indexPromise.catch(() => {
      indexPromise = null;
    });
  }
  return indexPromise;
}

/**
 * The lazy accessors `handleMessage` expects, bound to one request's env.
 * @param {object} env
 * @param {URL} url
 */
export function createServerContext(env, url) {
  return {
    getSearcher: async () => (await loadDocsIndex(env, url)).searcher,
    getResources: async () => (await loadDocsIndex(env, url)).resources,
  };
}
