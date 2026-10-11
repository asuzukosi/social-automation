// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Reputation Scorer API Routes
 *
 * Risk-scores posts and rolls them into a shareable report. The same engine
 * as scripts/reputationAudit.js (browser) and `xactions reputation` (CLI).
 *
 * POST /api/ai/reputation/score — score a batch of posts, return the report
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import express from 'express';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const scoreLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Maximum 10 reputation scans per minute. Please wait.',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Score a batch of posts and return the aggregate report.
 * POST /api/ai/reputation/score
 *
 * Body: {
 *   posts: Array<{ id?, text, author?, authorName?, quotedText?, hasMedia?, isReply? }>,
 *   dimensions?: string[], customQuestion?: string,
 *   provider?, model?, apiKey?, baseUrl?, concurrency?
 * }
 */
router.post('/score', scoreLimiter, async (req, res) => {
  try {
    const { posts, dimensions, customQuestion, concurrency, ...llm } = req.body || {};

    if (!Array.isArray(posts) || posts.length === 0) {
      return res.status(400).json({ error: 'posts is required — a non-empty array of { text } objects' });
    }
    if (posts.length > 200) {
      return res.status(400).json({ error: 'Too many posts for one request (max 200). Split into batches.' });
    }
    const withoutText = posts.findIndex((p) => !p || typeof p.text !== 'string' || !p.text.trim());
    if (withoutText !== -1) {
      return res.status(400).json({ error: `posts[${withoutText}] is missing text` });
    }

    const { scorePosts, summarizeReport } = await import('../../../src/ai/reputationScorer.js');
    const config = { ...llm, dimensions, customQuestion, concurrency };
    const scores = await scorePosts(posts, config);
    const report = summarizeReport(posts, scores);

    res.json({
      success: true,
      data: { report, scores },
      operation: 'ai:reputation-score',
    });
  } catch (error) {
    const status = /needs an API key|Unknown LLM provider|needs baseUrl|no valid dimensions/.test(error.message) ? 400 : 500;
    res.status(status).json({
      error: 'Reputation scoring failed',
      message: error.message,
    });
  }
});

/**
 * The rubric this endpoint scores against, for a caller building its own UI.
 * GET /api/ai/reputation/dimensions
 */
router.get('/dimensions', async (req, res) => {
  const { DIMENSIONS, FLAG_THRESHOLD, REVIEW_THRESHOLD } = await import('../../../src/ai/reputationScorer.js');
  res.json({
    success: true,
    data: { dimensions: DIMENSIONS, flagThreshold: FLAG_THRESHOLD, reviewThreshold: REVIEW_THRESHOLD },
    operation: 'ai:reputation-dimensions',
  });
});

export default router;
