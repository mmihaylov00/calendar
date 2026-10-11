// Date helpers for the admin (all "YYYY-MM-DD" strings are calendar dates in the configured timezone).
import type { Birthday, CalEvent } from '../shared/types';
import { locale, t } from './i18n';

/** Today's date (YYYY-MM-DD) in a timezone (falls back to the browser's). */
export function todayIn(tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
}

const toUTC = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (iso: string, n: number) => new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
/** 0 = Sunday */
export const weekdayOf = (iso: string) => new Date(toUTC(iso)).getUTCDay();

/** Localized short weekday names indexed 0 = Sunday. */
export function weekdayNames(style: 'short' | 'narrow' | 'long' = 'short'): string[] {
  const f = new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' });
  // 2023-01-01 was a Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const s = f.format(new Date(Date.UTC(2023, 0, 1 + i))).replace('.', '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}

export function monthNames(style: 'short' | 'long' = 'long'): string[] {
  const f = new Intl.DateTimeFormat(locale(), { month: style, timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2023, i, 1))).replace('.', ''));
}

/** "vie, 9 oct" (adds the year when it differs from this year). */
export function fmtDay(iso: string, opts: { weekday?: boolean; year?: boolean | 'auto' } = {}): string {
  if (!iso) return '';
  const d = new Date(toUTC(iso));
  const thisYear = new Date().getFullYear();
  const showYear = opts.year === true || ((opts.year ?? 'auto') === 'auto' && d.getUTCFullYear() !== thisYear);
  return new Intl.DateTimeFormat(locale(), {
    weekday: opts.weekday === false ? undefined : 'short',
    day: 'numeric',
    month: 'short',
    year: showYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  })
    .format(d)
    .replace(/\./g, '');
}

/** Localized date + time of an ISO timestamp ("9 oct, 14:05"). */
export function fmtDateTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
  })
    .format(d)
    .replace(/\./g, '');
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(d);
}

/** "Hoy" / "Mañana" / "En 3 días" / "Hace 2 días". */
export function relDays(n: number): string {
  if (n === 0) return t('Today');
  if (n === 1) return t('Tomorrow');
  if (n === -1) return t('Yesterday');
  if (n > 0) return t('In {n} days', { n });
  return t('{n} days ago', { n: -n });
}

/** Next occurrence (≥ today) of a birthday; 29/02 → 28/02 on non-leap years. */
export function nextBirthday(b: Pick<Birthday, 'month' | 'day' | 'year'>, today: string): { date: string; days: number; age: number | null } {
  const ty = Number(today.slice(0, 4));
  const occ = (y: number) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const day = b.month === 2 && b.day === 29 && !leap ? 28 : b.day;
    return `${y}-${String(b.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  let y = ty;
  let date = occ(y);
  if (date < today) date = occ(++y);
  const age = b.year != null && y - b.year >= 0 ? y - b.year : null;
  return { date, days: daysBetween(today, date), age };
}

/** Start date (YYYY-MM-DD) of an event in local terms. */
export const eventDay = (e: CalEvent) => e.start.slice(0, 10);

/** "14:00–15:30" or "Todo el día" for an event. */
export function eventTimeLabel(e: CalEvent): string {
  if (e.allDay) return t('All day');
  const s = e.start.slice(11, 16);
  const en = e.end.slice(11, 16);
  return en && en !== s ? `${s}–${en}` : s;
}

/** Day + month label "25/12" */
export const dm = (day: number, month: number) => `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
