import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, LAYOUT_PRESETS } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';

test('saved calendar layout preferences, including legacy presets, survive validation and projection', () => {
  for (const preset of LAYOUT_PRESETS) {
    const config = defaultConfig();
    config.screens[0].layout.preset = preset;
    const result = validateConfig(config);
    assert.equal(result.ok, true, `${preset}: ${JSON.stringify(result.errors)}`);
    assert.equal(displayConfig(result.value, result.value.screens[0]).layout.preset, preset);
  }
});

test('unknown layouts produce a validation error and normalize to the calendar', () => {
  for (const preset of ['Today', 'kitchen', '', 3, null]) {
    const config = defaultConfig();
    config.screens[0].layout.preset = preset;
    const result = validateConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.path === 'screens[0].layout.preset'));
    assert.equal(result.value.screens[0].layout.preset, 'bigCalendar');
  }
});

test('older calendar profiles backfill missing layout options without replacing their chosen preset', () => {
  const config = defaultConfig();
  config.screens[0].layout.preset = 'people';
  delete config.screens[0].layout.people;
  delete config.screens[0].layout.corner;
  const result = validateConfig(config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.screens[0].layout, { ...defaultScreenProfile().layout, preset: 'people' });
});

test('calendar columns reject malformed selections and deduplicate valid IDs', () => {
  const config = defaultConfig();
  config.screens[0].layout.people = ['a', 'b', 'b'];
  let result = validateConfig(config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.screens[0].layout.people, ['a', 'b']);

  config.screens[0].layout.people = ['a', 'b', 'c', 'd', 'e', 'f'];
  result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.path === 'screens[0].layout.people'));

  config.screens[0].layout.people = 'a';
  result = validateConfig(config);
  assert.equal(result.ok, false);
  assert.deepEqual(result.value.screens[0].layout.people, []);
});
