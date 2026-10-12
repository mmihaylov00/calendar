// Shared JSON contracts, see docs/API.md and docs/ARCHITECTURE.md. Imported by both the display and the admin panel.
// Keep in sync with the server (server/core/validate.js, server/core/defaults.js).

export type Lang = 'en';
export type LayoutPreset =
  | 'bigCalendar' | 'leftRight' | 'topBottom' | 'bigTime' | 'agenda'
  | 'today' | 'people' | 'photoFrame' | 'twoWeeks' | 'board' | 'bedside';
/** Corner of the clock card in the 'photoFrame' layout: top-left, top-right, bottom-left, bottom-right. */
export type FrameCorner = 'tl' | 'tr' | 'bl' | 'br';
export type SourceKind = 'generic' | 'airbnb' | 'birthdays' | 'holidays';
export type SourceType = 'ics' | 'google' | 'microsoft' | 'homeassistant';
export type DateFormat = 'weekday_month_d' | 'weekday_d_month' | 'weekday_d_dot_month' | 'weekday_month_d_y' | 'weekday_mdy' | 'weekday_dmy' | 'weekday_iso' | 'custom';
export interface NightMode {
  enabled: boolean;
  from: string; // "HH:MM"
  to: string; // "HH:MM"
  dim: number; // 0..1 (brightness multiplier applied at night)
}

export type DisplayStyle = 'classic' | 'modern';

/** Glass material of the Modern style (like iOS Liquid Glass): ignored by Classic. */
export interface GlassConfig {
  /** 'auto' follows the photo (clearer over dark photos, more tinted over bright ones); 'clear' or 'tinted' fix it. */
  appearance: 'auto' | 'clear' | 'tinted';
  /** 0 = most see-through, 1 = most solid (0.5 = the default Modern look). */
  opacity: number;
  /** Background blur, 0..40 (0 = none). */
  blur: number;
  /** Tint colour: dark, light, or taken from the current photo. */
  tint: 'dark' | 'light' | 'photo';
  /** Thin light ring along the card edge. */
  edge: boolean;
}

export interface ScreenConfig {
  name: string;
  language: Lang;
  fontScale: number;
  theme: 'dark' | 'light' | string;
  /** Display style, independent of the layout: 'classic' (default) or 'modern' (glass cards, Apple-like). */
  style?: DisplayStyle;
  /** Glass options for the Modern style. Missing = defaults (GLASS_DEFAULTS). */
  glass?: GlassConfig;
  accent: string;
  orientation: 'auto' | 'landscape' | 'portrait' | string;
  customCss: string;
  nightMode: NightMode;
}

export interface LayoutConfig {
  preset: LayoutPreset;
  sidePanel: 'left' | 'right';
  sideWidth: number; // 0..1 fraction of the screen width
  /** 'people' layout: calendar ids shown as columns (max 5); null / missing = automatic. */
  people?: string[] | null;
  /** 'photoFrame' layout: corner of the clock card (default 'br'). */
  corner?: FrameCorner;
}

export interface BackgroundConfig {
  enabled: boolean;
  source: 'stock' | 'gallery' | 'mixed';
  stockTopic: string;
  /** gallery rotation order: shuffled (no immediate repeats), newest upload first, or by file name */
  order?: 'random' | 'newest' | 'name';
  intervalSec: number;
  brightness: number;
  showMeta: boolean;
  cover: boolean;
  transition: 'webgl' | 'fade' | 'none';
  ambient: 'aurora' | 'particles' | 'none';
  /** frosted weather card: backdrop blur (px at 1080p, 0 = off) and darkness (0..1, 0.5 = default) */
  panelBlur?: number;
  panelShade?: number;
  /** effect over the photo for the current weather: none, light rain/snow particles, or drops on the glass with sun rays */
  weatherFx?: 'off' | 'simple' | 'rich';
}

export interface CalendarSource {
  id: string;
  type: SourceType;
  name: string;
  url?: string; // ics only
  /** Sent by multi-tenant servers instead of the URL when the session has not signed in recently. The URL comes back
   *  empty, and saving a known calendar with an empty URL keeps the stored one. Never stored. */
  urlHidden?: boolean;
  googleCalendarId?: string; // google only
  googleAccount?: string; // google only
  /** Microsoft Graph calendar id (Outlook.com, Hotmail, Microsoft 365). Marco Cloud only for now. */
  microsoftCalendarId?: string; // microsoft only
  microsoftAccount?: string; // microsoft only
  entityId?: string; // Home Assistant calendar entity
  color: string;
  emoji?: string;
  kind: SourceKind;
  enabled: boolean;
  refreshMin: number;
  /** what privacy mode does to its events (missing = 'busy', or 'keep' for holidays and birthdays) */
  privacy?: PrivacyMode;
}

/** Per calendar, while a screen is private: 'busy' = shown as "Busy" (time and colour only), 'hide' = left out,
 *  'keep' = shown as it is. */
export type PrivacyMode = 'busy' | 'hide' | 'keep';

/** A rule that turns privacy mode on by itself (same days / from / to rules as scheduled messages). */
export interface PrivacyRule {
  id: string; // "p_xxx"
  enabled: boolean;
  /** 0 = Sunday … 6; [] = every day. A window that crosses midnight belongs to the day it starts. */
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM; `to < from` crosses midnight
}

/** Per-screen privacy settings (ScreenProfile.privacy). */
export interface ScreenPrivacyConfig {
  /** while private, the background and photo frame use stock photos only */
  hidePhotos: boolean;
  /** small lock on the display while private */
  showLock: boolean;
  schedule: PrivacyRule[];
}

/** Public projection of a source sent to the display (no urls / account info). */
export interface PublicCalendarSource {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  kind: SourceKind;
}

export interface IconRule {
  id: string;
  match: string[];
  emoji: string;
  color: string | null;
}

export interface CalendarConfig<S = CalendarSource> {
  enabled: boolean;
  view: 'month' | 'agenda' | 'week';
  weeks: number;
  weekStart: number; // 0 = Sunday, 1 = Monday
  showLocation: boolean;
  showEndTime: boolean;
  showDayXofY: boolean;
  showLegend: boolean;
  hidePast: boolean;
  maxEventsPerDay: number;
  /** Titles cut short in bars and lists slide slowly to show the rest (default true). */
  marquee: boolean;
  /** A day with more events than fit in the month grid pages through them every few seconds (default true). */
  rotateBusyDays: boolean;
  /**
   * Month / week grid: a day that cannot fit its events at normal size shows them as small one-line entries, and week
   * rows share the height by how many events they have (on for new screens, off for screens saved before it).
   */
  compactBusyDays: boolean;
  /** v2, per screen: null = every enabled source (incl. 'local' + 'birthdays'); array = only these ids. */
  sourceIds?: string[] | null;
  sources: S[];
  iconRules: IconRule[];
}

export interface DateTimeConfig {
  enabled: boolean;
  timezone: string;
  clock: 'digital' | 'analog';
  format24: boolean;
  showSeconds: boolean;
  showAmPm: boolean;
  dateFormat: DateFormat;
  /** pattern for dateFormat 'custom': {dddd} {ddd} {d} {dd} {mmmm} {mmm} {m} {mm} {yyyy} {yy} plus any text */
  dateCustom?: string;
}

/** Weather data sources (server/core/weather.js). 'homeassistant' = Open-Meteo plus a Home Assistant entity (self-hosted). */
export type WeatherProvider = 'open-meteo' | 'met-norway' | 'pirate-weather' | 'homeassistant';
/** Open-Meteo forecast models offered in the admin ('best_match' = Open-Meteo picks). */
export type OpenMeteoModel = 'best_match' | 'ecmwf_ifs' | 'icon_seamless' | 'gfs_seamless' | 'meteofrance_seamless' | 'ukmo_seamless' | 'gem_seamless' | 'jma_seamless';

export interface WeatherConfig {
  enabled: boolean;
  provider: WeatherProvider;
  /** forecast model when the data comes from Open-Meteo (open-meteo, homeassistant) */
  model: OpenMeteoModel;
  locationName: string;
  lat: number;
  lon: number;
  units: 'metric' | 'imperial';
  forecastDays: number;
  showHourly: boolean;
  showPrecipChance: boolean;
  haWeatherEntity: string;
  haIndoorTempEntity: string;
  haIndoorHumidityEntity: string;
}

export interface NewsFeed {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface NewsConfig {
  enabled: boolean;
  feeds: NewsFeed[];
  rotateSec: number;
  maxItems: number;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoConfig {
  enabled: boolean;
  items: TodoItem[];
}

export interface MessageConfig {
  enabled: boolean;
  text: string;
  emoji: string;
}

export interface HomeAssistantConfig {
  enabled: boolean;
  url: string;
  /** Doorbell camera settings (POST /api/hooks/doorbell). */
  doorbell: DoorbellSettings;
}

export interface DoorbellSettings {
  /** camera.* entity whose picture is shown; '' = no picture, only the label and the chime */
  camera: string;
  /** how long a ring stays on screen, 10..300 */
  seconds: number;
  /** screens that show it; [] = every screen */
  screenIds: string[];
  /** door chime on the displays */
  sound: boolean;
}

export interface AuthConfig {
  allowedGoogleEmails: string[];
  passwordLoginEnabled: boolean;
}

// ---- display access: private links + paired devices (docs/API.md "Display access") ----

/** 'private': displays need their private link (/d/<key>) or a paired-device token. 'open': legacy LAN mode. */
export type DisplayAccessMode = 'private' | 'open';
export interface SecurityConfig {
  displayAccess: DisplayAccessMode;
}

/** GET /api/admin/geocode?q=&lang= (Open-Meteo geocoding through the server). */
export interface GeocodeResult {
  name: string;
  /** region / state; '' when unknown */
  admin1: string;
  country: string;
  /** ISO 3166-1 alpha-2, upper case; '' when unknown */
  countryCode: string;
  lat: number;
  lon: number;
  /** IANA time zone; '' when unknown */
  timezone: string;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
}

/**
 * FLAT per-screen VIEW of the v2 config (docs/ARCHITECTURE.md): global sections merged with ONE screen's sections,
 * in the historical v1 shape (+ the new global keys). This is what admin sections edit (`SectionProps.cfg`);
 * build it with `projectScreen()` and write it back with `applyScreen()` from web/shared/screens.ts.
 * NOT the stored/wire format any more: GET/PUT /api/admin/config use `StoredConfig`.
 */
export interface AppConfig {
  version: number;
  revision: number;
  /** id of the screen this view was projected from */
  screenId: string;
  slug: string;
  defaultScreen: string;
  screen: ScreenConfig;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: CalendarConfig<CalendarSource>;
  datetime: DateTimeConfig;
  weather: WeatherConfig;
  news: NewsConfig;
  todo: TodoConfig;
  message: MessageConfig;
  countdowns: CountdownsConfig & ScreenCountdownsConfig;
  alerts: ScreenAlertsConfig;
  localEvents: LocalEventsConfig;
  birthdays: BirthdaysConfig;
  eventRules: { items: EventRule[] };
  schedules: { items: ScheduledMessage[] };
  homeassistant: HomeAssistantConfig;
  auth: AuthConfig;
  security: SecurityConfig;
  privacy: ScreenPrivacyConfig;
}

/** GET /api/display/config[?screen=<slug|id>] */
export interface DisplayConfig {
  revision: number;
  /** v2 fields below are always sent by the server; optional only because older cached payloads lack them. */
  screenId?: string;
  slug?: string;
  /** true when ?screen= did not match any screen and the default screen was served instead */
  screenFallback?: boolean;
  screen: ScreenConfig;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: CalendarConfig<PublicCalendarSource>;
  datetime: DateTimeConfig;
  weather: WeatherConfig;
}

/** CalEvent from GET /api/events */
export interface CalEvent {
  id: string;
  sourceId: string;
  title: string;
  /** ISO with offset, or YYYY-MM-DD for allDay */
  start: string;
  /** exclusive end; ISO with offset, or YYYY-MM-DD for allDay */
  end: string;
  allDay: boolean;
  location?: string | null;
  color: string;
  emoji?: string | null;
  kind: SourceKind;
  multiDay: boolean;
  description?: string | null;
  /** F2: birthdays with a known birth year (and birthdays.showAge) → age turned on that day. Display: "🎂 María (34)" */
  age?: number | null;
  /** privacy mode: a "Busy" block (title already in the screen's language, no location, emoji or description) */
  busy?: boolean;
}

export interface EventsResponse {
  generatedAt: string;
  hash: string;
  events: CalEvent[];
  errors: { sourceId: string; message: string }[];
}

export interface WeatherCurrent {
  temp: number;
  feelsLike: number | null;
  humidity: number | null;
  windKmh: number | null;
  windDir: number | null; // degrees
  windDirLabel: string;
  code: number; // WMO
  isDay: boolean;
  description: string;
  pressure?: number | null;
  uv?: number | null;
}

export interface WeatherToday {
  sunrise: string | null;
  sunset: string | null;
  min: number;
  max: number;
  precipChance: number | null;
}

export interface WeatherDaily {
  date: string; // YYYY-MM-DD
  code: number;
  min: number;
  max: number;
  precipChance: number | null;
  windKmh: number | null;
}

export interface WeatherHourly {
  time: string;
  temp: number;
  code: number;
  precipChance: number | null;
  isDay: boolean;
}

/** Where the weather comes from: the display shows `name` (and `modelName`) small, as the licences ask. */
export interface WeatherSource {
  provider: Exclude<WeatherProvider, 'homeassistant'>;
  name: string;
  model: OpenMeteoModel | null;
  modelName: string | null;
  url: string;
  /** e.g. 'CC BY 4.0'; empty when the provider names none */
  licence: string;
  licenceUrl: string;
  /** another source on top (current conditions from Home Assistant) */
  also?: string;
}

/**
 * Fields a source does not have are null (MET Norway has no precipitation probability outside the Nordics,
 * some Open-Meteo models have no UV index): the display leaves them out.
 */
export interface WeatherResponse {
  updatedAt: string;
  locationName: string;
  current: WeatherCurrent;
  today: WeatherToday;
  daily: WeatherDaily[];
  hourly: WeatherHourly[];
  indoor: { temp: number | null; humidity: number | null } | null;
  /** since 0.5; missing from older servers (then it is Open-Meteo) */
  source?: WeatherSource;
}

/** GET /api/admin/weather/key: the key itself is never sent back. */
export interface WeatherKeyStatus {
  set: boolean;
  /** last 4 characters of the stored key, to recognise it */
  hint: string;
  /** PUT only: the provider accepted the key on a test call (false when that could not be tried) */
  checked?: boolean;
}

export interface Photo {
  url: string;
  author?: string;
  title?: string;
  source: 'stock' | 'gallery';
  /** gallery file name (gallery photos only) */
  file?: string;
  /** Focal point (0..1 of width / height, from the top-left) the cover crop is kept around. Gallery only. */
  focusX?: number;
  focusY?: number;
}

export interface PhotosResponse {
  photos: Photo[];
}

/** Feature flags in GET /api/health. A self-hosted server turns them all on except googleCalendar and googleLogin
 *  (on when Google credentials are set), accountMenu and microsoftCalendar. No `features` field at all (older servers) means every
 *  feature is on except accountMenu; a missing key counts as off only when `edition` is not 'self-hosted'. */
export interface Features {
  homeassistant: boolean;
  news: boolean;
  customCss: boolean;
  gallery: boolean;
  schedules: boolean;
  announcements: boolean;
  displayCommands: boolean;
  openDisplayAccess: boolean;
  insecureTls: boolean;
  googleCalendar: boolean;
  googleLogin: boolean;
  passwordLogin: boolean;
  apiTokens: boolean;
  webhooks: boolean;
  backups: boolean;
  importExport: boolean;
  includeSecrets: boolean;
  activity: boolean;
  setupWizard: boolean;
  status: boolean;
  accountMenu: boolean;
  /** Outlook.com, Hotmail and Microsoft 365 calendars (read only, Microsoft Graph). Off unless the server says so. */
  microsoftCalendar: boolean;
  /** Update banner, settings and the update button (self-hosted only; absent on older servers = off). */
  updates: boolean;
  /** Help and feedback form that reaches the people who run the server (Marco Cloud only; absent = off). */
  feedback: boolean;
  /** Privacy mode per screen (/api/admin/privacy, /api/hooks/privacy). Absent = off. */
  privacy: boolean;
  /** Doorbell ring overlay, POST /api/hooks/doorbell and the admin card (absent = off). */
  doorbell: boolean;
  /** Doorbell frames are a live camera picture proxied from Home Assistant (self-hosted). Off: the frame URL returns
   *  the latest uploaded snapshot (absent = off). */
  doorbellLive: boolean;
}

export type FeatureName = keyof Features;

/** Plan limits in GET /api/health. Absent (self-hosted) = no limit. */
export interface Limits {
  screens?: number;
  sources?: number;
  devices?: number;
  photos?: number;
  /** bytes per photo */
  photoBytes?: number;
  /** bytes for all photos together */
  totalPhotoBytes?: number;
  newsFeeds?: number;
  apiTokens?: number;
  backups?: number;
  /** webhook commands per day */
  hookCommandsPerDay?: number;
  /** bytes of custom CSS per screen */
  customCssBytes?: number;
  /** list caps; absent = the config validator's own caps (web/admin/caps.ts BUILTIN_LIMITS) */
  localEvents?: number;
  birthdays?: number;
  countdowns?: number;
}

export interface HealthResponse {
  ok: boolean;
  /** seconds since the server started; null where there is no long-running process */
  uptime: number | null;
  version: string;
  /**
   * How displays get live updates: 'sse' = /api/stream, 'poll' = GET /api/display/poll (the display falls back to a
   * config revision poll when that answers 404). Absent (old servers) = 'sse'.
   */
  live?: 'sse' | 'poll';
  /** Absent on servers older than 0.5.0. */
  edition?: 'self-hosted' | 'cloud';
  tenancy?: 'single' | 'multi';
  runtime?: 'node' | 'workers';
  /** Characters in a pairing code shown on a TV (6 when absent). */
  pairCodeLength?: number;
  features?: Partial<Features>;
  limits?: Limits;
  /** Absolute origin that serves the display pages (/d/<key>, /pair). Absent = same origin as the admin. */
  displayOrigin?: string;
  /** Absolute origin of the admin, for a display served from another origin. Absent = same origin as the display. */
  adminOrigin?: string;
  /** This server's LAN addresses; only sent to a client on the server itself (a kiosk on http://localhost). */
  lanAddresses?: string[];
}

// ---- Admin API ----

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  method: 'password' | 'google' | 'account' | 'homeassistant';
}

/** Marco Cloud: where the account pages live and which household the admin edits. */
export interface AccountInfo {
  loginUrl: string;
  accountUrl: string;
  sessionsUrl: string;
  deleteUrl: string;
  household: HouseholdInfo;
}

export interface HouseholdInfo {
  name: string;
  role: 'owner' | 'member';
}

export interface AuthMeResponse {
  user: AuthUser | null;
  /** The panel uses Home Assistant's authenticated admin session. */
  homeAssistant?: boolean;
  googleConfigured: boolean;
  /** Sign in with Google is offered (self-hosted: off unless the server relies on it or MARCO_GOOGLE_LOGIN=1). */
  googleLoginEnabled?: boolean;
  passwordLoginEnabled: boolean;
  /** Logged in with the initial/default password: it must be changed (only accepted from the LAN until then). */
  mustChangePassword?: boolean;
  /** Compatibility metadata for deployments that predate HA authentication. */
  needsSetup?: boolean;
  /** The initial password came from ADMIN_PASSWORD (headless install): the panel offers to change it. */
  passwordFromEnv?: boolean;
  /** Only when user.method is 'account' (Marco Cloud). */
  account?: AccountInfo;
  /** Marco Cloud: the admin shows the Microsoft accounts card when it is true (Microsoft calendars on for this account). */
  microsoftConfigured?: boolean;
}

export interface HaCalendarListItem {
  entity_id: string;
  name: string;
}

export interface TestIcsResponse {
  ok: boolean;
  count?: number;
  sample?: string[];
  error?: string;
}

export interface HaEntity {
  entity_id: string;
  name: string;
  state: string;
  unit?: string;
}

export interface AdminPhoto {
  file: string;
  /** includes a ?v=<mtime> cache-busting version */
  url: string;
  /** small JPEG preview for the grid (falls back to `url` until one exists) */
  thumbUrl?: string;
  hasThumb?: boolean;
  size: number;
  mtime: string | number;
  /** pixel size as displayed (EXIF orientation applied) */
  w?: number;
  h?: number;
  focusX?: number;
  focusY?: number;
  uploadedAt?: string;
  /** excluded from the background rotation */
  hidden?: boolean;
}

export type PhotoConflictPolicy = 'replace' | 'rename' | 'skip';

export interface PhotoNameCheck {
  name: string;
  /** the name the server will store it under */
  sanitized: string;
  exists: boolean;
  /** name it would get with "keep both" */
  renamed?: string;
}

export interface PhotoUploadResult {
  ok: true;
  files: (AdminPhoto & { status: 'created' | 'replaced' | 'renamed'; requested: string })[];
  skipped: string[];
}

export type AlertStyle = 'info' | 'success' | 'warning' | 'urgent';
// ---- §2 stored config (data/config.json, GET/PUT /api/admin/config) ----

export interface ScreenCountdownsConfig {
  enabled: boolean;
  /** max chips shown (display may show fewer if space is short) 1..12 */
  max: number;
}

export interface ScreenAlertsConfig {
  /** show announcements + scheduled messages on this screen */
  enabled: boolean;
  /** play the WebAudio chime when an alert asks for it */
  sound: boolean;
  /** 0..1 */
  volume: number;
}

/** One screen profile (F1). `screen.name` lives in `name`. */
export interface ScreenProfile {
  id: string; // "s_xxx", stable, never changes
  slug: string; // URL key for ?screen=, unique, ^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$
  name: string;
  screen: Omit<ScreenConfig, 'name'>;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: Pick<CalendarConfig, 'enabled' | 'view' | 'weeks' | 'weekStart' | 'showLocation' | 'showEndTime' | 'showDayXofY' | 'showLegend' | 'hidePast' | 'maxEventsPerDay' | 'marquee' | 'rotateBusyDays' | 'compactBusyDays'> & { sourceIds: string[] | null };
  datetime: Omit<DateTimeConfig, 'timezone'>;
  weather: Pick<WeatherConfig, 'enabled' | 'forecastDays' | 'showHourly' | 'showPrecipChance'>;
  news: { enabled: boolean; rotateSec: number };
  todo: { enabled: boolean };
  message: MessageConfig;
  countdowns: ScreenCountdownsConfig;
  alerts: ScreenAlertsConfig;
  privacy: ScreenPrivacyConfig;
}

export type RepeatFreq = 'none' | 'weekly' | 'monthly' | 'yearly';

/** F2 local event (dates/times are local to datetime.timezone). */
export interface LocalEvent {
  id: string; // "l_xxx"
  title: string;
  emoji: string; // '' → icon rules / localEvents.emoji
  color: string | null; // null → localEvents.color
  location: string;
  notes: string;
  allDay: boolean;
  date: string; // YYYY-MM-DD first day
  endDate: string; // YYYY-MM-DD last day, INCLUSIVE (= date for single-day)
  startTime: string; // 'HH:MM' when !allDay, else ''
  endTime: string; // 'HH:MM' when !allDay (on endDate), else ''
  repeat: {
    freq: RepeatFreq;
    interval: number; // every N weeks/months/years, 1..99
    until: string | null; // YYYY-MM-DD inclusive (last occurrence start), null = forever
    weekdays: number[]; // weekly only, 0 = Sunday … 6; [] = weekday of `date`
  };
  /** occurrence start dates (YYYY-MM-DD) that are skipped */
  exceptions: string[];
  /** also show as a countdown chip (F4) */
  countdown: boolean;
}

export interface LocalEventsConfig {
  enabled: boolean;
  name: string; // legend name of the 'local' source
  color: string;
  emoji: string;
  /** privacy mode for local events (default 'busy') */
  privacy?: PrivacyMode;
  items: LocalEvent[];
}

/** F2 birthday → yearly all-day event of kind 'birthdays' on source 'birthdays'. */
export interface Birthday {
  id: string; // "b_xxx"
  name: string;
  month: number; // 1..12
  day: number; // 1..31 (29/02 → 28/02 on non-leap years)
  year: number | null; // birth year → age
  emoji: string; // '' → birthdays.emoji
}

export interface BirthdaysConfig {
  enabled: boolean;
  name: string;
  color: string;
  emoji: string;
  showAge: boolean;
  /** privacy mode for birthdays (default 'keep') */
  privacy?: PrivacyMode;
  items: Birthday[];
}

export type EventRuleAction = 'hide' | 'rename' | 'style';

/** F3 filter / override rule. Evaluated: hide → rename (in order, chained) → style (first match). */
export interface EventRule {
  id: string; // "f_xxx"
  enabled: boolean;
  action: EventRuleAction;
  /** accent/case-insensitive text */
  match: string;
  matchMode: 'contains' | 'exact' | 'startsWith';
  /** 'title' or 'any' (title + description + location) */
  field: 'title' | 'any';
  /** [] = every source (ids may include 'local' / 'birthdays') */
  sourceIds: string[];
  /** rename: replacement for the matched text (contains/startsWith) or the whole title (exact) */
  replaceWith: string;
  /** style: '' = unchanged */
  emoji: string;
  /** style: null = unchanged */
  color: string | null;
  /** style: also show matching events as countdown chips (F4) */
  countdown: boolean;
  note: string;
}

/** F4 manual countdown. */
export interface Countdown {
  id: string; // "k_xxx"
  title: string;
  emoji: string;
  color: string | null;
  date: string; // YYYY-MM-DD
  yearly: boolean; // repeats every year on the same month/day
}

/** Global countdown settings (per-screen enabled/max live in ScreenCountdownsConfig). */
export interface CountdownsConfig {
  items: Countdown[];
  includeBirthdays: boolean;
  /** birthdays are included when they are ≤ N days away */
  birthdayDays: number;
  /** include events flagged `countdown` (local events, style rules) */
  includeFlagged: boolean;
  /** ignore anything further than N days */
  horizonDays: number;
}

/** F5 scheduled message (recurring time window). */
export interface ScheduledMessage {
  id: string; // "m_xxx"
  enabled: boolean;
  title: string;
  body: string;
  emoji: string;
  style: AlertStyle;
  /** 0 = Sunday … 6; [] = every day. The day refers to the START of the window. */
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM; to < from → window crosses midnight
  startDate: string | null; // YYYY-MM-DD inclusive
  endDate: string | null;
  /** screen ids; [] = all screens */
  screenIds: string[];
  /** chime when the window starts */
  sound: boolean;
}

/** v2 stored config: GET/PUT /api/admin/config, backups, export. */
export interface StoredConfig {
  version: 2;
  revision: number;
  defaultScreen: string;
  screens: ScreenProfile[];
  calendar: { sources: CalendarSource[]; iconRules: IconRule[] };
  datetime: { timezone: string };
  weather: Omit<WeatherConfig, 'enabled' | 'forecastDays' | 'showHourly' | 'showPrecipChance'>;
  news: { feeds: NewsFeed[]; maxItems: number };
  todo: { items: TodoItem[] };
  localEvents: LocalEventsConfig;
  birthdays: BirthdaysConfig;
  eventRules: { items: EventRule[] };
  countdowns: CountdownsConfig;
  schedules: { items: ScheduledMessage[] };
  homeassistant: HomeAssistantConfig;
  auth: AuthConfig;
  security: SecurityConfig;
}

/** PUT /api/admin/config body: the whole config plus the revision the admin loaded it at. A stale `baseRevision`
 *  gets 409 {error:'conflict', revision}; without it the last write wins. */
export type SaveConfigRequest = StoredConfig & { baseRevision?: number };

export interface StreamHello {
  revision: number;
  screenId: string;
  serverVersion: string;
  now: string; // server ISO time for clock synchronization
}
