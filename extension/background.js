// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). See LICENSE.
// Exnos service worker. Holds a WebSocket to the local Exnos MCP server and
// answers its verification requests by extracting live state from real tabs.
// The extension is the eyes; the MCP server is the mouth. Nothing here ever
// writes to a page: Exnos is strictly read-only by design.

const PORT = 17872;
let ws = null;
let lastState = new Map(); // tabId -> hash of last state (for diff detection)

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
    // Any message wakes the service worker - reconnect if needed
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
chrome.alarms.create('exnos-keepalive', { periodInMinutes: 1 / 3 }); // ~20s
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'exnos-keepalive') {
    // Any real Chrome API call resets the service worker idle timer.
    chrome.action.getBadgeText({}, () => {});
    return;
  }
  connect();
});
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

async function pickTab(filter) {
  const all = await chrome.tabs.query({});
  if (filter) {
    const f = String(filter).toLowerCase();
    const t = all.find(t => (t.url || '').toLowerCase().includes(f) || (t.title || '').toLowerCase().includes(f));
    if (t) return t;
    throw new Error('No tab matching: ' + filter + '. Open tabs: ' + all.map(t => t.title).join(' | ').substring(0, 300));
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active || all.find(t => t.active) || all[0];
}

// Simple hash for state comparison
function hashState(state) {
  const key = JSON.stringify({
    url: state.url,
    errors: state.errors?.length || 0,
    fields: state.fields?.map(f => f.value).join('|'),
    text: state.text?.substring(0, 500)
  });
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return h;
}

async function handle(cmd, args) {
  if (cmd === 'tabs') {
    const all = await chrome.tabs.query({});
    return all.map(t => ({ title: t.title || '', url: t.url || '', active: !!t.active }));
  }

  if (cmd === 'screenshot') {
    const tab = await pickTab(args.tab);
    if (!tab) throw new Error('No tabs open');
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return {
        url: tab.url,
        title: tab.title,
        screenshot: dataUrl,
        width: tab.width,
        height: tab.height
      };
    } catch (e) {
      throw new Error('Screenshot failed: ' + e.message);
    }
  }

  if (cmd === 'state') {
    const tab = await pickTab(args.tab);
    if (!tab) throw new Error('No tabs open');
    if (!/^(https?|file):/.test(tab.url || '')) {
      return { url: tab.url, title: tab.title, note: 'Internal page (' + (tab.url || '').split('/')[0] + '); state extraction only works on http/https/file pages.' };
    }
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractState,
      args: [args.selector || null, args.includeHidden || false]
    });
    const state = res && res[0] ? res[0].result : null;
    if (!state) throw new Error('State extraction returned nothing (page may still be loading)');

    // Compute diff from last state
    const currentHash = hashState(state);
    const prevHash = lastState.get(tab.id);
    if (prevHash !== undefined) {
      state.changed = currentHash !== prevHash;
    }
    lastState.set(tab.id, currentHash);

    // Add screenshot if requested
    if (args.screenshot) {
      try {
        state.screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      } catch (e) {
        state.screenshotError = e.message;
      }
    }

    return state;
  }
  throw new Error('Unknown command: ' + cmd);
}

// ─── extractState ─────────────────────────────────────────────────────────────
// Runs INSIDE the page (MAIN world). Returns the full observable state of the
// page: DOM, storage, network, performance, focus, computed visibility.
function extractState(selector, includeHidden) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const MAX_TEXT = 3000;
  const MAX_BODY = 500;

  // ── helpers ──────────────────────────────────────────────────────────────────

  function inViewport(b) {
    return b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < vw && b.top < vh;
  }

  function isComputedVisible(el) {
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0;
  }

  function isVisible(el) {
    const b = el.getBoundingClientRect();
    return inViewport(b) && isComputedVisible(el);
  }

  // Collect elements from the entire DOM including shadow roots, piercing depth-first.
  function queryAll(root, sel) {
    const results = [];
    function walk(node) {
      try {
        results.push(...Array.from(node.querySelectorAll(sel)));
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
        let cur = walker.nextNode();
        while (cur) {
          if (cur.shadowRoot) walk(cur.shadowRoot);
          cur = walker.nextNode();
        }
      } catch {}
    }
    walk(root);
    return results;
  }

  const r = {};

  // ── identity ─────────────────────────────────────────────────────────────────
  r.url        = location.href;
  r.title      = document.title;
  r.readyState = document.readyState;

  // ── focus ────────────────────────────────────────────────────────────────────
  try {
    const f = document.activeElement;
    if (f && f !== document.body) {
      r.focus = {
        tag: f.tagName.toLowerCase(),
        id: f.id || null,
        name: f.name || null,
        type: f.type || null,
        value: f.type === 'password' ? '***' : (f.value || null)
      };
    }
  } catch {}

  // ── fields ───────────────────────────────────────────────────────────────────
  r.fields = queryAll(document, 'input,select,textarea').map(e => {
    if (!includeHidden && !isVisible(e)) return null;
    return {
      tag: e.tagName.toLowerCase(),
      type: e.type || '',
      name: e.name || e.id || '',
      value: e.type === 'password' ? '***' : (e.value || ''),
      checked: !!e.checked,
      disabled: !!e.disabled,
      placeholder: e.placeholder || '',
      visible: isComputedVisible(e),
      selector: e.id ? '#' + e.id : e.name ? e.tagName.toLowerCase() + '[name="' + e.name + '"]' : ''
    };
  }).filter(Boolean);

  // ── buttons ──────────────────────────────────────────────────────────────────
  r.buttons = queryAll(document, 'button,[role=button],input[type=submit],input[type=button]').map(e => {
    if (!includeHidden && !isVisible(e)) return null;
    const t = (e.textContent || e.value || '').trim().substring(0, 60);
    if (!t) return null;
    return {
      text: t,
      disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
      visible: isComputedVisible(e),
      selector: e.id ? '#' + e.id : ''
    };
  }).filter(Boolean);

  // ── checkboxes ───────────────────────────────────────────────────────────────
  r.checkboxes = queryAll(document, 'input[type=checkbox],input[type=radio]').map(e => {
    if (!includeHidden && !isVisible(e)) return null;
    const label = (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.name || e.id || '';
    return {
      label,
      checked: !!e.checked,
      disabled: !!e.disabled,
      selector: e.id ? '#' + e.id : e.name ? 'input[name="' + e.name + '"]' : ''
    };
  }).filter(Boolean);

  // ── alerts ───────────────────────────────────────────────────────────────────
  r.alerts = queryAll(document, '[role=alert],[class*=error],[class*=success],[class*=warning],[class*=notice]').map(e => {
    if (!isVisible(e)) return null;
    const t = e.textContent.trim();
    return t.length > 0 && t.length < 500 ? t : null;
  }).filter(Boolean);

  // ── errors (from console-tap.js) ─────────────────────────────────────────────
  r.errors = (window.__exnos && window.__exnos.errors) ? window.__exnos.errors.slice(-20) : [];

  // ── network requests (from network-tap.js) ───────────────────────────────────
  r.requests = [];
  if (window.__exnos && window.__exnos.requests) {
    const reqs = window.__exnos.requests;
    // surface failures first, then most recent successful, capped at 50
    const failed  = reqs.filter(x => !x.ok || x.error).slice(-30);
    const recent  = reqs.filter(x => x.ok && !x.error).slice(-20);
    r.requests = [...failed, ...recent].sort((a, b) => a.t - b.t);
  }

  // ── WebSocket frames (from console-tap.js) ───────────────────────────────────
  r.wsFrames = (window.__exnos && window.__exnos.wsFrames) ? window.__exnos.wsFrames.slice(-30) : [];

  // ── storage ──────────────────────────────────────────────────────────────────
  r.storage = {};
  try {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      let v = localStorage.getItem(k) || '';
      ls[k] = v.substring(0, 200);
    }
    r.storage.local = ls;
  } catch { r.storage.local = null; }

  try {
    const ss = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      let v = sessionStorage.getItem(k) || '';
      ss[k] = v.substring(0, 200);
    }
    r.storage.session = ss;
  } catch { r.storage.session = null; }

  try {
    r.storage.cookies = document.cookie.substring(0, 1000) || null;
  } catch { r.storage.cookies = null; }

  // ── performance ──────────────────────────────────────────────────────────────
  r.performance = {};
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      r.performance.pageLoadMs   = Math.round(nav.loadEventEnd - nav.startTime);
      r.performance.domReadyMs   = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
      r.performance.ttfbMs       = Math.round(nav.responseStart - nav.startTime);
    }
  } catch {}

  try {
    const paints = {};
    for (const e of performance.getEntriesByType('paint')) paints[e.name] = Math.round(e.startTime);
    if (Object.keys(paints).length) r.performance.paint = paints;
  } catch {}

  try {
    const longTasks = performance.getEntriesByType('longtask').map(e => ({
      ms: Math.round(e.duration), start: Math.round(e.startTime)
    }));
    if (longTasks.length) r.performance.longTasks = longTasks.slice(-10);
  } catch {}

  try {
    const mem = performance.memory;
    if (mem) r.performance.heapMB = Math.round(mem.usedJSHeapSize / 1048576);
  } catch {}

  // ── scroll ───────────────────────────────────────────────────────────────────
  const scrollH = document.documentElement.scrollHeight;
  const scrollTop = window.scrollY;
  r.scroll = { top: Math.round(scrollTop), viewH: vh, totalH: scrollH, atBottom: scrollTop + vh >= scrollH - 10 };

  // ── iframes (same-origin + cross-origin count) ───────────────────────────────
  try {
    const frames = Array.from(document.querySelectorAll('iframe'));
    const frameData = [];
    let crossOriginCount = 0;
    for (const f of frames) {
      try {
        const doc = f.contentDocument;
        if (!doc) {
          crossOriginCount++;
          continue;
        }
        frameData.push({
          src: f.src || null,
          title: doc.title || null,
          text: (doc.body && doc.body.innerText || '').substring(0, 500),
          errors: (f.contentWindow && f.contentWindow.__exnos && f.contentWindow.__exnos.errors) || []
        });
      } catch {
        crossOriginCount++;
      }
    }
    if (frameData.length) r.iframes = frameData;
    if (crossOriginCount > 0) r.crossOriginIframes = crossOriginCount + ' cross-origin iframe(s) not readable';
  } catch {}

  // ── global app state (window.__*) ────────────────────────────────────────────
  try {
    const appGlobals = {};
    for (const key of Object.keys(window)) {
      if (!key.startsWith('__') || key === '__exnos') continue;
      try {
        const val = window[key];
        if (val === null || typeof val === 'undefined') continue;
        if (typeof val === 'function') continue;
        const str = JSON.stringify(val);
        if (str && str.length < 500) appGlobals[key] = val;
      } catch {}
    }
    if (Object.keys(appGlobals).length) r.appGlobals = appGlobals;
  } catch {}

  // ── meta (CSP, viewport, og tags) ───────────────────────────────────────────
  try {
    const meta = {};
    const viewport = document.querySelector('meta[name=viewport]');
    if (viewport) meta.viewport = viewport.content;
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (csp) meta.csp = csp.content.substring(0, 300);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) meta.ogTitle = ogTitle.content;
    if (Object.keys(meta).length) r.meta = meta;
  } catch {}

  // ── selector deep-dive with full computed styles ─────────────────────────────
  if (selector) {
    r.selector = selector;
    const results = queryAll(document, selector);
    r.selectorFound = results.length > 0;
    r.selectorCount = results.length;
    if (results[0]) {
      const el = results[0];
      const b = el.getBoundingClientRect();
      r.selectorText    = (el.innerText || el.textContent || el.value || '').substring(0, 2000);
      r.selectorVisible = isComputedVisible(el) && inViewport(b);
      r.selectorHTML    = el.outerHTML.substring(0, 2000);
      r.selectorBounds  = { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
      r.selectorStyles  = (() => {
        try {
          const s = window.getComputedStyle(el);
          return {
            display: s.display,
            visibility: s.visibility,
            opacity: s.opacity,
            position: s.position,
            color: s.color,
            backgroundColor: s.backgroundColor,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            fontFamily: s.fontFamily.substring(0, 100),
            padding: s.padding,
            margin: s.margin,
            border: s.border,
            zIndex: s.zIndex,
            overflow: s.overflow,
            transform: s.transform !== 'none' ? s.transform : null,
            transition: s.transition !== 'all 0s ease 0s' ? s.transition : null
          };
        } catch { return null; }
      })();
    }
  }

  // ── visible text ─────────────────────────────────────────────────────────────
  r.text = document.body ? document.body.innerText.substring(0, MAX_TEXT) : '';

  return r;
}
