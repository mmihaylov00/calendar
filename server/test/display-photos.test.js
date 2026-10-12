import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

test('revoked access stops photo rotation and prevents a pending image from being displayed', async () => {
  const keys = ['location', 'localStorage', 'document', 'window', 'Image'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let finishDecode;
  let images = 0;
  let appended = 0;
  const globals = {
    location: new URL('http://localhost/'),
    localStorage: { getItem: () => null },
    document: { createElement: () => ({ getContext: () => null }) },
    window: {},
    Image: class {
      constructor() { images++; }
      naturalWidth = 100;
      naturalHeight = 100;
      decode() { return new Promise((resolve) => { finishDecode = resolve; }); }
    },
  };
  for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true });
  try {
    const [p] = await loadWebModules('/web/display/widgets/photos.ts');
    const photos = new p.Photos({ classList: { add() {} }, querySelector: () => ({ appendChild() { appended++; } }) }, { style: {} });
    photos.setList([{ url: '/media/private-photo.jpg' }]);
    assert.equal(images, 1);
    photos.stop();
    finishDecode();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await photos.next();
    assert.equal(appended, 0);
    assert.equal(images, 1, 'stopped rotation makes no further image requests');
  } finally {
    for (const k of keys) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
});
