// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests: the stream manager's live transport and its fallback to polling
 *
 * The pipeline factory, the event sink and the poll scheduler are all
 * injected, so these run with no Redis, no browser and no network.
 *
 * @author nich (@nichxbt)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  attachLiveTransport,
  detachLiveTransport,
  createStream,
  TRANSPORTS,
} from '../../src/streaming/streamManager.js';
import { LivePipelineAuthError, Topic } from '../../src/streaming/livePipeline.js';

/** Minimal stream metadata, shaped the way createStream builds it. */
function makeMeta(overrides = {}) {
  return {
    id: `stream_tweet_tester_${Math.random().toString(16).slice(2, 10)}`,
    type: 'tweet',
    username: 'tester',
    interval: 60_000,
    authToken: null,
    cookies: 'auth_token=t; ct0=c',
    userId: null,
    transport: 'poll',
    requestedTransport: 'live',
    topics: [Topic.tweetEngagement('1749528513')],
    liveSessionId: null,
    transportFallbackReason: null,
    status: 'running',
    createdAt: new Date().toISOString(),
    lastPollAt: null,
    pollCount: 0,
    eventCount: 0,
    errorCount: 0,
    consecutiveErrors: 0,
    backoffUntil: null,
    lastError: null,
    ...overrides,
  };
}

/**
 * A stand-in for the live pipeline that hands the test the callbacks the
 * manager registered, so events and failures can be driven by hand.
 */
function fakePipelineFactory({ openError = null, sessionId = 'session-1' } = {}) {
  const handles = [];
  const factory = vi.fn((options) => {
    const pipeline = {
      options,
      sessionId,
      closed: false,
      subscribed: [],
      unsubscribed: [],
      async open() {
        if (openError) throw openError;
        options.onEvent({
          type: 'config',
          topic: null,
          payload: { kind: 'session', sessionId, subscriptionTtlMillis: 0, heartbeatMillis: 0 },
          receivedAt: new Date().toISOString(),
          raw: {},
        });
        return { sessionId, topics: options.topics };
      },
      async close() {
        this.closed = true;
      },
      async subscribe(topics) {
        this.subscribed.push(topics);
        return { topics, errors: [] };
      },
      async unsubscribe(topics) {
        this.unsubscribed.push(topics);
        return { topics, errors: [] };
      },
      emit(event) {
        options.onEvent(event);
      },
      fail(error, info) {
        options.onError(error, info);
      },
    };
    handles.push(pipeline);
    return pipeline;
  });
  return { factory, handles };
}

let warnSpy;
let logSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

describe('transport selection', () => {
  it('offers exactly the two documented transports', () => {
    expect(TRANSPORTS).toEqual(['poll', 'live']);
  });

  it('rejects an unknown transport before touching any infrastructure', async () => {
    await expect(
      createStream({ type: 'tweet', username: 'tester', transport: 'websocket' })
    ).rejects.toThrow(/Invalid transport/);
  });
});

describe('attachLiveTransport', () => {
  it('runs the stream over the pipeline and forwards typed events', async () => {
    const { factory, handles } = fakePipelineFactory({ sessionId: 'session-42' });
    const meta = makeMeta();
    const received = [];

    const result = await attachLiveTransport(meta, {
      createPipeline: factory,
      onStreamEvent: (event) => received.push(event),
    });

    expect(result.attached).toBe(true);
    expect(meta.transport).toBe('live');
    expect(meta.liveSessionId).toBe('session-42');
    expect(factory.mock.calls[0][0].topics).toEqual(['/tweet_engagement/1749528513']);
    // The session config frame is bookkeeping, not a client-facing event.
    expect(received).toHaveLength(0);

    handles[0].emit({
      type: 'engagement',
      topic: '/tweet_engagement/1749528513',
      payload: { tweetId: '1749528513', likeCount: 9 },
      receivedAt: '2026-08-27T00:00:00.000Z',
      raw: {},
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: 'stream:engagement',
      streamId: meta.id,
      username: 'tester',
      transport: 'live',
      topic: '/tweet_engagement/1749528513',
      data: { tweetId: '1749528513', likeCount: 9 },
      timestamp: '2026-08-27T00:00:00.000Z',
    });
    expect(meta.eventCount).toBe(1);

    handles[0].emit({
      type: 'dm',
      topic: '/dm_update/1-2',
      payload: { conversationId: '1-2', userId: '9' },
      receivedAt: '2026-08-27T00:00:01.000Z',
      raw: {},
    });
    expect(received[1].type).toBe('stream:dm');

    await detachLiveTransport(meta.id);
    expect(handles[0].closed).toBe(true);
    expect(await detachLiveTransport(meta.id)).toBe(false);
  });

  it('falls back to polling when the session is not logged in, and says so once', async () => {
    const authError = new LivePipelineAuthError('The live pipeline needs a logged-in session');
    const { factory, handles } = fakePipelineFactory({ openError: authError });
    const meta = makeMeta();

    const first = await attachLiveTransport(meta, { createPipeline: factory });
    expect(first.attached).toBe(false);
    expect(first.error).toBe(authError);
    expect(first.reason).toMatch(/logged-in session/);
    expect(meta.transport).toBe('poll');
    expect(meta.transportFallbackReason).toMatch(/logged-in session/);
    expect(handles[0].closed).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Same reason on a retry: recorded again, logged no more.
    const second = await attachLiveTransport(meta, { createPipeline: factory });
    expect(second.attached).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when no topics were given', async () => {
    const { factory } = fakePipelineFactory();
    const meta = makeMeta({ topics: [] });

    const result = await attachLiveTransport(meta, { createPipeline: factory });

    expect(result.attached).toBe(false);
    expect(result.reason).toMatch(/topics/);
    expect(factory).not.toHaveBeenCalled();
    expect(meta.transport).toBe('poll');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('starts polling when the pipeline gives up for good', async () => {
    const { factory, handles } = fakePipelineFactory();
    const meta = makeMeta();
    const schedulePoll = vi.fn(async (m) => {
      m.transport = 'poll';
    });

    await attachLiveTransport(meta, {
      createPipeline: factory,
      onStreamEvent: () => {},
      schedulePoll,
    });
    expect(meta.transport).toBe('live');

    // A retryable drop leaves the transport alone.
    handles[0].fail(new Error('live_pipeline closed the stream'), {
      fatal: false,
      willRetry: true,
      attempt: 1,
      delayMs: 1000,
    });
    await Promise.resolve();
    expect(schedulePoll).not.toHaveBeenCalled();
    expect(meta.transport).toBe('live');

    // Reconnect exhausted: the stream switches to polling and keeps running.
    handles[0].fail(new Error('live_pipeline gave up reconnecting: connect ECONNREFUSED'), {
      fatal: true,
      willRetry: false,
    });
    await vi.waitFor(() => expect(schedulePoll).toHaveBeenCalledTimes(1));

    expect(schedulePoll.mock.calls[0][0]).toBe(meta);
    expect(meta.transport).toBe('poll');
    expect(meta.transportFallbackReason).toMatch(/gave up reconnecting/);
    expect(handles[0].closed).toBe(true);
    expect(meta.errorCount).toBe(1);
    expect(await detachLiveTransport(meta.id)).toBe(false);
  });

  it('does not restart polling for a stream that was paused or stopped', async () => {
    const { factory, handles } = fakePipelineFactory();
    const meta = makeMeta({ status: 'paused' });
    const schedulePoll = vi.fn(async () => {});

    await attachLiveTransport(meta, {
      createPipeline: factory,
      onStreamEvent: () => {},
      schedulePoll,
    });
    handles[0].fail(new Error('rejected session'), { fatal: true, willRetry: false });
    await vi.waitFor(() => expect(handles[0].closed).toBe(true));

    expect(schedulePoll).not.toHaveBeenCalled();
  });
});
