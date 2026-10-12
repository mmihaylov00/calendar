// Hand-made crisp line icons (SVG, 64×64 grid) for WMO weather codes, with optional CSS animation
// hooks (.wx-rays, .wx-drift, .wx-drop, .wx-flake, .wx-bolt; see styles.css). Small icons are rendered
// static to keep the Raspberry Pi's paint budget low; only the big "current" icon animates.

const SUN = '#ffc94a';
const MOON = '#eae6ff';
const CLOUD = '#eef2f7';
const CLOUD_BACK = '#8f9bab';
const RAIN = '#5ec8ff';
const SNOW = '#ffffff';
const BOLT = '#ffd23f';

const CLOUD_PATH = 'M18 48h28a10 10 0 0 0 0-20a14 14 0 0 0-26.5 3.5A8.5 8.5 0 0 0 18 48z';

function sun(cx: number, cy: number, r: number, rays = true): string {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}" fill-opacity=".18" stroke="${SUN}" stroke-width="3"/>`;
  if (rays) {
    let g = '';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const r1 = r + 5, r2 = r + 10;
      g += `<line x1="${(cx + Math.cos(a) * r1).toFixed(2)}" y1="${(cy + Math.sin(a) * r1).toFixed(2)}" x2="${(cx + Math.cos(a) * r2).toFixed(2)}" y2="${(cy + Math.sin(a) * r2).toFixed(2)}"/>`;
    }
    s = `<g class="wx-rays" stroke="${SUN}" stroke-width="3" stroke-linecap="round">${g}</g>` + s;
  }
  return s;
}

function moon(tx = 0, ty = 0, sc = 1): string {
  return `<g transform="translate(${tx} ${ty}) scale(${sc})"><path class="wx-moon" d="M40 12a20 20 0 1 0 14 30A17 17 0 0 1 40 12z" fill="${MOON}" fill-opacity=".14" stroke="${MOON}" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="50" cy="16" r="1.6" fill="${MOON}" class="wx-star"/><circle cx="56" cy="27" r="1.1" fill="${MOON}" class="wx-star s2"/></g>`;
}

function cloud(tx = 0, ty = 0, sc = 1, back = false): string {
  const c = back ? CLOUD_BACK : CLOUD;
  return `<g class="${back ? 'wx-drift back' : 'wx-drift'}"><g transform="translate(${tx} ${ty}) scale(${sc})"><path d="${CLOUD_PATH}" fill="${back ? '#000' : '#0b0d12'}" fill-opacity="${back ? 0 : 0.55}" stroke="${c}" stroke-width="${3 / sc}" stroke-linejoin="round"/></g></g>`;
}

function drops(n: number, heavy = false, color = RAIN): string {
  let s = '';
  const xs = n === 2 ? [27, 39] : n === 3 ? [24, 33, 42] : [21, 29, 37, 45];
  xs.forEach((x, i) => {
    const len = heavy ? 8 : 5;
    s += `<line class="wx-drop d${i}" x1="${x}" y1="52" x2="${x - 2.5}" y2="${52 + len}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
  });
  return s;
}

function flakes(n: number): string {
  const xs = n === 2 ? [27, 40] : [23, 33, 43];
  return xs
    .map((x, i) => `<g class="wx-flake d${i}"><circle cx="${x}" cy="56" r="2.4" fill="${SNOW}"/></g>`)
    .join('');
}

function bolt(): string {
  return `<path class="wx-bolt" d="M34 44l-7 11h7l-4 9 11-13h-7l4-7z" fill="${BOLT}" stroke="${BOLT}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function fogLines(): string {
  return `<g stroke="${CLOUD}" stroke-width="3" stroke-linecap="round" class="wx-fog"><line x1="14" y1="54" x2="44" y2="54"/><line x1="22" y1="60" x2="52" y2="60"/></g>`;
}

export type WxKind = 'clear' | 'partly' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'heavyrain' | 'sleet' | 'snow' | 'thunder';

export function wmoKind(code: number): WxKind {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || (code >= 66 && code <= 69)) return 'sleet'; // 68, 69: rain and snow (sleet)
  if (code === 61 || code === 63 || code === 80 || code === 81) return 'rain';
  if (code === 65 || code === 82) return 'heavyrain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

export function weatherIcon(code: number, isDay = true, opts: { animated?: boolean; cls?: string } = {}): string {
  const k = wmoKind(code);
  let body = '';
  const small = (dx: number, dy: number) => (isDay ? `<g transform="translate(${dx} ${dy}) scale(.62)">${sun(24, 22, 9)}</g>` : moon(dx - 4, dy - 4, 0.6));
  switch (k) {
    case 'clear':
      body = isDay ? sun(32, 32, 12) : moon(0, 2, 1);
      break;
    case 'partly':
      body = small(4, 2) + cloud(4, 6, 0.95);
      break;
    case 'cloudy':
      body = cloud(-4, -8, 0.75, true) + cloud(4, 6, 0.95);
      break;
    case 'overcast':
      body = cloud(10, -10, 0.8, true) + cloud(0, 2, 1);
      break;
    case 'fog':
      body = cloud(0, -6, 1) + fogLines();
      break;
    case 'drizzle':
      body = cloud(0, -6, 1) + drops(3);
      break;
    case 'rain':
      body = cloud(0, -6, 1) + drops(3, true);
      break;
    case 'heavyrain':
      body = cloud(0, -6, 1) + drops(4, true);
      break;
    case 'sleet':
      body = cloud(0, -6, 1) + drops(2) + `<circle class="wx-flake d2" cx="33" cy="60" r="2.4" fill="${SNOW}"/>`;
      break;
    case 'snow':
      body = cloud(0, -6, 1) + flakes(3);
      break;
    case 'thunder':
      body = cloud(0, -8, 1) + bolt();
      break;
  }
  const cls = `wx ${opts.animated ? 'anim' : 'static'} wx-${k} ${opts.cls ?? ''}`;
  return `<svg class="${cls}" viewBox="0 0 64 68" fill="none" aria-hidden="true">${body}</svg>`;
}

// ---- Small UI glyphs (stroke = currentColor) --------------------------------------------------

const g = (inner: string, cls = 'ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICON = {
  drop: g('<path d="M12 3.5c3.5 4.3 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.5-6.3 6-10.6z"/>'),
  wind: g('<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/>'),
  sunrise: g('<path d="M4 18h16"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 3v6"/><path d="M9.5 5.5 12 3l2.5 2.5"/><path d="M4.5 12.5l1.4 1"/><path d="M19.5 12.5l-1.4 1"/>'),
  sunset: g('<path d="M4 18h16"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 3v6"/><path d="M9.5 6.5 12 9l2.5-2.5"/><path d="M4.5 12.5l1.4 1"/><path d="M19.5 12.5l-1.4 1"/>'),
  thermo: g('<path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z"/>'),
  umbrella: g('<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6a2 2 0 0 0 4 0"/>'),
  home: g('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>'),
  uv: g('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>'),
  pin: g('<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'),
  check: g('<path d="M5 12.5 10 17l9-10"/>'),
  circle: g('<circle cx="12" cy="12" r="7"/>'),
  clock: g('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
};

/** Wind direction arrow rotated to where the wind is blowing TO (meteorological deg + 180). */
export function windArrow(deg: number): string {
  const rot = (((deg || 0) + 180) % 360).toFixed(0);
  return `<svg class="ico wind-arrow" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)" aria-hidden="true"><path d="M12 3l5 14-5-3-5 3z" fill="currentColor"/></svg>`;
}
