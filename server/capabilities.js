// Capability block for GET /api/health. The admin and the display read it to decide which sections,
// actions and limits apply. Marco Cloud answers the same shape with its own values; a server that sends
// no `features` field is treated as having every feature on.
import { googleConfigured, googleLoginEnabled } from './google.js';
import { getConfig } from './store.js';
import { microsoftConfigured } from './microsoft.js';
import { CODE_LENGTH } from './pairing.js';
import { homeAssistantMode } from './ingress.js';

/** Every feature key, in the order docs/API.md lists them. */
export const FEATURE_KEYS = Object.freeze([
  'homeassistant', 'news', 'customCss', 'gallery', 'schedules', 'announcements', 'displayCommands',
  'openDisplayAccess', 'insecureTls', 'googleCalendar', 'googleLogin', 'passwordLogin', 'apiTokens',
  'webhooks', 'backups', 'importExport', 'includeSecrets', 'activity', 'setupWizard', 'status', 'accountMenu',
  'microsoftCalendar', 'updates', 'feedback', 'privacy', 'doorbell', 'doorbellLive',
]);

/** Feature flags of a self-hosted server: all on (`updates` too: the update banner and settings), Google and
 *  Microsoft follow their credentials, no account menu and no feedback form (that one reaches Marco Cloud's team).
 *  `doorbell` is the ring overlay and its hook; `doorbellLive` says the frames are a live camera picture proxied
 *  from Home Assistant (a server without it serves the latest uploaded snapshot instead). */
export function selfHostedFeatures() {
  const google = googleConfigured();
  const out = {};
  for (const k of FEATURE_KEYS) out[k] = true;
  out.googleCalendar = google;
  out.googleLogin = googleLoginEnabled(getConfig());
  out.accountMenu = false;
  out.feedback = false;
  out.microsoftCalendar = microsoftConfigured();
  if (homeAssistantMode()) {
    out.setupWizard = false;
    out.passwordLogin = false;
    out.googleLogin = false;
    out.googleCalendar = false;
    out.microsoftCalendar = false;
    out.openDisplayAccess = false;
    out.apiTokens = false;
    out.webhooks = false;
  }
  return out;
}

/** Live update channel for displays: 'sse' unless MARCO_LIVE=poll. */
export const liveMode = (env = process.env) => (String(env.MARCO_LIVE || '').trim().toLowerCase() === 'poll' ? 'poll' : 'sse');

/**
 * Body of GET /api/health. `lanAddresses` is only passed for a client on this machine (routes/public.js): the
 * pairing screen of a kiosk opened on http://localhost shows them instead of "localhost".
 */
export function healthBody({ version, env = process.env, lanAddresses }) {
  const body = {
    ok: true,
    uptime: Math.round(process.uptime()),
    version,
    live: liveMode(env),
    edition: 'self-hosted',
    tenancy: 'single',
    runtime: 'node',
    pairCodeLength: CODE_LENGTH,
    features: selfHostedFeatures(),
  };
  if (Array.isArray(lanAddresses) && lanAddresses.length) body.lanAddresses = lanAddresses.slice(0, 3);
  return body;
}
