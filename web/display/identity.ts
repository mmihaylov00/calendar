// Display credentials, ingress-scoped URLs and per-calendar offline cache keys.
import { appBase, appPath, appUrl } from '../shared/path';

const params = new URLSearchParams(location.search);

/**
 * Admin previews leave the browser's stored credentials and offline calendar cache alone.
 */
export const isPreview = params.get('preview') === '1';

/** Existing private-link key from /d/<key>; Home Assistant ingress uses its session. */
export const linkKey = (() => {
  const m = /^\/d\/([^/?#]+)/.exec(appPath());
  try {
    return m ? decodeURIComponent(m[1]).trim().slice(0, 64) : '';
  } catch {
    return '';
  }
})();

const DEVICE_LS = 'marco.deviceToken';
/** Existing paired-device token, retained for compatible standalone links. */
export function storedDeviceToken(): string {
  if (isPreview || appBase()) return '';
  try {
    const v = localStorage.getItem(DEVICE_LS) || '';
    return /^md_[A-Za-z0-9_-]{43}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}
/** The credential this display presents (X-Marco-Key / ?k=): the link key wins over a stored device token. */
export const credential = linkKey || storedDeviceToken();

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

/** Same-origin media URL with ?k= (an <img> cannot send headers). Other URLs unchanged. */
export function mediaUrl(url: string): string {
  const scoped = appUrl(url);
  const localMedia = url.startsWith('/media/') || (!!appBase() && url.startsWith(`${appBase()}/media/`));
  if (!credential || !localMedia) return scoped;
  return `${scoped}${scoped.includes('?') ? '&' : '?'}k=${encodeURIComponent(credential)}`;
}

/** Append `screen=` (when set) to an API path. */
export function withScreen(path: string): string {
  if (!screenKey) return path;
  return `${path}${path.includes('?') ? '&' : '?'}screen=${encodeURIComponent(screenKey)}`;
}
