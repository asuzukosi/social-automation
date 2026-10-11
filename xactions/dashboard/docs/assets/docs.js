// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions documentation runtime.
 *
 * Progressive enhancement only: every page is complete and readable with this
 * file blocked. Nothing here is required to read a doc, which matters because
 * these pages are static and frequently opened from a search result on a bad
 * connection.
 *
 * Provides:
 *   - theme toggle, remembered, defaulting to the system preference
 *   - full-text search over a generated index, with Cmd/Ctrl+K and /
 *   - copy buttons on code blocks
 *   - scroll-spy for the on-page contents
 *   - a mobile navigation drawer with a focus trap
 *
 * No dependencies. It is ~9KB and cached, so it costs one request per visit.
 */

(() => {
  'use strict';

  // ── Theme ────────────────────────────────────────────────────────────
  //
  // The inline script in <head> has already applied the stored theme to avoid
  // a flash of the wrong colours. This only wires the toggle.

  const STORAGE_KEY = 'xactions-theme';

  /**
   * Resolve the theme currently rendered, whether it came from storage or the
   * operating system.
   * @returns {'light'|'dark'}
   */
  function currentTheme() {
    const explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * @param {'light'|'dark'} theme
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private browsing. The toggle still works for this page view.
    }
    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      btn.textContent = theme === 'dark' ? '☀' : '☾';
    }
  }

  function initTheme() {
    applyTheme(currentTheme());
    for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
      btn.addEventListener('click', () => {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    }
  }

  // ── Copy buttons ─────────────────────────────────────────────────────

  function initCopyButtons() {
    for (const pre of document.querySelectorAll('.prose pre')) {
      const code = pre.querySelector('code');
      if (!code) continue;

      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code to clipboard');

      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
        } catch {
          // Clipboard API needs a secure context. Fall back to a selection so
          // the reader can still hit Cmd+C rather than getting nothing.
          const range = document.createRange();
          range.selectNodeContents(code);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          btn.textContent = 'Press Cmd+C';
          setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
          return;
        }

        btn.textContent = 'Copied';
        btn.dataset.copied = 'true';
        setTimeout(() => {
          btn.textContent = 'Copy';
          delete btn.dataset.copied;
        }, 1800);
      });

      wrap.appendChild(btn);
    }
  }

  // ── On-page contents ─────────────────────────────────────────────────

  function initToc() {
    const toc = document.querySelector('[data-toc]');
    const headings = [...document.querySelectorAll('.prose h2, .prose h3')].filter((h) => h.id);

    if (!toc) return;

    // A page with one or two sections does not need a table of contents; an
    // empty rail is just noise in the layout.
    if (headings.length < 3) {
      toc.remove();
      return;
    }

    const list = document.createElement('nav');
    list.setAttribute('aria-label', 'On this page');

    for (const heading of headings) {
      const link = document.createElement('a');
      link.className = `toc__link${heading.tagName === 'H3' ? ' toc__link--h3' : ''}`;
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent.replace(/#$/, '').trim();
      list.appendChild(link);
    }

    toc.appendChild(list);

    // Scroll-spy. rootMargin pins the "active" band just under the sticky
    // header so the highlighted entry matches what the reader is looking at.
    const links = new Map(
      [...list.querySelectorAll('.toc__link')].map((a) => [a.getAttribute('href').slice(1), a]),
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of links.values()) link.classList.remove('is-active');
          links.get(entry.target.id)?.classList.add('is-active');
        }
      },
      { rootMargin: '-72px 0px -70% 0px', threshold: 0 },
    );

    for (const heading of headings) observer.observe(heading);
  }

  // ── Heading anchors ──────────────────────────────────────────────────

  function initHeadingAnchors() {
    for (const heading of document.querySelectorAll('.prose h2[id], .prose h3[id]')) {
      const anchor = document.createElement('a');
      anchor.className = 'heading-anchor';
      anchor.href = `#${heading.id}`;
      anchor.textContent = '#';
      anchor.setAttribute('aria-label', `Link to ${heading.textContent.trim()}`);
      heading.appendChild(anchor);
    }
  }

  // ── Tables ───────────────────────────────────────────────────────────

  function initTables() {
    // Wide tables must scroll inside their own container. Without this the
    // whole page scrolls sideways on a phone, which breaks every other
    // element on it.
    for (const table of document.querySelectorAll('.prose table')) {
      if (table.parentElement?.classList.contains('table-wrap')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
  }

  // ── Mobile drawer ────────────────────────────────────────────────────

  function initDrawer() {
    const toggle = document.querySelector('[data-menu-toggle]');
    const sidebar = document.querySelector('.sidebar');
    const scrim = document.querySelector('.scrim');
    if (!toggle || !sidebar || !scrim) return;

    let lastFocused = null;

    const setOpen = (open) => {
      sidebar.dataset.open = String(open);
      scrim.dataset.open = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';

      if (open) {
        lastFocused = document.activeElement;
        sidebar.querySelector('a')?.focus();
      } else {
        lastFocused?.focus();
      }
    };

    toggle.addEventListener('click', () => setOpen(sidebar.dataset.open !== 'true'));
    scrim.addEventListener('click', () => setOpen(false));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.dataset.open === 'true') setOpen(false);
    });

    // Following a link should close the drawer, or the reader lands on the new
    // page with the menu still covering it.
    sidebar.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
  }

  // ── Search ───────────────────────────────────────────────────────────

  function initSearch() {
    const trigger = document.querySelector('[data-search-trigger]');
    const dialog = document.querySelector('[data-search-dialog]');
    if (!trigger || !dialog || typeof dialog.showModal !== 'function') {
      // <dialog> is unsupported. Send the reader to the docs index rather than
      // leaving a button that does nothing.
      trigger?.addEventListener('click', () => { window.location.href = '/docs'; });
      return;
    }

    const input = dialog.querySelector('[data-search-input]');
    const results = dialog.querySelector('[data-search-results]');

    let index = null;
    let loading = null;
    let selected = 0;

    /**
     * Fetch the search index once, lazily. It is a few hundred KB, so loading
     * it on every page view would be a waste for the majority who never search.
     * @returns {Promise<Array>}
     */
    function loadIndex() {
      if (index) return Promise.resolve(index);
      if (loading) return loading;

      loading = fetch('/docs/search-index.json')
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          index = Array.isArray(data) ? data : [];
          return index;
        })
        .catch(() => {
          index = [];
          return index;
        });

      return loading;
    }

    /**
     * Score one entry against a query.
     *
     * Deliberately simple: a title match beats a section match beats a body
     * match, and every term must appear somewhere. Good enough for a few
     * hundred pages, and it ships no dependency.
     *
     * @param {{t: string, s: string, k: string}} entry
     * @param {string[]} terms
     * @returns {number} Higher is better; 0 means no match
     */
    function score(entry, terms) {
      const title = entry.t.toLowerCase();
      const section = entry.s.toLowerCase();
      const body = entry.k.toLowerCase();
      let total = 0;

      for (const term of terms) {
        if (title.startsWith(term)) total += 100;
        else if (title.includes(term)) total += 60;
        else if (section.includes(term)) total += 20;
        else if (body.includes(term)) total += 8;
        else return 0;
      }

      // Prefer concise titles when scores tie: "MCP Setup" over
      // "Advanced MCP Setup For Multi Agent Orchestration".
      return total - title.length / 100;
    }

    /**
     * Escape text for insertion as HTML.
     * @param {string} text
     * @returns {string}
     */
    function escapeHtml(text) {
      return text.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }

    /**
     * Bold the matched terms in a title.
     * @param {string} text
     * @param {string[]} terms
     * @returns {string} HTML
     */
    function highlight(text, terms) {
      let html = escapeHtml(text);
      for (const term of terms) {
        if (!term) continue;
        const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
        html = html.replace(pattern, '<mark>$1</mark>');
      }
      return html;
    }

    function render(matches, terms) {
      selected = 0;

      if (matches.length === 0) {
        results.innerHTML = '<p class="search-empty">No matches. Try a shorter query.</p>';
        return;
      }

      results.innerHTML = matches
        .map(
          (entry, i) => `
            <a class="search-result" href="${escapeHtml(entry.u)}" role="option" aria-selected="${i === 0}">
              <div class="search-result__title">${highlight(entry.t, terms)}</div>
              <div class="search-result__section">${escapeHtml(entry.s)}</div>
            </a>`,
        )
        .join('');
    }

    function moveSelection(delta) {
      const items = [...results.querySelectorAll('.search-result')];
      if (items.length === 0) return;

      items[selected]?.setAttribute('aria-selected', 'false');
      selected = (selected + delta + items.length) % items.length;
      const item = items[selected];
      item.setAttribute('aria-selected', 'true');
      item.scrollIntoView({ block: 'nearest' });
    }

    async function search(query) {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

      if (terms.length === 0) {
        results.innerHTML = '<p class="search-empty">Type to search the documentation.</p>';
        return;
      }

      const entries = await loadIndex();
      const matches = entries
        .map((entry) => ({ entry, points: score(entry, terms) }))
        .filter((m) => m.points > 0)
        .sort((a, b) => b.points - a.points)
        .slice(0, 12)
        .map((m) => m.entry);

      render(matches, terms);
    }

    const open = () => {
      dialog.showModal();
      input.value = '';
      results.innerHTML = '<p class="search-empty">Type to search the documentation.</p>';
      loadIndex();
      input.focus();
    };

    trigger.addEventListener('click', open);

    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => search(input.value.trim()), 90);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = results.querySelectorAll('.search-result')[selected];
        if (item) window.location.href = item.getAttribute('href');
      }
    });

    document.addEventListener('keydown', (event) => {
      const typingInField = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
        || event.target.isContentEditable;

      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        open();
      } else if (event.key === '/' && !typingInField && !dialog.open) {
        event.preventDefault();
        open();
      }
    });

    // Clicking the backdrop closes the dialog. The <dialog> element reports the
    // dialog itself as the target for backdrop clicks.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────

  function init() {
    initTheme();
    initHeadingAnchors();
    initTables();
    initCopyButtons();
    initToc();
    initDrawer();
    initSearch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
