"""Offline stdlib tests for the companion's strict sensor data contract."""

from __future__ import annotations

import importlib
import json
import sys
import types
import unittest
from copy import deepcopy
from pathlib import Path

# Import only the pure validation module, not the HA-dependent package __init__.
COMPANION = Path(__file__).resolve().parents[1] / "custom_components"
ROOT = COMPANION / "room_control_profiles"
for name, directory in [("custom_components", COMPANION), ("custom_components.room_control_profiles", ROOT)]:
    if name not in sys.modules:
        module = types.ModuleType(name)
        module.__path__ = [str(directory)]
        sys.modules[name] = module
profiles = importlib.import_module("custom_components.room_control_profiles.profiles")


class ProfileTests(unittest.TestCase):
    def sample(self):
        return {"area_id": "kitchen", "profile": {"label": "Kitchen", "icon": "mdi:fridge", "path": "/lovelace/kitchen", "mop": True},
                "bindings": {"robot": "vacuum.s8_maxv_ultra", "temperature": "sensor.kitchen_temperature",
                             "mop_queue": "input_boolean.mop_que_kitchen"}}

    def test_round_trip_matches_frontend_contract(self):
        result = profiles.export_rooms({"kitchen": self.sample()})
        self.assertEqual(result["kitchen"]["bindings"]["robot"], "vacuum.s8_maxv_ultra")
        self.assertEqual(result["kitchen"]["area_id"], "kitchen")
        self.assertEqual(json.loads(json.dumps(result))["kitchen"]["profile"]["mop"], True)

    def test_cannot_enable_actions_via_profile(self):
        for field in ("enable_actions", "double_tap", "tap_action", "service", "automation"):
            with self.subTest(field=field):
                p = self.sample(); p[field] = True
                with self.assertRaises(profiles.InvalidProfile):profiles.validate_profile("kitchen", p)

    def test_cannot_inject_script_or_command_into_profile(self):
        for injection in ("script.vacuum_home_run", "javascript:alert(1)", "//example.org/evil"):
            p = self.sample(); p["profile"]["path"] = injection
            with self.assertRaises(profiles.InvalidProfile):profiles.validate_profile("kitchen", p)

    def test_rejects_bad_room_keys(self):
        for key in ("Kitchen", "../kitchen", "", "a/../x", "1kitchen", "kitchen one"):
            with self.subTest(key=key),self.assertRaises(profiles.InvalidProfile):profiles.validate_room_key(key)

    def test_rejects_wrong_domains_and_unknown_binding_roles(self):
        for key, entity in (("temperature", "binary_sensor.kitchen_state"), ("robot", "sensor.robot"), ("mop_queue", "vacuum.s8_maxv_ultra"), ("not_known", "sensor.a")):
            with self.subTest(role=key),self.assertRaises(profiles.InvalidProfile):
                p=self.sample();p["bindings"][key]=entity
                profiles.validate_profile("kitchen",p)

    def test_retains_known_real_robot_map_segment_as_metadata_only(self):
        p=self.sample();p["robot_map"]={"robot_entity_id":"vacuum.s8_maxv_ultra", "map_name":"Willowbank", "segment_id":19,"confirmed":True}
        out=profiles.validate_profile("kitchen",p)
        self.assertEqual(out["robot_map"]["segment_id"],19)
        self.assertTrue(out["robot_map"]["confirmed"])

    def test_robot_map_requires_manual_confirmed_assoc(self):
        p=self.sample();p["robot_map"]={"robot_entity_id":"vacuum.s8_maxv_ultra", "map_name":"Willowbank", "segment_id":19,"confirmed":False}
        with self.assertRaises(profiles.InvalidProfile): profiles.validate_profile("kitchen",p)
        p["robot_map"]["confirmed"]=True
        p["robot_map"]["map_name"]=""
        with self.assertRaises(profiles.InvalidProfile):profiles.validate_profile("kitchen",p)

    def test_same_map_cannot_reuse_segment_id(self):
        kitchen=self.sample();kitchen["robot_map"]={"robot_entity_id":"vacuum.s8_maxv_ultra", "map_name":"Willowbank", "segment_id":19,"confirmed":True}
        hall=deepcopy(kitchen);hall["area_id"]="hall"
        with self.assertRaises(profiles.InvalidProfile):profiles.validate_rooms({"kitchen":kitchen,"hall":hall})
        hall["robot_map"]["map_name"]="Other map"
        profiles.validate_rooms({"kitchen":kitchen,"hall":hall})

    def test_limits_total_rooms_and_attribute_size(self):
        with self.assertRaises(profiles.InvalidProfile):profiles.validate_rooms({f"room_{i}":{} for i in range(30)})
        original=profiles.MAX_EXPORT_BYTES
        try:
            profiles.MAX_EXPORT_BYTES=20
            with self.assertRaises(profiles.InvalidProfile):profiles.validate_rooms({"kitchen":self.sample()})
        finally:profiles.MAX_EXPORT_BYTES=original

    def test_update_and_delete_immutable(self):
        original={"hall":{}}
        out=profiles.update_room(original,"kitchen",self.sample())
        self.assertEqual(list(original),["hall"])
        gone=profiles.remove_room(out,"kitchen")
        self.assertEqual(list(gone),["hall"])
        self.assertIn("kitchen",out)

    def test_cannot_delete_absent(self):
        with self.assertRaises(profiles.InvalidProfile):profiles.remove_room({},"hall")

    def test_defaults(self):
        self.assertTrue(profiles.default_details("kitchen")["mop"])
        self.assertFalse(profiles.default_details("bedroom")["mop"])
        self.assertEqual(profiles.default_details("newroom")["path"],"/lovelace/newroom")

    def test_invalid_fields(self):
        for key, value in (("icon","not_an_icon"),("label",""),("path","/foo?bar"),("mop",1)):
            p=self.sample();p["profile"][key]=value
            with self.subTest(key=key),self.assertRaises(profiles.InvalidProfile):profiles.validate_profile("kitchen",p)

    def test_reject_bool_as_segment_id(self):
        p=self.sample();p["robot_map"]={"robot_entity_id":"vacuum.s8_maxv_ultra","map_name":"Willowbank","segment_id":True,"confirmed":True}
        with self.assertRaises(profiles.InvalidProfile):profiles.validate_profile("kitchen",p)

    def test_nonstandard_area_id_allowed(self):
        p=self.sample();p["area_id"]="living_room_2"
        self.assertEqual(profiles.validate_profile("livingroom",p)["area_id"],"living_room_2")


if __name__=="__main__":unittest.main()
