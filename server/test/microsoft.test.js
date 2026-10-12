// Microsoft calendars on a self-hosted server (server/microsoft.js with the server's own Entra app) and the shared
// Graph mapping (server/core/microsoftGraph.js). The Microsoft identity platform and Graph are mocked.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { microsoftConnectHandler, microsoftCallbackHandler, meHandler } from '../auth.js';
import * as microsoft from '../microsoft.js';
import { selfHostedFeatures } from '../capabilities.js';
import { refreshSource } from '../calendars.js';
import { graphToRaw, graphInstant, idTokenEmail, scopeGranted, calendarItem, MS_TOKEN_URL, GRAPH_API } from '../core/microsoftGraph.js';

const CLIENT_ID = '7a3a24ab-0000-4000-8000-000000000002';
const TID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims) => `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`;
const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

// Hooks scoped to this block: the test runner shares one process with the other files.
describe('self-hosted Microsoft calendars', () => {
  let dir;
  let fake;
  let realFetch;
  const envKeys = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'PUBLIC_URL'];
  let prevEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-ms-'));
    const c = defaultConfig();
    c.calendar.sources = [];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
    store.initStore(dir);
    store.updateSecrets((s) => {
      s.passwordHash = 'scrypt$aaaa$bbbb';
      s.passwordIsDefault = false;
      s.sessionEpoch = 'epoch-1';
    });
    prevEnv = envKeys.map((k) => process.env[k]);
    process.env.MICROSOFT_CLIENT_ID = CLIENT_ID;
    process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
    process.env.PUBLIC_URL = 'http://localhost:3000';
    fake = { email: 'ana@outlook.com', challenge: '', issued: [], tokenCalls: [], graph: [], refreshError: '', events: [] };
    realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (u.toString() === MS_TOKEN_URL) {
        const form = new URLSearchParams(String(init.body));
        fake.tokenCalls.push(form);
        if (form.get('client_secret') !== 'ms-secret') return Response.json({ error: 'invalid_client' }, { status: 401 });
        const issue = () => { const t = `RT-secret-${fake.issued.length + 1}`; fake.issued.push(t); return t; };
        if (form.get('grant_type') === 'authorization_code') {
          const ch = crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url');
          if (ch !== fake.challenge || form.get('redirect_uri') !== 'http://localhost:3000/auth/microsoft/callback') return Response.json({ error: 'invalid_grant' }, { status: 400 });
          return Response.json({
            access_token: 'AT-secret-1', expires_in: 3600, scope: 'Calendars.Read Calendars.Read.Shared', refresh_token: issue(),
            id_token: idToken({ aud: CLIENT_ID, tid: TID, iss: `https://login.microsoftonline.com/${TID}/v2.0`, exp: Date.now() / 1000 + 600, email: fake.email }),
          });
        }
        if (fake.refreshError) return Response.json({ error: fake.refreshError }, { status: 400 });
        if (!fake.issued.includes(form.get('refresh_token'))) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: `AT-secret-r${fake.issued.length}`, expires_in: 3600, scope: 'Calendars.Read', refresh_token: issue() });
      }
      if (u.toString().startsWith(GRAPH_API)) {
        fake.graph.push(u);
        const p = u.pathname.replace('/v1.0', '');
        if (p === '/me/calendars') return Response.json({ value: [{ id: 'cal-1', name: 'Calendar', isDefaultCalendar: true, owner: { address: fake.email } }] });
        if (p === '/me/calendarGroups') return Response.json({ value: [{ id: 'g2' }] });
        if (p === '/me/calendarGroups/g2/calendars') return Response.json({ value: [{ id: 'cal-shared', name: 'Familia', owner: { address: 'luis@outlook.com' } }] });
        if (p.endsWith('/calendarView')) return Response.json({ value: fake.events });
      }
      throw new Error(`unexpected fetch ${u}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    envKeys.forEach((k, i) => (prevEnv[i] === undefined ? delete process.env[k] : (process.env[k] = prevEnv[i])));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const session = () => ({ user: { method: 'password', email: 'admin', name: 'Admin' }, epoch: 'epoch-1' });
  const req = (over = {}) => ({ query: {}, session: session(), ip: '192.168.1.10', protocol: 'http', get: () => 'localhost:3000', headers: {}, socket: {}, ...over });
  const redirectOf = async (handler, r) => {
    let to = '';
    await handler(r, { redirect: (u) => { to = u; }, json: () => {} });
    return to;
  };

  async function connect(sess = session()) {
    const r = req({ session: sess });
    const loc = new URL(await redirectOf(microsoftConnectHandler, r));
    fake.challenge = loc.searchParams.get('code_challenge');
    return { loc, sess: r.session };
  }

  test('capabilities and /api/auth/me follow MICROSOFT_CLIENT_ID / SECRET', () => {
    assert.equal(selfHostedFeatures().microsoftCalendar, true);
    let body;
    meHandler(req(), { json: (b) => { body = b; } });
    assert.equal(body.microsoftConfigured, true);
    delete process.env.MICROSOFT_CLIENT_SECRET;
    assert.equal(selfHostedFeatures().microsoftCalendar, false);
  });

  test('connect: PKCE and state in the session, single use; tokens stored, never in the redirect', async () => {
    const { loc, sess } = await connect();
    assert.equal(loc.origin + loc.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    assert.equal(loc.searchParams.get('scope'), 'openid email profile offline_access Calendars.Read Calendars.Read.Shared');
    assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/microsoft/callback');
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    const state = loc.searchParams.get('state');
    // Another session cannot finish it.
    assert.equal(await redirectOf(microsoftCallbackHandler, req({ query: { state, code: 'c' } })), '/admin/?error=microsoft_invalid_state#/calendars/cal-accounts');
    const to = await redirectOf(microsoftCallbackHandler, req({ session: sess, query: { state, code: 'c' } }));
    assert.equal(to, '/admin/?microsoft=ana%40outlook.com#/calendars/cal-accounts');
    assert.ok(!to.includes('secret'));
    assert.equal(store.getSecrets().microsoft.accounts['ana@outlook.com'].refresh_token, 'RT-secret-1');
    // Replayed: refused.
    assert.equal(await redirectOf(microsoftCallbackHandler, req({ session: sess, query: { state, code: 'c' } })), '/admin/?error=microsoft_invalid_state#/calendars/cal-accounts');
    assert.deepEqual(microsoft.listAccounts(), [{ email: 'ana@outlook.com' }]);
  });

  test('connect errors map to microsoft_ codes; without the app nothing is offered', async () => {
    const { loc, sess } = await connect();
    const q = { state: loc.searchParams.get('state'), error: 'access_denied' };
    assert.equal(await redirectOf(microsoftCallbackHandler, req({ session: sess, query: q })), '/admin/?error=microsoft_access_denied#/calendars/cal-accounts');
    delete process.env.MICROSOFT_CLIENT_ID;
    assert.equal(await redirectOf(microsoftConnectHandler, req()), '/admin/?error=microsoft_not_configured#/calendars/cal-accounts');
  });

  test('calendars: own and shared; events through the pipeline; refresh tokens rotate; invalid_grant warns', async () => {
    const { loc, sess } = await connect();
    await redirectOf(microsoftCallbackHandler, req({ session: sess, query: { state: loc.searchParams.get('state'), code: 'c' } }));
    assert.deepEqual(await microsoft.listCalendars('ana@outlook.com'), [
      { id: 'cal-1', name: 'Calendar', isDefault: true },
      { id: 'cal-shared', name: 'Familia', owner: 'luis@outlook.com' },
    ]);
    fake.events = [
      { id: 'e1', subject: 'Dentist', start: { dateTime: `${day}T09:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${day}T10:00:00.0000000`, timeZone: 'UTC' } },
      { id: 'e2', subject: 'Gone', isCancelled: true, start: { dateTime: `${day}T11:00:00.0000000`, timeZone: 'UTC' } },
    ];
    // Expired access token: the refresh stores the new refresh token.
    store.updateSecrets((s) => { s.microsoft.accounts['ana@outlook.com'].expiry = 0; });
    const src = { id: 'c_ms', type: 'microsoft', name: 'Outlook', microsoftAccount: 'ana@outlook.com', microsoftCalendarId: 'cal-1', enabled: true, refreshMin: 5 };
    store.updateConfig((c) => { c.calendar.sources = [{ ...src, color: '#123456', emoji: '', kind: 'generic' }]; });
    const entry = await refreshSource(store.getConfig().calendar.sources[0], { force: true });
    assert.equal(entry.ok, true, entry.error);
    assert.equal(entry.count, 2);
    assert.equal(fake.tokenCalls.at(-1).get('refresh_token'), 'RT-secret-1');
    assert.equal(store.getSecrets().microsoft.accounts['ana@outlook.com'].refresh_token, 'RT-secret-2');
    const view = fake.graph.find((u) => u.pathname.endsWith('/calendarView'));
    assert.equal(view.searchParams.get('$select'), 'id,subject,bodyPreview,location,start,end,isAllDay,isCancelled,type');

    store.updateSecrets((s) => { s.microsoft.accounts['ana@outlook.com'].expiry = 0; });
    fake.refreshError = 'invalid_grant';
    const failed = await refreshSource(store.getConfig().calendar.sources[0], { force: true });
    assert.equal(failed.ok, false);
    assert.equal(failed.errorCode, 'auth_failed');
    assert.ok(!String(failed.error).includes('secret'));
  });

  test('unlink deletes only the selected account tokens', async () => {
    const { loc, sess } = await connect();
    await redirectOf(microsoftCallbackHandler, req({ session: sess, query: { state: loc.searchParams.get('state'), code: 'c' } }));
    assert.equal(store.getSecrets().microsoft.accounts['ana@outlook.com'].refresh_token, 'RT-secret-1');
    assert.equal(microsoft.removeAccount('ana@outlook.com'), true);
    assert.equal(microsoft.removeAccount('ana@outlook.com'), false);
    assert.deepEqual(store.getSecrets().microsoft.accounts, {});
  });
});

test('Graph mapping: scopes, ID token, times, all-day days, cancelled and series masters', () => {
  assert.equal(scopeGranted('https://graph.microsoft.com/Calendars.Read'), true);
  assert.equal(scopeGranted('Calendars.Read.Shared'), false);
  const base = { aud: CLIENT_ID, tid: TID, iss: `https://login.microsoftonline.com/${TID}/v2.0`, exp: Date.now() / 1000 + 60 };
  assert.equal(idTokenEmail(idToken({ ...base, email: 'Ana@Outlook.com' }), CLIENT_ID), 'ana@outlook.com');
  assert.equal(idTokenEmail(idToken({ ...base, aud: 'x', email: 'a@b.co' }), CLIENT_ID), null);
  assert.equal(graphInstant({ dateTime: '2026-10-12T08:30:00.0000000', timeZone: 'UTC' }).toISOString(), '2026-10-12T08:30:00.000Z');
  assert.equal(graphInstant({ dateTime: '2026-10-12T08:30:00', timeZone: 'Europe/Madrid' }).toISOString(), '2026-10-12T06:30:00.000Z');
  const ad = graphToRaw({ id: 'a', isAllDay: true, start: { dateTime: '2026-10-11T22:00:00.0000000' }, end: { dateTime: '2026-10-12T22:00:00.0000000' } });
  assert.deepEqual([ad.start, ad.end], ['2026-10-12', '2026-10-13']);
  assert.equal(graphToRaw({ id: 'c', isCancelled: true, start: { dateTime: '2026-10-12T08:00:00' } }), null);
  assert.equal(graphToRaw({ id: 's', type: 'seriesMaster', start: { dateTime: '2026-10-12T08:00:00' } }), null);
  assert.deepEqual(calendarItem({ id: 'x', name: 'N', color: 'lightBlue', owner: { address: 'me@x.com' } }, 'ME@x.com'), { id: 'x', name: 'N', color: '#a4c2f4' });
});
