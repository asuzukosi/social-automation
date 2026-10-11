// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Webhooks Endpoints
 *
 * Register URLs that receive the events your monitors produce (new followers,
 * keyword matches, mentions, stream items, engagement samples, reputation
 * alerts). Every delivery is signed with the secret returned at creation.
 * Webhooks belong to the X session that created them, so every call sends
 * that session as sessionCookie or the X-Session-Cookie header.
 *
 * @module api/routes/ai/webhooks
 */

import express from 'express';
import crypto from 'crypto';
import { queueFailure } from '../../utils/queueResponse.js';
import { WEBHOOK_EVENTS, sessionOwnerKey, webhooks } from '../../services/processors/messaging.processors.js';

const router = express.Router();

const generateOperationId = () => `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
/** @param {import('express').Response} res @param {string} id @param {string} type @param {Record<string, unknown>} config */
const queueOp = async (res, id, type, config) => {
  try { const { queueJob } = await import('../../services/jobQueue.js'); await queueJob({ id, type, config, status: 'queued' }); } catch (err) { return queueFailure(res, err); }
  return res.json({ success: true, operationId: id, status: 'queued', statusUrl: `/api/ai/action/status/${id}` });
};

// Webhooks are stored per session, so every endpoint but the event list needs one.
router.use((req, res, next) => {
  if (req.path === '/events') return next();
  const sessionCookie = req.body?.sessionCookie || req.headers['x-session-cookie'];
  if (!sessionCookie) {
    return res.status(400).json({
      error: 'SESSION_REQUIRED',
      message: 'Webhooks belong to the X session that creates them: send it as sessionCookie or the X-Session-Cookie header.',
    });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/** POST /api/ai/webhooks/create */
router.post('/create', async (req, res) => {
  const { url, events } = req.body;
  if (!url) return res.status(400).json({ error: 'INVALID_INPUT', message: 'url required' });
  return queueOp(res, generateOperationId(), 'webhookCreate', { url, events, sessionCookie: req.sessionCookie });
});

/** POST /api/ai/webhooks/list */
router.post('/list', async (req, res) => {
  try {
    const list = await webhooks.list(sessionOwnerKey(req.sessionCookie));
    return res.json({ success: true, data: { webhooks: list, count: list.length } });
  } catch (err) {
    return res.status(503).json({ success: false, error: 'STORE_UNAVAILABLE', message: `Could not read webhooks: ${err.message}` });
  }
});

/** POST /api/ai/webhooks/delete */
router.post('/delete', async (req, res) => {
  const { webhookId } = req.body;
  if (!webhookId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'webhookId required' });
  return queueOp(res, generateOperationId(), 'webhookDelete', { webhookId, sessionCookie: req.sessionCookie });
});

/** POST /api/ai/webhooks/test */
router.post('/test', async (req, res) => {
  const { webhookId } = req.body;
  if (!webhookId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'webhookId required' });
  return queueOp(res, generateOperationId(), 'webhookTest', { webhookId, sessionCookie: req.sessionCookie });
});

/** POST /api/ai/webhooks/events */
router.post('/events', async (req, res) => {
  return res.json({ success: true, data: { events: [...WEBHOOK_EVENTS] } });
});

export default router;
