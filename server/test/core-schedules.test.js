// scheduled messages algorithm (docs/ARCHITECTURE.md), Europe/Lisbon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleState, schedulesNow, dayOk, localInstant } from '../core/schedules.js';
import { defaultConfig } from '../core/defaults.js';

const TZ = 'Europe/Lisbon';
const msg = (o) => ({ id: 'm_1', enabled: true, title: '🗑️ Sacar la basura', body: '', emoji: '🗑️', style: 'info', days: [], from: '20:00', to: '22:00', startDate: null, endDate: null, screenIds: [], sound: false, ...o });
// Lisbon is UTC+1 in summer (WEST) and UTC+0 in winter (WET).
const at = (iso) => new Date(iso);

test('same-day window: [from, to) on allowed weekdays', () => {
  const m = msg({ days: [2, 5] }); // Tue + Fri
  // 2026-10-09 is a Friday; 20:30 WEST = 19:30Z
  assert.deepEqual(scheduleState(m, at('2026-10-09T19:30:00Z'), TZ), { active: true, until: '2026-10-09T22:00:00+01:00' });
  assert.equal(scheduleState(m, at('2026-10-09T18:59:00Z'), TZ).active, false); // 19:59 local
  assert.equal(scheduleState(m, at('2026-10-09T19:00:00Z'), TZ).active, true); // 20:00 local inclusive
  assert.equal(scheduleState(m, at('2026-10-09T21:00:00Z'), TZ).active, false); // 22:00 local exclusive
  assert.equal(scheduleState(m, at('2026-10-08T19:30:00Z'), TZ).active, false); // Thursday
  assert.equal(scheduleState(m, at('2026-10-13T19:30:00Z'), TZ).active, true); // Tuesday
  assert.equal(scheduleState({ ...m, enabled: false }, at('2026-10-09T19:30:00Z'), TZ).active, false);
});

test('window crossing midnight: the day refers to the start of the window', () => {
  const m = msg({ from: '22:00', to: '06:00', days: [5] }); // Friday night → Saturday morning
  // Friday 23:00 local → ends Saturday 06:00
  assert.deepEqual(scheduleState(m, at('2026-10-09T22:00:00Z'), TZ), { active: true, until: '2026-10-10T06:00:00+01:00' });
  // Saturday 05:59 local → still active (started Friday), ends today
  assert.deepEqual(scheduleState(m, at('2026-10-10T04:59:00Z'), TZ), { active: true, until: '2026-10-10T06:00:00+01:00' });
  // Saturday 06:00 local → over
  assert.equal(scheduleState(m, at('2026-10-10T05:00:00Z'), TZ).active, false);
  // Saturday 23:00 → Saturday not allowed
  assert.equal(scheduleState(m, at('2026-10-10T22:00:00Z'), TZ).active, false);
  // Friday 03:00 local → would belong to Thursday's window → not active
  assert.equal(scheduleState(m, at('2026-10-09T02:00:00Z'), TZ).active, false);
});

test('startDate/endDate bound the start day (yesterday counts for the after-midnight part)', () => {
  const m = msg({ from: '23:00', to: '01:00', startDate: '2026-10-09', endDate: '2026-10-09' });
  assert.equal(scheduleState(m, at('2026-10-08T22:30:00Z'), TZ).active, false); // 08/10 23:30 local: before start
  assert.equal(scheduleState(m, at('2026-10-09T22:30:00Z'), TZ).active, true); // 09/10 23:30
  assert.equal(scheduleState(m, at('2026-10-09T23:30:00Z'), TZ).active, true); // 10/10 00:30 (window of 09/10)
  assert.equal(scheduleState(m, at('2026-10-10T22:30:00Z'), TZ).active, false); // 10/10 23:30: after end
  assert.equal(dayOk(m, '2026-10-09'), true);
  assert.equal(dayOk(m, '2026-10-10'), false);
});

test('DST: local wall time is used across the October change (WEST → WET)', () => {
  // 2026-10-25: clocks go back at 02:00 WEST → 01:00 WET. 20:30 WET = 20:30Z.
  const m = msg({});
  assert.deepEqual(scheduleState(m, at('2026-10-25T20:30:00Z'), TZ), { active: true, until: '2026-10-25T22:00:00+00:00' });
  assert.equal(scheduleState(m, at('2026-10-25T19:30:00Z'), TZ).active, false); // 19:30 WET
  assert.equal(localInstant('2026-10-26', '06:00', TZ), '2026-10-26T06:00:00+00:00');
  assert.equal(localInstant('2026-03-29', '12:00', TZ), '2026-03-29T12:00:00+01:00');
});

test('schedulesNow lists active messages with their end time', () => {
  const cfg = defaultConfig();
  cfg.datetime.timezone = TZ;
  cfg.schedules.items = [
    msg({ id: 'm_a', days: [5] }),
    msg({ id: 'm_b', from: '08:00', to: '09:00' }),
    msg({ id: 'm_c', enabled: false }),
    msg({ id: 'm_d', screenIds: ['s_main'], from: '19:00', to: '23:59' }),
  ];
  const now = schedulesNow(cfg, at('2026-10-09T19:30:00Z'));
  assert.deepEqual(now.map((x) => x.id), ['m_a', 'm_d']);
  assert.deepEqual(Object.keys(now[0]).sort(), ['emoji', 'id', 'screenIds', 'title', 'until']);
  assert.deepEqual(now[1].screenIds, ['s_main']);
});
