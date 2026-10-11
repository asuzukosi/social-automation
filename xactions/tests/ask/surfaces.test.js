// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The CLI command and the MCP tool are the two surfaces a person cannot see,
 * so they are driven here the way their callers drive them: the CLI through
 * its real commander action, and x_ask through the real stdio JSON-RPC server.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAskCommand } from '../../src/cli/commands/ask.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('xactions ask', () => {
  it('registers with the options the docs promise', () => {
    const program = new Command();
    registerAskCommand(program);
    const cmd = program.commands.find((c) => c.name() === 'ask');
    expect(cmd).toBeTruthy();
    const flags = cmd.options.map((o) => o.long);
    for (const flag of ['--json', '--quiet', '--no-sources', '--provider', '--key', '--model']) {
      expect(flags, flag).toContain(flag);
    }
  });

  it('answers a real question as JSON, with sources and something to run', async () => {
    const { stdout, code } = await run(['ask', 'how do I unfollow everyone?', '--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.question).toBe('how do I unfollow everyone?');
    expect(payload.answer.length).toBeGreaterThan(80);
    expect(payload.sources.length).toBeGreaterThan(2);
    expect(payload.actions.some((a) => a.id === 'unfollow-everyone')).toBe(true);
    // Either a lane wrote it or the documentation digest did; both are answers.
    expect(payload.lane).toBeTruthy();
  }, 180000);

  it('refuses an explicitly empty question instead of hanging on stdin', async () => {
    const { code, stderr } = await run(['ask', '']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/Ask what/);
  }, 30000);
});

describe('x_ask MCP tool', () => {
  it('is advertised and returns actions without calling a model', async () => {
    const rpc = startServer();
    try {
      await rpc.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'vitest', version: '1' } });
      const { result } = await rpc.call('tools/list', {});
      const tool = result.tools.find((t) => t.name === 'x_ask');
      expect(tool, 'x_ask must be advertised').toBeTruthy();
      expect(tool.inputSchema.required).toEqual(['question']);

      const call = await rpc.call('tools/call', { name: 'x_ask', arguments: { question: 'how do I unfollow everyone?', actionsOnly: true } });
      const payload = JSON.parse(call.result.content[0].text);
      expect(payload.actions.some((a) => a.id === 'unfollow-everyone')).toBe(true);
      expect(payload.sources.length).toBeGreaterThan(0);
    } finally {
      rpc.stop();
    }
  }, 120000);
});

function run(args) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [join(ROOT, 'src/cli/index.js'), ...args], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

function startServer() {
  const proc = spawn(process.execPath, [join(ROOT, 'src/mcp/server.js')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const pending = new Map();
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('{')) continue;
      const msg = JSON.parse(line);
      const resolve = pending.get(msg.id);
      if (resolve) { resolve(msg); pending.delete(msg.id); }
    }
  });
  let id = 0;
  return {
    call: (method, params) => new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    }),
    stop: () => proc.kill(),
  };
}
