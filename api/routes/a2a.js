// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Agent-to-Agent (A2A) Task Delegation Routes
 *
 * Allows external AI agents to discover XActions skills and submit tasks
 * using the A2A protocol task envelope format.
 *
 * Routes:
 *   GET  /api/a2a/skills  — list all registered skills (free, no payment)
 *   POST /api/a2a/task    — submit a task as your XActions account (Bearer
 *                           token); it runs with the X session you saved, or
 *                           the sessionCookie in input
 *
 * @author nichxbt
 */

import { Router } from 'express';
import { errorResponse } from '../utils/errorResponse.js';
import { authMiddleware } from '../middleware/auth.js';
import { PublicUrlError, assertPublicUrl } from '../utils/publicUrl.js';

const router = Router();

/**
 * GET /api/a2a/skills
 * Returns the XActions skill registry for agent discovery.
 * Free — no x402 payment required.
 */
router.get('/skills', async (req, res) => {
  try {
    const { getAllSkills } = await import('../../src/a2a/skillRegistry.js');
    const skills = getAllSkills();
    return res.json({
      success: true,
      data: {
        agent: 'XActions',
        version: '2.0.0',
        skills,
        count: skills.length,
        taskEndpoint: '/api/a2a/task',
        docs: 'https://xactions.app/docs/a2a',
      },
    });
  } catch (err) {
    return errorResponse(res, 503, 'SKILLS_UNAVAILABLE', err.message, { retryable: true });
  }
});

/**
 * POST /api/a2a/task
 * Accept an A2A task envelope and route it to the Bull job queue.
 *
 * Body (A2A Task Envelope):
 *   id          {string}  optional  Client-supplied idempotency key
 *   skill       {string}  required  A2A skill ID (e.g. 'xactions.x_unfollow_non_followers')
 *   input       {object}  required  Skill input parameters (sessionCookie, config, …)
 *   callbackUrl {string}  optional  Webhook URL — result is POSTed here on completion
 *   contextId   {string}  optional  Conversation/thread ID for multi-step workflows
 */
// Tasks act as an account, so they need one: anonymous tasks would run every
// paid skill for free, outside the x402 gate.
router.post('/task', authMiddleware, async (req, res) => {
  const { id, skill, input, callbackUrl, contextId } = req.body;

  if (!skill) {
    return errorResponse(res, 400, 'INVALID_INPUT', 'skill is required', { retryable: false });
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return errorResponse(res, 400, 'INVALID_INPUT', 'input must be a plain object', { retryable: false });
  }
  if (callbackUrl) {
    try {
      await assertPublicUrl(callbackUrl, 'callbackUrl');
    } catch (err) {
      if (err instanceof PublicUrlError) return errorResponse(res, 400, 'INVALID_INPUT', err.message, { retryable: false });
      throw err;
    }
  }

  try {
    const { getAllSkills } = await import('../../src/a2a/skillRegistry.js');
    const skills = getAllSkills();
    const skillDef = skills.find(s => s.id === skill || s.name === skill);

    if (!skillDef) {
      return errorResponse(res, 404, 'SKILL_NOT_FOUND', `Skill "${skill}" is not registered`, {
        retryable: false,
        availableSkills: skills.map(s => s.id || s.name),
        hint: 'GET /api/a2a/skills for a full list',
      });
    }

    const jobType = skillToJobType(skill);
    const { addJob } = await import('../services/jobQueue.js');

    const { jobId } = await addJob(jobType, {
      userId: req.user.id,
      config: { ...input, callbackUrl: callbackUrl || null },
      a2aTaskId: id || null,
      a2aSkill: skill,
      contextId: contextId || null,
      source: 'a2a',
    });

    return res.status(202).json({
      success: true,
      data: {
        taskId: jobId,
        a2aTaskId: id || null,
        skill,
        status: 'queued',
        polling: {
          endpoint: `/api/ai/action/status/${jobId}`,
          recommendedIntervalMs: 5000,
        },
        streaming: {
          event: 'job:join',
          room: jobId,
          description: 'Emit job:join with the taskId over WebSocket for live progress',
        },
      },
      meta: { createdAt: new Date().toISOString() },
    });
  } catch (err) {
    // A skill with no processor is a 501 and a refused URL a 400; only the rest are ours.
    if (err.status >= 400 && err.status < 600) {
      return errorResponse(res, err.status, err.code || 'TASK_FAILED', err.message, { retryable: false });
    }
    console.error('❌ A2A task error:', err);
    return errorResponse(res, 500, 'TASK_FAILED', err.message);
  }
});

/**
 * Map an A2A skill ID to a Bull job type name.
 * Convention: 'xactions.x_unfollow_non_followers' → 'unfollowNonFollowers'
 */
function skillToJobType(skillId) {
  const raw = skillId
    .replace(/^xactions\.x_/, '')   // strip 'xactions.x_' prefix
    .replace(/^x_/, '');            // strip plain 'x_' prefix
  return raw.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export default router;
