import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

const [events, dom] = await loadWebModules('/web/display/eventModel.ts', '/web/display/dom.ts');

test('event window keeps an open Sunday after the live calendar rolls to Monday', () => {
  assert.deepEqual(events.calendarEventRange('2026-10-12', 1, 4), ['2026-10-12', '2026-11-10']);
  assert.deepEqual(events.calendarEventRange('2026-10-12', 1, 4, '2026-10-11'), ['2026-10-11', '2026-11-10']);
  assert.deepEqual(events.calendarEventRange('2026-10-19', 1, 4, '2026-10-11'), ['2026-10-11', '2026-11-17']);
});

test('selected dates extend the event window without dropping normal calendar events', () => {
  assert.deepEqual(events.calendarEventRange('2026-10-12', 0, 1, '2026-11-05'), ['2026-10-11', '2026-11-06']);
  assert.deepEqual(events.calendarEventRange('2026-12-31', 1, 6, '2027-01-03'), ['2026-12-28', '2027-02-09']);
});

test('view animations respect both reduced-motion preference and lite mode', () => {
  const before = { document: globalThis.document, window: globalThis.window };
  let lite = false;
  let reduced = false;
  globalThis.document = { documentElement: { classList: { contains: () => lite } } };
  globalThis.window = { matchMedia: () => ({ matches: reduced }) };
  try {
    assert.equal(dom.reducedMotion(), false);
    reduced = true;
    assert.equal(dom.reducedMotion(), true);
    reduced = false;
    lite = true;
    assert.equal(dom.reducedMotion(), true);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
