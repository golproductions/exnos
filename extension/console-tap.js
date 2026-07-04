// Exnos console tap. Runs in the page's MAIN world at document_start so it
// catches every console.error/warn, uncaught exception, and unhandled promise
// rejection from page load onward. Exnos verify reads window.__exnos.errors.
(() => {
  if (window.__exnos) return;
  const log = [];
  const MAX = 50;
  const push = (kind, text) => {
    if (log.length >= MAX) log.shift();
    log.push({ kind, text: String(text).substring(0, 500), t: Date.now() });
  };
  window.__exnos = { errors: log };

  const oErr = console.error.bind(console);
  console.error = (...a) => { push('console.error', a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); oErr(...a); };
  const oWarn = console.warn.bind(console);
  console.warn = (...a) => { push('console.warn', a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); oWarn(...a); };

  window.addEventListener('error', e => {
    push('uncaught', (e.message || 'error') + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', e => {
    let r = e.reason;
    push('unhandled-rejection', r && r.message ? r.message : String(r));
  });
})();
