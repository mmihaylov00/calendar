// admin HTTP routes (session): config save → backup + activity, screens template, displays,
// announcements, tokens, backups/restore, export/import (incl. secrets → logout), activity, dashboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, hashPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { screensAdminRouter, displayPublicRouter } from '../routes/screens.js';
import { announceRouter } from '../routes/announce.js';
import { systemRouter } from '../routes/system.js';
import { changedSections, logActivity } from '../activity.js';
import { closeAll } from '../sse.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetDisplays, setServerVersion } from '../displays.js';

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-core-routes-'));
  const c = defaultConfig();
  c.calendar.sources = []; // no network in tests
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret123'), passwordIsDefault: false }));
  store.initStore(dir);
  _resetAnnouncements();
  _resetDisplays();
  setServerVersion('0.2.0');
  await ensurePassword();
  const onConfig = (cfg, prev, { reason, req } = {}) => {
    if (reason !== 'restore' && reason !== 'import') logActivity('config.saved', { req, data: { revision: cfg.revision, sections: changedSections(prev, cfg) } });
  };
  store.events.on('config', onConfig);

  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(sessionMiddleware());
  app.use(['/api/admin/import/preview', '/api/admin/import/apply'], express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api/admin', '/api/auth'], csrfGuard({ multipartPaths: ['/photos'] }));
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/api/admin', adminRouter());
  app.use('/api/admin', screensAdminRouter(), announceRouter(), systemRouter({ version: '0.2.0' }));
  app.use('/api', displayPublicRouter());
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((x) => x.split(';')[0]).join('; ');
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, headers: r.headers, text };
  };
  try {
    await fn({ call, dir });
  } finally {
    store.events.off('config', onConfig);
    closeAll();
    _resetAnnouncements();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('admin routes: auth required, config save → backup + config.saved activity, screen template', async () => {
  await withApp(async ({ call, dir }) => {
    assert.equal((await call('GET', '/api/admin/config')).status, 401);
    assert.equal((await call('GET', '/api/admin/dashboard')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { password: 'nope' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' })).status, 200);
    const cfg = (await call('GET', '/api/admin/config')).json;
    assert.equal(cfg.version, 2);
    const tpl = (await call('GET', '/api/admin/screens/template?name=Cocina')).json;
    assert.equal(tpl.slug, 'cocina');
    assert.equal(tpl.name, 'Cocina');
    cfg.screens.push(tpl);
    const saved = await call('PUT', '/api/admin/config', cfg);
    assert.equal(saved.status, 200);
    assert.equal(saved.json.screens.length, 2);
    assert.equal(saved.json.revision, cfg.revision + 1);
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.endsWith('-save.json')).length, 1);
    const bad = structuredClone(saved.json);
    bad.screens[1].screen.accent = 'rojo';
    const r400 = await call('PUT', '/api/admin/config', bad);
    assert.equal(r400.status, 400);
    assert.ok(r400.json.details.some((d) => d.path === 'screens[1].screen.accent'));
    const act = (await call('GET', '/api/admin/activity?type=config')).json;
    assert.equal(act.items[0].type, 'config.saved');
    assert.deepEqual(act.items[0].data.sections, ['screens:+cocina']);
    assert.equal(act.items[0].actor, 'admin');
    const logins = (await call('GET', '/api/admin/activity?type=auth')).json.items.map((e) => e.type);
    assert.deepEqual(logins, ['auth.login', 'auth.login_failed']);
    assert.equal((await call('GET', '/api/admin/activity?level=warn')).json.items[0].type, 'auth.login_failed');

    // displays + commands (no display connected)
    assert.deepEqual((await call('GET', '/api/admin/displays')).json, { displays: [], serverVersion: '0.2.0' });
    assert.equal((await call('POST', '/api/display/heartbeat', { clientId: 'kiosk-1', screen: 'cocina', version: '0.1.0' })).status, 200);
    const d = (await call('GET', '/api/admin/displays')).json.displays[0];
    assert.equal(d.screenSlug, 'cocina');
    assert.equal(d.outdated, true);
    assert.equal(d.connected, false);
    assert.deepEqual((await call('POST', '/api/admin/displays/command', { action: 'reload' })).json, { ok: true, delivered: 0 });
    assert.equal((await call('POST', '/api/admin/displays/command', { action: 'night' })).status, 400);
    assert.deepEqual((await call('POST', '/api/admin/refresh-displays', { screens: ['cocina'] })).json, { ok: true, displays: 0, delivered: 0 });
    assert.equal((await call('POST', '/api/admin/refresh-displays', { screens: ['nada'] })).status, 400);
    assert.deepEqual((await call('DELETE', '/api/admin/displays/kiosk-1')).json, { ok: true });
    assert.equal((await call('DELETE', '/api/admin/displays/kiosk-1')).status, 404);
  });
});

test('admin routes: announcements + tokens', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/auth/login', { password: 'secret123' });
    const a = await call('POST', '/api/admin/announce', { title: 'Cena', emoji: '🍽️', style: 'warning', durationSec: 120 });
    assert.equal(a.status, 200);
    assert.equal(a.json.announcement.by, 'admin');
    assert.equal(a.json.announcement.via, 'admin');
    assert.equal((await call('POST', '/api/admin/announce', { style: 'info' })).status, 400);
    assert.equal((await call('GET', '/api/admin/announcements')).json.active.length, 1);
    assert.equal((await call('DELETE', `/api/admin/announcements/${a.json.announcement.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/admin/announcements/${a.json.announcement.id}`)).status, 404);
    assert.deepEqual((await call('DELETE', '/api/admin/announcements')).json, { ok: true, cleared: 0 });
    const l = (await call('GET', '/api/admin/announcements')).json;
    assert.equal(l.active.length, 0);
    assert.equal(l.history[0].title, 'Cena');

    const t = (await call('POST', '/api/admin/tokens', { name: 'Home Assistant' })).json;
    assert.match(t.token, /^cs_/);
    const list = (await call('GET', '/api/admin/tokens')).json;
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes(t.token));
    assert.equal(list[0].hash, undefined);
    assert.equal((await call('POST', '/api/admin/tokens', { name: '' })).status, 400);
    assert.equal((await call('DELETE', `/api/admin/tokens/${t.info.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/admin/tokens/${t.info.id}`)).status, 404);
  });
});

test('admin routes: backups, restore, export/import with secrets → logged out, dashboard', async () => {
  await withApp(async ({ call }) => {
    await call('POST', '/api/auth/login', { password: 'secret123' });
    const b = (await call('POST', '/api/admin/backups')).json;
    assert.equal(b.reason, 'manual');
    const dl = await call('GET', `/api/admin/backups/${b.id}`);
    assert.match(dl.headers.get('content-disposition'), /attachment/);
    assert.equal(JSON.parse(dl.text).version, 2);
    assert.equal((await call('GET', '/api/admin/backups/..%2Fsecrets.json')).status, 404);
    assert.equal((await call('GET', '/api/admin/backups/secrets.json')).status, 404);

    // change something, then restore the manual backup
    const cfg = (await call('GET', '/api/admin/config')).json;
    cfg.screens[0].name = 'Cambiado';
    await call('PUT', '/api/admin/config', cfg);
    const rs = await call('POST', `/api/admin/backups/${b.id}/restore`);
    assert.equal(rs.status, 200);
    assert.equal(rs.json.config.screens[0].name, 'Living room');
    assert.equal(rs.json.config.revision, cfg.revision + 2);
    assert.ok((await call('GET', '/api/admin/backups')).json.some((x) => x.reason === 'restore'));
    assert.equal((await call('GET', '/api/admin/activity?type=config.restored')).json.items.length, 1);

    // export without / with secrets
    const ex = await call('POST', '/api/admin/export', { includeSecrets: false });
    assert.match(ex.headers.get('content-disposition'), /attachment; filename="calendar-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(ex.json.secrets, undefined);
    const exs = await call('POST', '/api/admin/export', { includeSecrets: true });
    assert.ok(exs.json.secrets.passwordHash);
    assert.ok(!exs.text.includes(store.getSecrets().sessionSecret));

    // preview + apply (sections), then secrets with another password → everyone logged out
    const bundle = structuredClone(exs.json);
    bundle.config.birthdays.items = [{ name: 'María', month: 3, day: 4, year: 1990 }];
    bundle.config.screens[0].name = 'Importado';
    const pv = (await call('POST', '/api/admin/import/preview', { bundle, lang: 'es' })).json;
    assert.equal(pv.ok, true);
    assert.equal(pv.hasSecrets, true);
    assert.equal(pv.sections.find((s) => s.key === 'birthdays').summary, '+1 item');
    const pvEn = (await call('POST', '/api/admin/import/preview', { bundle })).json;
    assert.equal(pvEn.sections.find((s) => s.key === 'birthdays').summary, '+1 item');
    assert.equal((await call('POST', '/api/admin/import/preview', {})).status, 400);
    const ap = await call('POST', '/api/admin/import/apply', { bundle, includeSecrets: false, sections: ['birthdays'] });
    assert.equal(ap.status, 200);
    assert.equal(ap.json.config.birthdays.items[0].name, 'María');
    assert.equal(ap.json.config.screens[0].name, 'Living room');
    assert.equal(ap.json.loggedOut, undefined);
    const badBundle = structuredClone(bundle);
    badBundle.config.weather.lat = 500;
    assert.equal((await call('POST', '/api/admin/import/apply', { bundle: badBundle, includeSecrets: false })).status, 400);

    // dashboard shape
    const dash = (await call('GET', '/api/admin/dashboard')).json;
    assert.equal(dash.version, '0.2.0');
    assert.equal(dash.screens[0].isDefault, true);
    assert.deepEqual(dash.nextEvents, []);
    assert.equal(dash.weather, null);
    assert.ok(dash.warnings.includes('no_displays'));
    assert.ok(Array.isArray(dash.schedulesNow));
    assert.ok(dash.activity.length > 0 && dash.activity.length <= 8);

    bundle.secrets.passwordHash = await hashPassword('otra-clave');
    const ap2 = await call('POST', '/api/admin/import/apply', { bundle, includeSecrets: true });
    assert.equal(ap2.status, 200);
    assert.equal(ap2.json.loggedOut, true);
    assert.equal(ap2.json.config.screens[0].name, 'Importado');
    assert.equal((await call('GET', '/api/admin/config')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { password: 'otra-clave' })).status, 200);
    const imp = (await call('GET', '/api/admin/activity?type=config.imported')).json.items[0];
    assert.deepEqual(imp.data.secrets, ['google', 'apiTokens', 'devices', 'password']); // no HA token / display keys in this bundle
    assert.equal(imp.level, 'warn');

    assert.deepEqual((await call('DELETE', '/api/admin/activity')).json, { ok: true });
    assert.deepEqual((await call('GET', '/api/admin/activity')).json.items.map((e) => e.type), ['activity.cleared']);
  });
});
