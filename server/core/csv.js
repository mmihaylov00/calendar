// birthdays CSV paste parser ("María;15/03/1990"). Pure; unit-tested in events-csv.test.js.
// See docs/API.md and docs/ARCHITECTURE.md. POST /api/admin/birthdays/parse-csv returns English errors.
import { fold, randomId } from './lib/text.js';

export const MAX_CSV_BYTES = 100 * 1024;
export const MAX_BIRTHDAYS = 500;

export const CSV_ERRORS = {
  noDate: 'date is missing',
  badDate: 'invalid date',
  badYear: 'invalid year',
  noName: 'name is missing',
  longName: 'name is too long',
  limit: 'limit of 500 birthdays reached',
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const HEADER_RE = /^\s*["']?(nombre|name|nome|persona|person|pessoa)["']?\s*[;,\t]\s*["']?(fecha|date|data|cumpleanos|birthday|aniversario|nacimiento)/;
const DMY_RE = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?$/;
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const unquote = (s) => s.trim().replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').replace(/""/g, '"').trim();
const looksLikeDate = (s) => DMY_RE.test(s) || ISO_RE.test(s);

/** Parse "dd/mm[/yy[yy]]" or "yyyy-mm-dd" → { day, month, year|null } or { error }. */
export function parseBirthDate(s, now = new Date()) {
  const txt = String(s ?? '').trim();
  if (!txt) return { error: CSV_ERRORS.noDate };
  let day, month, year = null;
  let m = DMY_RE.exec(txt);
  if (m) {
    day = +m[1];
    month = +m[2];
    if (m[3] !== undefined) {
      year = +m[3];
      if (m[3].length === 2) {
        const yy = now.getFullYear() % 100;
        year += year <= yy ? 2000 : 1900;
      }
    }
  } else if ((m = ISO_RE.exec(txt))) {
    year = +m[1];
    month = +m[2];
    day = +m[3];
  } else {
    return { error: CSV_ERRORS.badDate };
  }
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return { error: CSV_ERRORS.badDate };
  if (year !== null) {
    if (year < 1900 || year > now.getFullYear()) return { error: CSV_ERRORS.badYear };
    if (month === 2 && day === 29 && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) return { error: CSV_ERRORS.badDate };
  }
  return { day, month, year };
}

/** Split one line on `;`, TAB or `,` (first one present outside quotes), honouring "double quotes". */
function splitLine(line) {
  const outside = line.replace(/"[^"]*"/g, '');
  const sep = outside.includes(';') ? ';' : outside.includes('\t') ? '\t' : ',';
  const cols = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '""'; i++; continue; }
      quoted = !quoted;
      cur += ch;
    } else if (ch === sep && !quoted) {
      cols.push(cur);
      cur = '';
    } else cur += ch;
  }
  cols.push(cur);
  return cols.map(unquote);
}

const dupKey = (name, day, month) => `${fold(name).replace(/\s+/g, ' ').trim()}|${day}|${month}`;

/**
 * Parse pasted CSV text. One birthday per line: `name;dd/mm[/yyyy][;emoji]` (separators `;` TAB `,`; date
 * separators `/ - .`). Header and blank lines are ignored. Nothing is saved.
 * @param {string} text
 * @param {Array} existing saved birthdays (for duplicate detection)
 * @returns {{ items: Array, errors: Array<{line:number,text:string,message:string}>, duplicates: number }}
 */
export function parseBirthdayCsv(text, existing = [], { now = new Date() } = {}) {
  const items = [];
  const errors = [];
  let duplicates = 0;
  const seen = new Set((existing || []).map((b) => dupKey(b.name, b.day, b.month)));
  const room = Math.max(0, MAX_BIRTHDAYS - (existing?.length || 0));
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    const n = i + 1;
    if (!line || line.startsWith('#')) return;
    if (HEADER_RE.test(fold(line))) return;
    const shown = line.slice(0, 120);
    let cols = splitLine(line);
    // Lenient: "15/03/1990;María" (date first) is accepted too.
    if (cols.length >= 2 && looksLikeDate(cols[0]) && !looksLikeDate(cols[1])) cols = [cols[1], cols[0], ...cols.slice(2)];
    const [name = '', dateTxt = '', emoji = ''] = cols;
    if (!name) return errors.push({ line: n, text: shown, message: CSV_ERRORS.noName });
    if (name.length > 80) return errors.push({ line: n, text: shown, message: CSV_ERRORS.longName });
    const d = parseBirthDate(dateTxt, now);
    if (d.error) return errors.push({ line: n, text: shown, message: d.error });
    const key = dupKey(name, d.day, d.month);
    if (seen.has(key)) { duplicates++; return; }
    if (items.length >= room) return errors.push({ line: n, text: shown, message: CSV_ERRORS.limit });
    seen.add(key);
    items.push({
      id: randomId('b_'),
      name: name.replace(/\s+/g, ' '),
      month: d.month,
      day: d.day,
      year: d.year,
      emoji: [...emoji].length && emoji.length <= 16 ? emoji : '',
    });
  });
  return { items, errors, duplicates };
}
