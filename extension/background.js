// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). MIT license.
// Exnos service worker. Holds a WebSocket to the local Exnos MCP server and
// answers its verification requests by extracting live state from real tabs.
// The extension is the eyes; the MCP server is the mouth. Nothing here ever
// writes to a page: Exnos is strictly read-only by design.

const PORT = 17872;
let ws = null;

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

// Reconnect insurance: the alarm re-fires even if the service worker was
// suspended, and any firing while disconnected re-dials the server.
chrome.alarms.create('exnos-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);
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

async function handle(cmd, args) {
  if (cmd === 'tabs') {
    const all = await chrome.tabs.query({});
    return all.map(t => ({ title: t.title || '', url: t.url || '', active: !!t.active }));
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
      args: [args.selector || null]
    });
    const state = res && res[0] ? res[0].result : null;
    if (!state) throw new Error('State extraction returned nothing (page may still be loading)');
    return state;
  }
  throw new Error('Unknown command: ' + cmd);
}

// Runs INSIDE the page. Morphed from GOL control/browser.cjs `state`:
// every visible field, button, and checkbox with its live value and disabled
// state, visible alerts, console errors from the tap, scroll position, text.
function extractState(selector) {
  const r = {};
  r.url = location.href;
  r.title = document.title;
  r.readyState = document.readyState;
  const vw = window.innerWidth, vh = window.innerHeight;

  function vis(b) {
    return b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < vw && b.top < vh;
  }

  r.fields = [...document.querySelectorAll('input,select,textarea')].map(e => {
    const b = e.getBoundingClientRect();
    if (!vis(b)) return null;
    return {
      tag: e.tagName.toLowerCase(),
      type: e.type || '',
      name: e.name || e.id || '',
      value: e.type === 'password' ? '***' : (e.value || ''),
      checked: !!e.checked,
      disabled: !!e.disabled,
      placeholder: e.placeholder || '',
      selector: e.id ? '#' + e.id : e.name ? e.tagName.toLowerCase() + '[name="' + e.name + '"]' : ''
    };
  }).filter(Boolean);

  r.buttons = [...document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')].map(e => {
    const b = e.getBoundingClientRect();
    if (!vis(b)) return null;
    const t = (e.textContent || e.value || '').trim().substring(0, 60);
    if (!t) return null;
    return {
      text: t,
      disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
      selector: e.id ? '#' + e.id : ''
    };
  }).filter(Boolean);

  r.checkboxes = [...document.querySelectorAll('input[type=checkbox],input[type=radio]')].map(e => {
    const b = e.getBoundingClientRect();
    if (!vis(b)) return null;
    const label = (e.labels && e.labels[0] && e.labels[0].textContent.trim()) || e.name || e.id || '';
    return {
      label,
      checked: !!e.checked,
      disabled: !!e.disabled,
      selector: e.id ? '#' + e.id : e.name ? 'input[name="' + e.name + '"]' : ''
    };
  }).filter(Boolean);

  r.alerts = [...document.querySelectorAll('[role=alert],[class*=error],[class*=success],[class*=warning],[class*=notice]')].map(e => {
    const b = e.getBoundingClientRect();
    if (!vis(b)) return null;
    const t = e.textContent.trim();
    return t.length > 0 && t.length < 500 ? t : null;
  }).filter(Boolean);

  r.errors = (window.__exnos && window.__exnos.errors) ? window.__exnos.errors.slice(-20) : [];

  const scrollH = document.documentElement.scrollHeight;
  const scrollTop = window.scrollY;
  r.scroll = { top: Math.round(scrollTop), viewH: vh, totalH: scrollH, atBottom: scrollTop + vh >= scrollH - 10 };

  if (selector) {
    const el = document.querySelector(selector);
    r.selector = selector;
    r.selectorFound = !!el;
    if (el) {
      const b = el.getBoundingClientRect();
      r.selectorText = (el.innerText || el.textContent || el.value || '').substring(0, 2000);
      r.selectorVisible = vis(b);
      r.selectorHTML = el.outerHTML.substring(0, 1000);
    }
  }

  r.text = document.body ? document.body.innerText.substring(0, 3000) : '';
  return r;
}
