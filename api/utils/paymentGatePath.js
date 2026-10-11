// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The request path the x402 payment gates compare.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * The path as Express will route it, for deciding whether a request is paid.
 *
 * Express matches routes case-insensitively and ignores a trailing slash, so
 * a gate that compared the raw path let `/API/ai/...` or `/api/Scripts/run`
 * reach the paid handlers without paying. The gates compare a lower-cased path
 * with repeated and trailing slashes removed.
 *
 * @param {string} rawPath
 * @returns {string}
 */
export function paymentGatePath(rawPath) {
  const collapsed = String(rawPath || '/').toLowerCase().replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}
