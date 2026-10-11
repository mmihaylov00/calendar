// API tokens (hashing, auth, rate limit, bookkeeping) and the webhook API over HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import * as store from '../store.js';
import {
  createToken, listTokens, revokeToken, findToken, hashToken, checkRate, recordRejection, MAX_TOKENS, RATE_LIMIT,
  _resetTokenState, flushTokenUsage,
} from '../tokens.js';
import { hooksRouter } from '../routes/hooks.js';
import { listActivity } from '../activity.js';
import { _resetAnnouncements, listAnnouncements } from '../announce.js';
import { _resetDisplays } from '../displays.js';
import { closeAll } from '../sse.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-core-tok-'));
  store.initStore(dir);
  _resetTokenState();
  _resetAnnouncements();
  _resetDisplays();
  return dir;
}

test('tokens: format, only the sha256 hash is stored, lookup, revoke, max', () => {
  const dir = setup();
  const { token, info } = createToken('  Home   Assistant ');
  assert.match(token, /^cs_[A-Za-z0-9_-]{32}$/);
  assert.equal(info.name, 'Home Assistant');
  assert.equal(info.prefix, token.slice(0, 8));
  assert.match(info.id, /^tk_/);
  assert.equal(info.useCount, 0);
  assert.equal(info.hash, undefined);
  const disk = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.ok(!disk.includes(token), 'plain token must never be written');
  const stored = JSON.parse(disk).apiTokens[0];
  assert.equal(stored.hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.equal(stored.hash, hashToken(token));
  assert.equal((fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777).toString(8), '600');

  assert.equal(findToken(token).id, info.id);
  assert.equal(findToken(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(findToken('Bearer ' + token), null);
  assert.equal(findToken(''), null);
  assert.equal(findToken(undefined), null);

  assert.equal(createToken('').status, 400);
  assert.equal(createToken('x'.repeat(61)).status, 400);
  for (let i = listTokens().length; i < MAX_TOKENS; i++) createToken(`t${i}`);
  assert.equal(createToken('one too many').status, 409);
  assert.equal(revokeToken(info.id), true);
  assert.equal(revokeToken(info.id), false);
  assert.equal(findToken(token), null);
  const types = listActivity({ type: 'token' }).items.map((e) => e.type);
  assert.ok(types.includes('token.created') && types.includes('token.revoked'));
  assert.ok(!JSON.stringify(listActivity({ limit: 200 })).includes(token));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('secrets: failed writes roll back revocation and credentials, preserving pending counters', (t) => {
  const dir = setup();
  store.updateSecrets((s) => { s.passwordHash = 'old-password'; s.sessionEpoch = 'old-epoch'; });
  const { token, info } = createToken('Home Assistant');
  const secrets = store.getSecrets();
  const saved = fs.readFileSync(store.paths.secrets, 'utf8');
  findToken(token).useCount = 3; // usage counters are changed in place before their next flush
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === store.paths.secrets) throw Object.assign(new Error('disk unavailable'), { code: 'EIO' });
    return rename(from, to);
  });
  try {
    assert.throws(() => revokeToken(info.id), { code: 'EIO' });
    assert.equal(store.getSecrets(), secrets);
    assert.equal(findToken(token).id, info.id);
    assert.equal(findToken(token).useCount, 3);
    assert.throws(() => store.updateSecrets((s) => {
      s.passwordHash = 'failed-password';
      s.sessionEpoch = 'failed-epoch';
      s.newSecret = 'failed-secret';
    }), { code: 'EIO' });
    assert.equal(secrets.passwordHash, 'old-password');
    assert.equal(secrets.sessionEpoch, 'old-epoch');
    assert.equal(secrets.newSecret, undefined);
    assert.equal(fs.readFileSync(store.paths.secrets, 'utf8'), saved);
    assert.ok(!listActivity({ type: 'token' }).items.some((item) => item.type === 'token.revoked'));
    t.mock.restoreAll();
    assert.equal(revokeToken(info.id), true);
    assert.equal(findToken(token), null);
    assert.deepEqual(JSON.parse(fs.readFileSync(store.paths.secrets, 'utf8')).apiTokens, []);
  } finally {
    t.mock.restoreAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tokens: sliding-window rate limit and throttled rejection log', () => {
  const dir = setup();
  const t0 = 1_000_000;
  for (let i = 0; i < RATE_LIMIT; i++) assert.equal(checkRate('tk_a', t0 + i).ok, true);
  const no = checkRate('tk_a', t0 + 100);
  assert.equal(no.ok, false);
  assert.ok(no.retryAfterSec >= 1 && no.retryAfterSec <= 60);
  assert.equal(checkRate('tk_b', t0 + 100).ok, true); // per token
  assert.equal(checkRate('tk_a', t0 + 60_001).ok, true); // window slid
  assert.equal(recordRejection({ ip: '1.2.3.4', endpoint: 'ping', reason: 'missing' }, t0), true);
  assert.equal(recordRejection({ ip: '1.2.3.4', endpoint: 'ping', reason: 'missing' }, t0 + 30_000), false);
  assert.equal(recordRejection({ ip: '5.6.7.8', endpoint: 'ping', reason: 'missing' }, t0 + 30_000), true);
  assert.equal(recordRejection({ ip: '1.2.3.4', endpoint: 'ping', reason: 'missing' }, t0 + 61_000), true);
  assert.equal(listActivity({ type: 'token.rejected' }).items.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function withHooksServer(fn) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/hooks', hooksRouter());
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/hooks`;
  try {
    await fn(base);
  } finally {
    closeAll();
    await new Promise((r) => server.close(r));
  }
}

test('hooks: bearer auth, ping/announce/reload/night, usage bookkeeping, 401/415/429', async () => {
  const dir = setup();
  store.saveConfig({ ...structuredClone(store.getConfig()), screens: [...store.getConfig().screens, { name: 'Cocina' }] });
  const { token, info } = createToken('Home Assistant');
  const auth = { authorization: `Bearer ${token}` };
  const json = { 'content-type': 'application/json' };
  await withHooksServer(async (base) => {
    let r = await fetch(`${base}/ping`);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
    r = await fetch(`${base}/ping?token=${token}`);
    assert.equal(r.status, 401, 'query-string tokens are not accepted');
    r = await fetch(`${base}/ping`, { headers: { authorization: 'Bearer cs_' + 'x'.repeat(32) } });
    assert.equal(r.status, 401);
    r = await fetch(`${base}/ping`, { headers: { authorization: token } });
    assert.equal(r.status, 401, 'Bearer scheme required');

    r = await fetch(`${base}/ping`, { headers: auth });
    assert.deepEqual(await r.json(), { ok: true, token: 'Home Assistant' });

    r = await fetch(`${base}/announce`, {
      method: 'POST', headers: { ...auth, ...json },
      body: JSON.stringify({ title: 'La lavadora ha terminado 🧺', emoji: '🧺', style: 'success', durationSec: 300, sound: true, screens: ['cocina'] }),
    });
    const a = await r.json();
    assert.equal(r.status, 200);
    assert.equal(a.ok, true);
    assert.equal(a.announcement.via, 'hook');
    assert.equal(a.announcement.by, 'token:Home Assistant');
    assert.equal(a.announcement.screenIds.length, 1);
    assert.equal(a.delivered, 0);
    assert.equal(listAnnouncements().active.length, 1);

    r = await fetch(`${base}/announce`, { method: 'POST', headers: { ...auth, ...json }, body: JSON.stringify({ style: 'urgent' }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/reload`, { method: 'POST', headers: { ...auth, 'content-type': 'text/plain' }, body: 'hi' });
    assert.equal(r.status, 415);
    r = await fetch(`${base}/reload`, { method: 'POST', headers: auth });
    assert.deepEqual(await r.json(), { ok: true, delivered: 0 });
    r = await fetch(`${base}/night`, { method: 'POST', headers: { ...auth, ...json }, body: JSON.stringify({ mode: 'on', screens: ['living-room'] }) });
    assert.deepEqual(await r.json(), { ok: true, delivered: 0 });
    r = await fetch(`${base}/night`, { method: 'POST', headers: { ...auth, ...json }, body: JSON.stringify({ mode: 'disco' }) });
    assert.equal(r.status, 400);
    r = await fetch(`${base}/nope`, { headers: auth });
    assert.equal(r.status, 404);

    // usage counters + throttled token.used log (once per endpoint)
    const t = listTokens().find((x) => x.id === info.id);
    assert.equal(t.useCount, 8);
    assert.equal(t.lastUsedIp, '127.0.0.1');
    assert.ok(t.lastUsedAt);
    flushTokenUsage();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).apiTokens[0].useCount, 8);
    const used = listActivity({ type: 'token.used', limit: 200 }).items;
    assert.deepEqual(used.map((e) => e.data.endpoint).sort(), ['announce', 'night', 'nope', 'ping', 'reload']);
    assert.equal(used[0].actor, 'token:Home Assistant');
    const rejected = listActivity({ type: 'token.rejected' }).items;
    assert.equal(rejected.length, 1, 'rejections are throttled per ip');
    const sent = listActivity({ type: 'announce.sent' }).items[0];
    assert.equal(sent.actor, 'token:Home Assistant');
    assert.equal(sent.data.via, 'hook');

    // rate limit: 30/min per token
    let last;
    for (let i = 0; i < RATE_LIMIT; i++) last = await fetch(`${base}/ping`, { headers: auth });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) >= 1);

    // revoked → 401
    revokeToken(info.id);
    r = await fetch(`${base}/ping`, { headers: auth });
    assert.equal(r.status, 401);
  });
  _resetAnnouncements();
  fs.rmSync(dir, { recursive: true, force: true });
});
