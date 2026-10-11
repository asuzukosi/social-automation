// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// XActions — Shell completion generator tests
// by nichxbt

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { Command } from 'commander';

import {
  SUPPORTED_SHELLS,
  collectCommands,
  generateCompletion,
} from '../../src/cli/commands/completion.js';

/** A program shaped like the real CLI: flags, sub-commands, awkward text. */
function makeProgram() {
  // `.version()` already registers -V/--version; adding it again throws.
  const program = new Command();
  program.name('xactions').version('0.0.0-test');

  program
    .command('profile <username>')
    .description('Get profile information for a user')
    .option('-j, --json', 'output as JSON')
    .option('-o, --output <file>', 'write to a file');

  program
    .command('analyze <usernames...>')
    .description("Account report: engagement rate, cadence, and the owner's best hour");

  const plugin = program.command('plugin').description('Manage XActions plugins');
  plugin.command('install <name>').description('Install a plugin').option('-f, --force', 'force');
  plugin.command('list').description('List plugins');

  return program;
}

describe('completion', () => {
  describe('collectCommands', () => {
    it('flattens commands, their flags, and their sub-commands', () => {
      const commands = collectCommands(makeProgram());
      const profile = commands.find((command) => command.name === 'profile');

      expect(profile.options).toContain('--json');
      expect(profile.options).toContain('-j');
      expect(profile.options).toContain('--output');

      const plugin = commands.find((command) => command.name === 'plugin');
      expect(plugin.subcommands.map((sub) => sub.name)).toEqual(['install', 'list']);
      expect(plugin.subcommands[0].options).toContain('--force');
    });

    it('strips the argument placeholder from a flag', () => {
      const commands = collectCommands(makeProgram());
      const profile = commands.find((command) => command.name === 'profile');
      expect(profile.options.some((flag) => flag.includes('<'))).toBe(false);
    });

    it('drops the built-in help command', () => {
      const names = collectCommands(makeProgram()).map((command) => command.name);
      expect(names).not.toContain('help');
    });
  });

  describe('generateCompletion', () => {
    it('supports exactly bash, zsh, and fish', () => {
      expect(SUPPORTED_SHELLS).toEqual(['bash', 'zsh', 'fish']);
      for (const shell of SUPPORTED_SHELLS) {
        expect(generateCompletion(makeProgram(), shell).length).toBeGreaterThan(0);
      }
    });

    it('rejects an unknown shell by name', () => {
      expect(() => generateCompletion(makeProgram(), 'powershell')).toThrow(/powershell/);
    });

    it('produces a bash script that bash itself accepts', () => {
      const script = generateCompletion(makeProgram(), 'bash');
      // `bash -n` parses without executing: the only honest way to know the
      // generated script is not broken shell.
      expect(() =>
        execFileSync('bash', ['-n', '-c', script], { stdio: 'pipe' })
      ).not.toThrow();
    });

    it('registers the completion function in bash', () => {
      const script = generateCompletion(makeProgram(), 'bash');
      expect(script).toContain('complete -F _xactions xactions');
      expect(script).toContain('profile');
      expect(script).toContain('plugin) __xactions_reply "install list');
    });

    it('escapes colons in zsh descriptions so the pair does not split early', () => {
      // "Account report: engagement rate..." would otherwise truncate at the
      // colon, leaving zsh to show half a description and drop the rest.
      const script = generateCompletion(makeProgram(), 'zsh');
      expect(script).toContain('Account report\\:');
      expect(script).not.toMatch(/'analyze:Account report:/);
    });

    it("escapes an apostrophe so it cannot terminate zsh's quoted string", () => {
      const script = generateCompletion(makeProgram(), 'zsh');
      expect(script).toContain("owner'\\''s");
    });

    it('emits a compdef header for zsh', () => {
      const script = generateCompletion(makeProgram(), 'zsh');
      expect(script.startsWith('#compdef xactions')).toBe(true);
      expect(script).toContain('compdef _xactions xactions');
    });

    it('emits one fish completion per command and sub-command', () => {
      const script = generateCompletion(makeProgram(), 'fish');
      expect(script).toContain('-n __fish_use_subcommand -a profile');
      expect(script).toContain("__fish_seen_subcommand_from plugin' -a install");
      expect(script).toContain("__fish_seen_subcommand_from profile' -l json");
    });

    it('stays in sync with the program rather than a hardcoded list', () => {
      const program = makeProgram();
      program.command('freshly-added').description('added after the fact');

      for (const shell of SUPPORTED_SHELLS) {
        expect(generateCompletion(program, shell)).toContain('freshly-added');
      }
    });
  });
});
