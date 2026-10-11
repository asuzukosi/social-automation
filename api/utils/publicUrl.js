// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Outbound URL safety: refuse URLs the server should not call on a caller's
 * behalf (callback URLs, webhooks, media and feed downloads).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** A URL the server will not call. Retrying cannot fix it. */
export class PublicUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublicUrlError';
    this.code = 'INVALID_URL';
    this.status = 400;
    this.retryable = false;
  }
}

const PRIVATE_RANGES = (() => {
  const list = new BlockList();
  const v4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]];
  const v6 = [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]];
  for (const [net, prefix] of v4) list.addSubnet(net, prefix, 'ipv4');
  for (const [net, prefix] of v6) list.addSubnet(net, prefix, 'ipv6');
  return list;
})();

/** Loopback, private, link-local, carrier-grade NAT, multicast or reserved. */
export function isPrivateAddress(address) {
  const family = isIP(address);
  if (!family) return true;
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return PRIVATE_RANGES.check(mapped[1], 'ipv4');
  return PRIVATE_RANGES.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Refuse anything that is not http(s), or whose host resolves to a private or
 * local address. A self-hosted server that delivers to its own network sets
 * XACTIONS_WEBHOOK_ALLOW_PRIVATE=true.
 *
 * @param {string} raw
 * @param {string} [label='URL'] - the field name, for the error
 * @param {typeof dnsLookup} [lookup]
 * @returns {Promise<URL>}
 */
export async function assertPublicUrl(raw, label = 'URL', lookup = dnsLookup) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new PublicUrlError(`${label} is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PublicUrlError(`${label} must be an http or https URL`);
  if (process.env.XACTIONS_WEBHOOK_ALLOW_PRIVATE === 'true') return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch (err) {
      throw new PublicUrlError(`${label} host "${host}" does not resolve (${err.code || err.message})`);
    }
  }
  const blocked = addresses.find(isPrivateAddress);
  if (blocked || addresses.length === 0) {
    throw new PublicUrlError(
      `${label} resolves to a private or local address (${blocked || 'none'}). Deliveries only go to hosts on the public internet; ` +
        'a self-hosted server can allow internal hosts with XACTIONS_WEBHOOK_ALLOW_PRIVATE=true.',
    );
  }
  return url;
}
