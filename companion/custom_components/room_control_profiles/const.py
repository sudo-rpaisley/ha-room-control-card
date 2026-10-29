"""Constants for Room Control Profiles."""

DOMAIN = "room_control_profiles"
PLATFORMS = ["sensor"]
ROOMS_KEY = "rooms"
MAX_ROOMS = 24
MAX_EXPORT_BYTES = 12000
PROFILE_SCHEMA_VERSION = 1

ROLE_DOMAINS = {
    "room_state": "binary_sensor", "temperature": "sensor", "humidity": "sensor",
    "vacuum_queue": "input_boolean", "vacuum_active": "input_boolean",
    "vacuum_days": "counter", "mop_queue": "input_boolean", "mop_active": "input_boolean",
    "mop_days": "counter", "bedtime": "input_boolean", "fan": "switch",
    "robot": "vacuum", "robot_status": "sensor", "robot_cleaning": "binary_sensor",
    "water_shortage": "binary_sensor", "mop_attached": "binary_sensor",
    "water_box_attached": "binary_sensor", "dock_error": "sensor",
}

ROOM_PRESETS = {
    "kitchen": {"label": "Kitchen", "icon": "mdi:fridge", "vacuum": True, "mop": True},
    "office": {"label": "Office", "icon": "mdi:desk-lamp-on", "vacuum": True, "mop": False},
    "hall": {"label": "Hall", "icon": "mdi:coat-rack", "vacuum": True, "mop": True},
    "bathroom": {"label": "Bathroom", "icon": "mdi:bathtub", "vacuum": False, "mop": False},
    "bedroom": {"label": "Bedroom", "icon": "mdi:bed-king", "vacuum": True, "mop": False},
    "livingroom": {"label": "Living Room", "icon": "mdi:sofa-single", "vacuum": True, "mop": False},
}
