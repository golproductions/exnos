#!/usr/bin/env node
// Single source of truth for the Exnos version is package.json.
// The MCP server reads it dynamically (server/exnos-mcp.cjs). The Chrome
// extension manifest cannot require() a value, so we stamp it here at pack
// time via the package.json "prepack" script. This is exactly why releases
// through 0.1.5 shipped a manifest that still said 0.1.0: nothing kept the
// two in sync. Never again.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'extension', 'manifest.json');

const pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
const manifestRaw = fs.readFileSync(manifestPath, 'utf8');

if (!/"version"\s*:\s*"[^"]*"/.test(manifestRaw)) {
  console.error('[sync-manifest] FAILED: no version field found in manifest.json');
  process.exit(1);
}

const current = JSON.parse(manifestRaw).version;
if (current === pkgVersion) {
  console.log(`[sync-manifest] already in sync at ${pkgVersion}`);
  process.exit(0);
}

const updated = manifestRaw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${pkgVersion}$2`);
fs.writeFileSync(manifestPath, updated);
console.log(`[sync-manifest] manifest ${current} -> ${pkgVersion}`);
