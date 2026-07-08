#!/usr/bin/env node
'use strict';
// Exnos. Copyright (c) 2026 GOL Productions (https://golproductions.com). MIT license.
// Exnos MCP server. Zero dependencies.
// stdio side: newline-delimited JSON-RPC (MCP) for the coding agent.
// socket side: a tiny WebSocket server on 127.0.0.1 that the Exnos Chrome
// extension dials into. exnos_verify = one call, live browser truth back
// in milliseconds. Strictly read-only: Exnos never touches the page.

const http = require('http');
const crypto = require('crypto');

// `exnos path` prints where the bundled Chrome extension lives, so users can
// Load-unpack it straight from the npm install.
if (process.argv[2] === 'path') {
  console.log(require('path').join(__dirname, '..', 'extension'));
  process.exit(0);
}

// The standing rule. MCP tool descriptions get Exnos considered; a rules file
// gets it called. `exnos init` writes this into every agent rules file present
// in the current project, so the "when" survives clients that ignore MCP
// server instructions.
const RULE_MARK = '<!-- exnos:rule -->';
const RULE_TEXT = [
  '',
  RULE_MARK,
  '## Exnos: verify the browser, not your model of it',
  '',
  'This project has Exnos connected: `exnos_verify` returns the live Chrome tab state',
  '(DOM, form values, console errors, and uncaught exceptions) in milliseconds, read-only.',
  '',
  '- After every edit to HTML, CSS, or JS that a browser is rendering, call `exnos_verify`. Treat it like the read-back after a write.',
  '- The instant the user reports a page problem ("broken", "blank", "not working", "still the same"), call `exnos_verify` before reasoning about the code. The console error usually names the bug.',
  '- Never say "done", "fixed", or "deployed" for anything browser-facing without an `exnos_verify` receipt.',
  '- After a deploy or dev-server restart, verify the live tab actually got the new build.',
  '- Starting a browser-related task? Look at the page first.',
  '- No browser surface in the task? Do not call it.',
  RULE_MARK,
  ''
].join('\n');

const RULE_FILES = [
  'CLAUDE.md',                          // Claude Code
  'AGENTS.md',                          // Codex + emerging standard
  'GEMINI.md',                          // Gemini CLI
  '.windsurfrules',                     // Windsurf
  '.clinerules',                        // Cline / Roo
  '.github/copilot-instructions.md',    // GitHub Copilot
  '.cursor/rules/exnos.mdc'             // Cursor (always creatable: own file)
];

if (process.argv[2] === 'rules') {
  console.log(RULE_TEXT.trim());
  process.exit(0);
}

if (process.argv[2] === 'init') {
  const fs = require('fs');
  const path = require('path');
  const cwd = process.cwd();
  const touched = [];
  const skipped = [];
  for (const rel of RULE_FILES) {
    const file = path.join(cwd, rel);
    const exists = fs.existsSync(file);
    // Only Cursor's dedicated .mdc file is created from scratch; for shared
    // rules files we append only where the agent is evidently in use.
    const isOwnFile = rel === '.cursor/rules/exnos.mdc';
    if (isOwnFile && !fs.existsSync(path.join(cwd, '.cursor'))) continue;
    if (!exists && !isOwnFile) continue;
    const current = exists ? fs.readFileSync(file, 'utf8') : '';
    if (current.includes(RULE_MARK)) { skipped.push(rel); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const body = isOwnFile
      ? '---\ndescription: Verify live browser state with Exnos\nalwaysApply: true\n---\n' + RULE_TEXT
      : current + (current.endsWith('\n') || current === '' ? '' : '\n') + RULE_TEXT;
    fs.writeFileSync(file, body, 'utf8');
    touched.push(rel);
  }
  if (!touched.length && !skipped.length) {
    // Fresh project with no agent rules files yet: seed the emerging standard.
    const file = path.join(cwd, 'AGENTS.md');
    fs.writeFileSync(file, '# Agent instructions\n' + RULE_TEXT, 'utf8');
    touched.push('AGENTS.md (created)');
  }
  for (const f of touched) console.log('exnos rule written: ' + f);
  for (const f of skipped) console.log('exnos rule already present: ' + f);
  console.log('Re-run any time; init is idempotent.');
  process.exit(0);
}

const PORT = parseInt(process.env.EXNOS_PORT || '17872', 10);
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const REQUEST_TIMEOUT = 5000;

// ---------- WebSocket server (extension side) ----------

let ext = null;           // { socket, buf, fragments }
let nextReqId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }

function wsWrite(socket, opcode, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let hdr;
  if (p.length < 126) {
    hdr = Buffer.alloc(2); hdr[0] = 0x80 | opcode; hdr[1] = p.length;
  } else if (p.length < 65536) {
    hdr = Buffer.alloc(4); hdr[0] = 0x80 | opcode; hdr[1] = 126; hdr.writeUInt16BE(p.length, 2);
  } else {
    hdr = Buffer.alloc(10); hdr[0] = 0x80 | opcode; hdr[1] = 127;
    hdr.writeUInt32BE(0, 2); hdr.writeUInt32BE(p.length, 6);
  }
  socket.write(Buffer.concat([hdr, p]));
}

function wsReadFrame(state) {
  const buf = state.buf;
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const op = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = buf.readUInt32BE(2) * 0x100000000 + buf.readUInt32BE(6); off = 10;
  }
  if (masked) off += 4;
  if (buf.length < off + len) return null;
  let data = buf.slice(off, off + len);
  if (masked) {
    const mk = buf.slice(off - 4, off);
    data = Buffer.from(data);
    for (let i = 0; i < data.length; i++) data[i] ^= mk[i % 4];
  }
  state.buf = buf.slice(off + len);
  return { fin, op, data };
}

function onExtMessage(text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.pong) return;
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject, timer } = pending.get(msg.id);
    clearTimeout(timer);
    pending.delete(msg.id);
    if (msg.ok) resolve(msg.data);
    else reject(new Error(msg.error || 'extension error'));
  }
}

const server = http.createServer((req, res) => {
  // POST /rpc lets a second exnos instance (port already taken) proxy its
  // tool calls through the instance that owns the extension connection.
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { cmd, args } = JSON.parse(body);
        const data = await askExtension(cmd, args);
        res.end(JSON.stringify({ ok: true, data }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ exnos: true, extension: !!ext }));
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.url !== '/extension') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  // one extension at a time; newest connection wins
  if (ext) { try { ext.socket.destroy(); } catch {} }
  const state = { socket, buf: Buffer.alloc(0), fragments: [] };
  ext = state;
  socket.on('data', chunk => {
    state.buf = Buffer.concat([state.buf, chunk]);
    while (true) {
      const frame = wsReadFrame(state);
      if (!frame) break;
      if (frame.op === 8) { try { socket.end(); } catch {} return; }
      if (frame.op === 9) { wsWrite(socket, 10, frame.data); continue; }
      if (frame.op === 0) {
        state.fragments.push(frame.data);
        if (frame.fin) { onExtMessage(Buffer.concat(state.fragments).toString()); state.fragments = []; }
      } else if (frame.op === 1) {
        if (frame.fin) onExtMessage(frame.data.toString());
        else state.fragments = [frame.data];
      }
    }
  });
  const drop = () => { if (ext === state) ext = null; };
  socket.on('close', drop);
  socket.on('error', drop);
});

// keepalive: activity every 20s keeps the extension's service worker alive
setInterval(() => {
  if (ext) { try { wsWrite(ext.socket, 1, JSON.stringify({ ping: true })); } catch {} }
}, 20000);

// When another exnos instance already owns the port, we proxy through it
// instead of failing. Two agents, one Chrome, zero conflicts.
let proxyMode = false;

function askViaProxy(cmd, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ cmd, args });
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/rpc', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: REQUEST_TIMEOUT + 1000
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const msg = JSON.parse(data);
          if (msg.ok) resolve(msg.data);
          else reject(new Error(msg.error || 'proxy error'));
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Proxy to primary exnos instance timed out')); });
    req.on('error', e => reject(new Error('Port ' + PORT + ' is taken by another process that is not exnos: ' + e.message)));
    req.end(body);
  });
}

function askExtension(cmd, args) {
  if (proxyMode) return askViaProxy(cmd, args);
  return new Promise((resolve, reject) => {
    if (!ext) {
      return reject(new Error(
        'Exnos extension is not connected. Make sure Chrome is open and the Exnos extension is loaded ' +
        '(chrome://extensions -> Developer mode -> Load unpacked -> the exnos/extension folder). ' +
        'Badge should read ON.'
      ));
    }
    const id = nextReqId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Extension did not answer within ' + REQUEST_TIMEOUT + 'ms'));
    }, REQUEST_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    try { wsWrite(ext.socket, 1, JSON.stringify({ id, cmd, args })); }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
  });
}

// ---------- MCP over stdio (agent side) ----------

const TOOLS = [
  {
    name: 'exnos_verify',
    description: 'Your eyes on the user\'s live Chrome tab, in milliseconds. Use it (1) right after editing any HTML, CSS, or JS file a browser is rendering, the same way a write is followed by a read-back; (2) the instant the user reports a page problem ("broken", "blank", "not working", "still the same", "nothing happens"), the console error usually names the bug outright; (3) always before saying "done", "fixed", or "deployed" for anything with a browser-facing result; (4) after a deploy or dev-server restart, to confirm the live tab got the new build; (5) at the start of any browser-related task, to see the page before fixing it. Returns the tab\'s URL, title, every visible form field with its live value, every button with its disabled state, checkboxes, visible alerts, console errors and uncaught exceptions since page load, scroll position, and visible page text. Read-only: never modifies the page. Skip it for work with no browser surface. Exnos, free by GOL Productions.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', description: 'Optional substring to match a tab by URL or title. Defaults to the active tab.' },
        selector: { type: 'string', description: 'Optional CSS selector: also returns that element\'s text, visibility, and HTML.' }
      }
    }
  },
  {
    name: 'exnos_tabs',
    description: 'List all open Chrome tabs (title, URL, which is active). Use to find the right tab value for exnos_verify.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

let sawRpc = false;

async function onRpc(msg) {
  sawRpc = true;
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      // Single source of truth: package.json. A hardcoded string here shipped
      // 0.1.4 announcing itself as 0.1.3; never let the two drift again.
      serverInfo: { name: 'exnos', version: require('../package.json').version },
      instructions: 'Exnos gives you live, read-only access to the user\'s Chrome: DOM state, form values, and, critically, console errors and uncaught exceptions you cannot see any other way. Standing rule: if a browser is rendering the thing you are working on, look at it with exnos_verify after every change you make, the instant the user reports a problem, and always before you say it works. At millisecond cost, verification is a reflex, not a step: edit, verify, fix, verify. Reasoning about what the browser "probably" did is a model; exnos_verify is reality. Do not call it for work with no browser surface.'
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return; // notification
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      let data;
      if (name === 'exnos_verify') data = await askExtension('state', { tab: args.tab, selector: args.selector });
      else if (name === 'exnos_tabs') data = await askExtension('tabs', {});
      else return replyErr(id, -32602, 'Unknown tool: ' + name);
      let text = JSON.stringify(data, null, 2);
      // Make the payoff legible: console errors are the one thing the agent
      // cannot see any other way, so surface them above the JSON.
      if (name === 'exnos_verify' && data && Array.isArray(data.errors) && data.errors.length) {
        text = data.errors.length + ' console error(s) / uncaught exception(s) on this page. Read them before reasoning about the code:\n' + text;
      }
      return reply(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'EXNOS ERROR: ' + e.message }], isError: true });
    }
  }
  if (id !== undefined) replyErr(id, -32601, 'Method not found: ' + method);
}

let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdinBuf += chunk;
  let nl;
  while ((nl = stdinBuf.indexOf('\n')) !== -1) {
    const line = stdinBuf.slice(0, nl).trim();
    stdinBuf = stdinBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    onRpc(msg).catch(e => { if (msg.id !== undefined) replyErr(msg.id, -32603, e.message); });
  }
});
// Exit with the MCP client, but survive standalone runs (no stdin at all).
process.stdin.on('end', () => { if (sawRpc) process.exit(0); });

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // Another exnos instance owns the port. Become a proxy client instead
    // of a broken server: tool calls route through the primary over HTTP.
    proxyMode = true;
    process.stderr.write('exnos: port ' + PORT + ' in use, proxying through the primary exnos instance\n');
    return;
  }
  process.stderr.write('exnos: socket port ' + PORT + ' error: ' + e.message + '\n');
});
server.listen(PORT, '127.0.0.1', () => {
  process.stderr.write('exnos by GOL Productions: listening for extension on ws://127.0.0.1:' + PORT + '/extension\n');
});
