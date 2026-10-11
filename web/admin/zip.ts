// A plain ZIP archive (no compression: photos are compressed already) built in the browser, so the admin can hand
// out every gallery photo in one download without the server doing the work. Plain TypeScript, no DOM: the server
// tests load it. Limits of the format kept here: fewer than 65535 files and less than 4 GB in total (no ZIP64).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of `data`. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  date?: Date;
}

/** MS-DOS time and date fields (local time, 2 s steps, 1980 at the earliest). */
function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export const ZIP_MAX_FILES = 65534;
export const ZIP_MAX_BYTES = 0xfffffffe;

/**
 * The parts of a ZIP file holding `entries` (stored, UTF-8 names), ready for `new Blob(parts)`. Throws when the
 * archive would need ZIP64.
 */
export function zipParts(entries: ZipEntry[]): Uint8Array[] {
  if (entries.length > ZIP_MAX_FILES) throw new Error('too many files for one zip');
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = dosTime(e.date ?? new Date());
    const size = e.data.length;
    if (offset + 30 + name.length + size > ZIP_MAX_BYTES) throw new Error('zip too large');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, e.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x0314, true); // Unix creator avoids legacy unzip recoding UTF-8 names as DOS text
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, 0o100644 << 16, true); // Unix regular file, mode 0644
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return [...parts, ...central, end];
}

/** Names unique inside one archive ("a.jpg", "a-2.jpg"...). */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    const clean = n.replace(/[\\/]+/g, '_').replace(/^\.+/, '') || 'photo';
    let out = clean;
    const dot = clean.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
    for (let i = 2; seen.has(out.toLowerCase()); i++) out = `${base}-${i}${ext}`;
    seen.add(out.toLowerCase());
    return out;
  });
}
