// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /.well-known/mcp.json
 *
 * Discovery for the hosted MCP server, so a crawler or an agent that only has
 * the domain can find the endpoint without being told where to look. Mirrors
 * what `GET /mcp` with `Accept: application/json` returns, in the shorter shape
 * a well-known document is expected to have.
 *
 * @author nichxbt
 */

import { LATEST_PROTOCOL_VERSION, SERVER_NAME, SERVER_TITLE, SERVER_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '../../src/mcp/edgeServer.js';
import { EDGE_TOOLS } from '../../src/mcp/edgeTools.js';

const CORS = { 'access-control-allow-origin': '*' };

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, OPTIONS' } });
}

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    description: 'Public X/Twitter reads for AI agents. No API key, no account, no install.',
    servers: [{
      type: 'streamable-http',
      url: `${origin}/mcp`,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      authentication: 'none',
      payment: { protocol: 'x402', currency: 'USDC', note: 'Most tools are free. Priced tools answer an unpaid call with x402 terms; GET /mcp with Accept: application/json lists the current price of each.' },
    }],
    capabilities: { tools: true, resources: true, prompts: true },
    toolNames: EDGE_TOOLS.map((tool) => tool.name),
    documentation: `${origin}/docs/guides/mcp-remote`,
    source: 'https://github.com/nirholas/XActions',
  }, null, 2), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...CORS },
  });
}
