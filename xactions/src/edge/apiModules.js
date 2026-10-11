// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Lazy loader for the API modules that read `process.env` at module scope.
 *
 * `api/config/x402-config.js` and `api/openapi.js` were written for the Node
 * server, where the environment is already on `process.env`. On Cloudflare the
 * environment arrives as the `env` argument instead, so the variables are
 * copied across before the modules are imported. The import is deferred and
 * memoised: it happens on the first request an isolate serves, never at
 * module-evaluation time when `env` is not available yet.
 *
 * No compatibility flag is needed: both modules only ever read `process.env.X`,
 * so a minimal `process.env` shim is installed when the runtime has none. That
 * keeps the discovery endpoints working on a Pages project with default
 * settings, and is a no-op where `nodejs_compat` already provides `process`.
 *
 * @module src/edge/apiModules
 * @author nichxbt
 */

/** @type {Promise<object>|null} */
let modules = null;

/**
 * Import the x402 config and the OpenAPI generator with `env` applied.
 *
 * @param {Record<string, unknown>} env - The Worker or Pages Functions env.
 * @returns {Promise<object>} The merged exports of both modules.
 */
export function loadApiModules(env) {
  if (!modules) {
    if (!globalThis.process) globalThis.process = { env: {} };
    if (!globalThis.process.env) globalThis.process.env = {};
    for (const [key, value] of Object.entries(env || {})) {
      if (typeof value === 'string') globalThis.process.env[key] = value;
    }
    modules = Promise.all([
      import('../../api/config/x402-config.js'),
      import('../../api/openapi.js'),
    ]).then(([x402, openapi]) => ({ ...x402, ...openapi }));
    modules.catch(() => {
      modules = null;
    });
  }
  return modules;
}
