// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 08 — Drive the MCP server the way an AI agent does
 *
 * What it does: spawns the XActions MCP server, completes the JSON-RPC
 * handshake over stdio, lists the tools, and calls one. Exactly what Claude,
 * Cursor, and Windsurf do, so you can see the wire format and verify a setup
 * without an AI client in the loop. Reach for this when an MCP config "doesn't
 * work" and you need to know whether the server or the client is at fault.
 *
 * Needs: no session for the default tool (`x_get_profile` is guest-tier). Naming
 * a session-tier tool such as `x_search_tweets` needs X_AUTH_TOKEN set.
 *
 * Run:
 *   node examples/08-mcp-tool-call.js
 *   node examples/08-mcp-tool-call.js x_get_profile github
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const toolName = process.argv[2] || 'x_get_profile';
const username = process.argv[3] || 'nasa';

const serverPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'mcp',
  'server.js',
);

// The server logs its banner to stderr and speaks JSON-RPC on stdout, which is
// what keeps the protocol stream clean. Inherit stderr so you can see it.
const server = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, XACTIONS_SESSION_COOKIE: process.env.X_AUTH_TOKEN || '' },
});

const pending = new Map();
let nextId = 1;

createInterface({ input: server.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // Not a JSON-RPC frame; ignore.
  }

  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  resolver(message);
});

/**
 * Send one JSON-RPC request and wait for its response.
 *
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<object>} The full JSON-RPC response
 */
function call(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out after 60s`));
    }, 60_000);
  });
}

try {
  const init = await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'xactions-example', version: '1.0.0' },
  });
  console.log(`\nConnected to ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

  const { result } = await call('tools/list');
  console.log(`Server offers ${result.tools.length} tools.`);

  const tool = result.tools.find((t) => t.name === toolName);
  if (!tool) {
    console.error(`\nNo tool named "${toolName}". A few that exist:`);
    for (const t of result.tools.slice(0, 10)) console.error(`  ${t.name} — ${t.description}`);
    process.exit(1);
  }

  console.log(`\nCalling ${tool.name} — ${tool.description}`);
  const response = await call('tools/call', {
    name: tool.name,
    arguments: { username },
  });

  if (response.error) {
    console.error(`\nTool returned an error: ${response.error.message}`);
    process.exit(1);
  }

  for (const block of response.result.content ?? []) {
    if (block.type === 'text') console.log(`\n${block.text}`);
  }
} finally {
  server.kill();
}
