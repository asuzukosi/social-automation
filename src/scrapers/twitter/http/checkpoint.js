// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Resumable Scrape Checkpoints
 *
 * A checkpoint is one small JSON file, written atomically after every page,
 * that remembers where a paginated GraphQL scrape got to:
 *
 *   { cursor, count, updatedAt, meta }
 *
 * A follower scrape with `--limit 50000` that dies at page 400 (network drop,
 * rate-limit wall, Ctrl-C) restarts from the saved bottom cursor instead of
 * page one, and the `count` already collected is subtracted from the limit,
 * so the same command finishes the job. Borrowed from the CSV-resume idea in
 * Altimis/Scweet, minus the CSV.
 *
 * Files live under `$XACTIONS_HOME/checkpoints/` (default `~/.xactions`).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveCacheDir } from './queryIds.js';

const CHECKPOINT_DIRNAME = 'checkpoints';

/**
 * Turn an arbitrary key (`followers:elonmusk`) into a safe file name.
 * @param {string} key
 * @returns {string}
 */
function fileNameFor(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe || 'checkpoint'}.json`;
}

/**
 * Write `data` to `filePath` atomically: the JSON goes to a temp file in the
 * same directory first and is renamed over the target, so a crash mid-write
 * leaves either the old checkpoint or the new one, never a torn file.
 * @param {string} filePath
 * @param {object} data
 */
function writeAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

/**
 * Create a checkpoint handle.
 *
 * @param {object} options
 * @param {string} options.key - Identifies the scrape, e.g. `followers:elonmusk`.
 *   Two runs with the same key share one checkpoint.
 * @param {string} [options.dir] - Directory for the file. Defaults to
 *   `$XACTIONS_HOME/checkpoints`.
 * @returns {{
 *   key: string,
 *   path: string,
 *   save: (state: { cursor: string|null, count?: number, meta?: object }) => object,
 *   resume: () => ({ cursor: string|null, count: number, updatedAt: string, meta: object }|null),
 *   clear: () => void,
 *   exists: () => boolean,
 * }}
 */
export function createCheckpoint({ key, dir } = {}) {
  if (!key || typeof key !== 'string') {
    throw new Error('createCheckpoint requires a string `key` (for example "followers:elonmusk").');
  }
  const directory = dir || path.join(resolveCacheDir(), CHECKPOINT_DIRNAME);
  const filePath = path.join(directory, fileNameFor(key));

  return {
    key,
    path: filePath,

    /**
     * Persist the position after a page. Returns the record written.
     */
    save({ cursor = null, count = 0, meta = {} } = {}) {
      const record = {
        key,
        cursor: cursor || null,
        count: Number(count) || 0,
        updatedAt: new Date().toISOString(),
        meta: meta && typeof meta === 'object' ? meta : {},
      };
      writeAtomic(filePath, record);
      return record;
    },

    /**
     * Read the saved position, or null when there is none (or the file is
     * unreadable, which is treated the same as absent: a scrape must never
     * refuse to start because of a damaged checkpoint).
     */
    resume() {
      let text;
      try {
        text = fs.readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
          cursor: parsed.cursor || null,
          count: Number(parsed.count) || 0,
          updatedAt: parsed.updatedAt || null,
          meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : {},
        };
      } catch {
        return null;
      }
    },

    clear() {
      fs.rmSync(filePath, { force: true });
    },

    exists() {
      return fs.existsSync(filePath);
    },
  };
}

/**
 * Bind an optional checkpoint to one pagination loop.
 *
 * Every paginated scraper (`scrapeFollowers`, `scrapeTweets`, `searchTweets`,
 * ...) calls this once before its loop. With no checkpoint it is a no-op
 * pass-through; with one, it resumes the cursor, shrinks the limit by what
 * earlier runs already collected, records the cursor after each page, and
 * deletes the file when the scrape completes.
 *
 * @param {object|null|undefined} checkpoint - Handle from `createCheckpoint`.
 * @param {object} initial
 * @param {string|null} [initial.cursor] - Explicit cursor passed by the caller;
 *   a saved checkpoint cursor takes precedence over it.
 * @param {number} initial.limit - Requested item limit for the whole scrape.
 * @param {object} [initial.meta] - Stored alongside the cursor (username, query, ...).
 * @returns {{
 *   cursor: string|null,
 *   limit: number,
 *   resumed: boolean,
 *   record: (cursor: string|null, fetchedThisRun: number) => void,
 *   complete: () => void,
 * }}
 */
export function bindCheckpoint(checkpoint, { cursor = null, limit = Infinity, meta = {} } = {}) {
  if (!checkpoint || typeof checkpoint.resume !== 'function') {
    return { cursor, limit, resumed: false, record() {}, complete() {} };
  }

  const saved = checkpoint.resume();
  const baseCount = saved ? saved.count : 0;
  const remaining = Number.isFinite(limit) ? Math.max(limit - baseCount, 0) : limit;

  return {
    cursor: saved?.cursor || cursor,
    limit: remaining,
    resumed: Boolean(saved),
    record(nextCursor, fetchedThisRun) {
      checkpoint.save({
        cursor: nextCursor,
        count: baseCount + (Number(fetchedThisRun) || 0),
        meta: { ...(saved?.meta || {}), ...meta },
      });
    },
    complete() {
      checkpoint.clear();
    },
  };
}
