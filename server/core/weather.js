// Weather providers: request URLs, response normalizers and one fetch entry point, shared by self-hosted Marco
// (server/weather.js) and Marco Cloud. Pure: the caller passes `fetch`, the clock and its own cache entry, so
// nothing here touches the network on its own, keeps state or imports a Node module.
//
//   open-meteo      Open-Meteo forecast API, no key, a choice of forecast models (CC BY 4.0)
//   met-norway      MET Norway Locationforecast 2.0, no key (CC BY 4.0 / NLOD); needs an identifying User-Agent,
//                   honours Expires and If-Modified-Since, coordinates with at most 4 decimals
//   pirate-weather  Pirate Weather, the household's own free API key (10,000 calls a month on the free plan)
//
// Every provider is normalized into one language-free "base" ({ current, days, hourly, source, ... }) that is
// cached per place, then localizeWeather() turns it into the WeatherResponse a screen reads (descriptions and wind
// labels in the screen's language). Fields a provider does not have stay null and the display leaves them out.
import { wmoDescription, windDirLabel } from './lib/i18n.js';
import { isoWithOffset, localDate } from './lib/tz.js';
import { hash } from './lib/text.js';

/** Data sources the admin offers (Home Assistant is a self-hosted extra on top of Open-Meteo, see server/weather.js). */
export const WEATHER_PROVIDERS = Object.freeze(['open-meteo', 'met-norway', 'pirate-weather']);
/** Every value weather.provider may hold. */
export const WEATHER_PROVIDER_IDS = Object.freeze([...WEATHER_PROVIDERS, 'homeassistant']);
/** Providers that need the household's own API key (kept with the secrets, never in the config). */
export const KEY_PROVIDERS = Object.freeze(['pirate-weather']);

/** Credit for each source: the display shows `short`, the admin the rest. */
export const PROVIDER_INFO = Object.freeze({
  'open-meteo': { name: 'Open-Meteo', short: 'Open-Meteo', url: 'https://open-meteo.com/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'met-norway': { name: 'MET Norway', short: 'MET Norway', url: 'https://api.met.no/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'pirate-weather': { name: 'Pirate Weather', short: 'Pirate Weather', url: 'https://pirateweather.net/', licence: '', licenceUrl: '' },
});

/**
 * Open-Meteo forecast models offered in the admin. `best_match` lets Open-Meteo pick the best model for the place.
 * A regional model asked for outside its area answers with ECMWF (or nothing), so only global or "seamless" ones
 * are listed. Some models have no precipitation probability or UV index, or fewer days: those fields stay empty.
 */
export const OPEN_METEO_MODELS = Object.freeze([
  { id: 'best_match', name: 'Auto' },
  { id: 'ecmwf_ifs', name: 'ECMWF IFS' },
  { id: 'icon_seamless', name: 'DWD ICON' },
  { id: 'gfs_seamless', name: 'NOAA GFS' },
  { id: 'meteofrance_seamless', name: 'Météo-France' },
  { id: 'ukmo_seamless', name: 'UK Met Office' },
  { id: 'gem_seamless', name: 'GEM (Canada)' },
  { id: 'jma_seamless', name: 'JMA (Japan)' },
]);
export const OPEN_METEO_MODEL_IDS = Object.freeze(OPEN_METEO_MODELS.map((m) => m.id));

/** Minimum time between two calls for the same place (MET Norway may ask for longer with Expires). */
export const WEATHER_TTL_MS = Object.freeze({ 'open-meteo': 10 * 60_000, 'met-norway': 10 * 60_000, 'pirate-weather': 15 * 60_000 });
/** How long a cached answer may still be shown while the provider fails. */
export const WEATHER_STALE_MS = 6 * 3600_000;

const round1 = (n) => (n == null || n === '' || Number.isNaN(+n) ? null : Math.round(+n * 10) / 10);
const round0 = (n) => (n == null || n === '' || Number.isNaN(+n) ? null : Math.round(+n));
const num = (n) => (n == null || n === '' || Number.isNaN(+n) ? null : +n);
const cToF = (c) => (c == null ? null : c * 9 / 5 + 32);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Coordinates as they are sent to a provider and used in cache keys: 2 decimals (about 1 km). */
export const roundCoord = (n) => Math.round(Number(n) * 100) / 100;

/** Days asked from a provider: at least 8 (so households showing 1 to 7 days share one cached answer). */
export const fetchDays = (forecastDays) => Math.max(8, Math.min(15, (Number(forecastDays) || 5) + 1));

/** Local ISO without offset (Open-Meteo) plus an offset in seconds → ISO with offset. */
export function withOffset(localIso, offsetSec) {
  if (!localIso) return null;
  const sign = offsetSec >= 0 ? '+' : '-';
  const a = Math.abs(offsetSec);
  const hh = String(Math.floor(a / 3600)).padStart(2, '0');
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, '0');
  const base = localIso.length === 16 ? `${localIso}:00` : localIso;
  return `${base}${sign}${hh}:${mm}`;
}

// ---------------------------------------------------------------------------------------------- sun

const RAD = Math.PI / 180;
/**
 * Sunrise and sunset of a local date at a place (the sunrise equation, within a minute or two). Returns Dates, or
 * null for both with `polar: 'day' | 'night'` when the sun does not rise or set that day.
 */
export function sunTimes(dateStr, lat, lon) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const n = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5 - 2451545; // days since J2000.0 at noon UTC
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * L * RAD);
  const sinDec = Math.sin(L * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosW > 1) return { sunrise: null, sunset: null, polar: 'night' };
  if (cosW < -1) return { sunrise: null, sunset: null, polar: 'day' };
  const w = Math.acos(cosW) / RAD / 360;
  const toDate = (j) => new Date(Math.round((j - 2440587.5) * 86400000));
  return { sunrise: toDate(transit - w), sunset: toDate(transit + w), polar: null };
}

/** True when the sun is up at `at` (a Date) at the place, for a zone `tz`. */
export function isDayAt(at, lat, lon, tz) {
  const s = sunTimes(localDate(at, tz), lat, lon);
  if (s.polar) return s.polar === 'day';
  return at >= s.sunrise && at < s.sunset;
}

// ---------------------------------------------------------------------------------------------- codes

/** MET Norway symbol (without _day / _night / _polartwilight) → WMO code. */
const MET_SYMBOLS = {
  clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
  lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
  lightrain: 61, rain: 63, heavyrain: 65,
  lightsleetshowers: 68, sleetshowers: 68, heavysleetshowers: 69,
  lightsleet: 68, sleet: 68, heavysleet: 69,
  lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
  lightsnow: 71, snow: 73, heavysnow: 75,
};

/** WMO code of a MET Norway symbol code, or null. Anything "andthunder" is a thunderstorm. */
export function metSymbolToWmo(symbol) {
  if (typeof symbol !== 'string' || !symbol) return null;
  const base = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('thunder')) return 95;
  return MET_SYMBOLS[base] ?? null;
}

const PIRATE_ICONS = {
  'clear': 0, 'mostly-clear': 1, 'partly-cloudy': 2, 'mostly-cloudy': 3, 'cloudy': 3,
  'fog': 45, 'mist': 45, 'haze': 45, 'smoke': 45,
  'drizzle': 53, 'light-rain': 61, 'rain': 63, 'heavy-rain': 65, 'precipitation': 61,
  'very-light-sleet': 68, 'light-sleet': 68, 'sleet': 68, 'heavy-sleet': 69, 'mixed': 68,
  'flurries': 85, 'light-snow': 71, 'snow': 73, 'heavy-snow': 75,
  'possible-rain': 80, 'possible-precipitation': 80, 'possible-snow': 85, 'possible-sleet': 68, 'possible-thunderstorm': 95,
  'thunderstorm': 95, 'hail': 96,
};

/** WMO code from cloud cover 0..1 (wind, breezy and unknown icons say nothing about the sky). */
const cloudCode = (cc) => (cc == null ? null : cc < 0.15 ? 0 : cc < 0.4 ? 1 : cc < 0.7 ? 2 : 3);

/** WMO code of a Pirate Weather icon (default or icon=pirate set), or null. */
export function pirateIconToWmo(icon, cloudCover = null) {
  if (typeof icon !== 'string' || !icon) return cloudCode(num(cloudCover));
  const base = icon.replace(/-(day|night)$/, '');
  if (base in PIRATE_ICONS) return PIRATE_ICONS[base];
  return cloudCode(num(cloudCover)); // wind, breezy, dangerous-wind, none
}

/** Most severe code of a list (higher WMO codes are worse weather), or null. */
const worst = (codes) => codes.reduce((a, c) => (c == null ? a : a == null || c > a ? c : a), null);
const maxOf = (vals) => vals.reduce((a, v) => (v == null ? a : a == null || v > a ? v : a), null);
const minOf = (vals) => vals.reduce((a, v) => (v == null ? a : a == null || v < a ? v : a), null);

// ---------------------------------------------------------------------------------------------- Open-Meteo

/** Open-Meteo forecast URL. `w`: { lat, lon, units, forecastDays, model? }. */
export function openMeteoUrl(w, tz) {
  const q = new URLSearchParams({
    latitude: String(w.lat),
    longitude: String(w.lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,uv_index',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max',
    timezone: tz || 'auto',
    wind_speed_unit: 'kmh',
    temperature_unit: w.units === 'imperial' ? 'fahrenheit' : 'celsius',
    forecast_days: String(Math.max(2, Math.min(16, w.forecastDays + 1))),
  });
  if (w.model && w.model !== 'best_match') q.set('models', w.model);
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Open-Meteo answer → base. Days without a temperature (a model's horizon ends) are dropped. */
export function baseFromOpenMeteo(j, { model = 'best_match', tz = null } = {}) {
  const off = j.utc_offset_seconds || 0;
  const c = j.current || {};
  const d = j.daily || {};
  const h = j.hourly || {};
  const current = {
    temp: round1(c.temperature_2m),
    feelsLike: round1(c.apparent_temperature),
    humidity: round0(c.relative_humidity_2m),
    windKmh: round0(c.wind_speed_10m),
    windDir: round0(c.wind_direction_10m),
    code: c.weather_code ?? null,
    isDay: c.is_day === 1 || c.is_day === true,
    pressure: round0(c.pressure_msl),
    uv: round1(c.uv_index),
  };
  const days = (d.time || []).map((date, i) => ({
    date,
    code: d.weather_code?.[i] ?? null,
    min: round1(d.temperature_2m_min?.[i]),
    max: round1(d.temperature_2m_max?.[i]),
    precipChance: round0(d.precipitation_probability_max?.[i]),
    windKmh: round0(d.wind_speed_10m_max?.[i]),
    sunrise: withOffset(d.sunrise?.[i], off),
    sunset: withOffset(d.sunset?.[i], off),
  })).filter((x, i) => i === 0 || (x.min != null && x.max != null));
  const hourly = (h.time || []).map((time, i) => ({
    time: withOffset(time, off),
    temp: round1(h.temperature_2m?.[i]),
    code: h.weather_code?.[i] ?? null,
    precipChance: round0(h.precipitation_probability?.[i]),
    isDay: h.is_day?.[i] === 1,
  })).filter((x) => x.temp != null);
  return { provider: 'open-meteo', model, tz: tz || j.timezone || 'UTC', current, days, hourly };
}

// ---------------------------------------------------------------------------------------------- MET Norway

/** Locationforecast 2.0 "complete" (adds UV and, in the Nordics, precipitation probability). At most 4 decimals. */
export function metNorwayUrl(lat, lon) {
  const t = (n) => String(Math.trunc(Number(n) * 10_000) / 10_000);
  return `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${t(lat)}&lon=${t(lon)}`;
}

/**
 * MET Norway answer → base. Times are UTC; days are cut in `tz`. Hourly steps cover about 2.5 days, then 6-hour
 * steps. Sunrise and sunset are computed (Locationforecast has none). Temperatures come in °C and wind in m/s.
 */
export function baseFromMetNorway(j, { tz, units = 'metric', lat, lon, now = new Date() }) {
  const ts = Array.isArray(j?.properties?.timeseries) ? j.properties.timeseries : [];
  if (!ts.length) throw new Error('MET Norway: empty forecast');
  const coords = j?.geometry?.coordinates;
  lon = lon ?? coords?.[0];
  lat = lat ?? coords?.[1];
  const temp = (c) => round1(units === 'imperial' ? cToF(num(c)) : num(c));
  const symbolOf = (e) => e.data?.next_1_hours?.summary?.symbol_code ?? e.data?.next_6_hours?.summary?.symbol_code ?? e.data?.next_12_hours?.summary?.symbol_code;
  const probOf = (e) => num(e.data?.next_1_hours?.details?.probability_of_precipitation ?? e.data?.next_6_hours?.details?.probability_of_precipitation);
  const dayFlag = (sym, at) => {
    if (typeof sym === 'string' && /_day$/.test(sym)) return true;
    if (typeof sym === 'string' && /_(night|polartwilight)$/.test(sym)) return false;
    return lat == null ? true : isDayAt(at, lat, lon, tz);
  };
  const nowMs = now.getTime();
  // current: the step covering now (the first one, unless the answer is older than an hour)
  let cur = ts[0];
  for (const e of ts) {
    if (Date.parse(e.time) <= nowMs) cur = e;
    else break;
  }
  const ci = cur.data?.instant?.details || {};
  const curSym = symbolOf(cur);
  const current = {
    temp: temp(ci.air_temperature),
    feelsLike: ci.apparent_air_temperature != null ? temp(ci.apparent_air_temperature) : null,
    humidity: round0(ci.relative_humidity),
    windKmh: round0(num(ci.wind_speed) == null ? null : ci.wind_speed * 3.6),
    windDir: round0(ci.wind_from_direction),
    code: metSymbolToWmo(curSym),
    isDay: dayFlag(curSym, new Date(Date.parse(cur.time))),
    pressure: round0(ci.air_pressure_at_sea_level),
    uv: round1(ci.ultraviolet_index_clear_sky),
  };

  const hourly = [];
  for (let i = 0; i < ts.length; i++) {
    const e = ts[i];
    const next = ts[i + 1];
    if (!next || Date.parse(next.time) - Date.parse(e.time) > 3600_000) break; // hourly part only
    const sym = e.data?.next_1_hours?.summary?.symbol_code;
    const at = new Date(Date.parse(e.time));
    hourly.push({
      time: isoWithOffset(at, tz),
      temp: temp(e.data?.instant?.details?.air_temperature),
      code: metSymbolToWmo(sym),
      precipChance: round0(probOf(e)),
      isDay: dayFlag(sym, at),
    });
  }

  // days: every step whose time falls on the local date. Temperatures: instants plus the 6-hour max / min of
  // periods that start that day; code: the worst symbol of the daytime periods (06:00 to 18:00), like Open-Meteo's
  // daily weather_code; precipitation probability: the highest one given (Nordic area only).
  const byDate = new Map();
  for (const e of ts) {
    const at = new Date(Date.parse(e.time));
    const date = localDate(at, tz);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ e, at });
  }
  const today = localDate(now, tz);
  const days = [];
  for (const [date, list] of byDate) {
    if (date < today) continue;
    const temps = [];
    const codes = [];
    const allCodes = [];
    const probs = [];
    const winds = [];
    for (const { e, at } of list) {
      const d = e.data || {};
      temps.push(num(d.instant?.details?.air_temperature), num(d.next_6_hours?.details?.air_temperature_max), num(d.next_6_hours?.details?.air_temperature_min));
      winds.push(num(d.instant?.details?.wind_speed));
      probs.push(probOf(e));
      const hour = Number(isoWithOffset(at, tz).slice(11, 13));
      const sym = d.next_6_hours?.summary?.symbol_code ?? d.next_1_hours?.summary?.symbol_code;
      const code = metSymbolToWmo(sym);
      allCodes.push(code);
      if (hour >= 6 && hour < 18) codes.push(code);
    }
    const mn = minOf(temps);
    const mx = maxOf(temps);
    if (mn == null || mx == null) continue;
    const sun = lat == null ? { sunrise: null, sunset: null } : sunTimes(date, lat, lon);
    const w = maxOf(winds);
    days.push({
      date,
      code: worst(codes) ?? worst(allCodes),
      min: temp(mn),
      max: temp(mx),
      precipChance: round0(maxOf(probs)),
      windKmh: w == null ? null : round0(w * 3.6),
      sunrise: sun.sunrise ? isoWithOffset(sun.sunrise, tz) : null,
      sunset: sun.sunset ? isoWithOffset(sun.sunset, tz) : null,
    });
  }
  // A last day with a single step (the answer ends at 00:00) says little: drop it.
  if (days.length > 1 && (byDate.get(days[days.length - 1].date)?.length ?? 0) < 2) days.pop();
  return { provider: 'met-norway', model: null, tz, current, days, hourly };
}

// ---------------------------------------------------------------------------------------------- Pirate Weather

/** Pirate Weather forecast URL (the key is part of the path). `ca` = °C and km/h, `us` = °F and mph. */
export function pirateWeatherUrl(key, lat, lon, units = 'metric') {
  const q = new URLSearchParams({ units: units === 'imperial' ? 'us' : 'ca', exclude: 'minutely,alerts', icon: 'pirate', version: '2' });
  return `https://api.pirateweather.net/forecast/${encodeURIComponent(key)}/${lat},${lon}?${q}`;
}

/** Pirate Weather answer → base. Times are Unix seconds; humidity, cloud cover and probabilities are 0..1. */
export function basePirateWeather(j, { tz, units = 'metric', lat, lon, now = new Date() }) {
  if (!isObj(j) || !isObj(j.currently)) throw new Error('Pirate Weather: no current conditions');
  lat = lat ?? num(j.latitude);
  lon = lon ?? num(j.longitude);
  tz = tz || j.timezone || 'UTC';
  const wind = (v) => {
    const n = num(v);
    if (n == null) return null;
    return round0(units === 'imperial' ? n * 1.609344 : n);
  };
  const pct = (v) => (num(v) == null ? null : round0(v * 100));
  const isDayIcon = (icon, at) => {
    if (typeof icon === 'string' && /-day$/.test(icon)) return true;
    if (typeof icon === 'string' && /-night$/.test(icon)) return false;
    return lat == null ? true : isDayAt(at, lat, lon, tz);
  };
  const c = j.currently;
  const nowAt = new Date(num(c.time) ? c.time * 1000 : now.getTime());
  const current = {
    temp: round1(c.temperature),
    feelsLike: round1(c.apparentTemperature),
    humidity: pct(c.humidity),
    windKmh: wind(c.windSpeed),
    windDir: round0(c.windBearing),
    code: pirateIconToWmo(c.icon, c.cloudCover),
    isDay: isDayIcon(c.icon, nowAt),
    pressure: round0(c.pressure),
    uv: round1(c.uvIndex),
  };
  const hourly = (Array.isArray(j.hourly?.data) ? j.hourly.data : []).filter((h) => num(h?.time) != null).map((h) => {
    const at = new Date(h.time * 1000);
    return {
      time: isoWithOffset(at, tz),
      temp: round1(h.temperature),
      code: pirateIconToWmo(h.icon, h.cloudCover),
      precipChance: pct(h.precipProbability),
      isDay: isDayIcon(h.icon, at),
    };
  }).filter((h) => h.temp != null);
  const days = (Array.isArray(j.daily?.data) ? j.daily.data : []).filter((d) => num(d?.time) != null).map((d) => ({
    // the day starts at local midnight: noon of that day names it safely across zones
    date: localDate(new Date(d.time * 1000 + 12 * 3600_000), tz),
    code: pirateIconToWmo(d.icon, d.cloudCover),
    min: round1(d.temperatureMin ?? d.temperatureLow),
    max: round1(d.temperatureMax ?? d.temperatureHigh),
    precipChance: pct(d.precipProbability),
    windKmh: wind(d.windSpeed),
    sunrise: num(d.sunriseTime) ? isoWithOffset(new Date(d.sunriseTime * 1000), tz) : null,
    sunset: num(d.sunsetTime) ? isoWithOffset(new Date(d.sunsetTime * 1000), tz) : null,
  })).filter((d) => d.min != null && d.max != null);
  return { provider: 'pirate-weather', model: null, tz, current, days, hourly };
}

// ---------------------------------------------------------------------------------------------- one entry point

/**
 * What one weather fetch is for. `w` is the config's weather section (provider, model, lat, lon, units), `tz` the
 * household zone, `forecastDays` the most any screen shows. Home Assistant reads its forecast from Open-Meteo.
 */
export function weatherRequest(w, { tz, forecastDays, apiKey = '' }) {
  const provider = WEATHER_PROVIDERS.includes(w.provider) ? w.provider : 'open-meteo';
  return {
    provider,
    model: provider === 'open-meteo' ? (OPEN_METEO_MODEL_IDS.includes(w.model) ? w.model : 'best_match') : null,
    lat: roundCoord(w.lat),
    lon: roundCoord(w.lon),
    units: w.units === 'imperial' ? 'imperial' : 'metric',
    tz: tz || 'UTC',
    days: fetchDays(forecastDays),
    apiKey: KEY_PROVIDERS.includes(provider) ? String(apiKey || '') : '',
  };
}

/**
 * Cache key of a request: every household at the same rounded place, provider, model, units, zone and days shares
 * one answer. A key provider's answer is also keyed by a hash of the key (each household spends its own quota, and
 * a wrong key never reads a right key's answer).
 */
export function weatherCacheKey(r) {
  const parts = [r.provider, r.model || '-', `${r.lat},${r.lon}`, r.units, r.tz, r.days];
  if (KEY_PROVIDERS.includes(r.provider)) parts.push(r.apiKey ? hash(r.apiKey, 12) : 'nokey');
  return parts.join('/');
}

export class WeatherError extends Error {
  /** code: 'key_missing' | 'key_invalid' | 'rate_limited' | 'http' | 'bad_response' */
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const header = (res, name) => (typeof res.headers?.get === 'function' ? res.headers.get(name) : null);

/**
 * Fetches and normalizes one request. `deps.fetch` is a WHATWG fetch (with its own timeout), `deps.userAgent`
 * identifies the app (MET Norway refuses requests without one), `deps.prev` is the caller's cached entry for the
 * same key (MET Norway gets If-Modified-Since and may answer 304). Returns the entry to cache:
 * { base, fetchedAt, expiresAt, lastModified }. Throws WeatherError.
 * @param {ReturnType<typeof weatherRequest>} r
 * @param {{ fetch: (url: string, init?: any) => Promise<any>, userAgent?: string, prev?: any, now?: () => Date }} deps
 */
export async function fetchWeather(r, { fetch, userAgent = 'Calendar (+https://github.com/mmihaylov00/calendar)', prev = null, now = () => new Date() }) {
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };
  let url;
  if (r.provider === 'met-norway') {
    url = metNorwayUrl(r.lat, r.lon);
    if (prev?.lastModified && prev.base) headers['If-Modified-Since'] = prev.lastModified;
  } else if (r.provider === 'pirate-weather') {
    if (!r.apiKey) throw new WeatherError('key_missing', 'Pirate Weather: no API key');
    url = pirateWeatherUrl(r.apiKey, r.lat, r.lon, r.units);
  } else {
    url = openMeteoUrl({ lat: r.lat, lon: r.lon, units: r.units, forecastDays: r.days - 1, model: r.model }, r.tz);
  }
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new WeatherError('http', `${PROVIDER_INFO[r.provider].name}: ${err?.name === 'AbortError' || err?.name === 'TimeoutError' ? 'timeout' : 'network error'}`);
  }
  const t = now();
  const minTtl = WEATHER_TTL_MS[r.provider];
  const expiresFrom = () => {
    const exp = Date.parse(header(res, 'expires') || '');
    return Math.max(t.getTime() + minTtl, Number.isFinite(exp) ? exp : 0);
  };
  if (res.status === 304 && prev?.base) {
    return { ...prev, base: { ...prev.base, fetchedAt: t.toISOString() }, fetchedAt: t.toISOString(), expiresAt: expiresFrom() };
  }
  if (res.status === 401 || res.status === 403) {
    throw new WeatherError(r.provider === 'pirate-weather' ? 'key_invalid' : 'http', `${PROVIDER_INFO[r.provider].name}: HTTP ${res.status}`, res.status);
  }
  if (res.status === 429) throw new WeatherError('rate_limited', `${PROVIDER_INFO[r.provider].name}: too many requests`, 429);
  if (!res.ok) {
    // Open-Meteo explains a refused request ({ error: true, reason }); keep that for the admin status.
    let reason = '';
    try {
      const j = await res.json();
      if (typeof j?.reason === 'string') reason = `: ${j.reason.slice(0, 200)}`;
    } catch { /* no JSON body */ }
    throw new WeatherError('http', `${PROVIDER_INFO[r.provider].name}: HTTP ${res.status}${reason}`, res.status);
  }
  let j;
  try {
    j = await res.json();
  } catch {
    throw new WeatherError('bad_response', `${PROVIDER_INFO[r.provider].name}: invalid JSON`);
  }
  if (j?.error) throw new WeatherError('bad_response', `${PROVIDER_INFO[r.provider].name}: ${String(j.reason || 'error').slice(0, 200)}`);
  let base;
  try {
    if (r.provider === 'met-norway') base = baseFromMetNorway(j, { tz: r.tz, units: r.units, lat: r.lat, lon: r.lon, now: t });
    else if (r.provider === 'pirate-weather') base = basePirateWeather(j, { tz: r.tz, units: r.units, lat: r.lat, lon: r.lon, now: t });
    else base = baseFromOpenMeteo(j, { model: r.model, tz: r.tz });
  } catch (err) {
    throw new WeatherError('bad_response', err instanceof WeatherError ? err.message : `${PROVIDER_INFO[r.provider].name}: ${err?.message || 'unexpected answer'}`);
  }
  base.fetchedAt = t.toISOString();
  return { base, fetchedAt: t.toISOString(), expiresAt: expiresFrom(), lastModified: header(res, 'last-modified') || null };
}

/** Source block of a WeatherResponse: who the data comes from, for the credit line. */
export function weatherSource(provider, model = null) {
  const info = PROVIDER_INFO[provider] || PROVIDER_INFO['open-meteo'];
  const m = provider === 'open-meteo' && model && model !== 'best_match' ? OPEN_METEO_MODELS.find((x) => x.id === model) : null;
  return {
    provider: PROVIDER_INFO[provider] ? provider : 'open-meteo',
    name: info.name,
    model: m ? m.id : null,
    modelName: m ? m.name : null,
    url: info.url,
    licence: info.licence,
    licenceUrl: info.licenceUrl,
  };
}

/**
 * base → WeatherResponse in a language: descriptions, wind labels, the hours from now on (8), the days from today
 * on. `forecastDays` caps the daily list; `locationName` is the household's own label.
 */
export function localizeWeather(base, { lang, locationName = '', forecastDays = 5, now = new Date() }) {
  const c = base.current || {};
  const current = {
    temp: c.temp ?? null,
    feelsLike: c.feelsLike ?? null,
    humidity: c.humidity ?? null,
    windKmh: c.windKmh ?? null,
    windDir: c.windDir ?? null,
    windDirLabel: windDirLabel(c.windDir, lang),
    code: c.code ?? null,
    isDay: c.isDay !== false,
    description: wmoDescription(c.code, lang),
    pressure: c.pressure ?? null,
    uv: c.uv ?? null,
  };
  const todayKey = base.tz ? localDate(now, base.tz) : null;
  const all = base.days || [];
  const upcoming = todayKey ? all.filter((d) => d.date >= todayKey) : all;
  const days = upcoming.length ? upcoming : all;
  const t0 = days[0] || {};
  const today = { sunrise: t0.sunrise ?? null, sunset: t0.sunset ?? null, min: t0.min ?? null, max: t0.max ?? null, precipChance: t0.precipChance ?? null };
  const nowMs = now.getTime();
  const hourly = [];
  for (const h of base.hourly || []) {
    if (Date.parse(h.time) + 3600_000 <= nowMs) continue; // keep the current hour onward
    if (hourly.length >= 8) break;
    hourly.push({ time: h.time, temp: h.temp ?? null, code: h.code ?? null, precipChance: h.precipChance ?? null, isDay: h.isDay !== false });
  }
  return {
    updatedAt: base.fetchedAt || now.toISOString(),
    locationName,
    current,
    today,
    daily: days.slice(0, forecastDays).map(({ sunrise, sunset, ...rest }) => rest),
    hourly,
    indoor: null,
    source: weatherSource(base.provider, base.model),
  };
}

/** Open-Meteo answer → WeatherResponse in one step (kept for callers of the 0.4 API). */
export function mapOpenMeteo(j, { lang, locationName, forecastDays, now = new Date(), model = 'best_match' }) {
  const base = baseFromOpenMeteo(j, { model });
  base.tz = null; // Open-Meteo already cut the days in the asked zone
  return localizeWeather(base, { lang, locationName, forecastDays, now });
}

/** Codes of WeatherError, also sent in the admin status (weather.errorCode). */
export const WEATHER_ERROR_CODES = Object.freeze(['key_missing', 'key_invalid', 'rate_limited', 'http', 'bad_response']);

/** Shape of an API key the admin may store (Pirate Weather keys are letters and digits). */
export const WEATHER_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** GET /api/admin/weather/key: whether a key is stored and its last 4 characters, never the key. */
export function weatherKeyStatus(key) {
  const k = String(key || '');
  return { set: k.length > 0, hint: k.length >= 8 ? k.slice(-4) : '' };
}

/**
 * Tries an API key once (PUT /api/admin/weather/key): true when the provider accepts it, false when it refuses it,
 * null when that could not be told (network error, rate limit). `r` is a weatherRequest for the key's provider.
 */
/**
 * @param {ReturnType<typeof weatherRequest>} r
 * @param {Parameters<typeof fetchWeather>[1]} deps
 */
export async function tryWeatherKey(r, deps) {
  try {
    return { ok: true, entry: await fetchWeather(r, deps) };
  } catch (err) {
    if (err instanceof WeatherError && (err.code === 'key_invalid' || err.code === 'key_missing')) return { ok: false, entry: null };
    return { ok: null, entry: null };
  }
}
