// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MCP Server — Tool Definition Tests
 *
 * Tests the TOOLS array structure without starting the stdio transport.
 * Follows the same no-mock pattern as the rest of the test suite.
 */

// This suite must use Vitest's runner, not `node:test`. Importing `describe`/
// `it` from `node:test` registers the suite with Node's own runner, which
// Vitest never executes — the file reported "No test suite found" and all 144
// tool definitions went unchecked for months. Assertions stay on
// `node:assert/strict`, which works under either runner.
import { describe, it, beforeAll } from 'vitest';
import assert from 'node:assert/strict';

// The server guards main() behind an explicit call, so importing it does not
// start the stdio transport and does not block on stdin.
let TOOLS;

describe('MCP Tool Definitions', () => {
  beforeAll(async () => {
    const mod = await import('../../src/mcp/server.js');
    TOOLS = mod.TOOLS;
  });

  it('exports a TOOLS array', () => {
    assert.ok(Array.isArray(TOOLS), 'TOOLS should be an array');
    assert.ok(TOOLS.length > 0, 'TOOLS should not be empty');
  });

  it('every tool has name, description, and inputSchema', () => {
    for (const tool of TOOLS) {
      assert.equal(typeof tool.name, 'string', `${tool.name}: name must be string`);
      assert.ok(tool.name.length > 0, 'name must not be empty');
      assert.equal(typeof tool.description, 'string', `${tool.name}: description must be string`);
      assert.ok(tool.description.length > 0, `${tool.name}: description must not be empty`);
      assert.ok(tool.inputSchema, `${tool.name}: inputSchema is required`);
      assert.equal(tool.inputSchema.type, 'object', `${tool.name}: inputSchema.type must be 'object'`);
    }
  });

  it('all tool names follow x_ prefix convention', () => {
    const nonConforming = TOOLS.filter(t => !t.name.startsWith('x_'));
    assert.equal(
      nonConforming.length,
      0,
      `Non-conforming tool names: ${nonConforming.map(t => t.name).join(', ')}`
    );
  });

  it('tool names are unique', () => {
    const names = TOOLS.map(t => t.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.equal(dupes.length, 0, `Duplicate tool names: ${dupes.join(', ')}`);
  });

  it('x_get_profile requires username', () => {
    const tool = TOOLS.find(t => t.name === 'x_get_profile');
    assert.ok(tool, 'x_get_profile must be defined');
    assert.ok(
      tool.inputSchema.required?.includes('username'),
      'x_get_profile must require username'
    );
  });

  it('x_post_tweet requires text', () => {
    const tool = TOOLS.find(t => t.name === 'x_post_tweet');
    assert.ok(tool, 'x_post_tweet must be defined');
    assert.ok(
      tool.inputSchema.required?.includes('text'),
      'x_post_tweet must require text'
    );
  });

  it('required fields are declared in properties', () => {
    for (const tool of TOOLS) {
      const required = tool.inputSchema.required || [];
      const properties = tool.inputSchema.properties || {};
      for (const field of required) {
        assert.ok(
          properties[field],
          `${tool.name}: required field "${field}" not in properties`
        );
      }
    }
  });
});
