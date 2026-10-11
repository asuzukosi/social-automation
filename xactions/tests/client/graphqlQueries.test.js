// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests — src/client/api/graphqlQueries.js
 *
 * The repo carried two independent tables of X GraphQL query IDs, and they
 * drifted: 11 of the client's IDs went stale while the shared endpoint map
 * stayed current, so every `Scraper.getProfile()` call answered
 * `HTTP 404 {"message":"Query not found"}`. The client now derives its IDs
 * from the shared map. These tests fail the moment a second copy reappears.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect } from 'vitest';
import { GRAPHQL_ENDPOINTS, BEARER_TOKEN, buildGraphQLUrl } from '../../src/client/api/graphqlQueries.js';
import { GRAPHQL, BEARER_TOKEN as SHARED_BEARER_TOKEN } from '../../src/scrapers/twitter/http/endpoints.js';

describe('GraphQL query ID registry', () => {
  it('shares one bearer token with the HTTP scraper', () => {
    expect(BEARER_TOKEN).toBe(SHARED_BEARER_TOKEN);
  });

  it('never disagrees with the shared endpoint map', () => {
    const drifted = [];

    for (const [name, endpoint] of Object.entries(GRAPHQL_ENDPOINTS)) {
      const shared = GRAPHQL[name];
      if (!shared) continue; // REST-only entries have no shared counterpart
      if (endpoint.queryId !== shared.queryId) {
        drifted.push(`${name}: client=${endpoint.queryId} shared=${shared.queryId}`);
      }
    }

    expect(drifted, `Query IDs drifted from src/scrapers/twitter/http/endpoints.js:\n${drifted.join('\n')}`)
      .toEqual([]);
  });

  it('gives every GraphQL endpoint a query ID and operation name', () => {
    for (const [name, endpoint] of Object.entries(GRAPHQL_ENDPOINTS)) {
      if (endpoint.isRest) {
        expect(typeof endpoint.url, `${name} is REST and needs a url()`).toBe('function');
        continue;
      }
      expect(endpoint.queryId, `${name} has no query ID`).toBeTruthy();
      expect(endpoint.operationName, `${name} has no operation name`).toBeTruthy();
    }
  });

  it('builds a GraphQL URL containing the current query ID', () => {
    const url = buildGraphQLUrl(GRAPHQL_ENDPOINTS.UserByScreenName, { screen_name: 'nasa' });

    expect(url).toContain(GRAPHQL.UserByScreenName.queryId);
    expect(url).toContain('/UserByScreenName');
    expect(decodeURIComponent(url)).toContain('"screen_name":"nasa"');
  });

  it('builds REST URLs from their url() factory', () => {
    expect(buildGraphQLUrl(GRAPHQL_ENDPOINTS.Trends)).toBe('https://x.com/i/api/2/guide.json');
  });
});
