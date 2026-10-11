// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Monitoring Endpoints
 * 
 * Track account changes, follower movements, and alerts.
 * Supports comparing snapshots over time to detect changes.
 * 
 * @module api/routes/ai/monitor
 */

import express from 'express';
import crypto from 'crypto';
import { createJobContext } from '../../services/processors/context.js';
import messagingProcessors, {
  handleMonitorAction,
  sessionOwnerKey,
  snapshots,
} from '../../services/processors/messaging.processors.js';

const router = express.Router();

/**
 * Generate unique operation ID
 */
const generateOperationId = () => {
  return `ai-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
};

/**
 * Helper: Create consistent error response
 */
const errorResponse = (res, statusCode, error, message, extras = {}) => {
  return res.status(statusCode).json({
    success: false,
    error,
    message,
    retryable: extras.retryable ?? true,
    retryAfterMs: extras.retryAfterMs ?? 5000,
    timestamp: new Date().toISOString(),
    ...extras,
  });
};

// Require session cookie for monitoring. Snapshots and monitors belong to the
// session that made them, so reading them needs the same session (a GET sends
// it as the X-Session-Cookie header).
router.use(async (req, res, next) => {
  const sessionCookie = req.body?.sessionCookie || req.headers['x-session-cookie'];
  
  if (!sessionCookie) {
    return res.status(400).json({
      error: 'SESSION_REQUIRED',
      code: 'E_SESSION_MISSING',
      message: 'X/Twitter session cookie is required for monitoring',
      docs: 'https://xactions.app/docs/ai-api#authentication',
    });
  }
  
  req.sessionCookie = sessionCookie;
  req.ownerKey = sessionOwnerKey(sessionCookie);
  next();
});

/** How to manage a monitor from the route that started it. */
const manageLinks = (endpoint, idField, id) => ({
  status: { method: 'POST', endpoint, body: { action: 'status', [idField]: id } },
  stop: { method: 'POST', endpoint, body: { action: 'stop', [idField]: id } },
  pause: { method: 'POST', endpoint, body: { action: 'pause', [idField]: id } },
  resume: { method: 'POST', endpoint, body: { action: 'resume', [idField]: id } },
});

/**
 * POST /api/ai/monitor/account
 * Create or update account monitoring snapshot
 */
router.post('/account', async (req, res) => {
  const { username, includeFollowers = true, includeFollowing = true, includeStats = true } = req.body;
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
      schema: {
        username: { type: 'string', required: true },
        includeFollowers: { type: 'boolean', default: true, description: 'Scrape full followers list' },
        includeFollowing: { type: 'boolean', default: true, description: 'Scrape full following list' },
        includeStats: { type: 'boolean', default: true, description: 'Include profile stats' },
      },
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  
  try {
    const operationId = generateOperationId();
    
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'monitorAccount',
      config: {
        username: cleanUsername,
        includeFollowers: !!includeFollowers,
        includeFollowing: !!includeFollowing,
        includeStats: !!includeStats,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: {
        operationId,
        status: 'queued',
        type: 'monitor-account',
        username: cleanUsername,
        config: {
          includeFollowers,
          includeFollowing,
          includeStats,
        },
        polling: {
          endpoint: `/api/ai/action/status/${operationId}`,
          recommendedIntervalMs: 10000,
        },
      },
      meta: {
        createdAt: new Date().toISOString(),
        note: 'Creates a snapshot that can be compared with future snapshots',
      },
    });
  } catch (error) {
    console.error('❌ Monitor account error:', error);
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }
});

/**
 * POST /api/ai/monitor/followers
 * Monitor follower changes for an account
 */
router.post('/followers', async (req, res) => {
  const { username, compareWithPrevious = true } = req.body;
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  
  try {
    const operationId = generateOperationId();
    
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'monitorFollowers',
      config: {
        username: cleanUsername,
        compareWithPrevious: !!compareWithPrevious,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: {
        operationId,
        status: 'queued',
        type: 'monitor-followers',
        username: cleanUsername,
        polling: {
          endpoint: `/api/ai/action/status/${operationId}`,
          recommendedIntervalMs: 10000,
        },
      },
      meta: {
        createdAt: new Date().toISOString(),
        note: compareWithPrevious 
          ? 'Will compare with previous snapshot to show gained/lost followers'
          : 'Will create new baseline snapshot',
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }
});

/**
 * POST /api/ai/monitor/following
 * Monitor following changes for an account
 */
router.post('/following', async (req, res) => {
  const { username, compareWithPrevious = true } = req.body;
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  
  try {
    const operationId = generateOperationId();
    
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'monitorFollowing',
      config: {
        username: cleanUsername,
        compareWithPrevious: !!compareWithPrevious,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });
    
    res.json({
      success: true,
      data: {
        operationId,
        status: 'queued',
        type: 'monitor-following',
        username: cleanUsername,
        polling: {
          endpoint: `/api/ai/action/status/${operationId}`,
          recommendedIntervalMs: 10000,
        },
      },
      meta: {
        createdAt: new Date().toISOString(),
        note: compareWithPrevious
          ? 'Will compare with previous snapshot to show new follows/unfollows'
          : 'Will create new baseline snapshot',
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }
});

/**
 * GET /api/ai/monitor/snapshot/:username
 * The latest snapshot this session took of a username (monitor/account first,
 * then monitor/followers or monitor/following).
 */
router.get('/snapshot/:username', async (req, res) => {
  const cleanUsername = req.params.username.replace(/^@/, '').toLowerCase();

  try {
    const candidates = await Promise.all(
      ['account', 'followers', 'following'].map((kind) => snapshots.latest(req.ownerKey, kind, cleanUsername)),
    );
    const snapshot = candidates.find(Boolean);

    if (!snapshot) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        code: 'E_NO_SNAPSHOT',
        message: `No monitoring snapshot of @${cleanUsername} was taken with this session`,
        hint: 'Create a snapshot first using POST /api/ai/monitor/account',
      });
    }

    res.json({
      success: true,
      data: {
        username: cleanUsername,
        snapshot: {
          id: snapshot.id,
          kind: snapshot.kind,
          createdAt: snapshot.createdAt,
          profile: snapshot.profile || null,
          stats: snapshot.stats || null,
          followerCount: snapshot.stats?.followers ?? snapshot.followers?.total ?? null,
          followingCount: snapshot.stats?.following ?? snapshot.following?.total ?? null,
          followers: snapshot.followers ? snapshot.followers.entries.map(([, handle]) => handle) : null,
          following: snapshot.following ? snapshot.following.entries.map(([, handle]) => handle) : null,
          followersComplete: snapshot.followers?.complete ?? null,
          followingComplete: snapshot.following?.complete ?? null,
        },
      },
      meta: {
        queriedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'SNAPSHOT_FAILED', error.message);
  }
});

/**
 * POST /api/ai/monitor/compare
 * Compare two snapshots: the latest two of a username, or two by id
 */
router.post('/compare', async (req, res) => {
  const { username, snapshotId1, snapshotId2, kind = 'account' } = req.body;
  
  if (!username && (!snapshotId1 || !snapshotId2)) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'Either username (to compare latest with previous) or both snapshotId1 and snapshotId2 are required',
      schema: {
        username: { type: 'string', description: 'Compare latest with previous for this user' },
        kind: { type: 'string', enum: ['account', 'followers', 'following'], default: 'account' },
        snapshotId1: { type: 'string', description: 'First snapshot ID (older)' },
        snapshotId2: { type: 'string', description: 'Second snapshot ID (newer)' },
      },
    });
  }
  if (!['account', 'followers', 'following'].includes(kind)) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'kind must be account, followers or following' });
  }
  
  try {
    let older;
    let newer;
    if (snapshotId1 && snapshotId2) {
      [older, newer] = await Promise.all([snapshots.find(req.ownerKey, snapshotId1), snapshots.find(req.ownerKey, snapshotId2)]);
    } else {
      [newer, older] = await snapshots.history(req.ownerKey, kind, username.replace(/^@/, '').toLowerCase(), 2);
    }
    
    if (!older || !newer) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Two snapshots taken with this session are needed. Take another with POST /api/ai/monitor/account (or /followers, /following).',
      });
    }
    if (older.kind !== newer.kind || older.username !== newer.username) {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'Both snapshots must be of the same account and kind' });
    }
    if (older.createdAt > newer.createdAt) [older, newer] = [newer, older];

    const followers = older.followers && newer.followers ? snapshots.diffList(older.followers, newer.followers) : null;
    const following = older.following && newer.following ? snapshots.diffList(older.following, newer.following) : null;
    const profile = older.kind === 'account' ? snapshots.diffAccount(older, newer).profile : [];
    const ms = Date.parse(newer.createdAt) - Date.parse(older.createdAt);
    const count = (snap, list) => snap.stats?.[list] ?? snap[list]?.total ?? null;

    res.json({
      success: true,
      data: {
        username: newer.username,
        kind: newer.kind,
        comparison: {
          from: { snapshotId: older.id, createdAt: older.createdAt, followerCount: count(older, 'followers'), followingCount: count(older, 'following') },
          to: { snapshotId: newer.id, createdAt: newer.createdAt, followerCount: count(newer, 'followers'), followingCount: count(newer, 'following') },
          changes: {
            profile,
            followers: followers && {
              gained: followers.gained,
              lost: followers.lost,
              lossesKnown: followers.lossesKnown,
              netChange: followers.netChange,
            },
            following: following && {
              added: following.gained,
              removed: following.lost,
              removalsKnown: following.lossesKnown,
              netChange: following.netChange,
            },
          },
          timeBetween: {
            ms,
            human: ms >= 86_400_000 ? `${Math.round(ms / 86_400_000)} days` : ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)} hours` : `${Math.round(ms / 60_000)} minutes`,
          },
        },
      },
      meta: {
        comparedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'COMPARE_FAILED', error.message);
  }
});

/**
 * POST /api/ai/alert/new-followers
 * New and lost followers since this session's last check, answered inline
 */
// Also reachable as /new-followers, which is what /api/ai/alert/new-followers
// resolves to once index.js mounts this router at /alert. Without the alias the
// backward-compatible path that mount exists to serve was
// /api/ai/alert/alert/new-followers, which nothing was ever told to call.
router.post(['/alert/new-followers', '/new-followers'], async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      code: 'E_MISSING_USERNAME',
      message: 'username is required',
    });
  }
  
  const cleanUsername = username.replace(/^@/, '').toLowerCase();
  const startTime = Date.now();
  const ctx = createJobContext({
    id: generateOperationId(),
    name: 'monitorFollowers',
    data: {
      type: 'monitorFollowers',
      sessionHash: req.ownerKey.slice('session:'.length),
      config: { username: cleanUsername, compareWithPrevious: true, limit: 200, sessionCookie: req.sessionCookie },
    },
  });
  
  try {
    const result = await messagingProcessors.monitorFollowers.run(ctx);
    const gained = result.gained || [];
    const lost = result.lost || [];
    res.json({
      success: true,
      data: {
        username: cleanUsername,
        newFollowers: {
          count: gained.length,
          users: gained.slice(0, 100),
        },
        lostFollowers: {
          count: lost.length,
          usernames: lost.map((u) => u.username),
          known: result.lossesKnown ?? false,
        },
        currentFollowerCount: result.total,
        previousCheck: result.previousSnapshot ? {
          at: result.previousSnapshot.createdAt,
          followerCount: result.previousSnapshot.total,
        } : null,
        isFirstCheck: result.isBaseline,
      },
      meta: {
        scrapedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        note: result.isBaseline ? 'First check - baseline saved for future comparisons' : null,
      },
    });
  } catch (error) {
    if (error.name === 'JobInputError' || error.name === 'XSessionError') {
      return errorResponse(res, error.status || 400, 'INVALID_INPUT', error.message, { retryable: false });
    }
    console.error('❌ New followers alert error:', error);
    return errorResponse(res, 500, 'ALERT_FAILED', error.message);
  } finally {
    await ctx.dispose();
  }
});

/**
 * DELETE /api/ai/monitor/snapshot/:username
 * Delete this session's snapshots of a username
 */
router.delete('/snapshot/:username', async (req, res) => {
  const cleanUsername = req.params.username.replace(/^@/, '').toLowerCase();
  
  try {
    const deleted = await snapshots.remove(req.ownerKey, cleanUsername);
    
    res.json({
      success: true,
      data: {
        username: cleanUsername,
        deletedCount: deleted,
      },
      meta: {
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'DELETE_FAILED', error.message);
  }
});

/**
 * GET /api/ai/monitor/list
 * Accounts this session has snapshots of
 */
router.get('/list', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  
  try {
    const accounts = (await snapshots.accounts(req.ownerKey)).slice(0, limit);
    
    res.json({
      success: true,
      data: {
        accounts: accounts.map(a => ({
          username: a.username,
          lastSnapshot: a.lastSnapshotAt,
          snapshotCount: a.snapshotCount,
          latestFollowerCount: a.latestFollowerCount,
          latestFollowingCount: a.latestFollowingCount,
          kinds: a.kinds,
        })),
        count: accounts.length,
      },
      meta: {
        queriedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'LIST_FAILED', error.message);
  }
});

/**
 * POST /api/ai/monitor/keyword
 * Start monitoring a keyword for new posts, or (with action) list, read,
 * pause, resume or stop a keyword monitor
 */
router.post('/keyword', async (req, res) => {
  const { keyword, interval = '15m' } = req.body;

  try {
    if (await handleMonitorAction(req, res, { type: 'monitorKeyword', session: req.sessionCookie })) return;
    if (req.body.action && req.body.action !== 'start') {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'action must be start, list, status, pause, resume or stop' });
    }
    if (!keyword) return res.status(400).json({ error: 'INVALID_INPUT', message: 'keyword is required' });

    const { queueJob } = await import('../../services/jobQueue.js');
    const operationId = generateOperationId();
    await queueJob({
      id: operationId,
      type: 'monitorKeyword',
      config: { keyword, interval, sessionCookie: req.sessionCookie },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      data: {
        monitorId: operationId, status: 'started', keyword, interval,
        polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 60000 },
        manage: manageLinks('/api/ai/monitor/keyword', 'monitorId', operationId),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }
});

/**
 * POST /api/ai/monitor/follower-alerts
 * Get notifications when an account gains or loses followers, or (with
 * action) list, read, pause, resume or stop an alert
 */
router.post('/follower-alerts', async (req, res) => {
  const { username, webhookUrl } = req.body;

  try {
    if (await handleMonitorAction(req, res, { type: 'followerAlerts', idField: 'alertId', session: req.sessionCookie })) return;
    if (req.body.action && req.body.action !== 'start') {
      return res.status(400).json({ error: 'INVALID_INPUT', message: 'action must be start, list, status, pause, resume or stop' });
    }
    if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username is required' });

    const { queueJob } = await import('../../services/jobQueue.js');
    const operationId = generateOperationId();
    await queueJob({
      id: operationId,
      type: 'followerAlerts',
      config: {
        username: username.replace(/^@/, '').toLowerCase(),
        webhookUrl: webhookUrl || null,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      data: {
        alertId: operationId, status: 'started',
        username: username.replace(/^@/, '').toLowerCase(),
        polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 300000 },
        manage: manageLinks('/api/ai/monitor/follower-alerts', 'alertId', operationId),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }
});

/**
 * POST /api/ai/monitor/track-engagement
 * Track engagement on specific tweets over time, or (with action) list,
 * read, pause, resume or stop a tracker
 */
router.post('/track-engagement', async (req, res) => {
  const { tweetIds, tweetUrls, interval = '1h', duration = '24h' } = req.body;

  try {
    if (await handleMonitorAction(req, res, { type: 'trackEngagement', session: req.sessionCookie })) return;
  } catch (error) {
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }

  const urls = tweetUrls || [];
  const ids = tweetIds || [];
  const allIds = [
    ...ids,
    ...urls.map(u => { const m = u.match(/status\/(\d+)/); return m ? m[1] : null; }).filter(Boolean),
  ];

  if (allIds.length === 0) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'tweetIds or tweetUrls are required' });
  }

  try {
    const operationId = generateOperationId();
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'trackEngagement',
      config: {
        tweetIds: allIds.slice(0, 20),
        interval, duration,
        sessionCookie: req.sessionCookie,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      data: {
        operationId, monitorId: operationId, status: 'queued', type: 'track-engagement',
        config: { tweetCount: Math.min(allIds.length, 20), interval, duration },
        polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 60000 },
        manage: manageLinks('/api/ai/monitor/track-engagement', 'monitorId', operationId),
      },
    });
  } catch (error) {
    return errorResponse(res, 500, 'MONITOR_FAILED', error.message);
  }
});

export default router;
