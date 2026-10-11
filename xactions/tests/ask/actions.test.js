// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActionMatcher, publicActions } from '../../src/ask/actions.js';
import { createSearcher } from '../../src/ask/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

describe('ask actions: the catalog stays true to the repo', () => {
  let catalog;
  beforeAll(() => { catalog = read('dashboard/data/ask-actions.json'); });

  it('covers all three executable surfaces', () => {
    for (const kind of ['script', 'cli', 'mcp']) expect(catalog.counts[kind]).toBeGreaterThan(50);
    expect(new Set(catalog.actions.map((a) => `${a.kind}:${a.id}`)).size).toBe(catalog.actions.length);
  });

  it('every script points at a file that exists and a page that was generated', () => {
    for (const action of catalog.actions.filter((a) => a.kind === 'script')) {
      expect(existsSync(join(ROOT, action.path)), action.path).toBe(true);
      if (action.page) {
        expect(existsSync(join(ROOT, 'dashboard', `${action.page}.html`)), action.page).toBe(true);
      }
    }
  });

  it('every CLI command names a command the CLI actually defines', () => {
    let sources = readFileSync(join(ROOT, 'src/cli/index.js'), 'utf8');
    for (const f of readdirSync(join(ROOT, 'src/cli/commands'))) {
      if (f.endsWith('.js')) sources += readFileSync(join(ROOT, 'src/cli/commands', f), 'utf8');
    }
    const defined = new Set([...sources.matchAll(/\.command\(\s*'([\w-]+)/g)].map((m) => m[1]));
    for (const action of catalog.actions.filter((a) => a.kind === 'cli')) {
      const [, root] = action.command.split(' ');
      expect(defined.has(root), action.command).toBe(true);
    }
  });

  it('every MCP tool is advertised by the server', () => {
    const server = readFileSync(join(ROOT, 'src/mcp/server.js'), 'utf8');
    for (const action of catalog.actions.filter((a) => a.kind === 'mcp')) {
      expect(server.includes(`name: '${action.id}'`), action.id).toBe(true);
    }
  });

  it('never tells anyone to run a script on the author\'s profile', () => {
    for (const action of catalog.actions) {
      expect(action.runOn || '').not.toMatch(/x\.com\/(nichxbt|nirholas)$/);
    }
  });
});

describe('ask actions: matching', () => {
  let matcher;
  let searcher;
  beforeAll(() => {
    matcher = createActionMatcher(read('dashboard/data/ask-actions.json'));
    searcher = createSearcher(read('dashboard/data/ask-index.json'));
  });

  const ask = (q) => publicActions(matcher.match(q, searcher.search(q)));

  it('answers "unfollow all users" with the unfollow-everyone script', () => {
    const actions = ask('how do i unfollow all users');
    expect(actions[0].kind).toBe('script');
    expect(actions[0].id).toBe('unfollow-everyone');
    expect(actions[0].run).toContain('Console');
    expect(actions.some((a) => a.kind === 'mcp' && a.id === 'x_unfollow_all')).toBe(true);
  });

  it('offers the terminal when the question is about the terminal', () => {
    const actions = ask('scrape followers from the terminal');
    expect(actions[0].kind).toBe('cli');
    expect(actions[0].run).toMatch(/^xactions /);
    expect(actions[0].install).toBe('npm install -g xactions');
  });

  it('leads with the asked-for surface even when another surface scores higher', () => {
    // A browser script can out-score the CLI on word overlap for this question,
    // and did: scrape-followers beat the CLI by half a point once an unrelated
    // description was reworded. Intent has to order the kinds, not just add to
    // their score, or any catalog edit can flip the answer.
    const ranked = matcher.match('scrape followers from the terminal', searcher.search('scrape followers from the terminal'));
    const firstCli = ranked.findIndex((a) => a.kind === 'cli');
    const firstOther = ranked.findIndex((a) => a.kind !== 'cli');
    expect(firstCli).toBe(0);
    if (firstOther !== -1) {
      // The higher-scoring other-surface action is still offered, just not first.
      expect(firstOther).toBeGreaterThan(firstCli);
    }
  });

  it('still ranks purely by score when the question names no surface', () => {
    const q = 'how do i unfollow all users';
    const ranked = matcher.match(q, searcher.search(q));
    const scores = ranked.map((a) => a.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('returns nothing runnable for a conceptual question', () => {
    // "xactions" appears in every CLI title, so without the common-term filter
    // this question would offer arbitrary commands.
    expect(ask('is xactions safe')).toEqual([]);
    expect(ask('what is xactions')).toEqual([]);
  });

  it('spreads across surfaces instead of returning near-duplicates', () => {
    const kinds = ask('how do i post a thread').map((a) => a.kind);
    expect(new Set(kinds).size).toBeGreaterThan(1);
    for (const kind of new Set(kinds)) expect(kinds.filter((k) => k === kind).length).toBeLessThanOrEqual(2);
  });

  it('only links a run destination that is a real URL, never a placeholder', () => {
    for (const q of ['unfollow everyone', 'download a video', 'read my dms', 'block bots']) {
      for (const action of ask(q)) {
        if (action.runOnUrl) expect(action.runOnUrl).not.toMatch(/[<>{}$]|USERNAME/);
      }
    }
  });
});
