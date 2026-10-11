// Where the admin sends the browser to sign in or after signing out. Plain TypeScript with type-only imports,
// so the server tests can load it.
//
// Self-hosted: the admin shows its own login screen, so these return null.
// Account mode (Marco Cloud, user.method 'account'): sign-in happens on the account pages, which come back
// to `next` (path + hash, for example "/admin/#/calendars") after a successful login.
import type { AuthMeResponse } from '../shared/types';
import type { Caps } from './caps';
import { appBase, appPath, appUrl } from '../shared/path';

const DEFAULT_LOGIN = '/login';

export function homeAssistantMode(me: AuthMeResponse | null): boolean {
  return !!appBase() || !!me?.homeAssistant || me?.user?.method === 'homeassistant';
}

/** True when sign-in is handled by the account pages rather than the admin's own login screen. */
export function accountMode(me: AuthMeResponse | null, caps: Caps): boolean {
  if (homeAssistantMode(me)) return false;
  if (me?.user?.method === 'account' || !!me?.account) return true;
  return caps.edition === 'cloud' && caps.tenancy === 'multi';
}

/** A path on this site: starts with one "/", no backslash, no whitespace or control characters (browsers drop
 *  tabs and newlines, so "/\t/evil.example" would turn into "//evil.example"). */
const isLocalPath = (v: string) => v.startsWith('/') && !v.startsWith('//') && !/[\\\s\u0000-\u001f\u007f]/.test(v);

/** Keep only a same-site admin path for `next`; anything else falls back to "/admin/". */
export function safeNext(pathAndHash: string): string {
  const v = appPath(String(pathAndHash || ''));
  if (!v.startsWith('/admin/') || v.includes('//') || !isLocalPath(v)) return appUrl('/admin/');
  return appUrl(v);
}

/** Login URL with `next`, or null when the admin shows its own login screen. */
export function authRedirect(me: AuthMeResponse | null, caps: Caps, pathAndHash: string): string | null {
  if (!accountMode(me, caps)) return null;
  const login = loginUrlOf(me);
  const sep = login.includes('?') ? '&' : '?';
  return `${login}${sep}next=${encodeURIComponent(safeNext(pathAndHash))}`;
}

/** After POST /api/auth/logout: the server's `next`, else the login page in account mode, else null (stay). */
export function logoutRedirect(me: AuthMeResponse | null, caps: Caps, res: unknown): string | null {
  if (!accountMode(me, caps)) return null;
  const next = res && typeof res === 'object' ? (res as { next?: unknown }).next : undefined;
  if (typeof next === 'string' && isLocalPath(next)) return appUrl(next);
  return loginUrlOf(me);
}

/** The server's login page when it is a safe link, else "/login". */
function loginUrlOf(me: AuthMeResponse | null): string {
  return safeAccountUrl(me?.account?.loginUrl) || appUrl(DEFAULT_LOGIN);
}

/** Account page links from /api/auth/me: a path on this site or an http(s) URL; anything else is dropped. */
export function safeAccountUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (isLocalPath(v)) return appUrl(v);
  if (/[\s\u0000-\u001f\u007f\\]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export interface AccountLinks {
  account: string | null;
  sessions: string | null;
  remove: string | null;
}

/** The account menu links, or null when this is not an account login (self-hosted). */
export function accountLinks(me: AuthMeResponse | null): AccountLinks | null {
  const a = me?.account;
  if (!a || me?.user?.method !== 'account') return null;
  return { account: safeAccountUrl(a.accountUrl), sessions: safeAccountUrl(a.sessionsUrl), remove: safeAccountUrl(a.deleteUrl) };
}

/** Household names: trimmed, control characters dropped, at most 60 characters (the cloud's cap). */
export const HOUSEHOLD_NAME_MAX = 60;
export function cleanHouseholdName(v: string): string {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, HOUSEHOLD_NAME_MAX);
}
