// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { buildLaneChain, streamCompletion, BYOK_PROVIDERS } from '../../src/ask/lanes.js';

describe('ask lanes: chain construction', () => {
  it('always ends with the three keyless lanes', () => {
    const names = buildLaneChain({}).map((l) => l.name);
    expect(names).toEqual(['llm7', 'pollinations', 'ovh']);
  });

  it('adds keyed free lanes ahead of the keyless ones', () => {
    const names = buildLaneChain({ GROQ_API_KEY: 'k', GEMINI_API_KEY: 'k', CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }).map((l) => l.name);
    expect(names).toEqual(['groq', 'gemini', 'cloudflare', 'llm7', 'pollinations', 'ovh']);
  });

  it('browserSafe drops the origin-gated lane and keeps a BYOK lane', () => {
    // LLM7 answers 401 to any request carrying an Origin header, so calling it
    // from the page would always waste a round trip.
    expect(buildLaneChain({}, { browserSafe: true }).map((l) => l.name)).toEqual(['pollinations', 'ovh']);
    expect(buildLaneChain({}, { browserSafe: true, byok: { provider: 'groq', apiKey: 'k' } })[0].name).toBe('byok:groq');
  });

  it('a BYOK provider leads the chain and unknown providers are ignored', () => {
    expect(buildLaneChain({}, { byok: { provider: 'xai', apiKey: 'k' } })[0].name).toBe('byok:xai');
    expect(buildLaneChain({}, { byok: { provider: 'nope', apiKey: 'k' } })[0].name).toBe('llm7');
    for (const p of Object.values(BYOK_PROVIDERS)) expect(p.url).toMatch(/^https:\/\//);
  });
});

describe('ask lanes: live keyless completion', () => {
  it('either streams an answer or reports every lane it tried', async () => {
    // The keyless tier is anonymous and rate limited per IP, so a green run
    // here cannot depend on a third party having quota for this machine. What
    // is asserted is our contract: a lane answers and the deltas concatenate
    // to the returned text, or the chain fails having named every lane.
    const deltas = [];
    const chain = buildLaneChain({});
    try {
      const result = await streamCompletion(chain, [{ role: 'user', content: 'Reply with exactly the word PONG.' }], {
        onDelta: (t) => deltas.push(t),
        maxTokens: 20,
      });
      expect(result.text.length).toBeGreaterThan(0);
      expect(deltas.join('')).toBe(result.text);
      expect(chain.map((l) => l.name)).toContain(result.lane);
    } catch (error) {
      for (const lane of chain) expect(error.message).toContain(`${lane.name}:`);
    }
  }, 120000);
});

describe('ask lanes: streaming against a real HTTP server', () => {
  // A local server, not a mock of our own code: it speaks the same wire format
  // a provider does, so the SSE parser, the non-streaming path, and the
  // lane-to-lane failover are covered without depending on anyone's quota.
  const servers = [];
  const listen = (handler) =>
    new Promise((resolve) => {
      const server = createServer(handler);
      servers.push(server);
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/v1/chat/completions`));
    });
  afterAll(() => servers.forEach((s) => s.close()));

  const sse = (res, chunks) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const c of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  };

  it('parses SSE deltas into one answer', async () => {
    const url = await listen((req, res) => sse(res, ['Paste ', 'the script ', 'in the console.']));
    const deltas = [];
    const result = await streamCompletion([{ name: 'local', url, model: 'm' }], [{ role: 'user', content: 'hi' }], { onDelta: (t) => deltas.push(t) });
    expect(result.text).toBe('Paste the script in the console.');
    expect(deltas).toHaveLength(3);
  });

  it('accepts a lane that ignores stream:true and returns one JSON body', async () => {
    const url = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'whole answer' } }] }));
    });
    const result = await streamCompletion([{ name: 'local', url, model: 'm', noStream: true }], [{ role: 'user', content: 'hi' }], {});
    expect(result.text).toBe('whole answer');
  });

  it('steps to the next lane when one fails, and reports them all when none work', async () => {
    const dead = await listen((req, res) => { res.writeHead(429).end('rate limited'); });
    const alive = await listen((req, res) => sse(res, ['second lane']));
    const lanes = [];
    const result = await streamCompletion(
      [{ name: 'dead', url: dead, model: 'm' }, { name: 'alive', url: alive, model: 'm' }],
      [{ role: 'user', content: 'hi' }],
      { onLane: (l) => lanes.push(l) }
    );
    expect(lanes).toEqual(['alive']);
    expect(result.text).toBe('second lane');
    await expect(
      streamCompletion([{ name: 'dead', url: dead, model: 'm' }], [{ role: 'user', content: 'hi' }], {})
    ).rejects.toThrow(/dead: HTTP 429/);
  });

  it('keeps a long partial answer when the stream dies mid-flight', async () => {
    const url = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // Let the chunk reach the client before the connection drops, which is
      // what a provider dying mid-answer actually looks like.
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(240) } }] })}\n\n`, () => {
        setTimeout(() => res.destroy(), 50);
      });
    });
    const result = await streamCompletion([{ name: 'flaky', url, model: 'm' }], [{ role: 'user', content: 'hi' }], {});
    expect(result.partial).toBe(true);
    expect(result.text.length).toBeGreaterThan(200);
  });
});
