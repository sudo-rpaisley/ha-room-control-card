"""Strict, pure and side-effect-free room profile storage format.

The exported ``rooms`` attribute matches the frontend v0.3 shared-profile
contract. Robot map IDs are metadata, never an instruction to operate a robot.
"""

from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

from .const import MAX_EXPORT_BYTES, MAX_ROOMS, PROFILE_SCHEMA_VERSION, ROLE_DOMAINS, ROOM_PRESETS

ROOM_PATTERN = re.compile(r"[a-z][a-z0-9_]{0,63}\Z")
ENTITY_PATTERN = re.compile(r"[a-z_]+\.[a-z0-9_]+\Z")
AREA_PATTERN = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\Z")
ICON_PATTERN = re.compile(r"[a-z][a-z0-9_-]*:[a-z0-9_-]+\Z")
LOCAL_PATH_PATTERN = re.compile(r"/(?!/)[A-Za-z0-9/_-]+\Z")
VALID_KEYS = {"area_id", "profile", "bindings", "robot_map"}
PROFILE_KEYS = {"label", "icon", "path", "vacuum", "mop", "bedtime", "fan"}


class InvalidProfile(ValueError):
    """Invalid or unsafe room profile."""


def validate_room_key(key: str) -> str:
    if not isinstance(key, str) or not ROOM_PATTERN.fullmatch(key):
        raise InvalidProfile("Room keys must contain lower-case letters, digits or underscores")
    return key


def validate_entity_id(entity: str, role: str) -> str:
    if role not in ROLE_DOMAINS or not isinstance(entity, str) or not ENTITY_PATTERN.fullmatch(entity):
        raise InvalidProfile(f"Invalid entity mapping for {role}")
    if entity.split(".", 1)[0] != ROLE_DOMAINS[role]:
        raise InvalidProfile(f"Wrong entity domain for {role}: expected {ROLE_DOMAINS[role]}")
    return entity


def validate_profile(room: str, data: dict[str, Any]) -> dict[str, Any]:
    """Return a sanitised, JSON-ready profile; reject unexpected permissions/keys."""
    validate_room_key(room)
    if not isinstance(data, dict) or set(data) - VALID_KEYS:
        raise InvalidProfile("Room profile contains unsupported settings")
    result: dict[str, Any] = {}
    area = data.get("area_id")
    if area is not None:
        if not isinstance(area, str) or not AREA_PATTERN.fullmatch(area):
            raise InvalidProfile("Area ID is invalid")
        result["area_id"] = area
    profile = data.get("profile", {})
    if not isinstance(profile, dict) or set(profile) - PROFILE_KEYS:
        raise InvalidProfile("Unsupported appearance or action setting")
    clean_profile: dict[str, Any] = {}
    for key in ("label", "icon", "path"):
        if key not in profile:
            continue
        val = profile[key]
        if not isinstance(val, str) or len(val) > 100 or not val:
            raise InvalidProfile(f"Invalid {key}")
        if key == "icon" and not ICON_PATTERN.fullmatch(val):
            raise InvalidProfile("Invalid icon")
        if key == "path" and not LOCAL_PATH_PATTERN.fullmatch(val):
            raise InvalidProfile("Navigation must be a local Home Assistant path")
        clean_profile[key] = val
    for key in ("vacuum", "mop", "bedtime", "fan"):
        if key in profile:
            if type(profile[key]) is not bool:
                raise InvalidProfile(f"{key} must be a boolean")
            clean_profile[key] = profile[key]
    if clean_profile:
        result["profile"] = clean_profile
    bindings = data.get("bindings", {})
    if not isinstance(bindings, dict):
        raise InvalidProfile("Bindings must be an object")
    checked = {key: validate_entity_id(val, key) for key, val in bindings.items()}
    if checked:
        result["bindings"] = checked
    map_data = data.get("robot_map")
    if map_data is not None:
        if not isinstance(map_data, dict) or set(map_data) - {"segment_id", "map_name", "robot_entity_id", "confirmed"}:
            raise InvalidProfile("Invalid robot mapping data")
        if type(map_data.get("segment_id")) is not int or not 1 <= map_data["segment_id"] <= 9999:
            raise InvalidProfile("Robot segment ID must be a positive integer")
        if map_data.get("confirmed") is not True:
            raise InvalidProfile("Robot segment association requires manual confirmation")
        if not isinstance(map_data.get("map_name"), str) or not 1 <= len(map_data["map_name"]) <= 64:
            raise InvalidProfile("Robot map name must be explicitly selected")
        result["robot_map"] = {
            "segment_id": map_data["segment_id"],
            "map_name": map_data["map_name"],
            "robot_entity_id": validate_entity_id(map_data.get("robot_entity_id"), "robot"),
            "confirmed": True,
        }
    return result


def validate_rooms(rooms: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    if not isinstance(rooms, dict) or len(rooms) > MAX_ROOMS:
        raise InvalidProfile(f"Expected up to {MAX_ROOMS} rooms")
    checked = {validate_room_key(room): validate_profile(room, record) for room, record in rooms.items()}
    if len(json.dumps(checked, separators=(",", ":")).encode()) > MAX_EXPORT_BYTES:
        raise InvalidProfile("Profiles exceed Home Assistant sensor attribute size budget")
    # A segment may be reused on different maps or robots, not on the same robot/map.
    segments: set[tuple[str, str, int]] = set()
    for profile in checked.values():
        robot_map = profile.get("robot_map")
        if robot_map:
            key = (robot_map["robot_entity_id"], robot_map["map_name"], robot_map["segment_id"])
            if key in segments:
                raise InvalidProfile("Two rooms cannot share the same robot/map segment")
            segments.add(key)
    return checked


def export_rooms(rooms: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Export only fields understood by the frontend; no permissions or secrets."""
    checked = validate_rooms(rooms)
    return deepcopy(checked)


def update_room(rooms: dict[str, dict[str, Any]], key: str, entry: dict[str, Any]) -> dict[str, dict[str, Any]]:
    validate_room_key(key)
    new = deepcopy(rooms)
    new[key] = entry
    return validate_rooms(new)


def remove_room(rooms: dict[str, dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    new = deepcopy(rooms)
    if key not in new:
        raise InvalidProfile("Room does not exist")
    del new[key]
    return validate_rooms(new)


def default_details(key: str) -> dict[str, Any]:
    preset = ROOM_PRESETS.get(key, {})
    return {
        "label": preset.get("label", key.replace("_", " ").title()),
        "icon": preset.get("icon", "mdi:home-outline"),
        "path": f"/lovelace/{key}",
        "vacuum": preset.get("vacuum", False),
        "mop": preset.get("mop", False),
    }
