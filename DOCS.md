# Marco for Home Assistant

This fork runs Marco as a Home Assistant app (formerly called an add-on) on 64-bit Raspberry Pi and x86 systems. The interface is English-only. New installs start without sample calendars, news feeds or demo data.

## Install

1. Open **Settings → Apps → App store → ⋮ → Repositories** and add `https://github.com/mmihaylov00/marco`.
2. Install **Marco**. The first install builds the image on your Home Assistant machine and can take several minutes.
3. Start Marco, open its **Log** tab and copy the one-time setup code from the setup URL.
4. Use **Open web UI**, paste that code into the setup wizard and create your admin password. The dashboard is at `http://<home-assistant-ip>:3000/` and the admin panel is at `/admin/`.

On older Home Assistant versions the menu is named **Add-ons**. Port `3000` can be changed in the app's **Network** settings.

Marco keeps its configuration, calendar tokens and photos in `/data/marco`, included in Home Assistant app backups. The server runs as the non-root `node` user. Startup only uses root to make this directory writable, then drops privileges before loading the server. Cold backups stop the app briefly so its data is saved consistently. Update Marco through Home Assistant; upstream update checks are disabled in this app.

The app uses Marco's own password and setup protections. Open it through its dedicated port. Home Assistant ingress is not enabled because Marco uses root-relative browser URLs and Google needs a stable OAuth callback address.

## Connect Google calendars

### Private iCal feeds

For the smallest setup, open each calendar's Google Calendar **Settings → Integrate calendar → Secret address in iCal format**. In Marco, open **Calendars → Add iCal URL** and paste that URL. This reads events without a Google OAuth client or a public domain. Keep each secret URL private. Some managed Google accounts do not provide secret addresses.

### Google OAuth

Marco already supports read-only Google Calendar access, multiple Google accounts and automatic token refresh. Use OAuth when you want to select calendars from your account or private iCal URLs are unavailable.

1. Serve Marco through a stable HTTPS URL using your reverse proxy, for example `https://calendar.example.com`. The proxy must forward to Marco's dedicated port, not Home Assistant's `8123` port.
2. Create a **Web application** OAuth client in Google Cloud, enable the Google Calendar API and configure its consent screen. Add the exact redirect URI `https://calendar.example.com/auth/google/callback`. Add your account as a test user if the consent screen is in Testing.
3. In the Home Assistant app's **Configuration**, set `public_url` to `https://calendar.example.com`, set `google_client_id` and `google_client_secret`, and set `trust_proxy` to the address or subnet of your reverse proxy. Restart Marco to apply the options.
4. Open Marco through that same HTTPS URL, sign in to its admin and choose **Calendars → Linked accounts → Link account**. Choose Google if a provider picker appears, authorize your Google account and select the calendars to display. Repeat for other family accounts.

Google OAuth clients in Testing can expire refresh tokens after seven days ([Google's token expiration guide](https://developers.google.com/identity/protocols/oauth2#expiration)). Publish the consent screen when ready or reconnect when Google revokes access. The private iCal path does not need these OAuth settings.

## Options

| Option | Purpose |
| --- | --- |
| `public_url` | Stable HTTP/HTTPS origin for Marco. OAuth normally requires HTTPS. Leave blank for private iCal on the LAN. |
| `google_client_id` | Google Cloud Web application client ID. |
| `google_client_secret` | Client secret, entered as a password field and stored in the app's private options. |
| `allowed_hosts` | Additional accepted host names, comma-separated, if needed. IP addresses and normal LAN host names already work. |
| `trust_proxy` | Reverse proxy IP addresses or CIDR ranges. Leave blank for direct LAN access; trust only your actual proxies. |
| `lan_address` | Home Assistant's LAN IP or host name for dashboard links, useful because the app cannot detect the host's address. |

Leave optional values blank until you need them. Never publish OAuth credentials, private calendar URLs or app backups in the fork.
