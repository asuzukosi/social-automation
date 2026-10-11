#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Reconcile the x402 price table against the routes that actually exist.
 *
 * A price is a promise to a machine. `AI_OPERATION_PRICES` is published by
 * `/api/ai/pricing`, `/api/ai/health`, and the OpenAPI document, and it is what
 * the payment middleware turns into protected routes. Two ways it can lie, and
 * both had happened by August 2026:
 *
 *   1. **A price with no route.** Sixty-six of them. An agent reads the
 *      catalogue, signs a payment, and gets a 404. No money is lost (the SDK
 *      cancels settlement on a 4xx) but the catalogue is fiction.
 *   2. **A route with no price.** A hundred of them. The endpoint works and is
 *      served free while its siblings are charged, which is a silent revenue
 *      hole and an unfair surprise to anyone who did pay.
 *
 * Neither is visible by reading either file alone, which is why they drifted for
 * months. This script derives the truth from `api/routes/ai/index.js` and the
 * route modules it mounts, and fails when the two sides disagree.
 *
 * An endpoint that is deliberately free lives in `FREE_OPERATIONS` in the
 * config, with a reason. That list is the only way to be unpriced and pass.
 *
 * Usage:
 *   node scripts/check-x402-routes.mjs
 *   node scripts/check-x402-routes.mjs --json
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AI_ROUTES = join(ROOT, 'api', 'routes', 'ai');

/**
 * Every POST endpoint mounted under /api/ai, read from the router source.
 *
 * Static analysis rather than booting Express: the server pulls in Prisma,
 * Redis and Puppeteer, which is far too much machinery for a docs check, and a
 * check nobody can run is a check nobody runs.
 *
 * @returns {Map<string, string>} path -> the module file that defines it
 */
export function collectAiRoutes() {
  const index = readFileSync(join(AI_ROUTES, 'index.js'), 'utf8');

  const imports = Object.fromEntries(
    [...index.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w-]+)\.js'/g)].map((m) => [m[1], `${m[2]}.js`]),
  );

  const mounts = [];
  for (const m of index.matchAll(/router\.use\((\[[^\]]+\]|'[^']+')\s*,\s*(\w+)\)/g)) {
    const paths = m[1].startsWith('[')
      ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      : [m[1].slice(1, -1)];
    mounts.push({ paths, varName: m[2] });
  }

  const routes = new Map();
  for (const mount of mounts) {
    const file = imports[mount.varName];
    if (!file) continue;
    let source;
    try {
      source = readFileSync(join(AI_ROUTES, file), 'utf8');
    } catch {
      continue; // A mount whose module is gone is a different bug; not this check's.
    }
    // Both `router.post('/x', ...)` and `router.post(['/x', '/y'], ...)`. Missing
    // the array form would hide endpoints from the check, which is the exact
    // failure this script exists to prevent.
    for (const route of source.matchAll(/router\.post\(\s*(\[[^\]]*\]|'[^']+')/g)) {
      const declared = route[1].startsWith('[')
        ? [...route[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
        : [route[1].slice(1, -1)];
      for (const suffix of declared) {
        for (const prefix of mount.paths) {
          const path = `/api/ai${prefix}${suffix === '/' ? '' : suffix}`.replace(/\/+/g, '/');
          if (path.includes(':')) continue; // parameterised paths are not priced individually
          if (!routes.has(path)) routes.set(path, file);
        }
      }
    }
  }
  return routes;
}

/** `scrape:profile` -> `/api/ai/scrape/profile` */
export const operationToPath = (operation) => `/api/ai/${operation.split(':').join('/')}`;

/** `/api/ai/scrape/profile` -> `scrape:profile` */
export const pathToOperation = (path) => path.replace('/api/ai/', '').split('/').join(':');

/**
 * Compare the price table and the free list against the real routes.
 *
 * @param {object} config - The loaded x402-config module
 * @returns {{ deadPrices: string[], unclassified: Array<{operation: string, file: string}>, staleFree: string[] }}
 */
export function reconcile(config) {
  const routes = collectAiRoutes();
  const priced = new Set(Object.keys(config.AI_OPERATION_PRICES));
  const free = new Set(Object.keys(config.FREE_OPERATIONS ?? {}));

  const deadPrices = [...priced].filter((op) => !routes.has(operationToPath(op))).sort();
  const staleFree = [...free].filter((op) => !routes.has(operationToPath(op))).sort();

  const unclassified = [...routes]
    .map(([path, file]) => ({ operation: pathToOperation(path), file }))
    .filter(({ operation }) => !priced.has(operation) && !free.has(operation))
    .sort((a, b) => a.operation.localeCompare(b.operation));

  return { deadPrices, unclassified, staleFree, routeCount: routes.size, pricedCount: priced.size, freeCount: free.size };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const config = await import('../api/config/x402-config.js');
  const result = reconcile(config);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.deadPrices.length + result.unclassified.length + result.staleFree.length > 0 ? 1 : 0);
  }

  const problems = result.deadPrices.length + result.unclassified.length + result.staleFree.length;

  console.log(
    `x402 routes: ${result.routeCount} POST endpoints under /api/ai, ` +
    `${result.pricedCount} priced, ${result.freeCount} free by declaration.`,
  );

  if (result.deadPrices.length > 0) {
    console.log(`\n❌ ${result.deadPrices.length} price${result.deadPrices.length === 1 ? '' : 's'} with no route.`);
    console.log('   Published in /api/ai/pricing, answers 404. Delete or re-point:');
    for (const op of result.deadPrices) console.log(`     ${op}  ->  ${operationToPath(op)}`);
  }

  if (result.unclassified.length > 0) {
    console.log(`\n❌ ${result.unclassified.length} route${result.unclassified.length === 1 ? '' : 's'} that are neither priced nor declared free.`);
    console.log('   These are served without payment. Add a price, or add to FREE_OPERATIONS with a reason:');
    for (const { operation, file } of result.unclassified) console.log(`     ${operation.padEnd(38)} (${file})`);
  }

  if (result.staleFree.length > 0) {
    console.log(`\n❌ ${result.staleFree.length} entr${result.staleFree.length === 1 ? 'y' : 'ies'} in FREE_OPERATIONS with no route:`);
    for (const op of result.staleFree) console.log(`     ${op}`);
  }

  if (problems === 0) {
    console.log('Every route is priced or declared free, and every price has a route.');
    process.exit(0);
  }

  console.log(`\n${problems} problem${problems === 1 ? '' : 's'}. See api/config/x402-config.js.`);
  process.exit(1);
}
