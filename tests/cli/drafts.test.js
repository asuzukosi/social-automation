// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions - `xactions drafts` tests. Offline: the draft store lives in a temp XACTIONS_HOME.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDraft, getDraft, listDrafts } from '../../src/mcp/drafts.js';
import {
  approveCommand,
  clearCommand,
  discardCommand,
  formatAge,
  listCommand,
  showCommand,
  summarizeArgs,
} from '../../src/cli/commands/drafts.js';

const CLI = fileURLToPath(new URL('../../src/cli/index.js', import.meta.url));

/** Run the real binary with the draft store pointed at a temp directory. */
function cli(args, home) {
  return execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, XACTIONS_HOME: home, HOME: home, FORCE_COLOR: '0' },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('drafts', () => {
  let home;
  let previousHome;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-drafts-'));
    previousHome = process.env.XACTIONS_HOME;
    process.env.XACTIONS_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.XACTIONS_HOME;
    else process.env.XACTIONS_HOME = previousHome;
    vi.restoreAllMocks();
    await fs.rm(home, { recursive: true, force: true });
  });

  describe('formatAge', () => {
    it('buckets into just now, minutes, hours and days', () => {
      const now = Date.parse('2026-08-27T12:00:00.000Z');
      expect(formatAge('2026-08-27T11:59:50.000Z', now)).toBe('just now');
      expect(formatAge('2026-08-27T11:41:00.000Z', now)).toBe('19m');
      expect(formatAge('2026-08-27T09:00:00.000Z', now)).toBe('3h');
      expect(formatAge('2026-08-24T12:00:00.000Z', now)).toBe('3d');
      expect(formatAge('not a date', now)).toBe('?');
    });
  });

  describe('summarizeArgs', () => {
    it('quotes strings, flattens whitespace, and caps the line', () => {
      expect(summarizeArgs({})).toBe('(no arguments)');
      expect(summarizeArgs({ text: 'hello\n\nworld', count: 2, tags: ['a'] })).toBe('text="hello world" count=2 tags=["a"]');
      expect(summarizeArgs({ text: 'x'.repeat(200) }).length).toBeLessThanOrEqual(80);
    });
  });

  describe('list and show', () => {
    it('prints the empty state with the store path when nothing is held', () => {
      const lines = [];
      vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)));
      expect(listCommand({})).toEqual([]);
      expect(lines.join('\n')).toContain('No drafts in');
      expect(lines.join('\n')).toContain('XACTIONS_MCP_REQUIRE_APPROVAL');
    });

    it('renders tool, args summary and age for each draft', () => {
      createDraft('x_post_tweet', { text: 'Shipping approval mode today.' });
      createDraft('x_follow_user', { username: 'nasa' });
      const lines = [];
      vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)));
      const drafts = listCommand({});
      expect(drafts).toHaveLength(2);
      const out = lines.join('\n');
      expect(out).toContain('x_post_tweet');
      expect(out).toContain('text="Shipping approval mode today."');
      expect(out).toContain('username="nasa"');
      expect(out).toContain('just now');
      expect(out).toContain('2 drafts, 2 pending');
    });

    it('filters by status and rejects an unknown one', () => {
      createDraft('x_post_tweet', { text: 'a' });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(listCommand({ status: 'executed' })).toEqual([]);
      expect(listCommand({ status: 'pending' })).toHaveLength(1);
      expect(() => listCommand({ status: 'bogus' })).toThrow(/--status must be one of/);
    });

    it('show prints the full arguments and throws on an unknown id', () => {
      const draft = createDraft('x_post_tweet', { text: 'full text here', replyTo: '123' });
      const lines = [];
      vi.spyOn(console, 'log').mockImplementation((line) => lines.push(String(line)));
      showCommand(draft.id, {});
      const out = lines.join('\n');
      expect(out).toContain(draft.id);
      expect(out).toContain('"replyTo": "123"');
      expect(() => showCommand('nope', {})).toThrow(/No draft with id "nope"/);
    });
  });

  describe('approve', () => {
    it('replays the stored call through the executor and records the result', async () => {
      const draft = createDraft('x_post_tweet', { text: 'go' });
      const execute = vi.fn(async (tool, args) => ({ posted: tool, args }));
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const [updated] = await approveCommand(draft.id, {}, { loadExecutor: async () => execute });

      expect(execute).toHaveBeenCalledWith('x_post_tweet', { text: 'go' });
      expect(updated.status).toBe('executed');
      expect(getDraft(draft.id).result).toEqual({ posted: 'x_post_tweet', args: { text: 'go' } });
    });

    it('records a failure, sets the exit code, and refuses a second approval', async () => {
      const draft = createDraft('x_post_tweet', { text: 'go' });
      const execute = vi.fn(async () => {
        throw new Error('X said no');
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      process.exitCode = 0;

      const [updated] = await approveCommand(draft.id, {}, { loadExecutor: async () => execute });
      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('X said no');
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;

      await expect(approveCommand(draft.id, {}, { loadExecutor: async () => execute })).rejects.toThrow(/is failed/);
    });

    it('--all runs every pending draft oldest first and skips finished ones', async () => {
      const first = createDraft('x_post_tweet', { text: 'first' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = createDraft('x_like_tweet', { id: '1' });
      const seen = [];
      const execute = vi.fn(async (tool) => {
        seen.push(tool);
        return null;
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const results = await approveCommand(undefined, { all: true }, { loadExecutor: async () => execute });
      expect(results.map((d) => d.id)).toEqual([first.id, second.id]);
      expect(seen).toEqual(['x_post_tweet', 'x_like_tweet']);

      const again = await approveCommand(undefined, { all: true }, { loadExecutor: async () => execute });
      expect(again).toEqual([]);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('needs an id or --all, not both, and never loads the executor for a bad call', async () => {
      const loadExecutor = vi.fn();
      await expect(approveCommand(undefined, {}, { loadExecutor })).rejects.toThrow(/Give a draft id/);
      await expect(approveCommand('x', { all: true }, { loadExecutor })).rejects.toThrow(/not both/);
      expect(loadExecutor).not.toHaveBeenCalled();
    });
  });

  describe('discard and clear', () => {
    it('discard removes any draft; clear removes only finished ones', async () => {
      const keep = createDraft('x_post_tweet', { text: 'keep' });
      const drop = createDraft('x_post_tweet', { text: 'drop' });
      const done = createDraft('x_post_tweet', { text: 'done' });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await approveCommand(done.id, {}, { loadExecutor: async () => async () => 'ok' });

      expect(discardCommand(drop.id, {}).id).toBe(drop.id);
      expect(clearCommand({})).toBe(1);
      expect(listDrafts().map((d) => d.id)).toEqual([keep.id]);
      expect(() => discardCommand(drop.id, {})).toThrow(/No draft/);
    });
  });

  describe('binary', () => {
    it('lists, shows, discards and clears through the real CLI with --json', () => {
      const draft = createDraft('x_post_tweet', { text: 'from the binary' });

      const listed = JSON.parse(cli(['drafts', 'list', '--json'], home));
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(draft.id);

      const shown = JSON.parse(cli(['drafts', 'show', draft.id, '--json'], home));
      expect(shown.args.text).toBe('from the binary');

      const removed = JSON.parse(cli(['drafts', 'discard', draft.id, '--json'], home));
      expect(removed.id).toBe(draft.id);

      const cleared = JSON.parse(cli(['drafts', 'clear', '--json'], home));
      expect(cleared).toEqual({ removed: 0, remaining: 0 });
    });

    it('reports an unknown id as a JSON error and a non-zero exit', () => {
      let failure;
      try {
        cli(['drafts', 'show', 'missing', '--json'], home);
      } catch (error) {
        failure = error;
      }
      expect(failure.status).toBe(1);
      expect(JSON.parse(failure.stdout).error).toMatch(/No draft with id "missing"/);
    });
  });
});
