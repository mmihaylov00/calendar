import { addDays, dateKeyInTz, keyToUTC, utcToKey, zonedParts } from '../shared/i18n';
import { eventsOnDay, type NEvent, sortForDay } from './eventModel';

export function selectedDayKey(value: string | undefined, today: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && utcToKey(keyToUTC(value)) === value ? value : today;
}

/** First instant of a local date; elapsed hours across this boundary include DST changes. */
function dayStart(key: string, tz: string): number {
  const utc = keyToUTC(key).getTime();
  let lo = utc - 48 * 3600_000, hi = utc + 48 * 3600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dateKeyInTz(new Date(mid), tz) < key) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Events and chronological minute positions within one real local day (23, 24 or 25 hours). */
export function dayTimeline(events: NEvent[], key: string, tz: string) {
  const start = dayStart(key, tz), end = dayStart(addDays(key, 1), tz);
  const minutes = (ms: number) => (ms - start) / 60000;
  const allDay = eventsOnDay(events, key, true).filter((e) => e.allDay || e.airbnb).sort(sortForDay);
  const timed = events
    .filter((e) => !e.allDay && !e.airbnb && Math.max(e.endMs, e.startMs + 1) > start && e.startMs < end)
    .sort((a, b) => a.startMs - b.startMs || a.title.localeCompare(b.title))
    .map((e) => ({ e, a: minutes(Math.max(start, e.startMs)), b: minutes(Math.min(end, e.endMs)) }));
  const duration = minutes(end);
  // Default 07:00–22:00 window, located by local clock labels instead of assuming a 24-hour day.
  const atHour = (hour: number) => {
    for (let m = 0; m < duration; m += 30) {
      const p = zonedParts(new Date(start + m * 60000), tz);
      if (p.hour >= hour) return m;
    }
    return duration;
  };
  return { start, end, duration, allDay, timed, morning: atHour(7), evening: atHour(22) };
}
