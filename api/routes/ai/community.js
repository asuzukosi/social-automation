// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Community Endpoints
 *
 * Join, leave, create, and manage X/Twitter Communities.
 *
 * @module api/routes/ai/community
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
  if (!sessionCookie) {
    res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' });
    return null;
  }
  return sessionCookie;
};

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try { const { queueJob } = await import('../../services/jobQueue.js'); await queueJob({ id: operationId, type, config, status: 'queued' }); } catch (err) { return queueFailure(res, err); }
  return res.json({ success: true, operationId, status: 'queued', statusUrl: `/api/ai/action/status/${operationId}` });
};

/** Actions POST /manage accepts (see communityManage in api/services/processors/community.processors.js). */
const MANAGE_ACTIONS = ['view', 'info', 'invite', 'promote', 'make-moderator', 'add-moderator', 'demote', 'remove-moderator'];

/** POST /api/ai/community/join */
router.post('/join', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { communityId, keyword } = req.body;
  if (!communityId && !keyword) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId or keyword required' });
  return queueOperation(res, generateOperationId(), 'communityJoin', { session, communityId, keyword });
});

/** POST /api/ai/community/leave */
router.post('/leave', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { communityId } = req.body;
  if (!communityId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId required' });
  return queueOperation(res, generateOperationId(), 'communityLeave', { session, communityId });
});

/** POST /api/ai/community/leave-all */
router.post('/leave-all', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'communityLeaveAll', { session });
});

/** POST /api/ai/community/create */
router.post('/create', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { name, description, rules } = req.body;
  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: 'name required' });
  return queueOperation(res, generateOperationId(), 'communityCreate', { session, name, description, rules });
});

/** POST /api/ai/community/manage */
router.post('/manage', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { communityId, action = 'view', targetUsername } = req.body;
  if (!communityId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId required' });
  if (!MANAGE_ACTIONS.includes(action)) return res.status(400).json({ error: 'INVALID_INPUT', message: `action must be one of ${MANAGE_ACTIONS.join(', ')}` });
  if (!['view', 'info'].includes(action) && !targetUsername) return res.status(400).json({ error: 'INVALID_INPUT', message: `targetUsername required for ${action}` });
  return queueOperation(res, generateOperationId(), 'communityManage', { session, communityId, action, targetUsername });
});

/** POST /api/ai/community/notes */
router.post('/notes', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { tweetId, action = 'view' } = req.body;
  if (!tweetId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetId required' });
  if (!['view', 'request'].includes(action)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'action must be view or request' });
  return queueOperation(res, generateOperationId(), 'communityNotes', { session, tweetId, action });
});

/** POST /api/ai/community/list */
router.post('/list', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'communityList', { session });
});

/** POST /api/ai/community/members */
router.post('/members', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { communityId, limit = 100 } = req.body;
  if (!communityId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'communityId required' });
  return queueOperation(res, generateOperationId(), 'communityMembers', { session, communityId, limit });
});

/** POST /api/ai/community/search */
router.post('/search', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { query, limit = 20 } = req.body;
  if (!query) return res.status(400).json({ error: 'INVALID_INPUT', message: 'query required' });
  return queueOperation(res, generateOperationId(), 'communitySearch', { session, query, limit });
});

export default router;
