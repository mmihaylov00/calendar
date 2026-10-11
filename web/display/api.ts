// API client for the public display endpoints (docs/API.md).
// Every per-screen endpoint gets `?screen=<key>` when the display was opened with one; every request carries the
// display credential (private-link key or paired-device token) in X-Marco-Key.
import type {
  CountdownsResponse, DisplayConfig, DisplayHeartbeat, EventsResponse, HealthResponse, HeartbeatResponse, NewsResponse,
  PhotosResponse, PollResponse, WeatherResponse,
} from '../shared/types';
import { authHeaders, withScreen } from './identity';
import { appUrl } from '../shared/path';

export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = '') {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(appUrl(path), {
      ...init, signal: ctl.signal, cache: 'no-store', headers: { Accept: 'application/json', ...authHeaders(), ...(init.headers || {}) },
    });
    if (!r.ok) {
      // 401 key_required / 403 invalid_key: the display shows the pairing / "link no longer valid" screen.
      let code = '';
      if (r.status === 401 || r.status === 403) {
        try {
          code = String(((await r.json()) as { code?: string }).code || '');
        } catch { /* not JSON */ }
      }
      throw new ApiError(`${path} → HTTP ${r.status}`, r.status, code);
    }
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new ApiError(`${path} → not JSON`, r.status);
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(`${path} → ${(e as Error).message || 'network error'}`);
  } finally {
    clearTimeout(tm);
  }
}

export function getJSON<T>(path: string, timeoutMs = 15000): Promise<T> {
  return request<T>(path, {}, timeoutMs);
}

export const api = {
  config: () => getJSON<DisplayConfig>(withScreen('/api/display/config')),
  /** First config fetch at boot: short timeout so an unreachable server falls back to the cache quickly. */
  configQuick: () => getJSON<DisplayConfig>(withScreen('/api/display/config'), 5000),
  events: (from: string, to: string) =>
    getJSON<EventsResponse>(withScreen(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
  weather: () => getJSON<WeatherResponse>(withScreen('/api/weather')),
  news: () => getJSON<NewsResponse>('/api/news'),
  /** `after` = gallery file shown last, so sequential orders continue from there and random avoids repeating it. */
  photos: (count = 20, after = '') =>
    getJSON<PhotosResponse>(withScreen(`/api/photos?count=${count}${after ? `&after=${encodeURIComponent(after)}` : ''}`)),
  countdowns: () => getJSON<CountdownsResponse>(withScreen('/api/countdowns')),
  health: () => getJSON<HealthResponse>('/api/health', 5000),
  /** `q` from stream.ts pollUrl (client, cursor, rev, hidden, preview). */
  poll: (q: string) => getJSON<PollResponse>(withScreen(`/api/display/poll?${q}`), 10000),
  heartbeat: (hb: DisplayHeartbeat) =>
    request<HeartbeatResponse>('/api/display/heartbeat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(hb),
    }, 8000),
};
