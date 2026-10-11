// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * x402 payment primitives, with no runtime dependencies.
 *
 * Everything here is plain `fetch`, `btoa`/`atob` and JSON, so the same file
 * runs on Cloudflare Workers, Deno, Bun, Node 18+ and in a browser. Nothing
 * signs: signing needs a wallet library and a chain, and which one is the
 * caller's business. The server side only ever builds a challenge, asks a
 * facilitator to verify a payload, and asks it to settle.
 *
 * @module @xactions/x402-mcp/x402
 * @author nichxbt
 */

/** USDC has six decimals on every chain x402 settles on today. */
export const USDC_DECIMALS = 6;

/**
 * x402 v1 network names keyed by CAIP-2 id.
 *
 * v1 identifies a chain by a short name; CAIP-2 arrived with v2. Both spellings
 * are in the wild, indexers and clients disagree about which they send, and a
 * server that understands only one of them rejects half its callers.
 */
export const V1_NETWORK_NAMES = {
  'eip155:1': 'ethereum',
  'eip155:10': 'optimism',
  'eip155:137': 'polygon',
  'eip155:8453': 'base',
  'eip155:84532': 'base-sepolia',
  'eip155:42161': 'arbitrum',
  'eip155:421614': 'arbitrum-sepolia',
  'eip155:43114': 'avalanche',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'solana',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'solana-devnet',
};

/** USDC on each chain, so a caller configuring `payTo` gets the asset for free. */
export const USDC_ADDRESSES = {
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'eip155:10': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  'eip155:137': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  'eip155:43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

/**
 * The v1 spelling of a network id, or the id itself when there is no v1 name.
 * @param {string} network
 * @returns {string}
 */
export function toV1Network(network) {
  return V1_NETWORK_NAMES[network] || network;
}

/**
 * Whether two identifiers name the same chain, in either spelling.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameNetwork(a, b) {
  if (!a || !b) return false;
  return a === b || toV1Network(a) === toV1Network(b);
}

/**
 * Parse a price into the token's smallest unit.
 *
 * Accepts `'$0.001'`, `'0.001'`, `0.001` and `{ amount: '1000' }` so a caller
 * can write whichever reads best without thinking about decimals.
 *
 * @param {string|number|{amount: string}} price
 * @returns {string} Integer amount as a string.
 */
export function toAtomicAmount(price) {
  if (price && typeof price === 'object' && price.amount) return String(price.amount);
  const dollars = Number.parseFloat(String(price).replace('$', '').trim());
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error(`invalid price: ${JSON.stringify(price)}`);
  }
  return String(Math.round(dollars * 10 ** USDC_DECIMALS));
}

/**
 * Render an atomic amount back as dollars, for humans and for logs.
 * @param {string|number|bigint} amount
 * @returns {string}
 */
export function toDollars(amount) {
  return (Number(amount) / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS);
}

/**
 * base64 of a JSON value, without Buffer.
 * @param {unknown} value
 * @returns {string}
 */
export function encodePayment(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Decode a base64 JSON payment header. Returns null on anything malformed,
 * because the value came from an untrusted caller.
 * @param {string|null|undefined} header
 * @returns {object|null}
 */
export function decodePayment(header) {
  if (!header || typeof header !== 'string') return null;
  try {
    const binary = atob(header.trim());
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Build the `accepts` array for a priced resource: one entry per chain the
 * operator will take money on.
 *
 * @param {object} options
 * @param {Record<string, string>} options.payTo - CAIP-2 network id to receiving address.
 * @param {string|number} options.price
 * @param {string} options.resource - Absolute identifier of what is being sold.
 * @param {string} [options.description]
 * @param {Record<string, string>} [options.assets] - Override the asset per network.
 * @param {number} [options.maxTimeoutSeconds]
 * @returns {object[]}
 */
export function buildAccepts({
  payTo,
  price,
  resource,
  description = '',
  assets = {},
  maxTimeoutSeconds = 300,
}) {
  const amount = toAtomicAmount(price);
  return Object.entries(payTo || {})
    .filter(([, address]) => Boolean(address))
    .map(([network, address]) => {
      const asset = assets[network] || USDC_ADDRESSES[network];
      if (!asset) throw new Error(`no asset known for ${network}; pass one in \`assets\``);
      const entry = {
        scheme: 'exact',
        network,
        amount,
        maxAmountRequired: amount,
        asset,
        payTo: address,
        resource,
        description,
        mimeType: 'application/json',
        maxTimeoutSeconds,
      };
      // The EIP-712 domain a wallet signs USDC's transferWithAuthorization
      // against. Solana has no such domain; what it needs is the facilitator's
      // fee payer, which only the facilitator can supply, so it is merged in
      // from /supported rather than guessed at here.
      if (!network.startsWith('solana:')) entry.extra = { name: 'USD Coin', version: '2' };
      return entry;
    });
}

/**
 * A facilitator's supported payment kinds, cached per instance.
 *
 * A facilitator does not settle every chain: the reference one at x402.org is
 * testnet-only. Publishing terms it cannot settle is invisible until a real
 * caller tries and fails, so the offered chains are intersected with this list.
 */
export class FacilitatorClient {
  /**
   * @param {string} url - Facilitator base URL.
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] - Injected for tests.
   * @param {number} [options.ttlMs] - How long to cache /supported.
   * @param {Record<string, string>} [options.headers] - Extra headers, e.g. auth.
   */
  constructor(url, { fetch: fetchImpl, ttlMs = 60 * 60 * 1000, headers = {} } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    // Bound, not stored bare. `this._fetch(...)` on a stored global `fetch`
    // invokes it with the client as its receiver, which workerd rejects with
    // "Illegal invocation" and which a try/catch around a network call then
    // swallows as "facilitator unreachable".
    this._fetch = fetchImpl ? (...args) => fetchImpl(...args) : (...args) => fetch(...args);
    this._ttlMs = ttlMs;
    this._headers = headers;
    this._supported = null;
    this._supportedAt = 0;
  }

  /**
   * @returns {Promise<{ networks: Set<string>|null, kinds: object[] }>} `networks`
   *   is null when the facilitator could not be reached.
   */
  async supported() {
    if (this._supported && Date.now() - this._supportedAt < this._ttlMs) return this._supported;
    let result = { networks: null, kinds: [] };
    try {
      const response = await this._fetch(`${this.url}/supported`, {
        headers: { accept: 'application/json', ...this._headers },
      });
      if (response.ok) {
        const body = await response.json();
        const kinds = Array.isArray(body?.kinds) ? body.kinds : [];
        result = { networks: new Set(kinds.map((kind) => kind.network)), kinds };
      }
    } catch {
      // Unreachable: leave networks null so the caller offers its configured set.
    }
    // A failed probe is not cached. Caching it would mean one blip at the
    // facilitator left this isolate publishing terms with no fee payer merged
    // in, and no way to recover, for the rest of the TTL.
    if (result.networks) {
      this._supported = result;
      this._supportedAt = Date.now();
    }
    return result;
  }

  /**
   * Drop chains this facilitator cannot settle, and merge in whatever `extra`
   * it needs for the ones it can (Solana's fee payer, for instance).
   *
   * An empty intersection is an operator misconfiguration, not a reason to
   * serve for free, so the configured terms are returned unchanged in that case
   * and the mismatch is left for a health check to report.
   *
   * @param {object[]} accepts
   * @returns {Promise<object[]>}
   */
  async filterAccepts(accepts) {
    const { networks, kinds } = await this.supported();
    if (!networks) return accepts;
    const kept = accepts
      .filter((entry) => networks.has(entry.network) || networks.has(toV1Network(entry.network)))
      .map((entry) => {
        const kind = kinds.find(
          (candidate) =>
            candidate.scheme === entry.scheme && sameNetwork(candidate.network, entry.network) && candidate.extra,
        );
        return kind ? { ...entry, extra: { ...(entry.extra || {}), ...kind.extra } } : entry;
      });
    return kept.length ? kept : accepts;
  }

  /**
   * @param {object} paymentPayload
   * @param {object} paymentRequirements
   * @returns {Promise<{ isValid: boolean, payer?: string, invalidReason?: string }>}
   */
  async verify(paymentPayload, paymentRequirements) {
    return this._post('verify', paymentPayload, paymentRequirements, (status, detail) => ({
      isValid: false,
      invalidReason: `facilitator /verify HTTP ${status}${detail ? `: ${detail}` : ''}`,
    }));
  }

  /**
   * @param {object} paymentPayload
   * @param {object} paymentRequirements
   * @returns {Promise<{ success: boolean, transaction?: string, network?: string, payer?: string, errorReason?: string }>}
   */
  async settle(paymentPayload, paymentRequirements) {
    return this._post('settle', paymentPayload, paymentRequirements, (status, detail) => ({
      success: false,
      errorReason: `facilitator /settle HTTP ${status}${detail ? `: ${detail}` : ''}`,
    }));
  }

  /** @private */
  async _post(route, paymentPayload, paymentRequirements, onError) {
    const response = await this._fetch(`${this.url}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this._headers },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    });
    if (!response.ok) {
      // Pass the facilitator's own words through: "HTTP 400" tells a caller
      // nothing they can act on, "missing_fee_payer" tells them everything.
      const detail = await response.text().catch(() => '');
      return onError(response.status, detail.slice(0, 300));
    }
    return response.json();
  }
}

/**
 * Match the terms a payer chose against the ones that were published, so a
 * payment on a chain that was never offered cannot satisfy a call.
 *
 * @param {object[]} accepts
 * @param {object} paymentPayload
 * @returns {object|null}
 */
export function matchRequirements(accepts, paymentPayload) {
  const chosen = paymentPayload?.accepted || paymentPayload;
  const scheme = chosen?.scheme || 'exact';
  return accepts.find((entry) => entry.scheme === scheme && sameNetwork(entry.network, chosen?.network)) || null;
}
