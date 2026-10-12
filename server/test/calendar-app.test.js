// The trimmed application retains HA authorization and data, while removed APIs stay inaccessible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../app.js';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { closeAll, broadcast, clientCount, listClients } from '../sse.js';
import { revalidateStreams } from '../displayAccess.js';

const HEADERS = { 'x-ingress-path': '/api/hassio_ingress/test_token', 'x-remote-user-id': 'admin_id' };
const SOURCE = { id: 'calendar_app', type: 'homeassistant', entityId: 'calendar.family', name: 'Family', enabled: true, refreshMin: 5, kind: 'generic', color: '#123456', emoji: '' };

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-app-'));
  const savedEnv = ['MARCO_HOME_ASSISTANT', 'SUPERVISOR_TOKEN'].map(key => [key, process.env[key]]);
  process.env.MARCO_HOME_ASSISTANT = '1';
  process.env.SUPERVISOR_TOKEN = 'supervisor-private';
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === '127.0.0.1') return realFetch(url, options);
    calls.push(parsed.pathname);
    assert.equal(parsed.origin, 'http://supervisor');
    assert.equal(options.headers.authorization, 'Bearer supervisor-private');
    if (parsed.pathname === '/core/api/services/homeassistant/update_entity') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { entity_id: 'calendar.family' });
      return Response.json([]);
    }
    if (parsed.pathname === '/core/api/calendars') return Response.json([{ entity_id: 'calendar.family', name: 'Family' }]);
    if (parsed.pathname.startsWith('/core/api/calendars/')) return Response.json([{ summary: 'Synced calendar', start: { date: '2026-10-25' }, end: { date: '2026-10-26' } }]);
    throw new Error(`unexpected outbound request ${parsed.pathname}`);
  };
  const cfg = defaultConfig();
  cfg.calendar.sources = [SOURCE];
  cfg.localEvents.items = [{ id: 'old_local', title: 'Old local event', date: '2026-10-25' }];
  cfg.birthdays.items = [{ id: 'old_birthday', name: 'Old birthday', month: 10, day: 25, year: 2000 }];
  cfg.news.feeds = [{ id: 'old_news', name: 'Old feed', url: 'https://news.example.invalid/rss', enabled: true }];
  cfg.todo.items = [{ id: 'old_todo', text: 'Old todo', done: false }];
  cfg.screens[0].message = { enabled: true, text: 'Old message', emoji: '💬' };
  cfg.screens[0].background.source = 'gallery';
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ homeassistant: { token: 'stored-old-token' }, google: { accounts: { 'family@example.com': { refresh_token: 'google-private' } } } }));
  store.initStore(dir);
  const photo = Buffer.alloc(33);
  photo.writeUInt32BE(0x89504e47, 0); photo.writeUInt32BE(0x0d0a1a0a, 4); photo.writeUInt32BE(13, 8); photo.write('IHDR', 12); photo.writeUInt32BE(80, 16); photo.writeUInt32BE(60, 20);
  fs.writeFileSync(path.join(store.paths.photos, 'family.png'), photo);
  const outer = express();
  outer.use((req, res, next) => { Object.defineProperty(req.socket, 'remoteAddress', { value: '172.30.32.2', configurable: true }); next(); });
  outer.use(createApp({ version: 'test', dist: path.join(dir, 'no-dist'), ingressAuthorize: async id => id === 'admin_id' }));
  const server = outer.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (url, options = {}) => realFetch(origin + url, { ...options, headers: { ...HEADERS, ...options.headers } });
  try { await fn({ call, calls, origin, dir }); }
  finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = realFetch;
    for (const [key, value] of savedEnv) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('removed administration, data and command routes return 404 for a verified HA admin', async () => {
  await withApp(async ({ call, calls }) => {
    for (const url of ['/api/admin/backups', '/api/admin/activity', '/api/admin/dashboard', '/api/admin/status', '/api/admin/displays', '/api/admin/screens', '/api/admin/announcements', '/api/admin/privacy', '/api/admin/tokens', '/api/admin/display-links', '/api/admin/devices', '/api/admin/events', '/api/admin/birthdays', '/api/admin/countdowns', '/api/admin/update', '/api/admin/updates', '/api/display/poll', '/api/countdowns', '/api/news', '/api/display/doorbell/frame', '/api/pair/status', '/api/hooks/ping', '/api/setup/status']) {
      assert.equal((await call(url)).status, 404, url);
    }
    for (const url of ['/api/admin/backups', '/api/admin/export', '/api/admin/import/preview', '/api/admin/import/apply', '/api/admin/refresh-displays', '/api/admin/announcements', '/api/admin/privacy', '/api/admin/events/import', '/api/admin/birthdays/import', '/api/admin/test/rss', '/api/admin/test/homeassistant', '/api/admin/homeassistant/token', '/api/hooks/announce', '/api/hooks/doorbell', '/api/hooks/command', '/api/display/heartbeat', '/api/pair/start', '/api/setup/complete']) {
      assert.equal((await call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404, url);
    }
    assert.deepEqual(calls, [], 'removed routes do not trigger any external feature');
  });
});

test('calendar data, photos, configuration revisions and legacy saved data survive the trim', async () => {
  await withApp(async ({ call, dir }) => {
    assert.equal((await (await call('/api/auth/me')).json()).user.method, 'homeassistant');
    assert.equal((await (await call('/api/health')).json()).ok, true);
    assert.deepEqual(await (await call('/api/admin/homeassistant/calendars')).json(), [{ entity_id: 'calendar.family', name: 'Family' }]);
    const display = await (await call('/api/display/config')).json();
    assert.equal((await call('/api/display/config', { headers: { 'x-marco-key': 'stale-device-key' } })).status, 200);
    for (const key of ['news', 'todo', 'message', 'countdowns', 'alerts', 'schedules', 'privacy']) assert.equal(key in display, false, key);
    assert.deepEqual(display.calendar.sources.map(source => source.id), [SOURCE.id]);
    assert.ok(!JSON.stringify(display).includes('calendar.family'));
    const events = await (await call('/api/events?from=2026-10-24&to=2026-10-27')).json();
    assert.deepEqual(events.events.map(event => event.title), ['Synced calendar']);
    assert.equal(events.events[0].sourceId, SOURCE.id);
    assert.equal((await (await call('/api/photos')).json()).photos.length, 1);
    assert.equal((await call('/media/photos/family.png')).status, 200);
    assert.equal((await call('/media/photos/family.png?k=stale-device-key')).status, 200);
    const before = await (await call('/api/admin/config')).json();
    const next = { ...before, datetime: { timezone: 'UTC' }, baseRevision: before.revision };
    const options = { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) };
    const saved = await call('/api/admin/config', options);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).revision, before.revision + 1);
    assert.equal((await call('/api/admin/config', options)).status, 409);
    const invalid = { ...store.getConfig(), calendar: { ...store.getConfig().calendar, sources: [{ ...SOURCE, entityId: 'sensor.invalid' }] } };
    assert.equal((await call('/api/admin/config', { ...options, body: JSON.stringify(invalid) })).status, 400);
    const disk = JSON.parse(fs.readFileSync(store.paths.config, 'utf8'));
    assert.equal(disk.localEvents.items[0].title, 'Old local event');
    assert.equal(disk.birthdays.items[0].name, 'Old birthday');
    assert.equal(disk.todo.items[0].text, 'Old todo');
    assert.equal(store.getSecrets().google.accounts['family@example.com'].refresh_token, 'google-private');
    assert.ok(!JSON.stringify(disk).includes('supervisor-private'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'backups', 'config-previous.json'), 'utf8')).revision, before.revision);
    assert.equal(fs.existsSync(path.join(dir, 'activity.jsonl')), false);
    assert.equal(fs.existsSync(path.join(dir, 'displays.json')), false);
  });
});

async function readUntil(reader, pattern) {
  let text = '';
  const timeout = setTimeout(() => reader.cancel(), 1000);
  try {
    while (!pattern.test(text)) {
      const chunk = await reader.read();
      if (chunk.done) assert.fail(`stream ended before ${pattern}`);
      text += new TextDecoder().decode(chunk.value);
    }
    return text;
  } finally { clearTimeout(timeout); }
}

test('simple live refresh sends retained data events and closes a revoked HA session', async () => {
  await withApp(async ({ call }) => {
    const response = await call('/api/stream');
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const hello = await readUntil(reader, /event: hello/);
    assert.doesNotMatch(hello, /clientId|activeAnnouncementIds|doorbellId/);
    for (const event of ['config', 'events', 'photos']) broadcast(event, {});
    const live = await readUntil(reader, /event: photos/);
    for (const event of ['config', 'events', 'photos']) assert.ok(live.includes(`event: ${event}`), event);
    assert.equal(clientCount(), 1);
    listClients()[0].access.authReq.homeAssistant.user = null;
    assert.equal(revalidateStreams(), 1);
    assert.match(await readUntil(reader, /event: revoked/), /key_required/);
    assert.equal(clientCount(), 0);
    await reader.cancel();
  });
});
