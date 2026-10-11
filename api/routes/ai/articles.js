// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Articles & Longform Endpoints
 *
 * @module api/routes/ai/articles
 */

import express from 'express';
import crypto from 'crypto';
import { queueFailure } from '../../utils/queueResponse.js';

const router = express.Router();

const generateOperationId = () => `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
/** @param {import('express').Request} req @param {import('express').Response} res @returns {string | null} */
const requireSession = (req, res) => {
  const s = req.body.sessionCookie || req.headers['x-session-cookie'];
  if (!s) { res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' }); return null; }
  return s;
};
/** @param {import('express').Response} res @param {string} id @param {string} type @param {Record<string, unknown>} config */
const queueOp = async (res, id, type, config) => {
  try { const { queueJob } = await import('../../services/jobQueue.js'); await queueJob({ id, type, config, status: 'queued' }); } catch (err) { return queueFailure(res, err); }
  return res.json({ success: true, operationId: id, status: 'queued', statusUrl: `/api/ai/action/status/${id}` });
};

/** POST /api/ai/articles/compose */
router.post('/compose', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'articleCompose', { ...req.body, session: s }); });
/** POST /api/ai/articles/publish */
router.post('/publish', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'articlePublish', { ...req.body, session: s }); });
/** POST /api/ai/articles/analytics */
router.post('/analytics', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'articleAnalytics', { ...req.body, session: s }); });
/** POST /api/ai/articles/list */
router.post('/list', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'articleList', { session: s }); });
/** POST /api/ai/articles/draft */
router.post('/draft', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'articleDraft', { ...req.body, session: s }); });

export default router;
