// Google's OAuth and Calendar endpoints are mocked; no live account or credentials are needed.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import * as google from '../google.js';
import { defaultConfig } from '../core/defaults.js';
import { googleConnectHandler, googleCallbackHandler } from '../auth.js';
import { refreshSource } from '../calendars.js';

const EMAIL = 'family@example.com';
const CALENDAR = 'family@example.com/calendar';
const FROM = new Date('2026-10-11T00:00:00Z');
const TO = new Date('2026-10-12T00:00:00Z');

describe('self-hosted Google calendars', () => {
  let dir;
  let fake;
  let realFetch;
  let prevEnv;
  const envKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_URL'];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-google-'));
    const cfg = defaultConfig();
    cfg.calendar.sources = [];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
    store.initStore(dir);
    store.updateSecrets((s) => {
      s.passwordHash = 'scrypt$aaaa$bbbb';
      s.passwordIsDefault = false;
      s.sessionEpoch = 'epoch-google';
    });
    prevEnv = envKeys.map((k) => process.env[k]);
    process.env.GOOGLE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    process.env.PUBLIC_URL = 'https://calendar.example.com';
    fake = {
      tokens: { access_token: 'AT-new', refresh_token: 'RT-new', expires_in: 3600, scope: `openid email profile ${google.CAL_SCOPE}` },
      profile: { email: 'Family@Example.com', email_verified: true, name: 'Family' },
      calendars: [{ items: [{ id: CALENDAR, summary: 'Family', primary: true }] }],
      events: [{ items: [{ id: 'e1', summary: 'Dentist', start: { dateTime: '2026-10-11T09:00:00Z' }, end: { dateTime: '2026-10-11T10:00:00Z' } }] }],
      tokenCalls: [], apiCalls: [], tokenResponse: null, apiResponse: null,
    };
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (u.href === 'https://oauth2.googleapis.com/token') {
        const form = new URLSearchParams(String(init.body));
        fake.tokenCalls.push(form);
        assert.equal(form.get('client_id'), 'google-client');
        assert.equal(form.get('client_secret'), 'google-secret');
        return fake.tokenResponse ? fake.tokenResponse() : Response.json(fake.tokens);
      }
      if (u.href === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(fake.profile);
      if (u.origin === 'https://www.googleapis.com') {
        fake.apiCalls.push({ url: u, token: init.headers.authorization });
        const response = fake.apiResponse?.(u, init);
        if (response) return response;
        const pages = u.pathname.endsWith('/calendarList') ? fake.calendars : fake.events;
        return Response.json(pages[u.searchParams.has('pageToken') ? 1 : 0]);
      }
      throw new Error(`unexpected fetch ${u}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    envKeys.forEach((k, i) => (prevEnv[i] === undefined ? delete process.env[k] : (process.env[k] = prevEnv[i])));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const session = () => ({ user: { method: 'password', email: 'admin', name: 'Admin' }, epoch: 'epoch-google' });
  const req = (over = {}) => ({ query: {}, session: session(), ip: '192.168.1.10', protocol: 'https', get: () => 'calendar.example.com', headers: {}, socket: {}, ...over });
  const redirectOf = async (handler, r) => {
    let to = '';
    await handler(r, { redirect: (u) => { to = u; } });
    return to;
  };
  const connect = async () => {
    const r = req();
    const url = new URL(await redirectOf(googleConnectHandler, r));
    return { url, session: r.session, query: { state: url.searchParams.get('state'), code: 'authorization-code' } };
  };
  const seedAccount = () => google.storeAccount({ email: EMAIL, name: 'Family' }, { ...fake.tokens, access_token: 'AT-old', refresh_token: 'RT-old' });

  test('OAuth connects a verified account with offline, read-only access and a single-use state', async () => {
    const flow = await connect();
    assert.equal(flow.url.origin, 'https://accounts.google.com');
    assert.equal(flow.url.searchParams.get('access_type'), 'offline');
    assert.equal(flow.url.searchParams.get('scope'), `openid email profile ${google.CAL_SCOPE}`);
    assert.equal(flow.url.searchParams.get('redirect_uri'), 'https://calendar.example.com/auth/google/callback');
    assert.equal(await redirectOf(googleCallbackHandler, req(flow)), '/admin/?connected=family%40example.com');
    assert.equal(store.getSecrets().google.accounts[EMAIL].refresh_token, 'RT-new');
    assert.deepEqual(google.listAccounts(), [{ email: EMAIL, name: 'Family', picture: '' }]);
    assert.equal(fake.tokenCalls[0].get('redirect_uri'), flow.url.searchParams.get('redirect_uri'));
    assert.equal(await redirectOf(googleCallbackHandler, req(flow)), '/admin/?error=invalid_state');
    assert.equal(fake.tokenCalls.length, 1);
  });

  test('OAuth rejects another session and Unicode nonce lengths without throwing or exchanging a code', async () => {
    const flow = await connect();
    assert.equal(await redirectOf(googleCallbackHandler, req({ query: flow.query })), '/admin/?error=invalid_state');
    flow.query.state = Buffer.from(JSON.stringify({ p: 'connect', n: 'é'.repeat(flow.session.oauthNonce.length) })).toString('base64url');
    assert.equal(await redirectOf(googleCallbackHandler, req(flow)), '/admin/?error=invalid_state');
    assert.equal(fake.tokenCalls.length, 0);
  });

  test('OAuth rejects a scope prefix and missing refresh tokens; reconnect preserves an existing refresh token', async () => {
    fake.tokens.scope = `${google.CAL_SCOPE}.unexpected`;
    assert.equal(await redirectOf(googleCallbackHandler, req(await connect())), '/admin/?error=calendar_scope_denied');
    fake.tokens.scope = google.CAL_SCOPE;
    delete fake.tokens.refresh_token;
    assert.equal(await redirectOf(googleCallbackHandler, req(await connect())), '/admin/?error=no_refresh_token');
    seedAccount();
    assert.equal(await redirectOf(googleCallbackHandler, req(await connect())), '/admin/?connected=family%40example.com');
    assert.equal(store.getSecrets().google.accounts[EMAIL].refresh_token, 'RT-old');
  });

  test('an absent email verification claim cannot connect a Google identity', async () => {
    delete fake.profile.email_verified;
    await assert.rejects(google.exchangeCode(req(), 'code'), /email not verified/);
    assert.deepEqual(google.listAccounts(), []);
  });

  test('own/shared calendars and recurring events page correctly with an encoded calendar ID', async () => {
    seedAccount();
    fake.calendars[0].nextPageToken = 'cal-next';
    fake.calendars.push({ items: [{ id: 'shared', summary: 'Shared', summaryOverride: 'Our shared calendar', backgroundColor: '#123456' }] });
    assert.deepEqual(await google.listCalendars(EMAIL), [
      { id: CALENDAR, summary: 'Family', primary: true, backgroundColor: null },
      { id: 'shared', summary: 'Our shared calendar', primary: false, backgroundColor: '#123456' },
    ]);
    fake.events[0].nextPageToken = 'event-next';
    fake.events.push({ items: [{ id: 'working', eventType: 'workingLocation' }, { id: 'e2', recurringEventId: 'series' }] });
    assert.deepEqual((await google.listEvents(EMAIL, CALENDAR, FROM, TO)).map((e) => e.id), ['e1', 'e2']);
    const calls = fake.apiCalls.slice(-2);
    assert.equal(calls[0].url.pathname, `/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`);
    assert.equal(calls[0].url.searchParams.get('singleEvents'), 'true');
    assert.equal(calls[0].url.searchParams.get('timeMin'), FROM.toISOString());
    assert.equal(calls[0].url.searchParams.get('timeMax'), TO.toISOString());
    assert.equal(calls[1].url.searchParams.get('pageToken'), 'event-next');
  });

  test('concurrent API 401 responses refresh once even before the saved expiry', async () => {
    seedAccount();
    fake.apiResponse = (u, init) => init.headers.authorization === 'Bearer AT-old'
      ? Response.json({ error: { message: 'Invalid Credentials' } }, { status: 401 }) : null;
    const lists = await Promise.all([google.listCalendars(EMAIL), google.listCalendars(EMAIL)]);
    assert.equal(lists[0][0].id, CALENDAR);
    assert.equal(lists[1][0].id, CALENDAR);
    assert.equal(fake.tokenCalls.length, 1);
    assert.equal(fake.tokenCalls[0].get('grant_type'), 'refresh_token');
    assert.equal(fake.tokenCalls[0].get('refresh_token'), 'RT-old');
    assert.equal(store.getSecrets().google.accounts[EMAIL].refresh_token, 'RT-new');
    assert.equal(fake.apiCalls.filter((c) => c.token === 'Bearer AT-new').length, 2);
    assert.equal(await google.getAccessToken(EMAIL, 'AT-old'), 'AT-new');
    assert.equal(fake.tokenCalls.length, 1, 'a late 401 for an old token reuses the refreshed token');
  });

  test('persistent 401 retries once and a forbidden calendar never retries', async () => {
    seedAccount();
    fake.apiResponse = () => Response.json({ error: { message: 'Invalid Credentials' } }, { status: 401 });
    await assert.rejects(google.listCalendars(EMAIL), { status: 401 });
    assert.equal(fake.apiCalls.length, 2);
    assert.equal(fake.tokenCalls.length, 1);
    fake.apiResponse = () => Response.json({ error: { message: 'Forbidden' } }, { status: 403 });
    await assert.rejects(google.listCalendars(EMAIL), { status: 403 });
    assert.equal(fake.apiCalls.length, 3);
    assert.equal(fake.tokenCalls.length, 1);
  });

  test('malformed token responses fail without overwriting stored credentials', async () => {
    seedAccount();
    store.updateSecrets((s) => { s.google.accounts[EMAIL].expiry = 0; });
    for (const body of ['not JSON', 'null', '[]', '{}', '{"access_token":"AT-bad","expires_in":0}']) {
      fake.tokenResponse = () => new Response(body);
      await assert.rejects(google.getAccessToken(EMAIL), { status: 502 });
      assert.equal(store.getSecrets().google.accounts[EMAIL].access_token, 'AT-old');
      assert.equal(store.getSecrets().google.accounts[EMAIL].refresh_token, 'RT-old');
    }
    fake.tokenResponse = () => Response.json({ error: 'invalid_grant' }, { status: 400 });
    await assert.rejects(google.getAccessToken(EMAIL), /invalid_grant/);
    fake.tokenResponse = null;
    assert.equal(await google.getAccessToken(EMAIL), 'AT-new', 'failed refreshes release the concurrency lock');
  });

  test('malformed API responses fail explicitly and the calendar pipeline keeps the last good events', async () => {
    seedAccount();
    const source = { id: 'c_google_test', type: 'google', name: 'Family', googleAccount: EMAIL, googleCalendarId: CALENDAR, enabled: true, refreshMin: 5 };
    const good = await refreshSource(source, { force: true });
    assert.equal(good.ok, true, good.error);
    assert.equal(good.count, 1);
    for (const body of ['not JSON', 'null', '[]']) {
      fake.apiResponse = () => new Response(body);
      await assert.rejects(google.listCalendars(EMAIL), { status: 502 });
    }
    const failed = await refreshSource(source, { force: true });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /invalid response/);
    assert.deepEqual(failed.items, good.items);
    assert.equal(failed.count, good.count);
  });
});
