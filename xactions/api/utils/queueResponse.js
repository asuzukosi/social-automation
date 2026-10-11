// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The response a route sends when an operation could not be queued.
 *
 * Routes used to swallow this and answer "queued" anyway, which on a priced
 * route meant charging for an operation that would never run. x402 settles
 * only on a success status, so answering with the real failure also means the
 * caller is not charged.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * @param {import('express').Response} res
 * @param {Error & { status?: number, code?: string }} err
 */
export function queueFailure(res, err) {
  const status = err?.status || 503;
  const code = err?.code || 'QUEUE_UNAVAILABLE';
  if (status >= 500 && code === 'QUEUE_UNAVAILABLE') {
    console.error(`❌ Could not queue operation: ${err?.message}`);
  }
  return res.status(status).json({
    success: false,
    error: code,
    message:
      code === 'QUEUE_UNAVAILABLE'
        ? 'The job queue is unavailable, so the operation was not started. Try again shortly.'
        : err.message,
  });
}
