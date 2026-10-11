// First-run setup wizard: state machine, single use, race, password rules, SETUP_TOKEN / remote token,
// existing installs never enter setup, ADMIN_PASSWORD bootstrap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, meHandler, hashPassword, verifyPassword } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { setupRouter, setupToken, _resetSetup, parseSetupBody, applySetup } from '../setup.js';
import { passwordProblem, isTrivialPassword } from '../lib/password.js';
import { listActivity as getActivity, _resetActivityThrottle } from '../activity.js';
import { closeAll } from '../sse.js';

const GOOD = 'tidy-otter-lamp-42';

async function withApp(fn, { secrets = {}, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-setup-'));
  const c = defaultConfig();
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  if (secrets) fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(secrets));
  const saved = {};
  for (const [k, v] of Object.entries({ SETUP_TOKEN: undefined, ADMIN_PASSWORD: undefined, ...env })) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  store.initStore(dir);
  _resetSetup();
  await ensurePassword();

  const app = express();
  app.set('trust proxy', true); // tests pick the client IP with X-Forwarded-For
  app.use(sessionMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api/admin', '/api/auth', '/api/setup'], csrfGuard());
  app.get('/api/auth/me', meHandler);
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/api/setup', setupRouter({ version: '9.9.9' }));
  app.use('/api/admin', adminRouter());
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  /** call(method, url, body, { ip, headers, jar }) */
  const call = async (method, url, body, o = {}) => {
    const j = o.jar ?? jar;
    const r = await fetch(base + url, {
      method,
      headers: {
        ...(j.cookie ? { cookie: j.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-forwarded-for': o.ip ?? '192.168.1.20',
        ...(o.headers || {}),
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) j.cookie = set.map((x) => x.split(';')[0]).join('; ');
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json };
  };
  try {
    await fn({ call, dir, base });
  } finally {
    closeAll();
    await new Promise((r) => server.close(r));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetSetup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const body = (extra = {}) => ({
  password: GOOD, passwordConfirm: GOOD, language: 'en', screenName: 'Cocina',
  location: { name: 'Porto, Portugal', lat: 41.14961, lon: -8.61099, timezone: 'Europe/Lisbon' },
  units: 'metric', format24: false,
  calendars: [{ name: 'Festivos de España', url: 'https://calendar.google.com/calendar/ical/es.spain%23holiday%40group.v.calendar.google.com/public/basic.ics', kind: 'holidays' }],
  photos: { source: 'gallery' }, layout: { preset: 'agenda' }, accent: '#2EC4B6', ambient: 'particles',
  ...extra,
});

test('password rules: length, common words, trivial patterns, confirmation', () => {
  assert.equal(passwordProblem('short1!'), 'too_short');
  assert.equal(passwordProblem('ñ'.repeat(9)), 'too_short');
  assert.equal(passwordProblem('x'.repeat(201)), 'too_long');
  for (const p of ['password123', 'Password2024!', 'qwertyuiop', '1234567890', 'aaaaaaaaaaaa', 'abcabcabcabc', 'admin12345', 'marcomarco', 'ababababab', 'contraseña123'])
    assert.equal(passwordProblem(p), 'too_common', p);
  assert.equal(passwordProblem(GOOD, 'other'), 'mismatch');
  assert.equal(passwordProblem(GOOD, GOOD), null);
  assert.equal(passwordProblem(GOOD), null);
  assert.equal(isTrivialPassword('correct horse battery'), false);
});

test('fresh install needs setup: status, no default password, login refused, admin locked', async () => {
  await withApp(async ({ call }) => {
    const st = await call('GET', '/api/setup/status', undefined, { headers: { 'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8' } });
    assert.equal(st.status, 200);
    assert.equal(st.json.needsSetup, true);
    assert.equal(st.json.version, '9.9.9');
    assert.equal(st.json.suggestedLanguage, 'en');
    assert.equal(st.json.googleConfigured, false);
    assert.equal(st.json.tokenRequired, false); // LAN client, no SETUP_TOKEN
    assert.equal(store.getSecrets().passwordHash, undefined);
    for (const pw of ['admin', '', 'change-me']) assert.equal((await call('POST', '/api/auth/login', { password: pw })).status, 409);
    assert.equal((await call('GET', '/api/admin/config')).status, 401);
    const me = (await call('GET', '/api/auth/me')).json;
    assert.equal(me.needsSetup, true);
    assert.equal(me.user, null);
  }, { secrets: null });
});

test('complete: validates, applies the settings, logs in, writes activity; then single use (409)', async () => {
  await withApp(async ({ call }) => {
    // validation errors leave the install untouched
    let r = await call('POST', '/api/setup/complete', body({ password: 'password123', passwordConfirm: 'password123' }));
    assert.equal(r.status, 400);
    assert.ok(r.json.details.some((d) => d.path === 'password'));
    r = await call('POST', '/api/setup/complete', body({ passwordConfirm: 'nope' }));
    assert.equal(r.status, 400);
    assert.ok(r.json.details.some((d) => d.path === 'passwordConfirm'));
    r = await call('POST', '/api/setup/complete', body({ location: { lat: 200, lon: 0 }, calendars: [{ url: 'ftp://x' }], layout: { preset: 'nope' } }));
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.details.map((d) => d.path).sort(), ['calendars[0].url', 'layout.preset', 'location.lat']);
    assert.equal(store.getSecrets().passwordHash, undefined);
    // not JSON → 415 (stricter than the global guard: an empty POST is refused too)
    assert.equal((await call('POST', '/api/setup/complete', `password=${GOOD}`, { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await call('POST', '/api/setup/complete')).status, 415);
    // cross-origin → 403
    assert.equal((await call('POST', '/api/setup/complete', body(), { headers: { origin: 'https://evil.example' } })).status, 403);

    r = await call('POST', '/api/setup/complete', body());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const { displayPath, ...doneScreen } = r.json.screen;
    assert.deepEqual(doneScreen, { id: 's_main', slug: 'cocina', name: 'Cocina' });
    // fresh install → private display access: the Done step gets the screen's private link
    assert.equal(r.json.displayAccess, 'private');
    assert.match(displayPath, /^\/d\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // logged in right away
    const me = (await call('GET', '/api/auth/me')).json;
    assert.equal(me.needsSetup, false);
    assert.equal(me.user.method, 'password');
    const cfg = (await call('GET', '/api/admin/config')).json;
    const scr = cfg.screens[0];
    assert.equal(scr.name, 'Cocina');
    assert.equal(scr.screen.language, 'en');
    assert.equal(scr.screen.accent, '#2ec4b6');
    assert.equal(scr.layout.preset, 'agenda');
    assert.equal(scr.background.source, 'gallery');
    assert.equal(scr.background.ambient, 'particles');
    assert.equal(scr.datetime.format24, false);
    assert.equal(cfg.datetime.timezone, 'Europe/Lisbon');
    assert.equal(cfg.weather.locationName, 'Porto, Portugal');
    assert.equal(cfg.weather.lat, 41.1496);
    // the sample holiday feed was replaced by the chosen one
    assert.deepEqual(cfg.calendar.sources.map((s) => [s.name, s.kind]), [['Festivos de España', 'holidays']]);
    assert.ok(await verifyPassword(GOOD, store.getSecrets().passwordHash));
    assert.equal(store.getSecrets().passwordIsDefault, false);
    assert.ok(store.getSecrets().setupCompletedAt);
    const act = getActivity({ type: 'auth' }).items.map((e) => e.type);
    assert.ok(act.includes('auth.setup_completed'));

    // single use: every setup mutation is closed now (also for a fresh browser without a session)
    const other = { cookie: '' };
    assert.equal((await call('POST', '/api/setup/complete', body({ password: 'another-Pass-77', passwordConfirm: 'another-Pass-77' }), { jar: other })).status, 409);
    assert.equal((await call('POST', '/api/setup/test-ics', { url: 'https://example.com/a.ics' }, { jar: other })).status, 409);
    assert.ok(await verifyPassword(GOOD, store.getSecrets().passwordHash));
    const st = (await call('GET', '/api/setup/status', undefined, { jar: other })).json;
    assert.equal(st.needsSetup, false);
    assert.equal(st.tokenRequired, undefined);
    // the new password works for a normal login
    assert.equal((await call('POST', '/api/auth/login', { password: GOOD }, { jar: other })).status, 200);
  }, { secrets: null });
});

test('race: two concurrent completes → exactly one wins, its password is the one stored', async () => {
  await withApp(async ({ call }) => {
    const a = { cookie: '' };
    const b = { cookie: '' };
    const pwB = 'second-Winner-91';
    const [ra, rb] = await Promise.all([
      call('POST', '/api/setup/complete', body(), { jar: a }),
      call('POST', '/api/setup/complete', body({ password: pwB, passwordConfirm: pwB, screenName: 'Salón' }), { jar: b }),
    ]);
    const statuses = [ra.status, rb.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const winner = ra.status === 200 ? GOOD : pwB;
    const loser = ra.status === 200 ? pwB : GOOD;
    assert.ok(await verifyPassword(winner, store.getSecrets().passwordHash));
    assert.equal(await verifyPassword(loser, store.getSecrets().passwordHash), false);
    // only the winner got a session
    const meA = (await call('GET', '/api/auth/me', undefined, { jar: a })).json;
    const meB = (await call('GET', '/api/auth/me', undefined, { jar: b })).json;
    assert.equal(Boolean(meA.user) + Boolean(meB.user), 1);
    assert.equal(getActivity({ type: 'auth' }).items.filter((e) => e.type === 'auth.setup_completed').length, 1);
  }, { secrets: null });
});

test('SETUP_TOKEN: required even from the LAN; wrong tokens are throttled', async () => {
  await withApp(async ({ call }) => {
    const st = (await call('GET', '/api/setup/status')).json;
    assert.equal(st.tokenRequired, true);
    assert.equal(st.tokenValid, null);
    assert.equal((await call('GET', '/api/setup/status', undefined, { headers: { 'x-setup-token': 'nope' } })).json.tokenValid, false);
    assert.equal((await call('GET', '/api/setup/status', undefined, { headers: { 'x-setup-token': 's3cret-token-xyz' } })).json.tokenValid, true);
    let r = await call('POST', '/api/setup/complete', body());
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'token_required');
    r = await call('POST', '/api/setup/test-ics', { url: 'https://example.com/a.ics' });
    assert.equal(r.status, 403);
    r = await call('POST', '/api/setup/complete', body({ token: 'wrong' }));
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'invalid_token');
    assert.equal(store.getSecrets().passwordHash, undefined);
    // throttle: 10 failures per IP, then 429 even with the right token; other IPs unaffected
    for (let i = 0; i < 10; i++) await call('POST', '/api/setup/complete', body({ token: `bad${i}` }), { ip: '192.168.1.66' });
    assert.equal((await call('POST', '/api/setup/complete', body({ token: 's3cret-token-xyz' }), { ip: '192.168.1.66' })).status, 429);
    const act = getActivity({ type: 'auth' }).items;
    assert.ok(act.some((e) => e.type === 'auth.setup_rejected'));
    // right token (header) from another IP → done
    r = await call('POST', '/api/setup/complete', body(), { headers: { 'x-setup-token': 's3cret-token-xyz' }, ip: '192.168.1.21' });
    assert.equal(r.status, 200);
  }, { secrets: null, env: { SETUP_TOKEN: 's3cret-token-xyz' } });
});

test('no SETUP_TOKEN: remote (non-LAN) clients need the per-process token from the server log', async () => {
  await withApp(async ({ call }) => {
    const remote = { ip: '203.0.113.9' };
    assert.equal((await call('GET', '/api/setup/status', undefined, remote)).json.tokenRequired, true);
    assert.equal((await call('POST', '/api/setup/complete', body(), remote)).status, 403);
    const tok = setupToken();
    assert.ok(tok.length >= 20);
    assert.equal((await call('GET', '/api/setup/status', undefined, { ...remote, headers: { 'x-setup-token': tok } })).json.tokenValid, true);
    assert.equal((await call('POST', '/api/setup/complete', body({ token: tok }), remote)).status, 200);
  }, { secrets: null });
});

test('existing installs never enter setup (hash present, even a legacy weak default)', async () => {
  for (const secrets of [
    { passwordHash: await hashPassword('secret123'), passwordIsDefault: false },
    { passwordHash: await hashPassword('admin'), passwordIsDefault: true },
  ]) {
    await withApp(async ({ call }) => {
      const before = store.getSecrets().passwordHash;
      assert.equal((await call('GET', '/api/setup/status')).json.needsSetup, false);
      assert.equal((await call('POST', '/api/setup/complete', body())).status, 409);
      assert.equal(store.getSecrets().passwordHash, before);
      assert.equal((await call('GET', '/api/auth/me')).json.needsSetup, false);
    }, { secrets, env: { ADMIN_PASSWORD: 'ignored-because-hash-exists' } });
  }
});

test('ADMIN_PASSWORD bootstraps a headless install (no wizard) and the panel offers to change it', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call('GET', '/api/setup/status')).json.needsSetup, false);
    assert.equal(store.getSecrets().passwordFromEnv, true);
    assert.equal((await call('POST', '/api/auth/login', { password: 'from-the-env-Pass' })).status, 200);
    const me = (await call('GET', '/api/auth/me')).json;
    assert.equal(me.passwordFromEnv, true);
    assert.equal(me.mustChangePassword, false);
    // change it → flag cleared; the same password rules apply
    assert.equal((await call('PUT', '/api/admin/password', { current: 'from-the-env-Pass', next: 'qwertyuiop' })).status, 400);
    assert.equal((await call('PUT', '/api/admin/password', { current: 'from-the-env-Pass', next: GOOD })).status, 200);
    assert.equal(store.getSecrets().passwordFromEnv, undefined);
    assert.equal((await call('GET', '/api/auth/me')).json.passwordFromEnv, false);
  }, { secrets: null, env: { ADMIN_PASSWORD: 'from-the-env-Pass' } });
});

test('parseSetupBody / applySetup are pure and keep user sources', () => {
  const { errors, value } = parseSetupBody(body({ screenName: '  ', calendars: [{ name: '', url: 'webcal://example.com/x.ics' }] }));
  assert.deepEqual(errors, []);
  assert.equal(value.screenName, 'Living room');
  const cur = defaultConfig();
  cur.calendar.sources.push({ id: 'c_mine', type: 'ics', name: 'Mine', url: 'https://example.com/m.ics', color: '#112233', emoji: '', kind: 'generic', enabled: true, refreshMin: 5, insecureTls: false });
  const next = applySetup(cur, value);
  assert.deepEqual(next.calendar.sources.map((s) => s.name), ['Mine', 'Calendar']);
  assert.equal(cur.screens[0].name, 'Living room'); // input untouched
  assert.equal(parseSetupBody(null).errors.length, 1);
  assert.ok(parseSetupBody(body({ language: 'fr' })).errors.some((e) => e.path === 'language'));
  assert.ok(parseSetupBody(body({ location: { lat: 1, lon: 2, timezone: 'Mars/Olympus' } })).errors.some((e) => e.path === 'location.timezone'));
});
