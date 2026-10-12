// Normalises API events into calendar-day coordinates in the configured timezone.
import type { CalEvent } from '../shared/types';
import { addDays, dateKeyInTz, diffDays, formatTime, startOfWeek, zonedParts } from '../shared/i18n';

export interface NEvent {
  ev: CalEvent;
  id: string;
  title: string;
  emoji: string;
  color: string;
  allDay: boolean;
  startMs: number;
  endMs: number;
  /** first calendar day (inclusive) */
  startKey: string;
  /** last calendar day the event covers (inclusive) */
  lastKey: string;
  /** grid occupancy (airbnb: check-in afternoon → check-out morning) */
  spanFirst: string;
  spanLast: string;
  halfStart: boolean;
  halfEnd: boolean;
  /** number of days (or nights for airbnb) */
  days: number;
  airbnb: boolean;
  /** one-day departure marker of an airbnb-kind feed (rendered as a plain chip) */
  checkoutMarker: boolean;
  /** single-day timed event */
  timed: boolean;
  bar: boolean;
}

function msOf(s: string, tzKeyFallback: boolean): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + (tzKeyFallback ? 'T00:00:00' : 'T00:00:00Z'));
  const v = Date.parse(s);
  return Number.isFinite(v) ? v : 0;
}

/** Title as rendered everywhere: birthdays with a known age → "María (34)" (docs/ARCHITECTURE.md). */
export function displayTitle(ev: Pick<CalEvent, 'title' | 'age'>): string {
  const t = (ev.title || '').trim() || '–';
  const age = ev.age;
  return typeof age === 'number' && Number.isFinite(age) && age >= 0 ? `${t} (${Math.round(age)})` : t;
}

export function normalizeEvents(list: CalEvent[], tz: string): NEvent[] {
  const out: NEvent[] = [];
  for (const ev of list || []) {
    if (!ev || !ev.start) continue;
    try {
      let startKey: string, lastKey: string, endKeyExcl: string;
      const startMs = msOf(ev.start, true);
      let endMs = ev.end ? msOf(ev.end, true) : startMs;
      if (ev.allDay) {
        startKey = ev.start.slice(0, 10);
        endKeyExcl = ev.end ? ev.end.slice(0, 10) : addDays(startKey, 1);
        if (endKeyExcl <= startKey) endKeyExcl = addDays(startKey, 1);
        lastKey = addDays(endKeyExcl, -1);
      } else {
        startKey = dateKeyInTz(new Date(startMs), tz);
        if (endMs < startMs) endMs = startMs;
        const lastInstant = endMs > startMs ? endMs - 1 : startMs;
        lastKey = dateKeyInTz(new Date(lastInstant), tz);
        endKeyExcl = dateKeyInTz(new Date(endMs), tz);
      }
      const airbnb = ev.kind === 'airbnb';
      // One-day "🚪 Guest" events some feeds add on the checkout day are departure markers, not 1-night stays.
      const checkoutMarker = airbnb && !ev.multiDay && lastKey === startKey &&
        (ev.emoji === '🚪' || /check[- ]?out|salida|sa[ií]da/i.test(ev.title || ''));
      let spanFirst = startKey, spanLast = lastKey, halfStart = false, halfEnd = false;
      let days = diffDays(startKey, lastKey) + 1;
      if (airbnb && !checkoutMarker) {
        const checkout = ev.allDay ? endKeyExcl : dateKeyInTz(new Date(endMs), tz);
        if (checkout > startKey) {
          spanLast = checkout;
          halfStart = halfEnd = true;
          days = diffDays(startKey, checkout); // nights
        }
      }
      const multi = spanFirst !== spanLast;
      out.push({
        ev, id: ev.id, title: displayTitle(ev), emoji: ev.emoji || '', color: ev.color || '#4c8dff',
        allDay: !!ev.allDay, startMs, endMs, startKey, lastKey, spanFirst, spanLast, halfStart, halfEnd, days, airbnb, checkoutMarker,
        timed: !ev.allDay && !multi, bar: ev.allDay || multi,
      });
    } catch (e) {
      console.warn('bad event', ev, e);
    }
  }
  // Drop "🚪 Guest" departure markers when a stay of the same guest (same source) already ends that day:
  // the stay bar's 🚪 end cap shows the checkout, so the marker would be a duplicate.
  const guestOf = (e: NEvent) => e.title.split(' · ')[0].trim().toLowerCase();
  const stayEnds = new Set(out.filter((e) => e.airbnb && !e.checkoutMarker && e.halfEnd)
    .map((e) => `${e.ev.sourceId}|${e.spanLast}|${guestOf(e)}`));
  return out.filter((e) => !(e.checkoutMarker && stayEnds.has(`${e.ev.sourceId}|${e.startKey}|${guestOf(e)}`)));
}

/** Events covering a given day (by grid occupancy). */
export function eventsOnDay(list: NEvent[], key: string, useSpan = false): NEvent[] {
  return list.filter((e) => (useSpan ? e.spanFirst <= key && e.spanLast >= key : e.startKey <= key && e.lastKey >= key));
}

/** Keep an open day's data when the live calendar advances to the next week. */
export function calendarEventRange(today: string, weekStart: number, weeks: number, selectedDay: string | null = null): [string, string] {
  let from = startOfWeek(today, weekStart);
  let to = addDays(from, Math.max(weeks * 7, 21) + 1);
  if (selectedDay) {
    if (selectedDay < from) from = selectedDay;
    const end = addDays(selectedDay, 1);
    if (end > to) to = end;
  }
  return [from, to];
}

export function sortForDay(a: NEvent, b: NEvent): number {
  if (a.bar !== b.bar) return a.bar ? -1 : 1;
  if (a.bar && b.bar) {
    if (a.spanFirst !== b.spanFirst) return a.spanFirst < b.spanFirst ? -1 : 1;
    const la = diffDays(a.spanFirst, a.spanLast), lb = diffDays(b.spanFirst, b.spanLast);
    if (la !== lb) return lb - la;
  }
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  return a.title.localeCompare(b.title);
}

/** Compact time for small chips: "18h" for full hours in 24 h mode, else "18:30". */
export function compactTime(ms: number, tz: string, f24: boolean, ampm: boolean): string {
  const p = zonedParts(new Date(ms), tz);
  if (f24 && p.minute === 0) return `${p.hour}h`;
  return formatTime(new Date(ms), tz, f24, ampm);
}

export function timeLabel(e: NEvent, tz: string, f24: boolean, ampm: boolean, withEnd: boolean, compact = false): string {
  if (e.allDay) return '';
  const s = compact && !withEnd ? compactTime(e.startMs, tz, f24, ampm) : formatTime(new Date(e.startMs), tz, f24, ampm);
  if (!withEnd || e.endMs <= e.startMs) return s;
  return `${s}–${formatTime(new Date(e.endMs), tz, f24, ampm)}`;
}
