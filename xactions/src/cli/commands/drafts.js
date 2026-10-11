// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions drafts` - review and release what an agent queued under approval mode.
 *
 * With XACTIONS_MCP_REQUIRE_APPROVAL set, every side-effect MCP tool call is
 * saved to `~/.xactions/mcp-drafts.json` instead of running. Until now the
 * only way to release one was from inside the agent's own chat, through
 * `x_approve_draft`. This command puts the same queue in the terminal, so
 * the person holding the keys can read the exact arguments, approve one or
 * all of them, or drop them, without going back through the agent.
 *
 * Approval replays the stored call through `executeTool` from the MCP
 * server, the same dispatch the original call would have used. The server
 * module is imported only on `approve`, so `list`, `show`, `discard` and
 * `clear` stay instant and never load a tool registry.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import chalk from 'chalk';

import {
  approveDraft,
  discardDraft,
  getDraft,
  getDraftsPath,
  listDrafts,
  pruneDrafts,
} from '../../mcp/drafts.js';

/** Statuses `--status` accepts. */
export const DRAFT_STATUSES = ['pending', 'executed', 'failed', 'all'];

/** Longest an argument summary gets before it is cut, so a list line stays a line. */
const ARGS_SUMMARY_MAX = 80;

/**
 * Load the live tool executor. Deferred so the CLI does not pay for the MCP
 * server (and its tool registry) unless a draft is actually being released.
 * @returns {Promise<(tool: string, args: object) => Promise<unknown>>}
 */
/**
 * The approver: charges the daily action caps, then runs the stored call.
 * Approving used to call the executor directly, so drafts approved here
 * skipped the caps the MCP server enforces.
 */
async function loadApprover() {
  const { approveDraftChecked } = await import('../../mcp/server.js');
  return (id) => approveDraftChecked(id);
}

/**
 * Human age of an ISO timestamp: `just now`, `4m`, `3h`, `2d`.
 * @param {string} iso
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function formatAge(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * One-line summary of a tool's arguments: `text="Shipping..." username=nasa`.
 * Strings are quoted and cut, everything else is JSON, and the whole line is
 * capped so a long post never wraps the table.
 * @param {object} args
 * @param {number} [max=ARGS_SUMMARY_MAX]
 * @returns {string}
 */
export function summarizeArgs(args, max = ARGS_SUMMARY_MAX) {
  const entries = Object.entries(args || {});
  if (entries.length === 0) return '(no arguments)';
  const parts = entries.map(([key, value]) => {
    if (typeof value === 'string') {
      const flat = value.replace(/\s+/g, ' ').trim();
      const cut = flat.length > 40 ? `${flat.slice(0, 39)}…` : flat;
      return `${key}="${cut}"`;
    }
    return `${key}=${JSON.stringify(value)}`;
  });
  const line = parts.join(' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Colour a draft status.
 * @param {string} status
 * @returns {string}
 */
function paintStatus(status) {
  return { pending: chalk.yellow, executed: chalk.green, failed: chalk.red }[status]?.(status) ?? status;
}

/**
 * Print a JSON document to stdout.
 * @param {unknown} data
 */
function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Render the draft table, or the empty state that says how a draft gets here.
 * @param {import('../../mcp/drafts.js').Draft[]} drafts
 * @param {string} status
 */
function renderList(drafts, status) {
  if (drafts.length === 0) {
    const scope = status === 'all' ? '' : ` ${status}`;
    console.log(chalk.gray(`\n  No${scope} drafts in ${getDraftsPath()}.`));
    console.log(
      chalk.gray('  Drafts appear when an MCP client runs with XACTIONS_MCP_REQUIRE_APPROVAL=1 and calls a write tool.\n')
    );
    return;
  }
  console.log('');
  console.log(
    `  ${chalk.bold('ID'.padEnd(10))}${chalk.bold('STATUS'.padEnd(10))}${chalk.bold('AGE'.padEnd(10))}${chalk.bold('TOOL'.padEnd(26))}${chalk.bold('ARGS')}`
  );
  for (const draft of drafts) {
    console.log(
      `  ${chalk.cyan(draft.id.padEnd(10))}${paintStatus(draft.status.padEnd(10))}${formatAge(draft.createdAt).padEnd(10)}${draft.tool.padEnd(26)}${chalk.gray(summarizeArgs(draft.args))}`
    );
  }
  const pending = drafts.filter((d) => d.status === 'pending').length;
  console.log('');
  console.log(
    chalk.gray(
      `  ${drafts.length} draft${drafts.length === 1 ? '' : 's'}, ${pending} pending. ` +
        'Approve one with `xactions drafts approve <id>`, everything with `--all`.\n'
    )
  );
}

/**
 * Render one draft in full.
 * @param {import('../../mcp/drafts.js').Draft} draft
 */
function renderDraft(draft) {
  console.log('');
  console.log(`  ${chalk.bold('Draft')}    ${chalk.cyan(draft.id)}`);
  console.log(`  ${chalk.bold('Tool')}     ${draft.tool}`);
  console.log(`  ${chalk.bold('Status')}   ${paintStatus(draft.status)}`);
  const age = formatAge(draft.createdAt);
  console.log(`  ${chalk.bold('Created')}  ${draft.createdAt} (${age === 'just now' ? age : `${age} ago`})`);
  if (draft.executedAt) console.log(`  ${chalk.bold('Ran')}      ${draft.executedAt}`);
  console.log(`  ${chalk.bold('Args')}`);
  for (const line of JSON.stringify(draft.args, null, 2).split('\n')) {
    console.log(`    ${chalk.gray(line)}`);
  }
  if (draft.status === 'failed') console.log(`  ${chalk.bold('Error')}    ${chalk.red(draft.error)}`);
  if (draft.status === 'executed') {
    console.log(`  ${chalk.bold('Result')}`);
    for (const line of JSON.stringify(draft.result, null, 2).split('\n')) {
      console.log(`    ${chalk.gray(line)}`);
    }
  }
  console.log('');
}

/**
 * `drafts list`.
 * @param {{status?: string, json?: boolean}} options
 */
export function listCommand(options = {}) {
  const status = options.status || 'all';
  if (!DRAFT_STATUSES.includes(status)) {
    throw new Error(`--status must be one of ${DRAFT_STATUSES.join(', ')}`);
  }
  const drafts = listDrafts({ status });
  if (options.json) {
    printJson(drafts);
    return drafts;
  }
  renderList(drafts, status);
  return drafts;
}

/**
 * `drafts show <id>`.
 * @param {string} id
 * @param {{json?: boolean}} options
 */
export function showCommand(id, options = {}) {
  const draft = getDraft(id);
  if (!draft) throw new Error(`No draft with id "${id}". Run \`xactions drafts list\` to see what exists.`);
  if (options.json) printJson(draft);
  else renderDraft(draft);
  return draft;
}

/**
 * `drafts approve <id>` or `drafts approve --all`. Runs each pending draft
 * through the executor and records the outcome on it. A draft that already
 * ran is refused by the store, so nothing posts twice.
 *
 * @param {string|undefined} id
 * @param {{all?: boolean, json?: boolean}} options
 * @param {{loadApprover?: () => Promise<Function>, loadExecutor?: () => Promise<Function>}} [deps]
 * @returns {Promise<import('../../mcp/drafts.js').Draft[]>}
 */
export async function approveCommand(id, options = {}, deps = {}) {
  if (!id && !options.all) {
    throw new Error('Give a draft id, or pass --all to approve every pending draft.');
  }
  if (id && options.all) {
    throw new Error('Pass either a draft id or --all, not both.');
  }

  const targets = options.all ? listDrafts({ status: 'pending' }).reverse().map((d) => d.id) : [id];
  if (targets.length === 0) {
    if (options.json) printJson([]);
    else console.log(chalk.gray('\n  Nothing pending to approve.\n'));
    return [];
  }

  const approve = deps.loadExecutor
    ? await deps.loadExecutor().then((execute) => (id) => approveDraft(id, execute))
    : await (deps.loadApprover || loadApprover)();
  const results = [];
  for (const draftId of targets) {
    let draft;
    try {
      draft = await approve(draftId);
    } catch (error) {
      // A daily cap refusal stops here and leaves the rest pending.
      if (error.code !== 'ACTION_CAP_EXCEEDED') throw error;
      if (options.json) printJson({ stopped: error.message, approved: results });
      else console.log(`  ${chalk.yellow('⏸')} ${chalk.cyan(draftId)} ${chalk.yellow(error.message)} Still pending; approve it after ${error.resetAt}.`);
      process.exitCode = 1;
      return results;
    }
    results.push(draft);
    if (!options.json) {
      const mark = draft.status === 'executed' ? chalk.green('✓') : chalk.red('✗');
      const outcome = draft.status === 'executed' ? chalk.green('executed') : chalk.red(`failed: ${draft.error}`);
      console.log(`  ${mark} ${chalk.cyan(draft.id)} ${draft.tool} ${outcome}`);
    }
  }
  if (options.json) printJson(results);
  else {
    const failed = results.filter((d) => d.status === 'failed').length;
    console.log('');
    if (failed > 0) process.exitCode = 1;
  }
  return results;
}

/**
 * `drafts discard <id>`.
 * @param {string} id
 * @param {{json?: boolean}} options
 */
export function discardCommand(id, options = {}) {
  const removed = discardDraft(id);
  if (options.json) printJson(removed);
  else console.log(`  ${chalk.green('✓')} Discarded ${chalk.cyan(removed.id)} (${removed.tool}, was ${removed.status})`);
  return removed;
}

/**
 * `drafts clear`: drop every executed and failed draft, keep the pending ones.
 * @param {{json?: boolean}} options
 */
export function clearCommand(options = {}) {
  const removed = pruneDrafts();
  if (options.json) printJson({ removed, remaining: listDrafts({ status: 'pending' }).length });
  else console.log(`  ${chalk.green('✓')} Removed ${removed} finished draft${removed === 1 ? '' : 's'}; pending drafts kept.`);
  return removed;
}

/**
 * Run an action and turn a thrown error into a red line plus exit code 1,
 * or a JSON error object when `--json` was asked for.
 * @param {Function} fn
 * @returns {Function}
 */
function guarded(fn) {
  return async (...args) => {
    const options = args.find((a) => a && typeof a === 'object' && !Array.isArray(a) && 'json' in a) || {};
    try {
      await fn(...args);
    } catch (error) {
      if (options.json) printJson({ error: error.message });
      else console.error(chalk.red(`\n  ${error.message}\n`));
      process.exitCode = 1;
    }
  };
}

/**
 * Register `xactions drafts` and its sub-commands.
 * @param {import('commander').Command} program
 */
export function registerDraftsCommand(program) {
  const drafts = program
    .command('drafts')
    .description('Review, approve or discard MCP write calls held by approval mode');

  drafts
    .command('list')
    .description('List held drafts, newest first')
    .option('--status <status>', `Filter: ${DRAFT_STATUSES.join(', ')}`, 'all')
    .option('--json', 'Print the drafts as JSON')
    .action(guarded((options) => listCommand(options)));

  drafts
    .command('show <id>')
    .description('Show one draft with its full arguments and result')
    .option('--json', 'Print the draft as JSON')
    .action(guarded((id, options) => showCommand(id, options)));

  drafts
    .command('approve [id]')
    .description('Run a held draft exactly as the agent submitted it')
    .option('--all', 'Approve every pending draft, oldest first')
    .option('--json', 'Print the updated drafts as JSON')
    .action(guarded((id, options) => approveCommand(id, options)));

  drafts
    .command('discard <id>')
    .description('Delete a draft without running it')
    .option('--json', 'Print the removed draft as JSON')
    .action(guarded((id, options) => discardCommand(id, options)));

  drafts
    .command('clear')
    .description('Remove executed and failed drafts, keeping pending ones')
    .option('--json', 'Print the counts as JSON')
    .action(guarded((options) => clearCommand(options)));
}
