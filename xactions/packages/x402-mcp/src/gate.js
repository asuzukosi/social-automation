// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Make an MCP server you already have charge for its tools.
 *
 * `createPaidMcpServer` is for a server you are writing from scratch. This is
 * for the far more common case: you have a working MCP server, built with the
 * official SDK or by hand, and you want three of its tools to cost money.
 *
 * The gate is transport-shaped and framework-free. Hand it the JSON-RPC message
 * and the HTTP request; it tells you either "charge them" (with a ready-made
 * `tools/call` result carrying the terms) or "go ahead" (with the payer's
 * address). After your server produces a result, hand it back and the gate
 * settles the payment and attaches the receipt.
 *
 * ```js
 * const gate = createToolPaymentGate({
 *   payTo: { 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': process.env.SOLANA_ADDRESS },
 *   prices: { search: '$0.01', summarize: '$0.002' },
 * });
 *
 * const checked = await gate.check({ message, request });
 * if (checked.response) return checked.response;              // unpaid: terms
 * const response = await myServer.handle(message, checked.context);
 * return gate.finalize(response, checked);                    // paid: receipt
 * ```
 *
 * Settlement happens in `finalize`, after the work, so a tool that fails costs
 * the caller nothing and a receipt always corresponds to a delivered result.
 *
 * @module @xactions/x402-mcp/gate
 * @author nichxbt
 */

import { FacilitatorClient, buildAccepts, decodePayment, matchRequirements, toAtomicAmount, toDollars } from './x402.js';

/** Default facilitator: no key, settles Base and Solana mainnet. */
export const DEFAULT_FACILITATOR = 'https://facilitator.payai.network';

/**
 * A `tools/call` result that carries payment terms.
 *
 * The x402 MCP binding puts the PaymentRequired document in
 * `structuredContent` and the same JSON as text in `content`, so a client that
 * understands payment can act on it and one that does not still shows the user
 * something intelligible rather than an opaque error.
 *
 * @param {object} paymentRequired
 * @returns {object}
 */
export function paymentRequiredResult(paymentRequired) {
  return {
    isError: true,
    structuredContent: paymentRequired,
    content: [{ type: 'text', text: JSON.stringify(paymentRequired) }],
  };
}

/**
 * Build a payment gate for a set of priced tools.
 *
 * @param {object} options
 * @param {Record<string, string>} options.payTo - CAIP-2 network id to receiving address.
 * @param {Record<string, string|number>} options.prices - Tool name to price. Absent means free.
 * @param {string} [options.facilitator]
 * @param {Record<string, string>} [options.facilitatorHeaders]
 * @param {Record<string, string>} [options.assets] - Override the asset per network.
 * @param {(toolName: string) => string} [options.resourceId] - How a tool is named in the terms.
 * @param {typeof fetch} [options.fetch]
 * @param {Record<string, string>} [options.descriptions] - Tool name to human description.
 */
export function createToolPaymentGate({
  payTo = {},
  prices = {},
  facilitator = DEFAULT_FACILITATOR,
  facilitatorHeaders,
  assets = {},
  resourceId,
  fetch: fetchImpl,
  descriptions = {},
}) {
  const client = new FacilitatorClient(facilitator, {
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(facilitatorHeaders ? { headers: facilitatorHeaders } : {}),
  });
  const receiving = Object.values(payTo).some(Boolean);

  /** The price of a tool, or null when it is free or nothing is configured to receive. */
  function priceOf(toolName) {
    if (!receiving) return null;
    return prices[toolName] ?? null;
  }

  /** The terms for one tool, filtered to what the facilitator can settle. */
  async function termsFor(toolName, request) {
    const price = priceOf(toolName);
    if (!price) return null;
    const url = new URL(request.url);
    const resource = resourceId ? resourceId(toolName) : `${url.origin}${url.pathname}#${toolName}`;
    const description = descriptions[toolName] || `MCP tool ${toolName}`;
    const accepts = await client.filterAccepts(buildAccepts({ payTo, price, resource, description, assets }));
    if (!accepts.length) return null;
    return {
      x402Version: 1,
      error: `Payment required: ${toolName} costs $${toDollars(toAtomicAmount(price))}`,
      resource: { url: resource, method: 'POST', description, mimeType: 'application/json' },
      accepts,
    };
  }

  /**
   * Decide whether this message may proceed.
   *
   * @param {object} options
   * @param {object} options.message - The JSON-RPC message.
   * @param {Request} options.request - The HTTP request carrying it.
   * @returns {Promise<{ response?: object, paid: boolean, context: object, payment?: object, requirements?: object, attached?: object }>}
   *   `response` is a complete JSON-RPC response to return as-is when payment is owed.
   */
  async function check({ message, request }) {
    const free = { paid: false, context: { payment: null } };
    if (message?.method !== 'tools/call') return free;

    const toolName = message?.params?.name;
    const paymentRequired = await termsFor(toolName, request);
    if (!paymentRequired) return free;

    const attached =
      message?.params?._meta?.['x402/payment'] ?? decodePayment(request.headers.get('x-payment'));
    if (!attached) {
      return { ...free, response: rpcResult(message.id, paymentRequiredResult(paymentRequired)) };
    }

    const requirements = matchRequirements(paymentRequired.accepts, attached);
    if (!requirements) {
      return {
        ...free,
        response: rpcResult(
          message.id,
          paymentRequiredResult({
            ...paymentRequired,
            error: 'Payment names a network or scheme this tool does not accept',
          }),
        ),
      };
    }

    const verification = await client.verify(attached, requirements);
    if (!verification.isValid) {
      return {
        ...free,
        response: rpcResult(
          message.id,
          paymentRequiredResult({
            ...paymentRequired,
            error: verification.invalidReason || 'Payment could not be verified',
          }),
        ),
      };
    }

    const payment = { payer: verification.payer, requirements, tool: toolName };
    return { paid: true, payment, requirements, attached, context: { payment } };
  }

  /**
   * Settle and attach the receipt, once the server has produced a result.
   *
   * @param {object} response - The JSON-RPC response your server returned.
   * @param {object} checked - Whatever `check` returned.
   * @returns {Promise<object>} The response to send.
   */
  async function finalize(response, checked) {
    if (!checked?.paid) return response;
    const result = response?.result;
    // A failed tool is not billed: the caller did not get what they paid for.
    if (!result || result.isError) return response;

    const settlement = await client.settle(checked.attached, checked.requirements);
    if (!settlement.success) {
      return rpcResult(response.id, {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Settlement failed: ${settlement.errorReason || 'the facilitator could not settle this payment'}`,
          },
        ],
      });
    }
    return {
      ...response,
      result: { ...result, _meta: { ...(result._meta || {}), 'x402/payment-response': settlement } },
    };
  }

  /**
   * Price metadata to merge into a `tools/list` entry, so an agent can budget
   * before it calls rather than discovering the cost by being refused.
   *
   * @param {string} toolName
   * @returns {object}
   */
  function toolMeta(toolName) {
    const price = priceOf(toolName);
    if (!price) return { 'x402/price': null };
    return {
      'x402/price': {
        amount: toAtomicAmount(price),
        currency: 'USDC',
        display: `$${toDollars(toAtomicAmount(price))}`,
      },
      'x402/networks': Object.keys(payTo).filter((network) => payTo[network]),
    };
  }

  return { check, finalize, termsFor, priceOf, toolMeta, facilitator: client, receiving };
}

/** @private */
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
