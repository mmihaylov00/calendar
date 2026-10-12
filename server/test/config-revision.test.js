// Revision guard on config saves: store conflict, PUT /api/admin/config with baseRevision (409 conflict, last write
// wins without it), a server-side save (the Google sign-in adding the allowed email) followed by a save from an
// open tab, the admin overwrite flow (configMerge.ts), the admin error map (apiErrors.ts) and
// configuration validation. Runs the real app (server/app.js createApp) on a random port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { syncDisplayKeys } from '../displayAccess.js';
import { loadWebModules } from './webModules.js';

const [merge, errs, i18n] = await loadWebModules('/web/admin/configMerge.ts', '/web/admin/apiErrors.ts', '/web/admin/i18n.ts');

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));

function tempStore(mut = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-rev-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  mut(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  return dir;
}

async function withServer(fn) {
  const dir = tempStore((c) => {
    c.countdowns.items = [{ id: 'k1', title: 'Summer', emoji: '☀️', color: null, date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), yearly: false }];
  });
  globalThis.fetch = offlineFetch;
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(dist, 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>display</title>');
  fs.writeFileSync(path.join(dist, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  store.initStore(dir);
  await ensurePassword();
  syncDisplayKeys();
  const app = createApp({ version: '0.5.0', dist });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, cookie = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, login, dir });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

test('store: a stale baseRevision is a conflict and writes nothing; no baseRevision = last write wins', () => {
  const dir = tempStore();
  try {
    store.initStore(dir);
    const r0 = store.getConfig().revision;
    const a = structuredClone(store.getConfig());
    a.weather.locationName = 'Tab A';
    const okA = store.saveConfig(a, { backup: false, baseRevision: r0 });
    assert.equal(okA.ok, true);
    assert.equal(okA.config.revision, r0 + 1);

    const b = structuredClone(a);
    b.weather.locationName = 'Tab B';
    const stale = store.saveConfig(b, { backup: false, baseRevision: r0 });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict, true);
    assert.equal(stale.config.revision, r0 + 1);
    assert.equal(store.getConfig().weather.locationName, 'Tab A');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).weather.locationName, 'Tab A');

    // no baseRevision: as before 0.5, the last write wins
    const old = store.saveConfig(b, { backup: false });
    assert.equal(old.ok, true);
    assert.equal(store.getConfig().weather.locationName, 'Tab B');
    // invalid configs are still reported as invalid, not as a conflict
    const bad = structuredClone(store.getConfig());
    bad.weather.lat = 500;
    const inv = store.saveConfig(bad, { backup: false, baseRevision: store.getConfig().revision });
    assert.equal(inv.ok, false);
    assert.equal(inv.conflict, undefined);
    assert.ok(inv.errors.some((e) => e.path === 'weather.lat'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PUT /api/admin/config: 409 conflict on a stale baseRevision, 400 on a bad one, old bodies still save', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    const r0 = cfg.revision;

    const first = await call('PUT', '/api/admin/config', { cookie, body: { ...cfg, weather: { ...cfg.weather, locationName: 'first' }, baseRevision: r0 } });
    assert.equal(first.status, 200);
    assert.equal(first.json.revision, r0 + 1);
    assert.equal('baseRevision' in first.json, false);

    const second = await call('PUT', '/api/admin/config', { cookie, body: { ...cfg, weather: { ...cfg.weather, locationName: 'second' }, baseRevision: r0 } });
    assert.equal(second.status, 409);
    assert.deepEqual(second.json, { error: 'conflict', revision: r0 + 1 });
    assert.equal((await call('GET', '/api/admin/config', { cookie })).json.weather.locationName, 'first');

    for (const baseRevision of ['1', -1, 1.5, true, {}]) {
      const r = await call('PUT', '/api/admin/config', { cookie, body: { ...cfg, baseRevision } });
      assert.equal(r.status, 400, JSON.stringify(baseRevision));
      assert.equal(r.json.details[0].path, 'baseRevision');
    }
    // null = no guard, like a body without the field (admin builds from before 0.5)
    const legacy = await call('PUT', '/api/admin/config', { cookie, body: { ...cfg, weather: { ...cfg.weather, locationName: 'legacy' } } });
    assert.equal(legacy.status, 200);
    const nul = await call('PUT', '/api/admin/config', { cookie, body: { ...cfg, weather: { ...cfg.weather, locationName: 'null base' }, baseRevision: null } });
    assert.equal(nul.status, 200);
    assert.equal(nul.json.weather.locationName, 'null base');
    // no session: 401 before any revision check
    assert.equal((await call('PUT', '/api/admin/config', { body: { ...cfg, baseRevision: 0 } })).status, 401);
  });
});

test('a server-side save (Google sign-in adds the allowed email) gives an open tab a 409, and overwrite keeps both changes', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    // the tab loads the config and starts editing
    const base = (await call('GET', '/api/admin/config', { cookie })).json;
    const mine = structuredClone(base);
    mine.weather.locationName = 'Porto, Portugal';
    mine.screens[0].name = 'Kitchen';

    // meanwhile: the Google login callback (server/auth.js) saves through updateConfig
    store.updateConfig((c) => { c.auth.allowedGoogleEmails = ['family@example.com']; }, { reason: 'server' });
    assert.equal(store.getConfig().revision, base.revision + 1);

    // the tab saves: conflict, nothing lost
    const put = await call('PUT', '/api/admin/config', { cookie, body: { ...mine, baseRevision: mine.revision } });
    assert.equal(put.status, 409);
    assert.equal(put.json.error, 'conflict');
    assert.deepEqual(store.getConfig().auth.allowedGoogleEmails, ['family@example.com']);
    assert.equal(store.getConfig().weather.locationName, base.weather.locationName);

    // overwrite: refetch, merge this tab's changes on top, send the new baseRevision
    const theirs = (await call('GET', '/api/admin/config', { cookie })).json;
    const merged = merge.mergeOverwrite(base, mine, theirs);
    assert.equal(merged.revision, theirs.revision);
    const again = await call('PUT', '/api/admin/config', { cookie, body: { ...merged, baseRevision: merged.revision } });
    assert.equal(again.status, 200);
    assert.equal(again.json.weather.locationName, 'Porto, Portugal');
    assert.equal(again.json.screens[0].name, 'Kitchen');
    assert.deepEqual(again.json.auth.allowedGoogleEmails, ['family@example.com']);
  });
});

test('saveWithRevision drives the whole flow through the real server', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    const put = async (body) => {
      const r = await call('PUT', '/api/admin/config', { cookie, body });
      if (r.status !== 200) throw Object.assign(new Error(r.json?.error), { status: r.status, body: r.json });
      return r.json;
    };
    const get = async () => (await call('GET', '/api/admin/config', { cookie })).json;
    const isConflict = (e) => e.status === 409 && e.body?.error === 'conflict';
    const base = await get();
    const mine = { ...structuredClone(base), weather: { ...base.weather, locationName: 'mine' } };
    store.updateConfig((c) => { c.news.maxItems = 3; }, { reason: 'server' });

    const asked = [];
    const merges = [];
    const out = await merge.saveWithRevision({
      draft: mine, base, put, get, isConflict,
      choose: async (theirs) => { asked.push(theirs.revision); return 'overwrite'; },
      merged: (d, theirs) => merges.push([d.revision, theirs.revision]),
    });
    assert.equal(out.status, 'saved');
    assert.equal(asked.length, 1);
    assert.deepEqual(merges, [[asked[0], asked[0]]]);
    assert.equal(out.config.weather.locationName, 'mine');
    assert.equal(out.config.news.maxItems, 3);

    // reload: nothing is written, the saved config comes back
    const stale = { ...structuredClone(base), weather: { ...base.weather, locationName: 'lost' } };
    const rev = store.getConfig().revision;
    const re = await merge.saveWithRevision({ draft: stale, base, put, get, isConflict, choose: async () => 'reload' });
    assert.equal(re.status, 'reloaded');
    assert.equal(re.config.revision, rev);
    assert.equal(store.getConfig().weather.locationName, 'mine');

    // cancel (keep editing): nothing is written
    const ca = await merge.saveWithRevision({ draft: stale, base, put, get, isConflict, choose: async () => null });
    assert.deepEqual(ca, { status: 'cancelled' });
    assert.equal(store.getConfig().revision, rev);
  });
});

test('saveWithRevision: other errors are thrown, endless conflicts stop', async () => {
  const cfg = { ...defaultConfig(), revision: 4 };
  const bad = Object.assign(new Error('invalid'), { status: 400 });
  await assert.rejects(
    merge.saveWithRevision({ draft: cfg, base: cfg, put: async () => { throw bad; }, get: async () => cfg, choose: async () => 'overwrite', isConflict: () => false }),
    (e) => e === bad
  );
  let puts = 0;
  const sent = [];
  const out = await merge.saveWithRevision({
    draft: cfg,
    base: cfg,
    put: async (b) => { puts++; sent.push(b.baseRevision); throw { conflict: true }; },
    get: async () => ({ ...cfg, revision: cfg.revision + puts }),
    choose: async () => 'overwrite',
    isConflict: (e) => e.conflict === true,
  });
  assert.deepEqual(out, { status: 'cancelled' });
  assert.equal(puts, 3);
  assert.deepEqual(sent, [4, 5, 6]);
});

test('mergeOverwrite: untouched parts take the saved value, parts changed here win', () => {
  const base = { ...defaultConfig(), revision: 1 };
  const mine = structuredClone(base);
  mine.weather.locationName = 'Mine';
  mine.news.maxItems = 7;
  const theirs = structuredClone(base);
  theirs.revision = 2;
  theirs.weather.lat = 10; // same section, other key: kept
  theirs.news.maxItems = 2; // same key: this tab wins
  theirs.auth.allowedGoogleEmails = ['a@example.com']; // untouched section: kept
  theirs.countdowns.items = [{ id: 'k9', title: 'x', emoji: '⏳', color: null, date: '2099-01-01', yearly: false }];
  const out = merge.mergeOverwrite(base, mine, theirs);
  assert.equal(out.revision, 2);
  assert.equal(out.weather.locationName, 'Mine');
  assert.equal(out.weather.lat, 10);
  assert.equal(out.news.maxItems, 7);
  assert.deepEqual(out.auth.allowedGoogleEmails, ['a@example.com']);
  assert.equal(out.countdowns.items.length, 1);
  // nothing changed here: the saved config as is
  assert.deepEqual(merge.mergeOverwrite(base, structuredClone(base), theirs), theirs);
});

test('mergeOverwrite: lists with ids merge item by item (screens, countdowns)', () => {
  const base = { ...defaultConfig(), revision: 1 };
  const s0 = base.screens[0];
  base.screens = [s0, { ...structuredClone(s0), id: 'scr-b', slug: 'hall', name: 'Hall' }];
  base.countdowns.items = [
    { id: 'k1', title: 'One', emoji: '⏳', color: null, date: '2099-01-01', yearly: false },
    { id: 'k2', title: 'Two', emoji: '⏳', color: null, date: '2099-02-01', yearly: false },
  ];
  const mine = structuredClone(base);
  mine.screens[0].name = 'Kitchen'; // edited here
  mine.countdowns.items.push({ id: 'k3', title: 'Mine', emoji: '⏳', color: null, date: '2099-03-01', yearly: false });
  mine.countdowns.items = mine.countdowns.items.filter((x) => x.id !== 'k2'); // removed here
  const theirs = structuredClone(base);
  theirs.revision = 2;
  theirs.screens[1].name = 'Hallway'; // another screen edited elsewhere
  theirs.screens[0].orientation = theirs.screens[0].orientation === 'portrait' ? 'landscape' : 'portrait'; // same screen, other key
  theirs.countdowns.items[0].title = 'One (edited)';
  theirs.countdowns.items.push({ id: 'k4', title: 'Theirs', emoji: '⏳', color: null, date: '2099-04-01', yearly: false });
  const out = merge.mergeOverwrite(base, mine, theirs);
  assert.deepEqual(out.screens.map((x) => x.name), ['Kitchen', 'Hallway']);
  assert.equal(out.screens[0].orientation, theirs.screens[0].orientation);
  assert.deepEqual(out.countdowns.items.map((x) => x.id), ['k1', 'k4', 'k3']);
  assert.equal(out.countdowns.items[0].title, 'One (edited)');
  // reordered here: this tab's order wins, items added elsewhere go last
  const moved = structuredClone(base);
  moved.screens.reverse();
  const theirs2 = structuredClone(base);
  theirs2.revision = 2;
  theirs2.screens.push({ ...structuredClone(s0), id: 'scr-c', slug: 'office', name: 'Office' });
  assert.deepEqual(merge.mergeOverwrite(base, moved, theirs2).screens.map((x) => x.id), ['scr-b', s0.id, 'scr-c']);
});

test('admin error map: every code has an English message', () => {
  const codes = ['rate_limited', 'screen_limit', 'limit_exceeded', 'feature_unavailable', 'conflict', 'photo_quota', 'readonly'];
  assert.deepEqual(Object.keys(errs.API_ERROR_MESSAGES).sort(), [...codes].sort());
  const seen = new Set();
  for (const code of codes) {
    const message = errs.apiErrorMessage(409, { error: code });
    assert.ok(message && !message.includes(code), `${code}: ${message}`);
    assert.ok(!/[—]/.test(message), 'no em dash');
    seen.add(message);
    assert.equal(errs.apiErrorMessage(400, { error: 'some text', code }), message);
    assert.equal(errs.apiErrorCode({ error: 'x', code }), code);
    assert.equal(message, errs.API_ERROR_MESSAGES[code]);
  }
  assert.equal(seen.size, codes.length);
  assert.equal(
    errs.apiErrorMessage(400, { error: 'invalid config', details: [{ path: 'weather.source', message: 'feature_unavailable' }] }),
    'invalid config: weather.source: This feature is not available on this server.'
  );
  assert.equal(
    errs.apiErrorMessage(400, { error: 'limit_exceeded', details: [{ path: 'screens', message: 'max 6' }] }),
    'Over the allowed maximum: screens: max 6'
  );
  assert.equal(errs.apiErrorMessage(404, { error: 'not found' }), 'not found');
  assert.equal(errs.apiErrorMessage(502, null), 'HTTP 502');
  assert.equal(errs.apiErrorMessage(500, 'Bad gateway'), 'Bad gateway');
  assert.equal(errs.apiErrorCode({ error: 'toString' }), '');
  assert.equal(errs.apiErrorCode(null), '');
});

test('admin text stays English and retains count and placeholder formatting', () => {
  assert.equal(i18n.getLang(), 'en');
  assert.equal(i18n.locale(), 'en-GB');
  assert.equal(i18n.t('Add {n} birthdays', { n: 1 }), 'Add 1 birthday');
  assert.equal(i18n.t('Add {n} birthdays', { n: 2 }), 'Add 2 birthdays');
  assert.equal(i18n.t('Every {n} years on {date}', { n: 1, date: 'March 7' }), 'Every year on March 7');
  assert.equal(i18n.t('Hello {name} at {time}', { name: 'Mira' }), 'Hello Mira at {time}');
  assert.equal(i18n.nScreens(1), '1 screen');
  assert.equal(i18n.nScreens(3), '3 screens');
});
