// On-demand source fetching, disk fallback and startup/config wiring without starting a production service.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { getEvents, pruneSourceCache } from '../calendars.js';

const WINDOW = { from: '2026-10-24', to: '2026-10-27' };
const ics = (title) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', 'UID:event-1',
  'DTSTAMP:20261001T000000Z', 'DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261026',
  `SUMMARY:${title}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
let sourceNumber = 0;

describe('on-demand calendar sources', () => {
  let dir, realFetch, calls, response;
  const source = () => ({ id: `refresh_test_${++sourceNumber}`, type: 'ics', name: 'Family', url: `https://calendar.example.com/${sourceNumber}.ics`, enabled: true, refreshMin: 60, kind: 'generic', color: '#123456', emoji: '' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-refresh-'));
    store.initStore(dir);
    store.updateConfig((cfg) => { cfg.calendar.sources = []; });
    pruneSourceCache();
    calls = [];
    response = () => new Response(ics('Fresh event'));
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { calls.push(String(url)); return response(); };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function diskCache(calendar) {
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; });
    const file = path.join(store.paths.cache, `src_${calendar.id}.json`);
    fs.writeFileSync(file, JSON.stringify({ key: `ics|${calendar.url}|0`, fetchedAt: Date.now(), text: ics('Disk event') }));
    return file;
  }

  test('fresh requests hydrate the last good ICS disk cache and still fetch within its TTL', async () => {
    const file = diskCache(source());
    const events = await getEvents({ ...WINDOW, refresh: true });
    assert.deepEqual(events.events.map((event) => event.title), ['Fresh event']);
    assert.equal(calls.length, 1);
    assert.match(JSON.parse(fs.readFileSync(file, 'utf8')).text, /Fresh event/);
  });

  test('a forced request joining disk hydration fetches once instead of returning only the disk cache', async () => {
    diskCache(source());
    const cached = getEvents(WINDOW);
    const fresh = getEvents({ ...WINDOW, refresh: true });
    const [, events] = await Promise.all([cached, fresh]);
    assert.deepEqual(events.events.map((event) => event.title), ['Fresh event']);
    assert.equal(calls.length, 1);
  });

  test('a failed fresh fetch keeps hydrated disk events and the successful disk snapshot', async () => {
    const calendar = source();
    const file = diskCache(calendar);
    response = () => new Response('', { status: 503 });
    const events = await getEvents({ ...WINDOW, refresh: true });
    assert.deepEqual(events.events.map((event) => event.title), ['Disk event']);
    assert.deepEqual(events.errors, [{ sourceId: calendar.id, message: 'fetch_failed' }]);
    assert.match(JSON.parse(fs.readFileSync(file, 'utf8')).text, /Disk event/);
  });

  test('only selected enabled sources are fetched for the requesting screen', async () => {
    const selected = source();
    const other = source();
    const disabled = { ...source(), enabled: false };
    store.updateConfig((cfg) => {
      cfg.calendar.sources = [selected, other, disabled];
      cfg.screens[0].calendar.sourceIds = [selected.id, disabled.id];
    });
    const events = await getEvents({ ...WINDOW, screen: store.getConfig().screens[0], refresh: true });
    assert.deepEqual(calls, [selected.url]);
    assert.deepEqual(events.events.map((event) => event.sourceId), [selected.id]);
  });
});

test('server startup and config saves prune caches and notify displays without background providers or timers', () => {
  // Evaluate the real entry point with inert imports/listen. No socket, provider request or HA service is started.
  const program = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import vm from 'node:vm';
    const root = process.cwd();
    const config = { datetime: { timezone: 'UTC' }, revision: 1 };
    const listeners = new Map();
    const broadcasts = [];
    let pruned = 0;
    const unexpectedTimer = () => { throw new Error('background provider timer scheduled'); };
    const context = vm.createContext({
      console: { log() {}, error() {} },
      process: { env: { TZ: 'UTC' }, on() {}, exit() { throw new Error('unexpected exit'); } },
      setInterval: unexpectedTimer, setTimeout: unexpectedTimer,
      fetch() { throw new Error('unexpected upstream request'); },
    });
    const imports = {
      'dotenv/config': {}, 'node:fs': { default: fs }, 'node:path': { default: path },
      './store.js': {
        initStore() {}, getConfig: () => config, ROOT: root, paths: { data: 'inert' }, StoreError: class extends Error {},
        events: { on: (name, handler) => listeners.set(name, handler) },
      },
      './auth.js': { ensurePassword() {} },
      './app.js': { createApp: () => ({ listen(port, host, callback) { callback(); return {}; } }) },
      './displayAccess.js': { syncDisplayKeys() {}, onDisplayAccessConfig() {}, revalidateStreams() {} },
      './sse.js': { broadcast: (name) => broadcasts.push(name), closeAll() {}, reresolveClients() {}, setStreamValidator() {} },
      './core/screens.js': { resolveScreen() {} },
      './calendars.js': { invalidateIcsParsing() {}, pruneSourceCache() { pruned++; } },
    };
    const module = new vm.SourceTextModule(fs.readFileSync(path.join(root, 'server/index.js'), 'utf8'), { context });
    await module.link((specifier) => {
      assert.ok(Object.hasOwn(imports, specifier), 'unexpected startup dependency: ' + specifier);
      const values = imports[specifier];
      return new vm.SyntheticModule(Object.keys(values), function () {
        for (const [name, value] of Object.entries(values)) this.setExport(name, value);
      }, { context });
    });
    await module.evaluate();
    assert.equal(pruned, 1);
    listeners.get('config')(config);
    assert.equal(pruned, 2);
    assert.deepEqual(broadcasts, ['config']);
  `;
  execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', program], { cwd: store.ROOT, stdio: 'pipe' });
});
