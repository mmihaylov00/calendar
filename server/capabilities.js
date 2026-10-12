// Capability block for GET /api/health. The admin and the display read it to decide which sections,
// actions and limits apply. Marco Cloud answers the same shape with its own values; a server that sends
// no `features` field is treated as having every feature on.
import { googleConfigured, googleLoginEnabled } from './google.js';
import { getConfig } from './store.js';
import { microsoftConfigured } from './microsoft.js';
import { homeAssistantMode } from './ingress.js';

/** Legacy feature names remain false so older clients cannot expose removed controls. */
export const FEATURE_KEYS = Object.freeze([
  'homeassistant', 'news', 'customCss', 'gallery', 'schedules', 'announcements', 'displayCommands',
  'openDisplayAccess', 'insecureTls', 'googleCalendar', 'googleLogin', 'passwordLogin', 'apiTokens',
  'webhooks', 'backups', 'importExport', 'includeSecrets', 'activity', 'setupWizard', 'status', 'accountMenu',
  'microsoftCalendar', 'updates', 'feedback', 'privacy', 'doorbell', 'doorbellLive',
]);

/** Capabilities supported by this installation. */
export function selfHostedFeatures() {
  const out = Object.fromEntries(FEATURE_KEYS.map(key => [key, false]));
  out.homeassistant = true;
  out.customCss = true;
  out.gallery = true;
  out.insecureTls = true;
  if (!homeAssistantMode()) {
    out.googleCalendar = googleConfigured();
    out.microsoftCalendar = microsoftConfigured();
    out.googleLogin = googleLoginEnabled(getConfig());
    out.passwordLogin = getConfig()?.auth.passwordLoginEnabled !== false;
    out.openDisplayAccess = true;
  }
  return out;
}

/** Live data updates use server-sent events. */
export const liveMode = () => 'sse';

/** Internal health and client compatibility response. */
export function healthBody({ version }) {
  return {
    ok: true,
    uptime: Math.round(process.uptime()),
    version,
    live: liveMode(),
    edition: 'self-hosted',
    tenancy: 'single',
    runtime: 'node',
    features: selfHostedFeatures(),
  };
}
