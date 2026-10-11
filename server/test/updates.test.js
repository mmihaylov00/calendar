// Updates: version compare, the daily check with its ETag cache, the update window, how the install is detected,
// the request file read by marco-update.path, the admin routes, and the admin's banner logic (web/admin/updates.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { hashPassword, ensurePassword } from '../auth.js';
import { createApp } from '../app.js';
import {
  parseVersion, compareVersions, isNewer, inWindow, normalizeSettings, settingsErrors, releaseFrom, trimNotes,
  parseMarcoConf, detectInstall, createUpdater, DAY_MS, RETRY_MS, STALL_MS, DEFAULT_LATEST_URL,
} from '../updates.js';
import { selfHostedFeatures } from '../capabilities.js';
import { loadWebModules } from './webModules.js';

const tmp = (p = 'marco-upd-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

// ---------------------------------------------------------------- versions

test('versions: parse and compare follow Semantic Versioning', () => {
  assert.deepEqual(parseVersion('v1.2.3-rc.1+build.5'), { major: 1, minor: 2, patch: 3, pre: ['rc', '1'] });
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('latest'), null);
  const ordered = ['0.4.0', '0.5.0-alpha', '0.5.0-alpha.1', '0.5.0-alpha.beta', '0.5.0-beta.2', '0.5.0-beta.11', '0.5.0-rc.1', '0.5.0', '0.5.1', '0.10.0', '1.0.0'];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      assert.equal(compareVersions(ordered[i], ordered[j]), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
    }
  }
  assert.equal(compareVersions('v0.5.0', '0.5.0'), 0);
  assert.equal(compareVersions('0.5.0+abc', '0.5.0'), 0, 'build metadata does not count');
  assert.equal(isNewer('0.5.1', '0.5.0'), true);
  assert.equal(isNewer('0.5.0', '0.5.0'), false);
  assert.equal(isNewer('0.4.9', '0.5.0'), false);
  assert.equal(isNewer('nonsense', '0.5.0'), false);
  assert.equal(isNewer('0.5.0', 'unknown'), true, 'any version is newer than an unknown one');
});

test('versions: the admin compares the same way as the server', async () => {
  const [u] = await loadWebModules('/web/admin/updates.ts');
  const list = ['0.4.0', '0.5.0-beta.2', '0.5.0-beta.11', '0.5.0', '0.5.1', '0.10.0', 'x'];
  for (const a of list) for (const b of list) assert.equal(u.compareVersions(a, b), compareVersions(a, b), `${a} vs ${b}`);
});

// ---------------------------------------------------------------- settings and window

test('settings: defaults, normalisation and validation', () => {
  assert.deepEqual(normalizeSettings(null), { check: true, auto: false, from: '03:00', to: '05:00' });
  assert.deepEqual(normalizeSettings({ check: false, auto: 'yes', from: '25:00', to: '06:30' }), { check: false, auto: false, from: '03:00', to: '06:30' });
  assert.deepEqual(settingsErrors({ auto: true, from: '01:00', to: '02:00' }), []);
  assert.ok(settingsErrors({ auto: 1 }).length);
  assert.ok(settingsErrors({ from: '1:00' }).length);
  assert.ok(settingsErrors({ from: '02:00', to: '02:00' }).length);
  assert.ok(settingsErrors([]).length);
});

test('window: inside, outside, across midnight and in the configured time zone', () => {
  const at = (iso) => new Date(iso);
  assert.equal(inWindow(at('2026-10-10T03:30:00Z'), 'UTC', '03:00', '05:00'), true);
  assert.equal(inWindow(at('2026-10-10T05:00:00Z'), 'UTC', '03:00', '05:00'), false, 'the end is not included');
  assert.equal(inWindow(at('2026-10-10T02:59:00Z'), 'UTC', '03:00', '05:00'), false);
  assert.equal(inWindow(at('2026-10-10T23:30:00Z'), 'UTC', '23:00', '02:00'), true);
  assert.equal(inWindow(at('2026-10-10T01:30:00Z'), 'UTC', '23:00', '02:00'), true);
  assert.equal(inWindow(at('2026-10-10T12:00:00Z'), 'UTC', '23:00', '02:00'), false);
  // 01:30 UTC is 03:30 in Madrid (summer time)
  assert.equal(inWindow(at('2026-07-10T01:30:00Z'), 'Europe/Madrid', '03:00', '05:00'), true);
  assert.equal(inWindow(at('2026-07-10T03:30:00Z'), 'Europe/Madrid', '03:00', '05:00'), false);
  assert.equal(inWindow(at('2026-07-10T03:30:00Z'), 'Not/AZone', '03:00', '05:00'), true, 'a bad zone falls back to UTC');
});

// ---------------------------------------------------------------- release answer

test('release: fields kept from GitHub, drafts and pre-releases ignored, install text cut', () => {
  const body = '### Added\n- **Thing** one\n\n### Install or update\n\n```sh\ncurl ...\n```\n';
  const r = releaseFrom({ tag_name: 'v0.5.1', name: 'Marco 0.5.1', body, html_url: 'https://github.com/mr-reb00t/marco/releases/tag/v0.5.1', published_at: '2026-10-11T10:00:00Z' });
  assert.equal(r.version, '0.5.1');
  assert.equal(r.notes, '### Added\n- **Thing** one');
  assert.equal(r.url, 'https://github.com/mr-reb00t/marco/releases/tag/v0.5.1');
  assert.equal(releaseFrom({ tag_name: 'v0.6.0', prerelease: true }), null);
  assert.equal(releaseFrom({ tag_name: 'v0.6.0', draft: true }), null);
  assert.equal(releaseFrom({ tag_name: 'media' }), null);
  assert.equal(releaseFrom({ tag_name: 'v1.0.0', html_url: 'javascript:alert(1)' }).url, null);
  assert.ok(trimNotes('x'.repeat(30_000)).length <= 20_002);
});

// ---------------------------------------------------------------- install detection

/** A fake file system: `files` maps paths to contents (null = exists, no content), `links` maps paths to targets. */
function fakeFs(files, links = {}) {
  const resolve = (p) => {
    for (const [from, to] of Object.entries(links)) if (p === from || p.startsWith(from + '/')) return to + p.slice(from.length);
    return p;
  };
  return {
    existsSync: (p) => resolve(p) in files || Object.keys(files).some((f) => f.startsWith(resolve(p) + '/')),
    readFileSync: (p) => {
      const v = files[resolve(p)];
      if (v == null) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    },
    realpathSync: (p) => resolve(p),
  };
}

test('install: release, checkout, docker and manual installs are told apart', () => {
  const conf = '# Written by the Marco installer\nMARCO_MODE=server\nMARCO_LAYOUT=release\nMARCO_DIR=/opt/marco\nMARCO_USER=marco\n';
  const release = {
    '/etc/marco.conf': conf,
    '/opt/marco/releases/0.5.0/package.json': '{}',
    '/opt/marco/data/config.json': '{}',
    '/etc/systemd/system/marco-update.path': '',
  };
  const links = { '/opt/marco/current': '/opt/marco/releases/0.5.0' };
  const env = {};
  assert.deepEqual(detectInstall({ root: '/opt/marco/current', dataDir: '/opt/marco/data', env, fsx: fakeFs(release, links) }), { kind: 'release', canApply: true, cli: true });
  const noUnit = { ...release };
  delete noUnit['/etc/systemd/system/marco-update.path'];
  assert.deepEqual(detectInstall({ root: '/opt/marco/current', dataDir: '/opt/marco/data', env, fsx: fakeFs(noUnit, links) }), { kind: 'release', canApply: false, cli: true });
  // DATA_DIR elsewhere: the root service would not see the request
  assert.equal(detectInstall({ root: '/opt/marco/current', dataDir: '/srv/other', env, fsx: fakeFs(release, links) }).canApply, false);
  // quoted folder names (printf %q)
  const quoted = { ...release, '/etc/marco.conf': conf.replace('MARCO_DIR=/opt/marco', 'MARCO_DIR=/opt/my\\ marco'), '/opt/my marco/releases/0.5.0/package.json': '{}' };
  assert.equal(detectInstall({ root: '/opt/my marco/releases/0.5.0', dataDir: '/opt/my marco/data', env, fsx: fakeFs(quoted) }).kind, 'release');
  assert.equal(parseMarcoConf('MARCO_DIR=/home/pi/my\\ marco\nOTHER=1').MARCO_DIR, '/home/pi/my marco');

  const checkout = { '/etc/marco.conf': conf.replace('release', 'checkout').replace('/opt/marco', '/home/pi/marco'), '/home/pi/marco/.git/HEAD': '' };
  assert.deepEqual(detectInstall({ root: '/home/pi/marco', dataDir: '/home/pi/marco/data', env, fsx: fakeFs(checkout) }), { kind: 'checkout', canApply: false, cli: true });
  assert.deepEqual(detectInstall({ root: '/src/marco', dataDir: '/src/marco/data', env, fsx: fakeFs({ '/src/marco/.git/HEAD': '' }) }), { kind: 'checkout', canApply: false, cli: false });
  assert.deepEqual(detectInstall({ root: '/app', dataDir: '/data', env: { MARCO_INSTALL: 'docker' }, fsx: fakeFs(release) }), { kind: 'docker', canApply: false, cli: false });
  assert.equal(detectInstall({ root: '/app', dataDir: '/data', env, fsx: fakeFs({ '/.dockerenv': '' }) }).kind, 'docker');
  // install.sh inside a container with systemd: the installer's record wins
  assert.equal(detectInstall({ root: '/opt/marco/current', dataDir: '/opt/marco/data', env, fsx: fakeFs({ ...release, '/.dockerenv': '' }, links) }).kind, 'release');
  assert.deepEqual(detectInstall({ root: '/srv/marco-0.5.0', dataDir: '/srv/data', env, fsx: fakeFs({}) }), { kind: 'manual', canApply: false, cli: false });
  // a kiosk-only conf never makes the server a release install
  assert.equal(detectInstall({ root: '/opt/marco/current', dataDir: '/opt/marco/data', env, fsx: fakeFs({ ...release, '/etc/marco.conf': conf.replace('server', 'kiosk') }, links) }).kind, 'manual');
});

// ---------------------------------------------------------------- the checker

/** A fake GitHub: answers `release` with an ETag, 304 when If-None-Match matches. Records every call. */
function fakeGithub(release, { status = 200 } = {}) {
  const calls = [];
  const gh = {
    release,
    status,
    calls,
    fetch: async (url, opts) => {
      calls.push({ url, headers: { ...(opts?.headers || {}) } });
      if (gh.status === 'throw') throw new Error('offline');
      if (gh.status !== 200) return new Response('{}', { status: gh.status });
      const etag = `"${gh.release.tag_name}"`;
      if (opts?.headers?.['If-None-Match'] === etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(gh.release), { status: 200, headers: { etag, 'content-type': 'application/json' } });
    },
  };
  return gh;
}

const rel = (v, extra = {}) => ({ tag_name: `v${v}`, name: `Marco ${v}`, body: `### Fixed\n- Something in ${v}`, html_url: `https://github.com/mr-reb00t/marco/releases/tag/v${v}`, published_at: '2026-10-11T10:00:00Z', ...extra });

function makeUpdater({ gh, env = {}, clock = { t: Date.parse('2026-10-10T12:00:00Z') }, install = { kind: 'release', canApply: true, cli: true }, version = '0.5.0', tz = 'UTC', dataDir = tmp() } = {}) {
  const logs = [];
  const u = createUpdater({ version, dataDir, env, fetchImpl: gh.fetch, now: () => clock.t, timezone: () => tz, install, log: (type, data) => logs.push({ type, data }) });
  return { u, clock, logs, dataDir };
}

test('checker: one GET to the public API, ETag reuse, daily schedule, retry after an error', async () => {
  const gh = fakeGithub(rel('0.5.1'));
  const { u, clock } = makeUpdater({ gh });
  assert.equal(u.due(), true, 'never checked');
  let info = await u.check();
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].url, DEFAULT_LATEST_URL);
  assert.equal(gh.calls[0].headers['User-Agent'], 'Calendar', 'no version or id in the request');
  assert.equal(gh.calls[0].headers['If-None-Match'], undefined);
  assert.equal(info.available, true);
  assert.equal(info.latest.version, '0.5.1');
  assert.equal(info.latest.notes, '### Fixed\n- Something in 0.5.1');
  assert.equal(info.error, null);
  assert.equal(u.due(), false, 'checked just now');
  clock.t += DAY_MS - 1000;
  assert.equal(u.due(), false);
  clock.t += 1000;
  assert.equal(u.due(), true, 'a day later');
  info = await u.check();
  assert.equal(gh.calls[1].headers['If-None-Match'], '"v0.5.1"', 'the stored ETag is sent');
  assert.equal(info.latest.version, '0.5.1', '304 keeps the stored release');
  // a new release replaces it
  gh.release = rel('0.5.2');
  info = await u.check();
  assert.equal(info.latest.version, '0.5.2');
  // errors are stored, the last good answer is kept and the next try comes sooner than a day
  gh.status = 'throw';
  info = await u.check();
  assert.equal(info.error, 'network');
  assert.equal(info.latest.version, '0.5.2');
  clock.t += RETRY_MS;
  assert.equal(u.due(), true);
  gh.status = 403;
  assert.equal((await u.check()).error, 'rate_limited');
  gh.status = 404;
  info = await u.check();
  assert.equal(info.latest, null, 'no release published');
  assert.equal(info.available, false);
});

test('checker: off with MARCO_UPDATE_CHECK=0 or the admin switch, MARCO_UPDATE_URL for tests', async () => {
  const gh = fakeGithub(rel('0.5.1'));
  const off = makeUpdater({ gh, env: { MARCO_UPDATE_CHECK: '0' } }).u;
  assert.equal(off.due(), false);
  const info = await off.check();
  assert.equal(gh.calls.length, 0, 'no request at all');
  assert.equal(info.checks, 'env-off');
  const { u } = makeUpdater({ gh, env: { MARCO_UPDATE_URL: 'http://127.0.0.1:9/latest.json' } });
  u.saveSettings({ check: false });
  assert.equal(u.due(), false);
  assert.equal(u.info().checks, 'off');
  u.saveSettings({ check: true });
  await u.check();
  assert.equal(gh.calls[0].url, 'http://127.0.0.1:9/latest.json');
});

test('checker: the cache survives a restart (check.json)', async () => {
  const gh = fakeGithub(rel('0.5.1'));
  const a = makeUpdater({ gh });
  await a.u.check();
  const b = makeUpdater({ gh, dataDir: a.dataDir, clock: { t: a.clock.t + 3600_000 } });
  assert.equal(b.u.due(), false, 'the restarted server does not ask again');
  assert.equal(b.u.info().latest.version, '0.5.1');
  // the new server is the version that was available: nothing to show any more
  const c = makeUpdater({ gh, dataDir: a.dataDir, version: '0.5.1' });
  assert.equal(c.u.info().available, false);
});

// ---------------------------------------------------------------- the request file

test('request: written for the root service, refused when it cannot work, busy and stalled states', async () => {
  const gh = fakeGithub(rel('0.5.1'));
  const docker = makeUpdater({ gh, install: { kind: 'docker', canApply: false, cli: false } });
  await docker.u.check();
  assert.deepEqual(docker.u.request(), { ok: false, error: 'not_supported' });
  assert.equal(fs.existsSync(path.join(docker.dataDir, 'update', 'request')), false);

  const { u, clock, dataDir, logs } = makeUpdater({ gh });
  assert.equal(u.request().error, 'up_to_date', 'nothing known yet');
  await u.check();
  const r = u.request();
  assert.equal(r.ok, true);
  const reqFile = path.join(dataDir, 'update', 'request');
  assert.ok(fs.existsSync(reqFile));
  assert.equal(JSON.parse(fs.readFileSync(reqFile, 'utf8')).target, '0.5.1');
  let info = u.info();
  assert.equal(info.status.state, 'requested');
  assert.equal(info.status.target, '0.5.1');
  assert.equal(info.status.stalled, false);
  assert.equal(u.request().error, 'busy');
  assert.equal(logs.length, 0, 'admin requests are logged by the route (with the session)');
  // nobody picked it up
  clock.t += STALL_MS + 1000;
  info = u.info();
  assert.equal(info.status.stalled, true);
  assert.equal(u.request().ok, true, 'a stalled request can be sent again');

  // what `marco update --requested` does: removes the request, reports running, then the result and the log
  fs.rmSync(reqFile);
  const status = (o) => fs.writeFileSync(path.join(dataDir, 'update', 'status.json'), JSON.stringify(o));
  status({ state: 'running', from: '0.5.0', to: '', by: 'admin', rolledBack: false, target: '0.5.1', at: new Date(clock.t).toISOString() });
  fs.writeFileSync(path.join(dataDir, 'update', 'update.log'), '\x1b[1;36m==>\x1b[0m Downloading\n ok Checksum verified\n');
  info = u.info();
  assert.equal(info.status.state, 'running');
  assert.deepEqual(info.log, ['==> Downloading', ' ok Checksum verified']);
  assert.equal(u.request().error, 'busy');
  status({ state: 'done', from: '0.5.0', to: '0.5.1', by: 'admin', rolledBack: false, target: '0.5.1', at: new Date(clock.t).toISOString() });
  // the new server (0.5.1) records the outcome once
  const next = makeUpdater({ gh, dataDir, version: '0.5.1', clock });
  next.u.recordFinished();
  next.u.recordFinished();
  assert.deepEqual(next.logs.map((l) => l.type), ['update.finished']);
  assert.equal(next.logs[0].data.to, '0.5.1');
  assert.equal(next.u.info().available, false);
  // odd values in status.json are dropped
  status({ state: 'done', from: '0.5.0"<b>', to: '0.5.1', at: 'x' });
  assert.equal(u.info().status.from, '');
  assert.equal(u.info().status.at, null);
  status({ state: 'weird' });
  assert.equal(u.info().status, null);
});

test('auto update: off by default, only inside the window, never retries a failed version', async () => {
  const gh = fakeGithub(rel('0.5.1'));
  const clock = { t: Date.parse('2026-10-10T03:30:00Z') };
  const { u, dataDir, logs } = makeUpdater({ gh, clock });
  await u.tick();
  assert.equal(gh.calls.length, 1, 'the tick checks when due');
  assert.equal(u.autoDue(), false, 'automatic updates are off by default');
  assert.equal(fs.existsSync(path.join(dataDir, 'update', 'request')), false);
  u.saveSettings({ auto: true, from: '03:00', to: '05:00' });
  clock.t = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(u.autoDue(), false, 'outside the window');
  clock.t = Date.parse('2026-10-10T04:10:00Z');
  await u.tick();
  assert.equal(gh.calls.length, 1, 'no second request to GitHub the same day');
  assert.ok(fs.existsSync(path.join(dataDir, 'update', 'request')));
  assert.equal(u.info().status.by, 'auto');
  assert.deepEqual(logs.map((l) => l.type), ['update.requested']);
  // the update failed and was rolled back: not tried again for that version
  fs.rmSync(path.join(dataDir, 'update', 'request'));
  fs.writeFileSync(path.join(dataDir, 'update', 'status.json'), JSON.stringify({ state: 'failed', from: '0.5.0', to: '0.5.0', by: 'auto', rolledBack: true, target: '0.5.1', at: new Date(clock.t).toISOString() }));
  assert.equal(u.autoDue(), false);
  // a newer release is tried
  gh.release = rel('0.5.2');
  await u.check();
  assert.equal(u.autoDue(), true);
  // never when updates from the admin are not possible here, or the checks are off
  const docker = makeUpdater({ gh, clock, install: { kind: 'docker', canApply: false, cli: false } });
  docker.u.saveSettings({ auto: true });
  await docker.u.check();
  assert.equal(docker.u.autoDue(), false);
  u.saveSettings({ check: false });
  assert.equal(u.autoDue(), false);
});

// ---------------------------------------------------------------- routes

test('routes: admin only, settings, check, apply', async () => {
  const dir = tmp('marco-upd-app-');
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false }));
  store.initStore(dir);
  await ensurePassword();
  const gh = fakeGithub(rel('0.5.1'));
  const updater = createUpdater({ version: '0.5.0', dataDir: dir, fetchImpl: gh.fetch, install: { kind: 'release', canApply: true, cli: true } });
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'no-dist'), updater });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, cookie = '' } = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, setCookie: r.headers.getSetCookie?.() || [] };
  };
  try {
    assert.equal((await call('GET', '/api/admin/update')).status, 401);
    assert.equal((await call('POST', '/api/admin/update/apply', { body: {} })).status, 401);
    const login = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    const cookie = login.setCookie.map((x) => x.split(';')[0]).join('; ');
    let r = await call('GET', '/api/admin/update', { cookie });
    assert.equal(r.status, 200);
    assert.equal(r.json.current, '0.5.0');
    assert.equal(r.json.latest, null);
    assert.equal((await call('POST', '/api/admin/update/apply', { cookie, body: {} })).json.error, 'up_to_date');
    r = await call('POST', '/api/admin/update/check', { cookie, body: {} });
    assert.equal(r.json.available, true);
    assert.equal(gh.calls.length, 1);
    r = await call('POST', '/api/admin/update/check', { cookie, body: {} });
    assert.equal(gh.calls.length, 1, 'a second click right after the first does not ask GitHub again');
    assert.equal((await call('PUT', '/api/admin/update/settings', { cookie, body: { auto: 'yes' } })).status, 400);
    r = await call('PUT', '/api/admin/update/settings', { cookie, body: { auto: true, from: '02:00', to: '04:00', extra: 1 } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.settings, { check: true, auto: true, from: '02:00', to: '04:00' });
    r = await call('POST', '/api/admin/update/apply', { cookie, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.status.state, 'requested');
    assert.ok(fs.existsSync(path.join(dir, 'update', 'request')));
    assert.equal((await call('POST', '/api/admin/update/apply', { cookie, body: {} })).json.error, 'busy');
  } finally {
    server.close();
  }
});

test('capabilities: self-hosted servers announce updates', () => {
  assert.equal(selfHostedFeatures().updates, true);
});

// ---------------------------------------------------------------- the admin's banner

test('admin banner: available, dismissed, updating, updated, failed; never on Marco Cloud', async () => {
  const [u, capsMod] = await loadWebModules('/web/admin/updates.ts', '/web/admin/caps.ts');
  const { capsFrom } = capsMod;
  const sh = capsFrom({ ok: true, version: '0.5.0', edition: 'self-hosted', runtime: 'node', features: { updates: true } });
  const old = capsFrom({ ok: true, version: '0.4.0' });
  const cloud = capsFrom({ ok: true, version: '0.5.0', edition: 'cloud', runtime: 'workers', features: { updates: true } });
  const info = (o = {}) => ({
    current: '0.5.0',
    latest: { version: '0.5.1', name: '', notes: '- x', url: null, publishedAt: null },
    available: true,
    checkedAt: '2026-10-10T00:00:00Z',
    error: null,
    checks: 'on',
    install: { kind: 'release', canApply: true, cli: true },
    settings: { check: true, auto: false, from: '03:00', to: '05:00' },
    status: null,
    log: [],
    ...o,
  });
  assert.deepEqual(u.bannerFor(info(), sh, '0.5.0', null), { kind: 'available', version: '0.5.1' });
  assert.equal(u.bannerFor(info(), sh, '0.5.0', '0.5.1'), null, 'closed for this version');
  assert.deepEqual(u.bannerFor(info(), sh, '0.5.0', '0.5.0'), { kind: 'available', version: '0.5.1' }, 'a newer version shows again');
  assert.equal(u.bannerFor(info({ available: false }), sh, '0.5.0', null), null);
  assert.equal(u.bannerFor(info({ checks: 'off' }), sh, '0.5.0', null), null);
  assert.equal(u.bannerFor(info(), cloud, '0.5.0', null), null, 'Marco Cloud never shows it');
  assert.equal(u.bannerFor(info(), old, '0.4.0', null), null, 'a server without the feature');
  assert.equal(u.bannerFor(null, sh, '0.5.0', null), null);
  const st = (o) => ({ state: 'running', from: '0.5.0', to: '', target: '0.5.1', by: 'admin', at: '2026-10-10T00:00:00Z', rolledBack: false, stalled: false, ...o });
  assert.deepEqual(u.bannerFor(info({ status: st({}) }), sh, '0.5.0', '0.5.1'), { kind: 'updating', version: '0.5.1' });
  assert.deepEqual(u.bannerFor(info({ status: st({ state: 'requested', stalled: true }) }), sh, '0.5.0', null), { kind: 'available', version: '0.5.1' });
  // the server answers with a newer version than the page: reload
  assert.deepEqual(u.bannerFor(info({ current: '0.5.1', available: false, status: st({ state: 'done', to: '0.5.1' }) }), sh, '0.5.0', null), { kind: 'updated', version: '0.5.1' });
  assert.equal(u.bannerFor(info({ current: '0.5.1', available: false, status: st({ state: 'done', to: '0.5.1' }) }), sh, '0.5.1', null), null, 'after the reload');
  const failed = info({ status: st({ state: 'failed', to: '0.5.0', rolledBack: true }) });
  assert.deepEqual(u.bannerFor(failed, sh, '0.5.0', null), { kind: 'failed', version: '0.5.1' });
  assert.deepEqual(u.bannerFor(failed, sh, '0.5.0', 'failed:0.5.1'), { kind: 'available', version: '0.5.1' }, 'closing the failure leaves the offer');

  assert.equal(u.phaseOf(null, false), 'idle');
  assert.equal(u.phaseOf(info({ status: st({}) }), true), 'restarting');
  assert.equal(u.phaseOf(info({ status: st({ state: 'requested', stalled: true }) }), false), 'stalled');
  assert.equal(u.phaseOf(info({ status: st({ state: 'failed' }) }), false), 'failed');

  assert.deepEqual(u.howToUpdate({ kind: 'docker', canApply: false, cli: false }).commands, ['git pull', 'docker compose up -d --build']);
  assert.deepEqual(u.howToUpdate({ kind: 'release', canApply: false, cli: true }).commands, ['marco update']);
  assert.deepEqual(u.howToUpdate({ kind: 'checkout', canApply: false, cli: false }).commands, ['git pull', 'npm ci', 'npm run build']);

  const blocks = u.noteBlocks('### Added\n- **Bold** item with `code` and [a link](https://x)\n  continued\n- second\n\nA paragraph.\n```sh\ncurl x\n```');
  assert.deepEqual(blocks, [
    { type: 'h', text: 'Added' },
    { type: 'li', text: 'Bold item with code and a link continued' },
    { type: 'li', text: 'second' },
    { type: 'p', text: 'A paragraph. curl x' },
  ]);

  // Marco Cloud: "What's new" after a newer version, not on a first visit, never self-hosted
  assert.equal(u.shouldShowWhatsNew(cloud, '0.5.1', '0.5.0', '- x'), true);
  assert.equal(u.shouldShowWhatsNew(cloud, '0.5.1', null, '- x'), false);
  assert.equal(u.shouldShowWhatsNew(cloud, '0.5.1', '0.5.1', '- x'), false);
  assert.equal(u.shouldShowWhatsNew(cloud, '0.5.1', '0.5.0', '  '), false);
  assert.equal(u.shouldShowWhatsNew(sh, '0.5.1', '0.5.0', '- x'), false);
});
