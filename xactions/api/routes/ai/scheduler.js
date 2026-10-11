// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Scheduler / RSS Endpoints
 *
 * Schedule posts, manage RSS feeds, find evergreen content.
 *
 * @module api/routes/ai/scheduler
 */

import express from 'express';
import crypto from 'crypto';
import { validate as validateCron } from 'node-cron';
import { ownerKeyForSession } from '../../services/processors/context.js';

const router = express.Router();

const generateOperationId = () =>
  `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;

const INTERVAL_UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** '15m', '2h', '1d' to milliseconds, between 15 minutes and 7 days; else null. */
export function parseInterval(value) {
  const match = String(value).trim().match(/^(\d+)\s*([mhd])$/i);
  if (!match) return null;
  const ms = Number(match[1]) * INTERVAL_UNITS[match[2].toLowerCase()];
  return ms >= 15 * 60_000 && ms <= 7 * 86_400_000 ? ms : null;
}

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

/** Whether a string is an IANA time zone this runtime knows. */
const isTimeZone = (zone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** A logged-in X client for the session the caller sent. */
async function xClientFor(sessionCookie) {
  const { sessionCookieHeader } = await import('../../services/xSession.js');
  const { TwitterHttpClient } = await import('../../../src/scrapers/twitter/http/client.js');
  return new TwitterHttpClient({ cookies: await sessionCookieHeader(sessionCookie), rateLimitStrategy: 'error' });
}

/** Answer a failed call to X with its own status when it carries one. */
const xFailure = (res, error) =>
  errorResponse(res, error.status && error.status < 600 ? error.status : 502, error.code || error.name || 'X_REQUEST_FAILED', error.message, {
    retryable: error.retryable !== false && error.name !== 'XSessionError',
  });

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
 * POST /api/ai/schedule/add
 * Add a scheduled post (cron or datetime)
 */
router.post('/add', async (req, res) => {
  const { text, scheduledAt, cron, timezone = 'UTC', repeat = false } = req.body;

  if (!text) return res.status(400).json({ error: 'INVALID_INPUT', message: 'text is required' });
  if (!scheduledAt && !cron) return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduledAt or cron is required' });
  if (repeat) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Recurring posts are not available: X refuses a post identical to a recent one, so the same text cannot be posted on a schedule. Send scheduledAt, or a cron expression for its next run.',
    });
  }
  if (cron && !validateCron(cron)) return res.status(400).json({ error: 'INVALID_INPUT', message: `Invalid cron expression "${cron}"` });
  if (!isTimeZone(timezone)) return res.status(400).json({ error: 'INVALID_INPUT', message: `Unknown time zone "${timezone}"` });

  if (scheduledAt) {
    const date = new Date(scheduledAt);
    if (isNaN(date.getTime()) || date <= new Date()) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduledAt must be a valid future datetime' });
    }
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'scheduleAdd',
      config: {
        text,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        cron: cron || null,
        timezone, repeat: !!repeat,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'schedule-add',
      config: { scheduledAt, cron, repeat: !!repeat },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/schedule/list
 * List the account's scheduled posts, read from X's own scheduler
 */
router.post('/list', async (req, res) => {
  const { status = 'pending', limit = 50 } = req.body;
  const states = { pending: ['scheduled'], failed: ['failed'] };
  if (status !== 'all' && !states[status]) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'status must be pending, failed or all' });
  }

  try {
    const { listScheduledPosts } = await import('../../services/processors/posting.processors.js');
    const scheduled = await listScheduledPosts(await xClientFor(req.sessionCookie));
    const filtered = scheduled
      .filter((p) => status === 'all' || states[status].includes(String(p.state || 'scheduled').toLowerCase()))
      .slice(0, Math.min(Math.max(parseInt(limit) || 50, 1), 200));

    return successResponse(res, {
      scheduled: filtered.map((p) => ({ ...p, text: p.text.slice(0, 280) })),
      count: filtered.length,
      total: scheduled.length,
    });
  } catch (error) {
    return xFailure(res, error);
  }
});

/**
 * POST /api/ai/schedule/remove
 * Cancel a scheduled post on X. Accepts X's scheduleId (from /list) or the
 * operationId an /add call returned.
 */
router.post('/remove', async (req, res) => {
  const { scheduleId } = req.body;
  if (!scheduleId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'scheduleId is required' });

  try {
    const { deleteScheduledPost } = await import('../../services/processors/posting.processors.js');
    let xId = String(scheduleId);
    if (!/^\d+$/.test(xId)) {
      const { getRecentJobs, cancelJob } = await import('../../services/jobQueue.js');
      const job = (await getRecentJobs({ sessionCookie: req.sessionCookie, limit: 500 })).find((j) => j.id === xId);
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: `No scheduled post or operation ${xId} for this session` });
      if (!job.result?.scheduledTweetId) {
        await cancelJob(xId);
        return successResponse(res, { scheduleId: xId, status: 'removed', removedAt: new Date().toISOString(), note: 'The operation had not reached X yet and was cancelled.' });
      }
      xId = job.result.scheduledTweetId;
    }
    await deleteScheduledPost(await xClientFor(req.sessionCookie), xId);
    return successResponse(res, { scheduleId: xId, status: 'removed', removedAt: new Date().toISOString() });
  } catch (error) {
    return xFailure(res, error);
  }
});

/**
 * POST /api/ai/schedule/rss-add
 * Add an RSS feed for auto-posting
 */
router.post('/rss-add', async (req, res) => {
  const { url, postTemplate, interval = '1h', maxPerDay = 5, autoCheck = true } = req.body;

  if (!url) return res.status(400).json({ error: 'INVALID_INPUT', message: 'url is required' });
  const everyMs = parseInterval(interval);
  if (autoCheck && !everyMs) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'interval must be like 15m, 2h or 1d, between 15 minutes and 7 days' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'rssAdd',
      config: {
        url, postTemplate: postTemplate || '{{title}} {{url}}',
        interval, maxPerDay: Math.min(parseInt(maxPerDay) || 5, 20),
        autoCheckEvery: autoCheck ? everyMs : null,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });
    if (autoCheck) {
      // The session stays with the repeating check until rss-remove stops it:
      // posting new items later means acting as the caller later.
      await queueJob({
        id: `${operationId}-auto`,
        type: 'rssCheck',
        config: { feedId: operationId, sessionCookie: req.sessionCookie },
        repeat: { every: everyMs },
        source: 'ai-api',
      });
    }

    return successResponse(res, {
      operationId, feedId: operationId, status: 'queued', type: 'rss-add',
      config: { url, interval, maxPerDay, autoCheck: !!autoCheck },
      stop: autoCheck ? { endpoint: '/api/ai/schedule/rss-remove', body: { feedId: operationId } } : null,
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 3000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/schedule/rss-check
 * Manually check RSS feed for new items
 */
router.post('/rss-check', async (req, res) => {
  const { feedId, url } = req.body;

  if (!feedId && !url) return res.status(400).json({ error: 'INVALID_INPUT', message: 'feedId or url is required' });

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'rssCheck',
      config: { feedId: feedId || null, url: url || null, sessionCookie: req.sessionCookie },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'rss-check',
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 5000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/schedule/rss-drafts
 * Get draft posts from RSS feed items
 */
router.post('/rss-drafts', async (req, res) => {
  const { feedId, limit = 10 } = req.body;
  if (!feedId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'feedId is required' });

  try {
    const { feedDrafts } = await import('../../services/processors/posting.processors.js');
    const drafts = await feedDrafts(ownerKeyForSession(req.sessionCookie), feedId, {
      limit: Math.min(parseInt(limit) || 10, 50),
    });
    if (!drafts) return errorResponse(res, 404, 'FEED_NOT_FOUND', `No saved feed ${feedId} for this session`);
    return successResponse(res, drafts);
  } catch (error) {
    return errorResponse(res, 502, 'FEED_UNREADABLE', error.message);
  }
});

/**
 * POST /api/ai/schedule/rss-remove
 * Stop checking a saved feed and delete it
 */
router.post('/rss-remove', async (req, res) => {
  const { feedId } = req.body;
  if (!feedId) return res.status(400).json({ error: 'INVALID_INPUT', message: 'feedId is required' });

  try {
    const { removeFeed } = await import('../../services/processors/posting.processors.js');
    const removed = await removeFeed(ownerKeyForSession(req.sessionCookie), feedId);
    if (!removed) return errorResponse(res, 404, 'FEED_NOT_FOUND', `No saved feed ${feedId} for this session`);
    // Only reached for the caller's own feed, so this never stops another caller's checks.
    const { removeRepeatingJob } = await import('../../services/jobQueue.js');
    const stopped = await removeRepeatingJob(`${feedId}-auto`);
    return successResponse(res, { feedId, removed: true, automaticChecksStopped: stopped });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/schedule/evergreen
 * Find evergreen (timeless) tweets to re-share
 */
router.post('/evergreen', async (req, res) => {
  const { username, minLikes = 50, minAgeDays = 30, limit = 10 } = req.body;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const effectiveLimit = Math.min(Math.max(parseInt(limit) || 10, 1), 30);

  try {
    const startTime = Date.now();
    const { scrapeTweets } = await import('../../services/browserAutomation.js');
    const tweets = await scrapeTweets(req.sessionCookie, cleanUsername, { limit: 200 });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (parseInt(minAgeDays) || 30));

    const evergreen = (tweets.items || [])
      .filter(t => {
        const ts = t.timestamp || t.createdAt;
        if (!ts) return false;
        const tweetDate = new Date(ts);
        return tweetDate < cutoffDate && (parseInt(t.likes) || 0) >= (parseInt(minLikes) || 50);
      })
      .sort((a, b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0))
      .slice(0, effectiveLimit)
      .map(t => ({
        id: t.id,
        text: t.text,
        createdAt: t.timestamp || t.createdAt,
        url: t.url,
        likes: parseInt(t.likes) || 0,
        retweets: parseInt(t.retweets) || 0,
      }));

    return successResponse(res, {
      username: cleanUsername, minLikes, minAgeDays,
      evergreenTweets: evergreen,
      count: evergreen.length,
    }, { durationMs: Date.now() - startTime });
  } catch (error) {
    return errorResponse(res, 500, 'ANALYSIS_FAILED', error.message);
  }
});

export default router;
