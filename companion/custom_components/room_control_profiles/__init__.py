"""Read-only Room Control Profiles publisher; never operates household devices."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import PLATFORMS
from .profiles import validate_rooms


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Validate the persisted configuration and create the profile sensor."""
    validate_rooms(entry.options.get("rooms", {}))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    return True


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the sensor when an options flow saves a profile."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload sensor and registered listeners on removal/reload."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
