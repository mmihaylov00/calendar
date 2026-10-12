// Calendar display: real data polling, live updates, calendar layouts and photo backgrounds.
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '../shared/emoji-font.css';
import './styles.css';
import './styles-views.css';
import './styles-modern.css';
import './styles-day.css';
import type { DisplayConfig, EventsResponse, StreamHello, WeatherResponse } from '../shared/types';
import { glassVars, normalizeGlass } from '../shared/glass';
import { api, ApiError } from './api';
import { parseColor } from './color';
import { ctx, setCtxConfig } from './ctx';
import { normalizeConfig } from './defaults';
import { clearCaches, screenKey } from './identity';
import { $, reducedMotion } from './dom';
import { calendarEventRange, type NEvent, normalizeEvents } from './eventModel';
import { loadCache, on, saveCache, set, state } from './store';
import { startConfigPoll, type StreamHandlers } from './live';
import { connectStream } from './stream';
import { current, onTick, setTimezone, startTicker, type Tick } from './time';
import { Agenda } from './widgets/agenda';
import { MonthCalendar } from './widgets/calendar';
import { Clock } from './widgets/clock';
import { Highlights } from './widgets/highlights';
import { Photos, photoStats } from './widgets/photos';
import { Weather } from './widgets/weather';
import { VIEW_PRESETS, Views } from './widgets/views';
import { healthOnce, loadEmojiWebFont } from './health';
import { refreshMarquee } from './marquee';

const params = ctx.params;
const lite = ctx.lite;
if (lite) document.documentElement.classList.add('lite');

// ---------------------------------------------------------------------------------------------
// DOM + widgets
// ---------------------------------------------------------------------------------------------
const app = $('#app');
const photoArea = $('.photo-area');
const sideEl = $('.side');
const clock = new Clock($('#clock'));
const highlights = new Highlights($('#highlights'));
const weather = new Weather($('#weather'));
const calendar = new MonthCalendar($('#calendar'));
const agenda = new Agenda($('#agenda'), { days: 14 });
const sideAgenda = new Agenda($('#side-agenda'), { days: 3, compact: true, maxPerDay: 4 });
const photos = new Photos(photoArea, $('.photo-meta'));
const views = new Views($('#view'));
const screenNote = $('#screen-note');
const statusDot = $('#status');
const accessNote = $('#access-note');
const mainEl = $('.main');
const dayNav = $('#day-nav');
const dayBack = $('#day-back');
let customStyle: HTMLStyleElement | null = null;
let selectedDay: string | null = null;
let viewAnimation: Animation | null = null;

let nEvents: NEvent[] = [];
let nEventsKey = '';

const PRESETS = ['bigCalendar', 'leftRight', 'topBottom', 'bigTime', 'agenda', 'today', 'people', 'twoWeeks'];
/** Newer layouts built on an older one's frame: they also get its class, so its rules (and the Modern ones) apply. */
const PRESET_BASE: Record<string, string> = { today: 'bigCalendar', twoWeeks: 'bigCalendar', people: 'topBottom' };

function effectivePreset(cfg: DisplayConfig): string {
  const p = params.get('preset') || cfg.layout.preset;
  return PRESETS.includes(p) ? p : 'bigCalendar';
}

function isPortrait(cfg: DisplayConfig): boolean {
  const o = cfg.screen.orientation;
  if (o === 'portrait') return true;
  if (o === 'landscape') return false;
  return window.innerHeight > window.innerWidth * 1.05;
}

function applyLayout(): void {
  const cfg = ctx.cfg;
  const preset = effectivePreset(cfg);
  const portrait = isPortrait(cfg);
  const side = params.get('side') || cfg.layout.sidePanel;
  app.className = [
    `preset-${preset}`, `side-${side === 'right' ? 'right' : 'left'}`, portrait ? 'portrait' : 'landscape',
    cfg.background.enabled ? 'has-photo' : 'no-photo',
    PRESET_BASE[preset] ? `preset-${PRESET_BASE[preset]}` : '',
  ].filter(Boolean).join(' ');
  app.classList.toggle('has-view', !!selectedDay || VIEW_PRESETS.includes(preset));
  app.classList.toggle('day-detail', !!selectedDay);
  dayNav.hidden = !selectedDay;
  views.setPreset(selectedDay ? 'today' : preset);
  const view = params.get('view') || cfg.calendar.view;
  const showAgendaMain = !selectedDay && (preset === 'agenda' || view === 'agenda');
  app.classList.toggle('view-agenda', showAgendaMain);
  app.classList.toggle('cal-off', !cfg.calendar.enabled);
}

/**
 * Modern style glass: settings + current photo → a few custom properties on <html> (no extra layers).
 * Re-run on every new photo, since Auto and "from the photo" depend on it.
 */
const GLASS_VARS = ['--g-rgb', '--g-solid', '--g-a', '--g-a-wx', '--g-filter', '--g-sheet-rgb', '--g-sheet-a', '--g-sheet-filter', '--g-edge'];
function applyGlass(): void {
  const cfg = ctx.cfg;
  const root = document.documentElement;
  if (cfg.screen.style !== 'modern') {
    for (const k of GLASS_VARS) root.style.removeProperty(k);
    root.classList.remove('glass-ink-dark', 'glass-no-edge', 'glass-thin');
    return;
  }
  const g = glassVars(cfg.screen.glass, cfg.background.enabled ? photoStats : null, { lite, hasPhoto: cfg.background.enabled });
  for (const [k, v] of Object.entries(g.vars)) root.style.setProperty(k, v);
  root.classList.toggle('glass-ink-dark', g.inkDark);
  root.classList.toggle('glass-no-edge', !g.edge);
  root.classList.toggle('glass-thin', g.thin);
}
window.addEventListener('marco:photo-tone', () => applyGlass());

function applyConfig(raw: DisplayConfig): void {
  const cfg = normalizeConfig(raw);
  const v = params.get('view');
  if (v === 'month' || v === 'agenda' || v === 'week') cfg.calendar.view = v;
  // URL overrides (handy for testing a screen without touching the saved config)
  const pc = params.get('clock');
  if (pc === 'analog' || pc === 'digital') cfg.datetime.clock = pc;
  const pt = params.get('theme');
  if (pt === 'light' || pt === 'dark') cfg.screen.theme = pt;
  const ps = params.get('style');
  if (ps === 'classic' || ps === 'modern') cfg.screen.style = ps;
  // glass previews: ?glass=clear|tinted|auto &glassOpacity=0..1 &glassBlur=0..40 &glassTint=dark|light|photo &glassEdge=0|1
  const gq = (k: string) => params.get(k);
  if (gq('glass') || gq('glassOpacity') || gq('glassBlur') || gq('glassTint') || gq('glassEdge')) {
    const g = { ...cfg.screen.glass } as Record<string, unknown>;
    if (gq('glass')) g.appearance = gq('glass');
    if (gq('glassOpacity')) g.opacity = gq('glassOpacity');
    if (gq('glassBlur')) g.blur = gq('glassBlur');
    if (gq('glassTint')) g.tint = gq('glassTint');
    if (gq('glassEdge')) g.edge = gq('glassEdge') !== '0';
    cfg.screen.glass = normalizeGlass(g);
  }
  // ?marquee=0|1 (titles that slide) and ?rotate=0|1 (busy days that page through their events)
  const pm = params.get('marquee');
  if (pm === '0' || pm === '1') cfg.calendar.marquee = pm === '1';
  const pr = params.get('rotate');
  if (pr === '0' || pr === '1') cfg.calendar.rotateBusyDays = pr === '1';
  // ?compact=0|1 (busy days as small one-line entries, rows sized by their events) and ?weeks=1..8
  const pcp = params.get('compact');
  if (pcp === '0' || pcp === '1') cfg.calendar.compactBusyDays = pcp === '1';
  const pw = Number(params.get('weeks'));
  if (Number.isInteger(pw) && pw >= 1 && pw <= 8) cfg.calendar.weeks = pw;
  // the top-bottom preset has a shorter calendar: cap the number of week rows so chips stay readable
  if (effectivePreset(cfg) === 'topBottom') cfg.calendar.weeks = Math.min(cfg.calendar.weeks, 4);
  // Two weeks: the month grid with two roomy rows (more events per day)
  if (effectivePreset(cfg) === 'twoWeeks') {
    cfg.calendar.view = 'month';
    cfg.calendar.weeks = 2;
    cfg.calendar.maxEventsPerDay = Math.max(cfg.calendar.maxEventsPerDay, 8);
  }
  // Small landscape screens (e.g. 1280×720 on the Pi): one week fewer so text can be bigger.
  if (window.innerWidth > window.innerHeight && window.innerHeight <= 820 && effectivePreset(cfg) !== 'twoWeeks') cfg.calendar.weeks = Math.min(cfg.calendar.weeks, 4);
  if (selectedDay && (!cfg.calendar.enabled || VIEW_PRESETS.includes(effectivePreset(cfg)) || effectivePreset(cfg) === 'agenda' || cfg.calendar.view === 'agenda')) {
    selectedDay = null;
    viewAnimation?.cancel();
  }
  setCtxConfig(cfg);
  setTimezone(ctx.tz);
  const root = document.documentElement;
  root.lang = ctx.lang;
  const accent = cfg.screen.accent;
  const light = cfg.screen.theme === 'light';
  root.classList.toggle('theme-light', light);
  // Display style (independent of the layout): 'modern' scopes every rule in styles-modern.css; classic adds nothing.
  root.classList.toggle('style-modern', cfg.screen.style === 'modern');
  applyGlass();
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', parseColor(accent).join(' '));
  root.style.setProperty('--fs', String(cfg.screen.fontScale));
  root.style.setProperty('--panel-blur', String(cfg.background.panelBlur ?? 18));
  root.style.setProperty('--panel-shade', String((cfg.background.panelShade ?? 0.5) * 2));
  root.style.setProperty('--side-w', `${(cfg.layout.sideWidth * 100).toFixed(2)}%`);

  if (cfg.screen.customCss) {
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.id = 'custom-css';
      document.head.appendChild(customStyle);
    }
    if (customStyle.textContent !== cfg.screen.customCss) customStyle.textContent = cfg.screen.customCss;
  } else if (customStyle) customStyle.textContent = '';

  applyLayout();

  photos.applyConfig();

  renderScreenNote(raw);
  renderAll();
  revealApp(cfg);
}

/**
 * First paint: with the Modern style over a photo, wait for the photo (or 1.8 s at most) before fading the screen
 * in, so the glass cards appear already blurring the photo instead of a black background that changes a second later.
 */
let revealArmed = false;
function revealApp(cfg: DisplayConfig): void {
  if (!app.classList.contains('booting') || revealArmed) return;
  const waitPhoto = cfg.screen.style === 'modern' && cfg.background.enabled && !lite;
  if (!waitPhoto) return void app.classList.remove('booting');
  revealArmed = true;
  const show = () => app.classList.remove('booting');
  window.addEventListener('marco:photo-tone', show, { once: true });
  setTimeout(show, 1800);
}

/** Small unobtrusive notice when ?screen= did not match any screen (the default one is shown instead). */
function renderScreenNote(raw: DisplayConfig): void {
  const show = !!raw.screenFallback && !!screenKey;
  screenNote.textContent = show ? ctx.t('screenNotFound', { s: screenKey }) : '';
  screenNote.classList.toggle('show', show);
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
function eventsNormalized(): NEvent[] {
  const ev = state.events;
  const key = `${ev?.hash}|${ev?.generatedAt}|${ctx.tz}`;
  if (key !== nEventsKey) {
    nEventsKey = key;
    nEvents = normalizeEvents(ev?.events ?? [], ctx.tz);
  }
  return nEvents;
}

function renderCalendar(tick: Tick): void {
  const evs = eventsNormalized();
  const cfg = ctx.cfg;
  const preset = effectivePreset(cfg);
  renderView(tick);
  if (!cfg.calendar.enabled) return;
  if (selectedDay) {
    highlights.render(evs, tick);
    return;
  }
  // layouts with their own view (today, people, …) do not show the month grid / agenda
  if (VIEW_PRESETS.includes(preset)) {
    if (preset === 'today') highlights.render(evs, tick);
    return;
  }
  if (app.classList.contains('view-agenda')) agenda.render(evs, tick);
  else {
    calendar.roomy = preset === 'twoWeeks';
    calendar.render(evs, tick);
  }
  if (preset === 'leftRight' || preset === 'bigTime') sideAgenda.render(evs, tick);
  highlights.render(evs, tick);
  refreshMarquee();
}

/** Content of the layouts with their own view (no-op for the others). */
function renderView(tick: Tick): void {
  views.render({ events: ctx.cfg.calendar.enabled ? eventsNormalized() : [] }, tick, selectedDay ?? undefined);
}

function showDay(day: string | null, trigger?: HTMLButtonElement): void {
  if (accessDenied || !ctx.cfg.calendar.enabled || selectedDay === day) return;
  const previous = selectedDay;
  viewAnimation?.cancel();
  if (trigger) {
    const cell = trigger.getBoundingClientRect();
    const box = mainEl.getBoundingClientRect();
    mainEl.style.transformOrigin = `${cell.left + cell.width / 2 - box.left}px ${cell.top + cell.height / 2 - box.top}px`;
  } else mainEl.style.transformOrigin = 'center';
  selectedDay = day;
  applyLayout();
  renderAll();
  if (day) dayBack.focus({ preventScroll: true });
  else (document.querySelector<HTMLButtonElement>(`.day-hit[data-day="${previous}"]`) ?? document.querySelector<HTMLButtonElement>('.day-hit'))?.focus({ preventScroll: true });
  if (!reducedMotion() && typeof mainEl.animate === 'function') {
    viewAnimation = mainEl.animate([
      { opacity: 0, transform: `translateY(${day ? 8 : -8}px) scale(.97)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

calendar.onDaySelect = (day, button) => showDay(day, button);
dayBack.addEventListener('click', () => showDay(null));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selectedDay && !event.defaultPrevented) {
    event.preventDefault();
    showDay(null);
  }
});

function renderWeather(tick: Tick): void {
  weather.render(state.weather, tick.dayKey);
}

function renderAll(): void {
  const tick = current();
  clock.update(tick);
  renderCalendar(tick);
  renderWeather(tick);
  fitSide();
}

/** Hide secondary rows when the side panel is too small, keeping the clock and calendar readable. */
function fitSide(): void {
  app.classList.remove('fit-1', 'fit-2', 'fit-3');
  fitMidRows();
  for (const step of ['fit-1', 'fit-2', 'fit-3']) {
    if (sideEl.scrollHeight <= sideEl.clientHeight + 2) break;
    app.classList.add(step);
  }
  views.fit();
  photos.reframe();
  refreshMarquee();
}

/** The modern large-clock layout keeps only whole calendar rows in its middle column. */
function fitMidRows(): void {
  const mid = sideEl.querySelector<HTMLElement>('.side-mid');
  const agendaEl = $('#side-agenda');
  agendaEl.classList.remove('fit-hide');
  for (const row of agendaEl.querySelectorAll<HTMLElement>('.ag-ev, .ag-more, .ag-day')) row.classList.remove('fit-hide');
  if (!mid || ctx.cfg.screen.style !== 'modern' || !app.classList.contains('preset-bigTime') || app.classList.contains('portrait')) return;
  const over = () => mid.scrollHeight > mid.clientHeight + 1;
  for (const day of Array.from(agendaEl.querySelectorAll<HTMLElement>('.ag-day')).reverse()) {
    for (const row of Array.from(day.querySelectorAll<HTMLElement>('.ag-ev, .ag-more')).reverse()) {
      if (!over()) return;
      row.classList.add('fit-hide');
    }
    if (!day.querySelector('.ag-ev:not(.fit-hide)')) day.classList.add('fit-hide');
  }
  if (over()) agendaEl.classList.add('fit-hide');
}

function setOnline(ok: boolean): void {
  set('online', ok);
  statusDot.classList.toggle('show', !ok);
}

// Authentication failures discard cached calendar data; network failures keep the last good data.
let accessDenied = false;
let liveStream: { close(): void } | null = null;
let configPoll: ReturnType<typeof startConfigPoll> | null = null;

function denyAccess(status: number): void {
  if (accessDenied) return;
  accessDenied = true;
  viewAnimation?.cancel();
  selectedDay = null;
  intervals.forEach(clearInterval);
  intervals.length = 0;
  liveStream?.close();
  configPoll?.close();
  clearCaches();
  for (const k of ['config', 'events', 'weather', 'photos'] as const) state[k] = null;
  photos.stop();
  app.hidden = true;
  accessNote.hidden = false;
  accessNote.textContent = status === 403 ? 'Calendar access is no longer valid. Open Calendar from Home Assistant.' : 'Sign in to Home Assistant to open Calendar.';
}

/** True (and the access screen shown) when `e` is a 401 / 403 from the display API. */
function deniedBy(e: unknown): boolean {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
    denyAccess(e.status);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------
function eventsRange(): [string, string] {
  return calendarEventRange(current().dayKey, ctx.cfg.calendar.weekStart, ctx.cfg.calendar.weeks, selectedDay);
}

async function fetchEvents(): Promise<void> {
  try {
    const [from, to] = eventsRange();
    const r = await api.events(from, to);
    if (accessDenied) return;
    setOnline(true);
    if (r.errors?.length) console.warn('[events] source errors', r.errors);
    if (!state.events || state.events.hash !== r.hash) {
      set('events', r);
      saveCache('events', r);
    }
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[events]', (e as Error).message);
    setOnline(false);
  }
}

async function fetchWeather(): Promise<void> {
  try {
    const r = await api.weather();
    if (accessDenied) return;
    set('weather', r);
    saveCache('weather', r);
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[weather]', (e as Error).message);
  }
}

async function fetchPhotos(): Promise<void> {
  try {
    const r = await api.photos(20, photos.lastGalleryFile);
    if (!accessDenied) set('photos', r);
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[photos]', (e as Error).message);
  }
}

async function fetchConfig(): Promise<boolean> {
  try {
    const c = await api.config();
    if (accessDenied) return false;
    setOnline(true);
    saveCache('config', c);
    set('config', c);
    return true;
  } catch (e) {
    if (deniedBy(e)) return false;
    console.warn('[config]', (e as Error).message);
    setOnline(false);
    return false;
  }
}

let photoSig = '';
on('config', (s) => {
  if (!s.config || accessDenied) return;
  applyConfig(s.config);
  const b = ctx.cfg.background;
  const sig = `${b.enabled}|${b.source}|${b.stockTopic}|${b.order ?? 'random'}`;
  if (photoSig && sig !== photoSig) void fetchPhotos();
  photoSig = sig;
});
on('events', () => {
  renderCalendar(current());
  fitSide();
});
on('weather', () => {
  renderWeather(current());
  fitSide();
});
on('photos', (s) => s.photos && photos.setList(s.photos.photos || []));
photos.onExhausted = () => fetchPhotos();

// ---------------------------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------------------------
const intervals: ReturnType<typeof setInterval>[] = [];
function startPolling(): void {
  intervals.forEach(clearInterval);
  intervals.length = 0;
  intervals.push(setInterval(fetchEvents, 60_000));
  intervals.push(setInterval(fetchWeather, 10 * 60_000));
  intervals.push(setInterval(fetchPhotos, 60 * 60_000));
}

onTick((tick) => {
  if (accessDenied) return;
  clock.update(tick);
  if (tick.minuteChanged) {
    renderCalendar(tick);
    renderWeather(tick);
    fitSide();
  }
  if (tick.dayChanged) {
    void fetchEvents();
    void fetchWeather();
    renderAll();
  }
});

// Chip line-wrapping measures text on a canvas: re-plan once the bundled fonts are really available.
try {
  void document.fonts?.ready.then(() => {
    if (state.config) {
      renderCalendar(current());
      fitSide();
    }
  });
} catch { /* old browser */ }

// Re-layout the grid when its available height changes (fonts loading or viewport resizing).
let lastWeeksH = 0;
let roT: ReturnType<typeof setTimeout> | null = null;
try {
  const weeksEl = document.querySelector('#calendar .cal-weeks');
  if (weeksEl && 'ResizeObserver' in window) {
    new ResizeObserver((entries) => {
      const h = Math.round(entries[0].contentRect.height);
      if (Math.abs(h - lastWeeksH) < 2) return;
      lastWeeksH = h;
      if (roT) clearTimeout(roT);
      roT = setTimeout(() => renderCalendar(current()), 60);
    }).observe(weeksEl);
  }
} catch { /* ignore */ }

let resizeT: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeT) clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    applyLayout();
    renderAll();
    photos.reframe();
  }, 150);
});

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
async function boot(): Promise<void> {
  startTicker();
  void healthOnce().then((h) => loadEmojiWebFont(h));
  // Ask the server first (short timeout): a revoked link or a private install without a key must never flash
  // cached family data. Offline → last known data (offline tolerance), then go live.
  let first: DisplayConfig | null = null;
  try {
    first = await api.configQuick();
  } catch (e) {
    if (deniedBy(e)) return;
  }
  if (first) {
    setOnline(true);
    saveCache('config', first);
    set('config', first);
    goLive();
    return;
  }
  const cached = loadCache<DisplayConfig>('config');
  if (cached) {
    set('events', loadCache<EventsResponse>('events'));
    set('weather', loadCache<WeatherResponse>('weather'));
    set('config', cached);
  }
  const ok = await fetchConfig();
  if (accessDenied) return;
  if (!ok && !cached) set('config', normalizeConfig({}));
  goLive();
}

function goLive(): void {
  if (accessDenied) return;
  startPolling();
  void fetchEvents();
  void fetchWeather();
  void fetchPhotos();
  configPoll ??= startConfigPoll({ revision: () => state.config?.revision, fetchConfig, changed: () => void fetchEvents() });
  liveStream ??= connectStream(liveHandlers);
}

const liveHandlers: StreamHandlers = {
  hello: (d: Partial<StreamHello>) => {
    setOnline(true);
    if (typeof d.revision === 'number' && d.revision !== state.config?.revision) void fetchConfig();
    void fetchEvents();
    if (d.serverVersion) void maybeReloadForVersion(d.serverVersion);
  },
  config: () => void fetchConfig().then((ok) => ok ? fetchEvents() : undefined),
  photos: (d) => void fetchPhotos().then(() => {
    if (!accessDenied && photos.currentFile && d.hidden?.includes(photos.currentFile)) void photos.next();
  }),
  events: (d) => {
    if (!state.events || d.hash !== state.events.hash) void fetchEvents();
  },
  reload: () => location.reload(),
  revoked: (d) => denyAccess(d.code === 'key_required' ? 401 : 403),
  open: () => setOnline(true),
  down: () => {
    setOnline(false);
    void fetchConfig(); // EventSource hides HTTP status; fetch handles ingress expiry or revoked access.
  },
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !accessDenied) {
    void configPoll?.tick();
    void fetchEvents();
  }
});

/**
 * The server runs a newer build than this page (hello.serverVersion ≠ __APP_VERSION__): reload once, but never
 * more than once per 10 min (sessionStorage guard) and only when /api/health answers.
 */
async function maybeReloadForVersion(serverVersion: string): Promise<void> {
  if (!serverVersion || serverVersion === __APP_VERSION__ || import.meta.env.DEV) return;
  const KEY = 'cs.versionReloadAt';
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10 * 60_000) return;
    const h = await api.health();
    if (!h?.ok) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  console.info(`[display] server ${serverVersion} ≠ page ${__APP_VERSION__} → reloading`);
  location.reload();
}

// Never let an unexpected error blank the screen.
window.addEventListener('error', (e) => {
  console.error('[display] error', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[display] rejection', e.reason);
});

void boot();
