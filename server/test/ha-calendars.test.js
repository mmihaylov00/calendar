import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import { haSettings, haGet, haUsable } from '../homeassistant.js';
import { calendarToRaw, listCalendars, listEvents } from '../haCalendars.js';
import { refreshSource, getEvents, pruneSourceCache, sourceStatus } from '../calendars.js';
import { adminRouter } from '../routes/admin.js';

const DATE_EVENT = { summary: 'Holiday', start: { date: '2026-10-25' }, end: { date: '2026-10-27' } };
const TIMED_EVENT = { summary: 'Lunch', start: { dateTime: '2026-10-25T10:00:00Z' }, end: { dateTime: '2026-10-25T11:00:00Z' }, location: 'Home' };
let sourceNumber = 0;

describe('Home Assistant calendar entities', () => {
  let dir, realFetch, savedEnv, calls, response, updateResponse;
  const envKeys = ['MARCO_HOME_ASSISTANT', 'SUPERVISOR_TOKEN'];
  const source = () => ({ id: `ha_test_${++sourceNumber}`, type: 'homeassistant', name: 'Family', entityId: 'calendar.family', enabled: true, refreshMin: 5, kind: 'generic', color: '#123456', emoji: '' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-ha-calendar-'));
    store.initStore(dir);
    savedEnv = envKeys.map((key) => process.env[key]);
    process.env.MARCO_HOME_ASSISTANT = '1';
    process.env.SUPERVISOR_TOKEN = 'supervisor-secret';
    realFetch = globalThis.fetch;
    calls = [];
    response = () => Response.json([DATE_EVENT, TIMED_EVENT]);
    updateResponse = () => Response.json([]);
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed, init });
      assert.equal(parsed.origin, 'http://supervisor');
      assert.equal(init.headers.authorization, 'Bearer supervisor-secret');
      if (parsed.pathname === '/core/api/services/homeassistant/update_entity') {
        assert.equal(init.method, 'POST');
        assert.match(JSON.parse(init.body).entity_id, /^calendar\./);
        return updateResponse();
      }
      return response(parsed);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    envKeys.forEach((key, i) => savedEnv[i] === undefined ? delete process.env[key] : (process.env[key] = savedEnv[i]));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('HA mode pins Supervisor credentials to the internal Core proxy without persisting them', async () => {
    assert.deepEqual(haSettings({ url: 'https://untrusted.example', token: 'other-token' }), {
      url: 'http://supervisor/core', token: 'supervisor-secret', enabled: true,
    });
    response = () => Response.json({ message: 'API running.' });
    assert.deepEqual(await haGet('/api/'), { message: 'API running.' });
    assert.equal(calls[0].url.pathname, '/core/api/');
    assert.ok(!JSON.stringify(store.getSecrets()).includes('supervisor-secret'));
    process.env.MARCO_HOME_ASSISTANT = '0';
    assert.equal(haSettings({ url: 'http://ha.example/', token: 'manual' }).url, 'http://ha.example');
    assert.equal(haSettings({ token: 'manual' }).token, 'manual');
  });

  test('calendar discovery returns a safe sorted list and handles an absent calendar integration', async () => {
    response = () => Response.json([{ entity_id: 'calendar.work', name: 'Work', extra: 'private' }, { entity_id: 'calendar.family', name: 'Family' }]);
    assert.deepEqual(await listCalendars(), [{ entity_id: 'calendar.family', name: 'Family' }, { entity_id: 'calendar.work', name: 'Work' }]);
    assert.equal(calls[0].url.pathname, '/core/api/calendars');
    response = () => new Response('', { status: 404 });
    assert.deepEqual(await listCalendars(), []);
    response = () => Response.json({ error: 'unavailable' });
    await assert.rejects(listCalendars(), /invalid calendar list/);
    response = () => Response.json([{ entity_id: 'sensor.family', name: 'Family' }]);
    await assert.rejects(listCalendars(), /invalid calendar list/);
    response = () => new Response('broken JSON');
    await assert.rejects(listCalendars(), /invalid JSON/);
  });

  test('managed HA weather and calendars need no standalone connection toggle', async () => {
    store.updateConfig((cfg) => { cfg.homeassistant.enabled = false; cfg.homeassistant.url = ''; });
    assert.equal(haUsable(), true);
    response = () => Response.json([{ entity_id: 'calendar.family', name: 'Family' }]);
    assert.equal((await listCalendars())[0].entity_id, 'calendar.family');
    store.updateConfig((cfg) => { cfg.homeassistant.enabled = true; });
    assert.equal(haUsable(), true, 'managed sensors need no manual URL or stored token');
    delete process.env.SUPERVISOR_TOKEN;
    assert.equal(haUsable(), false);
    await assert.rejects(listCalendars(), /Supervisor API token is unavailable/);
  });


  test('all-day dates remain exclusive dates and timed events retain their UTC instant across DST', async () => {
    const rawDate = calendarToRaw(DATE_EVENT);
    assert.deepEqual([rawDate.allDay, rawDate.start, rawDate.end], [true, '2026-10-25', '2026-10-27']);
    assert.equal(calendarToRaw(TIMED_EVENT).start.toISOString(), '2026-10-25T10:00:00.000Z');
    const calendar = source();
    store.updateConfig((cfg) => { cfg.datetime.timezone = 'Europe/Sofia'; cfg.calendar.sources = [calendar]; });
    await refreshSource(calendar, { force: true, window: { from: '2026-10-24', to: '2026-10-27' } });
    const events = (await getEvents({ from: '2026-10-24', to: '2026-10-27' })).events;
    assert.deepEqual(events.map((e) => [e.title, e.start, e.end, e.allDay, e.multiDay]), [
      ['Holiday', '2026-10-25', '2026-10-27', true, true],
      ['Lunch', '2026-10-25T12:00:00+02:00', '2026-10-25T13:00:00+02:00', false, false],
    ]);
    assert.ok(calls[1].url.searchParams.has('start'));
    assert.ok(calls[1].url.searchParams.has('end'));
  });

  test('opening the calendar awaits an HA update before reading events, even while the cache is fresh', async () => {
    const calendar = source();
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; });
    const window = { from: '2026-10-24', to: '2026-10-27' };
    const first = await getEvents({ ...window, refresh: true });
    calls.length = 0;
    response = () => Response.json([{ ...TIMED_EVENT, summary: 'Fresh lunch' }]);
    const cached = await getEvents(window);
    assert.equal(cached.hash, first.hash);
    assert.equal(calls.length, 0, 'internal cached reads do not force upstream sync');
    let releaseUpdate;
    updateResponse = () => new Promise((resolve) => { releaseUpdate = () => resolve(Response.json([])); });
    const opening = getEvents({ ...window, refresh: true });
    await new Promise(setImmediate);
    assert.deepEqual(calls.map((c) => c.url.pathname), ['/core/api/services/homeassistant/update_entity']);
    assert.deepEqual(JSON.parse(calls[0].init.body), { entity_id: calendar.entityId });
    releaseUpdate();
    const fresh = await opening;
    assert.deepEqual(fresh.events.map((event) => event.title), ['Fresh lunch']);
    assert.notEqual(fresh.hash, first.hash);
    assert.equal(calls[1].url.pathname, '/core/api/calendars/calendar.family');
    assert.ok(!JSON.stringify(store.getSecrets()).includes('supervisor-secret'));
  });

  test('concurrent calendar opens share one HA update and event fetch', async () => {
    const calendar = source();
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; });
    let releaseUpdate;
    updateResponse = () => new Promise((resolve) => { releaseUpdate = () => resolve(Response.json([])); });
    const request = { from: '2026-10-24', to: '2026-10-27', refresh: true };
    const opens = Promise.all([getEvents(request), getEvents(request)]);
    await new Promise(setImmediate);
    assert.equal(calls.length, 1);
    releaseUpdate();
    const [a, b] = await opens;
    assert.equal(a.hash, b.hash);
    assert.equal(a.events.length, 2);
    assert.equal(calls.length, 2);
  });

  test('concurrent wider requests extend an in-flight narrow window once and return its older events', async () => {
    const calendar = source();
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; cfg.datetime.timezone = 'UTC'; });
    const older = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    const nextDay = new Date(Date.now() - 179 * 86_400_000).toISOString().slice(0, 10);
    const olderEvent = { summary: 'Older event', start: { date: older }, end: { date: nextDay } };
    response = (url) => Response.json(url.searchParams.get('start').slice(0, 10) <= older
      ? [DATE_EVENT, TIMED_EVENT, olderEvent] : [DATE_EVENT, TIMED_EVENT]);
    let releaseFirstUpdate;
    updateResponse = () => releaseFirstUpdate ? Response.json([])
      : new Promise((resolve) => { releaseFirstUpdate = () => resolve(Response.json([])); });
    const narrow = getEvents({ from: '2026-10-24', to: '2026-10-27', refresh: true });
    await new Promise(setImmediate);
    const widerRequest = { from: older, to: nextDay, refresh: true };
    const wider = getEvents(widerRequest);
    const anotherWider = getEvents(widerRequest);
    releaseFirstUpdate();
    const [, a, b] = await Promise.all([narrow, wider, anotherWider]);
    assert.deepEqual(a.events.map((event) => event.title), ['Older event']);
    assert.deepEqual(b.events, a.events);
    assert.equal(calls.filter((call) => call.init.method === 'POST').length, 2);
    const eventCalls = calls.filter((call) => call.url.pathname.startsWith('/core/api/calendars/'));
    assert.equal(eventCalls.length, 2);
    assert.equal(eventCalls[1].url.searchParams.get('start').slice(0, 10), older);
  });

  test('failed on-demand HA synchronization retains last good events and reports a generic error', async () => {
    const calendar = source();
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; });
    const request = { from: '2026-10-24', to: '2026-10-27', refresh: true };
    const good = await getEvents(request);
    calls.length = 0;
    updateResponse = () => new Response('', { status: 503 });
    const older = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    const [failed, wider] = await Promise.all([getEvents(request), getEvents({ from: older, to: older, refresh: true })]);
    assert.deepEqual(failed.events, good.events);
    assert.deepEqual(failed.errors, [{ sourceId: calendar.id, message: 'fetch_failed' }]);
    assert.deepEqual(wider.errors, failed.errors, 'a failed joined refresh is not retried just to extend its window');
    assert.equal(calls.length, 1, 'failed synchronization does not continue to a stale HA event request');
    assert.equal(sourceStatus()[0].ok, false);
  });

  test('cache cleanup performs no fetch and an in-flight removed source cannot recreate its disk cache', async () => {
    const calendar = source();
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; });
    await refreshSource(calendar, { force: true });
    const file = path.join(store.paths.cache, `src_${calendar.id}.json`);
    assert.equal(fs.existsSync(file), true);
    let releaseUpdate;
    updateResponse = () => new Promise((resolve) => { releaseUpdate = () => resolve(Response.json([])); });
    const refreshing = refreshSource(calendar, { force: true });
    await new Promise(setImmediate);
    const count = calls.length;
    store.updateConfig((cfg) => { cfg.calendar.sources = []; });
    pruneSourceCache();
    assert.equal(calls.length, count);
    assert.equal(fs.existsSync(file), false);
    releaseUpdate();
    await refreshing;
    assert.equal(fs.existsSync(file), false, 'removed source stays removed after its old request completes');
    store.updateConfig((cfg) => { cfg.calendar.sources = [calendar]; });
    assert.equal(sourceStatus()[0].lastFetch, null, 'removed memory cache cannot reappear either');
  });

  test('the source cache notices HA event changes and retains good events when HA fails or returns malformed dates', async () => {
    const calendar = source();
    const good = await refreshSource(calendar, { force: true });
    assert.equal(good.ok, true);
    response = () => Response.json([{ ...TIMED_EVENT, summary: 'Updated lunch' }]);
    const updated = await refreshSource(calendar, { force: true });
    assert.ok(updated.version > good.version, 'HA events need not have an id, etag or updated field');
    assert.notEqual(updated.sig, good.sig);
    response = () => Response.json([{ ...DATE_EVENT, end: { date: '2026-10-24' } }]);
    const malformed = await refreshSource(calendar, { force: true });
    assert.equal(malformed.ok, false);
    assert.deepEqual(malformed.items, updated.items);
    response = () => new Response('', { status: 401 });
    const failed = await refreshSource(calendar, { force: true });
    assert.equal(failed.ok, false);
    assert.equal(failed.errorCode, 'auth_failed');
    assert.deepEqual(failed.items, updated.items);
  });

  test('entity ids and calendar payloads are validated before fetching or replacing events', async () => {
    const calendar = source();
    const cfg = defaultConfig();
    cfg.calendar.sources = [calendar];
    const validated = validateConfig(cfg);
    assert.deepEqual(validated.errors, []);
    assert.equal(validated.value.calendar.sources[0].entityId, 'calendar.family');
    for (const entityId of ['sensor.family', 'calendar.family/../../config', '', 'calendar.family?x=1']) {
      cfg.calendar.sources[0].entityId = entityId;
      assert.ok(validateConfig(cfg).errors.some((e) => e.path === 'calendar.sources[0].entityId'));
      await assert.rejects(listEvents(entityId, new Date(), new Date(), { refresh: true }), /calendar entity/);
    }
    assert.equal(calls.length, 0);
    assert.throws(() => calendarToRaw({ ...DATE_EVENT, start: { date: '2026-02-30' } }), /invalid all-day/);
    assert.throws(() => calendarToRaw({ ...TIMED_EVENT, start: { dateTime: '2026-10-25T10:00:00' } }), /invalid timed/);
    response = () => Response.json({ events: [] });
    await assert.rejects(listEvents('calendar.family', new Date(), new Date()), /invalid calendar event list/);
  });

  test('calendar discovery remains behind the existing admin authentication boundary', async () => {
    const app = express();
    app.use('/api/admin', adminRouter());
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/admin/homeassistant/calendars`);
      assert.equal(res.status, 401);
      assert.equal(calls.length, 0);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
