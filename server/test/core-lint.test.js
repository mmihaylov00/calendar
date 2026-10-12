// Keep the domain layer free of storage, HTTP and Node-specific dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(SERVER, 'core');
const FORBIDDEN_FILES = ['store.js', 'sse.js', 'lib/http.js'].map((f) => path.join(SERVER, f));
const ALLOWED_PACKAGES = new Set();
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.split('/')[0]]));

/** Source without comments and string/template contents, for the globals check. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

/** Module specifiers in `src`: static imports, re-exports, side-effect imports and dynamic import(). */
export function specifiers(src) {
  const out = [];
  const res = [
    /\bimport\s+[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

/** Problems in one core file (`file` absolute, `src` its text). */
export function lintCoreFile(file, src) {
  const problems = [];
  for (const spec of specifiers(src)) {
    if (spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0])) {
      problems.push(`imports the Node built-in ${spec}`);
      continue;
    }
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      if (FORBIDDEN_FILES.includes(target)) problems.push(`imports ${path.relative(SERVER, target)}`);
      else if (!target.startsWith(CORE + path.sep)) problems.push(`imports ${spec}, outside server/core`);
      else if (!fs.existsSync(target)) problems.push(`imports ${spec}, which does not exist`);
      continue;
    }
    if (!ALLOWED_PACKAGES.has(spec)) problems.push(`imports the package ${spec} (not in the core allowlist)`);
  }
  if (/\bimport\s*\(\s*(?!''\s*\))/.test(codeOnly(src))) problems.push('uses a computed dynamic import');
  for (const g of ['Buffer', 'process', 'require', '__dirname', '__filename', 'setImmediate']) {
    if (new RegExp(`\\b${g}\\b`).test(codeOnly(src))) problems.push(`uses the Node global ${g}`);
  }
  if (/\bimport\.meta\b/.test(codeOnly(src))) problems.push('uses import.meta');
  return problems;
}

function coreFiles(dir = CORE) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return coreFiles(p);
    return /\.(js|mjs)$/.test(e.name) ? [p] : [];
  });
}

test('server/core: no Node built-ins, store, sse or lib/http imports, nothing outside the folder', () => {
  const files = coreFiles();
  assert.ok(files.length > 0, 'domain modules are checked');
  const report = files.flatMap((f) => lintCoreFile(f, fs.readFileSync(f, 'utf8')).map((p) => `${path.relative(SERVER, f)}: ${p}`));
  assert.deepEqual(report, []);
});

test('server/core lint catches each forbidden import and global', () => {
  const f = path.join(CORE, 'example.js');
  const cases = [
    ["import fs from 'node:fs';", /Node built-in node:fs/],
    ["import crypto from 'crypto';", /Node built-in crypto/],
    ["import { x } from 'fs/promises';", /Node built-in fs\/promises/],
    ["import { getConfig } from '../store.js';", /imports store\.js/],
    ["export { broadcast } from '../sse.js';", /imports sse\.js/],
    ["import { request } from '../lib/http.js';", /imports lib\/http\.js/],
    ["import { ipBucket } from '../lib/net.js';", /outside server\/core/],
    ["const m = await import('node:path');", /Node built-in node:path/],
    ["import 'node:process';", /Node built-in node:process/],
    ["import express from 'express';", /core allowlist/],
    ['const b = Buffer.from("x");', /Node global Buffer/],
    ['if (process.env.X) {}', /Node global process/],
    ['const u = new URL("a", import.meta.url);', /import\.meta/],
    ['const m = await import(name);', /computed dynamic import/],
  ];
  for (const [src, re] of cases) {
    const p = lintCoreFile(f, src);
    assert.ok(p.some((x) => re.test(x)), `${src} → ${JSON.stringify(p)}`);
  }
  // Mentions in comments and strings are fine.
  assert.deepEqual(lintCoreFile(f, "// Buffer and process are not used here\nconst s = 'node:fs';\nimport { fold } from './lib/text.js';"), []);
});
