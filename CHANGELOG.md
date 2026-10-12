# Changelog

## [0.6.1-ha.5]

- Reduce the control panel to calendar connections, layout, backgrounds, weather and photos.
- Remove screen management, backups, security/status/settings pages, alerts, messages, to-dos, news, local events and birthdays, including their display widgets and service endpoints.
- Keep Home Assistant authentication, Google/HA calendar discovery, existing calendar credentials and configuration save protection.

## [0.6.1-ha.4]

- Rename the app, sidebar, interface and repository to Calendar.
- Use `/calendar-dashboard` without conflicting with Home Assistant's built-in `/calendar` page.
- Preserve installed app IDs, stored settings and backup compatibility.

## [0.6.1-ha.3]

- Open Marco through Home Assistant's native `/marco` panel and private ingress, with no exposed LAN port or separate setup code/password.
- Check active Home Assistant administrator access on requests and live streams; keep standalone authentication outside HA.
- Read calendar entities managed by Home Assistant, including Google calendars, without copying OAuth credentials into Marco.
- Preserve ingress paths for assets, API requests, photos, live events and display previews.

## [0.6.1-ha.2]

- Make the admin, display and server messages English-only; normalize saved Spanish and Portuguese language settings without changing calendar data.
- Remove demo runtime paths, sample feeds, screenshots, marketing assets and unused standalone installers and release tooling.
- Keep the Home Assistant app, Google Calendar integration, private display access and regression tests.

## [0.6.1-ha.1]

- Package Marco for Home Assistant with private persistent storage and a server that drops root privileges before startup.
- Refresh Google access tokens once after an unexpected authorization failure and share concurrent refresh requests.
- Preserve stored credentials and privacy state when disk writes fail.
- Normalize Home Assistant weather temperature units.
- Export photo ZIP files with portable Unix file metadata.

Based on upstream Marco 0.6.1. Original commit history is retained in Git.
