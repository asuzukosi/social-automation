// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Notifications API Routes
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Notification channels are the owner's own Slack, Discord, Telegram and
// email hooks, so reading or firing them needs the same authentication as
// /api/crm and /api/automations.
// These routes drive the server's single, operator-wide instance (not
// per-user state), so they are for the operator: any signed-in user could
// once read or change them.
router.use(authMiddleware, requireAdmin);

// GET /api/notifications
// Documented in api/openapi.js and, until now, never served. Reports the
// channels that are switched on and the most recent signed webhook
// deliveries, so a dashboard can show notification state without sending one.
router.get('/', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = await getNotifier();
    const channels = Object.entries(notifier.config || {}).map(([name, config]) => ({
      name,
      enabled: Boolean(config?.enabled),
    }));

    let deliveries = [];
    try {
      const { listDeliveries } = await import('../../src/notifications/webhook.js');
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      deliveries = listDeliveries({ status: req.query.status || 'all', limit });
    } catch {
      // The webhook delivery log is optional: no log yet means no deliveries.
    }

    res.json({
      channels,
      enabled: channels.filter((c) => c.enabled).map((c) => c.name),
      deliveries,
      count: deliveries.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/send
router.post('/send', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = await getNotifier();
    const { title, message, severity } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const result = await notifier.send({ title, message, severity });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/test/:channel
router.post('/test/:channel', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = await getNotifier();
    const result = await notifier.test(req.params.channel);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/configure
router.post('/configure', async (req, res) => {
  try {
    const { getNotifier } = await import('../../src/notifications/notifier.js');
    const notifier = await getNotifier();
    const result = notifier.configure(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

// by nichxbt
