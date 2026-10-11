// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Model Context Protocol server core, transport-free.
 *
 * `handleMessage` takes one parsed JSON-RPC message and returns the response to
 * send, or `null` for a notification that gets an empty 202. That split is what
 * lets the Streamable HTTP transport in `functions/mcp/[[route]].js` stay thin
 * and lets the whole protocol surface be tested without a socket.
 *
 * The server is deliberately stateless: no session IDs, no per-connection
 * memory. Every request carries everything it needs, which is the only design
 * that survives an edge runtime where consecutive calls land in different
 * isolates on different continents.
 *
 * @module src/mcp/edgeServer
 * @author nichxbt
 */

import { EDGE_TOOLS, TOOLS_BY_NAME, toolErrorMessage } from './edgeTools.js';
import { EDGE_PROMPTS, PROMPTS_BY_NAME, renderPrompt } from './edgePrompts.js';

export const SERVER_NAME = 'xactions';
export const SERVER_VERSION = '1.0.0';
export const SERVER_TITLE = 'XActions';

/** Newest first. An `initialize` naming any of these is answered in kind. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

const RESOURCE_PAGE_SIZE = 100;

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function failure(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

/**
 * Negotiate the protocol version. The spec says to answer with the client's
 * version when it is supported, and with ours when it is not, letting the
 * client decide whether to continue.
 * @param {string|undefined} requested
 * @returns {string}
 */
export function negotiateProtocol(requested) {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
}

function toolDescriptor(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

/**
 * The docs corpus, exposed as MCP resources so an agent can read a whole guide
 * or skill file rather than only the passages a search returned. One resource
 * per source document, assembled from the retrieval index's chunks.
 * @param {{ chunks: Array<{t: string, u: string, p: string, k: string, x: string}> }} index
 */
export function buildResourceIndex(index) {
  const byPath = new Map();
  for (const chunk of index?.chunks || []) {
    let entry = byPath.get(chunk.p);
    if (!entry) {
      entry = { uri: `xactions://${chunk.k}/${chunk.p}`, name: chunk.p, title: chunk.t, kind: chunk.k, url: chunk.u, parts: [] };
      byPath.set(chunk.p, entry);
    }
    entry.parts.push(chunk.x);
  }
  return byPath;
}

function resourceDescriptor(entry) {
  return {
    uri: entry.uri,
    name: entry.name,
    title: entry.title,
    description: `${entry.kind} - ${entry.url}`,
    mimeType: 'text/markdown',
  };
}

/**
 * Handle one JSON-RPC message.
 *
 * @param {object} message Parsed JSON-RPC request or notification.
 * @param {object} ctx
 * @param {() => Promise<object>} ctx.getSearcher Lazily built docs searcher.
 * @param {() => Promise<Map<string, object>>} ctx.getResources Lazily built resource index.
 * @returns {Promise<object|null>} The response, or null for a notification.
 */
export async function handleMessage(message, ctx = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return failure(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Expected a JSON-RPC 2.0 object');
  }
  const { id, method, params } = message;
  if (typeof method !== 'string') {
    return failure(id, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing method');
  }

  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: negotiateProtocol(params?.protocolVersion),
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: SERVER_NAME,
          title: SERVER_TITLE,
          version: SERVER_VERSION,
        },
        instructions:
          'XActions reads public X/Twitter data with no API key and no login. Use x_profile and x_posts to research an account, x_post and x_thread to read a specific conversation, x_video to pull a downloadable MP4, and xactions_docs before writing any XActions automation. Everything is read-only: nothing here posts, follows, or changes an account.',
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
    case 'notifications/roots/list_changed':
      return null;

    case 'ping':
      return result(id, {});

    case 'tools/list':
      return result(id, { tools: EDGE_TOOLS.map(toolDescriptor) });

    case 'tools/call': {
      const name = params?.name;
      const tool = TOOLS_BY_NAME.get(name);
      if (!tool) {
        return failure(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${name}`);
      }
      try {
        const { text, data } = await tool.handler(params?.arguments || {}, ctx);
        const payload = { content: [{ type: 'text', text }], isError: false };
        if (data !== undefined) payload.structuredContent = data;
        return result(id, payload);
      } catch (error) {
        // A tool that fails reports through the result, not the protocol, so the
        // model can read the reason and choose a different call.
        return result(id, {
          content: [{ type: 'text', text: toolErrorMessage(error) }],
          isError: true,
        });
      }
    }

    case 'resources/list': {
      const resources = await ctx.getResources?.();
      if (!resources) return result(id, { resources: [] });
      const all = [...resources.values()];
      const start = params?.cursor ? Number(params.cursor) || 0 : 0;
      const page = all.slice(start, start + RESOURCE_PAGE_SIZE);
      const next = start + RESOURCE_PAGE_SIZE;
      const payload = { resources: page.map(resourceDescriptor) };
      if (next < all.length) payload.nextCursor = String(next);
      return result(id, payload);
    }

    case 'resources/templates/list':
      return result(id, { resourceTemplates: [] });

    case 'resources/read': {
      const uri = params?.uri;
      const resources = await ctx.getResources?.();
      const entry = resources && [...resources.values()].find((candidate) => candidate.uri === uri);
      if (!entry) {
        return failure(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown resource: ${uri}`);
      }
      return result(id, {
        contents: [{
          uri: entry.uri,
          name: entry.name,
          title: entry.title,
          mimeType: 'text/markdown',
          text: `# ${entry.title}\n\nSource: ${entry.url}\n\n${entry.parts.join('\n\n')}`,
        }],
      });
    }

    case 'prompts/list':
      return result(id, {
        prompts: EDGE_PROMPTS.map(({ name, title, description, arguments: args }) => ({
          name, title, description, arguments: args,
        })),
      });

    case 'prompts/get': {
      const prompt = PROMPTS_BY_NAME.get(params?.name);
      if (!prompt) {
        return failure(id, JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown prompt: ${params?.name}`);
      }
      try {
        return result(id, renderPrompt(prompt, params?.arguments || {}));
      } catch (error) {
        return failure(id, JSON_RPC_ERRORS.INVALID_PARAMS, error.message);
      }
    }

    case 'completion/complete':
      return result(id, { completion: { values: [], hasMore: false } });

    case 'logging/setLevel':
      return result(id, {});

    default:
      if (isNotification) return null;
      return failure(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

/**
 * Handle a whole payload: one message or a JSON-RPC batch.
 * @param {object|object[]} payload
 * @param {object} ctx
 * @returns {Promise<object|object[]|null>} Null when nothing needs a response.
 */
export async function handlePayload(payload, ctx) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return failure(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Empty batch');
    }
    const responses = [];
    for (const message of payload) {
      const response = await handleMessage(message, ctx);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }
  return handleMessage(payload, ctx);
}
