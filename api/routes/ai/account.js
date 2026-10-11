// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Account Endpoints
 *
 * Account backup, follower audits, delegate listing, identity verification
 * status, multi-account listing, join dates, sessions, connected apps and
 * profile QR codes.
 *
 * Not offered, because X does not let a session do them: requesting the data
 * archive (X asks for the password and a code it sends by email or SMS),
 * uploading an address book (only X's mobile apps sync contacts) and
 * appealing a suspension (a Help Center form outside the logged-in session).
 *
 * @module api/routes/ai/account
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

/** POST /api/ai/account/backup */
router.post('/backup', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { include = ['tweets', 'likes', 'bookmarks', 'followers'], format = 'json' } = req.body;
  return queueOperation(res, generateOperationId(), 'accountBackup', { session, include, format });
});

/** POST /api/ai/account/audit-followers */
router.post('/audit-followers', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { username, limit = 200, checkBots = true } = req.body;
  return queueOperation(res, generateOperationId(), 'auditFollowers', { session, username, limit, checkBots });
});

/**
 * POST /api/ai/account/delegate-access
 * Lists the members the account has delegated access to. Inviting or removing
 * a delegate is done on x.com, where the invitee must accept.
 */
router.post('/delegate-access', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { action = 'list' } = req.body;
  if (action !== 'list') return res.status(400).json({ success: false, error: 'UNSUPPORTED_ACTION', message: 'Only action "list" is supported. Invite or remove delegates at https://x.com/settings/delegate.' });
  return queueOperation(res, generateOperationId(), 'delegateAccess', { session, action });
});

/**
 * POST /api/ai/account/verify-identity
 * Reports whether the account has passed X ID verification. The verification
 * itself (a government ID and selfie check) can only be completed by the
 * account holder in X's own flow.
 */
router.post('/verify-identity', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'verifyIdentity', { session });
});

/** POST /api/ai/account/multi-account: lists the accounts signed in alongside this session. */
router.post('/multi-account', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { action = 'list' } = req.body;
  if (action !== 'list') return res.status(400).json({ success: false, error: 'UNSUPPORTED_ACTION', message: 'Only action "list" is supported.' });
  return queueOperation(res, generateOperationId(), 'multiAccount', { session, action });
});

/** POST /api/ai/account/join-date */
router.post('/join-date', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'INVALID_INPUT', message: 'username required' });
  return queueOperation(res, generateOperationId(), 'joinDate', { session, username });
});

/** POST /api/ai/account/login-history */
router.post('/login-history', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'loginHistory', { session });
});

/** POST /api/ai/account/connected-accounts */
router.post('/connected-accounts', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  return queueOperation(res, generateOperationId(), 'connectedAccounts', { session });
});

/** POST /api/ai/account/qr-code */
router.post('/qr-code', async (req, res) => {
  const session = requireSession(req, res); if (!session) return;
  const { username } = req.body;
  return queueOperation(res, generateOperationId(), 'qrCode', { session, username });
});

export default router;
