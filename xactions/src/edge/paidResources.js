// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The paid resources this deployment can actually serve.
 *
 * Discovery documents are promises to a machine. An agent reads
 * `/.well-known/x402`, picks a resource, pays, and calls it; if the endpoint
 * then answers 503 because it needed a database nobody deployed, the agent has
 * spent money for nothing and the catalogue has lied. So this list is not the
 * full price table from `api/config/x402-config.js`: it is only the endpoints
 * that run at the edge, with no backend, and return real data on the request
 * right after the payment settles.
 *
 * Adding an entry here is the last step of shipping a paid endpoint, not the
 * first: the handler has to exist and work before it is advertised.
 *
 * @module src/edge/paidResources
 * @author nichxbt
 */

/**
 * @typedef {object} PaidResource
 * @property {string} path - Absolute path on this site.
 * @property {string} method - The method a crawler should probe with. Both GET
 *   (query parameters) and POST (JSON body) are accepted by every resource.
 * @property {string} operation - The key in AI_OPERATION_PRICES.
 * @property {string} price - Dollar string, the source of truth for the gate.
 * @property {string} description
 * @property {object} input - JSON Schema of the request body.
 * @property {object} output - JSON Schema of a successful response.
 */

/** @type {PaidResource[]} */
export const PAID_RESOURCES = [
  {
    path: '/api/ai/scrape/profile',
    method: 'GET',
    operation: 'scrape:profile',
    price: '$0.001',
    description:
      'Public X profile: display name, bio with t.co links expanded, location, website, join date, follower and following counts, post and like counts, avatar, banner, verification and pinned post id.',
    input: {
      type: 'object',
      required: ['username'],
      properties: {
        username: {
          type: 'string',
          description: 'Handle, @handle, or profile URL.',
          examples: ['nasa', '@nasa', 'https://x.com/nasa'],
        },
      },
    },
    output: {
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            username: { type: 'string' },
            bio: { type: 'string' },
            location: { type: 'string' },
            website: { type: ['string', 'null'] },
            joined: { type: ['string', 'null'], format: 'date-time' },
            following: { type: 'integer' },
            followers: { type: 'integer' },
            tweets: { type: 'integer' },
            likes: { type: 'integer' },
            media: { type: 'integer' },
            avatar: { type: ['string', 'null'] },
            header: { type: ['string', 'null'] },
            verified: { type: 'boolean' },
            protected: { type: 'boolean' },
            pinnedTweetId: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
  {
    path: '/api/ai/scrape/tweets',
    method: 'GET',
    operation: 'scrape:tweets',
    price: '$0.005',
    description:
      "A user's recent public posts with text, timestamps, like/repost/reply/quote/bookmark/view counts, media with direct mp4 URLs for video, quoted posts, and the pagination cursor.",
    input: {
      type: 'object',
      required: ['username'],
      properties: {
        username: { type: 'string', description: 'Handle, @handle, or profile URL.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
    },
    output: {
      type: 'object',
      properties: {
        tweets: { type: 'array', items: { type: 'object' } },
        cursor: { type: ['string', 'null'] },
      },
    },
  },
];

/**
 * Look up a resource by request path.
 * @param {string} pathname
 * @returns {PaidResource|undefined}
 */
export function findPaidResource(pathname) {
  return PAID_RESOURCES.find((resource) => resource.path === pathname);
}
