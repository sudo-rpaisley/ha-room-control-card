"""Offline lifecycle/flow smoke tests with minimal Home Assistant API doubles.

These check contract and call behaviour, not full Home Assistant runtime support.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]/"custom_components"
APP=ROOT/"room_control_profiles"


def module(name, **fields):
    mod=types.ModuleType(name)
    for k,v in fields.items():setattr(mod,k,v)
    return mod


class FakeSchema:
    def __init__(self,data):self.schema=data


class Key:
    def __init__(self,name,default=None):self.name=name;self.default=default


class FakeSelector:
    def __init__(self,config=None):self.config=config


class FakeBaseFlow:
    @classmethod
    def __init_subclass__(cls,**kwargs):super().__init_subclass__()
    def async_show_form(self,**k):return {"type":"form",**k}
    def async_show_menu(self,**k):return {"type":"menu",**k}
    def async_create_entry(self,**k):return {"type":"create_entry",**k}


class FakeConfigFlow(FakeBaseFlow):
    async def async_set_unique_id(self,*a):return None
    def _abort_if_unique_id_configured(self):pass


class FakeOptionsFlow(FakeBaseFlow):pass


class FakeSensor:
    pass


class FakeAreaRegistry:
    def async_get_area(self,key):return {"area_id":key} if key in ("kitchen", "hall") else None


class FakeAreaSelector(FakeSelector):pass
class FakeEntitySelector(FakeSelector):pass
class FakeEntitySelectorConfig:
    def __init__(self,domain=None):self.domain=domain


def stubs():
    cc=module("homeassistant.config_entries",ConfigFlow=FakeConfigFlow,OptionsFlow=FakeOptionsFlow,ConfigEntry=type("ConfigEntry",(),{}),ConfigFlowResult=dict)
    core=module("homeassistant.core",HomeAssistant=type("HomeAssistant",(),{}),callback=lambda f:f)
    reg=module("homeassistant.helpers.area_registry",async_get=lambda hass:FakeAreaRegistry())
    sel=module("homeassistant.helpers.selector",AreaSelector=FakeAreaSelector,EntitySelector=FakeEntitySelector,EntitySelectorConfig=FakeEntitySelectorConfig)
    entreg=module("homeassistant.helpers.entity_registry")
    platform=module("homeassistant.helpers.entity_platform",AddConfigEntryEntitiesCallback=type("Callback",(),{}))
    helpers=module("homeassistant.helpers",area_registry=reg,entity_registry=entreg,selector=sel)
    sensor=module("homeassistant.components.sensor",SensorEntity=FakeSensor)
    comps=module("homeassistant.components",sensor=sensor)
    main=module("homeassistant",config_entries=cc,core=core,helpers=helpers,components=comps)
    vol=module("voluptuous",Schema=FakeSchema,Optional=lambda x,default=None:Key(x,default),Required=lambda x,default=None:Key(x,default),
                In=lambda x:x,All=lambda *args:args,Coerce=lambda x:x,Range=lambda **kw:kw)
    return {m.__name__:m for m in (main,cc,core,reg,sel,entreg,platform,helpers,sensor,comps,vol)}


class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.modules=stubs()
        cls.modules["custom_components"]=module("custom_components")
        cls.modules["custom_components"].__path__=[str(ROOT)]
        cls.modules["custom_components.room_control_profiles"]=module("custom_components.room_control_profiles")
        cls.modules["custom_components.room_control_profiles"].__path__=[str(APP)]
        cls.patch=patch.dict(sys.modules,cls.modules)
        cls.patch.start()
        cls.flow=importlib.import_module("custom_components.room_control_profiles.config_flow")
        cls.sensor=importlib.import_module("custom_components.room_control_profiles.sensor")
        cls.integration=importlib.import_module("custom_components.room_control_profiles",package="custom_components.room_control_profiles")

    @classmethod
    def tearDownClass(cls):
        cls.patch.stop()

    def options(self,rooms=None):
        flow=self.flow.RoomControlOptionsFlow()
        flow.hass=object()
        flow.config_entry=types.SimpleNamespace(options={"rooms":rooms or {}})
        return flow

    def test_initial_options_menu(self):
        x=asyncio.run(self.options().async_step_init())
        self.assertEqual(x["menu_options"],["add"])
        x=asyncio.run(self.options({"kitchen":{}}).async_step_init())
        self.assertEqual(x["menu_options"],["add","edit","remove"])

    def test_setup_flow_creates_empty_profile_registry(self):
        flow=self.flow.RoomControlProfilesFlow()
        x=asyncio.run(flow.async_step_user({}))
        self.assertEqual(x["options"],{"rooms":{}})

    def test_multi_step_add_does_not_save_until_review(self):
        flow=self.options()
        x=asyncio.run(flow.async_step_add({"room":"kitchen"}))
        self.assertEqual(x["step_id"],"details")
        details={"area_id":"kitchen","label":"Kitchen","icon":"mdi:fridge", "path":"/lovelace/kitchen",
                 "vacuum":True,"mop":True,"bedtime":False,"fan":False}
        x=asyncio.run(flow.async_step_details(details))
        self.assertEqual(x["step_id"],"climate")
        x=asyncio.run(flow.async_step_climate({"temperature":"sensor.kitchen_temperature"}))
        self.assertEqual(x["step_id"],"cleaning")
        x=asyncio.run(flow.async_step_cleaning({"robot":"vacuum.s8_maxv_ultra"}))
        self.assertEqual(x["step_id"],"robot_map")
        x=asyncio.run(flow.async_step_robot_map({"segment_id":19,"map_name":"Willowbank","robot_entity_id":"vacuum.s8_maxv_ultra","confirmed":True}))
        self.assertEqual(x["step_id"],"review")
        x=asyncio.run(flow.async_step_review({"confirm":True}))
        self.assertEqual(x["type"],"create_entry")
        self.assertEqual(x["data"]["rooms"]["kitchen"]["robot_map"]["segment_id"],19)
        self.assertEqual(x["data"]["rooms"]["kitchen"]["bindings"]["temperature"],"sensor.kitchen_temperature")

    def test_invalid_area_fails_without_write(self):
        f=self.options();f._room="kitchen"
        x=asyncio.run(f.async_step_details({"area_id":"not_real","label":"Kitchen","icon":"mdi:fridge","path":"/lovelace/kitchen","vacuum":True,"mop":True,"bedtime":False,"fan":False}))
        self.assertEqual(x["errors"]["area_id"],"unknown_area")

    def test_wrong_domain_binding_rejected(self):
        f=self.options();f._room="kitchen";f._working={"profile":{"mop":True}}
        x=asyncio.run(f.async_step_climate({"humidity":"binary_sensor.invalid"}))
        self.assertEqual(x["errors"]["base"],"invalid_profile")

    def test_remove_requires_explicit_confirmation(self):
        f=self.options({"kitchen":{}})
        asyncio.run(f.async_step_remove({"room":"kitchen"}))
        cancel=asyncio.run(f.async_step_confirm_remove({"confirm":False}))
        self.assertEqual(cancel["type"],"menu")
        yes=asyncio.run(f.async_step_confirm_remove({"confirm":True}))
        self.assertEqual(yes["data"],{"rooms":{}})

    def test_publisher_is_read_only_and_exports_native_rooms(self):
        entry=types.SimpleNamespace(options={"rooms":{"kitchen":{"bindings":{"robot":"vacuum.s8_maxv_ultra"}}}})
        sensor=self.sensor.RoomProfilesSensor(entry)
        self.assertEqual(sensor.native_value,"ready")
        self.assertEqual(sensor.extra_state_attributes["rooms"]["kitchen"]["bindings"]["robot"],"vacuum.s8_maxv_ultra")
        self.assertEqual(sensor.extra_state_attributes["profile_count"],1)
        self.assertEqual(sensor.extra_state_attributes["source"], "room_control_profiles")
        self.assertFalse(hasattr(sensor,"turn_on"))

    def test_manifest_is_config_flow_single_entry_with_version(self):
        data=json.loads((APP/"manifest.json").read_text())
        self.assertTrue(data["config_flow"])
        self.assertTrue(data["single_config_entry"])
        self.assertEqual(data["integration_type"],"helper")
        self.assertTrue(data["version"])


if __name__=="__main__":unittest.main()
