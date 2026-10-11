// Ask XActions page: streams grounded answers from POST /api/ask, and falls
// back to running the same engine in the browser (docs index + keyless LLM
// lanes) when no API origin answers, so the page works on a static deploy too.
// by nichxbt

import { SUGGESTED_QUESTIONS } from '/js/ask/engine.js';
import { BYOK_PROVIDERS } from '/js/ask/lanes.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const hero = $('hero');
const thread = $('thread');
const form = $('composer');
const input = $('question');
const sendBtn = $('send');
const laneSelect = $('lane-select');
const lanePanel = $('lane-panel');
const laneOptions = $('lane-options');
const laneLabel = $('lane-label');
const laneKey = $('lane-key');
const laneKeyInput = $('lane-key-input');
const historyBtn = $('btn-history');
const historyPanel = $('history-panel');
const historyList = $('history-list');
const historyEmpty = $('history-empty');
const toast = $('toast');

const STORAGE = { conversations: 'xactions.ask.conversations', lane: 'xactions.ask.lane', keys: 'xactions.ask.keys' };
// Same-origin API first (Worker, Vercel, or the Express server serving the
// dashboard); on localhost also try the API server's default port before the
// in-browser engine takes over.
const API_BASES = location.hostname === 'localhost' && location.port !== '3001' ? ['/api', 'http://localhost:3001/api'] : ['/api'];

let conversations = load(STORAGE.conversations, []);
let current = null;
let streaming = null;
let engine = null;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: history is session-only */ }
}
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

// Markdown rendering: marked + DOMPurify, then [n] citations become links to
// the numbered source. Streaming re-renders the whole answer each frame.
marked.setOptions({ gfm: true, breaks: false });
function renderMarkdown(text, sources) {
  const html = DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['target'] });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('code, pre, a')) textNodes.push(walker.currentNode);
  for (const node of textNodes) {
    if (!/\[\d+\]/.test(node.data)) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of node.data.matchAll(/\[(\d+)\]/g)) {
      const n = Number(m[1]);
      const src = sources.find((s) => s.n === n);
      frag.append(node.data.slice(last, m.index));
      if (src) {
        const a = doc.createElement('a');
        a.className = 'cite';
        a.href = src.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = src.title;
        a.textContent = String(n);
        frag.append(a);
      } else {
        frag.append(m[0]);
      }
      last = m.index + m[0].length;
    }
    frag.append(node.data.slice(last));
    node.replaceWith(frag);
  }
  for (const a of doc.querySelectorAll('a:not(.cite)')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  for (const pre of doc.querySelectorAll('pre')) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-code';
    btn.textContent = 'Copy';
    pre.append(btn);
  }
  return doc.body.innerHTML;
}

function sourceChip(s) {
  const kindLabel = { doc: 'docs', skill: 'skill', script: 'script', page: 'site', repo: 'repo', issue: 'issue', pr: 'pr', code: 'code' }[s.kind] || s.kind;
  return `<a class="source" href="${s.url}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(s.title)}"><span class="source-n">${s.n}</span><span class="source-t">${escapeHtml(s.title)}</span><span class="source-k">${kindLabel}</span></a>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ---- Conversation state -------------------------------------------------

function newConversation() {
  current = { id: `c_${Date.now().toString(36)}`, title: '', createdAt: Date.now(), messages: [] };
  thread.innerHTML = '';
  thread.classList.remove('is-visible');
  hero.classList.remove('is-hidden');
  input.focus();
  renderHistory();
}

function persist() {
  if (!current || !current.messages.length) return;
  const i = conversations.findIndex((c) => c.id === current.id);
  if (i === -1) conversations.unshift(current); else conversations[i] = current;
  conversations = conversations.slice(0, 50);
  save(STORAGE.conversations, conversations);
  renderHistory();
}

function openConversation(id) {
  const c = conversations.find((x) => x.id === id);
  if (!c) return;
  current = c;
  thread.innerHTML = '';
  for (const m of c.messages) {
    if (m.role === 'user') appendUser(m.content);
    else appendAssistant(m);
  }
  hero.classList.add('is-hidden');
  thread.classList.add('is-visible');
  closePanels();
  stage.scrollTop = stage.scrollHeight;
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = conversations.map((c) => `
    <button type="button" class="history-item${current && c.id === current.id ? ' is-active' : ''}" data-id="${c.id}">
      <span class="t">${escapeHtml(c.title || c.messages[0]?.content || 'Conversation')}</span>
      <span class="d">${new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
      <span class="history-del" data-del="${c.id}" role="button" aria-label="Delete conversation" title="Delete">×</span>
    </button>`).join('');
  historyEmpty.style.display = conversations.length ? 'none' : 'block';
}

// ---- Rendering messages -------------------------------------------------

function appendUser(text) {
  const el = document.createElement('div');
  el.className = 'msg msg-user';
  el.innerHTML = `<div class="bubble"></div>`;
  el.querySelector('.bubble').textContent = text;
  thread.append(el);
  return el;
}

function appendAssistant(message) {
  const el = document.createElement('div');
  el.className = 'msg msg-assistant';
  el.innerHTML = `<div class="avatar" aria-hidden="true">⚡</div><div class="answer"><div class="body"></div><div class="acts"></div><div class="sources"></div><div class="meta"></div></div>`;
  thread.append(el);
  paintAssistant(el, message);
  return el;
}


// ---- Runnable actions -----------------------------------------------------

const ACTION_META = {
  script: { label: 'Browser script', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' },
  cli: { label: 'Terminal', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="6 9 9 12 6 15"/><line x1="12" y1="15" x2="17" y2="15"/></svg>' },
  mcp: { label: 'MCP tool', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><path d="M14.1 9.9 17 7M9.9 14.1 7 17"/></svg>' },
};

function actionCard(action, i) {
  const meta = ACTION_META[action.kind] || ACTION_META.script;
  const links = [];
  if (action.kind === 'script') {
    // The script itself is fetched on click, so the button copies real source
    // rather than a link the reader then has to go and open.
    links.push(`<button type="button" class="act-btn act-primary" data-copy-script="${escapeHtml(action.raw)}" data-label="${escapeHtml(action.title)}">Copy script</button>`);
    if (action.page) links.push(`<a class="act-btn" href="${escapeHtml(action.page)}">Open page</a>`);
    if (action.runOnUrl) links.push(`<a class="act-btn" href="${escapeHtml(action.runOnUrl)}" target="_blank" rel="noopener noreferrer">Go to X</a>`);
  } else if (action.kind === 'cli') {
    links.push(`<button type="button" class="act-btn act-primary" data-copy-text="${escapeHtml(action.run)}">Copy command</button>`);
    links.push(`<button type="button" class="act-btn" data-copy-text="${escapeHtml(action.install)}">Copy install</button>`);
  } else {
    links.push(`<button type="button" class="act-btn act-primary" data-copy-text="${escapeHtml(action.id)}">Copy tool name</button>`);
    links.push(`<a class="act-btn" href="/mcp">Set up MCP</a>`);
  }
  return `<li class="act" style="--i:${i}">
    <div class="act-head"><span class="act-kind" title="${escapeHtml(meta.label)}">${meta.icon}<span>${escapeHtml(meta.label)}</span></span><span class="act-why">${escapeHtml(action.why || '')}</span></div>
    <div class="act-title">${escapeHtml(action.title)}</div>
    ${action.description ? `<div class="act-desc">${escapeHtml(action.description)}</div>` : ''}
    <code class="act-run">${escapeHtml(action.run)}</code>
    ${action.needsCore ? '<div class="act-note">Paste <code>src/automation/core.js</code> first</div>' : ''}
    <div class="act-links">${links.join('')}</div>
  </li>`;
}

function renderActions(actions) {
  if (!actions || !actions.length) return '';
  return `<section class="act-rail" aria-label="Runnable actions">
    <h3 class="act-rail-title">Run it${actions.length > 1 ? ` <span>${actions.length} ways</span>` : ''}</h3>
    <ul class="act-list">${actions.map(actionCard).join('')}</ul>
  </section>`;
}

function paintAssistant(el, message, { live = false } = {}) {
  const body = el.querySelector('.body');
  const sources = message.sources || [];
  if (message.error) {
    body.innerHTML = `<div class="error-card"><strong>Could not get an answer</strong>${escapeHtml(message.error)}<div class="actions"><button type="button" class="btn-sm" data-retry>Retry</button><a class="btn-sm" href="/docs">Open the docs</a><a class="btn-sm" href="https://github.com/nirholas/XActions/issues" target="_blank" rel="noopener noreferrer">Ask on GitHub</a></div></div>`;
  } else if (!message.content && live) {
    body.innerHTML = `<div class="thinking">${sources.length ? `Reading ${sources.length} sources` : 'Searching the docs and the repo'}<span class="thinking-dots"><i></i><i></i><i></i></span></div><div class="skeleton"><i></i><i></i><i></i></div>`;
  } else {
    body.innerHTML = renderMarkdown(message.content || '', sources) + (live ? '<span class="cursor" aria-hidden="true"></span>' : '');
  }
  el.querySelector('.sources').innerHTML = sources.map(sourceChip).join('');
  el.querySelector('.acts').innerHTML = renderActions(message.actions);
  const meta = el.querySelector('.meta');
  if (message.lane && !live) {
    const via = message.digest
      ? 'the documentation index, no model lane was free'
      : message.lane.startsWith('byok:')
        ? `your ${BYOK_PROVIDERS[message.lane.slice(5)]?.label || message.lane.slice(5)} key`
        : `${message.lane}${message.local ? ' (in-browser)' : ''}`;
    meta.innerHTML = `<span>Answered via ${escapeHtml(via)}${message.partial ? ', partial' : ''}</span><span class="meta-actions"><button type="button" class="meta-btn" data-copy title="Copy answer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button><button type="button" class="meta-btn" data-regen title="Ask again"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>Retry</button></span>`;
  } else {
    meta.innerHTML = '';
  }
}

// ---- Asking ---------------------------------------------------------------

function selectedByok() {
  const lane = localStorage.getItem(STORAGE.lane) || 'auto';
  if (lane === 'auto') return undefined;
  const keys = load(STORAGE.keys, {});
  if (!keys[lane]) return undefined;
  return { provider: lane, apiKey: keys[lane] };
}

async function askViaApi(question, history, byok, onEvent, signal) {
  let res = null;
  for (const base of API_BASES) {
    try {
      res = await fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, history, byok }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      res = null;
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.includes('text/event-stream')) break;
    res = null;
  }
  if (!res) throw Object.assign(new Error('api unavailable'), { fallback: true });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(5)));
    }
  }
}

async function loadEngine() {
  if (engine) return engine;
  showToast('API offline. Answering in your browser.');
  const [{ ask, createSearcher }, { createActionMatcher }, indexRes, actionsRes] = await Promise.all([
    import('/js/ask/engine.js'),
    import('/js/ask/actions.js'),
    fetch('/data/ask-index.json'),
    fetch('/data/ask-actions.json'),
  ]);
  if (!indexRes.ok) throw new Error(`docs index unavailable (${indexRes.status})`);
  if (!actionsRes.ok) throw new Error(`action catalog unavailable (${actionsRes.status})`);
  engine = {
    ask,
    searcher: createSearcher(await indexRes.json()),
    matcher: createActionMatcher(await actionsRes.json()),
  };
  return engine;
}

async function askLocally(question, history, byok, onEvent, signal) {
  const { ask, searcher, matcher } = await loadEngine();
  await ask({ question, history, searcher, matcher, env: {}, byok, browserSafe: true, onEvent: (e) => onEvent(e.type === 'done' ? { ...e, local: true } : e), signal });
}

async function submit(question) {
  if (streaming) return;
  question = question.trim();
  if (!question) return;
  if (!current) newConversation();
  hero.classList.add('is-hidden');
  thread.classList.add('is-visible');
  if (!current.title) current.title = question.slice(0, 80);

  const history = current.messages.map((m) => ({ role: m.role, content: m.content }));
  current.messages.push({ role: 'user', content: question });
  appendUser(question);
  const message = { role: 'assistant', content: '', sources: [], actions: [], lane: null };
  current.messages.push(message);
  const el = appendAssistant(message);
  paintAssistant(el, message, { live: true });
  stage.scrollTop = stage.scrollHeight;
  input.value = '';
  autosize();
  setStreaming(true);

  const controller = new AbortController();
  streaming = controller;
  let pinned = true;
  const onScroll = () => { pinned = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 80; };
  stage.addEventListener('scroll', onScroll);
  let frame = 0;
  const repaint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paintAssistant(el, message, { live: true });
      if (pinned) stage.scrollTop = stage.scrollHeight;
    });
  };
  const onEvent = (e) => {
    if (e.type === 'sources') message.sources = e.sources;
    else if (e.type === 'lane') message.lane = e.lane;
    else if (e.type === 'delta') message.content += e.text;
    else if (e.type === 'actions') message.actions = e.actions;
    else if (e.type === 'done') { message.lane = e.lane; message.partial = e.partial; message.digest = Boolean(e.digest); message.local = Boolean(e.local); if (e.actions?.length) message.actions = e.actions; }
    else if (e.type === 'error') message.error = e.message;
    repaint();
  };

  const byok = selectedByok();
  try {
    try {
      await askViaApi(question, history, byok, onEvent, controller.signal);
    } catch (err) {
      if (!err.fallback || controller.signal.aborted) throw err;
      await askLocally(question, history, byok, onEvent, controller.signal);
    }
    if (!message.content && !message.error) message.error = 'Every model lane returned an empty answer. Try again in a moment.';
  } catch (err) {
    if (controller.signal.aborted) message.partial = true;
    else message.error = err.message;
  } finally {
    cancelAnimationFrame(frame);
    frame = 0;
    stage.removeEventListener('scroll', onScroll);
    streaming = null;
    setStreaming(false);
    paintAssistant(el, message);
    if (pinned) stage.scrollTop = stage.scrollHeight;
    persist();
    input.focus();
  }
}

function setStreaming(on) {
  sendBtn.classList.toggle('is-stop', on);
  sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
  sendBtn.innerHTML = on
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
  sendBtn.disabled = on ? false : !input.value.trim();
}

// ---- Lane picker ------------------------------------------------------------

function renderLanes() {
  const lane = localStorage.getItem(STORAGE.lane) || 'auto';
  const keys = load(STORAGE.keys, {});
  const options = [{ id: 'auto', label: 'Auto', sub: 'Free lanes, no key needed' }].concat(
    Object.entries(BYOK_PROVIDERS).map(([id, p]) => ({ id, label: p.label, sub: keys[id] ? `Your key · ${p.model}` : `Bring your own key · ${p.model}` }))
  );
  laneOptions.innerHTML = options.map((o) => `<button type="button" class="lane-option" role="option" aria-checked="${o.id === lane}" data-lane="${o.id}"><span class="check">${o.id === lane ? '✓' : ''}</span><span><span>${o.label}</span><span class="sub">${o.sub}</span></span></button>`).join('');
  laneLabel.textContent = lane === 'auto' ? 'Auto' : BYOK_PROVIDERS[lane].label;
  laneKey.classList.toggle('is-open', lane !== 'auto');
  laneKeyInput.value = lane === 'auto' ? '' : keys[lane] || '';
  laneKeyInput.placeholder = lane === 'auto' ? 'API key' : `${BYOK_PROVIDERS[lane].label} API key`;
}

function closePanels() {
  historyPanel.classList.remove('is-open');
  historyBtn.setAttribute('aria-expanded', 'false');
  lanePanel.classList.remove('is-open');
  laneSelect.setAttribute('aria-expanded', 'false');
}

// ---- Wiring -----------------------------------------------------------------

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}

input.addEventListener('input', () => { autosize(); if (!streaming) sendBtn.disabled = !input.value.trim(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (streaming) { streaming.abort(); return; }
  submit(input.value);
});

$('suggestions').innerHTML = SUGGESTED_QUESTIONS.map((q) => `<button type="button" class="suggestion">${escapeHtml(q)}</button>`).join('');
$('suggestions').addEventListener('click', (e) => {
  const btn = e.target.closest('.suggestion');
  if (btn) submit(btn.textContent);
});

$('btn-new').addEventListener('click', () => { if (streaming) streaming.abort(); newConversation(); });
historyBtn.addEventListener('click', () => {
  const open = !historyPanel.classList.contains('is-open');
  closePanels();
  historyPanel.classList.toggle('is-open', open);
  historyBtn.setAttribute('aria-expanded', String(open));
});
historyList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    conversations = conversations.filter((c) => c.id !== del.dataset.del);
    save(STORAGE.conversations, conversations);
    if (current && current.id === del.dataset.del) newConversation(); else renderHistory();
    return;
  }
  const item = e.target.closest('.history-item');
  if (item) openConversation(item.dataset.id);
});
$('btn-clear-history').addEventListener('click', () => {
  if (!conversations.length) return;
  conversations = [];
  save(STORAGE.conversations, conversations);
  newConversation();
  showToast('History cleared');
});

laneSelect.addEventListener('click', () => {
  const open = !lanePanel.classList.contains('is-open');
  closePanels();
  lanePanel.classList.toggle('is-open', open);
  laneSelect.setAttribute('aria-expanded', String(open));
  if (open) renderLanes();
});
laneOptions.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-lane]');
  if (!opt) return;
  localStorage.setItem(STORAGE.lane, opt.dataset.lane);
  renderLanes();
  if (opt.dataset.lane !== 'auto') laneKeyInput.focus(); else closePanels();
});
laneKeyInput.addEventListener('change', () => {
  const lane = localStorage.getItem(STORAGE.lane) || 'auto';
  if (lane === 'auto') return;
  const keys = load(STORAGE.keys, {});
  if (laneKeyInput.value.trim()) keys[lane] = laneKeyInput.value.trim(); else delete keys[lane];
  save(STORAGE.keys, keys);
  renderLanes();
  showToast(keys[lane] ? `${BYOK_PROVIDERS[lane].label} key saved in this browser` : 'Key removed');
});

thread.addEventListener('click', async (e) => {
  // Copy the script's real source, fetched from GitHub raw on demand. Nobody
  // wants a link when what they asked for is the thing to paste.
  const copyScript = e.target.closest('[data-copy-script]');
  if (copyScript) {
    const original = copyScript.textContent;
    copyScript.disabled = true;
    copyScript.textContent = 'Fetching...';
    try {
      const res = await fetch(copyScript.dataset.copyScript);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const source = await res.text();
      await navigator.clipboard.writeText(source);
      copyScript.textContent = 'Copied';
      showToast(`${copyScript.dataset.label} copied. Paste it into the DevTools console.`);
    } catch (err) {
      copyScript.textContent = 'Open instead';
      showToast(`Could not fetch the script (${err.message}). Use "Open page".`);
    } finally {
      copyScript.disabled = false;
      setTimeout(() => { copyScript.textContent = original; }, 2200);
    }
    return;
  }
  const copyText = e.target.closest('[data-copy-text]');
  if (copyText) {
    await navigator.clipboard.writeText(copyText.dataset.copyText);
    const original = copyText.textContent;
    copyText.textContent = 'Copied';
    setTimeout(() => { copyText.textContent = original; }, 1500);
    return;
  }
  const copyCode = e.target.closest('.copy-code');
  if (copyCode) {
    await navigator.clipboard.writeText(copyCode.parentElement.querySelector('code')?.textContent || '');
    copyCode.textContent = 'Copied';
    setTimeout(() => { copyCode.textContent = 'Copy'; }, 1500);
    return;
  }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const el = copy.closest('.msg');
    const i = [...thread.children].indexOf(el);
    const m = current?.messages[i];
    if (m) { await navigator.clipboard.writeText(m.content); showToast('Answer copied'); }
    return;
  }
  const regen = e.target.closest('[data-regen], [data-retry]');
  if (regen && !streaming) {
    const el = regen.closest('.msg');
    const i = [...thread.children].indexOf(el);
    const question = current?.messages[i - 1]?.content;
    if (!question) return;
    current.messages.splice(i - 1, 2);
    el.previousElementSibling?.remove();
    el.remove();
    submit(question);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.panel, #btn-history, #lane-select')) closePanels();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePanels(); if (streaming) streaming.abort(); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newConversation(); }
  if (e.key === '/' && document.activeElement !== input && !e.target.closest('input, textarea')) { e.preventDefault(); input.focus(); }
});

// Deep link: /ask?q=how+do+i+unfollow+everyone
const params = new URLSearchParams(location.search);
newConversation();
renderLanes();
if (params.get('q')) {
  history.replaceState(null, '', location.pathname);
  submit(params.get('q'));
}
