// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Download archive: what has already been fetched, so a re-run is incremental.
 *
 * Two independent layers, because they catch different things:
 *
 *   identity  `{tweet_id}_{num}` per source, the same key gallery-dl records.
 *             Skips work before a byte is requested, which is what makes a
 *             nightly re-run cheap.
 *   content   sha256 of the bytes. gallery-dl's archive "prevents
 *             re-downloading but does not deduplicate across different source
 *             URLs pointing to the same image", so the same photo reached
 *             through a retweet, a quote and the author's own media tab lands
 *             three times. Here the second copy is recognised and hard-linked
 *             to the first, so it still appears at every path a caller
 *             expects while occupying the space of one file.
 *
 * The store is append-only JSONL: an interrupted run leaves a readable file,
 * a partial last line is discarded on load rather than poisoning the index,
 * and the whole thing greps.
 *
 * @module media/archive
 * by nichxbt
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Filename used when a caller enables the archive without naming one. */
export const DEFAULT_ARCHIVE = '.xactions-archive.jsonl';

/** sha256 of a buffer, hex. */
export function hashBytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * The identity key for one media item: stable across runs and independent of
 * the template, so changing `--filename` does not re-download everything.
 */
export function identityKey(item) {
  return `${item.kind || 'media'}:${item.tweetId || item.userId || '0'}:${item.num ?? 1}`;
}

/**
 * Open (or create) an archive.
 *
 * @param {string|null} path  JSONL file; null disables recording entirely
 * @returns {Promise<{ has: Function, hashPath: Function, record: Function, size: number, hashes: number, path: string|null }>}
 */
export async function openArchive(path) {
  const ids = new Set();
  const byHash = new Map();

  if (path) {
    let raw = '';
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const lines = raw.split('\n');
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      let entry;
      try {
        entry = JSON.parse(text);
      } catch {
        // A run killed mid-write leaves one truncated line. Skipping it costs
        // one re-download; refusing to load would cost the whole archive.
        continue;
      }
      if (entry.id) ids.add(entry.id);
      if (entry.hash && entry.path && !byHash.has(entry.hash)) byHash.set(entry.hash, entry.path);
    }
  }

  return {
    path,
    get size() { return ids.size; },
    get hashes() { return byHash.size; },

    /** Has this exact item been downloaded before? */
    has(item) {
      return ids.has(identityKey(item));
    },

    /** Where the identical bytes already live, or null. */
    hashPath(hash) {
      return byHash.get(hash) ?? null;
    },

    /**
     * Record a completed download. Kept in memory even when no file is
     * configured, so a single run still dedupes against itself.
     */
    async record({ item, hash, path: filePath, bytes, url }) {
      const id = identityKey(item);
      ids.add(id);
      if (hash && !byHash.has(hash)) byHash.set(hash, filePath);
      if (!path) return;
      const entry = JSON.stringify({
        id,
        hash,
        path: filePath,
        bytes,
        url,
        tweetId: item.tweetId ?? null,
        username: item.username ?? null,
        at: new Date().toISOString(),
      });
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${entry}\n`, 'utf8');
    },
  };
}
