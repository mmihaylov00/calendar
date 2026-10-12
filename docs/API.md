# HTTP API

All browser URLs are relative to the current HA ingress prefix. Supervisor's credential stays on the server. Display payloads never include private calendar URLs or tokens.

## Calendar view

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Internal health check, build version and supported capabilities. |
| `GET /api/display/config?screen=` | Calendar, clock, layout, background and weather configuration. Source descriptions contain only public display metadata. |
| `GET /api/events?from=&to=&screen=` | Expanded remote calendar events, content hash and per-source errors. |
| `GET /api/weather` | Current weather, forecast and provider metadata. |
| `GET /api/photos` | Available photo backgrounds. |
| `GET /api/stream?screen=` | SSE: `hello`, `config`, `events`, `photos`, `reload`, `revoked` and liveness pings. |
| `GET /media/:file` | Authorized gallery image or thumbnail. |

The browser uses the default saved profile. Old profile IDs/slugs and private display credentials remain compatible. Access failures return `401` or `403`; the browser clears cached calendar content instead of showing it.

## Control panel

Every admin route requires authentication and sends `Cache-Control: no-store`. Changes require same-origin JSON requests, except validated multipart photo uploads.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/me` | Current identity and HA authentication mode. |
| `GET /api/admin/config` | Saved configuration and revision. |
| `PUT /api/admin/config` | Validate and atomically save a configuration draft; accepts `baseRevision`. |
| `GET /api/admin/homeassistant/calendars` | HA calendar entities, including calendars connected through Google's HA integration. |
| `GET /api/admin/homeassistant/entities?domain=` | HA weather and sensor entity choices. |
| `POST /api/admin/test/ics` | Validate and fetch an iCal source without saving it. |
| `GET /api/admin/geocode?q=&lang=` | Weather location search. |
| `GET /api/admin/weather/key` | Whether a provider key is stored; never returns the key. |
| `PUT /api/admin/weather/key` | Validate and store a weather provider key. |
| `GET /api/admin/photos` | Gallery metadata. |
| `POST /api/admin/photos/check` | Check upload names for collisions. |
| `POST /api/admin/photos?onConflict=` | Upload validated images, metadata and optional thumbnails. |
| `PATCH /api/admin/photos/:file` | Photo focal point and visibility. |
| `POST /api/admin/photos/visibility` | Bulk photo visibility changes. |
| `PUT /api/admin/photos/:file/thumb` | Upload a validated thumbnail. |
| `DELETE /api/admin/photos/:file` | Remove a gallery photo. |

Existing direct Google/Microsoft sources retain their account listing and unlinking endpoints. The HA interface uses HA calendar entities for new Google connections.

Configuration saves return `409 { error: "conflict", revision }` when the loaded revision is stale. Invalid drafts return `400 { error: "invalid config", details: [{ path, message }] }`. Neither error changes the saved configuration. The control panel can reload the saved draft or merge its changes against the newest revision before retrying.

The generated [admin contract](../web/shared/adminContract.json) lists the actual browser calls and their request/response types. Regenerate it with `node scripts/gen-contract.mjs` after changing the API client.

## Native HA integration

`GET /api/marco/access?user_id=` runs in Home Assistant Core. It requires an authenticated active administrator and returns access only for active, non-system administrator users. The Calendar server calls it using Supervisor's private credential to verify ingress users; browsers do not call it directly.
