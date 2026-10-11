"""Open Marco through Home Assistant's authenticated app panel."""

import voluptuous as vol
from aiohttp import web

from homeassistant.components import frontend
from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

DOMAIN = "marco"
CONF_ADDON_SLUG = "addon_slug"
DEFAULT_ADDON_SLUG = "7cc5cd13_marco"
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional(CONF_ADDON_SLUG, default=DEFAULT_ADDON_SLUG): vol.All(
                    cv.string, vol.Match(r"^[a-z0-9_-]+$")
                )
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


class MarcoAccessView(HomeAssistantView):
    """Let the app verify Supervisor's forwarded Home Assistant user."""

    url = "/api/marco/access"
    name = "api:marco:access"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        caller = request.get("hass_user")
        if caller is None or not caller.is_active or not caller.is_admin:
            raise web.HTTPForbidden
        user_id = request.query.get("user_id", "")
        user = None
        if user_id and len(user_id) <= 128:
            user = await request.app[KEY_HASS].auth.async_get_user(user_id)
        allowed = bool(user and user.is_active and user.is_admin and not user.system_generated)
        return web.json_response({"allowed": allowed}, headers={"Cache-Control": "no-store"})


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the stable sidebar route for the configured app."""
    hass.http.register_view(MarcoAccessView())
    frontend.async_register_built_in_panel(
        hass,
        component_name="app",
        frontend_url_path=DOMAIN,
        sidebar_title="Marco",
        sidebar_icon="mdi:calendar-month",
        config={"addon": config[DOMAIN][CONF_ADDON_SLUG]},
        require_admin=True,
    )
    return True
