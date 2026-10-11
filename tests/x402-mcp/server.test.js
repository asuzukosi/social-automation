// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The paid MCP server, exercised over its real fetch handler.
 *
 * Every request goes through `server.handle(new Request(...))`, the same entry
 * a deployment uses. Only the facilitator is stubbed: it is another company's
 * HTTP service, and a test that reaches it would settle real money.
 */

import { describe, it, expect } from 'vitest';
import { createPaidMcpServer } from '../../packages/x402-mcp/src/server.js';
import { encodePayment } from '../../packages/x402-mcp/src/x402.js';

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const BASE = 'eip155:8453';
const PAY_TO = { [SOLANA]: 'SoLReceiver11111111111111111111111111111111', [BASE]: '0x1111111111111111111111111111111111111111' };

/** A facilitator that supports both chains and answers however the test says. */
function stubFacilitator({ verify = { isValid: true, payer: 'PayerAddr' }, settle = { success: true, transaction: 'sig123', network: 'solana', payer: 'PayerAddr' }, supported } = {}) {
  const calls = [];
  const kinds = supported ?? [
    { x402Version: 1, scheme: 'exact', network: 'solana', extra: { feePayer: 'FeePayer1111' } },
    { x402Version: 1, scheme: 'exact', network: 'base' },
  ];
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path.endsWith('/supported')) return new Response(JSON.stringify({ kinds }), { status: 200 });
    if (path.endsWith('/verify')) return new Response(JSON.stringify(verify), { status: 200 });
    if (path.endsWith('/settle')) return new Response(JSON.stringify(settle), { status: 200 });
    return new Response('not found', { status: 404 });
  };
  impl.calls = calls;
  return impl;
}

function build({ facilitatorFetch = stubFacilitator(), payTo = PAY_TO, onCall } = {}) {
  return createPaidMcpServer({
    name: 'test-server',
    version: '9.9.9',
    payTo,
    fetch: facilitatorFetch,
    tools: [
      {
        name: 'free_echo',
        description: 'Echo the input',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        handler: async (args) => ({ echoed: args.text }),
      },
      {
        name: 'paid_lookup',
        description: 'Look something up',
        price: '$0.001',
        inputSchema: { type: 'object', required: ['q'], properties: { q: { type: 'string' } } },
        handler: async (args, context) => {
          onCall?.(context);
          if (args.q === 'boom') throw new Error('handler exploded');
          return { answer: `about ${args.q}` };
        },
      },
    ],
  });
}

const rpc = (server, method, params, headers = {}) =>
  server.handle(
    new Request('https://example.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );

const PAYMENT = { x402Version: 1, scheme: 'exact', network: 'solana', payload: { transaction: 'AQAA' } };

describe('paid MCP server: protocol', () => {
  it('answers initialize with the protocol version and server info', async () => {
    const body = await (await rpc(build(), 'initialize', {})).json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.serverInfo).toEqual({ name: 'test-server', version: '9.9.9' });
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('answers ping', async () => {
    const body = await (await rpc(build(), 'ping', {})).json();
    expect(body.result).toEqual({});
  });

  it('returns 202 with no body for a notification', async () => {
    const response = await build().handle(
      new Request('https://example.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('answers a batch with one response per request', async () => {
    const response = await build().handle(
      new Request('https://example.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'ping' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ]),
      }),
    );
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it('reports method not found for an unknown method', async () => {
    const body = await (await rpc(build(), 'tools/nope', {})).json();
    expect(body.error.code).toBe(-32601);
  });

  it('rejects malformed JSON with a parse error', async () => {
    const response = await build().handle(
      new Request('https://example.test/mcp', { method: 'POST', body: 'not json' }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32700);
  });

  it('describes itself on GET without opening a stream', async () => {
    const response = await build().handle(new Request('https://example.test/mcp'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.transport).toBe('streamable-http');
    expect(body.payment.protocol).toBe('x402');
    expect(body.tools).toEqual([
      { name: 'free_echo', price: null },
      { name: 'paid_lookup', price: '$0.001000' },
    ]);
  });

  it('answers a CORS preflight', async () => {
    const response = await build().handle(new Request('https://example.test/mcp', { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('x-payment');
  });
});

describe('paid MCP server: tools/list', () => {
  it('publishes the price and networks of a paid tool', async () => {
    const body = await (await rpc(build(), 'tools/list', {})).json();
    const paid = body.result.tools.find((tool) => tool.name === 'paid_lookup');
    expect(paid.description).toContain('costs $0.001000');
    expect(paid._meta['x402/price']).toEqual({ amount: '1000', currency: 'USDC', display: '$0.001000' });
    expect(paid._meta['x402/networks']).toEqual([SOLANA, BASE]);
  });

  it('marks a free tool as free', async () => {
    const body = await (await rpc(build(), 'tools/list', {})).json();
    const free = body.result.tools.find((tool) => tool.name === 'free_echo');
    expect(free._meta['x402/price']).toBeNull();
    expect(free.description).not.toContain('costs');
  });
});

describe('paid MCP server: charging', () => {
  it('runs a free tool with no payment', async () => {
    const body = await (await rpc(build(), 'tools/call', { name: 'free_echo', arguments: { text: 'hi' } })).json();
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent).toEqual({ echoed: 'hi' });
  });

  it('answers a paid tool with terms instead of a result', async () => {
    const body = await (await rpc(build(), 'tools/call', { name: 'paid_lookup', arguments: { q: 'x' } })).json();
    expect(body.result.isError).toBe(true);
    const terms = body.result.structuredContent;
    expect(terms.x402Version).toBe(1);
    expect(terms.accepts).toHaveLength(2);
    expect(terms.accepts[0].amount).toBe('1000');
    expect(terms.accepts[0].payTo).toBe(PAY_TO[SOLANA]);
    // content mirrors structuredContent, for clients that read only text
    expect(JSON.parse(body.result.content[0].text)).toEqual(terms);
  });

  it("merges the facilitator's fee payer into the Solana terms", async () => {
    const body = await (await rpc(build(), 'tools/call', { name: 'paid_lookup', arguments: { q: 'x' } })).json();
    const solana = body.result.structuredContent.accepts.find((entry) => entry.network === SOLANA);
    expect(solana.extra.feePayer).toBe('FeePayer1111');
    const base = body.result.structuredContent.accepts.find((entry) => entry.network === BASE);
    expect(base.extra).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('drops a chain the facilitator cannot settle', async () => {
    const server = build({
      facilitatorFetch: stubFacilitator({ supported: [{ scheme: 'exact', network: 'base' }] }),
    });
    const body = await (await rpc(server, 'tools/call', { name: 'paid_lookup', arguments: { q: 'x' } })).json();
    expect(body.result.structuredContent.accepts.map((entry) => entry.network)).toEqual([BASE]);
  });

  it('serves a paid tool for free when nothing is configured to receive', async () => {
    const server = build({ payTo: {} });
    const body = await (await rpc(server, 'tools/call', { name: 'paid_lookup', arguments: { q: 'x' } })).json();
    expect(body.result.structuredContent).toEqual({ answer: 'about x' });
  });

  it('runs the tool and returns a receipt once payment verifies', async () => {
    const facilitator = stubFacilitator();
    const server = build({ facilitatorFetch: facilitator });
    const body = await (
      await rpc(server, 'tools/call', {
        name: 'paid_lookup',
        arguments: { q: 'space' },
        _meta: { 'x402/payment': PAYMENT },
      })
    ).json();
    expect(body.result.structuredContent).toEqual({ answer: 'about space' });
    expect(body.result._meta['x402/payment-response']).toMatchObject({ success: true, transaction: 'sig123' });
    expect(facilitator.calls.map((call) => call.path)).toEqual(['/supported', '/verify', '/settle']);
  });

  it('accepts the payment from an X-PAYMENT header as well as MCP _meta', async () => {
    const server = build();
    const body = await (
      await rpc(server, 'tools/call', { name: 'paid_lookup', arguments: { q: 'header' } }, {
        'x-payment': encodePayment(PAYMENT),
      })
    ).json();
    expect(body.result.structuredContent).toEqual({ answer: 'about header' });
  });

  it('refuses a payment on a chain it never offered', async () => {
    const facilitator = stubFacilitator();
    const server = build({ facilitatorFetch: facilitator });
    const body = await (
      await rpc(server, 'tools/call', {
        name: 'paid_lookup',
        arguments: { q: 'x' },
        _meta: { 'x402/payment': { ...PAYMENT, network: 'eip155:1' } },
      })
    ).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toMatch(/does not accept/i);
    expect(facilitator.calls.some((call) => call.path === '/verify')).toBe(false);
  });

  it('re-issues the terms when the facilitator rejects the payment', async () => {
    const server = build({
      facilitatorFetch: stubFacilitator({ verify: { isValid: false, invalidReason: 'insufficient_funds' } }),
    });
    const body = await (
      await rpc(server, 'tools/call', { name: 'paid_lookup', arguments: { q: 'x' }, _meta: { 'x402/payment': PAYMENT } })
    ).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error).toBe('insufficient_funds');
  });

  it('never settles when the handler fails, so a broken tool costs nothing', async () => {
    const facilitator = stubFacilitator();
    const server = build({ facilitatorFetch: facilitator });
    const body = await (
      await rpc(server, 'tools/call', {
        name: 'paid_lookup',
        arguments: { q: 'boom' },
        _meta: { 'x402/payment': PAYMENT },
      })
    ).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe('handler exploded');
    expect(facilitator.calls.some((call) => call.path === '/settle')).toBe(false);
  });

  it('reports a settlement failure rather than pretending the call was paid', async () => {
    const server = build({
      facilitatorFetch: stubFacilitator({ settle: { success: false, errorReason: 'blockhash_expired' } }),
    });
    const body = await (
      await rpc(server, 'tools/call', { name: 'paid_lookup', arguments: { q: 'x' }, _meta: { 'x402/payment': PAYMENT } })
    ).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('blockhash_expired');
  });

  it('tells the handler who paid', async () => {
    let seen = null;
    const server = build({ onCall: (context) => { seen = context.payment; } });
    await rpc(server, 'tools/call', {
      name: 'paid_lookup',
      arguments: { q: 'x' },
      _meta: { 'x402/payment': PAYMENT },
    });
    expect(seen.payer).toBe('PayerAddr');
    expect(seen.requirements.network).toBe(SOLANA);
  });

  it('rejects an unknown tool with invalid params', async () => {
    const body = await (await rpc(build(), 'tools/call', { name: 'nope' })).json();
    expect(body.error.code).toBe(-32602);
  });
});
