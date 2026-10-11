// Real displays keep reporting health when opened with obsolete demo links; admin previews stay silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

test('display heartbeat reports real health with obsolete demo parameters, but never from a preview or after stopping', async () => {
  const saved = { location: globalThis.location, localStorage: globalThis.localStorage, window: globalThis.window, fetch: globalThis.fetch };
  const reports = [];
  const src = {
    screenId: () => 's_main', webgl: () => false, lite: () => true, night: () => false, nightOverride: () => 'auto',
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k),
  };
  globalThis.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1, screen: { width: 1920, height: 1080 } };
  globalThis.fetch = async (url, init) => {
    reports.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ now: '2026-10-11T12:00:00Z' }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const preview of [false, true]) {
      const u = new URL(`http://localhost/?demo=1${preview ? '&preview=1' : ''}`);
      globalThis.location = { href: u.href, origin: u.origin, host: u.host, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: '' };
      const [hb, store] = await loadWebModules('/web/display/heartbeat.ts', '/web/display/store.ts');
      const now = [];
      const heartbeat = new hb.Heartbeat(src, (iso) => now.push(iso));
      store.saveCache('events', { hash: 'real-calendar', events: [] });
      assert.deepEqual(store.loadCache('events'), preview ? null : { hash: 'real-calendar', events: [] });
      await heartbeat.send();
      assert.deepEqual(now, preview ? [] : ['2026-10-11T12:00:00Z']);
      heartbeat.stop();
      await heartbeat.send();
      assert.equal(reports.length, 1);
    }
    assert.equal(reports[0].url, '/api/display/heartbeat');
    assert.equal(reports[0].body.screenId, 's_main');
    assert.deepEqual(reports[0].body.viewport, { w: 1920, h: 1080 });
  } finally {
    for (const [k, v] of Object.entries(saved)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
});
