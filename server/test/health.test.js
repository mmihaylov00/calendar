// Health reports the retained capabilities and never advertises removed administration features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_KEYS, healthBody, liveMode, selfHostedFeatures } from '../capabilities.js';

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) value === undefined ? delete process.env[key] : process.env[key] = value;
  try { fn(); }
  finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test('health identifies the version, live channel and only retained default features', () => {
  withEnv({ MARCO_HOME_ASSISTANT: undefined, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, MICROSOFT_CLIENT_ID: undefined, MICROSOFT_CLIENT_SECRET: undefined }, () => {
    const body = healthBody({ version: '9.9.9' });
    assert.equal(body.ok, true);
    assert.equal(body.version, '9.9.9');
    assert.equal(typeof body.uptime, 'number');
    assert.equal(body.live, 'sse');
    assert.equal(body.runtime, 'node');
    assert.equal(body.pairCodeLength, undefined);
    assert.deepEqual(Object.keys(body.features).sort(), [...FEATURE_KEYS].sort());
    const active = ['homeassistant', 'customCss', 'gallery', 'insecureTls', 'passwordLogin', 'openDisplayAccess'];
    for (const key of FEATURE_KEYS) assert.equal(body.features[key], active.includes(key), key);
  });
});

test('HA login disables standalone credential flows and every removed feature', () => {
  withEnv({ MARCO_HOME_ASSISTANT: '1', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 'secret' }, () => {
    const features = selfHostedFeatures();
    const active = ['homeassistant', 'customCss', 'gallery', 'insecureTls'];
    for (const key of FEATURE_KEYS) assert.equal(features[key], active.includes(key), key);
  });
});

test('legacy poll mode cannot enable the removed polling channel', () => {
  assert.equal(liveMode({ MARCO_LIVE: 'poll' }), 'sse');
  assert.equal(healthBody({ version: '1', env: { MARCO_LIVE: 'poll' } }).live, 'sse');
});
