// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Teams Endpoints
 *
 * Create and manage team accounts for multi-user collaboration.
 *
 * @module api/routes/ai/teams
 */

import express from 'express';
import crypto from 'crypto';

const router = express.Router();

const generateOperationId = () =>
  `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;

const errorResponse = (res, statusCode, error, message, extras = {}) =>
  res.status(statusCode).json({
    success: false, error, message,
    retryable: extras.retryable ?? true,
    retryAfterMs: extras.retryAfterMs ?? 5000,
    timestamp: new Date().toISOString(),
    ...extras,
  });

const successResponse = (res, data, meta = {}) =>
  res.json({ success: true, data, meta: { processedAt: new Date().toISOString(), ...meta } });

// Session middleware
router.use((req, res, next) => {
  const sessionCookie = req.body.sessionCookie || req.headers['x-session-cookie'];
  if (!sessionCookie) {
    return res.status(400).json({ error: 'SESSION_REQUIRED', message: 'Session cookie is required' });
  }
  req.sessionCookie = sessionCookie;
  next();
});

/**
 * POST /api/ai/teams/create
 * Create a team
 */
router.post('/create', async (req, res) => {
  const { name, description, members = [] } = req.body;

  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: 'name is required' });
  if (!Array.isArray(members)) return res.status(400).json({ error: 'INVALID_INPUT', message: 'members must be an array of X usernames' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'teamCreate',
      config: {
        name, description: description || null,
        members: members.slice(0, 20),
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'team-create',
      config: { name, memberCount: members.length },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/teams/members
 * Get members of a team this session created
 */
router.post('/members', async (req, res) => {
  const { teamId } = req.body;
  if (!teamId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'teamId is required' });

  try {
    const { ownerStore, ownerKeyForSession } = await import('../../services/processors/content.processors.js');
    const team = await ownerStore.get(ownerKeyForSession(req.sessionCookie), 'teams', teamId);

    if (!team) return res.status(404).json({ error: 'NOT_FOUND', message: 'Team not found' });

    return successResponse(res, {
      teamId,
      name: team.name,
      description: team.description,
      members: team.members,
      notFound: team.notFound,
      createdAt: team.createdAt,
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

export default router;
