// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Ads & Business Endpoints
 *
 * Ad campaigns, dashboard, media studio and ads analytics, read from
 * ads.x.com and studio.x.com as the caller's session. Boosting a post is not
 * offered: it spends money through the ad account's payment method, a
 * checkout X confirms with the account holder.
 *
 * @module api/routes/ai/ads
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
  if (!sessionCookie) { res.status(400).json({ success: false, error: 'SESSION_REQUIRED', message: 'Provide sessionCookie in body or X-Session-Cookie header' }); return null; }
  return sessionCookie;
};

/** @param {import('express').Response} res @param {string} operationId @param {string} type @param {Record<string, unknown>} config */
const queueOperation = async (res, operationId, type, config) => {
  try { const { queueJob } = await import('../../services/jobQueue.js'); await queueJob({ id: operationId, type, config, status: 'queued' }); } catch (err) { return queueFailure(res, err); }
  return res.json({ success: true, operationId, status: 'queued', statusUrl: `/api/ai/action/status/${operationId}` });
};

/** POST /api/ai/ads/campaigns */
router.post('/campaigns', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { action = 'list' } = req.body;
  return queueOperation(res, generateOperationId(), 'adsCampaigns', { session, action });
});

/** POST /api/ai/ads/dashboard */
router.post('/dashboard', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'adsDashboard', { session });
});

/** POST /api/ai/ads/media-studio */
router.post('/media-studio', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { action = 'list' } = req.body;
  return queueOperation(res, generateOperationId(), 'adsMediaStudio', { session, action });
});

/** POST /api/ai/ads/analytics */
router.post('/analytics', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { campaignId, dateRange } = req.body;
  return queueOperation(res, generateOperationId(), 'adsAnalytics', { session, campaignId, dateRange });
});

export default router;
