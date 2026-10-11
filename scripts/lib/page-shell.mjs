// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * The HTML shell every generated page shares: head, top bar, search dialog,
 * footer, and the script/style links.
 *
 * One module rather than a copy per builder. The site previously had the
 * chrome pasted into each generator, so the docs pages and the index pages
 * drifted apart in navigation, footer links, and metadata, and a reader could
 * tell which script had built the page they were on.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license Apache-2.0
 */

export const SITE_URL = 'https://xactions.app';
export const REPO_URL = 'https://github.com/nirholas/XActions';

/**
 * Escape a string for HTML text or an attribute value.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a full HTML document.
 *
 * @param {object} options
 * @param {string} options.title - Page title, without the site suffix
 * @param {string} options.description - Meta description
 * @param {string} options.urlPath - Absolute site path, e.g. /examples
 * @param {string} options.body - Everything between the top bar and the footer
 * @param {string} [options.keywords]
 * @param {string} [options.navCurrent] - Which top-bar link is current
 * @param {string} [options.ogImage] - Absolute image URL
 * @param {string} [options.schema] - Extra JSON-LD, already serialised
 * @param {string} [options.bodyClass]
 * @returns {string}
 */
export function renderPage({
  title,
  description,
  urlPath,
  body,
  keywords = 'xactions, twitter automation, x automation, open source, free',
  navCurrent = '',
  ogImage = `${SITE_URL}/og-docs.png`,
  schema = '',
  bodyClass = '',
}) {
  const canonical = `${SITE_URL}${urlPath}`;
  const pageTitle = `${title} — XActions`;
  const desc = description.slice(0, 158);

  /**
   * @param {string} href
   * @param {string} label
   * @param {string} key
   * @returns {string}
   */
  const navLink = (href, label, key) => {
    const current = key === navCurrent ? ' aria-current="page"' : '';
    return `<a class="topbar__link" href="${href}"${current}>${label}</a>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta name="keywords" content="${escapeHtml(keywords)}">
<meta name="author" content="nich (@nichxbt)">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="color-scheme" content="light dark">

<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:site_name" content="XActions">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@nichxbt">
<meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${ogImage}">

<link rel="canonical" href="${canonical}">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
<link rel="stylesheet" href="/docs/assets/docs.css">

<script>
/* Applied before first paint so a dark-theme reader never sees a white flash. */
(function(){try{var t=localStorage.getItem('xactions-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
</script>
${schema}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>

<header class="topbar">
  <button class="icon-btn menu-toggle" data-menu-toggle aria-expanded="false" aria-label="Open navigation">☰</button>
  <a class="topbar__brand" href="/">⚡ XActions</a>
  <div class="topbar__spacer"></div>
  <button class="search-trigger" data-search-trigger aria-label="Search documentation">
    <span aria-hidden="true">🔍</span><span class="search-trigger__label">Search docs</span><kbd>⌘K</kbd>
  </button>
  <nav class="topbar__nav" aria-label="Main">
    ${navLink('/docs', 'Docs', 'docs')}
    ${navLink('/tutorials', 'Tutorials', 'tutorials')}
    ${navLink('/examples', 'Examples', 'examples')}
    <a class="topbar__link" href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
  </nav>
  <button class="icon-btn" data-theme-toggle aria-label="Switch theme">☾</button>
</header>

<div class="scrim" data-scrim></div>

${body}

<dialog class="search-dialog" data-search-dialog aria-label="Search documentation">
  <input class="search-dialog__input" data-search-input type="search" placeholder="Search the documentation…" aria-label="Search query" autocomplete="off" spellcheck="false">
  <div class="search-dialog__results" data-search-results role="listbox" aria-label="Search results"></div>
  <div class="search-dialog__footer">
    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
    <span><kbd>↵</kbd> open</span>
    <span><kbd>esc</kbd> close</span>
  </div>
</dialog>

<footer class="site-footer">
  <div class="site-footer__inner">
    <div>
      <h4>XActions</h4>
      <p>Free, open-source X/Twitter automation.</p>
      <p>Built by <a href="https://x.com/nichxbt" target="_blank" rel="noopener">@nichxbt</a></p>
    </div>
    <div>
      <h4>Learn</h4>
      <a href="/docs/learn/your-first-scrape">Your first scrape</a>
      <a href="/docs/learn/mcp-with-claude">MCP with Claude</a>
      <a href="/examples">Examples</a>
      <a href="/docs/guides/troubleshooting">Troubleshooting</a>
    </div>
    <div>
      <h4>Reference</h4>
      <a href="/docs/guides/cli-reference">CLI</a>
      <a href="/docs/guides/api-reference">API</a>
      <a href="/docs/guides/mcp-setup">MCP server</a>
      <a href="/docs/guides/browser-scripts">Browser scripts</a>
    </div>
    <div>
      <h4>Project</h4>
      <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
      <a href="/docs/project/contributing">Contributing</a>
      <a href="/docs/project/changelog">Changelog</a>
      <a href="/docs/project/security">Security</a>
    </div>
  </div>
  <div class="site-footer__bottom">
    <p>© 2024–2026 XActions. Apache-2.0 licensed. No API fees.</p>
  </div>
</footer>

<script src="/docs/assets/docs.js" defer></script>
</body>
</html>`;
}
