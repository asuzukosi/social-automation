// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * GET /api/ai/health
 *
 * Whether the AI API is answering and whether x402 payment is configured for
 * this deployment, including the facilitator and the pay-to address an agent
 * would settle against.
 *
 * @author nichxbt
 */

import { loadApiModules } from '../../../src/edge/apiModules.js';
import { getSupported } from '../../../src/edge/facilitator.js';
import { DEFAULT_FACILITATOR } from '../../../src/edge/x402.js';
import { PAID_RESOURCES } from '../../../src/edge/paidResources.js';
import { corsHeaders, jsonResponse, preflightResponse } from '../../../src/video/edgeHttp.js';

export async function onRequestOptions({ request }) {
  return preflightResponse(request);
}

export async function onRequestGet({ request, env }) {
  const api = await loadApiModules(env);
  const facilitator = env.X402_FACILITATOR_URL || api.FACILITATOR_URL || DEFAULT_FACILITATOR;
  const supported = await getSupported(facilitator);

  // A chain we take payment on that the facilitator cannot settle is the one
  // failure that is invisible until a real caller loses a request to it, so it
  // is reported here rather than left to be discovered.
  const offered = [api.SOLANA_NETWORK, api.NETWORK].filter((network) => api.getPayTo(network));
  const settleable = supported.networks
    ? offered.filter(
        (network) => supported.networks.has(network) || supported.networks.has(api.toV1Network(network)),
      )
    : offered;

  return jsonResponse(
    {
      service: 'XActions AI API',
      status: 'operational',
      runtime: 'cloudflare-pages-functions',
      timestamp: new Date().toISOString(),
      x402: {
        enabled: api.isX402Configured(),
        versions: [1, 2],
        facilitator,
        facilitatorReachable: supported.networks !== null,
        networks: offered.map((network) => ({
          network,
          name: api.toV1Network(network),
          payTo: api.getPayTo(network),
          asset: api.SUPPORTED_NETWORKS[network]?.usdc ?? null,
          settleable: settleable.includes(network),
        })),
        unsettleable: offered.filter((network) => !settleable.includes(network)),
      },
      paidResources: PAID_RESOURCES.map((resource) => ({
        path: resource.path,
        price: resource.price,
        operation: resource.operation,
      })),
    },
    200,
    corsHeaders(request),
  );
}

// A discovery crawler probes with HEAD before it does anything else. Pages
// routes an unclaimed method to functions/api/[[path]].js, whose 503 made every
// endpoint here look like it needed a backend that was not deployed.
export const onRequestHead = onRequestGet;
