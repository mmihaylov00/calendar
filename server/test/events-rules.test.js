// event filters & overrides (docs/ARCHITECTURE.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEventRules, renameTitle, textMatches, foldMap } from '../eventRules.js';
import { buildSourceEvents } from '../calendars.js';
import { RULES } from './helpers.js';

const TZ = 'Europe/Lisbon';
let n = 0;
const rule = (over) => ({
  id: `f_${++n}`, enabled: true, action: 'hide', match: '', matchMode: 'contains', field: 'title', sourceIds: [],
  replaceWith: '', emoji: '', color: null, countdown: false, note: '', ...over,
});
const ev = (title, over = {}) => ({ title, description: '', location: '', sourceId: 'c_fam', ...over });

test('foldMap keeps a map back to the original string', () => {
  const m = foldMap('Reunión  Ñu');
  assert.equal(m.text, 'reunion nu');
  assert.equal(m.source.slice(m.starts[8], m.ends[8]), 'Ñ');
  assert.equal(m.source.slice(m.starts[7], m.ends[7]), '  '); // whitespace run collapsed to one char
});

test('matching modes: contains / exact / startsWith, accent and case insensitive; field any', () => {
  assert.equal(textMatches(rule({ match: 'reunion' }), ev('Gran REUNIÓN anual')), true);
  assert.equal(textMatches(rule({ match: 'reunion', matchMode: 'exact' }), ev('Gran reunión')), false);
  assert.equal(textMatches(rule({ match: 'gran  reunion', matchMode: 'exact' }), ev(' Gran Reunión ')), true);
  assert.equal(textMatches(rule({ match: 'gran', matchMode: 'startsWith' }), ev('Gran reunión')), true);
  assert.equal(textMatches(rule({ match: 'zoom' }), ev('Reunión', { description: 'enlace zoom' })), false);
  assert.equal(textMatches(rule({ match: 'zoom', field: 'any' }), ev('Reunión', { description: 'enlace Zoom' })), true);
  assert.equal(textMatches(rule({ match: 'oficina', field: 'any' }), ev('Reunión', { location: 'Oficina 2' })), true);
  // exact/startsWith ignore description even with field any
  assert.equal(textMatches(rule({ match: 'zoom', field: 'any', matchMode: 'exact' }), ev('Reunión', { description: 'zoom' })), false);
});

test('rename: contains replaces every occurrence; exact; startsWith; tidy; empty keeps title', () => {
  assert.equal(renameTitle('Fútbol niños \u2014 FUTBOL', rule({ action: 'rename', match: 'futbol', replaceWith: 'Fútbol ⚽' })), 'Fútbol ⚽ niños \u2014 Fútbol ⚽');
  assert.equal(renameTitle('Reserved', rule({ action: 'rename', match: 'reserved', matchMode: 'exact', replaceWith: 'Huéspedes' })), 'Huéspedes');
  assert.equal(renameTitle('[Trabajo] Llamada  cliente', rule({ action: 'rename', match: '[trabajo]', matchMode: 'startsWith', replaceWith: '' })), 'Llamada cliente');
  assert.equal(renameTitle('Médico', rule({ action: 'rename', match: 'medico', replaceWith: '  ' })), 'Médico');
});

test('order: hide → rename (chained, in order) → style (first match, renamed or original title)', () => {
  const rules = [
    rule({ id: 'style-orig', action: 'style', match: 'cole', emoji: '🎒' }),
    rule({ id: 'ren1', action: 'rename', match: 'cole', replaceWith: 'Colegio' }),
    rule({ id: 'ren2', action: 'rename', match: 'colegio', replaceWith: 'Escuela' }), // chained on ren1's result
    rule({ id: 'style-new', action: 'style', match: 'escuela', emoji: '🏫' }),
    rule({ id: 'hide', action: 'hide', match: 'cancelado' }),
  ];
  let r = applyEventRules(rules, ev('Recoger cole'));
  assert.equal(r.title, 'Recoger Escuela');
  assert.equal(r.hidden, false);
  // first style rule (list order) that matches either the renamed or the original title wins
  assert.equal(r.style.id, 'style-orig');
  assert.deepEqual(r.applied.map((a) => a.ruleId), ['ren1', 'ren2', 'style-orig']);

  r = applyEventRules(rules, ev('Recoger cole (cancelado)'));
  assert.equal(r.hidden, true);
  assert.equal(r.applied[0].action, 'hide');

  // disabled rules and source restrictions are skipped
  const scoped = [rule({ match: 'cole', sourceIds: ['c_other'] }), rule({ match: 'cole', enabled: false })];
  assert.equal(applyEventRules(scoped, ev('cole')).hidden, false);
  assert.equal(applyEventRules(scoped, ev('cole', { sourceId: 'c_other' })).hidden, true);
});

test('precedence vs icon rules inside the pipeline: style > icon rule > source; hide uses the normalised title', () => {
  const src = { id: 'c_al', name: 'AL', color: '#2ec4b6', emoji: '', kind: 'airbnb' };
  const fam = { id: 'c_fam', name: 'Familia', color: '#4ea8de', emoji: '📅', kind: 'generic' };
  const opts = (eventRules) => ({ rules: RULES, eventRules, from: '2026-10-01', to: '2026-10-31', tz: TZ, lang: 'es', detail: true });
  const raw = (title, start = '2026-10-10', extra = {}) => ({ uid: title, title, description: '', location: '', allDay: true, start, end: '2026-10-11', ...extra });

  // Airbnb titles are normalised before event rules run.
  const hide = rule({ id: 'h', action: 'hide', match: 'Not available', matchMode: 'exact', sourceIds: ['c_al'] });
  const al = buildSourceEvents([raw('Airbnb (Not available)'), raw('Reserved', '2026-10-12')], src, opts([hide]));
  assert.deepEqual(al.map((e) => [e.title, e.hidden]), [['Not available', true], ['Reservation', false]]);
  assert.equal(buildSourceEvents([raw('Airbnb (Not available)')], src, { ...opts([hide]), detail: false }).length, 0);

  // Icon rule (dentista 🩺) alone
  let [e] = buildSourceEvents([raw('Dentista')], fam, opts([]));
  assert.equal(e.emoji, '🩺');
  assert.equal(e.color, '#4ea8de');
  assert.ok(e.iconRuleId);
  // Style with only a color: emoji still from the icon rule, color from the style rule
  [e] = buildSourceEvents([raw('Dentista')], fam, opts([rule({ id: 'c', action: 'style', match: 'dentista', color: '#ff0000' })]));
  assert.equal(e.emoji, '🩺');
  assert.equal(e.color, '#ff0000');
  assert.ok(e.iconRuleId); // icon rule still provided the emoji
  // Style emoji overrides the icon rule → iconRuleId null
  [e] = buildSourceEvents([raw('Dentista')], fam, opts([rule({ id: 'e', action: 'style', match: 'dentista', emoji: '🦷', countdown: true })]));
  assert.equal(e.emoji, '🦷');
  assert.equal(e.iconRuleId, null);
  assert.equal(e.countdown, true);
  // Rename then icon rule on the renamed title ("Cita" → "Cita médico" gets 🩺)
  [e] = buildSourceEvents([raw('Cita X')], fam, opts([rule({ id: 'r', action: 'rename', match: 'x', replaceWith: 'médico' })]));
  assert.equal(e.title, 'Cita médico');
  assert.equal(e.originalTitle, 'Cita X');
  assert.equal(e.emoji, '🩺');
  // No rule at all → source emoji
  [e] = buildSourceEvents([raw('Algo')], fam, opts([]));
  assert.equal(e.emoji, '📅');
  assert.equal(e.iconRuleId, null);
  // wire events (detail false) never carry internal fields
  [e] = buildSourceEvents([raw('Algo')], fam, { ...opts([]), detail: false });
  assert.equal('hidden' in e || 'countdown' in e || 'applied' in e, false);
});
