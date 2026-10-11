// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * 09 — The MCP draft-approval gate
 *
 * What it does: starts the MCP server with approval mode on, calls a write
 * tool, and shows that the call was held as a draft instead of running. Then it
 * lists the draft over MCP and discards it. This is the safety rail you want
 * before you let an agent post, follow, or unfollow on your behalf.
 *
 * Needs: no session, and it never reaches X. The held call is discarded at the
 * end, so nothing is ever posted. XACTIONS_HOME is pointed at a throwaway
 * directory for the run, so your real ~/.xactions/mcp-drafts.json is untouched.
 *
 * Run:
 *   node examples/09-draft-approval.js
 *   node examples/09-draft-approval.js "text for the held draft"
 *
 * The same drafts are readable from the terminal with `xactions drafts list`,
 * `xactions drafts show <id>`, `xactions drafts approve <id>`, and
 * `xactions drafts discard <id>`.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const draftText = process.argv[2] || 'A post an agent proposed. Never sent.';

const serverPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'mcp',
  'server.js',
);

// A throwaway XACTIONS_HOME keeps this run out of your real draft store.
const home = await mkdtemp(path.join(os.tmpdir(), 'xactions-drafts-'));

const server = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'ignore'],
  env: {
    ...process.env,
    XACTIONS_HOME: home,
    // The whole point of this example. Without it, x_post_tweet would run.
    XACTIONS_MCP_REQUIRE_APPROVAL: '1',
  },
});

const pending = new Map();
let nextId = 1;

createInterface({ input: server.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // Not a JSON-RPC frame.
  }
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

try {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'xactions-example', version: '1.0.0' },
  });

  heading('An agent asks to post');
  const held = await callTool('x_post_tweet', { text: draftText });
  console.log(`  held      ${held.held}`);
  console.log(`  draft id  ${held.draftId}`);
  console.log(`  tool      ${held.tool}`);
  console.log(`  text      ${held.args.text}`);
  console.log(`\n  ${held.message}`);

  heading('What is waiting for a human');
  const listed = await callTool('x_list_drafts', {});
  console.log(`  ${listed.count} draft(s), ${listed.pending} pending`);
  console.log(`  store: ${listed.store}`);
  for (const draft of listed.drafts) {
    console.log(`  ${draft.id}  ${draft.status.padEnd(9)} ${draft.tool}`);
  }

  heading('Discarding it');
  const discarded = await callTool('x_discard_draft', { id: held.draftId });
  console.log(`  ${JSON.stringify(discarded)}`);

  const after = await callTool('x_list_drafts', {});
  console.log(`\n  ${after.count} draft(s) left. Nothing was posted.`);

  console.log(
    '\nTurn this on for real by adding XACTIONS_MCP_REQUIRE_APPROVAL=1 to the env\n' +
      'block of your MCP client config, then review with `xactions drafts list`.',
  );
} finally {
  server.kill();
  await rm(home, { recursive: true, force: true });
}

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
      if (pending.delete(id)) reject(new Error(`${method} timed out after 30s`));
    }, 30_000);
  });
}

/**
 * Call one tool and return its parsed JSON payload.
 *
 * MCP tools answer with a content array of text blocks. Every XActions tool
 * puts JSON in the first block, so this unwraps that in one place.
 *
 * @param {string} name
 * @param {object} args
 * @returns {Promise<object>}
 */
async function callTool(name, args) {
  const response = await call('tools/call', { name, arguments: args });
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`${name} returned no content: ${JSON.stringify(response)}`);
  return JSON.parse(text);
}

/**
 * Print a labelled section header.
 * @param {string} title
 */
function heading(title) {
  console.log(`\n${title}\n${'-'.repeat(title.length)}`);
}
