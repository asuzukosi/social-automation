// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — `xactions engage` tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import path from 'path';
import os from 'os';

import { selectTweets, parseTemplates, pickTemplate, statePath, registerEngageCommand } from '../../src/cli/commands/engage.js';
import { GROUPS } from '../../src/cli/help-groups.js';

const tweet = (id, extra = {}) => ({ id, text: `post ${id}`, username: 'nasa', isRetweet: false, isReply: false, timeParsed: new Date('2026-08-20T00:00:00Z'), photos: [], videos: [], ...extra });
const ALL = { like: true, repost: true, comment: true };

describe('selectTweets', () => {
  it('skips reposts and replies by default and reports why', () => {
    const { selected, skipped } = selectTweets([tweet('1'), tweet('2', { isRetweet: true }), tweet('3', { isReply: true })], { actions: ALL });
    expect(selected.map((t) => t.id)).toEqual(['1']);
    expect(skipped).toEqual([{ id: '2', why: 'repost' }, { id: '3', why: 'reply' }]);
  });

  it('includes them when asked', () => {
    const { selected } = selectTweets([tweet('2', { isRetweet: true }), tweet('3', { isReply: true })], { actions: ALL, includeReposts: true, includeReplies: true });
    expect(selected.map((t) => t.id)).toEqual(['2', '3']);
  });

  it('honours --since and --limit', () => {
    const tweets = [tweet('1'), tweet('2', { timeParsed: new Date('2026-01-01T00:00:00Z') }), tweet('3'), tweet('4')];
    const { selected, skipped } = selectTweets(tweets, { actions: ALL, since: new Date('2026-06-01T00:00:00Z'), limit: 2 });
    expect(selected.map((t) => t.id)).toEqual(['1', '3']);
    expect(skipped).toEqual([{ id: '2', why: 'older than --since' }]);
  });

  it('skips posts fully done in an earlier run but keeps ones with actions remaining', () => {
    const done = {
      1: { liked: true, reposted: true, commented: true },
      2: { liked: true, reposted: false, commented: true },
    };
    const { selected, skipped } = selectTweets([tweet('1'), tweet('2')], { actions: ALL, done });
    expect(selected.map((t) => t.id)).toEqual(['2']);
    expect(skipped).toEqual([{ id: '1', why: 'already done' }]);

    const likeOnly = selectTweets([tweet('2')], { actions: { like: true, repost: false, comment: false }, done });
    expect(likeOnly.selected).toEqual([]);
  });

  it('drops empty posts with no media', () => {
    const { selected, skipped } = selectTweets([tweet('1', { text: '' }), tweet('2', { text: '', photos: [{}] })], { actions: ALL });
    expect(selected.map((t) => t.id)).toEqual(['2']);
    expect(skipped).toEqual([{ id: '1', why: 'empty' }]);
  });
});

describe('parseTemplates', () => {
  it('merges flags and a file, ignoring blanks and comments', () => {
    const out = parseTemplates([' from flag '], '# header\n\nline one\n  line two  \n#skip\n');
    expect(out).toEqual(['from flag', 'line one', 'line two']);
  });
});

describe('pickTemplate', () => {
  it('fills placeholders', () => {
    const { text } = pickTemplate(['hey {author}, nice one {name}'], { username: 'nasa' }, -1);
    expect(text).toBe('hey @nasa, nice one @nasa');
  });

  it('never repeats the previous template when more than one exists', () => {
    const templates = ['a', 'b', 'c'];
    let last = 0;
    const rolls = [0, 0, 1, 1, 2, 2, 0];
    let r = 0;
    const random = () => rolls[r++ % rolls.length] / templates.length;
    for (let i = 0; i < 5; i++) {
      const { index } = pickTemplate(templates, {}, last, random);
      expect(index).not.toBe(last);
      last = index;
    }
  });

  it('returns empty when there are no templates', () => {
    expect(pickTemplate([], {}, -1)).toEqual({ text: '', index: -1 });
  });
});

describe('statePath', () => {
  it('normalises the handle into a safe file name', () => {
    const dir = path.join(os.tmpdir(), 'xa');
    expect(statePath(dir, '@NASA.official')).toBe(path.join(dir, 'engage', 'nasaofficial.json'));
  });
});

describe('registerEngageCommand', () => {
  it('registers the command with its flags and lands in the Write and grow group', () => {
    const program = new Command();
    registerEngageCommand(program, { createHttpScraper: async () => ({}), loadConfig: async () => ({}), configDir: '/tmp/xa' });
    const cmd = program.commands.find((c) => c.name() === 'engage');
    expect(cmd).toBeDefined();
    const flags = cmd.options.map((o) => o.long);
    for (const flag of ['--like', '--repost', '--comment', '--prompt', '--template', '--provider', '--dry-run', '--json', '--reset', '--no-resume', '--since']) {
      expect(flags).toContain(flag);
    }
    const group = GROUPS.find((g) => g.commands.includes('engage'));
    expect(group?.title).toBe('Write and grow');
  });
});
