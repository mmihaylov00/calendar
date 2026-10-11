// Display identity (docs/ARCHITECTURE.md): how this display gets in (private link /d/<key>, paired-device token in
// localStorage, or nothing: open mode / admin session), which screen profile it shows (?screen=, ignored with a
// key or device token, which are bound to a screen) and a stable client id (?client= from the kiosk, else
// persisted in localStorage, else generated).
import { appBase, appPath, appUrl } from '../shared/path';

const params = new URLSearchParams(location.search);

/**
 * Admin preview iframe (`?preview=1`): live updates but never registered as a connected display. It also leaves this
 * browser's storage alone: no stored device token is read or written and no client id is kept, so a preview opened
 * where a real display runs (same browser) cannot replace that display's key, token or id.
 */
export const isPreview = params.get('preview') === '1';

/** Private-link key from the path (/d/<key>); '' when the page was opened at / or /pair. */
export const linkKey = (() => {
  const m = /^\/d\/([^/?#]+)/.exec(appPath());
  try {
    return m ? decodeURIComponent(m[1]).trim().slice(0, 64) : '';
  } catch {
    return '';
  }
})();

const DEVICE_LS = 'marco.deviceToken';
/** Paired-device token (stored by the pairing screen). */
export function storedDeviceToken(): string {
  if (isPreview || appBase()) return '';
  try {
    const v = localStorage.getItem(DEVICE_LS) || '';
    return /^md_[A-Za-z0-9_-]{43}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}
export function saveDeviceToken(token: string): void {
  if (isPreview || appBase()) return;
  try {
    localStorage.setItem(DEVICE_LS, token);
  } catch { /* storage disabled: the screen pairs again after a reload */ }
}
export function clearDeviceToken(): void {
  if (isPreview || appBase()) return;
  try {
    localStorage.removeItem(DEVICE_LS);
  } catch { /* ignore */ }
}

/** The credential this display presents (X-Marco-Key / ?k=): the link key wins over a stored device token. */
export const credential = linkKey || storedDeviceToken();
export const credentialKind: 'key' | 'device' | '' = linkKey ? 'key' : credential ? 'device' : '';

/** Requested screen key (slug or id) as typed in the URL; '' = default screen (or the one bound to the credential). */
export const screenKey = credential ? '' : (params.get('screen') || '').trim().slice(0, 64);

/** Storage namespace for per-screen caches (`cs.cache.<ns>.config` …). Never contains the key itself. */
export const screenNs = linkKey ? `k_${linkKey.slice(0, 6).replace(/[^A-Za-z0-9]/g, '_')}` : credential ? '_device'
  : screenKey ? screenKey.toLowerCase().replace(/[^a-z0-9_-]/g, '_') : '_default';

/** Forget every cached data set (a revoked link or device must not keep showing family data). */
export function clearCaches(): void {
  if (isPreview) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cs.cache.')) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

/** Request headers carrying the credential (fetch). */
export const authHeaders = (): Record<string, string> => (credential ? { 'X-Marco-Key': credential } : {});

/** Same-origin media URL with ?k= (an <img> / WebGL texture cannot send headers). Other URLs unchanged. */
export function mediaUrl(url: string): string {
  const scoped = appUrl(url);
  const localMedia = url.startsWith('/media/') || (!!appBase() && url.startsWith(`${appBase()}/media/`));
  if (!credential || !localMedia) return scoped;
  return `${scoped}${scoped.includes('?') ? '&' : '?'}k=${encodeURIComponent(credential)}`;
}

const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;

function sanitizeClient(raw: string): string {
  let s = raw.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!s) return '';
  if (s.length < 8) s = `d_${s}`.padEnd(8, '0');
  return CLIENT_RE.test(s) ? s : '';
}

function randomId(): string {
  let s = '';
  try {
    const a = new Uint8Array(10);
    crypto.getRandomValues(a);
    for (const b of a) s += (b % 36).toString(36);
  } catch {
    while (s.length < 10) s += Math.floor(Math.random() * 36).toString(36);
  }
  return `d_${s}`;
}

function resolveClientId(): string {
  const fromUrl = sanitizeClient(params.get('client') || '');
  if (fromUrl) return fromUrl;
  if (isPreview) return randomId(); // this page load only
  try {
    const stored = localStorage.getItem('cs.clientId');
    if (stored && CLIENT_RE.test(stored)) return stored;
    const id = randomId();
    localStorage.setItem('cs.clientId', id);
    return id;
  } catch {
    // private mode / storage disabled: stable for this page load only
    return randomId();
  }
}

export const clientId = resolveClientId();


/** Append `screen=` (when set) to an API path. */
export function withScreen(path: string): string {
  if (!screenKey) return path;
  return `${path}${path.includes('?') ? '&' : '?'}screen=${encodeURIComponent(screenKey)}`;
}
