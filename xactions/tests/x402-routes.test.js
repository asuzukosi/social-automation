// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The price table and the routes it claims to price must agree.
 *
 * `npm run check:x402` enforces this in the docs gate; this runs the same
 * reconciliation inside `npm test`, because the failure it catches is not a
 * docs problem. A price with no route sends a paying agent to a 404, and a
 * route with no price is served free next to siblings that are charged. Both
 * had happened, at a scale nobody noticed: 66 dead prices and 100 free
 * endpoints, found only by comparing the two lists mechanically.
 */

import { describe, it, expect } from 'vitest';
import { reconcile, collectAiRoutes, operationToPath, pathToOperation } from '../scripts/check-x402-routes.mjs';
import * as config from '../api/config/x402-config.js';

describe('x402 price table', () => {
  it('prices every AI endpoint, or declares it free with a reason', () => {
    const { unclassified } = reconcile(config);
    expect(
      unclassified.map((u) => `${u.operation} (${u.file})`),
      'these endpoints are served without payment and without a decision',
    ).toEqual([]);
  });

  it('has no price for a route that does not exist', () => {
    const { deadPrices } = reconcile(config);
    expect(deadPrices, 'published in /api/ai/pricing, answers 404').toEqual([]);
  });

  it('has no free declaration for a route that does not exist', () => {
    const { staleFree } = reconcile(config);
    expect(staleFree).toEqual([]);
  });

  it('gives every free endpoint a reason someone can read', () => {
    for (const [operation, reason] of Object.entries(config.FREE_OPERATIONS)) {
      expect(reason.length, `${operation} needs a real reason, not a placeholder`).toBeGreaterThan(20);
    }
  });

  it('states every price as a positive dollar amount', () => {
    for (const [operation, price] of Object.entries(config.AI_OPERATION_PRICES)) {
      expect(price, `${operation} has a malformed price`).toMatch(/^\$\d+(\.\d+)?$/);
      expect(Number.parseFloat(price.slice(1)), `${operation} is priced at zero`).toBeGreaterThan(0);
    }
  });
});

describe('operation and path derivation', () => {
  it('round-trips an operation through its path', () => {
    for (const operation of Object.keys(config.AI_OPERATION_PRICES)) {
      expect(config.operationForPath(config.pathForOperation(operation))).toBe(operation);
    }
  });

  it('reads the whole path, not the first two segments', () => {
    // The bug this replaced: /api/ai/monitor/alert/new-followers resolved to
    // "monitor:alert", which has no price, so a priced endpoint was free.
    expect(config.operationForPath('/api/ai/monitor/alert/new-followers')).toBe('monitor:alert:new-followers');
    expect(config.operationForPath('/api/ai/scrape/profile')).toBe('scrape:profile');
  });

  it('tolerates a query string and a trailing slash', () => {
    expect(config.operationForPath('/api/ai/scrape/profile/')).toBe('scrape:profile');
    expect(config.operationForPath('/api/ai/scrape/profile?username=nasa')).toBe('scrape:profile');
  });

  it('returns null for paths that are not priceable operations', () => {
    expect(config.operationForPath('/api/ai/health')).toBeNull();
    expect(config.operationForPath('/api/user/profile')).toBeNull();
    expect(config.operationForPath('/')).toBeNull();
  });

  it('agrees with the checker helpers', () => {
    expect(operationToPath('scrape:profile')).toBe(config.pathForOperation('scrape:profile'));
    expect(pathToOperation('/api/ai/scrape/profile')).toBe(config.operationForPath('/api/ai/scrape/profile'));
  });
});

describe('route collection', () => {
  it('finds the AI routes, including ones declared as an array of paths', () => {
    const routes = collectAiRoutes();
    expect(routes.size).toBeGreaterThan(300);
    // monitor.js declares ['/alert/new-followers', '/new-followers'] together;
    // a collector that only understood the single-string form would miss the
    // second and report the endpoint as nonexistent.
    expect(routes.has('/api/ai/alert/new-followers')).toBe(true);
    expect(routes.has('/api/ai/monitor/alert/new-followers')).toBe(true);
  });

  it('skips parameterised paths, which are not priced individually', () => {
    for (const path of collectAiRoutes().keys()) {
      expect(path).not.toContain(':');
    }
  });
});
