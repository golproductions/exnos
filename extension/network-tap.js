// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). See LICENSE.
// Exnos network tap. Runs in MAIN world at document_start, intercepts every
// fetch and XHR, and stores the result in window.__exnos.requests so
// exnos_verify can surface failed API calls and response bodies.
(() => {
  if (window.__exnos && window.__exnos._netTapped) return;
  if (!window.__exnos) window.__exnos = {};
  if (!window.__exnos.requests) window.__exnos.requests = [];
  window.__exnos._netTapped = true;

  const MAX = 100;
  const MAX_BODY = 2000;

  function push(entry) {
    if (window.__exnos.requests.length >= MAX) window.__exnos.requests.shift();
    window.__exnos.requests.push(entry);
  }

  function isTextType(ct) {
    return ct && (ct.includes('json') || ct.includes('text') || ct.includes('html') || ct.includes('xml') || ct.includes('javascript'));
  }

  // --- fetch ---
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const url = (typeof input === 'string' ? input : (input && input.url) || String(input)).substring(0, 300);
    const method = ((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const t0 = Date.now();
    const entry = { type: 'fetch', url, method, status: null, ok: null, ms: null, body: null, contentType: null, error: null, t: t0 };
    try {
      const res = await origFetch(input, init);
      entry.status = res.status;
      entry.ok = res.ok;
      entry.ms = Date.now() - t0;
      const ct = res.headers.get('content-type') || '';
      entry.contentType = ct.split(';')[0].trim() || null;
      if (isTextType(ct)) {
        try { entry.body = (await res.clone().text()).substring(0, MAX_BODY); } catch {}
      }
      push(entry);
      return res;
    } catch (e) {
      entry.error = String((e && e.message) || e);
      entry.ms = Date.now() - t0;
      push(entry);
      throw e;
    }
  };

  // --- XHR ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__exnosMethod = String(method || 'GET').toUpperCase();
    this.__exnosUrl = String(url || '').substring(0, 300);
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    const t0 = Date.now();
    const entry = { type: 'xhr', url: this.__exnosUrl || '', method: this.__exnosMethod || 'GET', status: null, ok: null, ms: null, body: null, contentType: null, error: null, t: t0 };
    this.addEventListener('loadend', function() {
      entry.status = this.status;
      entry.ok = this.status >= 200 && this.status < 300;
      entry.ms = Date.now() - t0;
      const ct = this.getResponseHeader('content-type') || '';
      entry.contentType = ct.split(';')[0].trim() || null;
      if (isTextType(ct)) {
        try { entry.body = (this.responseText || '').substring(0, MAX_BODY); } catch {}
      }
      push(entry);
    });
    this.addEventListener('error', function() {
      entry.error = 'network error';
      entry.ms = Date.now() - t0;
      push(entry);
    });
    this.addEventListener('abort', function() {
      entry.error = 'aborted';
      entry.ms = Date.now() - t0;
      push(entry);
    });
    return origSend.apply(this, arguments);
  };
})();
