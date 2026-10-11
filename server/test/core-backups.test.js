// rotating backups, coalescing, export bundle, import preview/merge, activity log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import {
  backupBeforeSave, writeBackup, listBackups, backupPath, readBackup, deleteBackup, KEEP_BACKUPS, COALESCE_MS,
  makeBundle, importPreview, parseImport, mergeImport, sanitizeImportedSecrets, PREMIGRATION_ID,
} from '../backups.js';
import { logActivity, listActivity, clearActivity, changedSections, recentActivity } from '../activity.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-core-bak-'));
  store.initStore(dir);
  return dir;
}
const backupFiles = (dir) => fs.readdirSync(path.join(dir, 'backups')).filter((f) => /-r\d+-/.test(f));

test('backups: saveConfig copies the previous file first; bursts coalesce for 120 s', () => {
  const dir = setup();
  const before = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  const next = structuredClone(store.getConfig());
  next.screens[0].name = 'Uno';
  assert.equal(store.saveConfig(next).ok, true);
  let files = backupFiles(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^config-\d{8}T\d{6}Z-r1-save\.json$/);
  assert.equal(fs.readFileSync(path.join(dir, 'backups', files[0]), 'utf8'), before);
  next.screens[0].name = 'Dos';
  store.saveConfig(next);
  assert.equal(backupFiles(dir).length, 1, 'second save inside the coalescing window adds no backup');
  // an invalid save never creates a backup
  const bad = structuredClone(store.getConfig());
  bad.screens[0].screen.theme = 'neon';
  assert.equal(store.saveConfig(bad).ok, false);
  assert.equal(backupFiles(dir).length, 1);
  // after the window, a new one is written
  const later = new Date(Date.now() + COALESCE_MS + 1000);
  const info = backupBeforeSave(store.getConfig(), later);
  assert.equal(info.reason, 'save');
  assert.equal(info.revision, store.getConfig().revision);
  assert.equal(backupFiles(dir).length, 2);
  // a manual backup in between breaks coalescing
  writeBackup(store.getConfig(), 'manual', new Date(later.getTime() + 1000));
  assert.ok(backupBeforeSave(store.getConfig(), new Date(later.getTime() + 2000)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backups: rotation keeps the 20 newest, never the pre-migration copy; list/read/delete/id validation', () => {
  const dir = setup();
  fs.writeFileSync(path.join(dir, 'backups', PREMIGRATION_ID), JSON.stringify({ version: 1, revision: 3, screen: { name: 'Viejo' } }));
  const t0 = Date.UTC(2026, 9, 1, 10, 0, 0);
  fs.utimesSync(path.join(dir, 'backups', PREMIGRATION_ID), new Date(t0 - 3600_000), new Date(t0 - 3600_000)); // migrated before
  for (let i = 0; i < KEEP_BACKUPS + 5; i++) {
    writeBackup({ ...store.getConfig(), revision: 100 + i }, i % 2 ? 'manual' : 'save', new Date(t0 + i * 60_000));
  }
  const files = backupFiles(dir);
  assert.equal(files.length, KEEP_BACKUPS);
  assert.ok(!files.some((f) => /-r10[0-4]-/.test(f)), 'oldest five rotated out');
  const list = listBackups();
  assert.equal(list.length, KEEP_BACKUPS + 1);
  assert.equal(list[0].revision, 124); // newest first
  assert.equal(list.at(-1).id, PREMIGRATION_ID);
  assert.equal(list.at(-1).reason, 'migration');
  assert.equal(list.at(-1).revision, 3);
  assert.equal(list[0].screens, 1);
  assert.equal(list[0].sources, 0);
  assert.ok(list[0].size > 100);
  assert.equal(list[0].createdAt, new Date(t0 + 24 * 60_000).toISOString());

  for (const bad of ['../config.json', 'config.json', 'secrets.json', 'config-20261001T100000Z-r1-evil.json', '..%2Fsecrets.json']) {
    assert.equal(backupPath(bad), null, bad);
    assert.equal(readBackup(bad), null);
  }
  assert.equal(readBackup(list[0].id).revision, 124);
  assert.equal(deleteBackup(list[0].id), true);
  assert.equal(deleteBackup(list[0].id), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('export bundle: secrets only when asked, never the session secret', () => {
  const dir = setup();
  store.updateSecrets((s) => {
    s.passwordHash = 'scrypt$c2FsdA==$aGFzaA==';
    s.homeassistant.token = 'ha-token';
    s.apiTokens = [{ id: 'tk_1', name: 'HA', hash: 'a'.repeat(64), prefix: 'cs_abcde', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null, lastUsedIp: null, useCount: 0 }];
  });
  const plain = makeBundle(store.getConfig(), { appVersion: '0.2.0' });
  assert.equal(plain.format, 'marco-backup');
  assert.equal(plain.formatVersion, 1);
  assert.equal(plain.secrets, undefined);
  const full = makeBundle(store.getConfig(), { appVersion: '0.2.0', secrets: store.getSecrets() });
  const txt = JSON.stringify(full);
  assert.ok(!txt.includes(store.getSecrets().sessionSecret));
  assert.ok(!txt.includes('sessionEpoch'));
  assert.equal(full.secrets.passwordHash, 'scrypt$c2FsdA==$aGFzaA==');
  assert.equal(full.secrets.homeassistant.token, 'ha-token');
  assert.equal(full.secrets.apiTokens.length, 1);
  const s = sanitizeImportedSecrets({ ...full.secrets, passwordHash: 'plaintext', sessionSecret: 'x', apiTokens: [{ id: 'x', name: 'n', hash: 'nothex' }] });
  assert.equal(s.passwordHash, undefined);
  assert.equal(s.sessionSecret, undefined);
  assert.deepEqual(s.apiTokens, []);
  assert.equal(s.haToken, 'ha-token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('import preview: bundle or bare v1/v2 config, localized section summaries, diff of screens/sources', () => {
  const cur = defaultConfig();
  cur.calendar.sources = [{ id: 'c_existing', type: 'ics', name: 'AL', url: 'https://example.com/a.ics', color: '#123456' }];
  const next = structuredClone(cur);
  next.screens.push(defaultScreenProfile({ id: 's_cocina', slug: 'cocina', name: 'Cocina' }));
  next.calendar.sources.push({ id: 'c_new', type: 'ics', name: 'Colegio', url: 'https://e.com/c.ics', color: '#112233' });
  next.calendar.sources.push({ id: 'c_new2', type: 'ics', name: 'Fútbol', url: 'https://e.com/f.ics', color: '#112233' });
  next.calendar.sources[0].name = 'AL renamed';
  next.birthdays.items.push({ name: 'María', month: 3, day: 4, year: 1990 });
  const p = importPreview(makeBundle(next, { appVersion: '0.2.0' }), cur, 'es');
  assert.equal(p.ok, true);
  assert.equal(p.fromVersion, 2);
  assert.equal(p.appVersion, '0.2.0');
  assert.equal(p.hasSecrets, false);
  assert.deepEqual(p.screens, { added: ['Cocina'], removed: [], changed: [] });
  assert.deepEqual(p.sources, { added: ['Colegio', 'Fútbol'], removed: [], changed: ['AL renamed'] });
  const sec = Object.fromEntries(p.sections.map((x) => [x.key, x]));
  assert.equal(sec.screens.summary, '+1 screen');
  assert.equal(sec.calendar.summary, '+2 sources, 1 modified');
  assert.equal(sec.birthdays.summary, '+1 item');
  assert.equal(sec.weather.changed, false);
  assert.equal(sec.weather.summary, 'unchanged');
  assert.equal(p.counts.birthdays, 1);
  // Removed locale requests also return the English preview.
  const en = Object.fromEntries(importPreview(makeBundle(next, { appVersion: '0.2.0' }), cur).sections.map((x) => [x.key, x.summary]));
  assert.equal(en.screens, '+1 screen');
  assert.equal(en.calendar, '+2 sources, 1 modified');
  assert.equal(en.birthdays, '+1 item');
  assert.equal(en.weather, 'unchanged');
  const pt = Object.fromEntries(importPreview(makeBundle(next, { appVersion: '0.2.0' }), cur, 'pt').sections.map((x) => [x.key, x.summary]));
  assert.equal(pt.screens, '+1 screen');
  assert.equal(pt.calendar, '+2 sources, 1 modified');
  assert.equal(pt.weather, 'unchanged');

  // bare v1 config
  const v1 = importPreview({ version: 1, revision: 9, screen: { name: 'Cocina' }, calendar: { sources: [] } }, cur);
  assert.equal(v1.fromVersion, 1);
  assert.equal(v1.ok, true);
  assert.equal(v1.appVersion, null);
  // invalid values are reported (but the preview is still built)
  const broken = structuredClone(next);
  broken.screens[0].screen.accent = 'rojo';
  const pb = importPreview({ format: 'marco-backup', formatVersion: 1, config: broken }, cur);
  assert.equal(pb.ok, false);
  assert.ok(pb.errors.some((e) => e.path === 'screens[0].screen.accent'));
  // not a backup at all
  assert.equal(importPreview({ hello: 'world' }, cur).ok, false);
  assert.equal(importPreview('text', cur).ok, false);
  assert.equal(importPreview(null, cur).ok, false);
});

test('import merge: all sections, or only some (screens carry defaultScreen)', () => {
  const cur = defaultConfig();
  cur.revision = 50;
  const next = structuredClone(cur);
  next.screens = [defaultScreenProfile({ id: 's_cocina', slug: 'cocina', name: 'Cocina' })];
  next.defaultScreen = 's_cocina';
  next.birthdays.items = [{ id: 'b_1', name: 'Ana', month: 1, day: 2, year: null, emoji: '' }];
  const imported = parseImport(next).value;
  const all = mergeImport(cur, imported);
  assert.equal(all.revision, 50);
  assert.equal(all.defaultScreen, 's_cocina');
  const onlyBirthdays = mergeImport(cur, imported, ['birthdays', 'bogus']);
  assert.equal(onlyBirthdays.screens[0].id, 's_main');
  assert.equal(onlyBirthdays.defaultScreen, 's_main');
  assert.equal(onlyBirthdays.birthdays.items[0].name, 'Ana');
  const onlyDefault = mergeImport(cur, imported, ['defaultScreen']);
  assert.equal(onlyDefault.defaultScreen, 's_main', 'unknown default falls back to the first screen');
  const screens = mergeImport(cur, imported, ['screens']);
  assert.equal(screens.defaultScreen, 's_cocina');
});

test('activity: filters, paging, ring cap + compaction, changed sections', () => {
  const dir = setup();
  clearActivity();
  logActivity('auth.login', { actor: 'admin', ip: '192.168.1.5', data: { method: 'password' } });
  logActivity('auth.login_failed', { actor: 'anonymous', ip: '10.0.0.9', level: 'warn', data: { reason: 'invalid_password' } });
  logActivity('config.saved', { actor: 'admin@example.com', data: { revision: 2, sections: ['screens:living-room.layout'] } });
  logActivity('announce.sent', { actor: 'token:Home Assistant', data: { title: 'Lavadora terminó' } });
  assert.deepEqual(listActivity({ type: 'auth' }).items.map((e) => e.type), ['auth.login_failed', 'auth.login']);
  assert.deepEqual(listActivity({ type: 'auth.login' }).items.map((e) => e.type), ['auth.login']);
  assert.deepEqual(listActivity({ type: 'auth,announce' }).items.length, 3);
  assert.deepEqual(listActivity({ level: 'warn' }).items.map((e) => e.type), ['auth.login_failed']);
  assert.deepEqual(listActivity({ actor: 'TOKEN:home' }).items.map((e) => e.type), ['announce.sent']);
  assert.deepEqual(listActivity({ q: 'lavadora termino' }).items.map((e) => e.type), ['announce.sent']); // folded
  assert.deepEqual(listActivity({ q: '10.0.0.9' }).items.map((e) => e.type), ['auth.login_failed']);
  assert.deepEqual(listActivity({ q: 'living-room.layout' }).items.map((e) => e.type), ['config.saved']);
  assert.equal(recentActivity(2).length, 2);
  assert.equal(recentActivity(2)[0].type, 'announce.sent');
  // paging with `before`: no duplicates, no gaps
  for (let i = 0; i < 120; i++) logActivity('display.command', { actor: 'admin', data: { i } });
  const seen = [];
  let before = '';
  for (;;) {
    const page = listActivity({ type: 'display', before, limit: 50 });
    seen.push(...page.items.map((e) => e.data.i));
    if (!page.hasMore) break;
    before = page.items.at(-1).id;
  }
  assert.deepEqual(seen, Array.from({ length: 120 }, (_, i) => 119 - i));
  assert.equal(listActivity({ limit: 9999 }).items.length, 124 > 200 ? 200 : 124);
  // cap: file compacted to 5000 lines after 6000
  for (let i = 0; i < 6000; i++) logActivity('display.connected', { actor: 'system' });
  const lines = fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8').trim().split('\n').length;
  assert.ok(lines <= 6000 && lines >= 5000, `lines=${lines}`);
  let n = 0;
  let b = '';
  for (;;) { const p = listActivity({ before: b, limit: 200 }); n += p.items.length; if (!p.hasMore) break; b = p.items.at(-1).id; }
  assert.equal(n, 5000);
  clearActivity();
  assert.equal(listActivity().items.length, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8'), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('changedSections: top-level keys and per-screen sections', () => {
  const a = defaultConfig();
  const b = structuredClone(a);
  b.revision = 2;
  b.calendar.iconRules = [];
  b.screens[0].layout.preset = 'agenda';
  b.screens.push(defaultScreenProfile({ id: 's_cocina', slug: 'cocina', name: 'Cocina' }));
  assert.deepEqual(changedSections(a, b), ['calendar', 'screens:living-room.layout', 'screens:+cocina']);
  const c = structuredClone(b);
  c.screens = [c.screens[1]];
  c.screens[0].name = 'Cocina 2';
  c.defaultScreen = 's_cocina';
  assert.deepEqual(changedSections(b, c), ['defaultScreen', 'screens:cocina.name', 'screens:-living-room']);
  assert.deepEqual(changedSections(null, a), ['*']);
  assert.deepEqual(changedSections(a, structuredClone(a)), []);
});

test('saveConfig emits (config, prev, { reason, req })', () => {
  const dir = setup();
  let got = null;
  const fn = (cfg, prev, meta) => { got = { cfg, prev, meta }; };
  store.events.on('config', fn);
  const prevRev = store.getConfig().revision;
  store.saveConfig(structuredClone(store.getConfig()), { reason: 'admin', req: { ip: '1.1.1.1' } });
  store.events.off('config', fn);
  assert.equal(got.prev.revision, prevRev);
  assert.equal(got.cfg.revision, prevRev + 1);
  assert.equal(got.meta.reason, 'admin');
  assert.equal(got.meta.req.ip, '1.1.1.1');
  fs.rmSync(dir, { recursive: true, force: true });
});
