// The .zip the admin builds in the browser for the gallery download (web/admin/zip.ts): CRC-32, a stored archive
// whose headers and central directory agree, UTF-8 names, and names made unique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadWebModules } from './webModules.js';

const [zip] = await loadWebModules('/web/admin/zip.ts');

test('crc32 matches the standard check value', () => {
  assert.equal(zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(zip.crc32(new Uint8Array(0)), 0);
});

/** Reads a stored zip back: every entry through its central directory record and its local header. */
function readZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.byteLength - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    assert.equal(v.getUint16(p + 8, true) & 0x0800, 0x0800);
    assert.equal(v.getUint32(p + 38, true) >>> 16, 0o100644);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    assert.equal(v.getUint32(off, true), 0x04034b50);
    assert.equal(v.getUint16(off + 6, true) & 0x0800, 0x0800);
    const lname = v.getUint16(off + 26, true);
    const data = buf.subarray(off + 30 + lname, off + 30 + lname + size);
    assert.equal(zip.crc32(data), crc);
    out.push({ name, data });
    p += 46 + nameLen;
  }
  return out;
}

test('zipParts builds a stored archive that reads back entry by entry', () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array(70_000).map((_, i) => i % 251);
  const parts = zip.zipParts([
    { name: 'a.jpg', data: a, date: new Date(2026, 9, 10, 12, 30, 10) },
    { name: 'señal.png', data: b },
  ]);
  const buf = Buffer.concat(parts.map((x) => Buffer.from(x)));
  const back = readZip(new Uint8Array(buf));
  assert.deepEqual(back.map((e) => e.name), ['a.jpg', 'señal.png']);
  assert.deepEqual([...back[0].data], [...a]);
  assert.equal(Buffer.compare(Buffer.from(back[1].data), Buffer.from(b)), 0);
  // The system unzip agrees, when there is one.
  let unzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzip = false; }
  if (unzip) {
    const dir = mkdtempSync(path.join(tmpdir(), 'marco-zip-'));
    try {
      writeFileSync(path.join(dir, 'x.zip'), buf);
      execFileSync('unzip', ['-q', path.join(dir, 'x.zip'), '-d', path.join(dir, 'out')]);
      assert.deepEqual([...readFileSync(path.join(dir, 'out', 'a.jpg'))], [...a]);
      assert.equal(Buffer.compare(readFileSync(path.join(dir, 'out', 'señal.png')), Buffer.from(b)), 0);
      if (process.platform !== 'win32') assert.ok(statSync(path.join(dir, 'out', 'señal.png')).mode & 0o400, 'extracted photos remain readable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('an empty archive is just the end record', () => {
  const parts = zip.zipParts([]);
  const buf = Buffer.concat(parts.map((x) => Buffer.from(x)));
  assert.equal(buf.length, 22);
  assert.deepEqual(readZip(new Uint8Array(buf)), []);
});

test('uniqueNames keeps names apart and out of folders', () => {
  assert.deepEqual(zip.uniqueNames(['a.jpg', 'A.jpg', 'a.jpg', '../x.png', '', 'b']), ['a.jpg', 'A-2.jpg', 'a-3.jpg', '_x.png', 'photo', 'b']);
});
