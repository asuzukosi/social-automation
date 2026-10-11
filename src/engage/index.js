// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions engagement sweeps - public API.
 *
 * The engine behind `xactions engage` and the `x_engage_profile` MCP tool:
 * walk a profile, a search, or a list and like, repost, and reply to what is
 * on it, with replies from templates or from an LLM given a brief.
 *
 * @example
 * import { Scraper } from 'xactions/client';
 * import { resolveSource, collectTweets, runEngage } from 'xactions/engage';
 * import { createCommentGenerator } from 'xactions/ai';
 *
 * const scraper = new Scraper();
 * await scraper.loadCookies('~/.xactions/cookies.json');
 *
 * const source = resolveSource({ username: 'nasa' });
 * const filters = { actions: { like: true, repost: false, comment: true } };
 * const { selected } = await collectTweets(scraper, source, filters, 10);
 *
 * const report = await runEngage({
 *   scraper,
 *   source,
 *   tweets: selected,
 *   actions: filters.actions,
 *   generator: createCommentGenerator({ prompt: 'curious engineer, one question' }),
 *   dryRun: true,
 * });
 * console.log(report.processed, report.commented);
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

export {
  SOURCE_KINDS,
  resolveSource,
  readSource,
  collectTweets,
  selectTweets,
  parseTemplates,
  pickTemplate,
  nextDelay,
  isRateLimit,
  runEngage,
  slug,
} from './runner.js';

export { createEngageState, statePath } from './state.js';
