// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /.well-known/x402
 *
 * x402 discovery: how an agent finds the paid endpoints, what they cost, on
 * which chains, and what shape the request and response take, with no human in
 * the loop and no account anywhere.
 *
 * This lists only the resources this deployment actually serves. The full price
 * table in api/config/x402-config.js covers every operation XActions can run,
 * including the ones that need the self-hosted Node backend; advertising those
 * here would take an agent's money for an endpoint that then answers 503. The
 * live list lives in src/edge/paidResources.js.
 *
 * @author nichxbt
 */

import { loadApiModules } from '../../src/edge/apiModules.js';
import { PAID_RESOURCES } from '../../src/edge/paidResources.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request, env }) {
  const api = await loadApiModules(env);
  const origin = new URL(request.url).origin;

  const resources = PAID_RESOURCES.map((resource) => {
    const url = `${origin}${resource.path}`;
    return {
      resource: url,
      type: 'http',
      method: resource.method,
      description: resource.description,
      x402Version: 1,
      accepts: api
        .buildAccepts({ price: resource.price, resource: url, description: resource.description })
        .map((entry) => ({ ...entry, maxAmountRequired: entry.amount })),
      metadata: {
        operation: resource.operation,
        price: resource.price,
        input: resource.input,
        output: resource.output,
      },
    };
  }).filter((entry) => entry.accepts.length > 0);

  return jsonResponse(
    {
      x402Version: 1,
      name: 'XActions',
      description:
        'Public X (Twitter) data for agents. Pay per call in USDC on Solana or Base. No API key, no account, no rate-limit tier.',
      documentation: 'https://github.com/nirholas/XActions/blob/main/docs/x402.md',
      openapi: `${origin}/openapi.json`,
      resources,
    },
    200,
    corsHeaders(request),
  );
}

// A discovery crawler probes with HEAD before it does anything else. Pages
// routes an unclaimed method to functions/api/[[path]].js, whose 503 made every
// endpoint here look like it needed a backend that was not deployed.
export const onRequestHead = onRequestGet;
