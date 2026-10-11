// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Personas Endpoints
 *
 * Create, manage, and run AI-powered posting personas.
 *
 * @module api/routes/ai/personas
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
 * POST /api/ai/personas/presets
 * List available persona presets/strategies
 */
router.post('/presets', async (req, res) => {
  return successResponse(res, {
    presets: [
      {
        id: 'thought-leader',
        name: 'Thought Leader',
        description: 'Build authority by sharing insights and engaging with industry conversations',
        activityPattern: { tweetsPerDay: '2-3', replyRatio: 0.4, retweetRatio: 0.2 },
        niche: 'any',
      },
      {
        id: 'growth-hacker',
        name: 'Growth Hacker',
        description: 'Maximize follower growth via high engagement and follow-back tactics',
        activityPattern: { tweetsPerDay: '5-8', replyRatio: 0.6, followsPerDay: '50-100' },
        niche: 'any',
      },
      {
        id: 'crypto-influencer',
        name: 'Crypto Influencer',
        description: 'Niche persona for crypto/web3 community engagement',
        activityPattern: { tweetsPerDay: '4-6', replyRatio: 0.5, topics: ['bitcoin', 'ethereum', 'defi', 'nft'] },
        niche: 'crypto',
      },
      {
        id: 'content-creator',
        name: 'Content Creator',
        description: 'Consistent content machine: threads, hot takes, and viral loops',
        activityPattern: { tweetsPerDay: '3-5', threadFrequency: 'daily', replyRatio: 0.3 },
        niche: 'any',
      },
      {
        id: 'b2b-lead-gen',
        name: 'B2B Lead Gen',
        description: 'Targeted engagement with decision-makers and company accounts',
        activityPattern: { tweetsPerDay: '2-3', dmSequence: true, targetRoles: ['founder', 'cto', 'cmo'] },
        niche: 'b2b',
      },
    ],
  });
});

/**
 * POST /api/ai/personas/create
 * Create a new persona
 */
router.post('/create', async (req, res) => {
  const {
    name, niche, strategy = 'thought-leader',
    model = 'gpt-4o-mini', systemPrompt,
    activityPattern, targetAudience,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'INVALID_INPUT', message: 'name is required' });
  if (!niche) return res.status(400).json({ error: 'INVALID_INPUT', message: 'niche is required (e.g. "AI", "crypto", "fitness")' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'personaCreate',
      config: {
        name, niche, strategy, model,
        systemPrompt: systemPrompt || null,
        activityPattern: activityPattern || null,
        targetAudience: targetAudience || null,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'persona-create',
      config: { name, niche, strategy, model },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/personas/list
 * List the personas this session has saved
 */
router.post('/list', async (req, res) => {
  try {
    const { ownerStore, ownerKeyForSession } = await import('../../services/processors/content.processors.js');
    const personas = await ownerStore.list(ownerKeyForSession(req.sessionCookie), 'personas');

    return successResponse(res, {
      personas: personas.map((p) => ({
        personaId: p.id,
        name: p.name,
        niche: p.nicheLabel,
        strategy: p.strategy?.preset,
        activityPattern: p.activityPattern?.preset,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        lastSessionAt: p.state?.lastSessionAt || null,
      })),
      count: personas.length,
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/personas/status
 * A saved persona and its running totals
 */
router.post('/status', async (req, res) => {
  const { personaId } = req.body;
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });

  try {
    const { ownerStore, ownerKeyForSession } = await import('../../services/processors/content.processors.js');
    const persona = await ownerStore.get(ownerKeyForSession(req.sessionCookie), 'personas', personaId);

    if (!persona) return res.status(404).json({ error: 'NOT_FOUND', message: 'Persona not found' });

    const { engagedPosts, followedUsers, ...totals } = persona.state || {};
    return successResponse(res, {
      personaId,
      name: persona.name,
      niche: persona.nicheLabel,
      strategy: persona.strategy?.preset,
      activityPattern: persona.activityPattern?.preset,
      totals: { ...totals, accountsFollowed: Object.keys(followedUsers || {}).length },
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/personas/edit
 * Edit a persona's settings
 */
router.post('/edit', async (req, res) => {
  const { personaId, updates } = req.body;
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });
  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'updates object is required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'personaEdit',
      config: { personaId, updates, sessionCookie: req.sessionCookie },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'persona-edit',
      personaId, fields: Object.keys(updates),
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/personas/delete
 * Delete a persona
 */
router.post('/delete', async (req, res) => {
  const { personaId } = req.body;
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'personaDelete',
      config: { personaId, sessionCookie: req.sessionCookie },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', personaId,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/personas/run
 * Run engagement sessions as a persona (1 to 5 sessions, paced like a person)
 */
router.post('/run', async (req, res) => {
  const { personaId, dryRun = false, sessions = 1 } = req.body;
  if (!personaId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'personaId is required' });

  const effectiveSessions = Math.min(Math.max(parseInt(sessions) || 1, 1), 5);

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'personaRun',
      config: {
        personaId, dryRun: !!dryRun, sessions: effectiveSessions,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'persona-run',
      personaId,
      config: { dryRun: !!dryRun, sessions: effectiveSessions },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 30000 },
    }, {
      note: dryRun
        ? 'Dry run: actions are planned and written, but nothing is posted, liked or followed'
        : `The persona will run ${effectiveSessions} session(s), with a rest between sessions`,
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

export default router;
