// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSearcher, tokenize, publicSources, mergeSources, docsDigest, searchGitHub, SUGGESTED_QUESTIONS } from '../../src/ask/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('ask engine: retrieval over the real index', () => {
  let index;
  let searcher;
  beforeAll(() => {
    index = JSON.parse(readFileSync(join(ROOT, 'dashboard/data/ask-index.json'), 'utf8'));
    searcher = createSearcher(index);
  });

  it('indexes docs, skills, scripts, repo files and site pages', () => {
    expect(index.version).toBe(1);
    for (const kind of ['doc', 'skill', 'script', 'repo', 'page']) expect(index.counts[kind]).toBeGreaterThan(0);
    expect(searcher.size).toBe(index.chunks.length);
    for (const c of index.chunks.slice(0, 200)) {
      expect(c.u).toMatch(/^https:\/\/(xactions\.app|github\.com\/nirholas\/XActions)\//);
      expect(c.x.length).toBeLessThanOrEqual(1100);
    }
  });

  it('tokenizes with stemming and stop words removed', () => {
    expect(tokenize('How do I unfollow all the users?')).toEqual(['unfollow', 'all', 'user']);
  });

  it('puts the unfollow-everyone material and the unfollow skill at the top of "unfollow all users"', () => {
    const hits = searcher.search('how do i unfollow all users');
    expect(hits.length).toBeGreaterThan(3);
    const top = hits.slice(0, 3);
    expect(top.some((h) => h.p === 'skills/unfollow-management/SKILL.md')).toBe(true);
    expect(top.some((h) => h.t.toLowerCase().includes('unfollow everyone'))).toBe(true);
  });

  it('keeps frontmatter and keyword stuffing out of the indexed passages', () => {
    const skill = index.chunks.find((c) => c.p === 'skills/unfollow-management/SKILL.md');
    expect(skill.x).not.toMatch(/license:\s*Apache-2\.0/);
    expect(skill.x).not.toMatch(/^---/);
    // A keyword dump is one run-on line of short comma-separated phrases with
    // no code punctuation; comma-heavy code blocks are legitimate content.
    const stuffed = index.chunks.filter((c) => {
      if (c.x.includes('\n') || /[{};=()<>[\]`]/.test(c.x)) return false;
      const parts = c.x.split(',');
      return parts.length >= 12 && parts.filter((p) => p.trim().split(/\s+/).length <= 6).length / parts.length > 0.9;
    });
    expect(stuffed).toHaveLength(0);
  });

  it('routes MCP questions to the MCP setup docs', () => {
    const hits = searcher.search('connect XActions to Claude Desktop');
    expect(hits.slice(0, 4).some((h) => /mcp/i.test(h.p) || /mcp/i.test(h.t))).toBe(true);
  });

  it('finds the video downloader for a download question', () => {
    const hits = searcher.search('download a video from a tweet');
    expect(hits.slice(0, 4).some((h) => /video/i.test(h.p))).toBe(true);
  });

  it('caps results per document so one file cannot fill the list', () => {
    const hits = searcher.search('unfollow everyone script', { limit: 8, perDoc: 2 });
    const perDoc = new Map();
    for (const h of hits) perDoc.set(h.p, (perDoc.get(h.p) || 0) + 1);
    for (const n of perDoc.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it('returns nothing for a query made only of stop words', () => {
    expect(searcher.search('how do i')).toEqual([]);
  });

  it('every suggested question resolves to at least three sources', () => {
    for (const q of SUGGESTED_QUESTIONS) expect(searcher.search(q).length, q).toBeGreaterThanOrEqual(3);
  });

  it('docsDigest answers from the retrieved passages when no lane is free', () => {
    const hits = searcher.search('how do i unfollow all users').slice(0, 3);
    const digest = docsDigest('how do i unfollow all users', hits);
    expect(digest).toContain('[1] [');
    expect(digest).toContain(hits[0].u);
    expect(digest.toLowerCase()).toContain('unfollow');
    expect(docsDigest('anything', [])).toBe('');
  });

  it('mergeSources folds chunks of one URL into one numbered source', () => {
    const merged = mergeSources([
      { t: 'A › Intro', u: 'https://xactions.app/a', k: 'doc', p: 'a', x: 'first' },
      { t: 'A › Usage', u: 'https://xactions.app/a', k: 'doc', p: 'a', x: 'second' },
      { t: 'B', u: 'https://xactions.app/b', k: 'page', p: 'b', x: 'other' },
    ]);
    expect(merged.map((s) => s.t)).toEqual(['A', 'B']);
    expect(merged[0].x).toContain('first');
    expect(merged[0].x).toContain('second');
    expect(publicSources(merged).map((s) => s.n)).toEqual([1, 2]);
  });
});

describe('ask engine: live GitHub lane', () => {
  it('searches the repo issues without a token and never throws', async () => {
    const hits = await searchGitHub('unfollow', { token: process.env.GITHUB_TOKEN });
    expect(Array.isArray(hits)).toBe(true);
    for (const h of hits) expect(h.u).toContain('github.com/nirholas/XActions');
  });
});
