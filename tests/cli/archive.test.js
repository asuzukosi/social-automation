// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions - `xactions archive` tests. Offline: a synthetic X data export folder in a temp dir.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARCHIVE_FORMATS, parseFormats, parseSections, progressLine } from '../../src/cli/commands/archive.js';

const CLI = fileURLToPath(new URL('../../src/cli/index.js', import.meta.url));

function ytd(name, part, records) {
  return `window.YTD.${name}.part${part} = ${JSON.stringify(records, null, 2)}`;
}

function tweet(id, text, createdAt, extra = {}) {
  return {
    tweet: {
      id_str: id,
      id,
      full_text: text,
      created_at: createdAt,
      favorite_count: String(extra.likes ?? 0),
      retweet_count: String(extra.retweets ?? 0),
      lang: 'en',
      source: '<a href="https://mobile.twitter.com" rel="nofollow">Twitter Web App</a>',
      entities: {
        hashtags: (extra.hashtags || []).map((h) => ({ text: h })),
        user_mentions: (extra.mentions || []).map((m, i) => ({ screen_name: m, name: m, id_str: String(100 + i) })),
        urls: [],
        media: [],
      },
    },
  };
}

/** A minimal but real-shaped X data export folder. */
async function writeFixture(root) {
  const data = path.join(root, 'data');
  await fs.mkdir(data, { recursive: true });
  const w = (name, body) => fs.writeFile(path.join(data, name), body);
  await w('account.js', ytd('account', 0, [{
    account: { email: 'nich@example.com', createdVia: 'web', username: 'nichxbt', accountId: '42', createdAt: '2019-03-01T10:00:00.000Z', accountDisplayName: 'nich' },
  }]));
  await w('profile.js', ytd('profile', 0, [{
    profile: { description: { bio: 'Builds XActions', website: 'https://xactions.app', location: 'Internet' } },
  }]));
  await w('tweets.js', ytd('tweets', 0, [
    tweet('1', 'Hello world #firstpost', 'Mon Jan 01 00:00:00 +0000 2024', { hashtags: ['firstpost'] }),
    tweet('2', 'Shipping #xactions with @alice', 'Wed Jun 05 12:00:00 +0000 2024', { likes: 12, retweets: 3, hashtags: ['xactions'], mentions: ['alice'] }),
    tweet('3', 'Still #xactions', 'Sat Mar 15 08:00:00 +0000 2025', { hashtags: ['xactions'] }),
  ]));
  await w('like.js', ytd('like', 0, [{ like: { tweetId: '555', fullText: 'liked this', expandedUrl: 'https://twitter.com/i/web/status/555' } }]));
  await w('following.js', ytd('following', 0, [
    { following: { accountId: '7', userLink: 'https://twitter.com/intent/user?user_id=7' } },
    { following: { accountId: '8', userLink: 'https://twitter.com/intent/user?user_id=8' } },
  ]));
  await w('follower.js', ytd('follower', 0, [{ follower: { accountId: '7', userLink: 'https://twitter.com/intent/user?user_id=7' } }]));
}

/** Run the real binary against the fixture. */
function cli(args, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, XACTIONS_HOME: cwd, FORCE_COLOR: '0' },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('archive', () => {
  let root;
  let archiveDir;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'xactions-archive-cli-'));
    archiveDir = path.join(root, 'twitter-export');
    await writeFixture(archiveDir);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('parseFormats', () => {
    it('defaults to every format, dedupes, and rejects unknown names', () => {
      expect(parseFormats(undefined)).toEqual(ARCHIVE_FORMATS);
      expect(parseFormats('json, JSON ,csv')).toEqual(['json', 'csv']);
      expect(() => parseFormats('json,xlsx')).toThrow(/Unknown format xlsx/);
      expect(() => parseFormats(' , ')).toThrow(/at least one/);
    });
  });

  describe('parseSections', () => {
    it('validates against the section list', () => {
      expect(parseSections(undefined, ['tweets'])).toBeUndefined();
      expect(parseSections('tweets,likes', ['tweets', 'likes'])).toEqual(['tweets', 'likes']);
      expect(() => parseSections('nope', ['tweets'])).toThrow(/Unknown section nope/);
    });
  });

  describe('progressLine', () => {
    it('renders scan, parse and migration events', () => {
      expect(progressLine({ phase: 'scan', completed: 2, total: 9, file: 'data/tweets.js' })).toBe('Scanning 2/9 data/tweets.js');
      expect(progressLine({ phase: 'tweets', file: 'data/tweets.js', records: 1200 })).toBe('Parsed tweets (1,200 records) from data/tweets.js');
      expect(progressLine({ phase: 'tweets', completed: 3, total: 50 })).toBe('[tweets] 3/50');
    });
  });

  describe('summary', () => {
    it('prints the report with counts and top hashtags', () => {
      const out = cli(['archive', 'summary', archiveDir], root);
      expect(out).toContain('X archive for @nichxbt (folder)');
      expect(out).toContain('#xactions');
      expect(out).toContain('xactions archive export');
    });

    it('--json prints only the summary document', () => {
      const out = cli(['archive', 'summary', archiveDir, '--json', '--top', '1'], root);
      const summary = JSON.parse(out);
      expect(summary.username).toBe('nichxbt');
      expect(summary.counts.tweets).toBe(3);
      expect(summary.counts.following).toBe(2);
      expect(summary.topHashtags).toEqual([{ value: 'xactions', count: 2 }]);
    });

    it('fails cleanly on a path that is not an archive', () => {
      let failure;
      try {
        cli(['archive', 'summary', path.join(root, 'missing.zip'), '--json'], root);
      } catch (error) {
        failure = error;
      }
      expect(failure.status).toBe(1);
      expect(JSON.parse(failure.stdout).error).toBeTruthy();
    });
  });

  describe('export', () => {
    it('writes the chosen formats into --out and reports the files', async () => {
      const out = path.join(root, 'exported');
      const result = JSON.parse(cli(['archive', 'export', archiveDir, '--out', out, '--formats', 'json,md', '--json'], root));
      expect(result.dir).toBe(out);
      expect(result.counts.tweets).toBe(3);
      const files = await fs.readdir(out);
      expect(files).toContain('tweets.json');
      expect(files).toContain('tweets.md');
      expect(files).not.toContain('tweets.csv');
      expect(files).not.toContain('index.html');
    });

    it('rejects an unknown format before reading anything', () => {
      let failure;
      try {
        cli(['archive', 'export', archiveDir, '--out', path.join(root, 'never'), '--formats', 'pdf', '--json'], root);
      } catch (error) {
        failure = error;
      }
      expect(failure.status).toBe(1);
      expect(JSON.parse(failure.stdout).error).toMatch(/Unknown format pdf/);
    });
  });

  describe('migrate', () => {
    it('dry-runs a Bluesky migration straight from the archive', async () => {
      const out = path.join(root, 'staged');
      const summary = JSON.parse(cli(['archive', 'migrate', archiveDir, '--to', 'bluesky', '--out', out, '--json'], root));
      expect(summary.platform).toBe('bluesky');
      expect(summary.dryRun).toBe(true);
      expect(summary.tweets.total).toBe(3);
      const staged = await fs.readdir(out);
      expect(staged).toContain('tweets.json');
      expect(staged).toContain('following.json');
    });

    it('refuses --execute without credentials and an unknown platform', () => {
      const attempt = (args) => {
        try {
          cli(args, root);
          return null;
        } catch (error) {
          return error;
        }
      };
      const noCreds = attempt(['archive', 'migrate', archiveDir, '--to', 'mastodon', '--execute', '--json']);
      expect(noCreds.status).toBe(1);
      expect(JSON.parse(noCreds.stdout).error).toMatch(/--token/);
      const badTarget = attempt(['archive', 'migrate', archiveDir, '--to', 'threads', '--json']);
      expect(JSON.parse(badTarget.stdout).error).toMatch(/bluesky or mastodon/);
    });
  });
});
