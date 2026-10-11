// "Sent" messages for display commands and announcements. A server that pushes over SSE reaches the screens at once;
// one in poll mode (live: 'poll' in /api/health) reaches each screen on its next check, so the message says so.
// Plain TypeScript, so the server tests can load it.
import { caps } from './caps';
import { t } from './i18n';

/** The delay note for a polling server, or '' when the screens get commands right away. */
export function pollNote(): string {
  return caps().live === 'poll' ? t('reaches the screens within about 90 s') : '';
}

/** `msg` followed by the delay note when the server polls. */
export function withPollNote(msg: string): string {
  const note = pollNote();
  return note ? `${msg} · ${note}` : msg;
}
