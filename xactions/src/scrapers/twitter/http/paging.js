// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared timeline paging helpers for the HTTP scraper modules.
 *
 * Twitter GraphQL timelines all share one shape (`timeline.instructions[]`
 * with `TimelineAddEntries` / `TimelineAddToModule` instructions and
 * `cursor-bottom-*` entries), but the path from `data` down to the
 * instructions differs per operation and has moved between bundles more
 * than once. These helpers read the instructions wherever they are, and run
 * the standard "page until limit or no cursor" loop.
 *
 * Depends on: errors.js
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { AuthError } from './errors.js';

/** Default page size requested from GraphQL timelines */
export const PAGE_COUNT = 20;

/**
 * Read a dot-separated path from an object.
 *
 * @param {object} obj
 * @param {string} path e.g. 'data.user.result.timeline.timeline.instructions'
 * @returns {*}
 */
export function getPath(obj, path) {
  if (!path) return obj;
  let current = obj;
  for (const key of path.split('.')) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Locate the timeline instructions array in a GraphQL response.
 *
 * Tries the preferred path first, then walks the response looking for the
 * first `instructions` array, so a bundle that nests the timeline under a
 * renamed key still parses.
 *
 * @param {object} response Raw GraphQL response
 * @param {string} [preferredPath] Dot-path to `instructions`
 * @returns {object[]} Instructions (empty array when none found)
 */
export function findInstructions(response, preferredPath) {
  const direct = preferredPath ? getPath(response, preferredPath) : undefined;
  if (Array.isArray(direct)) return direct;

  const stack = [response?.data ?? response];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node.instructions)) return node.instructions;
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [];
}

/**
 * Flatten every entry (and module item) out of a set of instructions.
 *
 * Returns entries in timeline order. Module items are returned as
 * `{ entryId, content: { itemContent } }` so callers can treat them like
 * plain entries. The bottom cursor is returned separately.
 *
 * @param {object[]} instructions
 * @returns {{ entries: object[], cursor: string|null }}
 */
export function flattenEntries(instructions) {
  const entries = [];
  let cursor = null;

  if (!Array.isArray(instructions)) return { entries, cursor };

  for (const instruction of instructions) {
    const type = instruction.type ?? instruction.__typename;

    if (type === 'TimelineAddEntries') {
      for (const entry of instruction.entries ?? []) {
        const entryId = entry.entryId ?? entry.entry_id ?? '';
        if (entryId.startsWith('cursor-bottom-')) {
          cursor = entry.content?.value ?? entry.content?.itemContent?.value ?? cursor;
          continue;
        }
        if (entryId.startsWith('cursor-top-')) continue;
        if (entry.content?.cursorType === 'Bottom' && entry.content?.value) {
          cursor = entry.content.value;
          continue;
        }
        entries.push(entry);
        for (const item of entry.content?.items ?? []) {
          if (item?.item?.itemContent) {
            entries.push({ entryId: item.entryId ?? entryId, content: { itemContent: item.item.itemContent }, clientEventInfo: item.item.clientEventInfo });
          }
        }
      }
    }

    if (type === 'TimelineAddToModule') {
      for (const item of instruction.moduleItems ?? []) {
        if (item?.item?.itemContent) {
          entries.push({ entryId: item.entryId ?? '', content: { itemContent: item.item.itemContent }, clientEventInfo: item.item.clientEventInfo });
        }
      }
    }

    if (type === 'TimelinePinEntry' && instruction.entry) {
      entries.push(instruction.entry);
    }
  }

  return { entries, cursor };
}

/**
 * Throw when the client has no auth_token cookie.
 *
 * @param {object} client TwitterHttpClient instance
 * @param {string} endpoint Operation name for the error
 * @throws {AuthError}
 */
export function requireAuth(client, endpoint) {
  if (typeof client.isAuthenticated === 'function' && !client.isAuthenticated()) {
    throw new AuthError(`${endpoint} requires authentication. Provide auth_token cookie.`, { endpoint });
  }
}

/**
 * Page through a GraphQL timeline until `limit` items are collected or the
 * timeline ends.
 *
 * @param {object} client TwitterHttpClient instance
 * @param {{queryId: string, operationName: string}} endpoint GRAPHQL table entry
 * @param {object} baseVariables Variables sent on every page (count/cursor are added)
 * @param {(instructions: object[]) => {items: object[], cursor: string|null}} parsePage
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {string|null} [options.cursor=null]
 * @param {Function} [options.onProgress] `({ fetched, limit, page })`
 * @param {string} [options.path] Preferred dot-path to the instructions
 * @param {(item: object) => string} [options.keyOf] Dedup key (default: `item.id`)
 * @param {object} [options.features] GraphQL feature flags override
 * @returns {Promise<object[]>}
 */
export async function paginate(client, endpoint, baseVariables, parsePage, options = {}) {
  const { limit = 100, cursor: initialCursor = null, onProgress, path, keyOf = (item) => item.id } = options;
  const { queryId, operationName } = endpoint;

  const seen = new Map();
  let nextCursor = initialCursor;
  let page = 0;

  while (seen.size < limit) {
    const variables = { ...baseVariables, count: Math.min(PAGE_COUNT, limit - seen.size) || PAGE_COUNT };
    if (nextCursor) variables.cursor = nextCursor;

    const response = await client.graphql(queryId, operationName, variables, options.features ? { features: options.features } : {});
    const instructions = findInstructions(response, path);
    const { items, cursor } = parsePage(instructions);

    let added = 0;
    for (const item of items) {
      if (seen.size >= limit) break;
      const key = keyOf(item) ?? `${page}:${seen.size}`;
      if (!seen.has(key)) {
        seen.set(key, item);
        added++;
      }
    }

    onProgress?.({ fetched: seen.size, limit, page });

    if (!cursor || added === 0) break;
    nextCursor = cursor;
    page++;
  }

  return Array.from(seen.values()).slice(0, limit);
}
