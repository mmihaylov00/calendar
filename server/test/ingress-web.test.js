import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

const BASE = '/api/hassio_ingress/test_session-123';
const KEY = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

async function withBrowser(path, fn) {
  const keys = ['location', 'localStorage', 'fetch', 'XMLHttpRequest'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const data = new Map([['marco.deviceToken', `md_${'A'.repeat(43)}`], ['cs.clientId', 'd_ingress_test']]);
  const requests = [];
  const url = new URL(path, 'http://ha.local:8123');
  Object.defineProperty(globalThis, 'location', { value: url, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  }, configurable: true });
  Object.defineProperty(globalThis, 'fetch', { value: async (url, init) => {
    requests.push({ url, init });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }, configurable: true });
  Object.defineProperty(globalThis, 'XMLHttpRequest', { value: class {
    upload = {};
    status = 200;
    responseText = '{}';
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    send() { requests.push({ url: this.url, method: this.method }); this.onload(); }
  }, configurable: true });
  try {
    await fn({ data, requests });
  } finally {
    for (const k of keys) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
}

test('ingress URLs remain scoped and external URLs remain unchanged', async () => {
  await withBrowser(`${BASE}/admin/`, async () => {
    const [p, auth, urls] = await loadWebModules('/web/shared/path.ts', '/web/admin/authRedirect.ts', '/web/admin/screenUrl.ts');
    assert.equal(p.appBase(), BASE);
    assert.equal(p.appPath(), '/admin/');
    assert.equal(p.appBase('/api/hassio_ingress/bad%2ftoken/admin'), '');
    assert.equal(p.appBase('/api/hassio_ingress/token.extra/admin'), '');
    assert.equal(p.appUrl('/api/health'), `${BASE}/api/health`);
    assert.equal(p.appUrl(`${BASE}/api/health`), `${BASE}/api/health`);
    for (const url of ['https://example.com/media/photo', '//example.com/photo', 'blob:http://ha.local/id', 'data:image/png,abc', '#/calendars']) assert.equal(p.appUrl(url), url);
    assert.equal(auth.homeAssistantMode(null), true);
    assert.equal(auth.accountMode({ user: null }, { edition: 'cloud', tenancy: 'multi' }), false);
    assert.equal(auth.safeNext(`${BASE}/admin/#/calendars`), `${BASE}/admin/#/calendars`);
    assert.equal(auth.safeNext('//example.com/admin/'), `${BASE}/admin/`);
    assert.equal(urls.screenUrl({ slug: 'kitchen', linkKey: KEY, displayOrigin: 'http://marco.local:3000', origin: location.origin, preview: true }), `${BASE}/?screen=kitchen&preview=1`);
  });
  await withBrowser('/admin/', async () => {
    const [p, auth] = await loadWebModules('/web/shared/path.ts', '/web/admin/authRedirect.ts');
    assert.equal(p.appBase(), '');
    assert.equal(p.appUrl('/api/health'), '/api/health');
    assert.equal(auth.homeAssistantMode({ user: { method: 'homeassistant' } }), true);
    assert.equal(auth.homeAssistantMode({ user: { method: 'password' } }), false);
  });
});

test('ingress display identity ignores stale device tokens and scopes media and streams', async () => {
  await withBrowser(`${BASE}/?screen=kitchen`, async ({ data }) => {
    const [id, stream] = await loadWebModules('/web/display/identity.ts', '/web/display/stream.ts');
    assert.equal(id.credential, '');
    assert.equal(id.screenKey, 'kitchen');
    id.saveDeviceToken(`md_${'B'.repeat(43)}`);
    id.clearDeviceToken();
    assert.equal(data.get('marco.deviceToken'), `md_${'A'.repeat(43)}`);
    assert.equal(id.mediaUrl('/media/photo.jpg'), `${BASE}/media/photo.jpg`);
    assert.match(stream.streamUrl(), new RegExp(`^${BASE}/api/stream\\?`));
    assert.equal(new URL(stream.streamUrl(), location.origin).searchParams.get('k'), null);
  });
  await withBrowser(`${BASE}/d/${KEY}?preview=1`, async () => {
    const [id] = await loadWebModules('/web/display/identity.ts');
    assert.equal(id.linkKey, KEY);
    assert.equal(id.mediaUrl('/media/photo.jpg?size=small'), `${BASE}/media/photo.jpg?size=small&k=${KEY}`);
    for (const url of ['https://example.com/media/photo.jpg', '//example.com/media/photo.jpg', '/api/hassio_ingress/another_session/media/photo.jpg']) assert.ok(!id.mediaUrl(url).includes(`k=${KEY}`), 'credentials never reach external media or another ingress session');
  });
});

test('admin fetch, display fetch, downloads and photo uploads use ingress paths', async () => {
  await withBrowser(`${BASE}/admin/`, async ({ requests }) => {
    const [admin, display] = await loadWebModules('/web/admin/api.ts', '/web/display/api.ts');
    await admin.api.haCalendars();
    await display.api.weather();
    await admin.uploadPhotos([{ blob: new Blob(['photo']), name: 'photo.jpg' }]);
    assert.deepEqual(requests.map((r) => r.url), [
      `${BASE}/api/admin/homeassistant/calendars`,
      `${BASE}/api/weather`,
      `${BASE}/api/admin/photos?onConflict=rename`,
    ]);
    assert.equal(admin.api.backupUrl('backup.json'), `${BASE}/api/admin/backups/backup.json`);
  });
});
