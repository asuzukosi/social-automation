// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Scheduler contract tests.
 *
 * The contract these pin: adding a job REGISTERS it, it does not run it. Nothing
 * fires until start() is called, and stop() really stops it. That is not a
 * cosmetic detail. node-cron v3 honoured `{ scheduled: false }` on
 * cron.schedule(); v4 silently ignores it and begins firing the moment the task
 * is constructed. Under v4 the old call would have run every registered command
 * immediately on load(), before the operator ever started the scheduler. These
 * tests fail loudly if that regression ever comes back.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Scheduler } from '../../src/scheduler/scheduler.js';

/** Poll until predicate holds or the budget runs out. Keeps the wall clock honest. */
async function waitFor(predicate, ms = 4000, step = 100) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return predicate();
}

describe('Scheduler', () => {
  let scheduler;
  let executed;

  beforeEach(() => {
    scheduler = new Scheduler();
    executed = [];
    // Intercept at the execution boundary so no real command is ever spawned.
    vi.spyOn(scheduler, '_executeJob').mockImplementation(async (job) => {
      executed.push(job?.config?.name);
      return { status: 'success' };
    });
    vi.spyOn(scheduler, '_save').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const [, job] of scheduler.jobs) job.cronTask?.stop();
    scheduler.jobs.clear();
    vi.restoreAllMocks();
  });

  it('registers a job without running it until start() is called', async () => {
    scheduler.addJob({ name: 'every-second', cron: '* * * * * *', command: 'echo' });

    // The regression this guards: a v4 task built by cron.schedule() would
    // already be firing here.
    const firedEarly = await waitFor(() => executed.length > 0, 2500);
    expect(firedEarly).toBe(false);
    expect(executed).toEqual([]);

    scheduler.start();
    const firedAfterStart = await waitFor(() => executed.length > 0, 4000);
    expect(firedAfterStart).toBe(true);
    expect(executed).toContain('every-second');
  });

  it('stops firing after stop()', async () => {
    scheduler.addJob({ name: 'stoppable', cron: '* * * * * *', command: 'echo' });
    scheduler.start();
    await waitFor(() => executed.length > 0, 4000);

    scheduler.stop();
    const countAtStop = executed.length;
    await new Promise((r) => setTimeout(r, 2500));
    expect(executed.length).toBe(countAtStop);
  });

  it('leaves a disabled job idle when the scheduler starts', async () => {
    scheduler.addJob({ name: 'disabled', cron: '* * * * * *', command: 'echo', enabled: false });
    scheduler.start();

    const fired = await waitFor(() => executed.length > 0, 2500);
    expect(fired).toBe(false);
  });

  it('rejects an invalid cron expression', () => {
    expect(() => scheduler.addJob({ name: 'bad', cron: 'not-a-cron', command: 'echo' }))
      .toThrow(/Invalid cron expression/);
  });

  it('rejects a duplicate job name', () => {
    scheduler.addJob({ name: 'dupe', cron: '*/5 * * * *', command: 'echo' });
    expect(() => scheduler.addJob({ name: 'dupe', cron: '*/5 * * * *', command: 'echo' }))
      .toThrow(/already exists/);
  });

  it('requires name, cron, and command', () => {
    expect(() => scheduler.addJob({ cron: '*/5 * * * *', command: 'echo' })).toThrow(/Job requires/);
    expect(() => scheduler.addJob({ name: 'x', command: 'echo' })).toThrow(/Job requires/);
    expect(() => scheduler.addJob({ name: 'x', cron: '*/5 * * * *' })).toThrow(/Job requires/);
  });

  it('removes a job and stops its task', async () => {
    scheduler.addJob({ name: 'removable', cron: '* * * * * *', command: 'echo' });
    scheduler.start();
    await waitFor(() => executed.length > 0, 4000);

    expect(scheduler.removeJob('removable')).toMatchObject({ status: 'removed' });
    const countAtRemoval = executed.length;
    await new Promise((r) => setTimeout(r, 2500));
    expect(executed.length).toBe(countAtRemoval);
    expect(scheduler.jobs.has('removable')).toBe(false);
  });
});
