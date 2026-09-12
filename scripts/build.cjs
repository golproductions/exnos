'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const src  = path.join(root, 'server', 'exnos-mcp.cjs');
const dist = path.join(root, 'dist');
const out  = path.join(dist, 'exnos-mcp.min.cjs');

fs.mkdirSync(dist, { recursive: true });

// Strip BOM — a prior PowerShell edit left one on the source file, which
// silently defeated the startsWith('#!') check below (shebang computed as '').
const source = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');

// Preserve the shebang — obfuscator strips it
const shebang = source.startsWith('#!') ? source.split('\n')[0] + '\n' : '';
const body = shebang ? source.slice(shebang.length) : source;

execSync(
  `npx --yes javascript-obfuscator "${src}" --output "${out}" ` +
  `--compact true --self-defending true --string-array true ` +
  `--string-array-encoding rc4 --string-array-threshold 0.75 ` +
  `--identifier-names-generator mangled --rename-globals false ` +
  `--transform-object-keys true --dead-code-injection false`,
  { cwd: root, stdio: 'inherit' }
);

// Re-attach shebang — strip BOM before checking, obfuscator may strip it
const obfuscated = fs.readFileSync(out, 'utf8').replace(/^﻿/, '');
const needsShebang = shebang && !obfuscated.startsWith('#!');
fs.writeFileSync(out, needsShebang ? shebang + obfuscated : obfuscated, 'utf8');

console.log('[build] Exnos MCP server obfuscated →', path.relative(root, out));
