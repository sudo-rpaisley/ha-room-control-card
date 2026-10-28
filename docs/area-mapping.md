# Area-first device mapping (v0.2 pilot)

Use **Home Assistant Areas** for physical rooms. **Zones** represent GPS locations such as home, work, or school and are not used by the Room Control Card. **Floors** group Areas but do not determine individual room sensor ownership. Robot vacuum map segments are separate from Areas and are not inferred from an Area name.

## Try it on Dashboard Test

```yaml
type: custom:room-control-card
room: kitchen
bindings:
  robot: vacuum.s8_maxv_ultra
```

The card reads the Home Assistant Area, Device and Entity registries. It matches `room: kitchen` with an Area named Kitchen and also understands space/underscore differences such as `room: livingroom` versus an Area named Living Room. To choose an Area explicitly, set its real `area_id` from the graphical editor:

```yaml
type: custom:room-control-card
room: livingroom
area_id: living_room
bindings:
  robot: vacuum.s8_maxv_ultra
```

The `area_id` above is illustrative: choose the actual ID reported by your Home Assistant instance. If the area is missing or its name matches several Areas, the card won't silently select a different room's climate devices.

## How temperature and humidity are selected

1. **Manual override** (`bindings.temperature` / `bindings.humidity`), if supplied. This is deliberately under your control.
2. **Area-preferred sensor**, if the Home Assistant Area explicitly defines `temperature_entity_id` or `humidity_entity_id`.
3. **Exactly one sensor of the corresponding device class** in the Area, including sensor entities which inherit an Area through their parent device. Disabled/hidden registry entities are skipped.
4. **Exact legacy room naming pattern** (`sensor.<room>_multi_sensor_temperature` / `..._humidity`), but not if the registry assigns that entity to a different Area.

If two sensors are equally eligible, the card shows a diagnostic with both entity IDs instead of guessing. An unavailable sensor remains unavailable; the card does not replace it behind your back. Use the card editor to choose the correct device explicitly.

A dedicated `binary_sensor.<room>_state` is still an aggregate room status entity. It is *not* automatically substituted with an arbitrary occupancy or light entity. Users may set `bindings.room_state` explicitly.

## How Cassandra remains connected

The robot is a shared device: its own Home Assistant Area is **not** used to determine which room it is cleaning. The card does not infer Roborock segment IDs from Home Assistant Areas.

Cassandra's existing helpers remain the authoritative room-level inputs:

- `input_boolean.vacuum_que_<room>` and `input_boolean.cleaning_<room>`
- `input_boolean.mop_que_<room>` and `input_boolean.mopping_<room>` (Hall and Kitchen only)
- `counter.<room>_days_since_vacuum` / `_days_since_mop`

The global robot and water-readiness sensors are kept as a separate binding group. If multiple vacuum entities exist, choose the correct one explicitly with `bindings.robot`. The card does not complete a room, reset a counter, start a mop or send mobile notifications just because an Area entity changes; those operations remain with your HA scripts.

## Diagnosing the mapping

Open the card's visual editor and inspect **Entity bindings & diagnostics**. The UI reports which source was used: `manual`, `area-preferred`, `area-device` or `convention`. If an Area or sensor is ambiguous, choose an explicit entity ID. Use **Refresh Area/Device/Entity registries** after moving a device to a different Area; otherwise reopen the dashboard after making external registry changes.

The card requests only read-only registry lists through Home Assistant's frontend WebSocket connection. When registry reads are unavailable, existing exact-name bindings remain a compatibility fallback unless an explicit Area was requested, in which case ambiguous climate values fail closed.

## Deployment and safety

Run `npm run check` in the repository. Test rendering and diagnostics on **Dashboard Test** before considering Overview. Hold and double-tap actions remain disabled unless you explicitly set `enable_actions: true`. The existing rounded style and all corner status positions are preserved.
