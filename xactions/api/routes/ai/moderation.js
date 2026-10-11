// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Moderation Endpoints
 *
 * Block bots, mass block/unblock/mute, remove followers,
 * shadowban check, manage muted words, verified-only replies.
 *
 * @module api/routes/ai/moderation
 */

import express from 'express';
import crypto from 'crypto';
import { queueFailure } from '../../utils/queueResponse.js';

const router = express.Router();

const generateOperationId = () =>
  `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;

/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const sessionCookie = req.body.sessionCookie || req.headers['x-session-cookie'];
  if (!sessionCookie) { res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' }); return null; }
  return sessionCookie;
};

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try { const { queueJob } = await import('../../services/jobQueue.js'); await queueJob({ id: operationId, type, config, status: 'queued' }); } catch (err) { return queueFailure(res, err); }
  return res.json({ success: true, operationId, status: 'queued', statusUrl: `/api/ai/action/status/${operationId}` });
};

/** POST /api/ai/moderation/block-bots */
router.post('/block-bots', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { threshold = 0.7, dryRun = false, limit = 100, delayMs = 2000 } = req.body;
  return queueOperation(res, generateOperationId(), 'blockBots', { session, threshold, dryRun, limit, delayMs });
});

/** POST /api/ai/moderation/mass-block */
router.post('/mass-block', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { usernames, delayMs = 2000, dryRun = false } = req.body;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'massBlock', { session, usernames, delayMs, dryRun });
});

/** POST /api/ai/moderation/mass-unblock */
router.post('/mass-unblock', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { usernames, delayMs = 2000, dryRun = false } = req.body;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'massUnblock', { session, usernames, delayMs, dryRun });
});

/** POST /api/ai/moderation/mass-unmute (no usernames: unmute every muted account, up to limit) */
router.post('/mass-unmute', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { usernames, delayMs = 2000, dryRun = false, limit = 500 } = req.body;
  return queueOperation(res, generateOperationId(), 'massUnmute', { session, usernames, delayMs, dryRun, limit });
});

/** POST /api/ai/moderation/mute-keywords (mutes the authors of recent posts containing the keywords) */
router.post('/mute-keywords', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { keywords, maxMutes = 50, scanLimit = 50, dryRun = false, delayMs = 2000 } = req.body;
  if (!keywords?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keywords array required' });
  return queueOperation(res, generateOperationId(), 'muteKeywords', { session, keywords, maxMutes, scanLimit, dryRun, delayMs });
});

/** POST /api/ai/moderation/muted-words (action: list | add | remove | clear) */
router.post('/muted-words', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { action = 'list', words, duration = 'forever', excludeFollowing = false } = req.body;
  if (!['list', 'add', 'remove', 'clear'].includes(action)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'action must be list, add, remove or clear' });
  if ((action === 'add' || action === 'remove') && !words?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'words array required' });
  return queueOperation(res, generateOperationId(), 'mutedWords', { session, action, words, duration, excludeFollowing });
});

/** POST /api/ai/moderation/remove-followers */
router.post('/remove-followers', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { usernames, delayMs = 3000, dryRun = false } = req.body;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'removeFollowers', { session, usernames, delayMs, dryRun });
});

/** POST /api/ai/moderation/report-spam */
router.post('/report-spam', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { usernames, delayMs = 8000 } = req.body;
  if (!usernames?.length) return res.status(400).json({ error: 'INVALID_INPUT', message: 'usernames array required' });
  return queueOperation(res, generateOperationId(), 'reportSpam', { session, usernames, delayMs });
});

/** POST /api/ai/moderation/shadowban-check */
router.post('/shadowban-check', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username required' });
  return queueOperation(res, generateOperationId(), 'shadowbanCheck', { session, username });
});

/** POST /api/ai/moderation/verified-only (applies to tweetIds, or to your latest `limit` posts) */
router.post('/verified-only', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { enabled = true, tweetIds, limit = 20, delayMs = 1500 } = req.body;
  return queueOperation(res, generateOperationId(), 'verifiedOnly', { session, enabled, tweetIds, limit, delayMs });
});

/** POST /api/ai/moderation/blocked-list */
router.post('/blocked-list', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { limit = 1000, cursor } = req.body;
  return queueOperation(res, generateOperationId(), 'blockedList', { session, limit, cursor });
});

/** POST /api/ai/moderation/muted-list */
router.post('/muted-list', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { limit = 1000, cursor } = req.body;
  return queueOperation(res, generateOperationId(), 'mutedList', { session, limit, cursor });
});

export default router;
