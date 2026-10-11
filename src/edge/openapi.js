// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The OpenAPI description of what xactions.app actually serves.
 *
 * `api/openapi.js` describes every operation the XActions Node server can run,
 * which is the right document for a self-host. It is the wrong document for
 * this deployment: discovery crawlers read /openapi.json to decide what to
 * probe and what to advertise, and 300-odd operations that need Postgres and
 * Puppeteer would be catalogued as available and then answer 503.
 *
 * So the deployed spec is generated from what is really here: the free edge
 * endpoints, plus the paid ones in src/edge/paidResources.js with their x402
 * terms attached per operation.
 *
 * @module src/edge/openapi
 * @author nichxbt
 */

import { PAID_RESOURCES } from './paidResources.js';

/** JSON response helper for a documented endpoint. */
function jsonBody(description, schema) {
  return { description, content: { 'application/json': { schema } } };
}

/** The 402 response every paid operation can answer with. */
function paymentRequiredResponse(accepts) {
  return {
    description:
      'Payment required. The body holds the x402 terms; the same document is base64 in the PAYMENT-REQUIRED header. Pay and retry with X-PAYMENT (or PAYMENT-SIGNATURE).',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            x402Version: { type: 'integer' },
            error: { type: 'string' },
            accepts: { type: 'array', items: { type: 'object' } },
          },
        },
        example: { x402Version: 1, error: 'Payment required', accepts },
      },
    },
  };
}

/**
 * Free operations still have to say so. A discovery crawler that finds no auth
 * declaration cannot tell "open" from "undocumented", and lists the route with
 * a warning either way. An empty `security` array is the OpenAPI way of saying
 * this endpoint needs nothing.
 */
const NO_AUTH = [];

const FREE_PATHS = {
  '/api/health': {
    get: {
      security: NO_AUTH,
      summary: 'Edge API health',
      description: 'Which endpoints answer at the edge, and whether a Node backend origin is configured.',
      responses: { 200: jsonBody('Health', { type: 'object' }) },
    },
  },
  '/api/ask': {
    post: {
      security: NO_AUTH,
      summary: 'Ask XActions',
      description:
        'Answers a question about XActions from the documentation and the repository, streamed as Server-Sent Events: a sources event, then token events, then done. Free, no key.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['question'],
              properties: {
                question: { type: 'string' },
                history: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
      responses: { 200: { description: 'text/event-stream of sources, token and done events' } },
    },
  },
  '/api/ask/health': {
    get: {
      security: NO_AUTH,
      summary: 'Ask index and lane health',
      responses: { 200: jsonBody('Index size, digest and the LLM lane chain', { type: 'object' }) },
    },
  },
  '/api/video/extract': {
    post: {
      security: NO_AUTH,
      summary: 'Extract video from a post',
      description:
        'Every mp4 variant for a post that has video, best quality first, with thumbnail, duration, author and text. Free, no key.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['url'],
              properties: { url: { type: 'string', format: 'uri' } },
            },
          },
        },
      },
      responses: {
        200: jsonBody('Video variants', { type: 'object' }),
        404: jsonBody('No such post, or it holds no video', { type: 'object' }),
      },
    },
  },
  '/api/video/download': {
    get: {
      security: NO_AUTH,
      summary: 'Proxy a video download',
      description:
        'Streams an mp4 back through xactions.app with Content-Disposition: attachment. Only video.twimg.com and pbs.twimg.com are proxyable.',
      parameters: [
        { name: 'url', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
        { name: 'author', in: 'query', schema: { type: 'string' } },
        { name: 'tweetId', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: { description: 'video/mp4' } },
    },
  },
  '/api/ai/health': {
    get: {
      security: NO_AUTH,
      summary: 'AI API status and x402 configuration',
      responses: { 200: jsonBody('Status', { type: 'object' }) },
    },
  },
  '/api/ai/pricing': {
    get: {
      security: NO_AUTH,
      summary: 'Per-operation prices',
      responses: { 200: jsonBody('Price table', { type: 'object' }) },
    },
  },
  '/.well-known/x402': {
    get: {
      security: NO_AUTH,
      summary: 'x402 discovery',
      description: 'The paid resources this deployment serves, with payment terms and I/O schemas.',
      responses: { 200: jsonBody('Discovery document', { type: 'object' }) },
    },
  },
};

/**
 * Build the OpenAPI 3.1 document for this deployment.
 *
 * @param {object} options
 * @param {string} options.origin - Absolute origin, e.g. 'https://xactions.app'.
 * @param {(input: { price: string, resource: string, description: string }) => object[]} options.buildAccepts
 * @returns {object}
 */
export function generateEdgeSpec({ origin, buildAccepts }) {
  const paths = { ...FREE_PATHS };

  for (const resource of PAID_RESOURCES) {
    const url = `${origin}${resource.path}`;
    const accepts = buildAccepts({
      price: resource.price,
      resource: url,
      description: resource.description,
    });
    const parameters = Object.entries(resource.input.properties || {}).map(([name, schema]) => ({
      name,
      in: 'query',
      required: (resource.input.required || []).includes(name),
      schema,
    }));

    // Decimal USD here; the runtime 402 carries token atomic units. Both are
    // derived from resource.price so they cannot drift apart.
    const amountUsd = Number.parseFloat(resource.price.replace('$', '')).toFixed(6);
    const summary = resource.description.split('.')[0];
    const operationId = resource.operation.replace(/[:\-](\w)/g, (_, char) => char.toUpperCase());

    const shared = {
      tags: ['paid'],
      description: `${resource.description}\n\nPaid: ${resource.price} in USDC over x402, on Solana or Base. No API key and no account; the payment is the authentication.`,
      // Deliberately empty, not `[{ x402: [] }]`. Declaring the payment header as
      // an apiKey scheme makes discovery label the route "apiKey+paid", which
      // reads as "get a key, then pay" and is exactly what x402 removes. There
      // is no credential: x-payment-info below is what marks it paid.
      security: NO_AUTH,
      'x-payment-info': {
        price: { mode: 'fixed', currency: 'USD', amount: amountUsd },
        protocols: [{ x402: {} }],
      },
      responses: {
        200: jsonBody('Result', resource.output),
        400: jsonBody('Invalid input', { type: 'object' }),
        402: paymentRequiredResponse(accepts),
        404: jsonBody('No such account', { type: 'object' }),
      },
      'x-x402': { price: resource.price, operation: resource.operation, accepts },
    };

    paths[resource.path] = {
      get: { operationId: `${operationId}Get`, summary, parameters, ...shared },
      post: {
        operationId,
        summary,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: resource.input } },
        },
        ...shared,
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'XActions API',
      version: '1.0.0',
      description:
        'Public X (Twitter) data for agents. The paid endpoints settle in USDC over x402 on Solana or Base: no API key, no account, no rate-limit tier. The free endpoints need nothing at all.',
      'x-guidance': [
        'XActions reads public X (Twitter) data. Nothing here needs an API key, an account, or an OAuth flow.',
        '',
        'Paid endpoints, priced per call in USDC over x402:',
        '  GET or POST /api/ai/scrape/profile  ($0.001) - one account\'s public profile. Send { "username": "nasa" }; a handle, @handle or profile URL all work.',
        '  GET or POST /api/ai/scrape/tweets   ($0.005) - that account\'s recent posts with engagement counts, media and a pagination cursor. Send { "username": "nasa", "limit": 20 }.',
        '',
        'Call one without payment and it answers 402 with the terms: the JSON body carries x402Version and accepts, and the same document is base64 in the PAYMENT-REQUIRED header. Two chains are offered, Solana mainnet first and Base second, both in USDC. Sign the transfer with your own wallet and retry the identical request with the payload in X-PAYMENT (or PAYMENT-SIGNATURE). The settlement receipt comes back in X-PAYMENT-RESPONSE. Your paying address is the only identity involved; there is nothing to register and nothing to store.',
        '',
        'Free endpoints, no payment and no key: POST /api/video/extract returns every mp4 variant for a post that has video, POST /api/ask answers questions about XActions from its documentation, and GET /api/health reports what this deployment serves.',
      ].join('\n'),
      contact: { name: 'XActions', url: 'https://github.com/nirholas/XActions/issues' },
      license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'paid', description: 'Priced in USDC over x402' },
      { name: 'free', description: 'No payment required' },
    ],
    paths,
  };
}
