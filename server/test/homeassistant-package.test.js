import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeAssistantEnvironment } from '../../deploy/start-container.js';

test('Home Assistant options map only supported settings and keep OAuth secrets intact', () => {
  assert.deepEqual(homeAssistantEnvironment({
    public_url: 'https://calendar.example.com/',
    google_client_id: 'example.apps.googleusercontent.com',
    google_client_secret: 'example-secret',
    trust_proxy: '172.30.32.1',
    DATA_DIR: '/etc',
    MARCO_UPDATE_CHECK: '1',
  }), {
    PUBLIC_URL: 'https://calendar.example.com',
    GOOGLE_CLIENT_ID: 'example.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'example-secret',
    TRUST_PROXY: '172.30.32.1',
  });
  assert.deepEqual(homeAssistantEnvironment({ public_url: '', google_client_secret: '' }), { PUBLIC_URL: '', GOOGLE_CLIENT_SECRET: '' });
});

test('Home Assistant options reject invalid values before the server starts', () => {
  for (const options of [null, [], { google_client_secret: 123 }]) {
    assert.throws(() => homeAssistantEnvironment(options), /options|must be a string/);
  }
  for (const public_url of ['invalid', 'ftp://calendar.example.com', 'https://user:pass@calendar.example.com', 'https://calendar.example.com/admin/', 'https://calendar.example.com/?key=secret']) {
    assert.throws(() => homeAssistantEnvironment({ public_url }), /public_url/);
  }
});
