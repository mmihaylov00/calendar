# Architecture

Calendar runs as a Home Assistant app. Express serves the API and built browser assets; Preact manages the control panel, and TypeScript renders the calendar, clock, weather and photo backgrounds. Photo transitions use CSS.

## Boundaries

| Location | Responsibility |
| --- | --- |
| `deploy/start-container.js` | Prepare `/data/marco`, drop root privileges and load the server. |
| `server/app.js`, `server/routes/` | Network trust, HA authorization, API routes and static assets. |
| `server/core/` | Configuration validation, calendar projection and provider mapping without filesystem or HTTP dependencies. |
| `server/store.js` | Atomic persistence, revision checks and compatibility with saved configurations. |
| `server/calendars.js`, `server/ics.js`, `server/haCalendars.js` | Calendar fetching, recurrence expansion, source caches and HA calendar entities. |
| `server/weather.js`, `server/photos.js`, `server/homeassistant.js` | Weather providers, validated photo uploads and server-side HA API access. |
| `server/sse.js` | Authorized live configuration, calendar and photo updates. |
| `home-assistant/custom_components/marco/` | Native `/calendar-dashboard` panel and active-admin authorization endpoint. |
| `home-assistant/install-panel.py` | Atomic panel installation with a configuration backup; never restarts services. |
| `web/admin/` | Calendar workspace with the live display iframe, a native settings dialog, and revision-aware draft saving. |
| `web/display/` | Calendar rendering, local offline cache, CSS photo transitions and live updates. |
| `web/shared/` | Browser contracts, configuration projection, English strings and image cropping. |

## Data and compatibility

The app stores configuration, credentials, uploaded photos and calendar caches in private `/data/marco` storage. Home Assistant owns app backups and updates. Configuration writes are atomic; stale revisions receive `409` instead of overwriting another save. Credentials remain separate from configuration and are never returned to the calendar view.

Existing calendar providers, credentials, photos and layout preferences survive updates. The saved schema still accepts legacy fields and screen profiles so an update does not discard user data. The UI edits the default profile; retired widgets, jobs and endpoints are removed. Their old configuration fields do not activate services or appear in display payloads.

## Calendar flow

Enabled remote sources are fetched independently. ICS and provider recurrences expand inside the requested window; existing calendar styling rules remain applied. A source failure retains its last successful event cache. OAuth refreshes are shared per account and never replace working credentials with invalid token responses.

Google authorization is managed by HA's Google Calendar integration. Calendar lists HA calendar entities and reads events using Supervisor's server-side credential. Private iCal feeds and existing direct-provider sources remain compatible.

The browser obtains authorized configuration before showing offline cached data. Authorization failures clear cached payloads, stop photo rotation and hide calendar content. SSE carries only configuration, event, photo, reload and revocation messages; normal polling retries keep the view usable when a stream is unavailable.

## Home Assistant authentication

The app exposes no LAN port. Supervisor proxies HA requests to its private server. The native panel requires an administrator; the server independently checks Supervisor's forwarded user against the Core integration. Missing authorization denies access, and long-lived streams are rechecked. All assets, requests, photos and previews preserve the ingress prefix.

See [API.md](API.md) and [SECURITY.md](../SECURITY.md).
