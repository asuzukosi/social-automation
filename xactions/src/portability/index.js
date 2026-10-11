// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Account Portability
 * Barrel exports for the portability module.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

export { exportAccount } from './exporter.js';
export { generateArchiveHTML } from './archive-viewer.js';
export { migrate, migrateToBluesky, migrateToMastodon, findMatch, similarity } from './importer.js';
export { diffExports, generateReport, diffAndReport } from './differ.js';
export {
  importTwitterArchive,
  exportArchive,
  summarizeArchive,
  formatArchiveReport,
  openArchiveMedia,
  parseArchiveFile,
  normaliseTweet,
  ARCHIVE_SOURCE,
  ARCHIVE_SECTIONS,
  ALL_SECTIONS,
} from './twitter-archive.js';
