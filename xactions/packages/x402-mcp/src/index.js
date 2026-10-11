// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * @xactions/x402-mcp
 *
 * Charge for MCP tools. An agent calls a tool, the server answers with terms
 * instead of a result, the agent pays from its own wallet and calls again. No
 * account, no API key, no plan: the payment is the authentication.
 *
 * Server and client are both dependency-free and run wherever `fetch` does.
 *
 * @module @xactions/x402-mcp
 * @author nichxbt
 */

export { createPaidMcpServer, PROTOCOL_VERSION, DEFAULT_FACILITATOR } from './server.js';
export { createToolPaymentGate, paymentRequiredResult } from './gate.js';
export { PaidMcpClient, SpendLimitError, McpCallError } from './client.js';
export {
  FacilitatorClient,
  buildAccepts,
  decodePayment,
  encodePayment,
  matchRequirements,
  sameNetwork,
  toAtomicAmount,
  toDollars,
  toV1Network,
  USDC_ADDRESSES,
  USDC_DECIMALS,
  V1_NETWORK_NAMES,
} from './x402.js';
