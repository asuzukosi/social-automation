// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions AI Module — Public API
 * 
 * Voice analysis + AI tweet generation.
 * The moat: scrape → analyze voice → generate in their style.
 * 
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

export { analyzeVoice, summarizeVoiceProfile, buildVoicePrompt } from './voiceAnalyzer.js';
export {
  generateTweet,
  generateThread,
  rewriteTweet,
  generateWeek,
  generateReply,
  analyzeCompetitorAndGenerate,
} from './tweetGenerator.js';

// Content Optimizer (09-J)
export { suggestHashtags, optimizeTweet, predictPerformance, generateVariations, analyzeVoice as analyzeContentVoice } from './contentOptimizer.js';

// Prompt-driven comment generator (shared by `xactions engage`, the API, and the extension bridge)
export {
  createCommentGenerator,
  chatCompletion,
  resolveProvider,
  buildSystemPrompt,
  buildUserPrompt,
  sanitizeComment,
  isGenericComment,
  GENERIC_OPENERS,
  PROVIDER_URLS,
  DEFAULT_MODELS,
} from './commentGenerator.js';

// Reputation scorer: risk-scores posts across configurable dimensions and
// rolls them into a shareable report (shared by scripts/reputationAudit.js,
// POST /api/ai/reputation/score, and `xactions reputation`)
export {
  DIMENSIONS,
  FLAG_THRESHOLD,
  REVIEW_THRESHOLD,
  resolveDimensions,
  buildRiskSystemPrompt,
  buildRiskUserPrompt,
  parseRiskResponse,
  scorePost,
  scorePosts,
  scoreToGrade,
  summarizeReport,
} from './reputationScorer.js';
