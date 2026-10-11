// Help and feedback form (Marco Cloud, features.feedback): limits, the technical details it can attach and how they
// are shown before sending. Plain TypeScript with type-only imports, so the server tests can load it.
import type { FeedbackKind, FeedbackMeta, FeedbackRequest } from '../shared/types';
import { REPO_URL } from '../shared/project';

/** Same limits as the cloud's POST /api/admin/feedback. */
export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 4000;
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['problem', 'idea', 'other'];

/** Where people can open a public issue instead. */
export const GITHUB_ISSUES_URL = `${REPO_URL}/issues/new`;

const cut = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The technical details of this admin: only what is listed here is ever sent. */
export function feedbackMeta(input: { version?: string; page?: string; screens?: number; userAgent?: string; lang?: string; timeZone?: string }): FeedbackMeta {
  const meta: FeedbackMeta = {};
  const version = cut(input.version, 40);
  if (version) meta.version = version;
  const page = cut(input.page, 40);
  if (page) meta.page = page;
  if (typeof input.screens === 'number' && Number.isInteger(input.screens) && input.screens >= 0) meta.screens = Math.min(input.screens, 999);
  const ua = cut(input.userAgent, 300);
  if (ua) meta.userAgent = ua;
  const lang = cut(input.lang, 10);
  if (lang) meta.lang = lang;
  const tz = cut(input.timeZone, 64);
  if (tz) meta.timeZone = tz;
  return meta;
}

/** Label and value of each detail, in the order the form shows them. */
export function metaRows(meta: FeedbackMeta): [string, string][] {
  const rows: [string, string][] = [];
  if (meta.version) rows.push(['Version', meta.version]);
  if (meta.page) rows.push(['Page', meta.page]);
  if (meta.screens !== undefined) rows.push(['Screens', String(meta.screens)]);
  if (meta.lang) rows.push(['Language', meta.lang]);
  if (meta.timeZone) rows.push(['Time zone', meta.timeZone]);
  if (meta.userAgent) rows.push(['Browser', meta.userAgent]);
  return rows;
}

/** Length of the message as the server counts it (trimmed). */
export const messageLength = (message: string) => message.trim().length;

/** Message describing the problem with a message, or '' when it can be sent. */
export function messageError(message: string): string {
  const n = messageLength(message);
  if (n < FEEDBACK_MIN) return 'Write a little more so we can understand it.';
  if (n > FEEDBACK_MAX) return 'The message is too long.';
  return '';
}

/** The request body; `withMeta` false sends no technical details at all. */
export function feedbackBody(kind: FeedbackKind, message: string, meta: FeedbackMeta, withMeta: boolean): FeedbackRequest {
  return { kind: FEEDBACK_KINDS.includes(kind) ? kind : 'other', message: message.trim(), meta: withMeta ? meta : null };
}
