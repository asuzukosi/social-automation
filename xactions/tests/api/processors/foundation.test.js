// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for the queue processor foundation: the job context
 * (api/services/processors/context.js), the registry
 * (api/services/processors/registry.js) and the queue failure response
 * (api/utils/queueResponse.js).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  JobCancelledError,
  JobInputError,
  authTokenOf,
  createJobContext,
  isPermanentFailure,
  resolveSessionValue,
} from '../../../api/services/processors/context.js';
import {
  UnsupportedOperationError,
  assertRunnable,
  loadProcessors,
} from '../../../api/services/processors/registry.js';
import { queueFailure } from '../../../api/utils/queueResponse.js';

const LIVE = ['ct0=minted; Path=/; Domain=.x.com; Secure'];
const xcom = () => async () => ({ status: 200, headers: { get: () => null, getSetCookie: () => LIVE } });

function job(data, progress = []) {
  return { id: 'job-1', name: data.type, data, progress: (p) => progress.push(p) };
}

describe('resolveSessionValue', () => {
  it('decrypts the stored session for a dashboard user', async () => {
    const decrypt = async (id) => (id === 'u1' ? 'plain-token' : null);
    await expect(resolveSessionValue({ userId: 'u1', config: {} }, { decrypt })).resolves.toBe('plain-token');
  });

  it('prefers a cookie the caller sent over the stored one', async () => {
    const decrypt = async () => 'stored';
    await expect(
      resolveSessionValue({ userId: 'u1', config: { sessionCookie: ' sent ' } }, { decrypt }),
    ).resolves.toBe('sent');
  });

  it('reads every key AI routes use', async () => {
    for (const key of ['sessionCookie', 'session', 'authToken', 'cookie']) {
      await expect(resolveSessionValue({ config: { [key]: 'v' } })).resolves.toBe('v');
    }
    await expect(resolveSessionValue({ config: {} })).resolves.toBeNull();
  });

  it('extracts auth_token from a cookie header', () => {
    expect(authTokenOf('bare')).toBe('bare');
    expect(authTokenOf('ct0=a; auth_token=b; twid=c')).toBe('b');
    expect(authTokenOf('ct0=a')).toBe('');
  });
});

describe('createJobContext', () => {
  it('builds a logged-in HTTP client from a decrypted session', async () => {
    const ctx = createJobContext(job({ type: 't', userId: 'u1', config: {} }), {
      decrypt: async () => 'tok',
      fetch: xcom(),
    });
    await expect(ctx.cookieHeader()).resolves.toBe('auth_token=tok; ct0=minted');
    const client = await ctx.http();
    expect(client.isAuthenticated()).toBe(true);
    expect(await ctx.http()).toBe(client);
  });

  it('explains a missing session differently to dashboard users and agents', async () => {
    const dashboard = createJobContext(job({ type: 't', userId: 'u1', config: {} }), { decrypt: async () => null });
    const agent = createJobContext(job({ type: 't', config: {} }));
    const a = await dashboard.cookieHeader().catch((e) => e);
    const b = await agent.cookieHeader().catch((e) => e);
    expect(a.code).toBe('NO_SESSION');
    expect(a.message).toMatch(/save-session/);
    expect(b.message).toMatch(/X-Session-Cookie/);
    expect(isPermanentFailure(a)).toBe(true);
  });

  it('validates required input without retrying', () => {
    const ctx = createJobContext(job({ type: 't', config: { text: '', ids: [] } }));
    expect(() => ctx.require('text')).toThrow(JobInputError);
    expect(() => ctx.require('ids', 'Tweet ids')).toThrow('Tweet ids is required');
    expect(isPermanentFailure(new JobInputError('x'))).toBe(true);
    expect(isPermanentFailure(new Error('timeout'))).toBe(false);
  });

  it('reports progress and honours cancellation', async () => {
    const progress = [];
    let cancelled = false;
    const ctx = createJobContext(job({ type: 't', id: 'ai-1', config: {} }, progress), {
      isCancelled: (id) => id === 'ai-1' && cancelled,
    });
    ctx.progress('halfway', { done: 5 });
    expect(progress).toEqual([{ status: 'running', message: 'halfway', done: 5 }]);
    expect(ctx.operationId).toBe('ai-1');
    ctx.throwIfCancelled();
    cancelled = true;
    expect(() => ctx.throwIfCancelled()).toThrow(JobCancelledError);
    await expect(ctx.sleep(10)).rejects.toBeInstanceOf(JobCancelledError);
  });

  it('keys stored state and write caps by owner', async () => {
    const charged = [];
    const caps = { checkAndRecord: (account, cls, { count }) => charged.push([account, cls, count]) };
    const dashboard = createJobContext(job({ type: 't', userId: 'u1', config: {} }), { caps });
    const agent = createJobContext(job({ type: 't', sessionHash: 'abc', config: {} }), { caps });
    expect(dashboard.ownerKey).toBe('user:u1');
    expect(agent.ownerKey).toBe('session:abc');
    await agent.charge('like', 3);
    expect(charged).toEqual([['session:abc', 'like', 3]]);
    const capped = Object.assign(new Error('cap'), { name: 'ActionCapExceededError' });
    expect(isPermanentFailure(capped)).toBe(true);
  });

  it('closes browser pages when the job ends', async () => {
    const closed = [];
    const automation = { createPage: async (token) => ({ token, close: async () => closed.push(token) }) };
    const ctx = createJobContext(job({ type: 't', config: { sessionCookie: 'auth_token=tok; ct0=c' } }), {
      browser: async () => automation,
    });
    const page = await ctx.page();
    expect(page.token).toBe('tok');
    await ctx.dispose();
    expect(closed).toEqual(['tok']);
  });
});

describe('processor registry', () => {
  function dirWith(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xactions-proc-'));
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
  }

  it('loads every *.processors.js file with defaults', async () => {
    const dir = dirWith({
      'a.processors.js': 'export default { one: { run: async () => 1, write: true } };',
      'b.processors.js': 'export default { two: { run: async () => 2, concurrency: 5 } };',
      'notes.js': 'export default { ignored: { run: async () => 0 } };',
    });
    const processors = await loadProcessors(dir);
    expect([...processors.keys()]).toEqual(['one', 'two']);
    expect(processors.get('one')).toMatchObject({ concurrency: 2, write: true, source: 'a.processors.js' });
    expect(processors.get('two').concurrency).toBe(5);
    expect(() => assertRunnable(processors, 'two')).not.toThrow();
    const err = (() => {
      try {
        assertRunnable(processors, 'missing');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(UnsupportedOperationError);
    expect(err.status).toBe(501);
  });

  it('refuses a type defined twice or without run()', async () => {
    const dup = dirWith({
      'a.processors.js': 'export default { one: { run: async () => 1 } };',
      'b.processors.js': 'export default { one: { run: async () => 2 } };',
    });
    await expect(loadProcessors(dup)).rejects.toThrow(/already defined in a\.processors\.js/);
    const bad = dirWith({ 'a.processors.js': 'export default { one: {} };' });
    await expect(loadProcessors(bad)).rejects.toThrow(/no run\(ctx\)/);
  });

  it('loads the processors this server ships', async () => {
    const processors = await loadProcessors();
    expect(processors.has('getConversations')).toBe(true);
    expect(processors.has('unfollowNonFollowers')).toBe(true);
  });
});

describe('queueFailure', () => {
  function res() {
    return {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
  }

  it('answers an unsupported operation with 501 and its reason', () => {
    const r = queueFailure(res(), new UnsupportedOperationError('teleport'));
    expect(r.statusCode).toBe(501);
    expect(r.body).toMatchObject({ success: false, error: 'UNSUPPORTED_OPERATION' });
    expect(r.body.message).toMatch(/teleport/);
  });

  it('answers a queue outage with 503 instead of claiming success', () => {
    const r = queueFailure(res(), new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    expect(r.statusCode).toBe(503);
    expect(r.body.error).toBe('QUEUE_UNAVAILABLE');
    expect(r.body.message).not.toMatch(/ECONNREFUSED/);
  });
});
