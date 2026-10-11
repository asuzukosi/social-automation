// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Automation Endpoints
 *
 * Advanced automation: auto-reply, auto-repost, plug replies,
 * engagement boosting, content repurposing, customer service bots.
 *
 * continuous-monitor and keyword-monitor start monitors that keep running
 * after their job completes; the same endpoints take `action` (list, status,
 * pause, resume, stop) to read and control them.
 *
 * @module api/routes/ai/automation
 */

import express from 'express';
import crypto from 'crypto';
import { queueFailure } from '../../utils/queueResponse.js';
import { handleMonitorAction } from '../../services/processors/messaging.processors.js';

const router = express.Router();

const generateOperationId = () =>
  `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;

/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const sessionCookie = req.body.sessionCookie || req.headers['x-session-cookie'];
  if (!sessionCookie) {
    res.status(400).json({
      success: false,
      error: 'SESSION_REQUIRED',
      message: 'Provide sessionCookie in body or X-Session-Cookie header',
    });
    return null;
  }
  return sessionCookie;
};

/** @param {import('express').Response} res @param {string} message */
const invalid = (res, message) => res.status(400).json({ error: 'INVALID_INPUT', message });

const hasList = (value) => (Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0);

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try {
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({ id: operationId, type, config, status: 'queued' });
  } catch (err) {
    return queueFailure(res, err);
  }
  return res.json({
    success: true,
    operationId,
    status: 'queued',
    statusUrl: `/api/ai/action/status/${operationId}`,
    message: `Operation ${type} queued`,
  });
};

/**
 * Answer a monitor control action on a monitor route. Returns true when a
 * response was sent.
 */
const monitorAction = async (req, res, type, session) => {
  if (!req.body.action || req.body.action === 'start') return false;
  try {
    if (await handleMonitorAction(req, res, { type, session })) return true;
  } catch (err) {
    res.status(503).json({ success: false, error: 'STORE_UNAVAILABLE', message: `Could not read monitors: ${err.message}` });
    return true;
  }
  invalid(res, 'action must be start, list, status, pause, resume or stop');
  return true;
};

/** POST /api/ai/automation/auto-reply */
router.post('/auto-reply', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { keywords, replyTemplate, limit = 50, delayMs = 2000 } = req.body;
  if (!hasList(keywords) || !replyTemplate) return invalid(res, 'keywords and replyTemplate required');
  return queueOperation(res, generateOperationId(), 'autoReply', { session, keywords, replyTemplate, limit, delayMs });
});

/** POST /api/ai/automation/auto-repost */
router.post('/auto-repost', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { keywords, limit = 20, delayMs = 3000 } = req.body;
  if (!hasList(keywords)) return invalid(res, 'keywords required');
  return queueOperation(res, generateOperationId(), 'autoRepost', { session, keywords, limit, delayMs });
});

/** POST /api/ai/automation/plug-replies */
router.post('/plug-replies', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { tweetUrl, plugText, minLikes = 100 } = req.body;
  if (!plugText) return invalid(res, 'plugText required');
  return queueOperation(res, generateOperationId(), 'plugReplies', { session, tweetUrl, plugText, minLikes });
});

/** POST /api/ai/automation/engagement-booster */
router.post('/engagement-booster', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { targetAccounts, actionsPerDay = 50, delayMs = 3000 } = req.body;
  if (!hasList(targetAccounts)) return invalid(res, 'targetAccounts required');
  return queueOperation(res, generateOperationId(), 'engagementBooster', { session, targetAccounts, actionsPerDay, delayMs });
});

/** POST /api/ai/automation/quote-tweet-auto */
router.post('/quote-tweet-auto', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { keywords, commentTemplate, limit = 10 } = req.body;
  if (!hasList(keywords) || !commentTemplate) return invalid(res, 'keywords and commentTemplate required');
  return queueOperation(res, generateOperationId(), 'quoteTweetAuto', { session, keywords, commentTemplate, limit });
});

/** POST /api/ai/automation/content-repurpose */
router.post('/content-repurpose', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { tweetIds, format = 'thread' } = req.body;
  if (!hasList(tweetIds)) return invalid(res, 'tweetIds required');
  return queueOperation(res, generateOperationId(), 'contentRepurpose', { session, tweetIds, format });
});

/** POST /api/ai/automation/content-calendar */
router.post('/content-calendar', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { niche, tweetsPerDay = 3, days = 7 } = req.body;
  if (!niche) return invalid(res, 'niche required');
  return queueOperation(res, generateOperationId(), 'contentCalendar', { session, niche, tweetsPerDay, days });
});

/** POST /api/ai/automation/welcome-followers */
router.post('/welcome-followers', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { messageTemplate, delayMs = 5000 } = req.body;
  if (!messageTemplate) return invalid(res, 'messageTemplate required');
  return queueOperation(res, generateOperationId(), 'welcomeFollowers', { session, messageTemplate, delayMs });
});

/** POST /api/ai/automation/continuous-monitor (action: start, list, status, pause, resume, stop) */
router.post('/continuous-monitor', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (await monitorAction(req, res, 'continuousMonitor', session)) return;
  const { username, intervalMs = 300000, webhookUrl } = req.body;
  return queueOperation(res, generateOperationId(), 'continuousMonitor', { session, username, intervalMs, webhookUrl });
});

/** POST /api/ai/automation/keyword-monitor (action: start, list, status, pause, resume, stop) */
router.post('/keyword-monitor', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  if (await monitorAction(req, res, 'keywordMonitor', session)) return;
  const { keywords, webhookUrl, intervalMs = 60000 } = req.body;
  if (!hasList(keywords)) return invalid(res, 'keywords required');
  return queueOperation(res, generateOperationId(), 'keywordMonitor', { session, keywords, webhookUrl, intervalMs });
});

/** POST /api/ai/automation/customer-service */
router.post('/customer-service', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { triggerKeywords, responseTemplates, delayMs = 2000 } = req.body;
  if (!hasList(triggerKeywords) || !responseTemplates) return invalid(res, 'triggerKeywords and responseTemplates required');
  return queueOperation(res, generateOperationId(), 'customerService', { session, triggerKeywords, responseTemplates, delayMs });
});

/** POST /api/ai/automation/evergreen */
router.post('/evergreen', async (req, res) => {
  const session = requireSession(req, res);
  if (!session) return;
  const { minAge = 30, minEngagement = 10, limit = 20 } = req.body;
  return queueOperation(res, generateOperationId(), 'evergreenRecycle', { session, minAge, minEngagement, limit });
});

export default router;
