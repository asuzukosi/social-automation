// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * `xactions archive` - read the data export X hands you, without scraping.
 *
 * X ships an account's full history as a zip (Settings > Your account >
 * Download an archive of your data). The portability module already parses
 * it; this command puts that on the terminal: a summary report, an export
 * into the same JSON/CSV/Markdown/HTML layout `xactions export` produces, and
 * a migration to Bluesky or Mastodon straight from the zip.
 *
 * Progress is a spinner line that updates as sections are scanned. It goes
 * silent under `--json` when stdout is a pipe, so a script gets the data and
 * nothing else.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import chalk from 'chalk';
import path from 'node:path';

import { createSpinner, resolveOutputMode } from '../../utils/output.js';

/** Output formats `export --formats` accepts. */
export const ARCHIVE_FORMATS = ['json', 'csv', 'md', 'html'];

/** Platforms `migrate --to` accepts. */
export const MIGRATE_TARGETS = ['bluesky', 'mastodon'];

/**
 * Parse `--formats json,csv` into a validated list.
 * @param {string|undefined} raw
 * @returns {string[]}
 */
export function parseFormats(raw) {
  if (!raw) return [...ARCHIVE_FORMATS];
  const formats = String(raw)
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
  const unknown = formats.filter((f) => !ARCHIVE_FORMATS.includes(f));
  if (unknown.length > 0) {
    throw new Error(`Unknown format${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. Use any of ${ARCHIVE_FORMATS.join(', ')}.`);
  }
  if (formats.length === 0) throw new Error(`--formats needs at least one of ${ARCHIVE_FORMATS.join(', ')}.`);
  return [...new Set(formats)];
}

/**
 * Parse `--sections tweets,likes` into a validated list, or undefined for all.
 * @param {string|undefined} raw
 * @param {string[]} allSections
 * @returns {string[]|undefined}
 */
export function parseSections(raw, allSections) {
  if (!raw) return undefined;
  const sections = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = sections.filter((s) => !allSections.includes(s));
  if (unknown.length > 0) {
    throw new Error(`Unknown section${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}. Use any of ${allSections.join(', ')}.`);
  }
  return sections;
}

/**
 * Turn an importer progress event into one spinner line.
 * @param {{phase: string, file?: string, completed?: number, total?: number, records?: number}} event
 * @returns {string}
 */
export function progressLine(event) {
  if (event.phase === 'scan' && event.total) {
    return `Scanning ${event.completed}/${event.total} ${event.file || ''}`.trimEnd();
  }
  if (typeof event.records === 'number') {
    return `Parsed ${event.phase} (${event.records.toLocaleString('en-US')} records) from ${event.file}`;
  }
  if (typeof event.completed === 'number' && typeof event.total === 'number') {
    return `[${event.phase}] ${event.completed}/${event.total}`;
  }
  return `${event.phase} ${event.file || ''}`.trimEnd();
}

/**
 * Import an archive with a spinner tracking the scan.
 * @param {string} archivePath
 * @param {{sections?: string[], mode: object}} options
 * @returns {Promise<object>}
 */
async function importWithSpinner(archivePath, { sections, mode }) {
  const { importTwitterArchive } = await import('../../portability/index.js');
  const spinner = createSpinner(`Reading ${path.basename(archivePath)}`, mode);
  try {
    const archive = await importTwitterArchive(archivePath, {
      ...(sections ? { sections } : {}),
      onProgress: (event) => {
        spinner.text = progressLine(event);
      },
    });
    spinner.succeed(`Read ${path.basename(archivePath)} (${archive.format})`);
    return archive;
  } catch (error) {
    spinner.fail(`Could not read ${archivePath}`);
    throw error;
  }
}

/**
 * `archive summary <path>`.
 * @param {string} archivePath
 * @param {{json?: boolean, top?: string|number, sections?: string}} options
 * @param {object} mode resolved output mode
 * @returns {Promise<object>} the summary
 */
export async function summaryCommand(archivePath, options, mode) {
  const { summarizeArchive, formatArchiveReport, ALL_SECTIONS } = await import('../../portability/index.js');
  const sections = parseSections(options.sections, ALL_SECTIONS);
  const top = Math.max(1, Number.parseInt(options.top ?? 10, 10) || 10);
  const archive = await importWithSpinner(archivePath, { sections, mode });
  const summary = summarizeArchive(archive, { top });
  if (mode.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('');
    for (const line of formatArchiveReport(summary).split('\n')) console.log(`  ${line}`);
    console.log('');
    console.log(chalk.gray(`  Export it with \`xactions archive export ${archivePath} --out <dir>\`.\n`));
  }
  return summary;
}

/**
 * `archive export <path> --out <dir>`.
 * @param {string} archivePath
 * @param {{out?: string, formats?: string, sections?: string, json?: boolean}} options
 * @param {object} mode resolved output mode
 * @returns {Promise<{dir: string, files: string[], counts: object}>}
 */
export async function exportCommand(archivePath, options, mode) {
  const { exportArchive, ALL_SECTIONS } = await import('../../portability/index.js');
  const formats = parseFormats(options.formats);
  const sections = parseSections(options.sections, ALL_SECTIONS);
  const archive = await importWithSpinner(archivePath, { sections, mode });

  const spinner = createSpinner(`Writing ${formats.join(', ')}`, mode);
  let written;
  try {
    written = await exportArchive(archive, { outputDir: options.out, formats });
  } catch (error) {
    spinner.fail('Export failed');
    throw error;
  }
  spinner.succeed(`Wrote ${written.files.length} file${written.files.length === 1 ? '' : 's'} to ${written.dir}`);

  if (mode.json) {
    console.log(JSON.stringify(written, null, 2));
  } else {
    console.log('');
    for (const [section, count] of Object.entries(written.counts || {})) {
      console.log(`  ${chalk.bold(section.padEnd(12))} ${count.toLocaleString('en-US')}`);
    }
    if (formats.includes('html')) {
      console.log(chalk.gray(`\n  Open ${path.join(written.dir, 'index.html')} in a browser to browse it.`));
    }
    console.log(chalk.gray(`  Compare against a live export with \`xactions diff <dirA> ${written.dir}\`.\n`));
  }
  return written;
}

/**
 * `archive migrate <path> --to <platform>`.
 * @param {string} archivePath
 * @param {object} options
 * @param {object} mode resolved output mode
 * @returns {Promise<object>} the migration summary
 */
export async function migrateCommand(archivePath, options, mode) {
  const platform = String(options.to || '').toLowerCase();
  if (!MIGRATE_TARGETS.includes(platform)) {
    throw new Error(`--to must be ${MIGRATE_TARGETS.join(' or ')}.`);
  }
  const dryRun = !options.execute;
  if (!dryRun) {
    if (platform === 'bluesky' && !(options.handle && options.password)) {
      throw new Error('A live Bluesky migration needs --handle and --password (an app password from Settings > App Passwords).');
    }
    if (platform === 'mastodon' && !options.token) {
      throw new Error('A live Mastodon migration needs --token (an access token with write scope), and --instance if not mastodon.social.');
    }
  }

  const { migrate, ARCHIVE_SOURCE } = await import('../../portability/index.js');
  const outDir = options.out || path.join(process.cwd(), 'exports', `${path.basename(archivePath).replace(/\.zip$/i, '')}_migration`);
  const spinner = createSpinner(`${dryRun ? 'Previewing' : 'Running'} migration to ${platform}`, mode);
  let summary;
  try {
    summary = await migrate({
      platform,
      source: ARCHIVE_SOURCE,
      archivePath,
      exportDir: outDir,
      dryRun,
      credentials: {
        handle: options.handle,
        password: options.password,
        instanceUrl: options.instance,
        accessToken: options.token,
      },
      onProgress: (event) => {
        spinner.text = progressLine(event);
      },
    });
  } catch (error) {
    spinner.fail('Migration failed');
    throw error;
  }
  spinner.succeed(`Migration ${dryRun ? 'preview' : 'run'} complete`);

  if (mode.json) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }
  console.log(`\n  Platform: ${chalk.cyan(platform)}`);
  console.log(`  Mode:     ${dryRun ? chalk.yellow('DRY RUN') : chalk.green('EXECUTE')}`);
  console.log(`  Tweets:   ${summary.tweets.migrated}/${summary.tweets.total} ${dryRun ? 'ready' : 'posted'}`);
  console.log(`  Follows:  ${summary.follows.matched}/${summary.follows.total} ${dryRun ? 'matchable' : 'followed'}`);
  console.log(`  Staged:   ${outDir}`);
  if (summary.actions?.length > 0) {
    console.log(`\n  ${chalk.gray('Sample actions:')}`);
    for (const action of summary.actions.slice(0, 5)) {
      console.log(`    ${action.type}: ${action.content?.slice(0, 60) || action.twitterUser || ''} [${action.status}]`);
    }
    if (summary.actions.length > 5) console.log(`    ... and ${summary.actions.length - 5} more`);
  }
  if (dryRun) console.log(`\n  ${chalk.yellow('This was a dry run. Add --execute and your credentials to perform it.')}`);
  console.log('');
  return summary;
}

/**
 * Wrap an action so a thrown error becomes a red line (or a JSON error) and
 * exit code 1, never a stack trace.
 * @param {import('commander').Command} program
 * @param {(archivePath: string, options: object, mode: object) => Promise<unknown>} fn
 */
function guarded(program, fn) {
  return async (archivePath, options) => {
    const mode = resolveOutputMode(program, options);
    try {
      await fn(archivePath, options, mode);
    } catch (error) {
      if (mode.json) console.log(JSON.stringify({ error: error.message }, null, 2));
      else console.error(chalk.red(`\n  ${error.message}\n`));
      process.exitCode = 1;
    }
  };
}

/**
 * Register `xactions archive` and its sub-commands.
 * @param {import('commander').Command} program
 */
export function registerArchiveCommand(program) {
  const archive = program
    .command('archive')
    .description('Read the X data export zip: summary, export to files, migrate elsewhere');

  archive
    .command('summary <zip-or-folder>')
    .description('Counts, date range, busiest year, top hashtags and mentions')
    .option('--top <n>', 'How many hashtags and mentions to list', '10')
    .option('--sections <list>', 'Only read these sections, e.g. tweets,likes (faster on a big archive)')
    .option('--json', 'Print the summary as JSON')
    .action(guarded(program, summaryCommand));

  archive
    .command('export <zip-or-folder>')
    .description('Write the archive as JSON, CSV, Markdown and an HTML viewer')
    .requiredOption('--out <dir>', 'Directory to write into')
    .option('--formats <list>', `Comma-separated subset of ${ARCHIVE_FORMATS.join(',')}`, ARCHIVE_FORMATS.join(','))
    .option('--sections <list>', 'Only read these sections, e.g. tweets,likes')
    .option('--json', 'Print the written files and counts as JSON')
    .action(guarded(program, exportCommand));

  archive
    .command('migrate <zip-or-folder>')
    .description('Migrate the archive to Bluesky or Mastodon (dry run unless --execute)')
    .requiredOption('--to <platform>', `Target: ${MIGRATE_TARGETS.join(' or ')}`)
    .option('--execute', 'Actually post and follow; without it the run is a preview')
    .option('--out <dir>', 'Where the staged tweets.json and following.json are written')
    .option('--handle <handle>', 'Bluesky handle (with --execute)')
    .option('--password <password>', 'Bluesky app password (with --execute)')
    .option('--instance <url>', 'Mastodon instance URL', 'https://mastodon.social')
    .option('--token <token>', 'Mastodon access token (with --execute)')
    .option('--json', 'Print the migration summary as JSON')
    .action(guarded(program, migrateCommand));
}
