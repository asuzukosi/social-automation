// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * An MCP client that pays for the tools it calls.
 *
 * Call a tool; if the server answers "payment required", sign the terms and
 * call again, transparently. The caller sees a result, not a payment flow.
 *
 * Signing is delegated, because it needs a wallet library and a chain and
 * neither belongs in a transport. Bring a signer per chain:
 *
 * ```js
 * const client = new PaidMcpClient('https://xactions.app/mcp', {
 *   signers: [solanaSigner],
 *   maxPerCall: '$0.01',
 *   budget: '$1.00',
 * });
 * const profile = await client.call('x_profile', { username: 'nasa' });
 * console.log(client.spent());   // '$0.001000'
 * ```
 *
 * Spending is bounded by construction. A hostile or compromised server can
 * name any amount and any recipient in its terms, so `maxPerCall` caps a single
 * call, `budget` caps the session, and `allowPayTo` pins who may be paid. All
 * three are checked before a signer is ever handed the terms.
 *
 * @module @xactions/x402-mcp/client
 * @author nichxbt
 */

import { encodePayment, sameNetwork, toAtomicAmount, toDollars } from './x402.js';

/**
 * @typedef {object} PaymentSigner
 * @property {string[]} networks - CAIP-2 ids (or v1 names) this signer can pay on.
 * @property {(requirements: object) => Promise<object>} createPayment - Returns the x402 payload.
 */

/** Raised when a payment would breach a spending guard. */
export class SpendLimitError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'SpendLimitError';
    Object.assign(this, detail);
  }
}

/** Raised when the server refuses a call for a reason payment cannot fix. */
export class McpCallError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'McpCallError';
    Object.assign(this, detail);
  }
}

export class PaidMcpClient {
  /**
   * @param {string} url - The server's MCP endpoint.
   * @param {object} [options]
   * @param {PaymentSigner[]} [options.signers]
   * @param {string|number} [options.maxPerCall] - Refuse a single call above this.
   * @param {string|number} [options.budget] - Refuse once the session total passes this.
   * @param {string[]} [options.allowPayTo] - Only pay these addresses.
   * @param {typeof fetch} [options.fetch]
   * @param {string} [options.clientName]
   * @param {string} [options.clientVersion]
   */
  constructor(url, {
    signers = [],
    maxPerCall,
    budget,
    allowPayTo,
    fetch: fetchImpl = fetch,
    clientName = 'x402-mcp-client',
    clientVersion = '1.0.0',
  } = {}) {
    this.url = url;
    this.signers = signers;
    this.maxPerCall = maxPerCall == null ? null : BigInt(toAtomicAmount(maxPerCall));
    this.budget = budget == null ? null : BigInt(toAtomicAmount(budget));
    this.allowPayTo = allowPayTo ? new Set(allowPayTo) : null;
    this._fetch = fetchImpl;
    this._clientName = clientName;
    this._clientVersion = clientVersion;
    this._id = 0;
    this._spent = 0n;
    this._receipts = [];
    this.serverInfo = null;
  }

  /** Total spent this session, as a dollar string. */
  spent() {
    return `$${toDollars(this._spent)}`;
  }

  /** Every settlement receipt this session, newest last. */
  receipts() {
    return [...this._receipts];
  }

  /** @private */
  async _rpc(method, params) {
    const id = ++this._id;
    const response = await this._fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (response.status === 202) return null;
    if (!response.ok) {
      throw new McpCallError(`MCP transport error: HTTP ${response.status}`, { status: response.status });
    }
    const body = await response.json();
    if (body?.error) {
      throw new McpCallError(body.error.message || 'MCP error', { code: body.error.code, data: body.error.data });
    }
    return body?.result ?? null;
  }

  /** Handshake. Optional: `call` works without it, but the server info is useful. */
  async initialize() {
    this.serverInfo = await this._rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: this._clientName, version: this._clientVersion },
    });
    return this.serverInfo;
  }

  /** @returns {Promise<object[]>} The tool list, price metadata included. */
  async listTools() {
    const result = await this._rpc('tools/list', {});
    return result?.tools ?? [];
  }

  /**
   * The PaymentRequired document a tool result carries, or null when the result
   * is not a payment challenge.
   * @param {object} result
   * @returns {object|null}
   */
  static paymentRequiredFrom(result) {
    if (!result?.isError) return null;
    const structured = result.structuredContent;
    if (structured?.accepts) return structured;
    const text = result.content?.find((part) => part.type === 'text')?.text;
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed?.accepts ? parsed : null;
    } catch {
      return null;
    }
  }

  /** @private Choose terms this client can and may pay. */
  _selectRequirements(paymentRequired) {
    for (const entry of paymentRequired.accepts || []) {
      const signer = this.signers.find((candidate) =>
        (candidate.networks || []).some((network) => sameNetwork(network, entry.network)),
      );
      if (!signer) continue;

      const amount = BigInt(entry.maxAmountRequired ?? entry.amount);
      if (this.maxPerCall !== null && amount > this.maxPerCall) {
        throw new SpendLimitError(
          `call costs $${toDollars(amount)}, above the $${toDollars(this.maxPerCall)} per-call limit`,
          { amount: amount.toString(), limit: this.maxPerCall.toString(), network: entry.network },
        );
      }
      if (this.budget !== null && this._spent + amount > this.budget) {
        throw new SpendLimitError(
          `call costs $${toDollars(amount)} and only $${toDollars(this.budget - this._spent)} of the session budget is left`,
          { amount: amount.toString(), remaining: (this.budget - this._spent).toString() },
        );
      }
      if (this.allowPayTo && !this.allowPayTo.has(entry.payTo)) {
        throw new SpendLimitError(`server asked to be paid at ${entry.payTo}, which is not in allowPayTo`, {
          payTo: entry.payTo,
        });
      }
      return { signer, requirements: entry, amount };
    }

    const offered = (paymentRequired.accepts || []).map((entry) => entry.network).join(', ');
    throw new McpCallError(
      `no signer for any offered chain (${offered || 'none offered'})`,
      { offered: paymentRequired.accepts },
    );
  }

  /**
   * Call a tool, paying if asked.
   *
   * @param {string} name
   * @param {object} [args]
   * @param {object} [options]
   * @param {boolean} [options.pay=true] - Set false to see the terms instead of paying.
   * @returns {Promise<object>} The MCP tool result, with `_meta['x402/payment-response']` on a paid call.
   */
  async call(name, args = {}, { pay = true } = {}) {
    const first = await this._rpc('tools/call', { name, arguments: args });
    const paymentRequired = PaidMcpClient.paymentRequiredFrom(first);
    if (!paymentRequired) {
      if (first?.isError) {
        const text = first.content?.find((part) => part.type === 'text')?.text;
        throw new McpCallError(text || `tool ${name} failed`, { result: first });
      }
      return first;
    }
    if (!pay) return first;

    const { signer, requirements, amount } = this._selectRequirements(paymentRequired);
    const payload = await signer.createPayment(requirements);

    const paid = await this._rpc('tools/call', {
      name,
      arguments: args,
      _meta: { 'x402/payment': payload },
    });

    const stillUnpaid = PaidMcpClient.paymentRequiredFrom(paid);
    if (stillUnpaid) {
      throw new McpCallError(stillUnpaid.error || 'payment was rejected', { paymentRequired: stillUnpaid });
    }
    if (paid?.isError) {
      const text = paid.content?.find((part) => part.type === 'text')?.text;
      throw new McpCallError(text || `tool ${name} failed after payment`, { result: paid });
    }

    const receipt = paid?._meta?.['x402/payment-response'];
    if (receipt) {
      this._spent += amount;
      this._receipts.push({ tool: name, amount: amount.toString(), ...receipt });
    }
    return paid;
  }

  /**
   * The payment header for a manual HTTP call, for servers that gate over
   * headers rather than MCP `_meta`.
   * @param {object} payload
   * @returns {string}
   */
  static paymentHeader(payload) {
    return encodePayment(payload);
  }
}
