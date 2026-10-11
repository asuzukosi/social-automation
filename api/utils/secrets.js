// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Secret resolution for the XActions API.
 *
 * Signing keys used to have inline fallbacks (`process.env.JWT_SECRET || 'dev-secret'`,
 * `|| 'xactions'`). A deployment that forgot to set JWT_SECRET therefore kept serving,
 * signing OAuth state and session tokens with a constant published in this repository,
 * so anyone could mint a token for any user. A missing signing key is a configuration
 * failure, not a value to guess.
 *
 * `requireJwtSecret()` returns the configured secret or throws. Under NODE_ENV=test it
 * returns a fixed, obviously-fake value so the suite runs without a real secret; that
 * branch is unreachable in development and production, where the process is expected to
 * be configured before it can sign anything.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

/** Value used only under NODE_ENV=test, where nothing it signs leaves the process. */
export const TEST_JWT_SECRET = 'test-only-not-a-real-secret';

/**
 * The JWT signing secret.
 *
 * @returns {string} the configured `JWT_SECRET`
 * @throws {Error} when it is not configured outside the test environment
 */
export function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'test') return TEST_JWT_SECRET;
  throw new Error(
    'JWT_SECRET is not set. Generate one with `openssl rand -hex 32` and set it on the ' +
      'service before starting the API. Tokens are never signed with a default.'
  );
}

/**
 * Whether a signing secret is available, for callers that want to degrade a feature
 * rather than fail a request.
 *
 * @returns {boolean}
 */
export function hasJwtSecret() {
  return Boolean(process.env.JWT_SECRET) || process.env.NODE_ENV === 'test';
}
