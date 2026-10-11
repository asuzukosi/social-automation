// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The translator is the playground's teaching surface: the snippet it prints
 * is the command a visitor will paste into their own terminal. A snippet that
 * names a flag or a command that does not exist is worse than no snippet,
 * so these tests check the shapes as well as the strings, and a companion
 * check in the docs auditor verifies the commands against the real CLI.
 */

import { describe, it, expect } from 'vitest';

import {
  QUERIES,
  DEFAULT_API_BASE,
  normalizeUsername,
  normalizeUsernames,
  clampParam,
  resolveQuery,
  apiPathFor,
  permalinkFor,
  queryFromSearch,
  translateQuery,
} from '../../src/codegen/queryTranslator.js';

describe('normalizeUsername', () => {
  it('strips an @ and surrounding whitespace', () => {
    expect(normalizeUsername('  @nasa ')).toBe('nasa');
  });

  it('extracts the handle from a profile URL on either domain', () => {
    expect(normalizeUsername('https://x.com/NASA')).toBe('NASA');
    expect(normalizeUsername('https://twitter.com/NASA/status/123')).toBe('NASA');
    expect(normalizeUsername('http://www.x.com/NASA')).toBe('NASA');
  });

  it('drops characters X does not allow in a handle', () => {
    expect(normalizeUsername('na sa!')).toBe('nasa');
    expect(normalizeUsername('')).toBe('');
    expect(normalizeUsername(null)).toBe('');
  });
});

describe('normalizeUsernames', () => {
  it('splits on commas, spaces and newlines', () => {
    expect(normalizeUsernames('nasa, spacex\n@github')).toEqual(['nasa', 'spacex', 'github']);
  });

  it('deduplicates case-insensitively, keeping the first spelling', () => {
    expect(normalizeUsernames('NASA, nasa, Nasa')).toEqual(['NASA']);
  });

  it('accepts an array as readily as a string', () => {
    expect(normalizeUsernames(['@a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('clampParam', () => {
  const spec = { default: 20, min: 1, max: 50 };

  it('clamps into range', () => {
    expect(clampParam(999, spec)).toBe(50);
    expect(clampParam(-5, spec)).toBe(1);
    expect(clampParam('30', spec)).toBe(30);
  });

  it('falls back to the default for junk', () => {
    expect(clampParam(undefined, spec)).toBe(20);
    expect(clampParam('abc', spec)).toBe(20);
  });
});

describe('resolveQuery', () => {
  it('rejects an unknown query and lists the real ones', () => {
    expect(() => resolveQuery('nope', {})).toThrow(/Unknown query/);
    expect(() => resolveQuery('nope', {})).toThrow(/profile/);
  });

  it('requires a username', () => {
    expect(() => resolveQuery('profile', { username: '' })).toThrow(/required/);
  });

  it('requires two accounts to compare and allows at most four', () => {
    expect(() => resolveQuery('compare', { users: 'nasa' })).toThrow(/at least two/);
    expect(() => resolveQuery('compare', { users: 'a,b,c,d,e' })).toThrow(/at most four/);
    expect(resolveQuery('compare', { users: 'nasa, spacex' }).users).toEqual(['nasa', 'spacex']);
  });

  it('applies the descriptor default when no limit is given', () => {
    expect(resolveQuery('timeline', { username: 'nasa' }).limit).toBe(QUERIES.timeline.params[1].default);
    expect(resolveQuery('report', { username: 'nasa' }).limit).toBe(QUERIES.report.params[1].default);
  });
});

describe('apiPathFor', () => {
  it('builds a path per query kind', () => {
    expect(apiPathFor(resolveQuery('profile', { username: 'nasa' }))).toBe('/api/playground/profile/nasa');
    expect(apiPathFor(resolveQuery('timeline', { username: 'nasa', limit: 5 }))).toBe(
      '/api/playground/timeline/nasa?limit=5'
    );
    expect(apiPathFor(resolveQuery('compare', { users: 'nasa,spacex', limit: 10 }))).toBe(
      '/api/playground/compare?users=nasa%2Cspacex&limit=10'
    );
  });

  it('covers every declared query, so a new one cannot be half-wired', () => {
    for (const kind of Object.keys(QUERIES)) {
      const input = kind === 'compare' ? { users: 'nasa,spacex' } : { username: 'nasa' };
      expect(() => apiPathFor(resolveQuery(kind, input))).not.toThrow();
    }
  });
});

describe('permalinks', () => {
  it('round-trips a query through a URL', () => {
    const original = resolveQuery('report', { username: 'nasa', limit: 40 });
    const link = permalinkFor(original, 'https://xactions.app');
    const search = new URL(link).search;
    expect(queryFromSearch(search)).toEqual(original);
  });

  it('round-trips a comparison', () => {
    const original = resolveQuery('compare', { users: 'nasa,spacex', limit: 25 });
    const search = new URL(permalinkFor(original, 'https://xactions.app')).search;
    expect(queryFromSearch(search)).toEqual(original);
  });

  it('returns null rather than throwing on a malformed URL', () => {
    expect(queryFromSearch('?q=nonsense&u=nasa')).toBeNull();
    expect(queryFromSearch('?u=nasa')).toBeNull();
    expect(queryFromSearch('?q=compare&u=nasa')).toBeNull();
  });
});

describe('translateQuery', () => {
  it('emits every lane for every query kind, with no empty snippet', () => {
    for (const kind of Object.keys(QUERIES)) {
      const input = kind === 'compare' ? { users: 'nasa,spacex' } : { username: 'nasa' };
      const lanes = translateQuery(resolveQuery(kind, input));

      expect(lanes.map((l) => l.id)).toEqual(['cli', 'node', 'http', 'mcp', 'tool']);
      for (const lane of lanes) {
        expect(lane.code.trim().length).toBeGreaterThan(0);
        expect(lane.note.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('puts the resolved username into each lane rather than a placeholder', () => {
    const lanes = translateQuery(resolveQuery('profile', { username: '@NASA' }));
    for (const lane of lanes) expect(lane.code).toContain('NASA');
  });

  it('emits a valid MCP tool call as JSON', () => {
    const lanes = translateQuery(resolveQuery('report', { username: 'nasa', limit: 30 }));
    const call = JSON.parse(lanes.find((l) => l.id === 'tool').code);
    expect(call.name).toBe('x_account_report');
    expect(call.arguments).toEqual({ username: 'nasa', limit: 30 });
  });

  it('points the HTTP lane at the given origin', () => {
    const query = resolveQuery('profile', { username: 'nasa' });
    const custom = translateQuery(query, { apiBase: 'http://localhost:8080' });
    expect(custom.find((l) => l.id === 'http').code).toContain('http://localhost:8080/api/playground/profile/nasa');

    const fallback = translateQuery(query);
    expect(fallback.find((l) => l.id === 'http').code).toContain(DEFAULT_API_BASE);
  });

  it('names only commands the CLI actually has', () => {
    const commands = new Set(['profile', 'tweets', 'analyze']);
    for (const kind of Object.keys(QUERIES)) {
      const input = kind === 'compare' ? { users: 'nasa,spacex' } : { username: 'nasa' };
      const cli = translateQuery(resolveQuery(kind, input)).find((l) => l.id === 'cli').code;
      const command = cli.replace('npx xactions ', '').split(' ')[0];
      expect(commands.has(command)).toBe(true);
    }
  });
});

describe('QUERIES descriptors', () => {
  it('declares a first parameter and a summary for every query', () => {
    for (const [kind, spec] of Object.entries(QUERIES)) {
      expect(spec.label, kind).toBeTruthy();
      expect(spec.summary, kind).toBeTruthy();
      expect(spec.icon, kind).toBeTruthy();
      expect(spec.tier, kind).toBe('guest');
      expect(spec.params.length, kind).toBeGreaterThan(0);
      expect(spec.params[0].required, kind).toBe(true);
    }
  });

  it('gives every numeric parameter a default inside its own range', () => {
    for (const spec of Object.values(QUERIES)) {
      for (const param of spec.params.filter((p) => p.type === 'number')) {
        expect(param.default).toBeGreaterThanOrEqual(param.min);
        expect(param.default).toBeLessThanOrEqual(param.max);
      }
    }
  });
});
