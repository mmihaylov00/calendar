# Calendar for Home Assistant

Personal Home Assistant fork of [mr-reb00t/marco](https://github.com/mr-reb00t/marco), maintained at [mmihaylov00/calendar](https://github.com/mmihaylov00/calendar).

Calendar displays calendars, a clock, weather and photo backgrounds inside Home Assistant. The control panel contains calendar connections, layout, backgrounds, weather and photos. This fork uses English throughout and starts without sample content.

## Install in Home Assistant

Keep the registered HA repository URL `https://github.com/mmihaylov00/marco`, which redirects to the renamed Calendar repository. This preserves the installed app's ID and data. For a new installation, add this compatibility URL to **Settings → Apps → App store → ⋮ → Repositories**, install **Calendar**, then follow [the setup guide](DOCS.md). The app supports 64-bit Raspberry Pi and x86 systems.

Calendar opens at `/calendar-dashboard` through Home Assistant ingress and uses your HA login. Active HA administrators can access the panel; no separate port, setup code or Calendar password is needed. Configuration, photos and credentials live in the app's private `/data/marco` storage and are included in Home Assistant app backups. Manage updates through Home Assistant.

## Connecting Google Calendar

Add Google's calendar integration in Home Assistant, then choose its calendar entities under Calendar's **Calendars → Home Assistant calendars** and click **Save**. Calendar reads upcoming events through the HA API without handling Google OAuth credentials. Other HA calendars and private iCal feeds are also supported.

The [connection and installation guide](DOCS.md) explains the bundled HA integration required for the native panel and per-request user authorization. Keep OAuth credentials and private iCal URLs out of this repository.

## Display

Use **Open calendar** to open the calendar with your Home Assistant session. Use the preview to try layout changes before saving.

The display keeps cached data for network interruptions and refreshes when the server returns. Home Assistant authenticates access to the display and admin. See [the security policy](SECURITY.md).

Calendar connections and uploaded photos survive updates. Home Assistant owns authentication, app updates and backups. Old configuration fields are retained for compatibility; retired widgets and services do not run.

## Development

Use Node.js 22 and install dependencies with `npm ci`. Validate changes with:

```sh
npm test
npm run typecheck
node scripts/gen-contract.mjs --check
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [the architecture](docs/ARCHITECTURE.md) and [the API reference](docs/API.md). Runtime data, credentials and build outputs are ignored by Git.

MIT licensed. Original attribution and third-party notices are retained in [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
