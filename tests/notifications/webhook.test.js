// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests: signed outbound webhooks
 *
 * Covers the signature construction (which includes the timestamp, so a
 * captured delivery cannot be replayed by rewriting that header), the
 * verifier a receiver runs, retry with backoff against a real local HTTP
 * server, the delivery log, and replay.
 *
 * No network beyond 127.0.0.1.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  signWebhookBody,
  verifyWebhookSignature,
  deliverWebhook,
  listDeliveries,
  getDelivery,
  replayDelivery,
  getDeliveriesPath,
  DELIVERIES_FILENAME,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  HEADER_EVENT,
  HEADER_DELIVERY,
} from '../../src/notifications/webhook.js';

const SECRET = 'shhh-this-is-the-shared-secret';
let home;
const prevHome = process.env.XACTIONS_HOME;
const prevSecret = process.env.XACTIONS_WEBHOOK_SECRET;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'xactions-webhook-'));
  process.env.XACTIONS_HOME = home;
  process.env.XACTIONS_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.XACTIONS_HOME;
  else process.env.XACTIONS_HOME = prevHome;
  if (prevSecret === undefined) delete process.env.XACTIONS_WEBHOOK_SECRET;
  else process.env.XACTIONS_WEBHOOK_SECRET = prevSecret;
  rmSync(home, { recursive: true, force: true });
});

/** Start a local server that records requests and answers with the given statuses in order. */
async function startServer(statuses = [200]) {
  const received = [];
  let call = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/hook`;
  return { url, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe('signWebhookBody', () => {
  it('signs the timestamp together with the body', () => {
    const body = JSON.stringify({ hello: 'world' });
    const a = signWebhookBody(body, SECRET, 1000);
    const b = signWebhookBody(body, SECRET, 1001);

    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(signWebhookBody(body, SECRET, 1000)).toBe(a);
    expect(signWebhookBody(Buffer.from(body), SECRET, 1000)).toBe(a);
  });

  it('refuses to sign without a secret or a timestamp', () => {
    expect(() => signWebhookBody('{}', '', 1000)).toThrow(/secret is required/);
    expect(() => signWebhookBody('{}', SECRET)).toThrow(/timestamp is required/);
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'unfollowers', count: 3 });
  const now = 1_800_000_000;
  const headersFor = (timestamp, rawBody = body) => ({
    [HEADER_SIGNATURE]: signWebhookBody(rawBody, SECRET, timestamp),
    [HEADER_TIMESTAMP]: String(timestamp),
    [HEADER_EVENT]: 'notification',
    [HEADER_DELIVERY]: 'delivery-1',
  });

  it('accepts a delivery it signed', () => {
    const result = verifyWebhookSignature(body, headersFor(now), SECRET, { now });
    expect(result).toMatchObject({ valid: true, event: 'notification', deliveryId: 'delivery-1', timestamp: now });
  });

  it('reads headers from a Headers instance and from Node request headers', () => {
    const plain = headersFor(now);
    const fetchHeaders = new Headers(plain);
    expect(verifyWebhookSignature(body, fetchHeaders, SECRET, { now }).valid).toBe(true);
    // Node lowercases and may hand back arrays
    const nodeStyle = { ...plain, [HEADER_EVENT]: ['notification'] };
    expect(verifyWebhookSignature(body, nodeStyle, SECRET, { now }).valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const result = verifyWebhookSignature(`${body} `, headersFor(now), SECRET, { now });
    expect(result).toMatchObject({ valid: false, reason: 'signature mismatch' });
  });

  it('rejects a replay that rewrites the timestamp to the present', () => {
    // The attack the body-only signature allowed: capture one delivery, move
    // its timestamp forward, and it would verify for ever.
    const captured = headersFor(now);
    const muchLater = now + 30 * 24 * 60 * 60;
    const replayed = { ...captured, [HEADER_TIMESTAMP]: String(muchLater) };

    expect(verifyWebhookSignature(body, replayed, SECRET, { now: muchLater }))
      .toMatchObject({ valid: false, reason: 'signature mismatch' });
    // And the original headers are stale by then, so neither form gets through
    expect(verifyWebhookSignature(body, captured, SECRET, { now: muchLater }).valid).toBe(false);
  });

  it('rejects a stale timestamp and honours the tolerance option', () => {
    const stale = headersFor(now - 600);
    expect(verifyWebhookSignature(body, stale, SECRET, { now }))
      .toMatchObject({ valid: false, reason: 'timestamp outside 300s tolerance' });
    expect(verifyWebhookSignature(body, stale, SECRET, { now, toleranceSeconds: 900 }).valid).toBe(true);
    // Tolerance 0 switches the freshness check off, but the signature still binds the timestamp
    expect(verifyWebhookSignature(body, stale, SECRET, { now, toleranceSeconds: 0 }).valid).toBe(true);
  });

  it('rejects a missing signature, a missing timestamp, and the wrong secret', () => {
    expect(verifyWebhookSignature(body, {}, SECRET, { now }).reason).toMatch(/missing .*signature/i);
    const noTimestamp = { [HEADER_SIGNATURE]: signWebhookBody(body, SECRET, now) };
    expect(verifyWebhookSignature(body, noTimestamp, SECRET, { now }).reason).toMatch(/timestamp/i);
    expect(verifyWebhookSignature(body, headersFor(now), 'wrong-secret', { now }))
      .toMatchObject({ valid: false, reason: 'signature mismatch' });
    expect(verifyWebhookSignature(body, headersFor(now), '', { now }))
      .toMatchObject({ valid: false, reason: 'no secret configured' });
  });
});

describe('deliverWebhook', () => {
  it('signs what it sends, so the receiver can verify it', async () => {
    const server = await startServer([200]);
    try {
      const result = await deliverWebhook({
        url: server.url,
        payload: { title: 'Stream started', severity: 'info' },
        event: 'stream.started',
      });

      expect(result).toMatchObject({ status: 'delivered', event: 'stream.started', signed: true });
      expect(result.attempts.at(-1).status).toBe(200);
      expect(server.received).toHaveLength(1);

      const { headers, body } = server.received[0];
      expect(headers[HEADER_EVENT]).toBe('stream.started');
      expect(headers[HEADER_DELIVERY]).toBe(result.id);
      expect(verifyWebhookSignature(body, headers, SECRET).valid).toBe(true);
      expect(JSON.parse(body)).toEqual({ title: 'Stream started', severity: 'info' });
    } finally {
      await server.close();
    }
  });

  it('retries a 500 and succeeds, recording every attempt', async () => {
    const server = await startServer([500, 500, 200]);
    try {
      const result = await deliverWebhook({
        url: server.url,
        payload: { n: 1 },
        baseDelayMs: 1,
      });

      expect(result.status).toBe('delivered');
      expect(result.attempts).toHaveLength(3);
      expect(result.attempts.map((a) => a.status)).toEqual([500, 500, 200]);
      // Same delivery id on every attempt, so a receiver can deduplicate
      const ids = new Set(server.received.map((r) => r.headers[HEADER_DELIVERY]));
      expect(ids.size).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('gives up after the configured attempts and reports the failure', async () => {
    const server = await startServer([500]);
    try {
      const result = await deliverWebhook({ url: server.url, payload: {}, attempts: 2, baseDelayMs: 1 });
      expect(result.status).toBe('failed');
      expect(result.attempts).toHaveLength(2);
      expect(result.attempts.at(-1).error).toMatch(/HTTP 500/);
    } finally {
      await server.close();
    }
  });

  it('sends unsigned when no secret is configured, and still records the delivery', async () => {
    delete process.env.XACTIONS_WEBHOOK_SECRET;
    const server = await startServer([200]);
    try {
      const result = await deliverWebhook({ url: server.url, payload: { a: 1 } });
      expect(result.status).toBe('delivered');
      expect(result.signed).toBe(false);
      expect(server.received[0].headers[HEADER_SIGNATURE]).toBeUndefined();
      expect(server.received[0].headers[HEADER_TIMESTAMP]).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it('requires a url and a payload', async () => {
    await expect(deliverWebhook({ payload: {} })).rejects.toThrow(/url is required/);
    await expect(deliverWebhook({ url: 'https://example.test' })).rejects.toThrow(/payload is required/);
  });
});

describe('delivery log', () => {
  it('persists deliveries under XACTIONS_HOME and filters by status', async () => {
    const ok = await startServer([200]);
    const bad = await startServer([500]);
    try {
      const good = await deliverWebhook({ url: ok.url, payload: { ok: true } });
      const failed = await deliverWebhook({ url: bad.url, payload: { ok: false }, attempts: 1 });

      expect(getDeliveriesPath()).toBe(join(home, DELIVERIES_FILENAME));
      expect(existsSync(getDeliveriesPath())).toBe(true);
      expect(JSON.parse(readFileSync(getDeliveriesPath(), 'utf8')).length).toBe(2);

      expect(listDeliveries().map((d) => d.id).sort()).toEqual([good.id, failed.id].sort());
      expect(listDeliveries({ status: 'failed' }).map((d) => d.id)).toEqual([failed.id]);
      expect(listDeliveries({ status: 'delivered' }).map((d) => d.id)).toEqual([good.id]);
      expect(listDeliveries({ limit: 1 })).toHaveLength(1);
      expect(getDelivery(good.id)).toMatchObject({ id: good.id, status: 'delivered' });
      expect(getDelivery('nope')).toBeNull();
    } finally {
      await ok.close();
      await bad.close();
    }
  });

  it('replays a delivery with the same payload under a new id', async () => {
    const server = await startServer([500, 200]);
    try {
      const first = await deliverWebhook({ url: server.url, payload: { retry: 'me' }, attempts: 1 });
      expect(first.status).toBe('failed');

      const replayed = await replayDelivery(first.id);
      expect(replayed.status).toBe('delivered');
      expect(replayed.id).not.toBe(first.id);
      expect(replayed.replayOf).toBe(first.id);
      expect(JSON.parse(server.received[1].body)).toEqual({ retry: 'me' });
      expect(verifyWebhookSignature(server.received[1].body, server.received[1].headers, SECRET).valid).toBe(true);

      await expect(replayDelivery('missing-id')).rejects.toThrow(/missing-id/);
    } finally {
      await server.close();
    }
  });
});
