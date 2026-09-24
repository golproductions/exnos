// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). See LICENSE.
// Exnos service worker. Holds a WebSocket to the local Exnos MCP server and
// answers its verification requests by extracting live state from real tabs.
// The extension is the eyes; the MCP server is the mouth. Nothing here ever
// writes to a page: Exnos is strictly read-only by design.
//
// Scope, enforced here in the browser:
//   - Local pages (localhost, 127.0.0.1, *.localhost, local files) are readable.
//   - Any other site is readable only after the user allows it by clicking the
//     Exnos icon while on that site (click again to remove it). The AI cannot
//     allow a site.
//   - Tabs Exnos may not read are not listed, matched or described to the AI.
//   - The console/network tap runs only on readable sites.

const PORT = 17872;
let ws = null;
let lastState = new Map(); // tabId -> hash of last state (for diff detection)

// ─── scope ────────────────────────────────────────────────────────────────────
const LOCAL_PATTERNS = ['*://localhost/*', '*://127.0.0.1/*', '*://*.localhost/*', 'file:///*'];
let allowed = new Set();           // user-allowed origins, e.g. "https://example.com"
const loadAllowed = chrome.storage.local.get({ allowedOrigins: [] }).then(v => { allowed = new Set(v.allowedOrigins); });

function isLocal(url) {
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'file:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}
function originOf(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } }
function isAllowed(url) { return isLocal(url) || allowed.has(originOf(url)); }

async function syncCaptureScripts() {
  await loadAllowed;
  const matches = [...LOCAL_PATTERNS, ...[...allowed].map(o => o + '/*')];
  const scripts = [
    { id: 'exnos-collector', js: ['collector.js'], matches, runAt: 'document_start', world: 'ISOLATED', allFrames: false, persistAcrossSessions: true },
    { id: 'exnos-tap', js: ['tap.js'], matches, runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true }
  ];
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map(s => s.id));
  const toUpdate = scripts.filter(s => have.has(s.id)), toAdd = scripts.filter(s => !have.has(s.id));
  if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
  if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
}

async function describeTab(tab) {
  if (!tab || !tab.id) return;
  const url = tab.url || '';
  let title;
  if (isLocal(url)) title = 'Exnos can read this page (local pages are always readable).';
  else if (!originOf(url)) title = 'Exnos: this page cannot be read.';
  else if (allowed.has(originOf(url))) title = 'Exnos can read ' + originOf(url) + '. Click to stop.';
  else title = 'Exnos cannot read ' + originOf(url) + '. Click to allow it.';
  try { await chrome.action.setTitle({ tabId: tab.id, title }); } catch {}
}

// Allow or remove the current site. A click is a user gesture: only the user can
// widen what Exnos reads.
chrome.action.onClicked.addListener(async (tab) => {
  await loadAllowed;
  const origin = originOf(tab.url || '');
  if (!origin || isLocal(tab.url)) { describeTab(tab); return; }
  const adding = !allowed.has(origin);
  if (adding) allowed.add(origin); else allowed.delete(origin);
  await chrome.storage.local.set({ allowedOrigins: [...allowed] });
  await syncCaptureScripts();
  try {
    await chrome.action.setBadgeText({ tabId: tab.id, text: adding ? '+' : '-' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {}), 2500);
  } catch {}
  describeTab(tab);
});
chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId).then(describeTab).catch(() => {}));
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.url || info.status === 'complete') describeTab(tab); });

// The stored list is the source of truth: any change to it (the toolbar click,
// or a future settings page) updates what Exnos reads and where it captures.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.allowedOrigins) return;
  allowed = new Set(changes.allowedOrigins.newValue || []);
  syncCaptureScripts().catch(() => {});
});

// ─── connection to the local MCP server ───────────────────────────────────────
function setBadge(on) {
  chrome.action.setBadgeText({ text: on ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: on ? '#1a7f37' : '#8a8a8a' });
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  let sock;
  try { sock = new WebSocket('ws://127.0.0.1:' + PORT + '/extension'); } catch { setBadge(false); return; }
  ws = sock;
  sock.onopen = () => setBadge(true);
  sock.onerror = () => {};
  sock.onclose = () => {
    setBadge(false);
    if (ws === sock) ws = null;
    setTimeout(connect, 2000);
  };
  sock.onmessage = async (ev) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.ping) { try { sock.send(JSON.stringify({ pong: true })); } catch {} return; }
    if (msg.id === undefined) return;
    try {
      const data = await handle(msg.cmd, msg.args || {});
      sock.send(JSON.stringify({ id: msg.id, ok: true, data }));
    } catch (e) {
      sock.send(JSON.stringify({ id: msg.id, ok: false, error: String((e && e.message) || e) }));
    }
  };
}

// exnos-reconnect: re-establish WS if it dropped (every 30s)
// exnos-keepalive: touch a Chrome API so the service worker is not suspended (every 20s)
chrome.alarms.create('exnos-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.create('exnos-keepalive', { periodInMinutes: 1 / 3 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'exnos-keepalive') { chrome.action.getBadgeText({}, () => {}); return; }
  connect();
});
chrome.runtime.onStartup.addListener(() => { syncCaptureScripts(); connect(); });
chrome.runtime.onInstalled.addListener(() => { syncCaptureScripts(); connect(); });
syncCaptureScripts().catch(() => {});
connect();

// ─── tabs ─────────────────────────────────────────────────────────────────────
const HOW_TO_ALLOW = 'The user can allow a site by opening it and clicking the Exnos icon in the Chrome toolbar. Local pages (localhost, 127.0.0.1, local files) are always readable.';

async function pickTab(filter) {
  await loadAllowed;
  const all = await chrome.tabs.query({});
  const readable = all.filter(t => isAllowed(t.url || ''));
  if (filter) {
    const f = String(filter).toLowerCase();
    const match = t => (t.url || '').toLowerCase().includes(f) || (t.title || '').toLowerCase().includes(f);
    const t = readable.find(match);
    if (t) return t;
    // Never name or describe a tab Exnos may not read.
    const hiddenMatch = all.some(x => !isAllowed(x.url || '') && match(x));
    throw new Error('No readable tab matching: ' + filter + '.' + (hiddenMatch ? ' A tab on a site Exnos is not allowed to read may match. ' + HOW_TO_ALLOW : ' Readable tabs: ' + (readable.map(t => t.title).join(' | ').substring(0, 300) || 'none')));
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!active) throw new Error('No active tab');
  if (!isAllowed(active.url || '')) throw new Error('The active tab is on a site Exnos is not allowed to read. ' + HOW_TO_ALLOW);
  return active;
}

function hashState(state) {
  const key = JSON.stringify({ url: state.url, errors: state.counts ? state.counts.errors : 0, fields: state.fields?.map(f => f.value).join('|'), text: state.text?.substring(0, 500) });
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return h;
}

async function handle(cmd, args) {
  await loadAllowed;
  if (cmd === 'tabs') {
    const all = await chrome.tabs.query({});
    const readable = all.filter(t => isAllowed(t.url || ''));
    return {
      tabs: readable.map(t => ({ title: t.title || '', url: t.url || '', active: !!t.active })),
      notListed: all.length - readable.length ? (all.length - readable.length) + ' tab(s) on sites Exnos is not allowed to read. ' + HOW_TO_ALLOW : undefined
    };
  }

  if (cmd === 'screenshot') {
    const tab = await pickTab(args.tab);
    if (!tab.active) throw new Error('Screenshots capture the visible tab only; switch to that tab first.');
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { url: tab.url, title: tab.title, screenshot: dataUrl, width: tab.width, height: tab.height };
    } catch (e) { throw new Error('Screenshot failed: ' + e.message); }
  }

  if (cmd === 'state') {
    const tab = await pickTab(args.tab);
    if (!/^(https?|file):/.test(tab.url || '')) {
      return { url: tab.url, title: tab.title, note: 'Internal page; state extraction only works on http/https/file pages.' };
    }
    const opts = { selector: args.selector || null, includeHidden: !!args.includeHidden, includeStorage: !!args.includeStorage, thirdParty: !!args.thirdParty };
    // ISOLATED world: the same world as collector.js, out of reach of page scripts.
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: extractState, args: [opts] });
    const state = res && res[0] ? res[0].result : null;
    if (!state) throw new Error('State extraction returned nothing (page may still be loading)');
    if (state.selectorFound === false) return state;

    if (args.appGlobals) {
      try {
        const g = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: readAppGlobals });
        state.appGlobals = g && g[0] ? g[0].result : null;
      } catch (e) { state.appGlobals = 'unreadable: ' + e.message; }
    }

    const currentHash = hashState(state);
    const prevHash = lastState.get(tab.id);
    if (prevHash !== undefined) state.changed = currentHash !== prevHash;
    lastState.set(tab.id, currentHash);

    if (args.screenshot) {
      if (!tab.active) state.screenshotError = 'screenshots capture the visible tab only';
      else {
        try { state.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
        catch (e) { state.screenshotError = e.message; }
      }
    }
    return state;
  }
  throw new Error('Unknown command: ' + cmd);
}

// ─── readAppGlobals (opt-in) ──────────────────────────────────────────────────
// Runs in the page's MAIN world: window.__* values the app itself exposes.
function readAppGlobals() {
  const out = {};
  for (const key of Object.keys(window)) {
    if (!key.startsWith('__')) continue;
    try {
      const val = window[key];
      if (val === null || val === undefined || typeof val === 'function') continue;
      const str = JSON.stringify(val);
      if (str && str.length < 500) out[key] = val;
    } catch {}
  }
  return out;
}

// ─── extractState ─────────────────────────────────────────────────────────────
// Runs in the ISOLATED world of the page (with collector.js). Returns what the
// user can see, plus what Exnos captured since the page loaded.
function extractState(opts) {
  const { selector, includeHidden, includeStorage, thirdParty } = opts;
  const vw = window.innerWidth, vh = window.innerHeight;
  const MAX_TEXT = 3000;

  const inViewport = b => b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < vw && b.top < vh;
  const isComputedVisible = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0; };
  const isVisible = el => inViewport(el.getBoundingClientRect()) && isComputedVisible(el);
  function queryAll(root, sel) {
    const results = [];
    (function walk(node) {
      try {
        results.push(...node.querySelectorAll(sel));
        const w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
        for (let cur = w.nextNode(); cur; cur = w.nextNode()) if (cur.shadowRoot) walk(cur.shadowRoot);
      } catch {}
    })(root);
    return results;
  }

  // Selector first: a selector that matches nothing returns exactly that.
  let selectorEls = null;
  if (selector) {
    selectorEls = queryAll(document, selector);
    if (!selectorEls.length) return { url: location.href, title: document.title, selector, selectorFound: false, selectorCount: 0, note: 'No element on this page matches the selector.' };
  }

  // ── redaction ───────────────────────────────────────────────────────────────
  const SENSITIVE_NAME = /pass|secret|token|api[-_]?key|auth|session|jwt|bearer|refresh|cred|card|cvv|cvc|iban|ssn|seed|mnemonic|private|otp|wallet|sig/i;
  const SENSITIVE_AUTOCOMPLETE = /cc-number|cc-csc|one-time-code|current-password|new-password/;
  const looksSecret = v => /^[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/.test(v) || /\beyJ[\w-]{10,}\.[\w-]{10,}/.test(v) || (/^[A-Za-z0-9_+/=-]{32,}$/.test(v) && /[0-9]/.test(v) && /[A-Za-z]/.test(v));
  const looksSeed = v => /^\s*([a-z]{3,8}\s+){11,23}[a-z]{3,8}\s*$/.test(v);
  function fieldValue(e) {
    const v = e.value || '';
    if (e.type === 'password' || SENSITIVE_AUTOCOMPLETE.test(e.autocomplete || '') || SENSITIVE_NAME.test((e.name || '') + ' ' + (e.id || '')) || looksSecret(v) || looksSeed(v)) return v ? '***' : '';
    return v;
  }
  const storageValue = (k, v) => (SENSITIVE_NAME.test(k) || looksSecret(v) || looksSeed(v)) ? '[redacted]' : v.substring(0, 200);

  const r = { url: location.href, title: document.title, readyState: document.readyState };
  const store = globalThis.__exnosStore;
  r.capture = store ? 'console and network captured since this page loaded' : 'no console or network capture on this page yet: it was open before Exnos could read this site. Reload the tab to start capturing.';

  try {
    const f = document.activeElement;
    if (f && f !== document.body) r.focus = { tag: f.tagName.toLowerCase(), id: f.id || null, name: f.name || null, type: f.type || null, value: 'value' in f ? fieldValue(f) : null };
  } catch {}

  r.fields = queryAll(document, 'input,select,textarea').map(e => {
    if (!includeHidden && !isVisible(e)) return null;
    return { tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name || e.id || '', value: fieldValue(e), checked: !!e.checked, disabled: !!e.disabled, placeholder: e.placeholder || '', visible: isComputedVisible(e), selector: e.id ? '#' + e.id : e.name ? e.tagName.toLowerCase() + '[name="' + e.name + '"]' : '' };
  }).filter(Boolean);

  r.buttons = queryAll(document, 'button,[role=button],input[type=submit],input[type=button]').map(e => {
    if (!includeHidden && !isVisible(e)) return null;
    const t = (e.textContent || e.value || '').trim().substring(0, 60);
    return t ? { text: t, disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', visible: isComputedVisible(e), selector: e.id ? '#' + e.id : '' } : null;
  }).filter(Boolean);

  r.checkboxes = queryAll(document, 'input[type=checkbox],input[type=radio]').map(e => {
    if (!includeHidden && !isVisible(e)) return null;
    const label = (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.name || e.id || '';
    return { label, checked: !!e.checked, disabled: !!e.disabled, selector: e.id ? '#' + e.id : e.name ? 'input[name="' + e.name + '"]' : '' };
  }).filter(Boolean);

  r.alerts = queryAll(document, '[role=alert],[class*=error],[class*=success],[class*=warning],[class*=notice]').map(e => {
    if (!isVisible(e)) return null;
    const t = e.textContent.trim();
    return t.length > 0 && t.length < 500 ? t : null;
  }).filter(Boolean);

  // ── captured: errors, warnings and failed resources, counted separately ───────
  const logs = store ? store.logs : [];
  const pick = kind => logs.filter(l => l.kind === kind).slice(-20).map(l => ({ text: l.text, uncaught: l.uncaught || undefined, t: l.t }));
  r.errors = pick('error');
  r.warnings = pick('warning');
  r.failedResources = pick('resource').map(x => x.text);
  r.counts = { errors: logs.filter(l => l.kind === 'error').length, uncaught: logs.filter(l => l.kind === 'error' && l.uncaught).length, warnings: logs.filter(l => l.kind === 'warning').length, failedResources: logs.filter(l => l.kind === 'resource').length };

  // ── network: this site's requests by default; others only on request ─────────
  const siteOf = host => {
    if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return host;
    const p = host.split('.');
    const two = p.slice(-2).join('.');
    return p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go)$/.test(p[p.length - 2]) ? p.slice(-3).join('.') : two;
  };
  const here = siteOf(location.hostname);
  const reqs = store ? store.requests : [];
  const isFirst = x => { try { return siteOf(new URL(x.url).hostname) === here; } catch { return true; } };
  const scoped = thirdParty ? reqs : reqs.filter(isFirst);
  const failed = scoped.filter(x => !x.ok).slice(-30), ok = scoped.filter(x => x.ok).slice(-20);
  r.requests = [...failed, ...ok].sort((a, b) => a.t - b.t).map(({ ch, ...x }) => x);
  if (!thirdParty) { const n = reqs.length - scoped.length; if (n) r.otherSiteRequests = n + ' request(s) to other sites not shown (pass thirdParty: true to include them)'; }
  r.wsFrames = store ? store.ws.slice(-30).map(({ ch, ...x }) => x) : [];

  // ── storage and cookies: only when asked, with credentials redacted ───────────
  if (includeStorage) {
    r.storage = {};
    for (const [name, s] of [['local', window.localStorage], ['session', window.sessionStorage]]) {
      try { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = storageValue(k, s.getItem(k) || ''); } r.storage[name] = o; } catch { r.storage[name] = null; }
    }
    try {
      r.storage.cookies = document.cookie ? document.cookie.split(/;\s*/).map(c => { const i = c.indexOf('='); const k = i < 0 ? c : c.slice(0, i), v = i < 0 ? '' : c.slice(i + 1); return k + '=' + storageValue(k, v); }).join('; ').substring(0, 1000) : null;
    } catch { r.storage.cookies = null; }
  }

  r.performance = {};
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) { r.performance.pageLoadMs = Math.round(nav.loadEventEnd - nav.startTime); r.performance.domReadyMs = Math.round(nav.domContentLoadedEventEnd - nav.startTime); r.performance.ttfbMs = Math.round(nav.responseStart - nav.startTime); }
    const paints = {}; for (const e of performance.getEntriesByType('paint')) paints[e.name] = Math.round(e.startTime);
    if (Object.keys(paints).length) r.performance.paint = paints;
  } catch {}

  const scrollH = document.documentElement.scrollHeight;
  r.scroll = { top: Math.round(scrollY), viewH: vh, totalH: scrollH, atBottom: scrollY + vh >= scrollH - 10 };

  try {
    const frameData = []; let cross = 0;
    for (const f of document.querySelectorAll('iframe')) {
      try { const doc = f.contentDocument; if (!doc) { cross++; continue; } frameData.push({ src: f.src || null, title: doc.title || null, text: (doc.body && doc.body.innerText || '').substring(0, 500) }); } catch { cross++; }
    }
    if (frameData.length) r.iframes = frameData;
    if (cross) r.crossOriginIframes = cross + ' cross-origin iframe(s) not readable';
  } catch {}

  try {
    const meta = {};
    const q = s => document.querySelector(s);
    if (q('meta[name=viewport]')) meta.viewport = q('meta[name=viewport]').content;
    if (q('meta[http-equiv="Content-Security-Policy"]')) meta.csp = q('meta[http-equiv="Content-Security-Policy"]').content.substring(0, 300);
    if (q('meta[property="og:title"]')) meta.ogTitle = q('meta[property="og:title"]').content;
    if (Object.keys(meta).length) r.meta = meta;
  } catch {}

  if (selectorEls) {
    const el = selectorEls[0], b = el.getBoundingClientRect(), s = getComputedStyle(el);
    r.selector = selector; r.selectorFound = true; r.selectorCount = selectorEls.length;
    r.selectorText = (el.innerText || el.textContent || ('value' in el ? fieldValue(el) : '') || '').substring(0, 2000);
    r.selectorVisible = isComputedVisible(el) && inViewport(b);
    r.selectorHTML = el.outerHTML.replace(/(\svalue=")[^"]*(")/gi, (m, a, z) => ('value' in el && fieldValue(el) === '***') ? a + '***' + z : m).substring(0, 2000);
    r.selectorBounds = { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
    r.selectorStyles = { display: s.display, visibility: s.visibility, opacity: s.opacity, position: s.position, color: s.color, backgroundColor: s.backgroundColor, fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily.substring(0, 100), padding: s.padding, margin: s.margin, border: s.border, zIndex: s.zIndex, overflow: s.overflow, transform: s.transform !== 'none' ? s.transform : null, transition: s.transition !== 'all 0s ease 0s' ? s.transition : null };
  }

  r.text = document.body ? document.body.innerText.substring(0, MAX_TEXT) : '';
  return r;
}
