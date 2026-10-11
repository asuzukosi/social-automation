// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests: types/index.d.ts against the runtime surface of src/index.js
 *
 * The declaration file is hand-written and had drifted in both directions:
 * 28 runtime exports (createHttpScraper, scrape, platforms, the adapter
 * registry, most Twitter scrapers) had no type at all, while 21 declared
 * names (downloadVideo, unrollThread, ClientTweet, the client error classes)
 * did not exist at runtime, so `import { X } from 'xactions'` type-checked
 * and then crashed. This test pins the two lists to each other.
 *
 * Interfaces and type aliases are exempt from the "must exist at runtime"
 * check because they have no runtime value by design.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DTS_PATH = path.resolve(__dirname, '../../types/index.d.ts');

const TYPE_ONLY_KINDS = new Set(['interface', 'type']);

/**
 * Parse every top-level `export` declaration in a .d.ts into a name -> kind map.
 * Handles `export function`, `export declare const|class|enum|...`, and
 * `export { a, b as c }` lists (the local name is the one that must exist).
 */
function parseDeclaredExports(source) {
  const declared = new Map();
  const declPattern = /^export\s+(?:declare\s+)?(function|const|let|var|class|abstract class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of source.matchAll(declPattern)) {
    declared.set(match[2], match[1] === 'abstract class' ? 'class' : match[1]);
  }
  const listPattern = /^export\s*\{([^}]*)\}/gm;
  for (const match of source.matchAll(listPattern)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) declared.set(name, 'reexport');
    }
  }
  return declared;
}

const runtimeNames = Object.keys(await import('../../src/index.js')).sort();
const declared = parseDeclaredExports(readFileSync(DTS_PATH, 'utf8'));

describe('types/index.d.ts matches the runtime exports of src/index.js', () => {
  it('parses a non-trivial declaration file', () => {
    expect(runtimeNames.length).toBeGreaterThan(50);
    expect(declared.size).toBeGreaterThan(runtimeNames.length);
    expect(declared.get('createBrowser')).toBe('function');
    expect(declared.get('ScrapeOptions')).toBe('interface');
  });

  it('declares a type for every runtime export', () => {
    const undeclared = runtimeNames.filter((name) => !declared.has(name));
    expect(undeclared, `runtime exports with no declaration: ${undeclared.join(', ')}`).toEqual([]);
  });

  it('never declares a value export that the runtime does not provide', () => {
    const runtime = new Set(runtimeNames);
    const phantom = [...declared]
      .filter(([, kind]) => !TYPE_ONLY_KINDS.has(kind))
      .map(([name]) => name)
      .filter((name) => !runtime.has(name));
    expect(phantom, `declared but missing at runtime: ${phantom.join(', ')}`).toEqual([]);
  });

  it('declares classes for the runtime exports that are classes', async () => {
    const mod = await import('../../src/index.js');
    const runtimeClasses = ['Scraper', 'Tweet', 'Profile', 'Message', 'ScraperError', 'BaseAdapter'];
    for (const name of runtimeClasses) {
      expect(typeof mod[name], `${name} is exported at runtime`).toBe('function');
      expect(declared.get(name), `${name} is declared as a class`).toBe('class');
    }
  });

  it('declares functions for the runtime exports that are functions', async () => {
    const mod = await import('../../src/index.js');
    const misdeclared = runtimeNames.filter((name) => {
      const kind = declared.get(name);
      if (typeof mod[name] !== 'function' || kind === 'class' || kind === 'reexport') return false;
      return kind !== 'function' && kind !== 'const';
    });
    expect(misdeclared).toEqual([]);
  });
});
