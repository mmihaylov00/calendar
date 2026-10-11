// Admin navigation metadata and the feature filters for the sidebar, the command palette and the settings
// search. Plain TypeScript with type-only imports, so the server tests can load it. App.tsx attaches the
// section components by id.
import type { AppConfig, FeatureName } from '../shared/types';
import type { IconName } from './components/icons';
import { hasFeature, offersAny, type Caps } from './caps';

/** One feature, or several (shown when at least one is on). */
export type Gate = FeatureName | readonly FeatureName[];

export interface NavMeta {
  id: string;
  label: string;
  icon: IconName;
  group: string;
  /** hidden when the server turns this feature off */
  feature?: Gate;
  enabled?: (c: AppConfig) => boolean;
  /** page edits the selected screen (shows the switcher emphasised) */
  perScreen?: boolean;
  keywords?: string;
}

export const NAV_ITEMS: NavMeta[] = [
  { id: 'home', label: 'Home', icon: 'home2', group: '' },
  { id: 'layout', label: 'Layout', icon: 'layout', group: 'Screen', perScreen: true },
  { id: 'background', label: 'Background', icon: 'image', group: 'Screen', enabled: (c) => c.background.enabled, perScreen: true },
  { id: 'screen', label: 'Settings', icon: 'settings', group: 'Screen', perScreen: true },
  { id: 'datetime', label: 'Date & time', icon: 'clock', group: 'Screen', enabled: (c) => c.datetime.enabled, perScreen: true },
  { id: 'calendars', label: 'Calendars', icon: 'calendar', group: 'Content', enabled: (c) => c.calendar.enabled },
  { id: 'local', label: 'Local events', icon: 'edit', group: 'Content', enabled: (c) => c.localEvents.enabled },
  { id: 'birthdays', label: 'Birthdays', icon: 'cake', group: 'Content', enabled: (c) => c.birthdays.enabled },
  { id: 'filters', label: 'Filters & overrides', icon: 'filter', group: 'Content' },
  { id: 'icons', label: 'Icons', icon: 'tag', group: 'Content' },
  { id: 'countdowns', label: 'Countdowns', icon: 'hourglass', group: 'Content', enabled: (c) => c.countdowns.enabled },
  { id: 'weather', label: 'Weather', icon: 'cloud', group: 'Content', enabled: (c) => c.weather.enabled },
  { id: 'news', label: 'News', icon: 'news', group: 'Content', feature: 'news', enabled: (c) => c.news.enabled },
  { id: 'todo', label: 'To-dos', icon: 'checklist', group: 'Content', enabled: (c) => c.todo.enabled },
  { id: 'message', label: 'Message', icon: 'message', group: 'Content', enabled: (c) => c.message.enabled, perScreen: true },
  { id: 'alerts', label: 'Alerts', icon: 'megaphone', group: 'Alerts', feature: ['announcements', 'schedules'] },
  { id: 'photos', label: 'Gallery', icon: 'photos', group: 'Integrations', feature: 'gallery' },
  { id: 'homeassistant', label: 'Home Assistant', icon: 'home', group: 'Integrations', feature: 'homeassistant', enabled: (c) => c.homeassistant.enabled },
  { id: 'api', label: 'API & webhooks', icon: 'code', group: 'Integrations', feature: ['apiTokens', 'webhooks'] },
  { id: 'screens', label: 'Screens', icon: 'monitor', group: 'System' },
  { id: 'displays', label: 'Connected screens', icon: 'wifi', group: 'System' },
  { id: 'backups', label: 'Backups', icon: 'archive', group: 'System', feature: ['backups', 'importExport'] },
  { id: 'activity', label: 'Activity', icon: 'history', group: 'System', feature: 'activity' },
  { id: 'security', label: 'Security', icon: 'shield', group: 'System' },
  { id: 'status', label: 'Status', icon: 'activity', group: 'System', feature: 'status' },
];

/** Command palette actions that depend on a feature (by PaletteItem id). */
export const ACTION_FEATURES: Record<string, Gate> = {
  'a-announce': 'announcements',
  'a-refresh': 'displayCommands',
  'a-night-on': 'displayCommands',
  'a-night-off': 'displayCommands',
  'a-night-auto': 'displayCommands',
  'a-identify': 'displayCommands',
  'a-export': 'importExport',
  'a-backup': 'backups',
  'a-token': 'apiTokens',
  'a-feedback': 'feedback',
};

/** Whether a gate is open for these capabilities (no gate = always). */
export const allowed = (caps: Caps, gate?: Gate): boolean => offersAny(caps, gate);

/** Nav entries (or anything with a `feature` gate) the server offers. */
export function filterNav<T extends { feature?: Gate }>(items: readonly T[], caps: Caps): T[] {
  return items.filter((n) => allowed(caps, n.feature));
}

/** Palette actions whose feature is on; actions not listed in ACTION_FEATURES always stay. */
export function filterActions<T extends { id: string }>(items: readonly T[], caps: Caps): T[] {
  return items.filter((i) => allowed(caps, ACTION_FEATURES[i.id]));
}

/** Settings search entries: the page must be visible, the entry's own feature (if any) on and its `unless` off. */
export function filterSettings<T extends { route: string; feature?: Gate; unless?: FeatureName }>(entries: readonly T[], caps: Caps, visibleRoutes: Iterable<string>): T[] {
  const routes = new Set(visibleRoutes);
  return entries.filter((e) => routes.has(e.route) && allowed(caps, e.feature) && !(e.unless && hasFeature(caps, e.unless)));
}

/** Route id for a hash: the requested page when visible, else home. */
export function routeFor(id: string, visible: readonly { id: string }[]): string {
  return visible.some((n) => n.id === id) ? id : 'home';
}

/** Multi-tenant servers (Marco Cloud) replace the Security page with the Account page: same id, so links to
 *  #/security keep working. Single-tenant servers keep Security as it is. */
export function accountNav<T extends NavMeta>(items: readonly T[], caps: Caps): T[] {
  if (caps.tenancy !== 'multi') return [...items];
  return items.map((n) => (n.id === 'security' ? { ...n, label: 'Account', icon: 'user' as IconName } : n));
}
