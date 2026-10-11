// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Datasets API Routes
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { Router } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Datasets are the server's own local scrape output, owned by no single user,
// so only the operator reads, exports or deletes them.
router.use(authMiddleware, requireAdmin);

/** 400 for a name the store refuses, 500 for anything else. */
function fail(res, error) {
  return res.status(error.status === 400 ? 400 : 500).json({ error: error.message });
}

// GET /api/datasets — list all datasets
router.get('/', async (req, res) => {
  try {
    const { listDatasets } = await import('../../src/scraping/paginationEngine.js');
    const datasets = await listDatasets();
    res.json({ datasets });
  } catch (error) {
    fail(res, error);
  }
});

// GET /api/datasets/:name — get items from a dataset
router.get('/:name', async (req, res) => {
  try {
    const { DatasetStore } = await import('../../src/scraping/paginationEngine.js');
    const ds = new DatasetStore(req.params.name);
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 100;
    const data = await ds.getData({ offset, limit });
    res.json(data);
  } catch (error) {
    fail(res, error);
  }
});

// GET /api/datasets/:name/export — export dataset
router.get('/:name/export', async (req, res) => {
  try {
    const { DatasetStore } = await import('../../src/scraping/paginationEngine.js');
    const ds = new DatasetStore(req.params.name);
    const format = req.query.format || 'json';
    const data = await ds.export(format);
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${ds.name}.csv"`);
    }
    res.send(data);
  } catch (error) {
    fail(res, error);
  }
});

// DELETE /api/datasets/:name — delete a dataset
router.delete('/:name', async (req, res) => {
  try {
    const { DatasetStore } = await import('../../src/scraping/paginationEngine.js');
    const ds = new DatasetStore(req.params.name);
    await ds.delete();
    res.json({ status: 'deleted', name: req.params.name });
  } catch (error) {
    fail(res, error);
  }
});

export default router;

// by nichxbt
