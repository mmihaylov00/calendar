// Authenticated weather place search, rate limiting and cache with Open-Meteo mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { sessionMiddleware, csrfGuard, ensurePassword, loginHandler } from '../auth.js';
import { adminRouter } from '../routes/admin.js';
import { geocodeRouter, geocode, mapGeocode, _resetGeocode, GEOCODE_LIMIT, GEOCODE_URL } from '../geocode.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';

const GOOD = 'tidy-otter-lamp-42';

const OPEN_METEO = {
  results: [
    { id: 1, name: 'Porto', latitude: 41.14961, longitude: -8.61099, country_code: 'PT', admin1: 'Porto', country: 'Portugal', timezone: 'Europe/Lisbon', population: 249633 },
    { id: 2, name: 'Bad', latitude: 'x', longitude: 0 },
    { id: 3, name: 'Porto Alegre', latitude: -30.03, longitude: -51.23, country_code: 'br', country: 'Brazil', timezone: 'America/Sao_Paulo' },
  ],
};

/** Fake Open-Meteo: records the URLs it was asked for. */
function fakeFetch(answer = OPEN_METEO) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  fn.urls = urls;
  return fn;
}

async function withApp(fn, { secrets = {}, env = {}, fetchJson = fakeFetch() } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-geo-'));
  const c = defaultConfig();
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify(secrets));
  const saved = {};
  for (const [k, v] of Object.entries({ SETUP_TOKEN: undefined, ADMIN_PASSWORD: undefined, SETUP_REQUIRE_TOKEN: undefined, ...env })) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  store.initStore(dir);
  _resetGeocode();
  await ensurePassword();
  const app = express();
  app.set('trust proxy', true);
  app.use(sessionMiddleware());
  app.use(express.json());
  app.use(['/api/admin', '/api/auth'], csrfGuard());
  app.post('/api/auth/login', (req, res, next) => loginHandler(req, res).catch(next));
  app.use('/api/admin', geocodeRouter({ fetchJson }));
  app.use('/api/admin', adminRouter());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  const call = async (method, url, body, o = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: {
        ...(jar.cookie ? { cookie: jar.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-forwarded-for': o.ip ?? '192.168.1.20',
        ...(o.headers || {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) jar.cookie = set.map((x) => x.split(';')[0]).join('; ');
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, headers: r.headers };
  };
  try {
    await fn({ call, fetchJson });
  } finally {
    closeAll();
    await new Promise((r) => server.close(r));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
      _resetGeocode();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('geocode maps Open-Meteo to the shared shape and drops broken rows', () => {
  const { results } = mapGeocode(OPEN_METEO);
  assert.deepEqual(results, [
    { name: 'Porto', admin1: 'Porto', country: 'Portugal', countryCode: 'PT', lat: 41.14961, lon: -8.61099, timezone: 'Europe/Lisbon' },
    { name: 'Porto Alegre', admin1: '', country: 'Brazil', countryCode: 'BR', lat: -30.03, lon: -51.23, timezone: 'America/Sao_Paulo' },
  ]);
  assert.deepEqual(mapGeocode(null), { results: [] });
  assert.deepEqual(mapGeocode({ results: 'nope' }), { results: [] });
  assert.equal(mapGeocode({ results: Array.from({ length: 30 }, () => OPEN_METEO.results[0]) }).results.length, 8);
});

test('geocode with an admin session: query, language, cache, short queries, upstream failure', async () => {
  const hash = await (await import('../auth.js')).hashPassword(GOOD);
  await withApp(async ({ call, fetchJson }) => {
    assert.equal((await call('GET', '/api/admin/geocode?q=porto&lang=pt')).status, 401, 'no session');
    assert.equal(fetchJson.urls.length, 0);
    assert.equal((await call('POST', '/api/auth/login', { password: GOOD })).status, 200);
    const r = await call('GET', '/api/admin/geocode?q=%20Porto%20&lang=pt');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal(r.json.results[0].name, 'Porto');
    assert.equal(r.json.results[0].lat, 41.14961);
    const u = new URL(fetchJson.urls[0]);
    assert.equal(`${u.origin}${u.pathname}`, GEOCODE_URL);
    assert.equal(u.searchParams.get('name'), 'Porto');
    assert.equal(u.searchParams.get('language'), 'en');
    // cached (case-insensitive): no second upstream call
    assert.equal((await call('GET', '/api/admin/geocode?q=porto&lang=pt')).status, 200);
    assert.equal(fetchJson.urls.length, 1);
    // All locale requests use the same English cache entry.
    await call('GET', '/api/admin/geocode?q=porto&lang=xx');
    assert.equal(fetchJson.urls.length, 1);
    // too short: no upstream call
    assert.deepEqual((await call('GET', '/api/admin/geocode?q=p')).json, { results: [] });
    assert.equal(fetchJson.urls.length, 1);
  }, { secrets: { passwordHash: hash, sessionEpoch: 'e1' } });

  await withApp(async ({ call }) => {
    await call('POST', '/api/auth/login', { password: GOOD });
    const r = await call('GET', '/api/admin/geocode?q=porto&lang=es');
    assert.equal(r.status, 502);
    assert.equal(r.json.error, 'geocode_unavailable');
  }, { secrets: { passwordHash: hash, sessionEpoch: 'e1' }, fetchJson: fakeFetch(new Error('offline')) });
});

test('geocode is rate limited per address; cached answers are free', async () => {
  _resetGeocode();
  const fetchJson = fakeFetch();
  const now = Date.now();
  for (let i = 0; i < GEOCODE_LIMIT.max; i++) {
    assert.equal((await geocode({ q: `place ${i}`, lang: 'en', ip: '192.168.1.5' }, { fetchJson, now })).status, 200);
  }
  const limited = await geocode({ q: 'one more', lang: 'en', ip: '192.168.1.5' }, { fetchJson, now });
  assert.equal(limited.status, 429);
  assert.ok(limited.retryAfter > 0);
  assert.equal((await geocode({ q: 'place 3', lang: 'en', ip: '192.168.1.5' }, { fetchJson, now })).status, 200, 'cache hit');
  assert.equal((await geocode({ q: 'one more', lang: 'en', ip: '192.168.1.6' }, { fetchJson, now })).status, 200, 'other address');
  assert.equal((await geocode({ q: 'one more', lang: 'en', ip: '192.168.1.5' }, { fetchJson, now: now + GEOCODE_LIMIT.windowMs + 1 })).status, 200, 'window passed');
  _resetGeocode();
});

test('the app mounts geocode before the session-only admin routers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-geo-app-'));
  const c = defaultConfig();
  c.news.feeds = [];
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: 'x', sessionEpoch: 'e' }));
  store.initStore(dir);
  const app = createApp({ version: '9.9.9', dist: path.join(dir, 'no-dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/geocode?q=porto`);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
  } finally {
    closeAll();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
