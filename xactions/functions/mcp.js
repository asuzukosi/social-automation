// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * https://xactions.app/mcp
 *
 * A remote MCP server whose tools charge for themselves.
 *
 * Point any MCP client at this URL and it works immediately: no account, no API
 * key, no OAuth round trip, no waiting to be approved. Free tools answer
 * straight away. Paid tools answer with x402 terms; the agent pays a fraction of
 * a cent from its own wallet in USDC on Solana or Base, calls again, and gets
 * the result with a settlement receipt attached.
 *
 * Two pieces, deliberately separable:
 *
 *   src/mcp/edgeServer.js   the MCP server: protocol negotiation, tools,
 *                           resources and prompts. Knows nothing about money.
 *   packages/x402-mcp       the payment gate. Knows nothing about X/Twitter, and
 *                           is published so any MCP server can use it.
 *
 * This file is the seam. It is small on purpose: adding payment to an MCP server
 * should be a wrapper, not a rewrite.
 *
 * One URL serves two audiences: a browser asking for HTML gets the page that has
 * always lived here, a machine gets the protocol.
 *
 * @author nichxbt
 */

import { handleMessage, LATEST_PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from '../src/mcp/edgeServer.js';
import { EDGE_TOOLS } from '../src/mcp/edgeTools.js';
import { loadDocsIndex } from '../src/mcp/edgeIndex.js';
import { createToolPaymentGate } from '../packages/x402-mcp/src/gate.js';
import { PAID_RESOURCES } from '../src/edge/paidResources.js';

const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const BASE_MAINNET = 'eip155:8453';

/** The price of the HTTP endpoint that returns the same data, so the two rails agree. */
const httpPrice = (path) => PAID_RESOURCES.find((resource) => resource.path === path)?.price;

/**
 * What each tool costs. A tool absent from this table is free.
 *
 * The price is attached to the data, not to the rail: a profile and a timeline
 * cost the same here as they do over HTTP, and a single post, a thread, a video
 * and a documentation lookup are free on both. Pricing the same data differently
 * on two interfaces would just teach an agent to use the cheaper one.
 */
const TOOL_PRICES = {
  x_profile: httpPrice('/api/ai/scrape/profile') ?? '$0.001',
  x_posts: httpPrice('/api/ai/scrape/tweets') ?? '$0.005',
};

const TOOL_DESCRIPTIONS = Object.fromEntries(EDGE_TOOLS.map((tool) => [tool.name, tool.description]));

/** One gate per isolate. Constructing it performs no I/O. */
let gate = null;

function gateFor(env) {
  if (gate) return gate;
  gate = createToolPaymentGate({
    payTo: {
      [SOLANA_MAINNET]: env.X402_PAY_TO_ADDRESS_SOLANA || '',
      [BASE_MAINNET]: env.X402_PAY_TO_ADDRESS || '',
    },
    prices: TOOL_PRICES,
    descriptions: TOOL_DESCRIPTIONS,
    ...(env.X402_FACILITATOR_URL ? { facilitator: env.X402_FACILITATOR_URL } : {}),
  });
  return gate;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'content-type, authorization, x-payment, payment-signature, mcp-session-id, mcp-protocol-version',
  'access-control-expose-headers': 'mcp-session-id, x-payment-response',
};

const json = (body, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { 'content-type': 'application/json' }), 'cache-control': 'no-store', ...CORS },
  });

/** Attach the price of each tool to `tools/list`, so an agent can budget first. */
function annotatePrices(response, paymentGate) {
  const tools = response?.result?.tools;
  if (!Array.isArray(tools)) return response;
  return {
    ...response,
    result: {
      ...response.result,
      tools: tools.map((tool) => {
        const meta = paymentGate.toolMeta(tool.name);
        const price = meta['x402/price'];
        return {
          ...tool,
          description: price ? `${tool.description} (costs ${price.display} in USDC via x402)` : tool.description,
          _meta: { ...(tool._meta || {}), ...meta },
        };
      }),
    },
  };
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const paymentGate = gateFor(env);
  const url = new URL(request.url);

  if (request.method === 'GET' || request.method === 'HEAD') {
    // A browser gets the page. A machine gets the protocol.
    if ((request.headers.get('accept') || '').includes('text/html')) {
      // The page lives at /mcp-docs, not /mcp.html. A file named mcp.html
      // would make the asset handler canonicalise /mcp back to itself, and a
      // browser would follow that redirect straight into this function again.
      return env.ASSETS.fetch(new Request(new URL('/mcp-docs', url), request));
    }
    return json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: `${url.origin}/mcp`,
      authentication: 'none',
      payment: paymentGate.receiving
        ? { protocol: 'x402', networks: [SOLANA_MAINNET, BASE_MAINNET], currency: 'USDC' }
        : null,
      tools: EDGE_TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        price: paymentGate.toolMeta(tool.name)['x402/price']?.display ?? null,
      })),
      documentation: `${url.origin}/docs/x402`,
    });
  }

  // Streamable HTTP uses DELETE to end a session. This server is stateless.
  if (request.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }

  const ctx = {
    getSearcher: async () => (await loadDocsIndex(env, url)).searcher,
    getResources: async () => (await loadDocsIndex(env, url)).resources,
  };

  const batch = Array.isArray(payload);
  const messages = batch ? payload : [payload];
  const responses = [];

  for (const message of messages) {
    const checked = await paymentGate.check({ message, request });
    if (checked.response) {
      responses.push(checked.response);
      continue;
    }
    const response = await handleMessage(message, { ...ctx, ...checked.context });
    if (!response) continue;
    const settled = await paymentGate.finalize(response, checked);
    responses.push(message?.method === 'tools/list' ? annotatePrices(settled, paymentGate) : settled);
  }

  if (!responses.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? responses : responses[0]);
}
