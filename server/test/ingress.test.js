import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { ingressMiddleware } from '../ingress.js';
import { initStore, getConfig } from '../store.js';
import { closeAll } from '../sse.js';

const HEADERS = { 'x-ingress-path': '/api/hassio_ingress/test_token', 'x-remote-user-id': 'admin_id', 'x-remote-user-display-name': 'HA Admin' };

function haEnvironment() {
  const keys = ['MARCO_HOME_ASSISTANT', 'SUPERVISOR_TOKEN'];
  const saved = keys.map(key => process.env[key]);
  process.env.MARCO_HOME_ASSISTANT = '1';
  process.env.SUPERVISOR_TOKEN = 'private-supervisor-token';
  return () => keys.forEach((key, i) => saved[i] === undefined ? delete process.env[key] : process.env[key] = saved[i]);
}

function request(peer = '172.30.32.2', headers = HEADERS, url = '/api/auth/me', method = 'GET') {
  return { socket: { remoteAddress: peer }, path: url, method, get: key => headers[key] };
}

function response() {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200, text: '',
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    write(text) { this.text += text; },
    end() { this.writableEnded = true; this.emit('close'); },
  });
  return res;
}

test('ingress trusts only the Supervisor socket and validated identity headers', async () => {
  const restore = haEnvironment();
  let checks = 0;
  const middleware = ingressMiddleware({ authorize: async () => { checks++; return true; } });
  try {
    for (const req of [
      request('192.168.1.10', { ...HEADERS, 'x-forwarded-for': '172.30.32.2' }),
      request('127.0.0.1'),
      request('172.30.32.2', {}),
      request('172.30.32.2', { ...HEADERS, 'x-ingress-path': '/api/hassio_ingress/token\"/><script>' }),
      request('172.30.32.2', { ...HEADERS, 'x-remote-user-id': 'admin&id=other' }),
      request('172.30.32.2', { ...HEADERS, 'x-remote-user-id': 'a'.repeat(129) }),
    ]) {
      const res = response();
      await middleware(req, res, () => assert.fail('untrusted request reached routes'));
      assert.equal(res.statusCode, 403);
      assert.equal(req.homeAssistant, undefined);
    }
    assert.equal(checks, 0);
    for (const peer of ['127.0.0.1', '::1']) {
      let next = false;
      await middleware(request(peer, {}, '/api/health'), response(), () => { next = true; });
      assert.equal(next, true, 'loopback health check');
    }
    const req = request('::ffff:172.30.32.2');
    await middleware(req, response(), () => {});
    assert.equal(checks, 1);
    assert.equal(req.homeAssistant.user.method, 'homeassistant');
    assert.equal(req.homeAssistant.user.email, 'ha:admin_id');
  } finally { restore(); }
});

test('ingress checks the real HA role with a server-only Supervisor token and fails closed', async () => {
  const restore = haEnvironment();
  const originalFetch = globalThis.fetch;
  try {
    let value = { allowed: true };
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://supervisor/core/api/marco/access?user_id=admin_id');
      assert.equal(options.headers.Authorization, 'Bearer private-supervisor-token');
      return new Response(JSON.stringify(value));
    };
    const middleware = ingressMiddleware();
    let passed = false;
    await middleware(request(), response(), () => { passed = true; });
    assert.equal(passed, true);
    for (value of [{ allowed: false }, { allowed: 'true' }, {}]) {
      const res = response();
      await middleware(request(), res, () => assert.fail('non-admin reached routes'));
      assert.equal(res.statusCode, 403);
    }
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    const res = response();
    await middleware(request(), res, () => assert.fail('authorization failure reached routes'));
    assert.equal(res.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(res.body), /private-supervisor-token/);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('ingress closes a live stream when the administrator loses access', async () => {
  const restore = haEnvironment();
  const req = request('172.30.32.2', HEADERS, '/api/stream');
  const res = response();
  let checks = 0;
  try {
    const closed = once(res, 'close');
    await ingressMiddleware({ authorize: async () => ++checks === 1, streamCheckMs: 10 })(req, res, () => {});
    // Keep the test alive while production's authorization interval is intentionally unref'ed.
    const timeout = setTimeout(() => res.emit('error', new Error('stream did not close')), 1000);
    try { await closed; } finally { clearTimeout(timeout); }
    assert.equal(req.homeAssistant.user, null);
    assert.match(res.text, /event: revoked/);
    assert.equal(res.writableEnded, true);
    assert.equal(checks, 2);
  } finally { res.emit('close'); restore(); }
});

test('ingress does not create a stream after a disconnect during authorization', async () => {
  const restore = haEnvironment();
  const req = request('172.30.32.2', HEADERS, '/api/stream');
  const res = response();
  let finish;
  try {
    const pending = ingressMiddleware({ authorize: () => new Promise(resolve => { finish = resolve; }) })(req, res, () => assert.fail('disconnected request reached stream'));
    res.destroyed = true;
    res.emit('close');
    finish(true);
    await pending;
    assert.equal(req.homeAssistant, undefined);
    assert.equal(res.listenerCount('close'), 0);
  } finally { restore(); }
});

test('HA middleware stack shares login, keeps CSRF protection and serves prefixed admin/display pages', async () => {
  const restore = haEnvironment();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-ingress-'));
  initStore(dir);
  fs.mkdirSync(path.join(dir, 'dist', 'admin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<html><head></head><body>Display</body></html>');
  fs.writeFileSync(path.join(dir, 'dist', 'admin', 'index.html'), '<html><head></head><body>Admin</body></html>');
  const outer = express();
  outer.use((req, res, next) => {
    // Simulate only the socket peer in this test; production cannot override it using headers.
    Object.defineProperty(req.socket, 'remoteAddress', { value: '172.30.32.2', configurable: true });
    next();
  });
  let allowed = true;
  outer.use(createApp({ version: 'test', dist: path.join(dir, 'dist'), ingressAuthorize: async id => allowed && id === 'admin_id' }));
  const server = outer.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (url, options = {}) => fetch(origin + url, { ...options, headers: { ...HEADERS, ...options.headers } });
  try {
    const me = await call('/api/auth/me');
    const auth = await me.json();
    assert.equal(auth.homeAssistant, true);
    assert.equal(auth.needsSetup, false);
    assert.equal(auth.user.method, 'homeassistant');
    assert.equal(me.headers.get('set-cookie'), null);
    assert.equal((await call('/api/admin/config')).status, 200);
    assert.equal((await call('/api/setup/status')).status, 200);
    assert.equal((await call('/api/setup/complete', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status, 409);
    for (const url of ['/auth/google/connect', '/auth/google/callback', '/auth/microsoft/connect', '/api/auth/login', '/api/admin/password']) {
      assert.equal((await call(url, { method: url.startsWith('/api/') ? 'POST' : 'GET' })).status, 409, url);
    }
    const config = structuredClone(getConfig());
    assert.equal((await call('/api/admin/config', { method: 'PUT', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify(config) })).status, 403);
    assert.equal((await call('/api/admin/config', { method: 'PUT', headers: { origin, 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify(config) })).status, 403);
    const features = (await (await call('/api/health')).json()).features;
    for (const feature of ['setupWizard', 'passwordLogin', 'googleLogin', 'googleCalendar', 'microsoftCalendar', 'openDisplayAccess', 'apiTokens', 'webhooks']) assert.equal(features[feature], false, feature);
    for (const [url, base] of [['/admin', '/admin/'], ['/admin/', '/admin/'], ['/admin/calendars', '/admin/'], ['/d/private-link', '/']]) {
      const page = await call(url);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get('location'), null);
      assert.match(await page.text(), new RegExp(`<base href="${HEADERS['x-ingress-path']}${base}">`));
    }
    allowed = false;
    assert.equal((await call('/api/admin/config')).status, 403);
    assert.equal((await call('/admin/')).status, 403);
  } finally {
    closeAll();
    await new Promise(resolve => server.close(resolve));
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
