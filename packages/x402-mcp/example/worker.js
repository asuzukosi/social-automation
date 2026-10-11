// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * A complete paid MCP server, deployable as-is.
 *
 *   npx wrangler deploy example/worker.js --name paid-mcp --compatibility-date 2025-10-01
 *
 * Set SOLANA_ADDRESS (and optionally BASE_ADDRESS) on the Worker and agents can
 * pay for `roll` from anywhere. `ping` stays free, so a client can always check
 * the server is alive before deciding to spend anything.
 *
 * Try it without paying:
 *
 *   curl -s https://paid-mcp.<subdomain>.workers.dev \
 *     -H 'content-type: application/json' \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"roll","arguments":{"sides":20}}}'
 *
 * @author nichxbt
 */

import { createPaidMcpServer } from '@xactions/x402-mcp';

export default {
  fetch(request, env) {
    const server = createPaidMcpServer({
      name: 'dice',
      version: '1.0.0',
      instructions: 'Rolls dice. `ping` is free, `roll` costs a tenth of a cent.',
      payTo: {
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': env.SOLANA_ADDRESS || '',
        'eip155:8453': env.BASE_ADDRESS || '',
      },
      tools: [
        {
          name: 'ping',
          description: 'Check the server is alive. Free.',
          inputSchema: { type: 'object', properties: {} },
          handler: async () => ({ ok: true, at: new Date().toISOString() }),
        },
        {
          name: 'roll',
          description: 'Roll a fair die',
          price: '$0.001',
          inputSchema: {
            type: 'object',
            properties: { sides: { type: 'integer', minimum: 2, maximum: 1000, default: 6 } },
          },
          handler: async ({ sides = 6 }, { payment }) => ({
            roll: 1 + Math.floor(Math.random() * sides),
            sides,
            paidBy: payment?.payer ?? null,
          }),
        },
      ],
    });
    return server.handle(request);
  },
};
