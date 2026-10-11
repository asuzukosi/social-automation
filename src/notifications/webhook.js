// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Signed outbound webhooks.
 *
 * The generic `webhook` notification channel POSTs a JSON body to any URL.
 * Because that URL is often a small server the user wrote themselves, the
 * delivery carries everything a receiver needs to trust and de-duplicate it:
 *
 *   X-XActions-Signature: sha256=<hex HMAC-SHA256 of the raw body>
 *   X-XActions-Timestamp: <unix seconds when the request was signed>
 *   X-XActions-Event:     <event type, e.g. "follower_alert">
 *   X-XActions-Delivery:  <uuid, stable across the retries of one delivery>
 *
 * The secret is XACTIONS_WEBHOOK_SECRET (or `secret` on the channel config).
 * Without one the delivery still goes out with the timestamp, event, and
 * delivery id headers, just unsigned.
 *
 * A delivery is attempted up to three times with exponential backoff and
 * jitter (a 5xx, a 429, or a network error retries; any other 4xx is final).
 * Every attempt is recorded in `$XACTIONS_HOME/webhook-deliveries.json`
 * (the last 500 deliveries) so a failed one can be inspected and replayed
 * with replayDelivery(id).
 *
 * Receivers verify with verifyWebhookSignature(rawBody, headers, secret),
 * exported from the package root. The comparison is constant-time.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DELIVERIES_FILENAME = 'webhook-deliveries.json';
export const MAX_DELIVERIES = 500;
export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_TIMEOUT_MS = 10_000;
/** Receivers reject a signed timestamp older than this by default. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export const HEADER_SIGNATURE = 'x-xactions-signature';
export const HEADER_TIMESTAMP = 'x-xactions-timestamp';
export const HEADER_EVENT = 'x-xactions-event';
export const HEADER_DELIVERY = 'x-xactions-delivery';

/**
 * @typedef {object} DeliveryAttempt
 * @property {string} at ISO timestamp
 * @property {number | null} status HTTP status, or null on a network error
 * @property {string} [error]
 * @property {number} durationMs
 */

/**
 * @typedef {object} DeliveryRecord
 * @property {string} id
 * @property {string} url
 * @property {string} event
 * @property {string} body raw JSON body exactly as signed and sent
 * @property {string} createdAt
 * @property {'delivered' | 'failed'} status
 * @property {boolean} signed
 * @property {DeliveryAttempt[]} attempts
 * @property {string} [replayOf] id of the delivery this one re-sent
 * @property {string} [completedAt]
 */

/** Directory that holds XActions state. Honours XACTIONS_HOME. */
export function getXactionsHome() {
  return process.env.XACTIONS_HOME || join(homedir(), '.xactions');
}

/** @returns {string} absolute path of the delivery log */
export function getDeliveriesPath() {
  return join(getXactionsHome(), DELIVERIES_FILENAME);
}

function resolveSecret(secret) {
  const s = secret ?? process.env.XACTIONS_WEBHOOK_SECRET;
  return typeof s === 'string' && s.length ? s : null;
}

/**
 * HMAC-SHA256 of the raw body, hex encoded.
 * @param {string | Buffer} rawBody
 * @param {string} secret
 * @returns {string} e.g. "sha256=ab12..."
 */
export function signWebhookBody(rawBody, secret, timestamp) {
  if (!secret) throw new Error('signWebhookBody: a secret is required');
  if (!Number.isFinite(Number(timestamp))) {
    throw new Error('signWebhookBody: a unix-seconds timestamp is required');
  }
  // The timestamp is part of the signed payload, not just a header. Signing
  // the body alone would let anyone who captured one delivery replay it for
  // ever by rewriting the timestamp header to the present. Same construction
  // Stripe and GitHub use: HMAC over `<timestamp>.<body>`.
  const signed = `${timestamp}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
  const hex = createHmac('sha256', secret).update(signed).digest('hex');
  return `sha256=${hex}`;
}

/**
 * Pull one header out of a Headers instance, a Node IncomingMessage headers
 * object, or a plain object, case-insensitively.
 */
function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') {
    const v = headers.get(name);
    return v === null ? undefined : v;
  }
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/**
 * Verify a received webhook. Returns an object rather than throwing so an
 * HTTP handler can answer 401 with the reason.
 *
 * @param {string | Buffer} rawBody the request body, unparsed
 * @param {Headers | Record<string, string | string[] | undefined>} headers request headers
 * @param {string} secret the shared XACTIONS_WEBHOOK_SECRET
 * @param {{ toleranceSeconds?: number, now?: number }} [options] `toleranceSeconds`
 *   rejects a timestamp further than this from now (default 300; 0 disables);
 *   `now` is unix seconds, for tests
 * @returns {{ valid: boolean, reason?: string, event?: string, deliveryId?: string, timestamp?: number }}
 */
export function verifyWebhookSignature(rawBody, headers, secret, options = {}) {
  if (!secret) return { valid: false, reason: 'no secret configured' };
  const signature = headerValue(headers, HEADER_SIGNATURE);
  if (!signature) return { valid: false, reason: `missing ${HEADER_SIGNATURE} header` };

  // The timestamp is signed, so it is required even when the freshness check
  // is switched off: without it there is nothing to verify against.
  const timestampRaw = headerValue(headers, HEADER_TIMESTAMP);
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: `missing or invalid ${HEADER_TIMESTAMP} header` };
  }

  const expected = Buffer.from(signWebhookBody(rawBody, secret, timestamp));
  const received = Buffer.from(String(signature));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { valid: false, reason: 'signature mismatch' };
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      return { valid: false, reason: `timestamp outside ${tolerance}s tolerance` };
    }
  }

  return {
    valid: true,
    event: headerValue(headers, HEADER_EVENT),
    deliveryId: headerValue(headers, HEADER_DELIVERY),
    timestamp: Number.isFinite(timestamp) ? timestamp : undefined,
  };
}

// ── Delivery log ──

function readLog() {
  const file = getDeliveriesPath();
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`Webhook delivery log at ${file} is not a JSON array`);
  return parsed;
}

function writeLog(records) {
  const file = getDeliveriesPath();
  mkdirSync(getXactionsHome(), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(records.slice(-MAX_DELIVERIES), null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

/** Insert or replace a record by id, keeping the log capped. */
function upsert(record) {
  const records = readLog();
  const idx = records.findIndex((r) => r.id === record.id);
  if (idx === -1) records.push(record);
  else records[idx] = record;
  writeLog(records);
}

/**
 * Deliveries, newest first.
 * @param {{ status?: 'delivered' | 'failed' | 'all', limit?: number }} [options]
 * @returns {DeliveryRecord[]}
 */
export function listDeliveries({ status = 'all', limit = 50 } = {}) {
  const records = readLog().filter((r) => status === 'all' || r.status === status);
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

/**
 * One delivery by id.
 * @param {string} id
 * @returns {DeliveryRecord | null}
 */
export function getDelivery(id) {
  return readLog().find((r) => r.id === id) || null;
}

// ── Sending ──

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt, baseDelayMs) {
  // 1x, 2x, 4x ... plus up to 25% jitter so retries from several processes
  // do not line up on the same instant.
  const base = baseDelayMs * 2 ** (attempt - 1);
  return Math.round(base + Math.random() * base * 0.25);
}

function isRetryable(status) {
  return status === null || status === 429 || status >= 500;
}

/**
 * Sign and POST a webhook, retrying on transient failure, and record the
 * outcome in the delivery log. Resolves with the record either way; a
 * delivery that fails every attempt has `status: "failed"` rather than
 * throwing, so a notifier fan-out to other channels is never interrupted.
 *
 * @param {object} options
 * @param {string} options.url receiver URL
 * @param {object | string} options.payload object to JSON-encode, or an already-encoded string
 * @param {string} [options.event] event type header (default "notification")
 * @param {string} [options.secret] HMAC secret; falls back to XACTIONS_WEBHOOK_SECRET
 * @param {Record<string, string>} [options.headers] extra headers
 * @param {string} [options.id] delivery id; generated when omitted
 * @param {string} [options.replayOf] id of the delivery this re-sends
 * @param {number} [options.attempts] max attempts (default 3)
 * @param {number} [options.baseDelayMs] first backoff delay (default 500)
 * @param {number} [options.timeoutMs] per-attempt timeout (default 10000)
 * @param {typeof fetch} [options.fetchImpl] fetch replacement, for tests
 * @returns {Promise<DeliveryRecord>}
 */
export async function deliverWebhook({
  url,
  payload,
  event = 'notification',
  secret,
  headers: extraHeaders = {},
  id = randomUUID(),
  replayOf,
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  if (!url) throw new Error('deliverWebhook: url is required');
  if (payload === undefined) throw new Error('deliverWebhook: payload is required');

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const key = resolveSecret(secret);

  /** @type {DeliveryRecord} */
  const record = {
    id,
    url,
    event,
    body,
    createdAt: new Date().toISOString(),
    status: 'failed',
    signed: Boolean(key),
    attempts: [],
    ...(replayOf ? { replayOf } : {}),
  };
  upsert(record);

  const maxAttempts = Math.max(1, Math.floor(attempts));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'XActions-Webhook/1.0',
      ...extraHeaders,
      'X-XActions-Timestamp': String(timestamp),
      'X-XActions-Event': event,
      'X-XActions-Delivery': id,
      ...(key ? { 'X-XActions-Signature': signWebhookBody(body, key, timestamp) } : {}),
    };

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status = null;
    let error;
    try {
      const response = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
      status = response.status;
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (err) {
      error = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err?.message || String(err));
    } finally {
      clearTimeout(timer);
    }

    record.attempts.push({
      at: new Date(started).toISOString(),
      status,
      ...(error ? { error } : {}),
      durationMs: Date.now() - started,
    });

    if (!error) {
      record.status = 'delivered';
      record.completedAt = new Date().toISOString();
      upsert(record);
      return record;
    }

    upsert(record);
    if (attempt < maxAttempts && isRetryable(status)) {
      await sleep(backoffDelay(attempt, baseDelayMs));
      continue;
    }
    break;
  }

  record.completedAt = new Date().toISOString();
  upsert(record);
  return record;
}

/**
 * Re-send a logged delivery: same body, same delivery id, fresh timestamp
 * and signature. The replay is recorded as a new delivery that points at the
 * original through `replayOf`, so the log shows both.
 *
 * @param {string} id delivery id
 * @param {{ secret?: string, url?: string, attempts?: number, baseDelayMs?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<DeliveryRecord>}
 */
export async function replayDelivery(id, options = {}) {
  const original = getDelivery(id);
  if (!original) throw new Error(`No webhook delivery with id "${id}"`);
  return deliverWebhook({
    url: options.url || original.url,
    payload: original.body,
    event: original.event,
    id: randomUUID(),
    replayOf: original.id,
    headers: { 'X-XActions-Replay-Of': original.id },
    ...options,
  });
}

export default {
  DELIVERIES_FILENAME,
  MAX_DELIVERIES,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  HEADER_EVENT,
  HEADER_DELIVERY,
  getXactionsHome,
  getDeliveriesPath,
  signWebhookBody,
  verifyWebhookSignature,
  listDeliveries,
  getDelivery,
  deliverWebhook,
  replayDelivery,
};
