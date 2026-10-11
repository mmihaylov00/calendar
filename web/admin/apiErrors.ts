// Error codes a server can answer with (self-hosted Marco or Marco Cloud) and the message the admin shows for each.
// api.ts uses apiErrorMessage() for every failed call, so a section that toasts `error.message` shows a
// translated sentence instead of the raw code. Messages are English.
import { t } from './i18n';
import { LIMIT_EXCEEDED } from './util';

export const API_ERROR_MESSAGES = {
  rate_limited: 'Too many requests in a row. Wait a moment and try again.',
  screen_limit: 'You have reached the maximum number of screens.',
  limit_exceeded: LIMIT_EXCEEDED,
  feature_unavailable: 'This feature is not available on this server.',
  conflict: 'The settings were saved somewhere else while you were editing. Reload the page to see the current version.',
  photo_quota: 'There is no room for more photos. Delete some and try again.',
  readonly: 'Your account can view the settings but not change them.',
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_MESSAGES;

const isCode = (v: unknown): v is ApiErrorCode => typeof v === 'string' && Object.hasOwn(API_ERROR_MESSAGES, v);

/** The known code in an error body: `code` first, then `error` (servers use both). '' when there is none. */
export function apiErrorCode(body: unknown): ApiErrorCode | '' {
  if (!body || typeof body !== 'object') return '';
  const b = body as { code?: unknown; error?: unknown };
  if (isCode(b.code)) return b.code;
  if (isCode(b.error)) return b.error;
  return '';
}

/** Codes a server answers when it could not fetch a calendar or feed URL (Marco Cloud names them this way). */
export const FETCH_ERROR_MESSAGES: Record<string, string> = {
  blocked_url: 'The server cannot fetch that address (local network, internal name or a port that is not allowed).',
  too_large: 'The file is too large (2 MB max).',
  timeout: 'It took too long to answer.',
  too_many_redirects: 'Too many redirects.',
  http_denied: 'Access denied: check that the link is public or includes its key.',
  http_not_found: 'Not found (404): check the address.',
  http_error: 'The source server answered with an error.',
  fetch_failed: 'Could not connect to that address.',
  not_a_feed: 'It is not an RSS or Atom feed.',
};

/** Translated text for a fetch error code; anything else (a self-hosted server's own message) as it came. */
export const fetchErrorText = (code: string | undefined | null): string =>
  code && Object.hasOwn(FETCH_ERROR_MESSAGES, code) ? t(FETCH_ERROR_MESSAGES[code]) : code || '';

/** Translated message for a known code ('' otherwise). */
export const codeMessage = (code: string): string => (isCode(code) ? t(API_ERROR_MESSAGES[code]) : '');

/**
 * Message of a failed call. Known codes get their translated sentence; otherwise the server's own `error` /
 * `message` text, with up to three `details` (`path: message`, a detail whose message is a known code is
 * translated), or "HTTP <status>".
 */
export function apiErrorMessage(status: number, data: unknown): string {
  const code = apiErrorCode(data);
  const details = data && typeof data === 'object' && Array.isArray((data as any).details) ? ((data as any).details as unknown[]) : null;
  const detailText = details?.length
    ? `: ${details
        .slice(0, 3)
        .map((d: any) => (d && typeof d === 'object' ? `${d.path ?? ''}: ${codeMessage(d.message) || fetchErrorText(d.message)}` : String(d)))
        .join('; ')}`
    : '';
  if (code) return codeMessage(code) + (code === 'limit_exceeded' || code === 'feature_unavailable' ? detailText : '');
  const own = data && typeof data === 'object' ? (data as any).error || (data as any).message : '';
  if (own) return `${own}${detailText}`;
  if (typeof data === 'string' && data.length < 200 && data) return data;
  return `HTTP ${status}`;
}
