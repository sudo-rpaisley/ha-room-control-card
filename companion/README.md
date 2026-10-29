# Room Control Profiles — optional Home Assistant companion (v0.1.0 pilot)

A **local, read-only profile registry** for the [Room Control Card](https://github.com/sudo-rpaisley/ha-room-control-card).
It exposes a Home Assistant sensor whose `attributes.rooms` conforms to the card's v0.3 shared-profile contract.
**It does not control robots, send notifications, change queues, reset cleaning counters or edit device/area registries.**

## Installation for the first HAOS pilot

This companion is **not installed by HACS when you install the Room Control Card**. HACS Dashboard repositories install JavaScript frontend resources, not an embedded custom integration. For a manual test:

1. Copy `companion/custom_components/room_control_profiles/` (the whole directory) to `/config/custom_components/room_control_profiles/` on your **Home Assistant VM**. Do not put it on the NVIDIA Spark or another Docker host.
2. Restart Home Assistant to load the new custom integration. Back up your configuration first.
3. Navigate to **Settings → Devices & services → Add integration → Room Control Profiles**. Complete the initial setup.
4. Select **Room Control Profiles → Configure**, choose **Add room**, and complete the guided forms. You can add/edit/remove profiles at any time through Configure.
5. Verify that the generated entity is `sensor.room_control_profiles` (it may receive a suffix if you already have a sensor with that ID). In **Developer tools → States**, verify the `rooms` attribute.
6. Add a card to **Dashboard Test**:

```yaml
type: custom:room-control-card
room: kitchen
profiles_entity: sensor.room_control_profiles
bindings:
  robot: vacuum.s8_maxv_ultra
```

Replace `profiles_entity` with the actual entity ID if different. You can omit `bindings.robot` when you have explicitly selected it in the companion, and the profile has been verified in Home Assistant. The normal card configuration continues to work without the companion.

Do **not** replace the live Overview until the experimental integration and card have been verified on the HAOS VM.

## Configure each room

The integration's UI takes you through:

1. **Add / edit / remove** — a lower-case room key such as `kitchen`, `hall` or `livingroom`.
2. **Area and appearance** — choose an existing HA Area, a room label, icon and local dashboard path; enable only the indicators you want.
3. **Climate and room helpers** — select temperature, humidity, room-state, bedtime and fan entities using Home Assistant's entity selectors. Leave values blank to let the card perform its area-first discovery.
4. **Cleaning** — select verified robot and per-room queues, active flags, counters and readiness sensors. Shared robots do not need to belong to the kitchen/hall Area.
5. **Robot map (optional)** — enter a map, a robot entity and a room-segment number, then check the confirmation box. This **stores metadata only**; it does not dispatch Roborock commands.
6. **Review and save** — the new profile is committed atomically; no partial setup is stored.

For the current Cassandra script's **Willowbank** map, the repository's `vacuum_room` code presently lists Kitchen as segment **19**, Hall as **24**, Living Room **20**, Bedroom **23**, Office **17** and Bathroom **22**. These are *script mappings*, not proof of the live Roborock map. Confirm each value on the robot before entering it. Mop capability is only supported by the existing `vacuum_room` script for **Kitchen and Hall**. The companion never changes that eligibility.

## Data contract and precedence

The companion creates one entity of domain `sensor` with `state: ready`, stable unique ID, and attributes like:

```yaml
rooms:
  kitchen:
    area_id: kitchen
    profile:
      label: Kitchen
      icon: mdi:fridge
      path: /lovelace/kitchen
      vacuum: true
      mop: true
      bedtime: false
      fan: false
    bindings:
      robot: vacuum.s8_maxv_ultra
      temperature: sensor.kitchen_multi_sensor_temperature
    robot_map:
      robot_entity_id: vacuum.s8_maxv_ultra
      map_name: Willowbank
      segment_id: 19
      confirmed: true
schema_version: 1
profile_count: 1
```

The v0.3 card reads `area_id`, `profile`, and `bindings`. `robot_map` is **read-only forward-compatible metadata**, not yet consumed for navigation or robot control. A local card's settings take precedence over shared profiles. Shared profiles cannot enable physical actions or inject action/service definitions; this is enforced by the integration's strict schema and the card's local-only `enable_actions` flag.

Room keys are checked, binding entity domains are restricted, and the integration refuses duplicate segment numbers on the same robot/map. It does not automatically verify physical cleaning completion or map identity. Settings live in the standard Home Assistant config-entry **options** store (back this up along with your HA config). There are no tokens or passwords in the profile data.

**Limits:** maximum 24 profiles; 12 KB export budget to keep the sensor's attributes bounded. This pilot provides sequential forms under integration Configure, **not** a standalone custom sidebar/panel or independently installable HACS integration repository. A dedicated HACS *Integration* repository is recommended once HAOS runtime compatibility is demonstrated.

## Test / diagnostics

```bash
cd companion
python3 -m unittest discover -s tests -v
python3 -m compileall -q custom_components/room_control_profiles
```

These tests use stdlib fakes for the HA APIs; they test the data contract, UI flow sequencing, validation, and sensor metadata. They **do not prove HAOS runtime loading, entity registry uniqueness, graphical form rendering or touch interactions**. Report any errors from Settings → System → Logs (search `room_control_profiles`) and the resulting state/attributes of `sensor.room_control_profiles`.
