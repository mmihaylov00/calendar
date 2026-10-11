import { SINGULAR } from './i18n-plural';

export const getLang = () => 'en' as const;
export const locale = () => 'en-GB';

/** Interpolate placeholders and use the singular form for a count of one. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = vars && Number(vars.n) === 1 ? SINGULAR[key] ?? key : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

export function relTime(iso: string | number | null | undefined): string {
  if (iso == null || iso === '') return '–';
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return '–';
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '–';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

/** "1 screen" / "3 screens" */
export const nScreens = (n: number) => (n === 1 ? t('1 screen') : t('{n} screens', { n }));
