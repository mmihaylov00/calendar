# Architecture

This fork runs as a Home Assistant app. Node.js and Express serve the API and built browser assets; the display uses TypeScript and three.js, and the admin uses TypeScript and Preact. Endpoint contracts are documented in [API.md](API.md).

## Modules

| Location | Responsibility |
| --- | --- |
| `deploy/start-container.js` | Read supported Home Assistant options, prepare private storage and drop root privileges before loading the server. |
| `server/index.js` | Load the store, start the HTTP server and handle shutdown. |
| `server/app.js`, `server/routes/` | Host checks, sessions, CSRF protection, access checks, API routers and static assets. |
| `server/core/` | Configuration defaults and validation, screen projection, event rules, recurrence helpers, privacy, pairing and import logic without filesystem or HTTP dependencies. |
| `server/store.js` | Atomic JSON persistence, secrets, configuration revisions and migrations. |
| `server/calendars.js`, `server/ics.js`, `server/google.js`, `server/microsoft.js` | Calendar providers, recurrence expansion, OAuth and source caches. |
| `home-assistant/custom_components/marco/` | Native HA app panel and active-admin authorization endpoint. |
| `home-assistant/install-panel.py` | Install managed panel files and configuration atomically, with backups and no service restarts. |
| `server/displayAccess.js`, `server/pairing.js` | Private screen keys, hashed device tokens and short-lived pairing sessions. |
| `server/sse.js`, `server/pollHub.js` | Live updates and the polling fallback. |
| `server/weather.js`, `server/news.js`, `server/photos.js`, `server/homeassistant.js` | External sources and media, isolated from other source failures. |
| `web/display/` | Screen rendering, offline cache, browser identity and live update handling. |
| `web/admin/` | Setup, configuration drafts, calendar linking, screen management and integrations. |
| `web/shared/` | Browser contracts, screen projection, English strings, emoji rules and photo cropping. |
| `server/test/` | Regression suites and fixtures for actual parsing and boundary behavior. |

## Storage and configuration

Home Assistant supplies `/data`; Marco stores its files in `/data/marco`. Startup checks this path, creates it with private permissions, makes it writable by the `node` user and drops to that user before serving requests. The app uses cold backups for a consistent snapshot.

| File | Content |
| --- | --- |
| `config.json` | Validated global settings, screen profiles and a revision incremented on each configuration save. |
| `secrets.json` | Password hash, session secret, OAuth credentials, Home Assistant token, display keys and hashed API/device tokens. Mode 600; never sent to displays. |
| `photos/` | Uploaded gallery files, thumbnails and focal-point metadata. |
| `cache/` | Calendar and feed caches. |
| `backups/` | Rotating configuration backups and originals retained during older-schema migrations. |
| `activity.jsonl` | Bounded activity history with secrets redacted. |
| `announcements.json`, `displays.json`, `privacy.json` | Announcement history, display registry and screen privacy state. |

Configuration separates global sources from screen profiles. `server/core/defaults.js` defines both; `server/core/screens.js` and `web/shared/screens.ts` project them into a flat view for one screen. Validation reports paths that the admin can map back to a section. Stale configuration revisions receive `409 conflict` rather than overwriting another save. Runtime background work does not bump the configuration revision.

Fresh installations have no sample calendar or news sources. English is the supported UI language; saved `es` and `pt` preferences normalize to `en`, while event titles and source data are preserved. New location defaults use Sofia; existing locations and time zones remain unchanged.

## Calendar flow

Each enabled source visible on the screen is fetched through its own cache. OAuth accounts use automatic refresh, including one retry after an unexpectedly rejected access token. Refresh operations for the same account are shared. Invalid token responses do not replace working credentials; source failures retain the last successful event cache.

ICS recurrences, local recurring events and yearly birthdays expand inside the requested window using the configured time zone. Event rules then hide, rename or style events, and icon/source defaults decorate the remaining items. Events are sorted and hashed to avoid unnecessary display rendering. Rental feed parsing retains its supported input formats; ordinary calendar titles are kept as supplied by the source.

Display privacy is applied after this pipeline. Busy mode keeps time blocks and calendar colours; hidden calendars and their countdowns are removed. The admin retains the full source view. Privacy changes are persisted before state is published to screens.

## Display and admin

The display obtains its configuration before showing cached private data. A missing credential opens pairing; a revoked credential wipes cached data and shows an access error. Private keys identify a screen; pairing stores a per-device token whose hash is kept on the server. Admin previews avoid writing display identity or cached content.

Routine updates patch the display without reloading. SSE carries configuration and content changes, announcements and screen commands; polling uses the same dispatcher when required. Local storage holds the last successful payload for outages. Access revocation and device reassignment are checked throughout the live connection. The `lite` URL setting reduces graphics for slower display devices.

The admin edits a local configuration draft and saves it explicitly. Photo preparation runs in the browser; the server validates names and image headers. Home Assistant weather values are converted from the entity's reported temperature unit to the display's selected unit.

## Deployment and security

The app exposes no LAN port. Supervisor proxies authenticated HA requests to internal port 3000. Browser assets, API calls and live streams use the ingress path. The native `/marco` panel requires an administrator, and the server independently verifies Supervisor's forwarded user against the Core integration on each request. The Core endpoint allows only authenticated active-admin callers and returns access only for active, non-system administrator users. Missing authorization denies access; credentials are never sent to the browser.

HA calendar sources use Supervisor's server-side Core API credential. Google authorization is managed by HA's Google Calendar integration, and Marco reads its calendar entities. Standalone deployments retain the original password/setup protections and environment-configured direct OAuth.

Home Assistant owns updates; the app disables the upstream update checker. The repository has no standalone installer, systemd/kiosk deployment, demo runtime or release-tarball pipeline.

See [SECURITY.md](../SECURITY.md) for session protection, network trust, outbound requests, display credentials and revocation behavior.
