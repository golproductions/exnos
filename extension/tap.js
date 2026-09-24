// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). See LICENSE.
// Exnos tap. Runs in the page's MAIN world at document_start, on allowed sites only.
// Records console errors and warnings, uncaught exceptions, failed resource loads,
// fetch/XHR results and WebSocket frames, and hands each record to the Exnos
// collector (collector.js, isolated world). Nothing is stored on window: the page
// cannot read what Exnos captured.
//
// The channel: a random event name agreed with the collector before any page
// script runs (both scripts run at document_start). Records travel as CustomEvents
// on that name. References to the DOM APIs used are taken first, so a page that
// patches them later cannot see or redirect the records.
(() => {
  const D = document;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const listen = EventTarget.prototype.addEventListener;
  const unlisten = EventTarget.prototype.removeEventListener;
  const CE = CustomEvent;
  const stringify = JSON.stringify;
  // Registered content scripts run once per document, so no marker is left on
  // window for a page to detect. Exnos never injects this into an already-open
  // page: page scripts would already be running and could watch the handshake.

  const nonce = 'exnos:' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(36)).join('');
  let ready = false;
  const queue = [];
  function send(rec) {
    rec.t = Date.now();
    if (!ready) { if (queue.length < 200) queue.push(rec); return; }
    try { dispatch.call(D, new CE(nonce, { detail: stringify(rec) })); } catch {}
  }
  function hello() { try { dispatch.call(D, new CE('exnos:hello', { detail: nonce })); } catch {} }
  function onReady() {
    unlisten.call(D, 'exnos:ready', onReady);
    hello();
  }
  // The collector answers 'exnos:ready' when it is listening, and accepts only the
  // first hello. Whichever script runs first, the handshake completes before any
  // page script can take part.
  listen.call(D, 'exnos:ready', onReady);
  listen.call(D, 'exnos:ack:' + nonce, function ack() {
    unlisten.call(D, 'exnos:ack:' + nonce, ack);
    unlisten.call(D, 'exnos:ready', onReady);
    ready = true;
    for (const r of queue.splice(0)) send(r);
  });
  hello();

  // ── text of console arguments: Errors keep their message and stack ──────────
  function argText(x) {
    if (typeof x === 'string') return x;
    if (x instanceof Error) return (x.name || 'Error') + ': ' + x.message + (x.stack ? '\n' + String(x.stack).split('\n').slice(1, 8).join('\n') : '');
    try { const s = stringify(x); return s === undefined ? String(x) : s; } catch { return String(x); }
  }
  const text = a => a.map(argText).join(' ').substring(0, 1500);

  const oErr = console.error, oWarn = console.warn;
  console.error = function (...a) { send({ ch: 'log', kind: 'error', text: text(a) }); return oErr.apply(this, a); };
  console.warn = function (...a) { send({ ch: 'log', kind: 'warning', text: text(a) }); return oWarn.apply(this, a); };

  // Capture phase sees both script exceptions (target: window) and resources that
  // failed to load (target: the element). They are different things; label them.
  listen.call(window, 'error', e => {
    const el = e.target;
    if (el && el !== window && el.tagName) {
      send({ ch: 'log', kind: 'resource', text: el.tagName.toLowerCase() + ' failed to load: ' + String(el.currentSrc || el.src || el.href || '').substring(0, 300) });
      return;
    }
    const where = e.filename ? ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno : '';
    const stack = e.error && e.error.stack ? '\n' + String(e.error.stack).split('\n').slice(1, 8).join('\n') : '';
    send({ ch: 'log', kind: 'error', uncaught: true, text: ((e.message || 'Script error') + where + stack).substring(0, 1500) });
  }, true);
  listen.call(window, 'unhandledrejection', e => {
    const r = e.reason;
    send({ ch: 'log', kind: 'error', uncaught: true, text: ('Unhandled rejection: ' + (r instanceof Error ? argText(r) : argText(r))).substring(0, 1500) });
  });

  // ── fetch / XHR ──────────────────────────────────────────────────────────────
  const MAX_BODY = 1000;
  const isText = ct => ct && /json|text|html|xml|javascript/.test(ct);
  const abs = u => { try { return new URL(u, location.href).href; } catch { return String(u); } };

  const oFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = abs(typeof input === 'string' ? input : (input && input.url) || String(input)).substring(0, 300);
    const method = ((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const t0 = Date.now();
    try {
      const res = await oFetch.apply(this, arguments);
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
      let body = null;
      if (isText(ct)) { try { body = (await res.clone().text()).substring(0, MAX_BODY); } catch {} }
      send({ ch: 'net', type: 'fetch', url, method, status: res.status, ok: res.ok, ms: Date.now() - t0, contentType: ct || null, body });
      return res;
    } catch (e) {
      send({ ch: 'net', type: 'fetch', url, method, status: null, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) });
      throw e;
    }
  };

  const oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
  const meta = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url) {
    meta.set(this, { method: String(method || 'GET').toUpperCase(), url: abs(url || '').substring(0, 300) });
    return oOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const m = meta.get(this) || { method: 'GET', url: '' };
    const t0 = Date.now();
    let failure = null;
    listen.call(this, 'error', () => { failure = 'network error'; });
    listen.call(this, 'abort', () => { failure = 'aborted'; });
    listen.call(this, 'timeout', () => { failure = 'timed out'; });
    // loadend fires once for every outcome: one record per request.
    listen.call(this, 'loadend', () => {
      const ct = ((this.getResponseHeader && this.getResponseHeader('content-type')) || '').split(';')[0].trim();
      let body = null;
      if (!failure && isText(ct)) { try { body = String(this.responseText || '').substring(0, MAX_BODY); } catch {} }
      send({ ch: 'net', type: 'xhr', url: m.url, method: m.method, status: this.status || null, ok: !failure && this.status >= 200 && this.status < 300, ms: Date.now() - t0, contentType: ct || null, body, error: failure });
    });
    return oSend.apply(this, arguments);
  };

  // ── WebSocket frames ─────────────────────────────────────────────────────────
  const OrigWS = window.WebSocket;
  const MAX_WS = 300;
  function ExnosWebSocket(url, protocols) {
    const sock = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    const u = String(url).substring(0, 200);
    const oWsSend = sock.send;
    sock.send = function (data) {
      send({ ch: 'ws', dir: 'send', url: u, data: typeof data === 'string' ? data.substring(0, MAX_WS) : '[binary ' + (data && data.byteLength != null ? data.byteLength : '?') + 'b]' });
      return oWsSend.apply(this, arguments);
    };
    listen.call(sock, 'message', e => send({ ch: 'ws', dir: 'recv', url: u, data: typeof e.data === 'string' ? e.data.substring(0, MAX_WS) : '[binary]' }));
    listen.call(sock, 'error', () => send({ ch: 'ws', dir: 'error', url: u, data: 'connection error' }));
    listen.call(sock, 'close', e => send({ ch: 'ws', dir: 'close', url: u, data: 'code ' + e.code + (e.reason ? ' ' + e.reason : '') }));
    return sock;
  }
  ExnosWebSocket.prototype = OrigWS.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) ExnosWebSocket[k] = OrigWS[k];
  window.WebSocket = ExnosWebSocket;
})();
