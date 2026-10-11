# Marco for Home Assistant

Marco opens inside Home Assistant and uses your existing HA login. The app runs its server privately inside its container; no additional LAN port, setup code or Marco password is required. Only active Home Assistant administrators can use its admin panel.

## Install or update

1. Add `https://github.com/mmihaylov00/marco` under **Settings → Apps → App store → ⋮ → Repositories**, then install or update **Marco**.
2. Install the bundled `marco` integration into Home Assistant Core. From a Home Assistant SSH terminal with access to `/config`, run the helper from this repository:

   ```sh
   python3 home-assistant/install-panel.py --config-dir /config --addon-slug 7cc5cd13_marco
   ```

   The helper preserves unrelated configuration, backs up every changed installation and never restarts a service. It installs `home-assistant/custom_components/marco/` and adds the configuration below. If your app has a different slug, pass that slug to the helper.

   ```yaml
   marco:
     addon_slug: 7cc5cd13_marco
   ```

3. Validate Home Assistant configuration and restart **Home Assistant Core** once to load the integration. Start Marco, then open **Marco** in the sidebar or use **Open web UI**. The stable sidebar address is `/marco`.

The integration provides the native panel and an authenticated authorization endpoint. Marco checks the actual HA user on each ingress request; missing integration, unavailable authorization or an inactive/non-admin user denies access. Sidebar visibility is not the authorization check. The app keeps running as a separate container, just as Cinema does, while HA proxies its UI through port `8123`.

On older Home Assistant versions **Apps** is named **Add-ons**. The sidebar integration is installed once; when updating its source, reload it by restarting Core after configuration validation. No Marco app options or manually copied HA access tokens are needed.

## Connect Google calendars

Use Home Assistant to manage Google authorization:

1. Add and configure the [Google Calendar integration](https://www.home-assistant.io/integrations/google/) under **Settings → Devices & services**. Select the calendars you want available in HA.
2. In Marco, open **Calendars → Home Assistant calendars**, click **Refresh** and check the calendars you want to add.
3. Click **Save**, then select those sources for the screens where you want their events displayed.

Marco reads upcoming events through the HA API using the app credential supplied privately by Supervisor. It does not receive your Google OAuth credentials, and it does not create or edit Google events. Other HA calendar integrations can be used in the same way.

Private iCal feeds remain supported: copy a calendar's secret iCal URL into Marco's calendar sources. Keep those URLs private. Direct Google OAuth is retained for standalone deployments configured through environment variables; use HA calendar entities for this app because HA ingress session URLs are temporary OAuth callback addresses.

## Storage and updates

Configuration, calendar caches, credentials and photos live in `/data/marco`, included in Home Assistant app backups. Startup prepares this directory, then drops to the non-root `node` user before serving requests. Cold backups stop the app briefly for a consistent snapshot.

Update Marco through Home Assistant; upstream update checks are disabled. The English-only interface starts with no sample calendars, feeds or demo data. Existing calendar configuration and saved content are retained when updating.

The app has no exposed LAN port. External wall displays need an active administrator's Home Assistant session to access this deployment. Admin previews and connected-screen controls remain available through ingress.
