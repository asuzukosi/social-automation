#!/usr/bin/env node
// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Whole-site feature audit for xactions.app.
 *
 * Drives a real Chromium through every route the site publishes and every API
 * endpoint the dashboard calls, then reports what is actually broken:
 *
 *   1. Route sweep   - every <loc> in dashboard/sitemap.xml plus every route
 *                      declared in vercel.json, fetched over HTTP. Records the
 *                      status code and flags anything that is not 200.
 *   2. Page sweep    - the interactive dashboard pages loaded in Chromium.
 *                      Records uncaught exceptions, console errors, failed
 *                      subresources, and requests that answered 4xx/5xx.
 *   3. Feature sweep - per page, the primary user action is performed for real
 *                      (fill the input, click the button, wait for the result
 *                      region) and the outcome is recorded as pass/fail with
 *                      the on-screen error text.
 *   4. API sweep     - every endpoint the dashboard calls, probed directly with
 *                      a representative payload.
 *
 * Usage:
 *   node scripts/audit-site.mjs                       # audit https://xactions.app
 *   node scripts/audit-site.mjs --base http://localhost:3000
 *   node scripts/audit-site.mjs --routes-only         # skip Chromium
 *   node scripts/audit-site.mjs --out tmp/site-audit  # where reports land
 *
 * Writes <out>/site-audit.json (full detail) and <out>/SITE_AUDIT.md (summary).
 * Exits 1 when any check fails, so it can gate a deploy.
 *
 * by nichxbt
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const BASE = (flag('base', 'https://xactions.app')).replace(/\/$/, '');
const OUT = path.resolve(ROOT, flag('out', 'tmp/site-audit'));
const ROUTES_ONLY = has('routes-only');
const PAGE_LIMIT = Number(flag('pages', '0')) || 0;
const CONCURRENCY = Number(flag('concurrency', '12'));

/** Playwright lives in this repo's node_modules, or in NODE_PATH for a shared install. */
async function loadChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    const require = createRequire(import.meta.url);
    for (const dir of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(dir, 'playwright', 'index.js');
      if (fs.existsSync(candidate)) return require(candidate).chromium;
    }
    throw new Error(
      'playwright is not installed. Run `npm i -D playwright` or set NODE_PATH to a tree that has it.'
    );
  }
}

/* ------------------------------------------------------------------ inventory */

function sitemapRoutes() {
  const file = path.join(ROOT, 'dashboard', 'sitemap.xml');
  if (!fs.existsSync(file)) return [];
  const xml = fs.readFileSync(file, 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].replace(/^https?:\/\/[^/]+/, ''))
    .map((p) => (p === '' ? '/' : p));
}

/** Routes declared in vercel.json that are literal paths (no regex captures). */
function vercelRoutes() {
  const file = path.join(ROOT, 'vercel.json');
  if (!fs.existsSync(file)) return [];
  const { routes = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const r of routes) {
    let src = r.src;
    if (!src || src.includes('(.*)') || src.includes('[^/]')) continue;
    src = src.replace(/\(\.html\)\?$/, '').replace(/\\/g, '');
    if (src.includes('(') || src.includes('|')) continue;
    out.push(src);
  }
  return out;
}

/** Pages with real interactive behavior: these get the Chromium + feature sweep. */
const APP_PAGES = [
  '/', '/dashboard', '/video', '/thread', '/thread-composer', '/ask', '/ai', '/ai-api',
  '/analytics', '/analytics-dashboard', '/graph', '/unfollowers', '/monitor', '/automations',
  '/workflows', '/calendar', '/agent', '/admin', '/run', '/playground', '/mcp', '/a2a',
  '/price-correlation', '/team', '/login', '/pricing', '/status', '/docs', '/scripts',
  '/tutorials', '/blog', '/changelog', '/features', '/faq', '/about', '/compare', '/contact',
  '/integrations', '/use-cases', '/security', '/extension', '/examples', '/contributing',
  '/privacy', '/terms', '/404',
];

/**
 * One entry per user-facing feature: fill the inputs with real values, click the
 * real trigger, then wait for the result region or an error message.
 *
 * `needs` records what a feature depends on, so the report can separate a
 * regression from a capability the deployment does not have:
 *   'edge'    answers from the site itself and must work
 *   'backend' needs the Node origin (XACTIONS_API_ORIGIN); failing is expected
 *             until one is deployed
 */
const FEATURES = [
  {
    page: '/video',
    name: 'Video downloader: extract every mp4 variant from a tweet',
    needs: 'edge',
    input: '#url-input',
    value: 'https://x.com/SpaceX/status/1732824684683784516',
    trigger: '#download-btn',
    settle: 15000,
  },
  {
    page: '/thread',
    name: 'Thread reader: unroll a thread',
    needs: 'backend',
    input: '#thread-url',
    value: 'https://x.com/naval/status/1002103360646823936',
    trigger: '#read-btn',
    settle: 15000,
  },
  {
    page: '/ask',
    name: 'Ask XActions: sourced answer from the docs',
    needs: 'edge',
    input: '#question',
    value: 'How do I unfollow everyone?',
    trigger: '#send',
    settle: 25000,
  },
  {
    page: '/graph',
    name: 'Graph: build a network graph for a handle',
    needs: 'backend',
    input: '#seedUser',
    value: 'nasa',
    trigger: '#buildBtn',
    settle: 20000,
  },
  {
    page: '/playground',
    name: 'Playground: fetch a live profile',
    needs: 'backend',
    input: '#pg-target',
    value: 'nasa',
    trigger: '#pg-run',
    settle: 20000,
  },
  {
    page: '/analytics',
    name: 'Analytics: sentiment analysis of pasted text',
    needs: 'edge',
    input: '#sentimentInput',
    value: 'XActions ships fast and the docs are excellent.',
    trigger: '#analyzeBtn',
    settle: 12000,
  },
];

/** A public tweet that still carries video, used by the downloader probes. */
const VIDEO_TWEET = 'https://x.com/SpaceX/status/1732824684683784516';

/** Endpoints the dashboard calls, plus the edge API and discovery surface. */
const ENDPOINTS = [
  { m: 'GET', p: '/api/health' },
  { m: 'GET', p: '/api/ai/health' },
  { m: 'GET', p: '/api/ai/pricing' },
  { m: 'GET', p: '/api/ask/health' },
  { m: 'GET', p: '/openapi.json' },
  { m: 'GET', p: '/.well-known/x402' },
  { m: 'POST', p: '/api/ask', body: { question: 'what is xactions' }, stream: true },
  { m: 'POST', p: '/api/video/extract', body: { url: VIDEO_TWEET } },
  { m: 'POST', p: '/api/video/extract-form', body: { url: VIDEO_TWEET } },
  { m: 'POST', p: '/api/thread/unroll', body: { url: 'https://x.com/naval/status/1002103360646823936' } },
  { m: 'POST', p: '/api/thread/summarize', body: { url: 'https://x.com/naval/status/1002103360646823936' } },
  { m: 'GET', p: '/api/thread/1002103360646823936' },
  { m: 'GET', p: '/api/analytics/profile/nasa' },
  { m: 'GET', p: '/api/graph/nasa' },
  { m: 'GET', p: '/api/playground/profile/nasa' },
  { m: 'GET', p: '/api/playground/timeline/nasa' },
  { m: 'POST', p: '/api/playground/compare', body: { handles: ['nasa', 'spacex'] } },
  { m: 'POST', p: '/api/ai/scrape/profile', body: { username: 'nasa' } },
  { m: 'POST', p: '/api/ai/writer/generate', body: { topic: 'space' } },
  { m: 'GET', p: '/api/scripts' },
  { m: 'GET', p: '/api/a2a/agent-card' },
  { m: 'GET', p: '/api/admin/x402/stats' },
  { m: 'GET', p: '/api/agent/status' },
  { m: 'GET', p: '/api/unfollowers/status' },
  { m: 'GET', p: '/api/workflows' },
  { m: 'GET', p: '/api/automations' },
  { m: 'GET', p: '/api/analytics' },
];

/* --------------------------------------------------------------------- helpers */

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function probe(url, init = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    let body = '';
    try {
      body = (await res.text()).slice(0, 600);
    } catch {
      body = '';
    }
    return { status: res.status, contentType: ct, ms: Date.now() - started, body };
  } catch (error) {
    return { status: 0, contentType: '', ms: Date.now() - started, body: '', error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------- the sweeps */

async function sweepRoutes() {
  const routes = [...new Set([...vercelRoutes(), ...sitemapRoutes()])].sort();
  const results = await mapLimit(routes, CONCURRENCY, async (route) => {
    const r = await probe(`${BASE}${route}`, { method: 'GET' }, 20000);
    return { route, status: r.status, ms: r.ms, error: r.error || null };
  });
  return results;
}

async function sweepPages(chromium) {
  const pages = PAGE_LIMIT ? APP_PAGES.slice(0, PAGE_LIMIT) : APP_PAGES;
  const browser = await chromium.launch();
  const out = [];
  try {
    for (const route of pages) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const badRequests = [];
      const failedRequests = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
      });
      page.on('pageerror', (err) => pageErrors.push(String(err.message).slice(0, 300)));
      page.on('response', (res) => {
        if (res.status() >= 400) badRequests.push(`${res.status()} ${res.url().replace(BASE, '')}`);
      });
      page.on('requestfailed', (req) => {
        failedRequests.push(`${req.failure()?.errorText || 'failed'} ${req.url().replace(BASE, '')}`);
      });
      let status = 0;
      let title = '';
      let error = null;
      try {
        const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        status = res ? res.status() : 0;
        await page.waitForTimeout(2500);
        title = await page.title();
      } catch (e) {
        error = e.message.slice(0, 300);
      }
      out.push({
        route,
        status,
        title,
        error,
        consoleErrors: [...new Set(consoleErrors)],
        pageErrors: [...new Set(pageErrors)],
        badRequests: [...new Set(badRequests)],
        failedRequests: [...new Set(failedRequests)].filter((f) => !f.includes('net::ERR_ABORTED')),
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

const ERROR_TEXT_RE =
  /(unavailable|failed|error|not configured|try again|something went wrong|503|502|500|404)/i;

async function sweepFeatures(chromium) {
  const browser = await chromium.launch();
  const out = [];
  try {
    for (const feature of FEATURES) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const apiCalls = [];
      page.on('response', async (res) => {
        const u = res.url();
        if (!u.includes('/api/')) return;
        let snippet = '';
        try {
          snippet = (await res.text()).slice(0, 300);
        } catch {
          snippet = '';
        }
        apiCalls.push({ url: u.replace(BASE, ''), status: res.status(), snippet });
      });
      const record = { page: feature.page, name: feature.name, needs: feature.needs, ok: false, detail: '', apiCalls: [] };
      try {
        await page.goto(`${BASE}${feature.page}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        const input = page.locator(feature.input).first();
        if (await input.count()) {
          await input.fill(feature.value, { timeout: 8000 });
        } else {
          record.detail = `no input matched ${feature.input}`;
        }
        const trigger = page.locator(feature.trigger).filter({ hasNotText: /cookie|accept/i }).first();
        if (await trigger.count()) {
          await trigger.click({ timeout: 8000 });
        } else {
          record.detail = `${record.detail} | no trigger matched ${feature.trigger}`.trim();
        }
        await page.waitForTimeout(feature.settle);
        const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
        record.apiCalls = apiCalls;
        const apiFailed = apiCalls.some((c) => c.status >= 400 || c.status === 0);
        const visibleError = ERROR_TEXT_RE.test(bodyText.slice(0, 4000));
        record.ok = !apiFailed && (apiCalls.length > 0 || !visibleError);
        if (!record.ok) {
          const failing = apiCalls.find((c) => c.status >= 400);
          record.detail = failing
            ? `${failing.status} ${failing.url} :: ${failing.snippet}`
            : record.detail || bodyText.slice(0, 300);
        }
      } catch (e) {
        record.detail = e.message.slice(0, 300);
      }
      out.push(record);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return out;
}

async function sweepApi() {
  return mapLimit(ENDPOINTS, 6, async (ep) => {
    const init = { method: ep.m, headers: { accept: 'application/json' } };
    if (ep.body) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(ep.body);
    }
    const r = await probe(`${BASE}${ep.p}`, init, ep.stream ? 30000 : 25000);
    const ok = ep.stream ? r.status === 200 : r.status >= 200 && r.status < 400;
    return {
      endpoint: `${ep.m} ${ep.p}`,
      status: r.status,
      ms: r.ms,
      ok,
      body: r.body.replace(/\s+/g, ' ').slice(0, 240),
      error: r.error || null,
    };
  });
}

/* --------------------------------------------------------------------- reports */

function writeReports(report) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'site-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

  const brokenRoutes = report.routes.filter((r) => r.status !== 200);
  const brokenPages = report.pages.filter(
    (p) => p.status !== 200 || p.pageErrors.length || p.consoleErrors.length || p.badRequests.length
  );
  const brokenFeatures = report.features.filter((f) => !f.ok);
  const brokenApi = report.api.filter((a) => !a.ok);

  const lines = [];
  lines.push(`# xactions.app site audit`);
  lines.push('');
  lines.push(`Base: ${report.base}`);
  lines.push(`Run: ${report.startedAt}`);
  lines.push('');
  lines.push('| Sweep | Checked | Failing |');
  lines.push('|---|---:|---:|');
  lines.push(`| Routes | ${report.routes.length} | ${brokenRoutes.length} |`);
  lines.push(`| Pages (browser) | ${report.pages.length} | ${brokenPages.length} |`);
  const edgeFeatures = report.features.filter((f) => f.needs !== 'backend');
  lines.push(
    `| Features (edge) | ${edgeFeatures.length} | ${edgeFeatures.filter((f) => !f.ok).length} |`
  );
  lines.push(
    `| Features (need backend) | ${report.features.length - edgeFeatures.length} | ${
      brokenFeatures.length - edgeFeatures.filter((f) => !f.ok).length
    } |`
  );
  lines.push(`| API endpoints | ${report.api.length} | ${brokenApi.length} |`);
  lines.push('');

  if (brokenApi.length) {
    lines.push('## Failing API endpoints');
    lines.push('');
    lines.push('| Endpoint | Status | Response |');
    lines.push('|---|---:|---|');
    for (const a of brokenApi) lines.push(`| \`${a.endpoint}\` | ${a.status || a.error} | ${a.body || ''} |`);
    lines.push('');
  }

  const brokenEdge = brokenFeatures.filter((f) => f.needs !== 'backend');
  const brokenBackend = brokenFeatures.filter((f) => f.needs === 'backend');

  if (brokenEdge.length) {
    lines.push('## Failing features (should work without a backend)');
    lines.push('');
    for (const f of brokenEdge) lines.push(`- **${f.name}** (\`${f.page}\`): ${f.detail}`);
    lines.push('');
  }

  if (brokenBackend.length) {
    lines.push('## Features waiting on the Node backend');
    lines.push('');
    lines.push('These need `XACTIONS_API_ORIGIN` pointed at a deployed Node API.');
    lines.push('');
    for (const f of brokenBackend) lines.push(`- **${f.name}** (\`${f.page}\`): ${f.detail}`);
    lines.push('');
  }

  if (brokenPages.length) {
    lines.push('## Pages with errors');
    lines.push('');
    for (const p of brokenPages) {
      lines.push(`### \`${p.route}\` (HTTP ${p.status})`);
      if (p.error) lines.push(`- navigation: ${p.error}`);
      for (const e of p.pageErrors) lines.push(`- uncaught: ${e}`);
      for (const e of p.consoleErrors) lines.push(`- console: ${e}`);
      for (const e of p.badRequests) lines.push(`- request: ${e}`);
      for (const e of p.failedRequests) lines.push(`- blocked: ${e}`);
      lines.push('');
    }
  }

  if (brokenRoutes.length) {
    lines.push('## Non-200 routes');
    lines.push('');
    lines.push('| Route | Status |');
    lines.push('|---|---:|');
    for (const r of brokenRoutes) lines.push(`| \`${r.route}\` | ${r.status || r.error} |`);
    lines.push('');
  }

  fs.writeFileSync(path.join(OUT, 'SITE_AUDIT.md'), `${lines.join('\n')}\n`);
  return { brokenRoutes, brokenPages, brokenFeatures, brokenApi };
}

/* ------------------------------------------------------------------------ main */

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  routes: [],
  pages: [],
  features: [],
  api: [],
};

console.log(`🔄 auditing ${BASE}`);

report.routes = await sweepRoutes();
console.log(`✅ routes: ${report.routes.filter((r) => r.status === 200).length}/${report.routes.length} OK`);

report.api = await sweepApi();
console.log(`✅ api: ${report.api.filter((a) => a.ok).length}/${report.api.length} OK`);

if (!ROUTES_ONLY) {
  const chromium = await loadChromium();
  report.pages = await sweepPages(chromium);
  console.log(`✅ pages: ${report.pages.length} loaded in Chromium`);
  report.features = await sweepFeatures(chromium);
  console.log(`✅ features: ${report.features.filter((f) => f.ok).length}/${report.features.length} OK`);
}

const broken = writeReports(report);
console.log(`\n📄 ${path.relative(ROOT, OUT)}/SITE_AUDIT.md`);
const failing =
  broken.brokenRoutes.length + broken.brokenPages.length + broken.brokenFeatures.length + broken.brokenApi.length;
console.log(
  failing
    ? `❌ ${failing} failing checks (routes ${broken.brokenRoutes.length}, pages ${broken.brokenPages.length}, features ${broken.brokenFeatures.length}, api ${broken.brokenApi.length})`
    : '✅ everything passed'
);
process.exit(failing ? 1 : 0);
