// Network trust, DNS rebinding, credentials, weak password restrictions and guarded requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler, meHandler } from '../auth.js';
import { hostGuard, hostAllowed, hostnameOf, isLanClient, ipBucket, blockedFetchHost, blockedFetchAddress, _setContainerGateway } from '../lib/net.js';
import { request } from '../lib/http.js';
import { closeAll } from '../sse.js';
import { mediaAuth, syncDisplayKeys, displayKeyFor, resolveDisplayAccess, requestScreen } from '../displayAccess.js';

const GOOD = 'tidy-otter-lamp-42';
const body = () => ({ password: GOOD });

function setEnv(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

/** Raw HTTP (fetch cannot set Host). */
function raw(port, { method = 'GET', path: p = '/', headers = {}, body: b } = {}) {
  return new Promise((resolve, reject) => {
    const data = b === undefined ? undefined : JSON.stringify(b);
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: {
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* text */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function withApp(fn, { secrets = null, config = null, env = {}, trustProxy = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-net-'));
  const c = config || defaultConfig();
  c.security.displayAccess = 'open';
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  if (secrets) fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(secrets));
  const restore = setEnv({ SETUP_TOKEN: undefined, SETUP_REQUIRE_TOKEN: undefined, ADMIN_PASSWORD: undefined, PUBLIC_URL: undefined, ALLOWED_HOSTS: undefined, ...env });
  store.initStore(dir);
  await ensurePassword();
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'photos', 'family.jpg'), 'jpeg');

  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(hostGuard());
  app.use(sessionMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(['/api/admin', '/api/auth'], csrfGuard());
  app.get('/api/auth/me', meHandler);
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/media', mediaAuth);
  app.use('/media/photos', express.static(path.join(dir, 'photos'), { fallthrough: false }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  try {
    await fn({ port, dir, call: (o) => raw(port, o) });
  } finally {
    closeAll();
    await new Promise((r) => server.close(r));
    restore();
      fs.rmSync(dir, { recursive: true, force: true });
  }
}

const lan = { 'x-forwarded-for': '192.168.1.20' };

test('host allowlist: LAN names, IP literals, PUBLIC_URL and ALLOWED_HOSTS only', () => {
  const restore = setEnv({ PUBLIC_URL: 'https://calendar.example.com', ALLOWED_HOSTS: 'other.example.net, *.home.example.org' });
  try {
    for (const h of ['localhost', '127.0.0.1', '192.168.1.50', '::1', 'raspberrypi', 'nas.local', 'pi.lan', 'x.home.arpa', 'calendar.example.com',
      'other.example.net', 'a.home.example.org', '']) assert.equal(hostAllowed(h), true, h);
    for (const h of ['attacker.example', 'example.com', 'calendar.example.com.evil.io', 'home.example.org.evil.io']) assert.equal(hostAllowed(h), false, h);
    assert.equal(hostnameOf('Attacker.Example:3000'), 'attacker.example');
    assert.equal(hostnameOf('[::1]:3000'), '::1');
  } finally {
    restore();
  }
});

test('DNS rebinding and cross-origin login are refused; allowed LAN host works', async () => {
  await withApp(async ({ call }) => {
    const evil = { host: 'attacker.example:18471', origin: 'http://attacker.example:18471', ...lan };
    let r = await call({ method: 'POST', path: '/api/auth/login', headers: evil, body: body() });
    assert.equal(r.status, 421);
    r = await call({ path: '/api/auth/me', headers: { host: 'attacker.example', ...lan } });
    assert.equal(r.status, 421);
    // Origin from an unknown host is refused even when the Host header is fine
    r = await call({ method: 'POST', path: '/api/auth/login', headers: { host: '192.168.1.50:3000', origin: 'http://attacker.example', ...lan }, body: body() });
    assert.equal(r.status, 403);
    r = await call({ method: 'POST', path: '/api/auth/login', headers: { host: '192.168.1.50:3000', origin: 'http://192.168.1.50:3000', ...lan }, body: body() });
    assert.equal(r.status, 200);
  }, { env: { ADMIN_PASSWORD: GOOD } });
});

test('PUBLIC_URL / ALLOWED_HOSTS host names are accepted', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call({ path: '/api/auth/me', headers: { host: 'calendar.example.com', ...lan } })).status, 200);
    assert.equal((await call({ path: '/api/auth/me', headers: { host: 'cal.example.net', ...lan } })).status, 200);
    assert.equal((await call({ path: '/api/auth/me', headers: { host: 'example.org', ...lan } })).status, 421);
  }, { env: { PUBLIC_URL: 'https://calendar.example.com', ALLOWED_HOSTS: '.example.net' } });
});

test('LAN detection: untrusted proxy headers and the container gateway are not LAN', () => {
  const trusting = (ok) => ({ get: (k) => (k === 'trust proxy fn' ? () => ok : undefined) });
  const req = (ip, headers = {}, trusted = false) => ({ ip, headers, socket: { remoteAddress: ip }, app: trusting(trusted) });
  assert.equal(isLanClient(req('192.168.1.20')), true);
  assert.equal(isLanClient(req('203.0.113.9')), false);
  // a proxy on the Docker bridge without TRUST_PROXY: X-Forwarded-For is ignored by Express, req.ip is the gateway
  assert.equal(isLanClient(req('172.17.0.1', { 'x-forwarded-for': '8.8.8.8' })), false);
  assert.equal(isLanClient(req('172.17.0.1', { 'x-forwarded-proto': 'https' })), false);
  _setContainerGateway('172.17.0.1');
  try {
    assert.equal(isLanClient(req('172.17.0.1')), true); // displays on the Docker host still get photos
    assert.equal(isLanClient(req('172.17.0.1'), { strict: true }), false); // …but no tokenless setup / weak password
    assert.equal(isLanClient(req('192.168.1.20'), { strict: true }), true);
  } finally {
    _setContainerGateway(undefined);
  }
  assert.equal(ipBucket('2001:db8:1:2:aaaa::1'), ipBucket('2001:db8:1:2:bbbb::9'));
  assert.notEqual(ipBucket('2001:db8:1:2::1'), ipBucket('2001:db8:1:3::1'));
  assert.equal(ipBucket('::ffff:203.0.113.9'), '203.0.113.9');
});

test('corrupt secrets.json: the server refuses to start instead of reopening setup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-net-'));
  try {
    fs.writeFileSync(path.join(dir, 'secrets.json'), '{"passwordHash": "scrypt$abc', 'utf8');
    assert.throws(() => store.initStore(dir), store.StoreError);
    assert.equal(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'), '{"passwordHash": "scrypt$abc');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ADMIN_PASSWORD that breaks the password rules is LAN-only', async () => {
  await withApp(async ({ call }) => {
    assert.equal(store.getSecrets().passwordIsDefault, true);
    assert.equal((await call({ method: 'POST', path: '/api/auth/login', headers: { 'x-forwarded-for': '203.0.113.9' }, body: { password: 'password123' } })).status, 403);
    assert.equal((await call({ method: 'POST', path: '/api/auth/login', headers: lan, body: { password: 'password123' } })).status, 200);
  }, { env: { ADMIN_PASSWORD: 'password123' } });
  await withApp(async () => {
    assert.equal(store.getSecrets().passwordIsDefault, false);
  }, { env: { ADMIN_PASSWORD: GOOD } });
});

test('photos: LAN clients or a session only', async () => {
  await withApp(async ({ call }) => {
    assert.equal((await call({ path: '/media/photos/family.jpg', headers: lan })).status, 200);
    assert.equal((await call({ path: '/media/photos/family.jpg', headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 404);
    const login = await call({ method: 'POST', path: '/api/auth/login', headers: lan, body: { password: GOOD } });
    const cookie = login.headers['set-cookie'].map((x) => x.split(';')[0]).join('; ');
    assert.equal((await call({ path: '/media/photos/family.jpg', headers: { 'x-forwarded-for': '203.0.113.9', cookie } })).status, 200);
  }, { env: { ADMIN_PASSWORD: GOOD } });
});

test('standalone private data still rejects unknown credentials and binds existing keys and device tokens', () => {
  const restore = setEnv({ MARCO_HOME_ASSISTANT: undefined });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-private-'));
  try {
    store.initStore(dir);
    store.updateConfig(cfg => cfg.screens.push(defaultScreenProfile({ id: 's_other', slug: 'other', name: 'Other' })));
    syncDisplayKeys();
    const req = (key = '') => ({ headers: { 'x-marco-key': key }, query: { screen: 'living-room' } });
    assert.equal(resolveDisplayAccess(req()).status, 401);
    assert.equal(resolveDisplayAccess(req('unknown')).status, 403);
    const keyed = req(displayKeyFor('s_other'));
    keyed.displayAccess = resolveDisplayAccess(keyed);
    assert.equal(keyed.displayAccess.via, 'key');
    assert.equal(requestScreen(store.getConfig(), keyed).screen.id, 's_other');
    const token = `md_${'A'.repeat(43)}`;
    store.updateSecrets(secrets => { secrets.devices = [{ id: 'legacy_device', screenId: 's_other', hash: crypto.createHash('sha256').update(token).digest('hex') }]; });
    const paired = req(token);
    paired.displayAccess = resolveDisplayAccess(paired);
    assert.equal(paired.displayAccess.via, 'device');
    assert.equal(requestScreen(store.getConfig(), paired).screen.id, 's_other');
    assert.equal(resolveDisplayAccess(req(`md_${'B'.repeat(43)}`)).status, 403);
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SSRF guard blocks forbidden destinations including redirects', async () => {
  for (const h of ['localhost', '127.0.0.1', '169.254.169.254', '[::1]', '0.0.0.0', 'metadata.google.internal', '[::ffff:7f00:1]']) assert.equal(blockedFetchHost(h), true, h);
  for (const h of ['192.168.1.50', 'example.com', '10.0.0.2']) assert.equal(blockedFetchHost(h), false, h);
  assert.equal(blockedFetchAddress('fe80::1'), true);
  await assert.rejects(request('http://127.0.0.1:9/x.ics', { guard: true }), (e) => e.blocked === true);
  await assert.rejects(request('http://localhost:9/x.ics', { guard: true }), (e) => e.blocked === true);

  // A LAN address (allowed) that redirects to loopback (blocked).
  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  const target = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/secret` }); return res.end(); }
    res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });
  await new Promise((r) => target.listen(0, '0.0.0.0', r));
  try {
    if (lanIp) {
      await assert.rejects(request(`http://${lanIp}:${target.address().port}/redir`, { guard: true }), (e) => e.blocked === true);
      assert.equal((await request(`http://${lanIp}:${target.address().port}/ok`, { guard: true })).status, 200);
    }
  } finally {
    await new Promise((r) => target.close(r));
  }
});
