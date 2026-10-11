// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
//
// GENERATED FILE. Do not edit by hand.
// Regenerate with: npm run sync:user-agents
// Verify with:     npm run sync:user-agents:check
//
// Source data: https://github.com/fa0311/latest-user-agent (MIT, (c) fa0311),
// files output.json and header.json, produced by running the real browsers in
// CI and recording what they send. Upstream publishes Linux builds; the
// platform token is substituted per operating system (see
// scripts/sync-user-agents.mjs) and every version is upstream's, unmodified.
//
// Selection policy lives in ./userAgent.js, not here.

/**
 * Where this pool came from, and when. Read by `xactions doctor` so the age of
 * the fingerprint is a fact rather than a guess.
 * @type {Readonly<{repo: string, ref: string, commit: string, committedAt: string, fetchedAt: string, files: readonly string[]}>}
 */
export const UPSTREAM = Object.freeze({
  repo: "fa0311/latest-user-agent",
  ref: "main",
  commit: "f41fab834e21410aa6da72fba882405600b45a52",
  committedAt: "2026-07-31T21:25:23Z",
  fetchedAt: "2026-08-27T20:59:11.268Z",
  files: Object.freeze(["output.json", "header.json"]),
});

/**
 * The browser versions upstream observed, for reporting.
 * @type {Readonly<Record<string, string>>}
 */
export const VERSIONS = Object.freeze({
  chrome: "151.0.0.0",
  edge: "151.0.0.0",
  firefox: "153.0",
});

/**
 * One coherent browser identity per entry: the User-Agent and the request
 * headers that a real install of that browser sends alongside it. Mixing a
 * User-Agent from one row with client hints from another is exactly the
 * inconsistency a fingerprinter looks for, so they travel together.
 *
 * @type {readonly Readonly<{id: string, browser: string, engine: string, platform: string, version: string, userAgent: string, acceptLanguage: string, accept: string|null, acceptEncoding: string|null, secChUa: string|null, secChUaMobile: string|null, secChUaPlatform: string|null}>[]}
 */
export const PROFILES = Object.freeze([
  Object.freeze({
    id: "chrome-windows",
    browser: "chrome",
    engine: "chromium",
    platform: "windows",
    version: "151.0.0.0",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: "\"Not=A?Brand\";v=\"99\", \"Google Chrome\";v=\"151\", \"Chromium\";v=\"151\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  }),
  Object.freeze({
    id: "chrome-macos",
    browser: "chrome",
    engine: "chromium",
    platform: "macos",
    version: "151.0.0.0",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: "\"Not=A?Brand\";v=\"99\", \"Google Chrome\";v=\"151\", \"Chromium\";v=\"151\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  }),
  Object.freeze({
    id: "chrome-linux",
    browser: "chrome",
    engine: "chromium",
    platform: "linux",
    version: "151.0.0.0",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: "\"Not=A?Brand\";v=\"99\", \"Google Chrome\";v=\"151\", \"Chromium\";v=\"151\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Linux\"",
  }),
  Object.freeze({
    id: "edge-windows",
    browser: "edge",
    engine: "chromium",
    platform: "windows",
    version: "151.0.0.0",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: "\"Not=A?Brand\";v=\"99\", \"Microsoft Edge\";v=\"151\", \"Chromium\";v=\"151\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  }),
  Object.freeze({
    id: "firefox-windows",
    browser: "firefox",
    engine: "gecko",
    platform: "windows",
    version: "153.0",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: null,
    secChUaMobile: null,
    secChUaPlatform: null,
  }),
  Object.freeze({
    id: "firefox-macos",
    browser: "firefox",
    engine: "gecko",
    platform: "macos",
    version: "153.0",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:153.0) Gecko/20100101 Firefox/153.0",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: null,
    secChUaMobile: null,
    secChUaPlatform: null,
  }),
  Object.freeze({
    id: "firefox-linux",
    browser: "firefox",
    engine: "gecko",
    platform: "linux",
    version: "153.0",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0",
    acceptLanguage: "en-US,en;q=0.9",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    acceptEncoding: "gzip, deflate, br, zstd",
    secChUa: null,
    secChUaMobile: null,
    secChUaPlatform: null,
  }),
]);

/**
 * The profile chosen when a caller names none.
 * @type {string}
 */
export const DEFAULT_PROFILE_ID = "chrome-windows";

/**
 * Just the User-Agent strings, in profile order, for the callers that only
 * ever wanted a string.
 * @type {readonly string[]}
 */
export const USER_AGENT_STRINGS = Object.freeze(PROFILES.map((profile) => profile.userAgent));
