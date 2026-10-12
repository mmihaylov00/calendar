import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

async function withBrowser(url, storage, run) {
  const keys = ['location', 'localStorage'];
  const previous = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const data = new Map(Object.entries(storage));
  const writes = [];
  Object.defineProperty(globalThis, 'location', { value: new URL(url), configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(['set', key]); data.set(key, String(value)); },
    removeItem: (key) => { writes.push(['remove', key]); data.delete(key); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  }, configurable: true });
  try {
    await run({ data, writes });
  } finally {
    for (const key of keys) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  }
}

const KEY = '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const TOKEN = `md_${'A'.repeat(43)}`;

test('existing private display credentials remain readable without device tracking', async () => {
  await withBrowser('https://ha.example.com/', { 'marco.deviceToken': TOKEN }, async ({ writes }) => {
    const [identity] = await loadWebModules('/web/display/identity.ts');
    assert.equal(identity.credential, TOKEN);
    assert.deepEqual(identity.authHeaders(), { 'X-Marco-Key': TOKEN });
    assert.deepEqual(writes, []);
  });
});

test('preview does not read, overwrite or clear the calendar cache or existing credentials', async () => {
  const stored = { 'marco.deviceToken': TOKEN, 'cs.cache._device.config': '{"private":true}' };
  await withBrowser(`https://ha.example.com/d/${KEY}?preview=1`, stored, async ({ data, writes }) => {
    const [identity, cache] = await loadWebModules('/web/display/identity.ts', '/web/display/store.ts');
    assert.equal(identity.isPreview, true);
    assert.equal(identity.credential, KEY);
    assert.equal(identity.storedDeviceToken(), '');
    identity.clearCaches();
    cache.saveCache('config', { private: false });
    assert.equal(cache.loadCache('config'), null);
    assert.deepEqual(writes, []);
    assert.equal(data.get('marco.deviceToken'), TOKEN);
    assert.equal(data.get('cs.cache._device.config'), stored['cs.cache._device.config']);
  });
});

test('access revocation clears all cached calendar payloads while preserving unrelated browser data', async () => {
  await withBrowser('https://ha.example.com/', {
    'marco.deviceToken': TOKEN,
    'cs.cache._device.config': '{}',
    'cs.cache._device.events': '{}',
    'cs.cache.other.weather': '{}',
    'calendar-admin.theme': 'dark',
  }, async ({ data }) => {
    const [identity] = await loadWebModules('/web/display/identity.ts');
    identity.clearCaches();
    assert.deepEqual([...data.keys()].sort(), ['calendar-admin.theme', 'marco.deviceToken']);
  });
});
