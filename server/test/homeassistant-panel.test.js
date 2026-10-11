import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Home Assistant panel authorization and safe installation', () => {
  const suite = fileURLToPath(new URL('../../home-assistant/test-panel.py', import.meta.url));
  execFileSync('python3', [suite], { encoding: 'utf8', stdio: 'pipe' });
});

test('Home Assistant app uses private admin ingress and matches the panel version', () => {
  const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const config = read('config.yaml');
  for (const setting of ['ingress: true', 'ingress_port: 3000', 'ingress_entry: admin/', 'ingress_stream: true', 'panel_admin: true', 'homeassistant_api: true']) {
    assert.ok(config.includes(setting), setting);
  }
  assert.doesNotMatch(config, /^ports:|^webui:|^host_network:/m);
  assert.ok(config.includes(`version: "${JSON.parse(read('package.json')).version}"`));
  assert.equal(JSON.parse(read('home-assistant/custom_components/marco/manifest.json')).version, JSON.parse(read('package.json')).version);
});
