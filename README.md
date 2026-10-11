# Marco for Home Assistant

Personal Home Assistant fork of [mr-reb00t/marco](https://github.com/mr-reb00t/marco), maintained at [mmihaylov00/marco](https://github.com/mmihaylov00/marco).

Marco displays family calendars, weather, photos, local events, birthdays and Home Assistant announcements in a browser. Each screen has its own layout and private link. This fork uses English throughout and starts without sample calendars, news feeds or demo data.

## Install in Home Assistant

Add `https://github.com/mmihaylov00/marco` to **Settings → Apps → App store → ⋮ → Repositories**, install **Marco**, then follow [the setup guide](DOCS.md). The app supports 64-bit Raspberry Pi and x86 systems.

Marco opens at `/marco` through Home Assistant ingress and uses your HA login. Active HA administrators can access the panel; no separate port, setup code or Marco password is needed. Configuration, photos and credentials live in the app's private `/data/marco` storage and are included in Home Assistant app backups. Manage updates through Home Assistant.

## Connecting Google Calendar

Add Google's calendar integration in Home Assistant, then choose its calendar entities under Marco's **Calendars → Home Assistant calendars** and click **Save**. Marco reads upcoming events through the HA API without handling Google OAuth credentials. Other HA calendars and private iCal feeds are also supported.

The [connection and installation guide](DOCS.md) explains the bundled HA integration required for the native panel and per-request user authorization. Standalone deployments retain direct Google OAuth through environment configuration. Keep OAuth credentials and private iCal URLs out of this repository.

## Display

Open a screen's private link from **Connected screens**, or open `/pair` on a display and claim its code in the admin. Use the admin preview to try layout changes before saving.

The display keeps cached data for network interruptions and refreshes when the server returns. Private links and paired-device tokens protect the displayed calendar data. See [the security policy](SECURITY.md).

Useful display URL overrides include `?lite=1` for reduced graphics, `?weeks=2` for a shorter grid, `?compact=0` for normal-sized event rows, `?marquee=0` to stop scrolling titles, and `?rotate=0` to stop paging busy days. Append overrides with `&` when the URL already has a query string.

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
