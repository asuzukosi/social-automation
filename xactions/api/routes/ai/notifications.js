// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AI Push Notification Endpoints
 *
 * Send and test webhook/push notifications.
 *
 * @module api/routes/ai/notifications
 */

import express from 'express';
import crypto from 'crypto';
import { assertPublicUrl } from '../../services/processors/messaging.processors.js';

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

// No session required for notification endpoints — webhook URL is the auth
router.use((req, res, next) => next());

/**
 * POST /api/ai/notify/send
 * Send a push notification / webhook
 */
router.post('/send', async (req, res) => {
  const { webhookUrl, event, data, channel = 'webhook' } = req.body;
  const schema = {
    webhookUrl: { type: 'string', description: 'HTTPS endpoint: your webhook, or a Slack or Discord incoming-webhook URL' },
    event: { type: 'string', description: 'Event name (e.g., new_follower, mention)' },
    data: { type: 'object', description: 'Payload to send. For slack and discord, data.message and data.title set the text.' },
    channel: { type: 'string', enum: ['webhook', 'slack', 'discord'], default: 'webhook' },
  };

  if (!['webhook', 'slack', 'discord'].includes(channel)) {
    return res.status(400).json({
      error: 'INVALID_INPUT',
      message: 'channel must be webhook, slack or discord. Email is not offered here: it needs an SMTP server and a recipient this endpoint has no way to take.',
      schema,
    });
  }
  if (!webhookUrl) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: `webhookUrl is required for ${channel} notifications`, schema });
  }

  const operationId = generateOperationId();

  try {
    const { queueJob } = await import('../../services/jobQueue.js');
    await queueJob({
      id: operationId,
      type: 'sendNotification',
      config: {
        webhookUrl: webhookUrl || null,
        event: event || 'xactions.notification',
        data: data || {},
        channel,
      },
      source: 'ai-api',
      createdAt: new Date().toISOString(),
    });

    return successResponse(res, {
      operationId, status: 'queued', type: 'send-notification',
      config: { channel, event },
      polling: { endpoint: `/api/ai/action/status/${operationId}`, recommendedIntervalMs: 2000 },
    });
  } catch (error) {
    return errorResponse(res, 500, 'ACTION_FAILED', error.message);
  }
});

/**
 * POST /api/ai/notify/test
 * Send a test notification to verify webhook
 */
router.post('/test', async (req, res) => {
  const { webhookUrl } = req.body;

  if (!webhookUrl) {
    return res.status(400).json({ error: 'INVALID_INPUT', message: 'webhookUrl is required' });
  }

  try {
    await assertPublicUrl(webhookUrl, 'webhookUrl');
  } catch (error) {
    return errorResponse(res, 400, 'INVALID_INPUT', error.message, { retryable: false });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-XActions-Event': 'test', 'User-Agent': 'XActions/1.0' },
      body: JSON.stringify({
        event: 'xactions.test',
        message: 'XActions webhook test — if you see this, the connection works! ✅',
        timestamp: new Date().toISOString(),
        source: 'xactions-ai-api',
      }),
      signal: AbortSignal.timeout(10000),
      // A redirect could lead anywhere, including hosts the check above refused.
      redirect: 'manual',
    });

    return successResponse(res, {
      webhookUrl,
      status: response.ok ? 'success' : 'failed',
      responseStatus: response.status,
      responseStatusText: response.statusText,
    });
  } catch (error) {
    return errorResponse(res, 400, 'WEBHOOK_UNREACHABLE',
      `Could not reach webhook: ${error.message}`, { retryable: false });
  }
});

export default router;
