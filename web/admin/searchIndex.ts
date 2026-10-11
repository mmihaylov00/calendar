// Static index of individual settings for the command palette (Ctrl/Cmd+K).
// label = English setting name, anchor = element id.
// feature = hidden when the server turns it off (navFilter.ts); the page's own feature applies too.
// unless = hidden when the server turns this feature on (the setting lives on another page there).
import type { FeatureName } from '../shared/types';

export interface SettingEntry {
  label: string;
  route: string;
  anchor?: string;
  keywords?: string;
  feature?: FeatureName | readonly FeatureName[];
  unless?: FeatureName;
}

export const SETTINGS_INDEX: SettingEntry[] = [
  // Pantalla
  { label: 'Glass (Modern style)', route: 'layout', anchor: 'layout-glass' },
  { label: 'Classic / modern style', route: 'layout', anchor: 'layout-style' },
  { label: 'Layout template', route: 'layout', anchor: 'layout-presets' },
  { label: 'Layouts: today, per person, two weeks, board, photo frame, bedside', route: 'layout', anchor: 'layout-presets' },
  { label: 'Side panel (left/right, width)', route: 'layout', anchor: 'layout-side' },
  { label: 'Background photos', route: 'background', anchor: 'bg-photos' },
  { label: 'Ambient effect (aurora, particles)', route: 'background', anchor: 'bg-ambient' },
  { label: 'Weather effect (rain, snow, sun)', route: 'background', anchor: 'bg-weather' },
  { label: 'Screen name', route: 'screen', anchor: 'scr-general' },
  { label: 'Orientation (landscape / portrait)', route: 'screen', anchor: 'scr-general' },
  { label: 'Font size', route: 'screen', anchor: 'scr-general' },
  { label: 'Light / dark theme', route: 'screen', anchor: 'scr-look' },
  { label: 'Accent colour', route: 'screen', anchor: 'scr-look' },
  { label: 'Night mode (schedule and brightness)', route: 'screen', anchor: 'scr-night' },
  { label: 'Custom CSS', route: 'screen', anchor: 'scr-css', feature: 'customCss' },
  { label: 'Private link', route: 'screen', anchor: 'scr-link' },
  { label: 'Clock (digital / analog, seconds, 24 h)', route: 'datetime', anchor: 'dt-clock' },
  { label: 'Time zone', route: 'datetime', anchor: 'dt-clock' },
  { label: 'Date format', route: 'datetime', anchor: 'dt-format' },
  // Contenido
  { label: 'Add iCal calendar (.ics URL)', route: 'calendars', anchor: 'cal-sources' },
  { label: 'Google Calendar accounts', route: 'calendars', anchor: 'cal-accounts', feature: 'googleCalendar' },
  { label: 'Microsoft accounts', route: 'calendars', anchor: 'cal-accounts', feature: 'microsoftCalendar' },
  { label: 'Calendars shown on this screen', route: 'calendars', anchor: 'cal-screen-sources' },
  { label: 'Calendar view (month, week, agenda)', route: 'calendars', anchor: 'cal-view' },
  { label: 'Max events per day', route: 'calendars', anchor: 'cal-view' },
  { label: 'Local events', route: 'local', anchor: 'local-list' },
  { label: 'Birthdays', route: 'birthdays', anchor: 'bday-list' },
  { label: 'Import birthdays (CSV)', route: 'birthdays', anchor: 'bday-list' },
  { label: 'Show age on birthdays', route: 'birthdays', anchor: 'bday-settings' },
  { label: 'Hide events by keyword', route: 'filters', anchor: 'flt-rules' },
  { label: 'Rename events', route: 'filters', anchor: 'flt-rules' },
  { label: 'Force emoji or color of a series', route: 'filters', anchor: 'flt-rules' },
  { label: 'Preview of the next 14 days', route: 'filters', anchor: 'flt-preview' },
  { label: 'Automatic icons (emoji by keyword)', route: 'icons', anchor: 'ico-rules' },
  { label: 'Countdowns', route: 'countdowns', anchor: 'cd-list' },
  { label: 'Automatic countdowns (birthdays, flagged events)', route: 'countdowns', anchor: 'cd-auto' },
  { label: 'Weather location', route: 'weather', anchor: 'wx-main' },
  { label: 'Weather data source', route: 'weather', anchor: 'wx-source' },
  { label: 'Hourly and daily forecast', route: 'weather', anchor: 'wx-main' },
  { label: 'Home Assistant weather sensors', route: 'weather', anchor: 'wx-ha', feature: 'homeassistant' },
  { label: 'News sources (RSS)', route: 'news', anchor: 'news-feeds' },
  { label: 'To-do list', route: 'todo' },
  { label: 'Custom message', route: 'message' },
  // Avisos
  { label: 'Send an alert now', route: 'alerts', anchor: 'al-send', feature: 'announcements' },
  { label: 'Active alerts', route: 'alerts', anchor: 'al-active', feature: 'announcements' },
  { label: 'Scheduled messages (trash, reminders)', route: 'alerts', anchor: 'al-sched', feature: 'schedules' },
  { label: 'Alert sound and volume', route: 'alerts', anchor: 'al-screen' },
  // Integraciones
  { label: 'Photo gallery', route: 'photos' },
  { label: 'Home Assistant connection', route: 'homeassistant', anchor: 'ha-conn' },
  { label: 'Doorbell and camera', route: 'homeassistant', anchor: 'ha-doorbell', feature: 'doorbell' },
  // servers without a live camera (Marco Cloud) have no Home Assistant page: the card is in API & webhooks
  { label: 'Doorbell', route: 'api', anchor: 'api-doorbell', feature: 'doorbell', unless: 'doorbellLive' },
  { label: 'API tokens', route: 'api', anchor: 'api-tokens', feature: 'apiTokens' },
  { label: 'Home Assistant example (rest_command)', route: 'api', anchor: 'api-examples', feature: 'webhooks' },
  // Sistema
  { label: 'Screens (create, duplicate, default)', route: 'screens', anchor: 'scr-list' },
  { label: 'Private mode (guests)', route: 'screen', anchor: 'scr-privacy', feature: 'privacy' },
  { label: 'Connected screens', route: 'displays' },
  { label: 'Paired devices', route: 'displays', anchor: 'disp-paired' },
  { label: 'Display access', route: 'security', anchor: 'sec-display', feature: 'openDisplayAccess' },
  { label: 'Export settings', route: 'backups', anchor: 'bk-export', feature: 'importExport' },
  { label: 'Import settings', route: 'backups', anchor: 'bk-import', feature: 'importExport' },
  { label: 'Automatic backups', route: 'backups', anchor: 'bk-auto', feature: 'backups' },
  { label: 'Download photos (.zip)', route: 'backups', anchor: 'bk-photos', feature: ['importExport', 'gallery'] },
  { label: 'Activity log', route: 'activity' },
  { label: 'Change password', route: 'security', anchor: 'sec-password', feature: 'passwordLogin' },
  { label: 'Allowed Google emails', route: 'security', anchor: 'sec-google', feature: 'googleLogin' },
  { label: 'Sign out everywhere', route: 'security', anchor: 'sec-sessions', feature: ['passwordLogin', 'googleLogin'] },
  { label: 'Household name', route: 'security', anchor: 'acc-household', feature: 'accountMenu' },
  { label: 'Open sessions', route: 'security', anchor: 'acc-links', feature: 'accountMenu' },
  { label: 'Source status', route: 'status' },
  { label: 'Updates', route: 'status', anchor: 'updates', feature: 'updates' },
];
