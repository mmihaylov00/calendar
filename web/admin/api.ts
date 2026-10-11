import { appUrl } from '../shared/path';
import type {
  PrivacyChangeResponse,
  PrivacyRequest,
  PrivacyResponse,
  ActivityResponse,
  AdminPhoto,
  PhotoConflictPolicy,
  PhotoNameCheck,
  PhotoUploadResult,
  AdminStatus,
  AnnounceRequest,
  AnnounceResponse,
  AnnouncementsResponse,
  DoorbellRequest,
  DoorbellResponse,
  ApiTokenCreated,
  ApiTokenInfo,
  AuthMeResponse,
  BackupInfo,
  BirthdayCsvResult,
  DashboardResponse,
  DisplayCommandRequest,
  DisplaysResponse,
  DisplayLink,
  DisplayLinksResponse,
  DevicesResponse,
  PairClaimRequest,
  PairClaimResponse,
  GeocodeResponse,
  PairedDevice,
  EventsPreviewRequest,
  EventsPreviewResponse,
  ExportBundle,
  ImportApplyRequest,
  ImportPreview,
  ScreenProfile,
  SetupCompleteResponse,
  SetupRequest,
  SetupStatus,
  StoredConfig,
  SaveConfigRequest,
  CountdownsResponse,
  GoogleAccount,
  HealthResponse,
  HouseholdInfo,
  GoogleCalendarListItem,
  MicrosoftAccount,
  MicrosoftCalendarListItem,
  HaEntity,
  HaCalendarListItem,
  TestHomeAssistantResponse,
  WeatherKeyStatus,
  TestIcsResponse,
  TestRssResponse,
  UpdateInfo,
  UpdateSettings,
  FeedbackRequest,
  FeedbackResponse,
} from '../shared/types';
import { getLang } from './i18n';
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
  login: (password: string) => request<unknown>('POST', '/api/auth/login', { password }, { silent401: true }),
  logout: () => request<unknown>('POST', '/api/auth/logout', {}, { silent401: true }),
  logoutAll: () => request<unknown>('POST', '/api/auth/logout-all', {}, { silent401: true }),

  // Marco Cloud account (features.accountMenu): the household can be renamed.
  renameHousehold: (name: string) => request<{ ok: true; household: HouseholdInfo }>('PATCH', '/api/admin/household', { name }),
  // Marco Cloud only (features.feedback): help and feedback form, mailed to the team with the signed in email as reply-to.
  sendFeedback: (body: FeedbackRequest) => request<FeedbackResponse>('POST', '/api/admin/feedback', body),

  // First-run setup wizard (no session yet; the optional setup token travels in x-setup-token).
  setupStatus: (token?: string) =>
    request<SetupStatus>('GET', '/api/setup/status', undefined, { silent401: true, headers: token ? { 'x-setup-token': token } : {} }),
  setupTestIcs: (url: string, token?: string) =>
    request<TestIcsResponse>('POST', '/api/setup/test-ics', { url }, { silent401: true, headers: token ? { 'x-setup-token': token } : {} }),
  setupComplete: (body: SetupRequest) =>
    request<SetupCompleteResponse>('POST', '/api/setup/complete', body, { silent401: true, headers: body.token ? { 'x-setup-token': body.token } : {} }),

  getConfig: () => request<StoredConfig>('GET', '/api/admin/config'),
  /** PUT the whole (v2) config. Returns the saved config (refetches if the server does not echo it).
   *  With `baseRevision` the server answers 409 conflict when the config was saved since that revision. */
  async saveConfig(body: SaveConfigRequest): Promise<StoredConfig> {
    const res = await request<any>('PUT', '/api/admin/config', body);
    if (isConfig(res)) return res;
    if (res && isConfig(res.config)) return res.config;
    return api.getConfig();
  },
  // 401 here means "wrong current password", not an expired session.
  changePassword: (current: string, next: string) =>
    request<unknown>('PUT', '/api/admin/password', { current, next }, { silent401: true }),

  googleAccounts: () => request<GoogleAccount[]>('GET', '/api/admin/google/accounts'),
  removeGoogleAccount: (email: string) =>
    request<unknown>('DELETE', `/api/admin/google/accounts/${encodeURIComponent(email)}`),
  googleCalendars: (account: string) =>
    request<GoogleCalendarListItem[]>('GET', `/api/admin/google/calendars?account=${encodeURIComponent(account)}`),

  // Marco Cloud only (features.microsoftCalendar): Outlook.com, Hotmail and Microsoft 365 calendars.
  microsoftAccounts: () => request<MicrosoftAccount[]>('GET', '/api/admin/microsoft/accounts'),
  removeMicrosoftAccount: (email: string) =>
    request<unknown>('DELETE', `/api/admin/microsoft/accounts/${encodeURIComponent(email)}`),
  microsoftCalendars: (account: string) =>
    request<MicrosoftCalendarListItem[]>('GET', `/api/admin/microsoft/calendars?account=${encodeURIComponent(account)}`),

  testIcs: (url: string, insecureTls?: boolean) =>
    request<TestIcsResponse>('POST', '/api/admin/test/ics', insecureTls ? { url, insecureTls: true } : { url }),
  testRss: (url: string) => request<TestRssResponse>('POST', '/api/admin/test/rss', { url }),
  testHomeAssistant: (url: string, token?: string) =>
    request<TestHomeAssistantResponse>('POST', '/api/admin/test/homeassistant', token ? { url, token } : { url }),
  haEntities: (domain: 'sensor' | 'weather' | 'camera') =>
    request<HaEntity[]>('GET', `/api/admin/homeassistant/entities?domain=${domain}`),
  haCalendars: () => request<HaCalendarListItem[]>('GET', '/api/admin/homeassistant/calendars'),
  setHaToken: (token: string) => request<unknown>('PUT', '/api/admin/homeassistant/token', { token }),
  /** Test ring (or dismiss) with the draft settings: the screens show the camera as the webhook would. */
  doorbell: (body: DoorbellRequest) => request<DoorbellResponse>('POST', '/api/admin/doorbell', body),
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
  refreshDisplays: (screens?: string[]) => request<unknown>('POST', '/api/admin/refresh-displays', screens?.length ? { screens } : {}),
  status: () => request<AdminStatus>('GET', '/api/admin/status'),

  // ---- v2 (docs/ARCHITECTURE.md) ----
  dashboard: () => request<DashboardResponse>('GET', '/api/admin/dashboard'),
  // updates (self-hosted, features.updates)
  updateInfo: () => request<UpdateInfo>('GET', '/api/admin/update'),
  updateSettings: (patch: Partial<UpdateSettings>) => request<UpdateInfo>('PUT', '/api/admin/update/settings', patch),
  updateCheck: () => request<UpdateInfo>('POST', '/api/admin/update/check'),
  updateApply: () => request<UpdateInfo>('POST', '/api/admin/update/apply'),
  screenTemplate: (name: string) => request<ScreenProfile>('GET', `/api/admin/screens/template${q({ name })}`),
  displays: () => request<DisplaysResponse>('GET', '/api/admin/displays'),
  // privacy mode per screen (features.privacy; docs/API.md)
  privacy: () => request<PrivacyResponse>('GET', '/api/admin/privacy'),
  setPrivacy: (body: PrivacyRequest) => request<PrivacyChangeResponse>('POST', '/api/admin/privacy', body),
  displayCommand: (body: DisplayCommandRequest) => request<{ ok: true; delivered: number }>('POST', '/api/admin/displays/command', body),
  forgetDisplay: (clientId: string) => request<{ ok: true }>('DELETE', `/api/admin/displays/${encodeURIComponent(clientId)}`),

  // ---- display access: private links, paired devices, pairing (docs/API.md "Display access") ----
  displayLinks: () => request<DisplayLinksResponse>('GET', '/api/admin/display-links'),
  regenerateLink: (screenId: string) => request<{ link: DisplayLink }>('POST', `/api/admin/display-links/${encodeURIComponent(screenId)}/regenerate`, {}),
  devices: () => request<DevicesResponse>('GET', '/api/admin/devices'),
  updateDevice: (id: string, body: { name?: string; screenId?: string }) => request<{ device: PairedDevice }>('PATCH', `/api/admin/devices/${encodeURIComponent(id)}`, body),
  revokeDevice: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/devices/${encodeURIComponent(id)}`),
  claimPairing: (body: PairClaimRequest) => request<PairClaimResponse>('POST', '/api/admin/pair/claim', body),
  // Place search through the server (the setup wizard sends its setup token, there is no session yet).
  geocode: (query: string, lang: string, setupToken?: string) =>
    request<GeocodeResponse>('GET', `/api/admin/geocode${q({ q: query, lang })}`, undefined, setupToken ? { headers: { 'x-setup-token': setupToken }, silent401: true } : {}),

  eventsPreview: (body: EventsPreviewRequest) => request<EventsPreviewResponse>('POST', '/api/admin/events/preview', body),
  parseBirthdaysCsv: (text: string) => request<BirthdayCsvResult>('POST', '/api/admin/birthdays/parse-csv', { text }),
  countdowns: (screen: string) => request<CountdownsResponse>('GET', `/api/admin/countdowns${q({ screen })}`),

  announce: (body: AnnounceRequest) => request<AnnounceResponse>('POST', '/api/admin/announce', body),
  announcements: () => request<AnnouncementsResponse>('GET', '/api/admin/announcements'),
  clearAnnouncement: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/announcements/${encodeURIComponent(id)}`),
  clearAnnouncements: () => request<{ ok: true; cleared: number }>('DELETE', '/api/admin/announcements'),

  tokens: () => request<ApiTokenInfo[]>('GET', '/api/admin/tokens'),
  createToken: (name: string) => request<ApiTokenCreated>('POST', '/api/admin/tokens', { name }),
  revokeToken: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/tokens/${encodeURIComponent(id)}`),

  backups: () => request<BackupInfo[]>('GET', '/api/admin/backups'),
  createBackup: () => request<BackupInfo>('POST', '/api/admin/backups', {}),
  backupUrl: (id: string) => appUrl(`/api/admin/backups/${encodeURIComponent(id)}`),
  /** A backup file's content (a 401 here, as for every call, sends the admin through sign in again first). */
  backupFile: (id: string) => request<unknown>('GET', `/api/admin/backups/${encodeURIComponent(id)}`),
  restoreBackup: (id: string) => request<{ ok: true; config: StoredConfig; repaired?: string[] }>('POST', `/api/admin/backups/${encodeURIComponent(id)}/restore`, {}),
  deleteBackup: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/backups/${encodeURIComponent(id)}`),
  exportConfig: (includeSecrets: boolean) => request<ExportBundle>('POST', '/api/admin/export', { includeSecrets }),
  importPreview: (bundle: unknown) => request<ImportPreview>('POST', '/api/admin/import/preview', { bundle, lang: getLang() }),
  importApply: (body: ImportApplyRequest) => request<{ ok: true; config: StoredConfig; loggedOut?: boolean }>('POST', '/api/admin/import/apply', body),

  activity: (params: { type?: string; level?: string; q?: string; actor?: string; before?: string; limit?: number }) =>
    request<ActivityResponse>('GET', `/api/admin/activity${q(params)}`),
  clearActivity: () => request<{ ok: true }>('DELETE', '/api/admin/activity'),
};

/** Trigger a browser download of a JSON value (export uses POST, so no plain link). */
export function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

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
