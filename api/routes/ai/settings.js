// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Settings & Privacy Endpoints
 *
 * Requesting the data archive is not offered: X asks for the account password
 * and a code it sends by email or SMS before it builds one.
 *
 * @module api/routes/ai/settings
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

/** POST /api/ai/settings/get */
router.post('/get', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsGet', { session: s }); });
/** POST /api/ai/settings/update */
router.post('/update', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsUpdate', { ...req.body, session: s }); });
/** POST /api/ai/settings/protected */
router.post('/protected', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsProtected', { ...req.body, session: s }); });
/** POST /api/ai/settings/blocked */
router.post('/blocked', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsBlocked', { session: s }); });
/** POST /api/ai/settings/muted */
router.post('/muted', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsMuted', { session: s }); });
/** POST /api/ai/settings/advanced */
router.post('/advanced', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsAdvanced', { ...req.body, session: s }); });
/** POST /api/ai/settings/block-list */
router.post('/block-list', async (req, res) => { const s = requireSession(req, res); if (!s) return; return queueOp(res, generateOperationId(), 'settingsBlockList', { ...req.body, session: s }); });

export default router;
