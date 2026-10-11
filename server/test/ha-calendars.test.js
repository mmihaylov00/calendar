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
import { refreshSource, getEvents } from '../calendars.js';
import { adminRouter } from '../routes/admin.js';
import { dashboardWarnings } from '../routes/system.js';

const DATE_EVENT = { summary: 'Holiday', start: { date: '2026-10-25' }, end: { date: '2026-10-27' } };
const TIMED_EVENT = { summary: 'Lunch', start: { dateTime: '2026-10-25T10:00:00Z' }, end: { dateTime: '2026-10-25T11:00:00Z' }, location: 'Home' };
let sourceNumber = 0;

describe('Home Assistant calendar entities', () => {
  let dir, realFetch, savedEnv, calls, response;
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
    globalThis.fetch = async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed, init });
      assert.equal(parsed.origin, 'http://supervisor');
      assert.equal(init.headers.authorization, 'Bearer supervisor-secret');
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
      url: 'http://supervisor/core', token: 'supervisor-secret', enabled: false,
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

  test('the sensor toggle controls HA overlays while calendars retain their trusted connection', async () => {
    store.updateConfig((cfg) => { cfg.homeassistant.enabled = false; cfg.homeassistant.url = ''; });
    assert.equal(haUsable(), false);
    response = () => Response.json([{ entity_id: 'calendar.family', name: 'Family' }]);
    assert.equal((await listCalendars())[0].entity_id, 'calendar.family');
    store.updateConfig((cfg) => { cfg.homeassistant.enabled = true; });
    assert.equal(haUsable(), true, 'managed sensors need no manual URL or stored token');
    delete process.env.SUPERVISOR_TOKEN;
    assert.equal(haUsable(), false);
    await assert.rejects(listCalendars(), /Supervisor API token is unavailable/);
  });

  test('dashboard warnings omit standalone password and display-access advice in HA mode', () => {
    const cfg = defaultConfig();
    cfg.security.displayAccess = 'open';
    const args = { secrets: { passwordIsDefault: true }, cfg, sources: [], displays: [] };
    assert.deepEqual(dashboardWarnings(args), ['no_displays']);
    process.env.MARCO_HOME_ASSISTANT = '0';
    assert.deepEqual(dashboardWarnings(args), ['default_password', 'display_access_open', 'no_displays']);
    args.secrets = { passwordFromEnv: true };
    assert.deepEqual(dashboardWarnings(args), ['env_password', 'display_access_open', 'no_displays']);
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
    assert.ok(calls[0].url.searchParams.has('start'));
    assert.ok(calls[0].url.searchParams.has('end'));
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
      await assert.rejects(listEvents(entityId, new Date(), new Date()), /calendar entity/);
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
