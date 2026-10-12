import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWebModules } from './webModules.js';

const TZ = 'Europe/Sofia';
const raw = (id, start, end, allDay = false) => ({ id, sourceId: 'c_work', title: id, start, end, allDay, kind: 'generic', color: '#4c8dff', multiDay: false });

async function withDisplay(fn) {
  const keys = ['location', 'document', 'getComputedStyle'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperty(globalThis, 'location', { value: new URL('http://localhost/'), configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { documentElement: {} }, configurable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: () => ({ fontSize: '10px' }), configurable: true });
  try {
    const [day, model, context, view, dates] = await loadWebModules('/web/display/dayTimeline.ts', '/web/display/eventModel.ts', '/web/display/ctx.ts', '/web/display/widgets/views.ts', '/web/shared/i18n.ts');
    const cfg = structuredClone(context.ctx.cfg);
    cfg.datetime.timezone = TZ;
    cfg.calendar.sources = [{ id: 'c_work', name: 'Work', color: '#4c8dff', emoji: '', kind: 'generic' }];
    context.setCtxConfig(cfg);
    const tick = (iso) => {
      const now = new Date(iso);
      return { now, parts: dates.zonedParts(now, TZ), dayKey: dates.dateKeyInTz(now, TZ), minuteChanged: true, dayChanged: false };
    };
    await fn({ day, model, view, tick, context });
  } finally {
    for (const k of keys) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
}

function root() {
  const nodes = new Map();
  for (const name of ['td-title', 'td-allday', 'td-next', 'td-grid', 'td-evs', 'td-now', 'pp-shared', 'pp-cols']) {
    nodes.set(`.${name}`, { innerHTML: '', style: {}, children: [], clientHeight: 600, firstElementChild: { textContent: '' }, getBoundingClientRect: () => ({ left: 0, right: 1000 }) });
  }
  return {
    style: { setProperty() {} }, classList: { toggle() {} },
    querySelector: (sel) => nodes.get(sel), querySelectorAll: () => [],
  };
}

test('selected date validation and event filtering use the configured calendar date', async () => {
  await withDisplay(({ day, model }) => {
    assert.equal(day.selectedDayKey('2026-10-15', '2026-10-12'), '2026-10-15');
    assert.equal(day.selectedDayKey('2026-02-30', '2026-10-12'), '2026-10-12');
    assert.equal(day.selectedDayKey('invalid', '2026-10-12'), '2026-10-12');
    const events = model.normalizeEvents([raw('UTC-previous-day', '2026-10-14T22:30:00Z', '2026-10-14T23:15:00Z')], TZ);
    assert.equal(day.dayTimeline(events, '2026-10-14', TZ).timed.length, 0);
    const selected = day.dayTimeline(events, '2026-10-15', TZ);
    assert.equal(selected.timed[0].e.title, 'UTC-previous-day');
    assert.equal(selected.timed[0].a, 90);
    assert.equal(selected.timed[0].b, 135);
  });
});

test('overnight timed events clip into each day and exclusive midnight ends do not spill', async () => {
  await withDisplay(({ day, model }) => {
    const events = model.normalizeEvents([
      raw('Overnight', '2026-10-15T23:30:00+03:00', '2026-10-16T01:15:00+03:00'),
      raw('Ends at midnight', '2026-10-15T23:00:00+03:00', '2026-10-16T00:00:00+03:00'),
      raw('All-day trip', '2026-10-13', '2026-10-16', true),
    ], TZ);
    const first = day.dayTimeline(events, '2026-10-15', TZ);
    assert.deepEqual(first.timed.map(({ e, a, b }) => [e.title, a, b]), [['Ends at midnight', 1380, 1440], ['Overnight', 1410, 1440]]);
    assert.deepEqual(first.allDay.map((e) => e.title), ['All-day trip']);
    const second = day.dayTimeline(events, '2026-10-16', TZ);
    assert.deepEqual(second.timed.map(({ e, a, b }) => [e.title, a, b]), [['Overnight', 0, 75]]);
    assert.deepEqual(second.allDay, []);
  });
});

test('DST dates retain actual durations, including repeated-hour events and spring overnight clipping', async () => {
  await withDisplay(({ day, model }) => {
    const repeated = model.normalizeEvents([raw('Repeated hour', '2026-10-25T03:30:00+03:00', '2026-10-25T03:15:00+02:00')], TZ);
    const fall = day.dayTimeline(repeated, '2026-10-25', TZ);
    assert.equal(fall.duration, 25 * 60);
    assert.equal(fall.morning, 8 * 60);
    assert.equal(fall.evening, 23 * 60);
    assert.deepEqual(fall.timed.map(({ a, b }) => [a, b]), [[210, 255]]);
    const overnight = model.normalizeEvents([raw('Spring overnight', '2026-03-28T23:30:00+02:00', '2026-03-29T04:30:00+03:00')], TZ);
    const spring = day.dayTimeline(overnight, '2026-03-29', TZ);
    assert.equal(spring.duration, 23 * 60);
    assert.equal(spring.morning, 6 * 60);
    assert.equal(spring.evening, 21 * 60);
    assert.deepEqual(spring.timed.map(({ a, b }) => [a, b]), [[0, 210]]);
    assert.ok(spring.timed.every(({ a, b }) => a >= 0 && b > a && b <= spring.duration));
  });
});

test('day view renders the selected events without today state and returns to the real today view', async () => {
  await withDisplay(({ model, view, tick, context }) => {
    const node = root();
    const views = new view.Views(node);
    views.setPreset('today');
    const data = { events: model.normalizeEvents([
      raw('Next today', '2026-10-12T11:00:00+03:00', '2026-10-12T12:00:00+03:00'),
      raw('Selected meeting', '2026-10-13T08:00:00+03:00', '2026-10-13T09:00:00+03:00'),
      raw('Selected all-day', '2026-10-13', '2026-10-14', true),
    ], TZ) };
    const now = tick('2026-10-12T10:00:00+03:00');
    views.render(data, now, '2026-10-13');
    assert.match(node.querySelector('.td-title').innerHTML, /13 October/);
    assert.doesNotMatch(node.querySelector('.td-title').innerHTML, /Today/);
    assert.match(node.querySelector('.td-allday').innerHTML, /Selected all-day/);
    assert.match(node.querySelector('.td-evs').innerHTML, /Selected meeting/);
    assert.doesNotMatch(node.querySelector('.td-evs').innerHTML, /Next today| past| ongoing/);
    assert.equal(node.querySelector('.td-next').style.display, 'none');
    assert.equal(node.querySelector('.td-now').style.display, 'none');
    assert.doesNotMatch(node.querySelector('.td-grid').innerHTML, / past/);

    views.render(data, now, '2026-10-14');
    assert.match(node.querySelector('.td-next').innerHTML, /Nothing planned/);
    assert.equal(node.querySelector('.td-evs').innerHTML, '');
    views.render(data, now);
    assert.match(node.querySelector('.td-title').innerHTML, /Today/);
    assert.match(node.querySelector('.td-next').innerHTML, /Up next[\s\S]*Next today/);
    assert.equal(node.querySelector('.td-now').style.display, '');
    assert.equal(node.querySelector('.td-now').firstElementChild.textContent, '10:00');
    context.ctx.cfg.datetime.format24 = false;
    context.ctx.cfg.datetime.showAmPm = false;
    views.render(data, now);
    assert.match(node.querySelector('.td-grid').innerHTML, /7 AM/);
    assert.match(node.querySelector('.td-grid').innerHTML, /10 PM/);
  });
});

test('date selection leaves the People layout unchanged', async () => {
  await withDisplay(({ model, view, tick }) => {
    const node = root();
    const views = new view.Views(node);
    views.setPreset('people');
    const data = { events: model.normalizeEvents([raw('Tomorrow meeting', '2026-10-13T08:00:00+03:00', '2026-10-13T09:00:00+03:00')], TZ) };
    const now = tick('2026-10-12T10:00:00+03:00');
    views.render(data, now);
    const columns = node.querySelector('.pp-cols').innerHTML;
    views.render(data, now, '2026-10-18');
    assert.equal(node.querySelector('.pp-cols').innerHTML, columns);
  });
});

test('Today next card includes overnight events that continue after midnight', async () => {
  await withDisplay(({ model, view, tick }) => {
    const node = root();
    const views = new view.Views(node);
    views.setPreset('today');
    const data = { events: model.normalizeEvents([raw('Overnight meeting', '2026-10-15T23:30:00+03:00', '2026-10-16T01:15:00+03:00')], TZ) };
    views.render(data, tick('2026-10-16T00:30:00+03:00'));
    assert.match(node.querySelector('.td-next').innerHTML, /is-now/);
    assert.match(node.querySelector('.td-next').innerHTML, /Now · until 01:15[\s\S]*Overnight meeting/);
    assert.doesNotMatch(node.querySelector('.td-next').innerHTML, /Nothing else today|Tomorrow/);
    assert.match(node.querySelector('.td-evs').innerHTML, /ongoing[\s\S]*Overnight meeting/);
    views.render(data, tick('2026-10-14T23:30:00+03:00'));
    assert.match(node.querySelector('.td-next').innerHTML, /Tomorrow[\s\S]*Overnight meeting/);
  });
});
