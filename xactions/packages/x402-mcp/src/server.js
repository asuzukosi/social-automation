// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * An MCP server whose tools cost money.
 *
 * MCP gave agents a way to call tools. It did not give anyone a way to charge
 * for them, so every hosted MCP server today is either free, or gated behind an
 * API key that an agent cannot sign up for on its own. x402 closes that: the
 * tool answers "payment required" with terms, the agent pays from its own
 * wallet, and calls again. No account, no key, no plan.
 *
 * This implements Streamable HTTP transport and the x402 MCP binding directly,
 * with no dependencies, so one `fetch` handler is the whole server and it runs
 * wherever `fetch` does.
 *
 * ```js
 * const server = createPaidMcpServer({
 *   name: 'my-api',
 *   payTo: { 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'YourSolanaAddress' },
 *   tools: [
 *     { name: 'echo', description: 'Free', inputSchema: {...}, handler: async (a) => a },
 *     { name: 'search', description: 'Paid', price: '$0.01', inputSchema: {...}, handler },
 *   ],
 * });
 *
 * export default { fetch: (request) => server.handle(request) };
 * ```
 *
 * @module @xactions/x402-mcp/server
 * @author nichxbt
 */

import {
  FacilitatorClient,
  buildAccepts,
  decodePayment,
  matchRequirements,
  toAtomicAmount,
  toDollars,
} from './x402.js';

/** The MCP revision this server implements. */
export const PROTOCOL_VERSION = '2025-06-18';

/** Default facilitator: no key, settles Base and Solana mainnet. */
export const DEFAULT_FACILITATOR = 'https://facilitator.payai.network';

/** JSON-RPC error codes used here. */
const JSONRPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
};

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === null ? {} : { 'content-type': 'application/json' }),
      'cache-control': 'no-store',
      ...headers,
    },
  });

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, ...(data ? { data } : {}) },
});

/**
 * @typedef {object} PaidTool
 * @property {string} name
 * @property {string} description
 * @property {object} inputSchema - JSON Schema for the arguments.
 * @property {object} [outputSchema]
 * @property {string|number} [price] - Omit for a free tool.
 * @property {(args: object, context: object) => Promise<unknown>} handler
 */

/**
 * Build a paid MCP server.
 *
 * @param {object} options
 * @param {string} options.name - Server name reported in `initialize`.
 * @param {string} [options.version]
 * @param {string} [options.instructions] - Shown to the model on connect.
 * @param {Record<string, string>} [options.payTo] - CAIP-2 network id to receiving address.
 * @param {string} [options.facilitator]
 * @param {Record<string, string>} [options.facilitatorHeaders]
 * @param {Record<string, string>} [options.assets] - Override the asset per network.
 * @param {PaidTool[]} options.tools
 * @param {typeof fetch} [options.fetch] - Injected for tests.
 * @param {(origin: string|null) => string} [options.corsOrigin]
 * @returns {{ handle: (request: Request) => Promise<Response>, tools: PaidTool[] }}
 */
export function createPaidMcpServer({
  name,
  version = '1.0.0',
  instructions,
  payTo = {},
  facilitator = DEFAULT_FACILITATOR,
  facilitatorHeaders,
  assets = {},
  tools = [],
  fetch: fetchImpl,
  corsOrigin = () => '*',
}) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const priced = tools.some((tool) => tool.price);
  const takesPayment = priced && Object.values(payTo).some(Boolean);
  const client = new FacilitatorClient(facilitator, {
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(facilitatorHeaders ? { headers: facilitatorHeaders } : {}),
  });

  /** Terms for one tool, filtered to what the facilitator can settle. */
  async function termsFor(tool, resourceBase) {
    const accepts = await client.filterAccepts(
      buildAccepts({
        payTo,
        price: tool.price,
        resource: `${resourceBase}#${tool.name}`,
        description: tool.description,
        assets,
      }),
    );
    return {
      x402Version: 1,
      error: `Payment required: ${tool.name} costs ${formatPrice(tool.price)}`,
      resource: {
        url: `${resourceBase}#${tool.name}`,
        method: 'POST',
        description: tool.description,
        mimeType: 'application/json',
      },
      accepts,
    };
  }

  /**
   * A tool result that says "pay first".
   *
   * The x402 MCP binding puts the PaymentRequired document in
   * `structuredContent` and the same JSON as text in `content`, so a client
   * that understands payment can act on it and one that does not still shows
   * the user something intelligible.
   */
  function paymentRequiredResult(paymentRequired) {
    return {
      isError: true,
      structuredContent: paymentRequired,
      content: [{ type: 'text', text: JSON.stringify(paymentRequired) }],
    };
  }

  function formatPrice(price) {
    try {
      return `$${toDollars(toAtomicAmount(price))}`;
    } catch {
      return String(price);
    }
  }

  /** `tools/list`, with the price attached so an agent can budget before calling. */
  function listTools() {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.price
          ? `${tool.description} (costs ${formatPrice(tool.price)} in USDC via x402)`
          : tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        _meta: tool.price
          ? {
              'x402/price': { amount: toAtomicAmount(tool.price), currency: 'USDC', display: formatPrice(tool.price) },
              'x402/networks': Object.keys(payTo).filter((network) => payTo[network]),
            }
          : { 'x402/price': null },
      })),
    };
  }

  /** Run one `tools/call`, charging for it when the tool has a price. */
  async function callTool(params, request) {
    const tool = byName.get(params?.name);
    if (!tool) return { error: [JSONRPC.invalidParams, `unknown tool: ${params?.name}`] };

    const args = params?.arguments ?? {};
    const context = { request, tool, payment: null };

    if (!tool.price || !takesPayment) {
      return { result: await runHandler(tool, args, context) };
    }

    const resourceBase = new URL(request.url).origin + new URL(request.url).pathname;
    const paymentRequired = await termsFor(tool, resourceBase);
    if (!paymentRequired.accepts.length) {
      // Nothing configured to receive: serve it rather than refuse, so a
      // self-host without x402 still has a working server.
      return { result: await runHandler(tool, args, context) };
    }

    const attached = params?._meta?.['x402/payment'] ?? decodePayment(request.headers.get('x-payment'));
    if (!attached) return { result: paymentRequiredResult(paymentRequired) };

    const requirements = matchRequirements(paymentRequired.accepts, attached);
    if (!requirements) {
      return {
        result: paymentRequiredResult({
          ...paymentRequired,
          error: 'Payment names a network or scheme this tool does not accept',
        }),
      };
    }

    const verification = await client.verify(attached, requirements);
    if (!verification.isValid) {
      return {
        result: paymentRequiredResult({
          ...paymentRequired,
          error: verification.invalidReason || 'Payment could not be verified',
        }),
      };
    }

    context.payment = { payer: verification.payer, requirements };
    const result = await runHandler(tool, args, context);

    // Settle only after the work succeeded, so a failed tool costs nothing and
    // a receipt always corresponds to a result the caller actually received.
    if (result.isError) return { result };

    const settlement = await client.settle(attached, requirements);
    if (!settlement.success) {
      return {
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Settlement failed: ${settlement.errorReason || 'the facilitator could not settle this payment'}`,
            },
          ],
        },
      };
    }

    return {
      result: {
        ...result,
        _meta: { ...(result._meta || {}), 'x402/payment-response': settlement },
      },
    };
  }

  /** Invoke a tool handler and shape whatever it returns as an MCP result. */
  async function runHandler(tool, args, context) {
    try {
      const value = await tool.handler(args, context);
      if (value && typeof value === 'object' && Array.isArray(value.content)) return value;
      return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
        ...(value && typeof value === 'object' && !Array.isArray(value) ? { structuredContent: value } : {}),
      };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error?.message || String(error) }] };
    }
  }

  /** Dispatch one JSON-RPC message. Returns null for notifications. */
  async function dispatch(message, request) {
    const { id, method, params } = message ?? {};
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
          ...(instructions ? { instructions } : {}),
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, listTools());
      case 'tools/call': {
        const { result, error } = await callTool(params, request);
        if (error) return rpcError(id, error[0], error[1]);
        return rpcResult(id, result);
      }
      default:
        if (isNotification) return null;
        return rpcError(id, JSONRPC.methodNotFound, `method not found: ${method}`);
    }
  }

  /**
   * The whole server: one fetch handler.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async function handle(request) {
    const cors = {
      'access-control-allow-origin': corsOrigin(request.headers.get('origin')),
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-payment, mcp-session-id, mcp-protocol-version',
      'access-control-expose-headers': 'mcp-session-id, x-payment-response',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Streamable HTTP allows a GET that opens a server-initiated event stream.
    // This server is stateless and never initiates, so it declines rather than
    // holding a socket open forever.
    if (request.method === 'GET' || request.method === 'HEAD') {
      return jsonResponse(
        {
          name,
          version,
          protocolVersion: PROTOCOL_VERSION,
          transport: 'streamable-http',
          tools: tools.map((tool) => ({ name: tool.name, price: tool.price ? formatPrice(tool.price) : null })),
          payment: takesPayment ? { protocol: 'x402', networks: Object.keys(payTo).filter((n) => payTo[n]) } : null,
        },
        200,
        cors,
      );
    }

    if (request.method === 'DELETE') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') {
      return jsonResponse(rpcError(null, JSONRPC.invalidRequest, 'method not allowed'), 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(rpcError(null, JSONRPC.parseError, 'invalid JSON'), 400, cors);
    }

    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    const responses = [];
    for (const message of messages) {
      try {
        const response = await dispatch(message, request);
        if (response) responses.push(response);
      } catch (error) {
        responses.push(rpcError(message?.id ?? null, JSONRPC.internalError, error?.message || 'internal error'));
      }
    }

    // Every message was a notification: the spec says answer 202 with no body.
    if (!responses.length) return new Response(null, { status: 202, headers: cors });
    return jsonResponse(batch ? responses : responses[0], 200, cors);
  }

  return { handle, tools, listTools, termsFor };
}
