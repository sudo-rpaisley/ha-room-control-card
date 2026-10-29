"""Profile sensor compatible with the Room Control Card v0.3 shared source."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .profiles import export_rooms


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Publish one registry-managed, shared profile sensor."""
    async_add_entities([RoomProfilesSensor(entry)])


class RoomProfilesSensor(SensorEntity):
    """Expose central profiles; does not subscribe to or control physical devices."""

    _attr_name = "Room Control Profiles"
    _attr_icon = "mdi:home-group"
    _attr_should_poll = False
    _attr_has_entity_name = False

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._attr_unique_id = "room_control_profiles_registry_v1"
        # Home Assistant may suffix this if sensor.room_control_profiles is in use.
        self.entity_id = "sensor.room_control_profiles"

    @property
    def native_value(self) -> str:
        """No state machine updates required when the options flow reloads us."""
        return "ready"

    @property
    def extra_state_attributes(self) -> dict:
        """Frontend contract: attributes.rooms[room] = {area_id, profile, bindings}."""
        rooms = export_rooms(self._entry.options.get("rooms", {}))
        return {"rooms": rooms, "schema_version": 1, "source": "room_control_profiles", "profile_count": len(rooms)}
