// English server-side strings (weather descriptions, Airbnb titles and import summaries).
export const LANGS = ['en'];
export const lang = (l) => 'en';

// WMO weather interpretation codes (Open-Meteo; 68 and 69 for the other providers' sleet).
const WMO = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  // 68, 69: rain and snow mixed (WMO 4677); MET Norway and Pirate Weather "sleet"
  68: 'Sleet',
  69: 'Heavy sleet',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

export function wmoDescription(code, l) {
  return WMO[code] ?? '';
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function windDirLabel(deg, l) {
  if (deg == null || Number.isNaN(+deg)) return '';
  const i = Math.round((((+deg % 360) + 360) % 360) / 45) % 8;
  return DIRS[i];
}

const STRINGS = {
  reservation: 'Reservation',
  busy: 'Busy',
  blocked: 'Not available',
  untitled: '(No title)',
};

export function t(key, l) {
  return STRINGS[key] ?? key;
}

export const langFromHeader = (header) => 'en';
export const requestLang = (req) => 'en';

const NOUNS = {
  screen: ['screen', 'screens'],
  source: ['source', 'sources'],
  feed: ['feed', 'feeds'],
  item: ['item', 'items'],
  iconRule: ['icon rule', 'icon rules'],
};
const SUMMARY = {
  modified: 'modified',
  unchanged: 'unchanged',
  settingsModified: 'settings modified',
};

/** "3 screens" / "1 screen". */
export function countNoun(n, noun, l) {
  const [one, many] = NOUNS[noun];
  return `${n} ${n === 1 ? one : many}`;
}

export const countChanged = (n, noun, l) => `${n} modified`;
export const summaryWord = (key, l) => SUMMARY[key];
