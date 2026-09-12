// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). See LICENSE.
// Exnos console + WebSocket tap. Runs in MAIN world at document_start.
// Captures console.error/warn, uncaught exceptions, unhandled rejections,
// and WebSocket frames (both directions) into window.__exnos.
(() => {
  if (window.__exnos && window.__exnos._consoleTapped) return;
  if (!window.__exnos) window.__exnos = {};
  window.__exnos._consoleTapped = true;

  // ── errors ──────────────────────────────────────────────────────────────────
  if (!window.__exnos.errors) window.__exnos.errors = [];
  const MAX_ERR = 50;
  const MAX_BODY = 300;

  function pushErr(kind, text) {
    const log = window.__exnos.errors;
    if (log.length >= MAX_ERR) log.shift();
    log.push({ kind, text: String(text).substring(0, 500), t: Date.now() });
  }

  const oErr = console.error.bind(console);
  console.error = (...a) => {
    pushErr('console.error', a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' '));
    oErr(...a);
  };
  const oWarn = console.warn.bind(console);
  console.warn = (...a) => {
    pushErr('console.warn', a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' '));
    oWarn(...a);
  };

  window.addEventListener('error', e => {
    pushErr('uncaught', (e.message || 'error') + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    pushErr('unhandled-rejection', r && r.message ? r.message : String(r));
  });

  // ── WebSocket frames ─────────────────────────────────────────────────────────
  if (!window.__exnos.wsFrames) window.__exnos.wsFrames = [];
  const MAX_WS = 100;

  function pushWs(entry) {
    const log = window.__exnos.wsFrames;
    if (log.length >= MAX_WS) log.shift();
    log.push(entry);
  }

  const OrigWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const sock = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    const shortUrl = String(url).substring(0, 200);

    const origSend = sock.send.bind(sock);
    sock.send = function(data) {
      let text;
      if (typeof data === 'string') text = data.substring(0, MAX_BODY);
      else text = '[binary ' + (data && data.byteLength != null ? data.byteLength : '?') + 'b]';
      pushWs({ dir: 'send', url: shortUrl, data: text, t: Date.now() });
      return origSend(data);
    };

    sock.addEventListener('message', e => {
      let text;
      if (typeof e.data === 'string') text = e.data.substring(0, MAX_BODY);
      else text = '[binary]';
      pushWs({ dir: 'recv', url: shortUrl, data: text, t: Date.now() });
    });

    sock.addEventListener('error', () => {
      pushWs({ dir: 'error', url: shortUrl, data: 'connection error', t: Date.now() });
    });

    sock.addEventListener('close', e => {
      pushWs({ dir: 'close', url: shortUrl, data: 'code ' + e.code + (e.reason ? ' ' + e.reason : ''), t: Date.now() });
    });

    return sock;
  };
  // copy static properties so `new WebSocket` still works as expected
  Object.assign(window.WebSocket, OrigWS);
  window.WebSocket.prototype = OrigWS.prototype;
})();
