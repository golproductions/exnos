// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). See LICENSE.
// Exnos collector. Runs in the extension's ISOLATED world at document_start, on
// allowed sites only. Receives records from tap.js over the channel agreed in the
// handshake and keeps them here, where page scripts cannot read or change them.
// extractState (background.js) runs in this same isolated world and reads them.
(() => {
  if (globalThis.__exnosStore) return;
  const store = globalThis.__exnosStore = { logs: [], requests: [], ws: [], since: Date.now() };
  const cap = (arr, max, rec) => { if (arr.length >= max) arr.shift(); arr.push(rec); };
  let accepted = false;
  function onHello(e) {
    if (accepted || typeof e.detail !== 'string' || !e.detail.startsWith('exnos:')) return;
    accepted = true;
    document.removeEventListener('exnos:hello', onHello);
    const nonce = e.detail;
    document.addEventListener(nonce, ev => {
      let r; try { r = JSON.parse(ev.detail); } catch { return; }
      if (r.ch === 'log') cap(store.logs, 100, r);
      else if (r.ch === 'net') cap(store.requests, 150, r);
      else if (r.ch === 'ws') cap(store.ws, 100, r);
    });
    document.dispatchEvent(new CustomEvent('exnos:ack:' + nonce));
  }
  document.addEventListener('exnos:hello', onHello);
  document.dispatchEvent(new CustomEvent('exnos:ready'));
})();
