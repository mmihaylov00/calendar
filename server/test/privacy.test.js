// Privacy mode: the pure rules (core/privacy.js), config validation, and the real app filtering what displays get
// (/api/events, /api/countdowns, /api/display/config, /api/photos) with the admin and webhook endpoints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import {
  privatizeEvents, sourcePrivacyMode, privacyScheduleState, nextScheduleBoundary, privacyStatus, applyPrivacyRequest,
  sanitizePrivacyRequest, privacyNextChange, nextLocalTime, pruneStates, displayPrivacy,
} from '../core/privacy.js';
import { displayConfig } from '../core/screens.js';
import { computeCountdowns } from '../countdowns.js';
import { hashPassword, ensurePassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetActivityThrottle, listActivity } from '../activity.js';
import { _resetPrivacy, syncPrivacy } from '../privacy.js';
import { createToken } from '../tokens.js';
import { localDate, addDays } from '../core/lib/tz.js';

const TZ = 'Europe/Lisbon';
const at = (iso) => new Date(iso);

function cfgWith(mut = (c) => c) {
  const c = defaultConfig();
  c.datetime.timezone = TZ;
  c.calendar.sources = [
    { id: 'c_work', type: 'ics', name: 'Work', url: 'https://example.com/w.ics', color: '#123456', emoji: '💼', kind: 'generic', enabled: true, refreshMin: 60 },
    { id: 'c_rent', type: 'ics', name: 'Rental', url: 'https://example.com/r.ics', color: '#ff0000', emoji: '', kind: 'airbnb', enabled: true, refreshMin: 60, privacy: 'busy' },
    { id: 'c_hol', type: 'ics', name: 'Holidays', url: 'https://example.com/h.ics', color: '#00ff00', emoji: '🎉', kind: 'holidays', enabled: true, refreshMin: 60 },
    { id: 'c_gym', type: 'ics', name: 'Gym', url: 'https://example.com/g.ics', color: '#0000ff', emoji: '', kind: 'generic', enabled: true, refreshMin: 60, privacy: 'hide' },
  ];
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  mut(c);
  const r = validateConfig(mergeDefaults(c));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
}

test('validation: per-source modes with defaults by kind, local / birthdays, per-screen block', () => {
  const v = cfgWith();
  assert.deepEqual(v.calendar.sources.map((s) => s.privacy), ['busy', 'busy', 'keep', 'hide']);
  assert.equal(v.localEvents.privacy, 'busy');
  assert.equal(v.birthdays.privacy, 'keep');
  assert.deepEqual(v.screens[0].privacy, { hidePhotos: false, showLock: true, schedule: [] });
  const bad = validateConfig(mergeDefaults({ ...v, calendar: { ...v.calendar, sources: [{ ...v.calendar.sources[0], privacy: 'nope' }] } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].path, 'calendar.sources[0].privacy');
  const rules = structuredClone(v);
  rules.screens[0].privacy.schedule = [{ days: [5, 6], from: '20:00', to: '02:00' }, { from: '10:00', to: '10:00' }];
  const r = validateConfig(rules);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'screens[0].privacy.schedule[1].to');
  assert.match(r.value.screens[0].privacy.schedule[0].id, /^p_/);
  assert.deepEqual(r.value.screens[0].privacy.schedule[0].days, [5, 6]);
});

test('privatizeEvents: busy keeps time and calendar colour only, hide drops, keep passes', () => {
  const cfg = cfgWith();
  const ev = (o) => ({ id: 'e1', sourceId: 'c_work', title: 'Lunch with Ana', start: '2026-10-12T12:00:00+01:00', end: '2026-10-12T13:00:00+01:00', allDay: false, location: 'Main St 1', color: '#abcdef', emoji: '🍽️', kind: 'generic', multiDay: false, ...o });
  const out = privatizeEvents([
    ev({}),
    ev({ id: 'e2', sourceId: 'c_gym', title: 'Gym' }),
    ev({ id: 'e3', sourceId: 'c_hol', title: 'Christmas', kind: 'holidays', allDay: true, start: '2026-12-25', end: '2026-12-26' }),
    ev({ id: 'e4', sourceId: 'local', title: 'Doctor', description: 'room 3' }),
    ev({ id: 'e5', sourceId: 'birthdays', title: 'Ana', age: 40, kind: 'birthdays' }),
    ev({ id: 'e6', sourceId: 'c_rent', title: 'Reservation · John 🧑🏻🧑🏻', kind: 'airbnb', allDay: true, start: '2026-10-10', end: '2026-10-14', multiDay: true }),
    ev({ id: 'e7', sourceId: 'c_rent', title: 'John', emoji: '🚪', kind: 'airbnb', allDay: true, start: '2026-10-14', end: '2026-10-15' }),
  ], cfg, 'es');
  assert.deepEqual(out.map((e) => e.id), ['e1', 'e3', 'e4', 'e5', 'e6', 'e7']);
  assert.deepEqual(out[0], {
    id: 'e1', sourceId: 'c_work', title: 'Busy', start: '2026-10-12T12:00:00+01:00', end: '2026-10-12T13:00:00+01:00', allDay: false,
    location: '', color: '#123456', emoji: '', kind: 'generic', multiDay: false, busy: true,
  });
  assert.equal(out[1].title, 'Christmas'); // holidays: keep by default
  assert.equal(out[2].title, 'Busy');
  assert.equal(out[2].description, undefined);
  assert.equal(out[2].color, cfg.localEvents.color);
  assert.equal(out[3].title, 'Ana'); // birthdays: keep by default
  assert.equal(out[3].age, 40);
  assert.equal(out[4].title, 'Busy');
  assert.equal(out[4].multiDay, true);
  assert.equal(out[5].emoji, '🚪'); // a checkout marker stays a marker, without the guest's name
  assert.equal(out[5].title, 'Busy');
  assert.equal(privatizeEvents([ev({})], cfg, 'en')[0].title, 'Busy');
  assert.equal(privatizeEvents([ev({})], cfg, 'pt')[0].title, 'Busy');
  assert.equal(sourcePrivacyMode(cfg, 'unknown'), 'busy');
});

test('schedule: windows, crossing midnight, back-to-back windows joined, next boundary', () => {
  const rules = [{ enabled: true, days: [5], from: '22:00', to: '02:00' }];
  // Friday 2026-10-09 23:00 local (UTC+1) → active until Saturday 02:00
  assert.deepEqual(privacyScheduleState(rules, at('2026-10-09T22:00:00Z'), TZ), { active: true, until: '2026-10-10T02:00:00+01:00' });
  assert.equal(privacyScheduleState(rules, at('2026-10-10T01:30:00Z'), TZ).active, false); // Saturday 02:30
  assert.equal(privacyScheduleState(rules, at('2026-10-08T22:00:00Z'), TZ).active, false); // Thursday
  const joined = [...rules, { enabled: true, days: [6], from: '02:00', to: '09:00' }];
  assert.equal(privacyScheduleState(joined, at('2026-10-09T22:00:00Z'), TZ).until, '2026-10-10T09:00:00+01:00');
  assert.equal(nextScheduleBoundary(rules, at('2026-10-09T12:00:00Z'), TZ), Date.parse('2026-10-09T22:00:00+01:00'));
  assert.equal(nextScheduleBoundary(rules, at('2026-10-09T22:00:00Z'), TZ), Date.parse('2026-10-10T02:00:00+01:00'));
  assert.equal(nextScheduleBoundary([], at('2026-10-09T22:00:00Z'), TZ), null);
  assert.equal(nextLocalTime('06:00', at('2026-10-09T22:00:00Z'), TZ), '2026-10-10T06:00:00+01:00');
  assert.equal(nextLocalTime('06:00', at('2026-10-09T04:00:00Z'), TZ), '2026-10-09T06:00:00+01:00');
});

test('state: manual on / off against the schedule', () => {
  const cfg = cfgWith((c) => { c.screens[0].privacy = { schedule: [{ days: [], from: '22:00', to: '07:00' }] }; });
  const [main, kitchen] = cfg.screens;
  const noon = at('2026-10-09T11:00:00Z'); // 12:00 local
  const night = at('2026-10-09T22:30:00Z'); // 23:30 local
  assert.equal(privacyStatus(cfg, main, undefined, noon).active, false);
  assert.deepEqual(privacyStatus(cfg, main, undefined, night), { active: true, until: '2026-10-10T07:00:00+01:00', by: 'schedule', resumesAt: null });

  // manual on for 3 hours on every screen
  let r = applyPrivacyRequest(cfg, {}, { mode: 'on', end: '2026-10-09T14:00:00.000Z', by: 'admin' }, noon);
  assert.deepEqual(r.changed, ['s_main', 's_kitchen']);
  assert.deepEqual(privacyStatus(cfg, kitchen, r.states.s_kitchen, noon), { active: true, until: '2026-10-09T14:00:00.000Z', by: 'admin', resumesAt: null });
  assert.equal(privacyStatus(cfg, kitchen, r.states.s_kitchen, at('2026-10-09T14:00:00Z')).active, false); // over
  assert.equal(privacyNextChange(cfg, kitchen, r.states.s_kitchen, noon), Date.parse('2026-10-09T14:00:00.000Z'));
  // a period that runs into the schedule window goes on until the window ends
  r = applyPrivacyRequest(cfg, {}, { mode: 'on', end: '2026-10-09T21:30:00.000Z', screenIds: ['s_main'] }, at('2026-10-09T20:00:00Z'));
  assert.equal(privacyStatus(cfg, main, r.states.s_main, at('2026-10-09T20:00:00Z')).until, '2026-10-10T07:00:00+01:00');

  // manual off during the window pauses the schedule until the window ends
  r = applyPrivacyRequest(cfg, {}, { mode: 'off', screenIds: ['s_main'], by: 'hook' }, night);
  assert.deepEqual(r.changed, ['s_main']);
  assert.deepEqual(r.states.s_main, { on: false, until: '2026-10-10T07:00:00+01:00', by: 'hook', at: night.toISOString() });
  assert.deepEqual(privacyStatus(cfg, main, r.states.s_main, night), { active: false, until: null, by: 'hook', resumesAt: '2026-10-10T07:00:00+01:00' });
  // the next night the schedule is back
  assert.equal(privacyStatus(cfg, main, r.states.s_main, at('2026-10-10T22:30:00Z')).active, true);
  // off outside a window only clears the manual state; toggle flips
  r = applyPrivacyRequest(cfg, { s_kitchen: { on: true, until: null, by: 'admin', at: noon.toISOString() } }, { mode: 'off', screenIds: ['s_kitchen'] }, noon);
  assert.equal(r.states.s_kitchen, undefined);
  r = applyPrivacyRequest(cfg, {}, { mode: 'toggle', screenIds: ['s_kitchen'] }, noon);
  assert.deepEqual(r.states.s_kitchen, { on: true, until: null, by: 'admin', at: noon.toISOString() });
  assert.equal(privacyStatus(cfg, kitchen, r.states.s_kitchen, at('2030-01-01T00:00:00Z')).active, true); // until turned off
  r = applyPrivacyRequest(cfg, r.states, { mode: 'toggle', screenIds: ['s_kitchen'] }, noon);
  assert.equal(r.states.s_kitchen, undefined);
  // pruning: deleted screens and finished periods go
  assert.deepEqual(pruneStates(cfg, { s_gone: { on: true, until: null }, s_main: { on: true, until: '2020-01-01T00:00:00Z' } }, noon), {});
});

test('request validation', () => {
  const cfg = cfgWith();
  const now = at('2026-10-09T11:00:00Z');
  assert.match(sanitizePrivacyRequest({}, cfg, now).error, /mode/);
  assert.deepEqual(sanitizePrivacyRequest({ mode: 'on', hours: 3 }, cfg, now).value, { mode: 'on', end: '2026-10-09T14:00:00.000Z', screens: [] });
  assert.equal(sanitizePrivacyRequest({ mode: 'on' }, cfg, now).value.end, null);
  assert.equal(sanitizePrivacyRequest({ mode: 'on', untilTime: '06:00' }, cfg, now).value.end, '2026-10-10T06:00:00+01:00');
  assert.equal(sanitizePrivacyRequest({ mode: 'on', until: '2026-10-09T20:00:00Z', screens: ['kitchen'] }, cfg, now).value.end, '2026-10-09T20:00:00.000Z');
  assert.match(sanitizePrivacyRequest({ mode: 'on', until: '2026-10-08T20:00:00Z' }, cfg, now).error, /future/);
  assert.match(sanitizePrivacyRequest({ mode: 'on', hours: -1 }, cfg, now).error, /hours/);
  assert.match(sanitizePrivacyRequest({ mode: 'on', hours: 1, untilTime: '06:00' }, cfg, now).error, /only one/);
  assert.match(sanitizePrivacyRequest({ mode: 'on', untilTime: '25:00' }, cfg, now).error, /HH:MM/);
  assert.match(sanitizePrivacyRequest({ mode: 'on', screens: 'kitchen' }, cfg, now).error, /array/);
});

test('display config: privacy block, stock photos with hidePhotos, lock flag', () => {
  const cfg = cfgWith((c) => { c.screens[0].background.source = 'gallery'; c.screens[0].privacy = { hidePhotos: true, showLock: false }; });
  const s = cfg.screens[0];
  const off = displayConfig(cfg, s);
  assert.deepEqual(off.privacy, { active: false, until: null, lock: false, next: null });
  assert.equal(off.background.source, 'gallery');
  const status = { active: true, until: '2026-10-09T14:00:00.000Z', by: 'admin', resumesAt: null };
  const on = displayConfig(cfg, s, { privacy: { status, next: Date.parse('2026-10-09T14:00:00.000Z') } });
  assert.deepEqual(on.privacy, { active: true, until: '2026-10-09T14:00:00.000Z', lock: false, next: '2026-10-09T14:00:00.000Z' });
  assert.equal(on.background.source, 'stock');
  assert.equal(displayPrivacy(cfg.screens[1], status).lock, true);
  assert.equal(on.privacy.active && JSON.stringify(on).includes('"schedule"'), false); // the rules stay on the server
});

test('countdowns: private screens keep manual ones and those of "keep" sources', () => {
  const cfg = cfgWith((c) => {
    c.countdowns.items = [{ id: 'k_1', title: 'Trip', date: '2026-11-01', yearly: false }];
    c.birthdays.items = [{ id: 'b_1', name: 'Ana', month: 10, day: 20, year: null }];
  });
  const events = [
    { id: 'x1', sourceId: 'local', title: 'Surgery', start: '2026-10-15', allDay: true, countdown: true, hidden: false },
    { id: 'x2', sourceId: 'birthdays', itemId: 'b_1', title: 'Ana', start: '2026-10-20', allDay: true, hidden: false, age: null },
  ];
  const ctx = { today: '2026-10-11', tz: TZ, events };
  assert.deepEqual(computeCountdowns(cfg, cfg.screens[0], ctx).map((x) => x.title), ['Surgery', 'Ana', 'Trip']);
  assert.deepEqual(computeCountdowns(cfg, cfg.screens[0], { ...ctx, isPrivate: true }).map((x) => x.title), ['Ana', 'Trip']);
});

// ---------------------------------------------------------------- the real app

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-privacy-'));
  globalThis.fetch = offlineFetch;
  const c = defaultConfig();
  c.datetime.timezone = TZ;
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'open';
  // calendars.js memoises event lists by revision (one process runs every test file): use one of our own
  c.revision = 7000 + Math.floor(Math.random() * 1000);
  const today = localDate(new Date(), c.datetime.timezone);
  const tomorrow = addDays(today, 1);
  c.localEvents.items = [{ id: 'l_1', title: 'Dentist appointment', emoji: '🦷', location: 'Main St 1', notes: 'room 3', allDay: false, date: tomorrow, endDate: tomorrow, startTime: '10:00', endTime: '11:00', countdown: true }];
  const [, m, d] = today.split('-').map(Number);
  c.birthdays.items = [{ id: 'b_1', name: 'Ana', month: m, day: d, year: null }];
  c.screens[0].background.source = 'gallery';
  c.screens[0].privacy = { hidePhotos: true, showLock: true, schedule: [] };
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  fs.mkdirSync(path.join(dir, 'photos', '.thumbs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'photos', 'family.jpg'), 'jpeg');
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetActivityThrottle();
  _resetPrivacy();
  setServerVersion('0.5.3');
  await ensurePassword();
  const app = createApp({ version: '0.5.3', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, cookie = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, login, dir });
  } finally {
    _resetPrivacy();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

test('app: private titles never reach the display; admin and webhook endpoints', async () => {
  await withServer(async ({ call, login, dir }) => {
    const titles = async (slug) => (await call('GET', `/api/events?screen=${slug}`)).json.events.map((e) => e.title).sort();
    assert.deepEqual(await titles('living-room'), ['Ana', 'Dentist appointment']);
    const cd = await call('GET', '/api/countdowns?screen=living-room');
    assert.ok(cd.json.items.some((x) => x.title === 'Dentist appointment'));

    const poll = await call('GET', '/api/display/poll?screen=living-room&client=kiosk-p1');
    const { token } = createToken('Home Assistant');
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await call('POST', '/api/hooks/privacy', { headers: auth, body: { mode: 'sideways' } })).status, 400);
    assert.equal((await call('POST', '/api/hooks/privacy', { headers: auth, body: { mode: 'on', screens: ['nope'] } })).status, 400);
    assert.equal((await call('POST', '/api/hooks/privacy', { body: { mode: 'on' } })).status, 401);
    const on = await call('POST', '/api/hooks/privacy', { headers: auth, body: { mode: 'on', hours: 3, screens: ['living-room'] } });
    assert.equal(on.status, 200);
    assert.deepEqual(on.json.changed, ['s_main']);
    const row = on.json.screens.find((x) => x.slug === 'living-room');
    assert.equal(row.active, true);
    assert.equal(row.by, 'hook');
    assert.ok(Date.parse(row.until) > Date.now() + 2.9 * 3600_000);
    assert.equal(on.json.screens.find((x) => x.slug === 'kitchen').active, false);

    // the living room is private: busy block, birthday kept, no location / notes / emoji anywhere
    const ev = await call('GET', '/api/events?screen=living-room');
    assert.deepEqual(ev.json.events.map((e) => e.title).sort(), ['Ana', 'Busy']);
    assert.doesNotMatch(ev.text, /Dentist|Main St|room 3|🦷/);
    assert.match(ev.json.hash, /^p/);
    assert.deepEqual(await titles('kitchen'), ['Ana', 'Dentist appointment']);
    const cd2 = await call('GET', '/api/countdowns?screen=living-room');
    assert.doesNotMatch(cd2.text, /Dentist/);
    const conf = await call('GET', '/api/display/config?screen=living-room');
    assert.equal(conf.json.privacy.active, true);
    assert.equal(conf.json.privacy.lock, true);
    assert.equal(conf.json.background.source, 'stock');
    const photos = await call('GET', '/api/photos?screen=living-room');
    assert.doesNotMatch(photos.text, /family\.jpg/);
    assert.equal((await call('GET', '/api/display/config?screen=kitchen')).json.privacy.active, false);
    // poll displays get the `privacy` command (the kitchen does not)
    const later = await call('GET', `/api/display/poll?screen=living-room&client=kiosk-p1&cursor=${poll.json.cursor}`);
    assert.deepEqual(later.json.commands, [{ type: 'privacy', active: true }]);
    const kitchenLater = await call('GET', `/api/display/poll?screen=kitchen&client=kiosk-p2&cursor=${poll.json.cursor}`);
    assert.deepEqual(kitchenLater.json.commands, []);

    // GET for Home Assistant, state stored on disk
    const st = await call('GET', '/api/hooks/privacy', { headers: auth });
    assert.equal(st.json.screens.find((x) => x.slug === 'living-room').active, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'privacy.json'), 'utf8')).screens.s_main.on, true);
    assert.ok(listActivity({ type: 'privacy' }).items.some((a) => a.data.via === 'hook' && a.data.mode === 'on'));

    // the admin keeps real data
    const cookie = await login();
    const dash = await call('GET', '/api/admin/dashboard', { cookie });
    assert.ok(dash.json.nextEvents.some((e) => e.title === 'Dentist appointment'));
    const adminCd = await call('GET', '/api/admin/countdowns?screen=living-room', { cookie });
    assert.ok(adminCd.json.items.some((x) => x.title === 'Dentist appointment'));
    assert.equal((await call('GET', '/api/admin/privacy')).status, 401);
    const all = await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', untilTime: '06:00' } });
    assert.deepEqual(all.json.changed, ['s_kitchen']);
    assert.ok(all.json.screens.every((x) => x.active && x.by === 'admin'));
    const off = await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'off' } });
    assert.deepEqual(off.json.changed.sort(), ['s_kitchen', 's_main']);
    assert.deepEqual((await call('GET', '/api/admin/privacy', { cookie })).json.screens.map((x) => x.active), [false, false]);
    assert.deepEqual(await titles('living-room'), ['Ana', 'Dentist appointment']);
  });
});

test('app: privacy write failures leave the saved state and displays unchanged', async (t) => {
  await withServer(async ({ call, login, dir }) => {
    const cookie = await login();
    const { token } = createToken('Home Assistant');
    const headers = { authorization: `Bearer ${token}` };
    const privacyFile = path.join(dir, 'privacy.json');
    const on = await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 1 } });
    assert.equal(on.status, 200);
    const saved = fs.readFileSync(privacyFile, 'utf8');
    const poll = await call('GET', '/api/display/poll?client=privacy-save-test');
    const rename = fs.renameSync;
    const warnings = [];
    const errors = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    t.mock.method(console, 'error', (...args) => errors.push(args));
    t.mock.method(fs, 'renameSync', (from, to) => {
      if (to === privacyFile) throw Object.assign(new Error('disk unavailable'), { code: 'EIO' });
      return rename(from, to);
    });
    try {
      for (const options of [{ cookie }, { headers }]) {
        const route = options.cookie ? '/api/admin/privacy' : '/api/hooks/privacy';
        const failed = await call('POST', route, { ...options, body: { mode: 'off' } });
        assert.equal(failed.status, 500);
        assert.deepEqual(failed.json, { error: 'internal error' });
      }
      assert.ok((await call('GET', '/api/admin/privacy', { cookie })).json.screens.every((x) => x.active));
      assert.equal(fs.readFileSync(privacyFile, 'utf8'), saved);
      const later = await call('GET', `/api/display/poll?client=privacy-save-test&cursor=${poll.json.cursor}`);
      assert.deepEqual(later.json.commands, []);
      assert.doesNotMatch((await call('GET', '/api/events')).text, /Dentist appointment/);
      assert.equal(errors.length, 2);

      // Expired-state cleanup runs from timers and config listeners, where a write error must stay caught.
      assert.doesNotThrow(() => syncPrivacy(new Date(Date.now() + 2 * 3600_000)));
      assert.ok(warnings.some((message) => message.includes('[privacy] save failed: disk unavailable')));
    } finally {
      t.mock.restoreAll();
    }
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'off' } })).status, 200);
  });
});

test('display: the `privacy` live event goes through the shared dispatch (SSE and poll)', async (t) => {
  let live;
  try {
    live = await import('../../web/display/live.ts');
  } catch {
    return t.skip('TypeScript imports need Node ≥ 22.18');
  }
  const seen = [];
  assert.equal(live.dispatch('privacy', { active: true }, { privacy: (d) => seen.push(d) }), true);
  assert.equal(live.dispatch('privacy', { active: 'yes' }, { privacy: (d) => seen.push(d) }), true);
  assert.deepEqual(seen, [{ active: true }, { active: false }]);
  let n = 0;
  live.applyPoll({ revision: 3, screenId: 's_main' }, { revision: 3, screenId: 's_main', now: '', serverVersion: '', cursor: 'x', reset: false, commands: [{ type: 'privacy', active: true }], next: 1000 }, { first() {}, screenChanged() {}, privacy: () => n++ });
  assert.equal(n, 1);
});
