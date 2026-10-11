// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * What the configured x402 facilitator can actually settle.
 *
 * A facilitator verifies a payment payload and broadcasts it. It does not
 * support every chain: the public reference facilitator at x402.org, for
 * instance, is testnet-only, so a server that advertises Base mainnet against it
 * publishes terms nobody can pay. That failure is invisible until a real caller
 * tries, and then it looks like the caller's fault.
 *
 * So the offered chains are intersected with the facilitator's own `/supported`
 * list before they are published. Both identifier spellings are accepted, since
 * facilitators report v1 names (`base`, `solana`) and CAIP-2 ids interchangeably.
 *
 * If `/supported` cannot be reached the configured chains are offered unchanged:
 * a transient outage at the facilitator should not quietly turn a paid API into
 * a free one.
 *
 * @module src/edge/facilitator
 * @author nichxbt
 */

/** Support lists change rarely; one fetch per isolate per hour is plenty. */
const TTL_MS = 60 * 60 * 1000;

/** @type {Map<string, { at: number, networks: Set<string>|null, kinds: object[] }>} */
const cache = new Map();

/**
 * Fetch a facilitator's supported payment kinds.
 *
 * @param {string} facilitatorUrl
 * @returns {Promise<{ networks: Set<string>|null, kinds: object[] }>} `networks`
 *   is null when the facilitator could not be reached.
 */
export async function getSupported(facilitatorUrl) {
  const base = String(facilitatorUrl || '').replace(/\/+$/, '');
  const cached = cache.get(base);
  if (cached && Date.now() - cached.at < TTL_MS) return cached;

  let entry = { at: Date.now(), networks: null, kinds: [] };
  try {
    const response = await fetch(`${base}/supported`, { headers: { accept: 'application/json' } });
    if (response.ok) {
      const body = await response.json();
      const kinds = Array.isArray(body?.kinds) ? body.kinds : [];
      entry = { at: Date.now(), networks: new Set(kinds.map((kind) => kind.network)), kinds };
    }
  } catch {
    // Unreachable: leave networks null so the caller offers its configured set.
  }
  // Only a successful probe is cached. Caching a failure would leave this
  // isolate publishing terms with no fee payer merged in for the whole TTL,
  // with no way to recover from one blip at the facilitator.
  if (entry.networks) cache.set(base, entry);
  return entry;
}

/**
 * Keep only the `accepts` entries this facilitator can settle.
 *
 * @param {object[]} accepts
 * @param {{ networks: Set<string>|null }} supported
 * @param {(network: string) => string} toV1Network
 * @returns {object[]}
 */
export function settleable(accepts, supported, toV1Network) {
  if (!supported?.networks) return accepts;
  const filtered = accepts
    .filter(
      (entry) => supported.networks.has(entry.network) || supported.networks.has(toV1Network(entry.network)),
    )
    .map((entry) => withFacilitatorExtra(entry, supported, toV1Network));
  // Every configured chain unsupported is an operator misconfiguration, not a
  // reason to serve for free. Publish the configured terms and let /api/ai/health
  // report the mismatch.
  return filtered.length ? filtered : accepts;
}

/**
 * Merge the facilitator's own `extra` for this chain into a requirements entry.
 *
 * Solana's exact scheme needs `extra.feePayer`: the account that pays the
 * network fee and co-signs the transfer, which is the facilitator's own key and
 * therefore only the facilitator can tell us. Without it a payer builds a
 * transaction the facilitator rejects with `missing_fee_payer`, and the caller
 * has no way to discover the right value.
 *
 * @param {object} entry
 * @param {{ kinds: object[] }} supported
 * @param {(network: string) => string} toV1Network
 * @returns {object}
 */
export function withFacilitatorExtra(entry, supported, toV1Network) {
  const kind = (supported.kinds || []).find(
    (candidate) =>
      candidate.scheme === entry.scheme &&
      (candidate.network === entry.network || toV1Network(candidate.network) === toV1Network(entry.network)) &&
      candidate.extra,
  );
  if (!kind) return entry;
  return { ...entry, extra: { ...(entry.extra || {}), ...kind.extra } };
}
