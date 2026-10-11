// birthdays CSV paste (docs/ARCHITECTURE.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBirthdayCsv, parseBirthDate, CSV_ERRORS } from '../core/csv.js';

const NOW = new Date('2026-10-09T12:00:00Z');

// These messages reach the UI directly, so the parser must produce English.
test('CSV error messages are English', () => {
  assert.deepEqual(CSV_ERRORS, {
    noDate: 'date is missing', badDate: 'invalid date', badYear: 'invalid year',
    noName: 'name is missing', longName: 'name is too long', limit: 'limit of 500 birthdays reached',
  });
});

test('date formats: dd/mm, dd-mm-yyyy, dd.mm.yy (2-digit years pivot on the current year), ISO', () => {
  assert.deepEqual(parseBirthDate('15/03', NOW), { day: 15, month: 3, year: null });
  assert.deepEqual(parseBirthDate('5-3-1990', NOW), { day: 5, month: 3, year: 1990 });
  assert.deepEqual(parseBirthDate('05.03.92', NOW), { day: 5, month: 3, year: 1992 });
  assert.deepEqual(parseBirthDate('05/03/26', NOW), { day: 5, month: 3, year: 2026 });
  assert.deepEqual(parseBirthDate('05/03/27', NOW), { day: 5, month: 3, year: 1927 });
  assert.deepEqual(parseBirthDate('1990-03-05', NOW), { day: 5, month: 3, year: 1990 });
  assert.deepEqual(parseBirthDate('29/02', NOW), { day: 29, month: 2, year: null });
  assert.deepEqual(parseBirthDate('29/02/2000', NOW), { day: 29, month: 2, year: 2000 });
  assert.equal(parseBirthDate('29/02/2001', NOW).error, CSV_ERRORS.badDate);
  assert.equal(parseBirthDate('31/04', NOW).error, CSV_ERRORS.badDate);
  assert.equal(parseBirthDate('12/13/1990', NOW).error, CSV_ERRORS.badDate);
  assert.equal(parseBirthDate('ayer', NOW).error, CSV_ERRORS.badDate);
  assert.equal(parseBirthDate('', NOW).error, CSV_ERRORS.noDate);
  assert.equal(parseBirthDate('01/01/2030', NOW).error, CSV_ERRORS.badYear);
  assert.equal(parseBirthDate('01/01/1850', NOW).error, CSV_ERRORS.badYear);
});

test('separators, header, blank lines, quotes, emoji column, date-first lines', () => {
  const text = [
    'Nombre;Fecha',
    'María;15/03/1990',
    '',
    'Joao\t1-2',
    '"Ana, la prima",24/12/85,🎄',
    '04/07;Tío Pepe',
    '  # comentario',
  ].join('\r\n');
  const r = parseBirthdayCsv(text, [], { now: NOW });
  assert.deepEqual(r.errors, []);
  assert.equal(r.duplicates, 0);
  assert.deepEqual(r.items.map(({ id, ...b }) => b), [
    { name: 'María', month: 3, day: 15, year: 1990, emoji: '' },
    { name: 'Joao', month: 2, day: 1, year: null, emoji: '' },
    { name: 'Ana, la prima', month: 12, day: 24, year: 1985, emoji: '🎄' },
    { name: 'Tío Pepe', month: 7, day: 4, year: null, emoji: '' },
  ]);
  assert.ok(r.items.every((b) => /^b_[0-9a-f]+$/.test(b.id)));
  assert.equal(new Set(r.items.map((b) => b.id)).size, 4);
});

test('errors carry 1-based line numbers; duplicates (saved or repeated, accent-insensitive) are skipped', () => {
  const existing = [{ id: 'b_1', name: 'María', month: 3, day: 15, year: null, emoji: '' }];
  const text = 'maria;15/03\nPedro\nLuis;31/02\n;01/01\nPedro;02/02\nPEDRO;02/02/1980\nEva;01/01/2050';
  const r = parseBirthdayCsv(text, existing, { now: NOW });
  assert.equal(r.duplicates, 2); // "maria" (saved) + second Pedro
  assert.deepEqual(r.items.map((b) => b.name), ['Pedro']);
  assert.deepEqual(r.errors.map((e) => [e.line, e.message]), [
    [2, CSV_ERRORS.noDate],
    [3, CSV_ERRORS.badDate],
    [4, CSV_ERRORS.noName],
    [7, CSV_ERRORS.badYear],
  ]);
  assert.equal(r.errors[0].text, 'Pedro');
});

test('limit of 500 birthdays in total', () => {
  const existing = Array.from({ length: 499 }, (_, i) => ({ id: `b_${i}`, name: `P${i}`, month: 1, day: 1, year: null, emoji: '' }));
  const r = parseBirthdayCsv('A;01/02\nB;02/02', existing, { now: NOW });
  assert.equal(r.items.length, 1);
  assert.equal(r.errors[0].message, CSV_ERRORS.limit);
});
