// Second-aligned ticker shared by every time-dependent widget.
import { dateKeyInTz, zonedParts, type ZonedParts } from '../shared/i18n';

export interface Tick {
  now: Date;
  parts: ZonedParts;
  dayKey: string;
  minuteChanged: boolean;
  dayChanged: boolean;
}

type TickFn = (t: Tick) => void;
const subs = new Set<TickFn>();
let tz = 'Europe/Sofia';
let lastMinute = -1;
let lastDay = '';
let timer: ReturnType<typeof setTimeout> | null = null;
let visBound = false;

export const now = () => new Date();

export function setTimezone(z: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    tz = z;
  } catch {
    tz = 'Europe/Sofia';
  }
  lastDay = '';
}
export const getTimezone = () => tz;

export function current(): Tick {
  const n = now();
  const parts = zonedParts(n, tz);
  return { now: n, parts, dayKey: dateKeyInTz(n, tz), minuteChanged: false, dayChanged: false };
}

export function onTick(fn: TickFn): void {
  subs.add(fn);
}

function fire() {
  const t = current();
  const m = t.parts.hour * 60 + t.parts.minute;
  t.minuteChanged = m !== lastMinute;
  t.dayChanged = lastDay !== '' && t.dayKey !== lastDay;
  lastMinute = m;
  lastDay = t.dayKey;
  for (const fn of subs) {
    try {
      fn(t);
    } catch (e) {
      console.error('[tick]', e);
    }
  }
}

export function startTicker(): void {
  if (timer) return;
  const loop = () => {
    fire();
    const ms = now().getTime();
    timer = setTimeout(loop, 1000 - (ms % 1000) + 4);
  };
  loop();
  if (visBound) return;
  visBound = true;
  // Wake-up after the tab was hidden / the Pi resumed: re-sync immediately.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && timer) {
      clearTimeout(timer);
      timer = null;
      startTicker();
    }
  });
}
