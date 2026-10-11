// Localized one-line description of an activity log entry (the server stores only type + data).
import type { ActivityEntry } from '../shared/types';
import type { IconName } from './components/icons';
import { nScreens, t } from './i18n';
import { fetchErrorText } from './apiErrors';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const q = (v: unknown) => (str(v) ? `«${str(v)}»` : '');

export const ACTIVITY_GROUPS: { value: string; label: string; icon: IconName }[] = [
  { value: '', label: 'All', icon: 'list' },
  { value: 'auth', label: 'Sign-ins', icon: 'user' },
  { value: 'config', label: 'Settings', icon: 'settings' },
  { value: 'backup', label: 'Backups', icon: 'archive' },
  { value: 'source', label: 'Calendars', icon: 'calendar' },
  { value: 'announce', label: 'Alerts', icon: 'megaphone' },
  { value: 'token', label: 'API', icon: 'key' },
  { value: 'display', label: 'Screens', icon: 'monitor' },
  { value: 'privacy', label: 'Private mode', icon: 'lock' },
  { value: 'google', label: 'Google', icon: 'google' },
];

/** Human name of a config section key as logged in config.saved (`calendar`, `screens:cocina.layout`…). */
export function sectionLabel(key: string): string {
  const m = /^screens:([^.]+)\.?(.*)$/.exec(key);
  const names: Record<string, string> = {
    calendar: 'Calendars', datetime: 'Date & time', weather: 'Weather', news: 'News', todo: 'To-dos', localEvents: 'Local events',
    birthdays: 'Birthdays', eventRules: 'Filters', countdowns: 'Countdowns', schedules: 'Scheduled messages', homeassistant: 'Home Assistant',
    auth: 'Security', screens: 'Screens', defaultScreen: 'Default screen', screen: 'Settings', layout: 'Layout', background: 'Background',
    message: 'Message', alerts: 'Alerts', security: 'Display access', privacy: 'Private mode',
  };
  if (m) return `${m[1]}${m[2] ? ` › ${t(names[m[2]] ?? m[2])}` : ''}`;
  return t(names[key] ?? key);
}

export function describeActivity(e: ActivityEntry): { icon: IconName; text: string } {
  const d = (e.data ?? {}) as Record<string, any>;
  switch (e.type) {
    case 'auth.login':
      return { icon: 'user', text: d.method === 'google' ? t('Sign in with Google') : t('Signed in with password') };
    case 'auth.login_failed':
      return { icon: 'alert', text: d.reason ? t('Failed sign-in attempt ({reason})', { reason: str(d.reason) }) : t('Failed sign-in attempt') };
    case 'auth.logout':
      return { icon: 'logout', text: t('Signed out') };
    case 'auth.logout_all':
      return { icon: 'logout', text: t('Signed out everywhere') };
    case 'auth.setup_completed':
      return { icon: 'sparkles', text: t('First-run setup completed') + (d.screen ? ` · ${str(d.screen)}` : '') };
    case 'auth.setup_rejected':
      return { icon: 'alert', text: t('Setup wizard refused ({reason})', { reason: str(d.reason) }) };
    case 'auth.password_changed':
      return { icon: 'key', text: t('Password changed') };
    case 'google.connected':
      return { icon: 'google', text: t('Google account linked: {email}', { email: str(d.email ?? d.account) }) };
    case 'google.removed':
      return { icon: 'google', text: t('Google account unlinked: {email}', { email: str(d.email ?? d.account) }) };
    case 'microsoft.connected':
      return { icon: 'microsoft', text: t('Microsoft account linked: {email}', { email: str(d.email ?? d.account) }) };
    case 'microsoft.removed':
      return { icon: 'microsoft', text: t('Microsoft account unlinked: {email}', { email: str(d.email ?? d.account) }) };
    case 'config.saved': {
      const secs: string[] = Array.isArray(d.sections) ? d.sections : [];
      const list = secs.slice(0, 4).map(sectionLabel).join(', ') + (secs.length > 4 ? ` +${secs.length - 4}` : '');
      return { icon: 'check', text: secs.length ? t('Settings saved: {list}', { list }) : t('Settings saved') };
    }
    case 'config.restored':
      return {
        icon: 'history',
        text: t('Backup restored {id}', { id: q(d.id ?? d.backup) }) + (Array.isArray(d.repaired) && d.repaired.length ? ` · ${t('fixed values: {list}', { list: d.repaired.slice(0, 5).join(', ') })}` : ''),
      };
    case 'config.imported':
      return { icon: 'upload', text: Array.isArray(d.sections) && d.sections.length ? t('Settings imported: {list}', { list: d.sections.map(sectionLabel).join(', ') }) : t('Settings imported') };
    case 'config.exported':
      return { icon: 'download', text: d.secrets ? t('Settings exported (with secrets)') : t('Settings exported') };
    case 'config.migrated':
      return d.from
        ? { icon: 'wand', text: t('Settings migrated to the multi-screen format') }
        : { icon: 'wand', text: t('Existing install: screens in open mode (no key). Recommended: private links.') };
    case 'backup.created':
      return { icon: 'archive', text: t('Backup created') };
    case 'backup.deleted':
      return { icon: 'trash', text: t('Backup deleted') };
    case 'source.error':
      return { icon: 'alert', text: t('Error in calendar {name}: {error}', { name: q(d.name ?? d.sourceId), error: fetchErrorText(str(d.error)) }) };
    case 'source.recovered':
      return { icon: 'check', text: t('Calendar {name} recovered', { name: q(d.name ?? d.sourceId) }) };
    case 'announce.sent':
      return { icon: 'megaphone', text: t('Alert sent: {title}', { title: q(d.title) || '–' }) + (d.via === 'hook' ? ` · ${t('via webhook')}` : '') };
    case 'announce.cleared':
      return { icon: 'x', text: d.id ? t('Alert removed') : t('Alerts removed') };
    case 'token.created':
      return { icon: 'key', text: t('API token created: {name}', { name: q(d.name) }) };
    case 'token.revoked':
      return { icon: 'trash', text: t('API token revoked: {name}', { name: q(d.name) }) };
    case 'token.used':
      return { icon: 'zap', text: t('Webhook used: {endpoint}', { endpoint: str(d.endpoint ?? d.path ?? '') }) };
    case 'token.rejected':
      return { icon: 'alert', text: t('Webhook rejected (invalid token)') };
    case 'display.connected':
      return { icon: 'wifi', text: t('Screen connected: {screen}', { screen: str(d.screenName ?? d.screen ?? d.slug ?? d.clientId ?? '') }) };
    case 'privacy.changed': {
      const where = Array.isArray(d.screens) && d.screens.length ? d.screens.map(str).join(', ') : t('all screens');
      const text = d.mode === 'off' ? t('Private mode off: {screens}', { screens: where })
        : d.mode === 'on' ? t('Private mode on: {screens}', { screens: where })
          : t('Private mode switched: {screens}', { screens: where });
      return { icon: 'lock', text };
    }
    case 'display.command': {
      const a = str(d.action);
      const label = a === 'reload' ? t('reload') : a === 'identify' ? t('identify') : a === 'night' ? `${t('night mode')} ${str(d.mode)}` : a;
      return { icon: 'monitor', text: t('Command to screens: {action}', { action: label }) + (d.delivered != null ? ` · ${nScreens(Number(d.delivered))}` : '') };
    }
    case 'display.doorbell': {
      const text = d.action === 'dismiss' ? t('Doorbell removed from the screens') : d.extended ? t('Doorbell: rang again') : t('Doorbell: someone is at the door');
      return { icon: 'bell', text: text + (d.via === 'hook' ? ` · ${t('via webhook')}` : '') + (d.delivered != null ? ` · ${nScreens(Number(d.delivered))}` : '') };
    }
    case 'display.link_regenerated':
      return { icon: 'link', text: t('Private link regenerated: {screen}', { screen: str(d.screen) }) + (Number(d.disconnected) ? ` · ${nScreens(Number(d.disconnected))}` : '') };
    case 'display.paired':
      return { icon: 'link', text: t('Screen paired: {name} → {screen}', { name: q(d.name), screen: str(d.screen) }) };
    case 'display.pair_failed':
      return { icon: 'alert', text: t('Wrong pairing code') };
    case 'display.device_updated':
      return { icon: 'edit', text: t('Device edited: {name}', { name: q(d.name) }) };
    case 'display.device_revoked':
      return { icon: 'trash', text: t('Device revoked: {name}', { name: q(d.name) }) };
    case 'update.requested':
      return { icon: 'download', text: d.by === 'auto' ? t('Automatic update to {v} started', { v: str(d.to) }) : t('Update to {v} started', { v: str(d.to) }) };
    case 'update.finished':
      return d.state === 'current'
        ? { icon: 'check', text: t('Marco already had the latest version ({v})', { v: str(d.to) }) }
        : { icon: 'sparkles', text: t('Marco updated: {from} → {to}', { from: str(d.from), to: str(d.to) }) };
    case 'update.failed':
      return {
        icon: 'alert',
        text: (d.target ? t('The update to {v} failed', { v: str(d.target) }) : t('The update failed')) + (d.rolledBack ? ` · ${t('Marco went back to version {v}', { v: str(d.from) })}` : ''),
      };
    case 'update.settings':
      return { icon: 'settings', text: d.auto ? t('Automatic updates on ({from}–{to})', { from: str(d.from), to: str(d.to) }) : t('Update settings saved') };
    case 'activity.cleared':
      return { icon: 'trash', text: t('Activity log cleared') };
    default:
      return { icon: 'info', text: e.type };
  }
}

/** "token:Home Assistant" → "Home Assistant (API)", "system" → "Sistema" */
export function actorLabel(a: string): string {
  if (!a) return '–';
  if (a === 'system') return t('System');
  if (a === 'anonymous') return t('Anonymous');
  if (a === 'password') return t('Password');
  if (a.startsWith('token:')) return `${a.slice(6)} (API)`;
  return a;
}
