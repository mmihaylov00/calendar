import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

const [model] = await loadWebModules('/web/display/eventModel.ts');
const tz = 'Europe/Sofia';
const event = (start, end = start, allDay = false) => model.normalizeEvents([
  { id: 'meeting', title: 'Meeting', sourceId: 'work', start, end, allDay },
], tz)[0];

test('calendar event times show padded hours and minutes in the display timezone', () => {
  for (const time of ['00:00', '07:00', '19:00', '19:30']) {
    const e = event(`2026-10-21T${time}:00+03:00`);
    assert.equal(model.timeLabel(e, tz, true, false, false), time);
  }
  const e = event('2026-10-21T04:00:00Z', '2026-10-21T05:00:00Z');
  assert.equal(model.timeLabel(e, tz, true, false, true), '07:00–08:00');
  assert.equal(model.timeLabel(event('2026-10-21', '2026-10-22', true), tz, true, false, false), '');
});

test('calendar event times retain the chosen 12-hour and AM/PM format', () => {
  const morning = event('2026-10-21T07:00:00+03:00');
  const evening = event('2026-10-21T19:00:00+03:00');
  assert.equal(model.timeLabel(morning, tz, false, false, false), '7:00');
  assert.equal(model.timeLabel(morning, tz, false, true, false), '7:00 AM');
  assert.equal(model.timeLabel(evening, tz, false, true, false), '7:00 PM');
});
