import { appUrl } from '../shared/path';
import type {
  AdminPhoto,
  PhotoConflictPolicy,
  PhotoNameCheck,
  PhotoUploadResult,
  AuthMeResponse,
  GeocodeResponse,
  StoredConfig,
  SaveConfigRequest,
  HealthResponse,
  HaEntity,
  HaCalendarListItem,
  WeatherKeyStatus,
  TestIcsResponse,
} from '../shared/types';
import { apiErrorCode, apiErrorMessage, type ApiErrorCode } from './apiErrors';

export class ApiError extends Error {
  status: number;
  body: unknown;
  /** Known error code from the body (apiErrors.ts), '' when there is none. */
  code: ApiErrorCode | '';
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.code = apiErrorCode(body);
  }
}

/** Fired on any 401 so the app can drop back to the login screen. */
export const UNAUTHORIZED_EVENT = 'admin:unauthorized';

async function request<T>(method: string, url: string, body?: unknown, opts: { silent401?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'fetch', ...(opts.headers ?? {}) };
  let payload: string | undefined;
  if (method !== 'GET') {
    // Every mutating call is JSON (server CSRF check relies on the content type).
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(appUrl(url), { method, headers, body: payload, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(0, 'network');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.silent401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, apiErrorMessage(res.status, data), data);
  }
  return data as T;
}

function isConfig(x: any): x is StoredConfig {
  return x && typeof x === 'object' && x.calendar && Array.isArray(x.screens) && typeof x.revision === 'number';
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request<HealthResponse>('GET', '/api/health', undefined, { silent401: true }),
  me: () => request<AuthMeResponse>('GET', '/api/auth/me', undefined, { silent401: true }),

  getConfig: () => request<StoredConfig>('GET', '/api/admin/config'),
  /** PUT the whole (v2) config. Returns the saved config (refetches if the server does not echo it).
   *  With `baseRevision` the server answers 409 conflict when the config was saved since that revision. */
  async saveConfig(body: SaveConfigRequest): Promise<StoredConfig> {
    const res = await request<any>('PUT', '/api/admin/config', body);
    if (isConfig(res)) return res;
    if (res && isConfig(res.config)) return res.config;
    return api.getConfig();
  },

  testIcs: (url: string, insecureTls?: boolean) =>
    request<TestIcsResponse>('POST', '/api/admin/test/ics', insecureTls ? { url, insecureTls: true } : { url }),

  haEntities: (domain: 'sensor' | 'weather' | 'camera') =>
    request<HaEntity[]>('GET', `/api/admin/homeassistant/entities?domain=${domain}`),
  haCalendars: () => request<HaCalendarListItem[]>('GET', '/api/admin/homeassistant/calendars'),

  weatherKey: () => request<WeatherKeyStatus>('GET', '/api/admin/weather/key'),
  /** '' removes the key; a key the provider refuses answers 400 key_invalid */
  setWeatherKey: (key: string) => request<WeatherKeyStatus>('PUT', '/api/admin/weather/key', { key }),

  photos: () => request<AdminPhoto[]>('GET', '/api/admin/photos'),
  deletePhoto: (file: string) => request<unknown>('DELETE', `/api/admin/photos/${encodeURIComponent(file)}`),
  checkPhotoNames: (names: string[]) => request<{ results: PhotoNameCheck[] }>('POST', '/api/admin/photos/check', { names }),
  setPhotoFocus: (file: string, focusX: number, focusY: number) =>
    request<AdminPhoto>('PATCH', `/api/admin/photos/${encodeURIComponent(file)}`, { focusX, focusY }),
  setPhotoHidden: (file: string, hidden: boolean) =>
    request<AdminPhoto>('PATCH', `/api/admin/photos/${encodeURIComponent(file)}`, { hidden }),
  setPhotosHidden: (files: string[], hidden: boolean) =>
    request<{ ok: boolean; updated: string[]; missing: string[]; total: number; inRotation: number }>('POST', '/api/admin/photos/visibility', { files, hidden }),

  geocode: (query: string, lang: string) =>
    request<GeocodeResponse>('GET', `/api/admin/geocode${q({ q: query, lang })}`),

};

function xhrUpload<T>(method: string, url: string, fd: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, appUrl(url));
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Requested-With', 'fetch');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as T);
      } else {
        if (xhr.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        reject(new ApiError(xhr.status, apiErrorMessage(xhr.status, data), data));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.send(fd);
  });
}

export interface PhotoUpload {
  blob: Blob;
  name: string;
  thumb?: Blob;
  focusX?: number;
  focusY?: number;
}

/**
 * Multipart upload (XHR for progress). Field `photos[]` as documented in docs/API.md, optional `thumbs[]` (same order) and `meta`
 * (focal points). `onConflict` decides what happens when the name is taken (server default: rename).
 */
export function uploadPhotos(
  files: PhotoUpload[],
  onConflict: PhotoConflictPolicy = 'rename',
  onProgress?: (fraction: number) => void
): Promise<PhotoUploadResult> {
  const fd = new FormData();
  fd.append('meta', JSON.stringify(files.map((f) => (f.focusX !== undefined && f.focusY !== undefined ? { focusX: f.focusX, focusY: f.focusY } : null))));
  for (const f of files) {
    fd.append('photos[]', f.blob, f.name);
    if (f.thumb) fd.append('thumbs[]', f.thumb, 'thumb.jpg');
  }
  return xhrUpload('POST', `/api/admin/photos?onConflict=${onConflict}`, fd, onProgress);
}

/** Thumbnail for a photo already in the gallery. */
export function uploadThumb(file: string, thumb: Blob): Promise<AdminPhoto> {
  const fd = new FormData();
  fd.append('thumb', thumb, 'thumb.jpg');
  return xhrUpload('PUT', `/api/admin/photos/${encodeURIComponent(file)}/thumb`, fd);
}
