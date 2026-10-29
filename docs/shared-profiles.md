# Room Control Card v0.3 — guided mappings and optional shared profiles

## Current status

The card can now read **shared read-only room definitions** from a Home Assistant
sensor's `attributes.rooms`. This is a transitional mechanism, **not a graphical
profile database** or a companion integration. It is optional; ordinary room cards
continue working without it. This repository does not edit `configuration.yaml`,
register new integrations, or write to Area/Device/Entity registries.

A profile entry may set `area_id`, `profile`, and `bindings`. An individual
card's values always override the shared values. The global profile cannot turn
on any physical action: every card still needs its own `enable_actions: true`.

## Example: one shared HA template sensor

To use central profiles, create a template sensor using your HA configuration
workflow and reload the Template integration or restart Home Assistant as required.
**Review and test the YAML separately**; do not overwrite an existing
`template:` section. One possible definition is:

```yaml
template:
  - sensor:
      - name: Room Control Profiles
        unique_id: room_control_profiles
        state: ready
        attributes:
          rooms: >-
            {{ {
              'kitchen': {
                'area_id': 'kitchen',
                'profile': {'label': 'Kitchen', 'icon': 'mdi:fridge'},
                'bindings': {'robot': 'vacuum.s8_maxv_ultra'}
              },
              'hall': {
                'area_id': 'hall',
                'bindings': {'robot': 'vacuum.s8_maxv_ultra'}
              }
            } | to_json }}
```

The `area_id` values above are **examples**. In the editor, choose the actual Area
IDs supplied by your HA instance, which can differ from display names.
`rooms` can be either a native dictionary or a JSON-encoded string. The source
must be `sensor.*`; a missing, unavailable or malformed sensor produces a
visible warning and falls back to the card's normal room configuration.

A card on any dashboard can then use:

```yaml
type: custom:room-control-card
room: kitchen
profiles_entity: sensor.room_control_profiles
```

To override a room's humidity sensor on one card without changing every
other card:

```yaml
type: custom:room-control-card
room: kitchen
profiles_entity: sensor.room_control_profiles
bindings:
  humidity: sensor.kitchen_preferred_humidity
```

## Room-mapping wizard

In the graphical editor:

1. Choose the room key and Area.
2. See the selected Area and each climate role's detected entity, source and diagnostic status.
3. If multiple temperature or humidity sensors qualify, choose one of the
   **Use sensor...** buttons. This records an explicit card-level binding.
4. Expand **Discovered room devices** for a read-only Area inventory of lights,
   covers, switches, climate sensors, occupancy sensors and media players.
5. Expand **Entity bindings & diagnostics** to confirm the exact Cassandra
   helper IDs and robot. Set `bindings.robot` explicitly if there is more than
   one vacuum entity.

The inventory does **not** yet generate controls for these additional devices.
The robot's map segment and cleaning queues are not inferred from the Area.
Cassandra's notification system and completion verification remain the source
of truth. The card never sends cleaning notifications or resets queues.

## Safe evaluation rules

- Binding domains, temperature/humidity device classes and numeric readings are checked.
- Out-of-range humidity readings, wrong device classes, unavailable states and
  wrong-area fallbacks do not produce a fabricated climate value.
- Unrelated Home Assistant state updates no longer trigger a full card rerender.
- The optional button-based actions menu is displayed only if physical actions
  are locally enabled and the corresponding script/entity is available.
- Global profiles are read-only and cannot enable physical actions.
- Editing an Area or entity mapping never changes it in Home Assistant itself.

## A future central profile manager

A separate HA integration would be needed to provide a proper graphical
create/edit/delete profile manager with persistence and sharing across devices.
This release provides an optional central read-only source while we test actual
Home Assistant device and Area assignments.
