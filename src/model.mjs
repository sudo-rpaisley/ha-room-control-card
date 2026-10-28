/** Pure room-state, binding and action evaluation. No DOM or Home Assistant side effects. */
export const ROOM_PRESETS = Object.freeze({
  kitchen:    { label: 'Kitchen',     icon: 'mdi:fridge',           path: '/lovelace/kitchen',    vacuum: true,  mop: true,  bedtime: false, fan: false, doubleTap: 'none' },
  office:     { label: 'Office',      icon: 'mdi:desk-lamp-on',    path: '/lovelace/office',     vacuum: true,  mop: false, bedtime: true,  fan: false, doubleTap: 'bedtime' },
  hall:       { label: 'Hall',        icon: 'mdi:coat-rack',      path: '/lovelace/hall',       vacuum: true,  mop: true,  bedtime: false, fan: false, doubleTap: 'vacuum' },
  bathroom:   { label: 'Bathroom',    icon: 'mdi:bathtub',        path: '/lovelace/bathroom',   vacuum: false, mop: false, bedtime: false, fan: true,  doubleTap: 'fan' },
  bedroom:    { label: 'Bedroom',     icon: 'mdi:bed-king',       path: '/lovelace/bedroom',    vacuum: true,  mop: false, bedtime: true,  fan: false, doubleTap: 'bedtime' },
  livingroom: { label: 'Living Room', icon: 'mdi:sofa-single',    path: '/lovelace/livingroom',vacuum: true,  mop: false, bedtime: true,  fan: false, doubleTap: 'bedtime' }
});

export const BINDING_DOMAINS = Object.freeze({
  room_state:'binary_sensor',temperature:'sensor',humidity:'sensor',
  vacuum_queue:'input_boolean',vacuum_active:'input_boolean',vacuum_days:'counter',
  mop_queue:'input_boolean',mop_active:'input_boolean',mop_days:'counter',
  bedtime:'input_boolean',fan:'switch',robot:'vacuum',robot_status:'sensor',
  robot_cleaning:'binary_sensor',water_shortage:'binary_sensor',mop_attached:'binary_sensor',
  water_box_attached:'binary_sensor',dock_error:'sensor'
});



/** Registry metadata is read-only. A physical Area is not a GPS Zone or a robot map segment. */
export function normaliseAreaName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]/g,'');
}

export function findArea(room, areaId, registries) {
  if(!registries || !Array.isArray(registries.areas)) {
    return {id:areaId||null,quality:'pending',source:areaId?'explicit':'not-loaded',name:null};
  }
  const areas=registries.areas;
  if(areaId) {
    const matching=areas.find(a=>a.area_id===areaId);
    return matching?{id:matching.area_id,name:matching.name,quality:'ok',source:'explicit',area:matching}:
      {id:areaId,name:null,quality:'missing',source:'explicit'};
  }
  const key=normaliseAreaName(room);
  const matching=areas.filter(a=>[a.area_id,a.name,...(a.aliases||[])]
    .some(n=>normaliseAreaName(n)===key));
  if(matching.length===1)return {id:matching[0].area_id,name:matching[0].name,quality:'ok',source:'matched',area:matching[0]};
  if(matching.length>1)return {id:null,name:null,quality:'ambiguous',source:'matched',candidates:matching.map(a=>a.area_id)};
  return {id:null,name:null,quality:'not-found',source:'matched'};
}

export function effectiveEntityArea(entry, registries) {
  if(entry?.area_id) return entry.area_id;
  if(!entry?.device_id) return null;
  return (registries?.devices||[]).find(x=>x.id===entry.device_id)?.area_id||null;
}

/** Match preferred Area climate entities first, then a uniquely identified device_class sensor. */
export function discoverClimate(room, config, hass, registries) {
  const selected=findArea(room,config.area_id,registries);
  const result={area:selected,roles:{}};
  if(selected.quality!=='ok'||!Array.isArray(registries?.entities))return result;
  const entities=registries.entities;
  const states=hass?.states||{};
  for(const role of ['temperature','humidity']) {
    const preferred=selected.area?.[`${role}_entity_id`];
    if(preferred) {result.roles[role]={id:preferred,source:'area-preferred'};continue;}
    const matches=entities.filter(e=>e && !e.disabled_by && !e.hidden_by &&
      e.entity_id?.startsWith('sensor.') && effectiveEntityArea(e,registries)===selected.id &&
      (states[e.entity_id]?.attributes?.device_class===role));
    // An unavailable but uniquely assigned sensor must remain unavailable, not be replaced.
    if(matches.length===1)result.roles[role]={id:matches[0].entity_id,source:'area-device'};
    else if(matches.length>1)result.roles[role]={id:null,source:'area-device',quality:'ambiguous',candidates:matches.map(e=>e.entity_id).sort()};
  }
  return result;
}

export const BAD_STATES = new Set(['unknown', 'unavailable', '', null, undefined]);
const ALLOWED_ROOM = /^[a-z][a-z0-9_]{0,63}$/;
const ALLOWED_ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

export function getPreset(room, config = {}) {
  const saved = ROOM_PRESETS[room] || {};
  // Explicit per-card override of a preset; no automatic physical action for a new room.
  const custom = config.profile && typeof config.profile === 'object' ? config.profile : {};
  const label = custom.label || saved.label || room.replaceAll('_',' ');
  return {
    label, icon: custom.icon || saved.icon || 'mdi:home-outline',
    path: custom.path || saved.path || `/lovelace/${room}`,
    vacuum: custom.vacuum ?? saved.vacuum ?? false,
    mop: custom.mop ?? saved.mop ?? false,
    bedtime: custom.bedtime ?? saved.bedtime ?? false,
    fan: custom.fan ?? saved.fan ?? false,
    doubleTap: custom.double_tap ?? saved.doubleTap ?? 'none',
  };
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || !ALLOWED_ROOM.test(config.room || '')) {
    throw new Error('Room Control Card: set a room key such as "kitchen" (lowercase letters/numbers/underscores).');
  }
  for (const [name,id] of Object.entries(config.bindings || {})) {
    if (!(name in BINDING_DOMAINS) || typeof id !== 'string' || !ALLOWED_ENTITY.test(id)) {
      throw new Error(`Room Control Card: invalid entity binding ${name}.`);
    }
  }
  if(config.area_id !== undefined && (typeof config.area_id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(config.area_id))) {
    throw new Error('Room Control Card: area_id must be a Home Assistant area ID.');
  }
  const path=config.navigation_path || config.profile?.path;
  if (path && (!/^\/[a-zA-Z0-9/_-]+$/.test(path) || path.startsWith('//'))) {
    throw new Error('Room Control Card: navigation path must be a local dashboard path.');
  }
  return true;
}

/** Exact conventional names are candidates only; never fuzzy-match unrelated devices. */
export function proposedBindings(room, profile) {
  return {
    room_state:`binary_sensor.${room}_state`,
    temperature:`sensor.${room}_multi_sensor_temperature`,
    humidity:`sensor.${room}_multi_sensor_humidity`,
    ...(profile.vacuum ? {
      vacuum_queue:`input_boolean.vacuum_que_${room}`,
      vacuum_active:`input_boolean.cleaning_${room}`,
      vacuum_days:`counter.${room}_days_since_vacuum`,
    } : {}),
    ...(profile.mop ? {
      mop_queue:`input_boolean.mop_que_${room}`,
      mop_active:`input_boolean.mopping_${room}`,
      mop_days:`counter.${room}_days_since_mop`,
    } : {}),
    ...(profile.bedtime ? { bedtime:`input_boolean.bedtime_${room}` } : {}),
    ...(profile.fan ? { fan:`switch.${room}_extractor_fan` } : {}),
  };
}

export function resolveBindings(config, hass, registries = null) {
  validateConfig(config);
  const room=config.room, profile=getPreset(room,config);
  const states=hass?.states || {};
  const availableVacuumEntities=Object.keys(states).filter(id=>id.startsWith('vacuum.'));
  const automaticRobot=availableVacuumEntities.length===1 ? availableVacuumEntities[0] : null;
  const candidates=proposedBindings(room,profile);
  const climate=discoverClimate(room,config,hass,registries);
  const suggestedSource={};
  const unresolvedArea=(config.area_id && climate.area.quality!=='ok') || climate.area.quality==='ambiguous';
  if(unresolvedArea){
    // An explicitly missing Area or ambiguous area name must not fall back to a potentially wrong room sensor.
    delete candidates.temperature;delete candidates.humidity;
  }
  for(const role of ['temperature','humidity']) {
    const entry=climate.roles[role];
    if(entry?.id) {candidates[role]=entry.id;suggestedSource[role]=entry.source;}
    else if(entry?.quality==='ambiguous') {delete candidates[role];suggestedSource[role]=entry.source;}
  }
  if(automaticRobot) candidates.robot=automaticRobot;
  if(candidates.robot === 'vacuum.s8_maxv_ultra') {
    Object.assign(candidates,{
      robot_status:'sensor.s8_maxv_ultra_status',
      robot_cleaning:'binary_sensor.s8_maxv_ultra_cleaning',
      water_shortage:'binary_sensor.s8_maxv_ultra_water_shortage',
      mop_attached:'binary_sensor.s8_maxv_ultra_mop_attached',
      water_box_attached:'binary_sensor.s8_maxv_ultra_water_box_attached',
      dock_error:'sensor.s8_maxv_ultra_dock_dock_error'
    });
  }
  const explicit=config.bindings||{};
  // An explicit robot always wins. Its status sensors must be explicitly configured
  // unless the robot is the known Cassandra platform and named sensors exist.
  if(explicit.robot && explicit.robot!=='vacuum.s8_maxv_ultra') {
    for(const role of ['robot_status','robot_cleaning','water_shortage','mop_attached','water_box_attached','dock_error']) delete candidates[role];
  }
  if(explicit.robot==='vacuum.s8_maxv_ultra') {
    Object.assign(candidates,{
      robot_status:'sensor.s8_maxv_ultra_status',robot_cleaning:'binary_sensor.s8_maxv_ultra_cleaning',
      water_shortage:'binary_sensor.s8_maxv_ultra_water_shortage',mop_attached:'binary_sensor.s8_maxv_ultra_mop_attached',
      water_box_attached:'binary_sensor.s8_maxv_ultra_water_box_attached',dock_error:'sensor.s8_maxv_ultra_dock_dock_error'
    });
  }
  const resolved={...candidates,...explicit};
  const diagnostic={};
  for(const [role,id] of Object.entries(resolved)){
    const domain=id.split('.')[0];
    const entity=states[id];
    const quality=domain!==BINDING_DOMAINS[role]?'wrong-domain':!hass?'pending':!entity?'missing':BAD_STATES.has(entity.state)?'unavailable':'ok';
    diagnostic[role]={entity_id:id,quality,explicit:Object.hasOwn(explicit,role),
      source:Object.hasOwn(explicit,role)?'manual':(suggestedSource[role]||'convention')};
  }
  for(const role of ['temperature','humidity']){
    if(unresolvedArea && !Object.hasOwn(explicit,role)){
      diagnostic[role]={entity_id:null,quality:'area-unresolved',source:'area',explicit:false,
        candidates:climate.area.candidates||[]};
      continue;
    }
    const selection=climate.roles[role];
    if(selection?.quality==='ambiguous' && !Object.hasOwn(explicit,role)){
      diagnostic[role]={entity_id:null,quality:'ambiguous',source:'area-device',
        explicit:false,candidates:selection.candidates};
    }
    // The exact-name fallback cannot silently borrow a sensor assigned to another Area.
    const d=diagnostic[role],id=resolved[role];
    if(d?.source==='convention' && climate.area.quality==='ok' && id && Array.isArray(registries?.entities)){
      const entry=registries.entities.find(e=>e.entity_id===id);
      const assigned=effectiveEntityArea(entry,registries);
      if(assigned && assigned!==climate.area.id){d.quality='wrong-area';d.assigned_area=assigned;}
    }
  }
  // No robot => show a warning in cleaning status rather than selecting arbitrarily.
  if((profile.vacuum||profile.mop) && !resolved.robot){diagnostic.robot={entity_id:null,quality:'ambiguous-or-missing',explicit:false};}
  return {room,profile,bindings:resolved,diagnostic,area:climate.area};
}

function stateOf(states,bindings,role) { return bindings[role] ? states[bindings[role]]?.state : undefined; }
const good = s=>!BAD_STATES.has(s);
function numberOf(s) { if (!good(s)) return null; const n=Number(s); return Number.isFinite(n)&&n>=0 ? n:null; }
function binary(s) { return s==='on'?true:s==='off'?false:null; }

/** Read-only display model. A queued task does not imply active or completed. */
export function buildModel(config, hass, registries = null) {
  const {room,profile,bindings,diagnostic,area}=resolveBindings(config,hass,registries);
  const states=hass?.states || {};
  const val=(role)=>diagnostic[role]?.quality==='wrong-area'?undefined:stateOf(states,bindings,role);
  const robotStatus=val('robot_status');
  const robotState=val('robot');
  const confirmedCleaning = binary(val('robot_cleaning'))===true ||
    ['cleaning','segment_cleaning','segment_mopping','clean_mop_cleaning','clean_mop_mopping','segment_clean_mop_cleaning','segment_clean_mop_mopping'].includes(robotStatus);
  const activeRobot = robotState==='cleaning'||confirmedCleaning;
  function cleaningState(kind,enabled) {
    if(!enabled)return {state:'disabled',days:null};
    const active=binary(val(`${kind}_active`)), queued=binary(val(`${kind}_queue`));
    const days=numberOf(val(`${kind}_days`));
    const missing=!diagnostic[`${kind}_active`]||!diagnostic[`${kind}_queue`]||
      diagnostic[`${kind}_active`].quality!=='ok'||diagnostic[`${kind}_queue`].quality!=='ok';
    if(missing||active===null||queued===null)return {state:'unknown',days};
    if((queued||active)&&(robotState==='error'||robotStatus==='error'))return {state:'blocked',days};
    if(kind==='mop'&&(queued||active)) {
      const dock=val('dock_error');
      const explicitFailure=val('water_shortage')==='on'||val('mop_attached')==='off'||
        val('water_box_attached')==='off'||(good(dock)&&dock!=='ok');
      if(explicitFailure)return {state:'blocked',days};
      if(active && !activeRobot)return {state:'uncertain',days};
      const readinessRoles=['water_shortage','mop_attached','water_box_attached','dock_error'];
      if(readinessRoles.some(role=>!diagnostic[role]||diagnostic[role].quality!=='ok'))return {state:'readiness_unknown',days};
    }
    if(active && !activeRobot)return {state:'uncertain',days};
    if(active)return {state:'active',days};
    if(queued)return {state:'queued',days};
    if(days!==null && days>=3)return {state:'due',days};
    if(days!==null && days>0)return {state:'recent',days};
    return {state:'idle',days};
  }
  const vacuum=cleaningState('vacuum',profile.vacuum);
  const mop=cleaningState('mop',profile.mop);
  const missing=Object.entries(diagnostic).filter(([,d])=>!['ok','pending'].includes(d.quality)).map(([role,d])=>({role,...d}));
  const tempState=val('temperature');
  const rawTemp=good(tempState)&&Number.isFinite(Number(tempState)) ? Number(tempState) : null;
  const rawHumidity=numberOf(val('humidity'));
  return {
    room, profile, bindings, diagnostic, missing, area,
    roomOn:binary(val('room_state')), bedtime:binary(val('bedtime')),
    fan:binary(val('fan')),vacuum,mop,
    temperature:rawTemp===null?null:rawTemp.toFixed(1),
    humidity:rawHumidity===null?null:rawHumidity.toFixed(1),
    robotState, robotStatus,
  };
}

/** Resolve only known, validated actions. The card never changes queues or counters. */
export function resolveAction(config, model, gesture, hass) {
  const states=hass?.states||{};
  const room=model.room;
  if(gesture==='tap') {
    const path=config.navigation_path||model.profile.path;
    return /^\/(?!\/)[a-zA-Z0-9/_-]+$/.test(path) ? {type:'navigate',path} : null;
  }
  if(gesture==='hold'){
    if(config.enable_actions!==true||model.roomOn===null)return null;
    const id=`script.${room}_${model.roomOn?'off':'on'}`;
    return states[id] && !BAD_STATES.has(states[id].state) ? {type:'script',entity_id:id}:null;
  }
  if(gesture==='double'){
    if(config.enable_actions!==true)return null;
    const dt=model.profile.doubleTap;
    if(dt==='bedtime'){
      const id=model.bindings.bedtime;
      const val=id&&states[id]?.state;
      return val==='on'||val==='off' ? {type:'boolean',entity_id:id,service:val==='on'?'turn_off':'turn_on'}:null;
    }
    if(dt==='fan'){
      const id='script.toggle_extractor_with_check';
      return states[id] && !BAD_STATES.has(states[id].state) ? {type:'script',entity_id:id}:null;
    }
    if(dt==='vacuum'){
      if(!model.bindings.robot||!states[model.bindings.robot]||BAD_STATES.has(model.robotState))return null;
      const id=model.robotState==='docked'?'script.vacuum_home_optimised':'script.stop_vacuum';
      return states[id]&&!BAD_STATES.has(states[id].state)?{type:'script',entity_id:id,confirm:true}:null;
    }
  }
  return null;
}
