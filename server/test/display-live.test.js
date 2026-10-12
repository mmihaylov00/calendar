// Calendar live updates: config polling, guarded dispatch and SSE reconnect behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

const [live] = await loadWebModules('/web/display/live.ts');
const opts = {};

test('config poll refetches data only when the revision changes', opts, async () => {
  let rev = 1;
  let serverRev = 1;
  let ok = true;
  let changed = 0;
  const p = live.startConfigPoll({
    revision: () => rev,
    fetchConfig: async () => { if (!ok) return false; rev = serverRev; return true; },
    changed: () => changed++,
    intervalMs: 3_600_000,
  });
  try {
    await p.tick();
    assert.equal(changed, 0);
    serverRev = 2;
    await p.tick();
    assert.equal(changed, 1);
    await p.tick();
    assert.equal(changed, 1);
    // failed fetch (offline, or 401 / 403 handled by fetchConfig): nothing refetched
    serverRev = 3;
    ok = false;
    await p.tick();
    assert.equal(changed, 1);
    ok = true;
    p.close();
    await p.tick();
    assert.equal(changed, 1, 'closed poll does nothing');
  } finally {
    p.close();
  }
});

function recorder() {
  const calls = [];
  const h = {};
  for (const n of ['hello', 'config', 'events', 'photos', 'reload', 'revoked', 'open', 'down']) {
    h[n] = (d) => calls.push(d === undefined ? [n] : [n, d]);
  }
  return { h, calls };
}

const GUARD_CASES = [
  ['hello', { revision: 3 }, [['hello', { revision: 3 }]]],
  ['config', { revision: 4 }, [['config', { revision: 4 }]]],
  ['config', { revision: 'bad' }, []],
  ['events', { hash: 'h1' }, [['events', { hash: 'h1' }]]],
  ['events', {}, []],
  ['photos', { hidden: ['a.jpg', 7, null, 'b.jpg'] }, [['photos', { hidden: ['a.jpg', 'b.jpg'] }]]],
  ['photos', null, [['photos', { hidden: undefined }]]],
  ['reload', {}, [['reload']]],
  ['revoked', { code: 'key_required' }, [['revoked', { code: 'key_required' }]]],
  ['revoked', { code: 7 }, [['revoked', { code: 'invalid_key' }]]],
];

test('only valid calendar updates dispatch; removed dashboard commands have no handlers', () => {
  for (const [name, d, expected] of GUARD_CASES) {
    const { h, calls } = recorder();
    assert.equal(live.dispatch(name, d, h), true);
    assert.deepEqual(calls, expected, name);
  }
  const { h, calls } = recorder();
  for (const name of ['announce', 'announce-clear', 'identify', 'night', 'privacy', 'doorbell', 'doorbell-end']) {
    assert.equal(live.dispatch(name, { id: 'old', mode: 'on' }, h), false, name);
  }
  assert.deepEqual(calls, []);
});

class FakeEventSource {
  static last = null;
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; FakeEventSource.last = this; FakeEventSource.all.push(this); }
  addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
  close() { this.closed = true; }
  emit(name, data) { for (const fn of this.listeners.get(name) || []) fn({ data: data === undefined ? '' : JSON.stringify(data) }); }
}
FakeEventSource.all = [];

test('SSE stream: the same guards per event, and revoked closes the stream for good', async () => {
  const { loadWebModules } = await import('./webModules.js');
  const saved = { location: globalThis.location, localStorage: globalThis.localStorage, EventSource: globalThis.EventSource };
  const u = new URL('http://localhost/?screen=kitchen&client=kiosk-1');
  const ls = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  Object.defineProperty(globalThis, 'location', { value: { href: u.href, origin: u.origin, host: u.host, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: '' }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
  globalThis.EventSource = FakeEventSource;
  try {
    const [stream] = await loadWebModules('/web/display/stream.ts');
    const { h, calls } = recorder();
    const s = stream.connectStream(h);
    const es = FakeEventSource.last;
    assert.equal(es.url, '/api/stream?screen=kitchen');
    for (const [name, d, expected] of GUARD_CASES) {
      if (name === 'revoked') continue;
      calls.length = 0;
      es.emit(name, d);
      assert.deepEqual(calls, expected, `${name} ${JSON.stringify(d)}`);
    }
    // a throwing handler does not break the stream
    const boom = stream.connectStream({ reload: () => { throw new Error('boom'); } });
    const quiet = console.error;
    console.error = () => {};
    try { FakeEventSource.last.emit('reload', {}); } finally { console.error = quiet; }
    boom.close();
    // revoked: closed before the handler runs, and no reconnect afterwards
    calls.length = 0;
    const before = FakeEventSource.all.length;
    es.emit('revoked', { code: 7 });
    assert.equal(es.closed, true);
    assert.deepEqual(calls, [['revoked', { code: 'invalid_key' }]]);
    es.onerror?.();
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(FakeEventSource.all.length, before, 'a revoked stream never reopens');
    s.close();
  } finally {
    for (const [k, v] of Object.entries(saved)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
});
