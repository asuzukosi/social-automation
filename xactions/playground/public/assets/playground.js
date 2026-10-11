// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Playground - browser app.
 *
 * No framework and no build step. It imports the same query translator and
 * the same number formatter the CLI and the server use, so a figure rendered
 * here and a figure printed in a terminal came out of one implementation.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import {
  QUERIES,
  resolveQuery,
  translateQuery,
  apiPathFor,
  queryFromSearch,
} from './query-translator.js';
import { formatCount } from './account-report.js';

const $ = (id) => document.getElementById(id);

/**
 * Where the playground API lives.
 *
 * Empty means same origin, which is the case when the Cloud Run service
 * serves this page itself. The static site build stamps the service URL into
 * the meta tag instead, so the identical page works from either origin.
 */
const API_BASE = (document.querySelector('meta[name="playground-api"]')?.content || '').replace(/\/$/, '');

const el = {
  tabs: $('pg-tabs'),
  form: $('pg-form'),
  target: $('pg-target'),
  targetLabel: $('pg-target-label'),
  limit: $('pg-limit'),
  limitLabel: $('pg-limit-label'),
  limitField: $('pg-limit-field'),
  run: $('pg-run'),
  runText: $('pg-run-text'),
  hint: $('pg-hint'),
  result: $('pg-result'),
  lanes: $('pg-lanes'),
  code: $('pg-code-block'),
  copy: $('pg-copy'),
  laneNote: $('pg-lane-note'),
  share: $('pg-share'),
  shareText: $('pg-share-text'),
  tooltip: $('pg-tooltip'),
  announcer: $('pg-announcer'),
  health: $('pg-health-badge'),
};

const state = {
  kind: 'profile',
  lane: 'cli',
  lanes: [],
  running: false,
  lastQuery: null,
};

// ============================================================================
// Small helpers
// ============================================================================

/**
 * Escape text for safe insertion into HTML.
 * @param {*} value
 * @returns {string}
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Announce a message to screen readers without moving focus.
 * @param {string} message
 */
function announce(message) {
  el.announcer.textContent = message;
}

/**
 * Human-readable elapsed time.
 * @param {string|null} iso
 * @returns {string}
 */
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  const units = [
    ['y', 31_536_000],
    ['mo', 2_592_000],
    ['d', 86_400],
    ['h', 3600],
    ['m', 60],
  ];
  for (const [label, size] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  }
  return 'just now';
}

/**
 * Copy text and flash a confirmation on the triggering button.
 * @param {string} text
 * @param {HTMLElement} button
 * @param {HTMLElement} labelNode
 * @param {string} restore
 */
async function copyWithFeedback(text, button, labelNode, restore) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permission can be denied. Fall back to a selection the user
    // can copy by hand rather than silently doing nothing.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  button.dataset.copied = 'true';
  labelNode.textContent = 'Copied';
  announce('Copied to clipboard');
  setTimeout(() => {
    button.dataset.copied = 'false';
    labelNode.textContent = restore;
  }, 1600);
}

// ============================================================================
// Tooltips
// ============================================================================

/**
 * A single floating tooltip element, shown on hover and on keyboard focus,
 * flipped above or below depending on room, and dismissed with Escape.
 */
function initTooltips() {
  let current = null;

  const hide = () => {
    el.tooltip.dataset.open = 'false';
    if (current) current.removeAttribute('aria-describedby');
    current = null;
  };

  const show = (trigger) => {
    const text = trigger.dataset.tip;
    if (!text) return;
    current = trigger;
    el.tooltip.textContent = text;
    el.tooltip.id = 'pg-tooltip';
    trigger.setAttribute('aria-describedby', 'pg-tooltip');
    el.tooltip.dataset.open = 'true';

    const anchor = trigger.getBoundingClientRect();
    const tip = el.tooltip.getBoundingClientRect();
    const gap = 9;
    const placeBelow = anchor.top < tip.height + gap + 8;

    let left = anchor.left + anchor.width / 2 - tip.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));

    el.tooltip.style.left = `${left}px`;
    el.tooltip.style.top = placeBelow ? `${anchor.bottom + gap}px` : `${anchor.top - tip.height - gap}px`;
    el.tooltip.dataset.placement = placeBelow ? 'bottom' : 'top';
    el.tooltip.style.setProperty('--tip-arrow-x', `${anchor.left + anchor.width / 2 - left}px`);
  };

  const bind = (event, handler) =>
    document.addEventListener(
      event,
      (e) => {
        const trigger = e.target.closest?.('[data-tip]');
        if (trigger) handler(trigger);
        else if (current) hide();
      },
      true
    );

  bind('mouseover', show);
  bind('focusin', show);
  document.addEventListener('mouseout', (e) => {
    if (current && e.target.closest?.('[data-tip]') === current) hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide);
}

/**
 * Markup for an inline tooltip trigger.
 * @param {string} text
 * @param {string} label
 * @returns {string}
 */
function tip(text, label) {
  return `<button type="button" class="pg-tip-mark" data-tip="${esc(text)}" aria-label="${esc(label)}">?</button>`;
}

// ============================================================================
// Theme
// ============================================================================

function initTheme() {
  const toggle = document.querySelector('[data-theme-toggle]');
  if (!toggle) return;

  const paint = () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    const dark = explicit
      ? explicit === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    toggle.textContent = dark ? '☀' : '☾';
    toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };

  toggle.addEventListener('click', () => {
    const explicit = document.documentElement.getAttribute('data-theme');
    const dark = explicit
      ? explicit === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('xactions-theme', next);
    } catch {
      // Private browsing can refuse storage. The theme still applies for the
      // life of the page, which is the part that matters.
    }
    paint();
  });

  paint();
}

// ============================================================================
// Query form
// ============================================================================

function renderTabs() {
  el.tabs.innerHTML = Object.entries(QUERIES)
    .map(
      ([key, spec]) => `
      <button type="button" role="tab" class="pg-tab" data-kind="${key}"
              id="pg-tab-${key}" aria-selected="${key === state.kind}"
              data-tip="${esc(spec.summary)}">
        <span aria-hidden="true">${spec.icon}</span>${esc(spec.label)}
      </button>`
    )
    .join('');
}

/**
 * Point the form at a query kind: labels, placeholder, defaults, hint.
 * @param {string} kind
 */
function selectKind(kind) {
  if (!QUERIES[kind]) return;
  state.kind = kind;

  for (const tab of el.tabs.querySelectorAll('.pg-tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.kind === kind));
  }

  const spec = QUERIES[kind];
  const targetParam = spec.params[0];
  const limitParam = spec.params.find((p) => p.type === 'number');

  el.targetLabel.textContent = targetParam.label;
  el.target.placeholder = targetParam.placeholder;

  if (limitParam) {
    el.limitField.hidden = false;
    el.limitLabel.textContent = limitParam.label;
    el.limit.min = String(limitParam.min);
    el.limit.max = String(limitParam.max);
    el.limit.value = String(limitParam.default);
  } else {
    el.limitField.hidden = true;
  }

  el.runText.textContent = kind === 'compare' ? 'Compare' : 'Run';
  el.hint.textContent = spec.summary;
  refreshCode();
}

/**
 * Read the form into a resolved query, or null when it is not yet valid.
 * @returns {object|null}
 */
function currentQuery() {
  const input = { limit: el.limit.value };
  if (state.kind === 'compare') input.users = el.target.value;
  else input.username = el.target.value;
  try {
    return resolveQuery(state.kind, input);
  } catch {
    return null;
  }
}

// ============================================================================
// Code lanes
// ============================================================================

function renderLanes() {
  el.lanes.innerHTML = state.lanes
    .map(
      (lane) => `
      <button type="button" role="tab" class="pg-lane" data-lane="${lane.id}"
              aria-selected="${lane.id === state.lane}">${esc(lane.label)}</button>`
    )
    .join('');

  const active = state.lanes.find((l) => l.id === state.lane) || state.lanes[0];
  if (!active) return;
  state.lane = active.id;
  el.code.textContent = active.code;
  el.code.className = `language-${active.lang}`;
  el.laneNote.textContent = active.note;
}

/**
 * Regenerate every snippet for whatever is currently in the form.
 *
 * This runs on every keystroke, which is the whole point: a visitor sees the
 * command they would type change as they type the username, so the leap from
 * the demo to their own terminal is already made before they click Run.
 */
function refreshCode() {
  const query = currentQuery();
  if (!query) {
    state.lanes = [];
    el.lanes.innerHTML = '';
    el.code.textContent =
      state.kind === 'compare'
        ? '# Enter two or more usernames, for example: nasa, spacex'
        : '# Enter a username above';
    el.laneNote.textContent = '';
    return;
  }
  state.lanes = translateQuery(query, { apiBase: API_BASE || window.location.origin });
  renderLanes();
}

// ============================================================================
// Result rendering
// ============================================================================

/**
 * @param {number} count
 * @returns {string}
 */
function skeleton(count) {
  return Array.from(
    { length: count },
    (_, i) => `<div class="pg-skeleton" style="width:${[100, 72, 88, 60, 94][i % 5]}%"></div>`
  ).join('');
}

/**
 * @param {{value: string|number, label: string, tip?: string, tone?: string}} stat
 * @returns {string}
 */
function statCard({ value, label, tip: tipText, tone = '' }) {
  return `
    <div class="pg-stat ${tone ? `pg-stat--${tone}` : ''}">
      <div class="pg-stat__value">${esc(value)}</div>
      <div class="pg-stat__label">${esc(label)}${tipText ? tip(tipText, `About ${label}`) : ''}</div>
    </div>`;
}

/**
 * @param {object} profile
 * @returns {string}
 */
function profileCard(profile) {
  const joined = profile.joined ? new Date(profile.joined).toISOString().slice(0, 10) : '';
  return `
    <div class="pg-profile">
      ${profile.avatar ? `<img class="pg-avatar" src="${esc(profile.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="pg-avatar"></div>'}
      <div style="min-width:0">
        <h3 class="pg-profile__name">${esc(profile.name)}${profile.verified ? '<span class="pg-verified" title="Verified">✓</span>' : ''}</h3>
        <p class="pg-profile__handle"><a href="${esc(profile.url)}" target="_blank" rel="noopener">@${esc(profile.username)}</a></p>
        ${profile.bio ? `<p class="pg-profile__bio">${esc(profile.bio)}</p>` : ''}
        <div class="pg-profile__meta">
          ${profile.location ? `<span>📍 ${esc(profile.location)}</span>` : ''}
          ${profile.website ? `<span>🔗 <a href="${esc(profile.website)}" target="_blank" rel="noopener nofollow">${esc(profile.website.replace(/^https?:\/\//, ''))}</a></span>` : ''}
          ${joined ? `<span>📅 Joined ${esc(joined)}</span>` : ''}
          ${profile.protected ? '<span>🔒 Protected</span>' : ''}
        </div>
      </div>
    </div>`;
}

/**
 * @param {object} data
 * @returns {string}
 */
function renderProfile(data) {
  const p = data.profile;
  return `
    ${profileCard(p)}
    <div class="pg-stats">
      ${statCard({ value: formatCount(p.followers), label: 'Followers', tone: 'accent' })}
      ${statCard({ value: formatCount(p.following), label: 'Following' })}
      ${statCard({ value: formatCount(p.posts), label: 'Posts' })}
      ${statCard({ value: formatCount(p.listed), label: 'Listed', tip: 'How many public Lists include this account. A rough proxy for how useful other people find it.' })}
      ${statCard({ value: formatCount(p.likes), label: 'Likes given' })}
      ${statCard({ value: formatCount(p.media), label: 'Media posts' })}
    </div>`;
}

/**
 * @param {object} post
 * @returns {string}
 */
function postCard(post) {
  const kind = post.isRetweet ? 'repost' : post.isReply ? 'reply' : post.isQuote ? 'quote' : 'post';
  return `
    <a class="pg-post" href="${esc(post.url)}" target="_blank" rel="noopener">
      <p class="pg-post__text">${esc((post.text || '').slice(0, 320))}</p>
      <div class="pg-post__meta">
        <span class="pg-post__kind">${kind}</span>
        <span>♥ ${formatCount(post.likes)}</span>
        <span>↻ ${formatCount(post.retweets)}</span>
        <span>💬 ${formatCount(post.replies)}</span>
        ${post.views ? `<span>👁 ${formatCount(post.views)}</span>` : ''}
        <span>${esc(relativeTime(post.postedAt))}</span>
      </div>
    </a>`;
}

/**
 * @param {object} data
 * @returns {string}
 */
function renderTimeline(data) {
  if (!data.tweets.length) {
    return emptyState('Nothing to show', `X returned no posts for @${data.query.username}. Protected, empty and suspended accounts all look like this.`);
  }
  return `
    <p class="pg-meta-line">${data.count} posts for @${esc(data.query.username)}</p>
    <div class="pg-posts" style="margin-top:0.7rem">${data.tweets.map(postCard).join('')}</div>`;
}

/**
 * Hour-of-day bar chart, drawn from the report's own buckets.
 * @param {object} timing
 * @returns {string}
 */
function hourChart(timing) {
  const buckets = timing.byHourUTC;
  const peak = Math.max(...buckets.map((b) => b.medianEngagement), 1);
  const bars = buckets
    .map((b) => {
      const height = b.posts ? Math.max((b.medianEngagement / peak) * 100, 6) : 3;
      const best = b.index === timing.bestHourUTC;
      const label = b.posts
        ? `${String(b.index).padStart(2, '0')}:00 UTC. ${b.posts} post${b.posts === 1 ? '' : 's'}, median ${formatCount(b.medianEngagement)} interactions.`
        : `${String(b.index).padStart(2, '0')}:00 UTC. No posts in the sample.`;
      return `<div class="pg-bar" style="height:${height}%" data-has-posts="${b.posts > 0}" data-best="${best}" data-tip="${esc(label)}" tabindex="0" role="img" aria-label="${esc(label)}"></div>`;
    })
    .join('');

  const axis = Array.from({ length: 24 }, (_, i) => `<span>${i % 6 === 0 ? i : ''}</span>`).join('');

  return `
    <div class="pg-chart">
      <h4 class="pg-chart__title">Median engagement by hour, UTC${tip(`Only hours with at least ${timing.minimumBucketSample} posts are eligible to be called the best. One lucky post in a quiet hour otherwise wins every time.`, 'How the best hour is chosen')}</h4>
      <div class="pg-bars">${bars}</div>
      <div class="pg-bars__axis">${axis}</div>
    </div>`;
}

/**
 * @param {object} data
 * @returns {string}
 */
function renderReport(data) {
  const r = data.report;
  const signalIcon = { good: '✓', watch: '!', info: 'i' };

  const signals = r.signals
    .map(
      (s) => `
      <div class="pg-signal pg-signal--${s.level}">
        <span class="pg-signal__icon" aria-hidden="true">${signalIcon[s.level] || 'i'}</span>
        <div>
          <p class="pg-signal__title">${esc(s.title)}</p>
          <p class="pg-signal__detail">${esc(s.detail)}</p>
        </div>
      </div>`
    )
    .join('');

  return `
    ${profileCard(r.identity)}
    <div class="pg-stats">
      ${statCard({ value: `${r.engagement.rate}%`, label: 'Engagement rate', tone: 'accent', tip: 'Interactions on a median original post, as a percentage of followers. Retweets of other people are excluded so the number is this account’s own reach.' })}
      ${statCard({ value: formatCount(r.engagement.medianPerOriginal), label: 'Median per post', tip: 'Likes plus reposts plus replies on a typical original post. Median, not mean, so one viral post cannot flatter the number.' })}
      ${statCard({ value: r.output.postsPerDay, label: 'Posts per day', tip: `Measured across the ${r.meta.sampleSpanDays} days the ${r.meta.sampleSize} sampled posts cover.` })}
      ${statCard({ value: `${r.mix.originalShare}%`, label: 'Original', tip: 'Share of the sample that is neither a repost nor a reply.' })}
      ${statCard({ value: r.timing.bestHourUTC === null ? 'n/a' : `${String(r.timing.bestHourUTC).padStart(2, '0')}:00`, label: 'Best hour UTC', tone: 'good' })}
      ${statCard({ value: r.timing.bestWeekday || 'n/a', label: 'Best day', tone: 'good' })}
    </div>

    ${signals ? `<div class="pg-signals">${signals}</div>` : ''}
    ${hourChart(r.timing)}

    ${
      r.topPosts.length
        ? `<div class="pg-chart">
             <h4 class="pg-chart__title">Top posts in the sample</h4>
             <div class="pg-posts">${r.topPosts.slice(0, 3).map((p) => postCard({ ...p, isRetweet: p.kind === 'retweet', isReply: p.kind === 'reply', isQuote: p.kind === 'quote' })).join('')}</div>
           </div>`
        : ''
    }

    ${
      r.topHashtags.length
        ? `<div class="pg-chart">
             <h4 class="pg-chart__title">Most used hashtags</h4>
             <div class="pg-chips">${r.topHashtags.map((h) => `<span class="pg-chip" style="cursor:default">#${esc(h.value)} · ${h.count}</span>`).join('')}</div>
           </div>`
        : ''
    }

    <p class="pg-meta-line">
      Sample: ${r.meta.sampleSize} posts across ${r.meta.sampleSpanDays} days.
      Source: ${esc(r.meta.source)}.
      Generated ${esc(r.meta.generatedAt.slice(0, 19).replace('T', ' '))} UTC.
    </p>`;
}

/**
 * @param {object} data
 * @returns {string}
 */
function renderCompare(data) {
  const { accounts, leaders } = data.comparison;

  const rows = [
    { key: 'followers', label: 'Followers', format: formatCount },
    { key: 'following', label: 'Following', format: formatCount },
    { key: 'followerRatio', label: 'Follower ratio', format: formatCount, tip: 'Followers divided by following. Above 1 means more people follow it than it follows.' },
    { key: 'followersPerDay', label: 'Followers per day', format: formatCount, tip: 'Lifetime average since the account opened, so it flattens any spike.' },
    { key: 'lifetimePosts', label: 'Posts, lifetime', format: formatCount },
    { key: 'postsPerDay', label: 'Posts per day', format: (v) => String(v), tip: 'Measured across the sampled window, not the lifetime.' },
    { key: 'medianEngagement', label: 'Median engagement', format: formatCount, tip: 'Interactions on a median original post.' },
    { key: 'engagementRate', label: 'Engagement rate', format: (v) => `${v}%` },
    { key: 'mediaShare', label: 'Posts with media', format: (v) => `${v}%` },
    { key: 'originalShare', label: 'Original posts', format: (v) => `${v}%` },
  ];

  const header = accounts
    .map(
      (a) => `<th scope="col"><div class="pg-table__account" style="justify-content:flex-end">
        ${a.avatar ? `<img class="pg-table__avatar" src="${esc(a.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <span>@${esc(a.username)}</span>
      </div></th>`
    )
    .join('');

  const body = rows
    .map((row) => {
      const cells = accounts
        .map((a) => {
          const isLeader = leaders[row.key] === a.username && accounts.length > 1;
          return `<td data-leader="${isLeader}">${esc(row.format(a[row.key]))}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${esc(row.label)}${row.tip ? tip(row.tip, `About ${row.label}`) : ''}</th>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="pg-table-wrap">
      <table class="pg-table">
        <thead><tr><th scope="col">Metric</th>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="pg-meta-line">
      A triangle marks the leading account on that row.
      Samples: ${accounts.map((a) => `@${esc(a.username)} ${a.sampleSize} posts`).join(', ')}.
    </p>`;
}

/**
 * @param {string} title
 * @param {string} body
 * @param {string} [icon]
 * @returns {string}
 */
function emptyState(title, body, icon = '🔍') {
  return `
    <div class="pg-empty">
      <span class="pg-empty__icon" aria-hidden="true">${icon}</span>
      <h3>${esc(title)}</h3>
      <p>${esc(body)}</p>
    </div>`;
}

/**
 * @param {{error: string, code: string, hint: string}} payload
 * @returns {string}
 */
function errorState(payload) {
  return `
    <div class="pg-error">
      <h3><span aria-hidden="true">⚠</span> ${esc(payload.error || 'Something went wrong')}</h3>
      <p>${esc(payload.hint || '')}</p>
      <p><code>${esc(payload.code || 'ERROR')}</code></p>
    </div>`;
}

const RENDERERS = {
  profile: renderProfile,
  timeline: renderTimeline,
  report: renderReport,
  compare: renderCompare,
};

// ============================================================================
// Running a query
// ============================================================================

/**
 * Fetch and render. Every failure path renders something a person can act on.
 * @param {object} query - Output of resolveQuery
 */
async function run(query) {
  if (state.running) return;
  state.running = true;
  state.lastQuery = query;

  el.run.disabled = true;
  el.run.dataset.busy = 'true';
  el.result.setAttribute('aria-busy', 'true');
  el.result.innerHTML = skeleton(6);
  el.share.hidden = true;
  announce('Running query');

  const started = performance.now();

  try {
    const response = await fetch(`${API_BASE}${apiPathFor(query)}`, { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => ({
      error: `X returned HTTP ${response.status}`,
      code: 'BAD_RESPONSE',
      hint: 'The playground could not read the response. Try again.',
    }));

    if (!response.ok) {
      el.result.innerHTML = errorState(payload);
      announce(`Query failed: ${payload.error}`);
      return;
    }

    const elapsed = Math.round(performance.now() - started);
    el.result.innerHTML =
      RENDERERS[query.kind](payload) +
      `<p class="pg-meta-line">Answered in ${elapsed} ms by the public playground API. No account, no key.</p>`;
    el.share.hidden = false;
    announce('Results ready');

    const url = new URL(window.location.href);
    url.searchParams.set('q', query.kind);
    url.searchParams.set('u', query.users ? query.users.join(',') : query.username);
    if (query.limit) url.searchParams.set('n', String(query.limit));
    window.history.replaceState({}, '', url);
  } catch (error) {
    el.result.innerHTML = errorState({
      error: 'Could not reach the playground API',
      code: 'NETWORK',
      hint: `${error.message}. Check your connection, or run the same query locally with the CLI command shown alongside.`,
    });
    announce('Network error');
  } finally {
    state.running = false;
    el.run.disabled = false;
    el.run.dataset.busy = 'false';
    el.result.setAttribute('aria-busy', 'false');
  }
}

// ============================================================================
// Wiring
// ============================================================================

function initEvents() {
  el.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.pg-tab');
    if (tab) selectKind(tab.dataset.kind);
  });

  el.tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const kinds = Object.keys(QUERIES);
    const next = kinds[(kinds.indexOf(state.kind) + (e.key === 'ArrowRight' ? 1 : kinds.length - 1)) % kinds.length];
    selectKind(next);
    el.tabs.querySelector(`[data-kind="${next}"]`).focus();
    e.preventDefault();
  });

  el.lanes.addEventListener('click', (e) => {
    const lane = e.target.closest('.pg-lane');
    if (!lane) return;
    state.lane = lane.dataset.lane;
    renderLanes();
  });

  el.form.addEventListener('input', refreshCode);

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    let query;
    try {
      query = resolveQuery(state.kind, {
        limit: el.limit.value,
        ...(state.kind === 'compare' ? { users: el.target.value } : { username: el.target.value }),
      });
    } catch (error) {
      el.result.innerHTML = errorState({ error: error.message, code: 'BAD_INPUT', hint: 'Fix the input above and run again.' });
      el.target.focus();
      return;
    }
    run(query);
  });

  for (const chip of document.querySelectorAll('.pg-chip[data-sample]')) {
    chip.addEventListener('click', () => {
      el.target.value = state.kind === 'compare' ? `${chip.dataset.sample}, spacex` : chip.dataset.sample;
      refreshCode();
      el.form.requestSubmit();
    });
  }

  el.copy.addEventListener('click', () => {
    copyWithFeedback(el.code.textContent, el.copy, el.copy, 'Copy');
  });

  el.share.addEventListener('click', () => {
    copyWithFeedback(window.location.href, el.share, el.shareText, 'Copy link');
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      el.target.focus();
      el.target.select();
    }
    if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey)) && !state.running) {
      e.preventDefault();
      el.form.requestSubmit();
    }
  });
}

/**
 * Show whether the API is up, and how warm its cache is. A dead demo that
 * says nothing is worse than one that says it is dead.
 */
async function initHealth() {
  try {
    const response = await fetch(`${API_BASE}/api/playground/health`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    el.health.hidden = false;
    el.health.textContent = `API up · ${health.cache.entries} cached`;
    el.health.dataset.tip = `Guest tier only. Answers are cached for ${Math.round(health.cache.ttlMs / 60000)} minutes and at most ${health.upstream.max} requests reach X at once.`;
  } catch {
    el.health.hidden = false;
    el.health.textContent = 'API unreachable';
    el.health.dataset.tip = 'The demo API is not answering. The CLI does not depend on it: npx xactions profile nasa still works.';
  }
}

function boot() {
  initTheme();
  initTooltips();
  renderTabs();
  initEvents();

  const fromUrl = queryFromSearch(window.location.search);
  if (fromUrl) {
    selectKind(fromUrl.kind);
    el.target.value = fromUrl.users ? fromUrl.users.join(', ') : fromUrl.username;
    if (fromUrl.limit) el.limit.value = String(fromUrl.limit);
    refreshCode();
    run(fromUrl);
  } else {
    selectKind('profile');
    el.result.innerHTML = emptyState(
      'Pick an account and press Run',
      'Or click one of the suggestions. Nothing here needs a login, and the panel alongside shows you the same query as a terminal command, a Node program, an HTTP request and an agent prompt.',
      '⚡'
    );
  }

  initHealth();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
