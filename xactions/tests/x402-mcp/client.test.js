// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The auto-paying client against the real server.
 *
 * The client's `fetch` is wired straight into `server.handle`, so every test
 * exercises both halves of the SDK over the real JSON-RPC wire format. Only the
 * facilitator and the wallet are stubbed, because one is another company's
 * service and the other would move money.
 */

import { describe, it, expect } from 'vitest';
import { createPaidMcpServer } from '../../packages/x402-mcp/src/server.js';
import { PaidMcpClient, SpendLimitError, McpCallError } from '../../packages/x402-mcp/src/client.js';

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const RECEIVER = 'SoLReceiver11111111111111111111111111111111';

function facilitatorFetch({ verify = { isValid: true, payer: 'PayerAddr' }, settle } = {}) {
  return async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/supported')) {
      return new Response(JSON.stringify({ kinds: [{ scheme: 'exact', network: 'solana' }] }), { status: 200 });
    }
    if (path.endsWith('/verify')) return new Response(JSON.stringify(verify), { status: 200 });
    if (path.endsWith('/settle')) {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify(
          settle ?? {
            success: true,
            transaction: 'sig-' + body.paymentRequirements.amount,
            network: 'solana',
            payer: 'PayerAddr',
          },
        ),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  };
}

/** A wallet that signs anything. What it would sign is the point of the guards. */
function signer(networks = [SOLANA]) {
  const signed = [];
  return {
    networks,
    signed,
    async createPayment(requirements) {
      signed.push(requirements);
      return { x402Version: 1, scheme: 'exact', network: requirements.network, payload: { transaction: 'AQAA' } };
    },
  };
}

function harness({ price = '$0.001', payTo = { [SOLANA]: RECEIVER }, facilitator } = {}) {
  const server = createPaidMcpServer({
    name: 'harness',
    payTo,
    fetch: facilitator ?? facilitatorFetch(),
    tools: [
      { name: 'free', description: 'Free tool', inputSchema: { type: 'object' }, handler: async () => ({ ok: true }) },
      {
        name: 'paid',
        description: 'Paid tool',
        price,
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        handler: async (args) => ({ answer: args.q ?? 'default' }),
      },
    ],
  });
  return (options = {}) =>
    new PaidMcpClient('https://harness.test/mcp', {
      fetch: (url, init) => server.handle(new Request(url, init)),
      ...options,
    });
}

describe('PaidMcpClient', () => {
  it('handshakes and lists tools with their prices', async () => {
    const client = harness()({ signers: [signer()] });
    const info = await client.initialize();
    expect(info.serverInfo.name).toBe('harness');

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['free', 'paid']);
    expect(tools[1]._meta['x402/price'].display).toBe('$0.001000');
  });

  it('calls a free tool without a signer', async () => {
    const client = harness()({});
    const result = await client.call('free');
    expect(result.structuredContent).toEqual({ ok: true });
    expect(client.spent()).toBe('$0.000000');
  });

  it('pays for a paid tool and returns the result', async () => {
    const wallet = signer();
    const client = harness()({ signers: [wallet] });
    const result = await client.call('paid', { q: 'space' });

    expect(result.structuredContent).toEqual({ answer: 'space' });
    expect(result._meta['x402/payment-response'].transaction).toBe('sig-1000');
    expect(wallet.signed).toHaveLength(1);
    expect(wallet.signed[0].payTo).toBe(RECEIVER);
  });

  it('tracks what it spent and keeps the receipts', async () => {
    const client = harness()({ signers: [signer()] });
    await client.call('paid');
    await client.call('paid');
    expect(client.spent()).toBe('$0.002000');
    expect(client.receipts()).toHaveLength(2);
    expect(client.receipts()[0]).toMatchObject({ tool: 'paid', amount: '1000', success: true });
  });

  it('returns the terms without paying when asked not to', async () => {
    const wallet = signer();
    const client = harness()({ signers: [wallet] });
    const result = await client.call('paid', {}, { pay: false });
    expect(PaidMcpClient.paymentRequiredFrom(result).accepts[0].payTo).toBe(RECEIVER);
    expect(wallet.signed).toHaveLength(0);
    expect(client.spent()).toBe('$0.000000');
  });
});

describe('PaidMcpClient spending guards', () => {
  it('refuses a call priced above maxPerCall, before signing', async () => {
    const wallet = signer();
    const client = harness({ price: '$5.00' })({ signers: [wallet], maxPerCall: '$0.10' });
    await expect(client.call('paid')).rejects.toThrow(SpendLimitError);
    await expect(client.call('paid')).rejects.toThrow(/above the \$0.100000 per-call limit/);
    expect(wallet.signed).toHaveLength(0);
  });

  it('stops once the session budget is exhausted', async () => {
    const client = harness()({ signers: [signer()], budget: '$0.0015' });
    await client.call('paid');
    await expect(client.call('paid')).rejects.toThrow(SpendLimitError);
    expect(client.spent()).toBe('$0.001000');
  });

  it('refuses to pay an address that is not on the allowlist', async () => {
    const wallet = signer();
    const client = harness()({ signers: [wallet], allowPayTo: ['SomeOtherAddress'] });
    await expect(client.call('paid')).rejects.toThrow(/not in allowPayTo/);
    expect(wallet.signed).toHaveLength(0);
  });

  it('pays when the recipient is on the allowlist', async () => {
    const client = harness()({ signers: [signer()], allowPayTo: [RECEIVER] });
    const result = await client.call('paid');
    expect(result.structuredContent).toEqual({ answer: 'default' });
  });

  it('fails clearly when no signer covers any offered chain', async () => {
    const client = harness()({ signers: [signer(['eip155:8453'])] });
    await expect(client.call('paid')).rejects.toThrow(/no signer for any offered chain/);
  });

  it('surfaces a rejected payment instead of looping', async () => {
    const client = harness({ facilitator: facilitatorFetch({ verify: { isValid: false, invalidReason: 'nope' } }) })({
      signers: [signer()],
    });
    await expect(client.call('paid')).rejects.toThrow(McpCallError);
    expect(client.spent()).toBe('$0.000000');
  });

  it('does not count a failed settlement as money spent', async () => {
    const client = harness({ facilitator: facilitatorFetch({ settle: { success: false, errorReason: 'expired' } }) })({
      signers: [signer()],
    });
    await expect(client.call('paid')).rejects.toThrow(/expired/);
    expect(client.spent()).toBe('$0.000000');
    expect(client.receipts()).toHaveLength(0);
  });
});
