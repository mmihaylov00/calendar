import { projectScreen, SLUG_RE } from '../shared/screens';
import { locale } from './i18n';
import type { AppConfig, CalendarSource, IconRule, SourceKind, StoredConfig } from '../shared/types';
import { findKeyword } from '../../server/lib/keywords.js';
import { caps as currentCaps, hasFeature, limitOf, type Caps, type LimitName } from './caps';

export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 7)}`;

export const clone = <T,>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

/** Immer-lite: clone then mutate. Config is small, so this is cheap enough. */
export function produce<T>(base: T, fn: (draft: T) => void): T {
  const d = clone(base);
  fn(d);
  return d;
}

export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (to < 0 || to >= out.length || from === to) return out;
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

/** Case- and accent-insensitive normalisation (same rule the server applies). */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** First icon rule matching `text`, same rule as the server (short keywords match whole words only). */
export function matchIconRule(rules: IconRule[], text: string): { rule: IconRule; keyword: string; index: number } | null {
  return findKeyword(rules, text);
}

export const KIND_EMOJI: Record<SourceKind, string> = { generic: '', airbnb: '🏠', birthdays: '🎂', holidays: '🎉' };

export function resolveEmoji(rules: IconRule[], source: CalendarSource | undefined, text: string): string {
  const m = matchIconRule(rules, text);
  if (m?.rule.emoji) return m.rule.emoji;
  if (source?.emoji) return source.emoji;
  if (source) return KIND_EMOJI[source.kind] || '';
  return '';
}

export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isHttpUrl(s: string, allowWebcal = false): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' || (allowWebcal && u.protocol === 'webcal:');
  } catch {
    return false;
  }
}

/** Public holiday iCal feeds (Google's public holiday calendars), by ISO country code. Names are English. */
export const HOLIDAY_PRESETS: { cc: string; flag: string; name: string; url: string }[] = [
  { cc: 'PT', flag: '🇵🇹', name: 'Portugal holidays', url: 'https://calendar.google.com/calendar/ical/es.portuguese.official%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'ES', flag: '🇪🇸', name: 'Spain holidays', url: 'https://calendar.google.com/calendar/ical/es.spain%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'GB', flag: '🇬🇧', name: 'UK holidays', url: 'https://calendar.google.com/calendar/ical/en.uk%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'US', flag: '🇺🇸', name: 'US holidays', url: 'https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'DE', flag: '🇩🇪', name: 'Germany holidays', url: 'https://calendar.google.com/calendar/ical/en.german%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'FR', flag: '🇫🇷', name: 'France holidays', url: 'https://calendar.google.com/calendar/ical/en.french%23holiday%40group.v.calendar.google.com/public/basic.ics' },
  { cc: 'BR', flag: '🇧🇷', name: 'Brazil holidays', url: 'https://calendar.google.com/calendar/ical/pt.brazilian%23holiday%40group.v.calendar.google.com/public/basic.ics' },
];

export const SWATCHES = [
  '#ff5a4e', '#ff8a3d', '#ffc23d', '#9bd34a', '#2ec4b6', '#3ab0ff',
  '#5b7cfa', '#9b6bff', '#e05bd6', '#ff6f91', '#8d99ae', '#f2f2f2',
];

export const EMOJI_GRID = [
  '🎂', '🎁', '🎉', '🥳', '🏠', '🧳', '🛎️', '🔑', '✈️', '🚆', '🚗', '⛽',
  '🩺', '💊', '🦷', '🎒', '📚', '🎓', '🏃', '⚽', '🎾', '🏋️', '🚴', '🏊',
  '🍽️', '☕', '🍷', '🍕', '💼', '📞', '💻', '📅', '🏖️', '⛰️', '🏕️', '🌴',
  '💍', '❤️', '👶', '👨‍👩‍👧', '🐾', '🐶', '🛒', '💶', '🧾', '🏦', '🔧', '🧹',
  '🎬', '🎵', '🎮', '📺', '🎨', '📸', '⭐', '📌', '⏰', '🔔', '💬', '✅',
];

export { DEFAULT_ICON_RULES } from '../shared/emoji';

export function guessKind(nameOrId: string): SourceKind {
  const s = normalize(nameOrId);
  // vacation rentals only on clear words: a bare "al" also matched "Portugal", "Personal" or "Festival"
  if (/airbnb|booking|vrbo|reserv|alojamento/.test(s)) return 'airbnb';
  if (/birthday|cumple|aniversar|contacts/.test(s)) return 'birthdays';
  if (/holiday|festivo|feriado/.test(s)) return 'holidays';
  return 'generic';
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export type Errors = Record<string, string>;

/** Message of every "over the limit" error (the server answers limit_exceeded for the same cases). */
export const LIMIT_EXCEEDED = 'Over the allowed maximum';

/** UTF-8 size of a string (custom CSS limit). */
export const cssBytes = (v: string) => new TextEncoder().encode(v).length;

/** Client-side validation. Keys are dotted paths used by fields to show inline errors. Messages are English.
 *  Rules for features the server turns off (Home Assistant, password login) are skipped. */
export function validateConfig(c: AppConfig, caps: Caps = currentCaps()): Errors {
  const e: Errors = {};
  const ha = hasFeature(caps, 'homeassistant');
  const s = c.screen;
  if (!s.name.trim()) e['screen.name'] = 'Required';
  if (!HEX_RE.test(s.accent)) e['screen.accent'] = 'Invalid colour';
  if (!(s.fontScale >= 0.5 && s.fontScale <= 2)) e['screen.fontScale'] = 'Between 0.5 and 2';
  if (s.nightMode.enabled) {
    if (!TIME_RE.test(s.nightMode.from)) e['screen.nightMode.from'] = 'Invalid time (HH:MM)';
    if (!TIME_RE.test(s.nightMode.to)) e['screen.nightMode.to'] = 'Invalid time (HH:MM)';
  }
  const b = c.background;
  if (!(b.intervalSec >= 10)) e['background.intervalSec'] = 'Minimum 10 s';
  const cal = c.calendar;
  if (!(cal.weeks >= 1 && cal.weeks <= 6)) e['calendar.weeks'] = 'Between 1 and 6';
  if (!(cal.maxEventsPerDay >= 1 && cal.maxEventsPerDay <= 12)) e['calendar.maxEventsPerDay'] = 'Between 1 and 12';
  cal.sources.forEach((src) => {
    const p = `source.${src.id}`;
    if (!src.name.trim()) e[`${p}.name`] = 'Required';
    if (!HEX_RE.test(src.color)) e[`${p}.color`] = 'Invalid colour';
    if (src.type === 'ics') {
      // A hidden URL (see CalendarSource.urlHidden) is still stored on the server: an empty field keeps it.
      const kept = src.urlHidden && !src.url;
      if (!kept && (!src.url || !isHttpUrl(src.url, true))) e[`${p}.url`] = 'Invalid URL (http, https or webcal)';
    } else if (src.type === 'microsoft') {
      if (!src.microsoftAccount || !src.microsoftCalendarId) e[`${p}.url`] = 'Missing Microsoft account or calendar';
    } else {
      if (!src.googleAccount || !src.googleCalendarId) e[`${p}.url`] = 'Missing Google account or calendar';
    }
    if (!(src.refreshMin >= 1 && src.refreshMin <= 1440)) e[`${p}.refreshMin`] = 'Between 1 and 1440 min';
  });
  cal.iconRules.forEach((r) => {
    if (!r.match.some((m) => m.trim())) e[`rule.${r.id}.match`] = 'Add at least one keyword';
    if (!r.emoji.trim()) e[`rule.${r.id}.emoji`] = 'Pick an emoji';
    if (r.color && !HEX_RE.test(r.color)) e[`rule.${r.id}.color`] = 'Invalid colour';
  });
  const d = c.datetime;
  if (!d.timezone.trim()) e['datetime.timezone'] = 'Required';
  else {
    try {
      new Intl.DateTimeFormat('en', { timeZone: d.timezone });
    } catch {
      e['datetime.timezone'] = 'Unknown time zone';
    }
  }
  const w = c.weather;
  if (w.enabled) {
    if (!(w.lat >= -90 && w.lat <= 90)) e['weather.lat'] = 'Latitude between -90 and 90';
    if (!(w.lon >= -180 && w.lon <= 180)) e['weather.lon'] = 'Longitude between -180 and 180';
    if (ha && w.provider === 'homeassistant' && !w.haWeatherEntity) e['weather.haWeatherEntity'] = 'Pick a weather.* entity';
  }
  c.news.feeds.forEach((f) => {
    if (!f.name.trim()) e[`feed.${f.id}.name`] = 'Required';
    if (!isHttpUrl(f.url)) e[`feed.${f.id}.url`] = 'Invalid URL';
  });
  if (!(c.news.rotateSec >= 3)) e['news.rotateSec'] = 'Minimum 3 s';
  if (!(c.news.maxItems >= 1 && c.news.maxItems <= 200)) e['news.maxItems'] = 'Between 1 and 200';
  if (ha && c.homeassistant.enabled && !isHttpUrl(c.homeassistant.url)) e['homeassistant.url'] = 'Invalid URL';
  c.auth.allowedGoogleEmails.forEach((m, i) => {
    if (!EMAIL_RE.test(m)) e[`auth.allowedGoogleEmails.${i}`] = 'Invalid email';
  });
  if (hasFeature(caps, 'passwordLogin') && !c.auth.passwordLoginEnabled && c.auth.allowedGoogleEmails.length === 0)
    e['auth.passwordLoginEnabled'] = 'Add an allowed Google email before disabling the password';
  (c.privacy?.schedule ?? []).forEach((r) => {
    if (r.from === r.to) e[`privacy.${r.id}.to`] = 'Must differ from the start time';
  });
  const cssMax = caps.limits.customCssBytes;
  if (typeof cssMax === 'number' && hasFeature(caps, 'customCss') && cssBytes(s.customCss) > cssMax) e['screen.customCss'] = LIMIT_EXCEEDED;
  return e;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isValidDate = (v: string) => {
  if (!DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (m: number) => DAYS_IN_MONTH[m - 1] ?? 31;

/** Keys produced by validateConfig() that belong to the selected screen (the rest are global). */
const PER_SCREEN_KEY = /^(screen\.|background\.|layout\.|message\.|alerts\.|privacy\.|calendar\.(weeks|maxEventsPerDay)$|news\.rotateSec$|countdowns\.max$)/;
export const isPerScreenKey = (k: string) => PER_SCREEN_KEY.test(k);

/** Validation of the global v2 lists (local events, birthdays, rules, countdowns, schedules, screens). */
export function validateGlobal(c: StoredConfig): Errors {
  const e: Errors = {};
  const seenSlugs = new Map<string, string>();
  for (const s of c.screens) {
    if (!s.name.trim()) e[`scr.${s.id}.name`] = 'Required';
    if (!SLUG_RE.test(s.slug)) e[`scr.${s.id}.slug`] = 'Only lowercase letters, numbers and hyphens';
    else if (seenSlugs.has(s.slug)) e[`scr.${s.id}.slug`] = 'Another screen already uses this address';
    seenSlugs.set(s.slug, s.id);
  }
  for (const x of c.localEvents?.items ?? []) {
    const p = `local.${x.id}`;
    if (!x.title.trim()) e[`${p}.title`] = 'Required';
    if (!isValidDate(x.date)) e[`${p}.date`] = 'Invalid date';
    if (!isValidDate(x.endDate) || x.endDate < x.date) e[`${p}.endDate`] = 'Must be on or after the start';
    if (!x.allDay) {
      if (!TIME_RE.test(x.startTime)) e[`${p}.startTime`] = 'Invalid time (HH:MM)';
      if (!TIME_RE.test(x.endTime)) e[`${p}.endTime`] = 'Invalid time (HH:MM)';
      else if (x.endDate === x.date && x.endTime <= x.startTime) e[`${p}.endTime`] = 'Must be after the start time';
    }
    if (x.repeat.until && (!isValidDate(x.repeat.until) || x.repeat.until < x.date)) e[`${p}.until`] = 'Must be on or after the start';
    if (x.color && !HEX_RE.test(x.color)) e[`${p}.color`] = 'Invalid colour';
  }
  for (const b of c.birthdays?.items ?? []) {
    const p = `bday.${b.id}`;
    if (!b.name.trim()) e[`${p}.name`] = 'Required';
    if (!(b.month >= 1 && b.month <= 12) || !(b.day >= 1 && b.day <= daysInMonth(b.month))) e[`${p}.date`] = 'Invalid date';
    if (b.year != null && !(b.year >= 1900 && b.year <= 2100)) e[`${p}.year`] = 'Year between 1900 and 2100';
  }
  for (const r of c.eventRules?.items ?? []) {
    const p = `frule.${r.id}`;
    if (!r.match.trim()) e[`${p}.match`] = 'Required';
    if (r.action === 'style' && !r.emoji && !r.color && !r.countdown) e[`${p}.emoji`] = 'Pick an emoji, a color or countdown';
    if (r.color && !HEX_RE.test(r.color)) e[`${p}.color`] = 'Invalid colour';
  }
  for (const k of c.countdowns?.items ?? []) {
    const p = `cd.${k.id}`;
    if (!k.title.trim()) e[`${p}.title`] = 'Required';
    if (!isValidDate(k.date)) e[`${p}.date`] = 'Invalid date';
  }
  const cd = c.countdowns;
  if (cd) {
    if (!(cd.birthdayDays >= 1 && cd.birthdayDays <= 366)) e['countdowns.birthdayDays'] = 'Between 1 and 366';
    if (!(cd.horizonDays >= 1 && cd.horizonDays <= 3660)) e['countdowns.horizonDays'] = 'Between 1 and 3660';
  }
  for (const m of c.schedules?.items ?? []) {
    const p = `sched.${m.id}`;
    if (!m.title.trim()) e[`${p}.title`] = 'Required';
    if (!TIME_RE.test(m.from)) e[`${p}.from`] = 'Invalid time (HH:MM)';
    if (!TIME_RE.test(m.to)) e[`${p}.to`] = 'Invalid time (HH:MM)';
    else if (m.from === m.to) e[`${p}.to`] = 'Must differ from the start time';
    if (m.startDate && m.endDate && m.endDate < m.startDate) e[`${p}.endDate`] = 'Must be on or after the start';
  }
  return e;
}

export interface AllErrors {
  /** errors not tied to a screen (sources, rules, lists, auth…) */
  global: Errors;
  /** per-screen errors, keyed by screen id (keys as produced by validateConfig on the flat view) */
  screens: Record<string, Errors>;
  total: number;
}

/** List sizes checked against the limits (key `limit.<name>`, see sectionForError). */
const LIMITED_LISTS: [LimitName, (c: StoredConfig) => number][] = [
  ['screens', (c) => c.screens.length],
  ['sources', (c) => c.calendar.sources.length],
  ['newsFeeds', (c) => c.news?.feeds?.length ?? 0],
  ['localEvents', (c) => c.localEvents?.items?.length ?? 0],
  ['birthdays', (c) => c.birthdays?.items?.length ?? 0],
  ['countdowns', (c) => c.countdowns?.items?.length ?? 0],
];

/** `limit.<name>` errors for lists longer than the limit. */
export function validateLimits(full: StoredConfig, caps: Caps = currentCaps()): Errors {
  const e: Errors = {};
  for (const [name, count] of LIMITED_LISTS) {
    const max = limitOf(caps, name);
    if (max != null && count(full) > max) e[`limit.${name}`] = LIMIT_EXCEEDED;
  }
  return e;
}

/** Validate the whole stored config: every screen's flat view + the global lists + the limits. */
export function validateAll(full: StoredConfig, caps: Caps = currentCaps()): AllErrors {
  const global: Errors = { ...validateGlobal(full), ...validateLimits(full, caps) };
  const screens: Record<string, Errors> = {};
  for (const s of full.screens) {
    const errs = validateConfig(projectScreen(full, s.id), caps);
    const mine: Errors = {};
    for (const [k, v] of Object.entries(errs)) {
      if (isPerScreenKey(k)) mine[k] = v;
      else global[k] = v;
    }
    screens[s.id] = mine;
  }
  const total = Object.keys(global).length + Object.values(screens).reduce((n, e) => n + Object.keys(e).length, 0);
  return { global, screens, total };
}

/**
 * Server validation path → { screenIndex, section } (docs/ARCHITECTURE.md error paths).
 * `screens[1].screen.accent` → { screenIndex: 1, section: 'screen' }; `calendar.sources[2].url` → calendars.
 */
export function sectionForServerPath(path: string): { screenIndex: number | null; section: string } {
  const m = /^screens\[(\d+)\]\.?([a-zA-Z]+)?/.exec(path);
  if (m) {
    const sec = m[2] ?? '';
    const map: Record<string, string> = { screen: 'screen', layout: 'layout', background: 'background', message: 'message', calendar: 'calendars', datetime: 'datetime', weather: 'weather', news: 'news', todo: 'todo', countdowns: 'countdowns', alerts: 'alerts', privacy: 'screen' };
    return { screenIndex: Number(m[1]), section: map[sec] ?? 'screens' };
  }
  const top = path.split(/[.[]/)[0];
  const map: Record<string, string> = {
    calendar: path.includes('iconRules') ? 'icons' : 'calendars',
    datetime: 'datetime', weather: 'weather', news: 'news', todo: 'todo', localEvents: 'local', birthdays: 'birthdays',
    eventRules: 'filters', countdowns: 'countdowns', schedules: 'alerts', homeassistant: 'homeassistant', auth: 'security',
    screens: 'screens', defaultScreen: 'screens',
  };
  return { screenIndex: null, section: map[top] ?? 'home' };
}

/** Map an error key to the nav section that owns it (for "jump to error"). */
const LIMIT_SECTION: Record<string, string> = { screens: 'screens', sources: 'calendars', newsFeeds: 'news', localEvents: 'local', birthdays: 'birthdays', countdowns: 'countdowns' };

export function sectionForError(key: string): string {
  if (key.startsWith('limit.')) return LIMIT_SECTION[key.slice(6)] ?? 'home';
  if (key.startsWith('screen.') || key.startsWith('privacy.')) return 'screen';
  if (key.startsWith('layout.')) return 'layout';
  if (key.startsWith('message.')) return 'message';
  if (key.startsWith('alerts.') || key.startsWith('sched.')) return 'alerts';
  if (key.startsWith('countdowns.') || key.startsWith('cd.')) return 'countdowns';
  if (key.startsWith('local.')) return 'local';
  if (key.startsWith('bday.')) return 'birthdays';
  if (key.startsWith('frule.')) return 'filters';
  if (key.startsWith('scr.')) return 'screens';
  if (key.startsWith('background.')) return 'background';
  if (key.startsWith('calendar.') || key.startsWith('source.')) return 'calendars';
  if (key.startsWith('rule.')) return 'icons';
  if (key.startsWith('datetime.')) return 'datetime';
  if (key.startsWith('weather.')) return 'weather';
  if (key.startsWith('feed.') || key.startsWith('news.')) return 'news';
  if (key.startsWith('homeassistant.')) return 'homeassistant';
  if (key.startsWith('auth.')) return 'security';
  return 'screen';
}

/** User calendar sources + the built-in pseudo-sources (local events, birthdays) as picker options. */
export function allSourceOptions(c: Pick<StoredConfig, 'calendar' | 'localEvents' | 'birthdays'>, opts: { includeDisabled?: boolean } = {}) {
  const out = c.calendar.sources
    .filter((s) => opts.includeDisabled || s.enabled)
    .map((s) => ({ id: s.id, name: s.name || s.id, color: s.color, emoji: s.emoji || KIND_EMOJI[s.kind] || '' }));
  out.push({ id: 'local', name: c.localEvents.name || 'Local', color: c.localEvents.color, emoji: c.localEvents.emoji || '📅' });
  out.push({ id: 'birthdays', name: c.birthdays.name || 'Birthdays', color: c.birthdays.color, emoji: c.birthdays.emoji || '🎂' });
  return out;
}

/** First name for the dashboard greeting; none when the account name is an email address (Marco Cloud accounts). */
export function greetingName(name?: string | null): string {
  const n = (name || '').trim();
  return n && !n.includes('@') ? n.split(/\s+/)[0] : '';
}
