"""UI-managed room profile options; no device-control services are registered."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.config_entries import ConfigFlowResult as FlowResult
from homeassistant.helpers import area_registry, entity_registry, selector

from .const import DOMAIN, MAX_ROOMS, ROOMS_KEY
from .profiles import InvalidProfile, default_details, remove_room, update_room, validate_room_key


class RoomControlProfilesFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """One local profile registry per Home Assistant installation."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Start empty; users add actual Areas through integration Options."""
        await self.async_set_unique_id("room_control_profiles_singleton")
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Room Control Profiles", data={}, options={ROOMS_KEY: {}})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> config_entries.OptionsFlow:
        """HA attaches config_entry to the returned OptionsFlow."""
        return RoomControlOptionsFlow()


class RoomControlOptionsFlow(config_entries.OptionsFlow):
    """Guided, staged editing with atomic commit and no implicit HA entity changes."""

    def __init__(self) -> None:
        self._room: str | None = None
        self._working: dict[str, Any] = {}

    @property
    def _rooms(self) -> dict[str, dict[str, Any]]:
        return deepcopy(self.config_entry.options.get(ROOMS_KEY, {}))

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Choose profile operation."""
        steps = []
        if len(self._rooms) < MAX_ROOMS:
            steps.append("add")
        if self._rooms:
            steps.extend(["edit", "remove"])
        return self.async_show_menu(step_id="init",menu_options=steps)

    async def async_step_add(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors = {}
        if user_input is not None:
            try:
                room = validate_room_key(user_input["room"])
                if room in self._rooms:
                    errors["room"] = "already_exists"
                else:
                    self._room = room
                    self._working = {}
                    return await self.async_step_details()
            except (InvalidProfile, KeyError):
                errors["room"] = "invalid_room"
        return self.async_show_form(step_id="add",data_schema=vol.Schema({vol.Required("room"): str}),errors=errors)

    async def async_step_edit(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            self._room = user_input["room"]
            self._working = deepcopy(self._rooms[self._room])
            return await self.async_step_details()
        return self.async_show_form(step_id="edit",data_schema=vol.Schema({vol.Required("room"): vol.In(sorted(self._rooms))}))

    async def async_step_remove(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            self._room = user_input["room"]
            return await self.async_step_confirm_remove()
        return self.async_show_form(step_id="remove",data_schema=vol.Schema({vol.Required("room"): vol.In(sorted(self._rooms))}))

    async def async_step_confirm_remove(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            if user_input.get("confirm") is True:
                return self.async_create_entry(title="",data={ROOMS_KEY: remove_room(self._rooms,self._room)})
            return await self.async_step_init()
        return self.async_show_form(step_id="confirm_remove",data_schema=vol.Schema({vol.Required("confirm",default=False):bool}),description_placeholders={"room":self._room})

    async def async_step_details(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Set Area and appearance; no mapping guessed from a display name."""
        current = self._working.get("profile", {})
        defaults=default_details(self._room)
        errors={}
        if user_input is not None:
            if user_input.get("area_id"):
                known=area_registry.async_get(self.hass).async_get_area(user_input["area_id"])
                if known is None:
                    errors["area_id"]="unknown_area"
            if not errors:
                self._working["area_id"]=user_input.get("area_id")
                if not self._working["area_id"]:
                    self._working.pop("area_id")
                self._working["profile"]={
                    "label":user_input["label"],"icon":user_input["icon"],"path":user_input["path"],
                    "vacuum":user_input["vacuum"],"mop":user_input["mop"],
                    "bedtime":user_input["bedtime"],"fan":user_input["fan"],
                }
                try:
                    update_room(self._rooms,self._room,self._working)
                except InvalidProfile:
                    errors["base"]="invalid_profile"
                if not errors:
                    return await self.async_step_climate()
        form=self._working.get("profile",current)
        fields={
            vol.Required("label",default=form.get("label",defaults["label"])):str,
            vol.Required("icon",default=form.get("icon",defaults["icon"])):str,
            vol.Required("path",default=form.get("path",defaults["path"])):str,
            vol.Required("vacuum",default=form.get("vacuum",defaults["vacuum"])):bool,
            vol.Required("mop",default=form.get("mop",defaults["mop"])):bool,
            vol.Required("bedtime",default=form.get("bedtime",False)):bool,
            vol.Required("fan",default=form.get("fan",False)):bool,
        }
        area=self._working.get("area_id")
        fields[vol.Optional("area_id",default=area) if area else vol.Optional("area_id")]=selector.AreaSelector()
        return self.async_show_form(step_id="details",data_schema=vol.Schema(fields),errors=errors,description_placeholders={"room":self._room})

    def _entity_schema(self, roles: dict[str,str]) -> vol.Schema:
        """HA native entity pickers; the backend verifies each selected role/domain."""
        current=self._working.get("bindings",{})
        schema={}
        for role,domain in roles.items():
            default=current.get(role)
            key=vol.Optional(role,default=default) if default else vol.Optional(role)
            schema[key]=selector.EntitySelector(selector.EntitySelectorConfig(domain=domain))
        return vol.Schema(schema)

    def _collect_bindings(self, inputs: dict, roles: set[str]) -> None:
        bindings=self._working.setdefault("bindings",{})
        for role in roles:
            if inputs.get(role):
                bindings[role]=inputs[role]
            else:
                bindings.pop(role,None)
        if not bindings:
            self._working.pop("bindings",None)

    async def async_step_climate(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        roles={"room_state":"binary_sensor","temperature":"sensor","humidity":"sensor","bedtime":"input_boolean","fan":"switch"}
        errors={}
        if user_input is not None:
            self._collect_bindings(user_input,set(roles))
            try:
                update_room(self._rooms,self._room,self._working)
            except InvalidProfile:
                errors["base"]="invalid_profile"
            if not errors:
                return await self.async_step_cleaning()
        return self.async_show_form(step_id="climate",data_schema=self._entity_schema(roles),errors=errors)

    async def async_step_cleaning(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        roles={
            "robot":"vacuum", "vacuum_queue":"input_boolean", "vacuum_active":"input_boolean", "vacuum_days":"counter",
            "mop_queue":"input_boolean", "mop_active":"input_boolean", "mop_days":"counter",
            "robot_status":"sensor", "robot_cleaning":"binary_sensor",
            "water_shortage":"binary_sensor", "mop_attached":"binary_sensor", "water_box_attached":"binary_sensor", "dock_error":"sensor",
        }
        errors={}
        if user_input is not None:
            self._collect_bindings(user_input,set(roles))
            try:
                update_room(self._rooms,self._room,self._working)
            except InvalidProfile:
                errors["base"]="invalid_profile"
            if not errors:
                return await self.async_step_robot_map()
        return self.async_show_form(step_id="cleaning",data_schema=self._entity_schema(roles),errors=errors)

    async def async_step_robot_map(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Optional explicit metadata only; never send segment commands."""
        current=self._working.get("robot_map",{})
        errors={}
        if user_input is not None:
            segment=user_input.get("segment_id",0)
            if segment:
                data={"segment_id":segment,"map_name":user_input.get("map_name",""),
                      "robot_entity_id":user_input.get("robot_entity_id", ""),"confirmed":user_input.get("confirmed",False)}
                self._working["robot_map"]=data
            else:
                self._working.pop("robot_map",None)
            try:
                update_room(self._rooms,self._room,self._working)
            except InvalidProfile:
                errors["base"]="invalid_mapping"
            if not errors:
                return await self.async_step_review()
        schema=vol.Schema({
            vol.Required("segment_id",default=current.get("segment_id",0)):vol.All(vol.Coerce(int),vol.Range(min=0,max=9999)),
            vol.Optional("map_name",default=current.get("map_name","")):str,
            vol.Optional("robot_entity_id",default=current.get("robot_entity_id","")):str,
            vol.Required("confirmed",default=current.get("confirmed",False)):bool,
        })
        return self.async_show_form(step_id="robot_map",data_schema=schema,errors=errors)

    async def async_step_review(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        """Only commit fully validated room settings after explicit confirmation."""
        errors={}
        if user_input is not None:
            if user_input.get("confirm") is True:
                try:
                    updated=update_room(self._rooms,self._room,self._working)
                except InvalidProfile:
                    errors["base"]="invalid_profile"
                else:
                    return self.async_create_entry(title="",data={ROOMS_KEY:updated})
            else:
                return await self.async_step_init()
        return self.async_show_form(step_id="review",data_schema=vol.Schema({vol.Required("confirm",default=False):bool}),errors=errors,description_placeholders={"room":self._room})
