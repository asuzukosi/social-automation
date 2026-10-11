// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Every job type a route queues has a processor.
 *
 * For most of the API's life, routes queued job types nothing processed: the
 * job sat in Redis while the route answered "queued", and on a priced route
 * the caller paid for it. The queue now refuses unknown types at runtime; this
 * test catches the same gap before it ships, by reading every route file for
 * the types it queues and checking each against the registry.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadProcessors } from '../../../api/services/processors/registry.js';

const ROUTES = path.resolve(import.meta.dirname, '../../../api/routes');

function routeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * The job types one route file queues, through queueJob/addJob directly or
 * through a local `queueOperation(res, id, 'type', ...)` / `queueOp(...)` helper.
 */
export function queuedTypes(source) {
  const types = new Set();
  const direct = /\b(?:queueJob|addJob)\(\s*(?:'([A-Za-z]+)'|\{)/g;
  let match;
  while ((match = direct.exec(source))) {
    if (match[1]) {
      types.add(match[1]);
      continue;
    }
    const body = source.slice(match.index, match.index + 900);
    const type = body.match(/\btype:\s*'([A-Za-z]+)'/);
    if (type) types.add(type[1]);
  }
  const helper = /\bqueue(?:Operation|Op)\(\s*res\s*,[^,]+,\s*'([A-Za-z]+)'/g;
  while ((match = helper.exec(source))) types.add(match[1]);
  return types;
}

describe('queued job types', () => {
  it('the scanner reads each way routes queue', () => {
    const source = `
      await queueJob({ type: 'alpha', config: {} });
      await addJob('beta', { userId });
      return queueOperation(res, generateOperationId(), 'gamma', { session });
      return queueOp(res, id, 'delta', { session });
    `;
    expect([...queuedTypes(source)].sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('every type a route queues has a processor', async () => {
    const processors = await loadProcessors();
    const missing = [];
    let total = 0;
    for (const file of routeFiles(ROUTES)) {
      for (const type of queuedTypes(fs.readFileSync(file, 'utf8'))) {
        total++;
        if (!processors.has(type)) missing.push(`${path.relative(ROUTES, file)}: ${type}`);
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(missing, `routes queue job types with no processor:\n${missing.join('\n')}`).toEqual([]);
  });
});
