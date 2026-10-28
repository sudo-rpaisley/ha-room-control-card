import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOM_PRESETS,validateConfig,proposedBindings,resolveBindings,buildModel,resolveAction} from '../src/model.mjs';

function makeStates(room='kitchen') {
  const s={
    [`binary_sensor.${room}_state`]:{state:'off'},
    [`sensor.${room}_multi_sensor_temperature`]:{state:'21.2'},
    [`sensor.${room}_multi_sensor_humidity`]:{state:'45'},
    [`counter.${room}_days_since_vacuum`]:{state:'3'},
    [`counter.${room}_days_since_mop`]:{state:'3'},
    [`input_boolean.vacuum_que_${room}`]:{state:'on'},
    [`input_boolean.cleaning_${room}`]:{state:'off'},
    [`input_boolean.mop_que_${room}`]:{state:'on'},
    [`input_boolean.mopping_${room}`]:{state:'off'},
    'vacuum.s8_maxv_ultra':{state:'docked'},
    'sensor.s8_maxv_ultra_status':{state:'charging'},
    'binary_sensor.s8_maxv_ultra_cleaning':{state:'off'},
    'binary_sensor.s8_maxv_ultra_water_shortage':{state:'off'},
    'binary_sensor.s8_maxv_ultra_mop_attached':{state:'on'},
    'binary_sensor.s8_maxv_ultra_water_box_attached':{state:'on'},
    'sensor.s8_maxv_ultra_dock_dock_error':{state:'ok'},
    'script.kitchen_on':{state:'off'}, 'script.kitchen_off':{state:'off'},
    'script.vacuum_home_optimised':{state:'off'}, 'script.stop_vacuum':{state:'off'},
    'script.toggle_extractor_with_check':{state:'off'}
  };
  return s;
}
const hass=(states)=>({states});

test('six profiles reproduce existing mop eligibility, nav and corner capabilities',()=>{
  assert.deepEqual(Object.keys(ROOM_PRESETS),['kitchen','office','hall','bathroom','bedroom','livingroom']);
  assert.deepEqual(Object.keys(ROOM_PRESETS).filter(r=>ROOM_PRESETS[r].mop),['kitchen','hall']);
  assert.equal(ROOM_PRESETS.bathroom.vacuum,false);
  for(const [room,profile] of Object.entries(ROOM_PRESETS))assert.equal(profile.path,`/lovelace/${room}`);
});

test('exact candidate naming, not fuzzy assignment',()=>{
  const b=proposedBindings('kitchen',ROOM_PRESETS.kitchen);
  assert.equal(b.mop_queue,'input_boolean.mop_que_kitchen');
  assert.equal(b.mop_active,'input_boolean.mopping_kitchen');
  assert.equal(b.mop_days,'counter.kitchen_days_since_mop');
  assert.equal(b.vacuum_queue,'input_boolean.vacuum_que_kitchen');
  assert.equal(b.temperature,'sensor.kitchen_multi_sensor_temperature');
});

test('one vacuum is auto-selected and Cassandra health sensors are available',()=>{
  const cfg={room:'kitchen'};
  const result=resolveBindings(cfg,hass(makeStates()));
  assert.equal(result.bindings.robot,'vacuum.s8_maxv_ultra');
  assert.equal(result.bindings.water_shortage,'binary_sensor.s8_maxv_ultra_water_shortage');
  assert.equal(result.diagnostic.mop_queue.quality,'ok');
});

test('two vacuums fail closed rather than selecting the wrong robot',()=>{
  const states=makeStates();states['vacuum.second']={state:'docked'};
  const result=resolveBindings({room:'kitchen'},hass(states));
  assert.equal(result.bindings.robot,undefined);
  assert.equal(result.diagnostic.robot.quality,'ambiguous-or-missing');
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'readiness_unknown');
});

test('explicit robot binding takes priority and does not borrow Cassandras health sensors',()=>{
  const states=makeStates();states['vacuum.second']={state:'docked'};
  const r=resolveBindings({room:'kitchen',bindings:{robot:'vacuum.second'}},hass(states));
  assert.equal(r.bindings.robot,'vacuum.second');
  assert.equal(r.bindings.robot_status,undefined);
  assert.equal(r.bindings.water_shortage,undefined);
});

test('validation rejects malformed bindings and unsafe path',()=>{
  assert.throws(()=>validateConfig({room:'Kitchen'}));
  assert.equal(validateConfig({room:'kitchen',bindings:{temperature:'binary_sensor.something'}}),true); // accepted syntactically, flagged as wrong-domain at runtime
});

test('domain mismatch and unavailable state are detected, not accepted as OK',()=>{
  const states=makeStates();
  states['sensor.kitchen_multi_sensor_temperature']={state:'unavailable'};
  const d=resolveBindings({room:'kitchen',bindings:{humidity:'binary_sensor.foobar'}},hass(states)).diagnostic;
  assert.equal(d.temperature.quality,'unavailable');
  assert.equal(d.humidity.quality,'wrong-domain');
});

test('mop queued, active, blocked and unknown are distinct',()=>{
  const states=makeStates();
  let m=buildModel({room:'kitchen'},hass(states));
  assert.equal(m.mop.state,'queued');
  states['input_boolean.mopping_kitchen'].state='on';
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'uncertain');
  states['vacuum.s8_maxv_ultra'].state='cleaning';
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'active');
  states['binary_sensor.s8_maxv_ultra_water_shortage'].state='on';
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'blocked');
  states['binary_sensor.s8_maxv_ultra_water_shortage'].state='unavailable';
  states['input_boolean.mopping_kitchen'].state='unavailable';
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'unknown');
});

test('confirmed robot error blocks a queued cleaning job',()=>{
  const states=makeStates();states['vacuum.s8_maxv_ultra'].state='error';
  const model=buildModel({room:'kitchen'},hass(states));
  assert.equal(model.vacuum.state,'blocked');
  assert.equal(model.mop.state,'blocked');
});

test('unknown water reading shows unconfirmed readiness, not a fabricated hardware failure',()=>{
  const states=makeStates();states['binary_sensor.s8_maxv_ultra_water_shortage'].state='unknown';
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'readiness_unknown');
});

test('unknown health telemetry for a different robot is unconfirmed, not ready',()=>{
  const states=makeStates(); states['vacuum.other']={state:'docked'};
  const cfg={room:'kitchen',bindings:{robot:'vacuum.other'}};
  assert.equal(buildModel(cfg,hass(states)).mop.state,'readiness_unknown');
});

test('negative temperatures are displayed correctly',()=>{
  const states=makeStates(); states['sensor.kitchen_multi_sensor_temperature'].state='-3.5';
  assert.equal(buildModel({room:'kitchen'},hass(states)).temperature,'-3.5');
});

test('queue off is not proof of successful cleaning',()=>{
  const states=makeStates();
  states['input_boolean.mop_que_kitchen'].state='off';
  states['input_boolean.mopping_kitchen'].state='off';
  states['counter.kitchen_days_since_mop'].state='0';
  assert.equal(buildModel({room:'kitchen'},hass(states)).mop.state,'idle');
});

test('missing queue is unknown rather than idle',()=>{
  const states=makeStates();delete states['input_boolean.mop_que_kitchen'];
  const model=buildModel({room:'kitchen'},hass(states));
  assert.equal(model.mop.state,'unknown');
  assert.equal(model.diagnostic.mop_queue.quality,'missing');
});

test('bathroom never gets mop action from default profile',()=>{
  const states=makeStates('bathroom');
  assert.equal(buildModel({room:'bathroom'},hass(states)).mop.state,'disabled');
});

test('actions are off by default and limited to explicitly enabled supported actions',()=>{
  const states=makeStates();const m=buildModel({room:'kitchen'},hass(states));
  assert.deepEqual(resolveAction({room:'kitchen'},m,'tap',hass(states)),{type:'navigate',path:'/lovelace/kitchen'});
  assert.equal(resolveAction({room:'kitchen'},m,'hold',hass(states)),null);
  assert.equal(resolveAction({room:'kitchen'},m,'double',hass(states)),null);
  assert.deepEqual(resolveAction({room:'kitchen',enable_actions:true},m,'hold',hass(states)),{type:'script',entity_id:'script.kitchen_on'});
  states['binary_sensor.kitchen_state'].state='on';
  const updated=buildModel({room:'kitchen'},hass(states));
  assert.deepEqual(resolveAction({room:'kitchen',enable_actions:true},updated,'hold',hass(states)),{type:'script',entity_id:'script.kitchen_off'});
});

test('hall double tap checks robot state and requires confirmation before cleaning',()=>{
  const states=makeStates('hall');
  states['script.hall_on']={state:'off'};states['script.hall_off']={state:'off'};
  let m=buildModel({room:'hall'},hass(states));
  assert.deepEqual(resolveAction({room:'hall',enable_actions:true},m,'double',hass(states)),{type:'script',entity_id:'script.vacuum_home_optimised',confirm:true});
  states['vacuum.s8_maxv_ultra'].state='cleaning';
  m=buildModel({room:'hall'},hass(states));
  assert.deepEqual(resolveAction({room:'hall',enable_actions:true},m,'double',hass(states)),{type:'script',entity_id:'script.stop_vacuum',confirm:true});
});

test('malformed room and nonlocal paths are rejected',()=>{
  assert.throws(()=>validateConfig({room:'../kitchen'}));
  assert.throws(()=>validateConfig({room:'kitchen',profile:{path:'//example.com'}}));
  assert.throws(()=>validateConfig({room:'kitchen',bindings:{robot:'vacuum.good; bad'}}));
  assert.throws(()=>validateConfig({room:'kitchen',bindings:{not_a_role:'sensor.x'}}));
});

function areaRegistries({preferred=false, duplicated=false, area='kitchen'}={}) {
  return {
    areas:[{area_id:area,name:area==='living_room'?'Living Room':'Kitchen',aliases:[],
      temperature_entity_id:preferred?'sensor.preferred_temperature':null,
      humidity_entity_id:preferred?'sensor.preferred_humidity':null}],
    devices:[{id:'device_kitchen',area_id:area},{id:'device_hall',area_id:'hall'}],
    entities:[
      {entity_id:'sensor.area_temperature',device_id:'device_kitchen',area_id:null},
      {entity_id:'sensor.area_humidity',device_id:'device_kitchen',area_id:null},
      {entity_id:'sensor.hall_temperature',device_id:'device_hall',area_id:null},
      ...(duplicated?[{entity_id:'sensor.second_temperature',device_id:'device_kitchen',area_id:null}]:[]),
    ]
  };
}
function areaStates(){
  const states=makeStates();
  states['sensor.area_temperature']={state:'19.3',attributes:{device_class:'temperature'}};
  states['sensor.area_humidity']={state:'43.9',attributes:{device_class:'humidity'}};
  states['sensor.hall_temperature']={state:'15',attributes:{device_class:'temperature'}};
  states['sensor.second_temperature']={state:'20',attributes:{device_class:'temperature'}};
  states['sensor.preferred_temperature']={state:'23',attributes:{device_class:'temperature'}};
  states['sensor.preferred_humidity']={state:'55',attributes:{device_class:'humidity'}};
  return states;
}

test('area name matching supports spaces and aliases, but not GPS Zones',async()=>{
  const {findArea}=await import('../src/model.mjs');
  const reg=areaRegistries({area:'living_room'});
  assert.equal(findArea('livingroom',undefined,reg).id,'living_room');
  reg.areas[0].aliases=['Drawing Room'];
  assert.equal(findArea('drawing_room',undefined,reg).id,'living_room');
  reg.areas.push({area_id:'other',name:'Drawing room',aliases:[]});
  assert.equal(findArea('drawingroom',undefined,reg).quality,'ambiguous');
  assert.equal(findArea('kitchen','not_registered',reg).quality,'missing');
});

test('area preferred climate sensors win over device and conventional names',()=>{
  const reg=areaRegistries({preferred:true});
  const model=buildModel({room:'kitchen'},hass(areaStates()),reg);
  assert.equal(model.area.id,'kitchen');
  assert.equal(model.temperature,'23.0');
  assert.equal(model.humidity,'55.0');
  assert.equal(model.diagnostic.temperature.source,'area-preferred');
  assert.equal(model.bindings.vacuum_queue,'input_boolean.vacuum_que_kitchen');
  assert.equal(model.bindings.mop_active,'input_boolean.mopping_kitchen');
});

test('unique device-inherited area sensors are discovered without fuzzy name matching',()=>{
  const reg=areaRegistries();
  const model=buildModel({room:'kitchen'},hass(areaStates()),reg);
  assert.equal(model.temperature,'19.3');
  assert.equal(model.humidity,'43.9');
  assert.equal(model.diagnostic.temperature.source,'area-device');
});

test('two plausible temperature sensors in the same area fail closed',()=>{
  const reg=areaRegistries({duplicated:true});
  const model=buildModel({room:'kitchen'},hass(areaStates()),reg);
  assert.equal(model.temperature,null);
  assert.equal(model.diagnostic.temperature.quality,'ambiguous');
  assert.deepEqual(model.diagnostic.temperature.candidates,['sensor.area_temperature','sensor.second_temperature']);
  assert.equal(model.humidity,'43.9');
  assert.equal(model.mop.state,'queued');
});

test('manual climate choice can resolve ambiguity without changing the robot',()=>{
  const reg=areaRegistries({duplicated:true});
  const config={room:'kitchen',bindings:{temperature:'sensor.second_temperature',robot:'vacuum.s8_maxv_ultra'}};
  const model=buildModel(config,hass(areaStates()),reg);
  assert.equal(model.temperature,'20.0');
  assert.equal(model.diagnostic.temperature.source,'manual');
  assert.equal(model.bindings.robot,'vacuum.s8_maxv_ultra');
});

test('name-matched conventional sensor in a different registered area is rejected',()=>{
  const reg=areaRegistries();
  reg.entities=reg.entities.filter(e=>e.entity_id!=='sensor.area_temperature');
  reg.entities.push({entity_id:'sensor.kitchen_multi_sensor_temperature',area_id:'hall'});
  const model=buildModel({room:'kitchen'},hass(areaStates()),reg);
  assert.equal(model.temperature,null);
  assert.equal(model.diagnostic.temperature.quality,'wrong-area');
  assert.equal(model.diagnostic.temperature.assigned_area,'hall');
});

test('an unavailable area-preferred sensor stays unavailable rather than switching to an unrelated sensor',()=>{
  const reg=areaRegistries({preferred:true});
  const states=areaStates();states['sensor.preferred_temperature'].state='unavailable';
  const model=buildModel({room:'kitchen'},hass(states),reg);
  assert.equal(model.temperature,null);
  assert.equal(model.diagnostic.temperature.quality,'unavailable');
});

test('missing area registry data retains exact-name backwards compatibility',()=>{
  const model=buildModel({room:'kitchen'},hass(makeStates()));
  assert.equal(model.temperature,'21.2');
  assert.equal(model.diagnostic.temperature.source,'convention');
  assert.equal(model.area.quality,'pending');
});

test('read-only area matching never assigns robot by area or sends commands',()=>{
  const reg=areaRegistries();
  const states=areaStates();states['vacuum.second']={state:'docked'};
  const model=buildModel({room:'kitchen'},hass(states),reg);
  assert.equal(model.diagnostic.robot.quality,'ambiguous-or-missing');
  assert.equal(model.bindings.robot,undefined);
});


test('explicit missing Area fails closed instead of silently showing conventional climate',()=>{
  const reg=areaRegistries();
  const model=buildModel({room:'kitchen',area_id:'missing'},hass(areaStates()),reg);
  assert.equal(model.temperature,null);
  assert.equal(model.humidity,null);
  assert.equal(model.diagnostic.temperature.quality,'area-unresolved');
  assert.equal(model.mop.state,'queued');
});

test('Area aliases that are ambiguous never select a conventional temperature sensor',()=>{
  const reg=areaRegistries();
  reg.areas.push({area_id:'second',name:'Kitchen',aliases:[]});
  const model=buildModel({room:'kitchen'},hass(areaStates()),reg);
  assert.equal(model.area.quality,'ambiguous');
  assert.equal(model.temperature,null);
  assert.equal(model.diagnostic.temperature.quality,'area-unresolved');
});

test('global profile sensor shares safe settings between cards; local bindings win',()=>{
  const states=makeStates();
  states['sensor.room_control_profiles']={state:'ready',attributes:{rooms:{kitchen:{
    area_id:'kitchen', profile:{label:'Shared kitchen',icon:'mdi:pot-steam',vacuum:true,mop:true},
    bindings:{temperature:'sensor.shared_temp',robot:'vacuum.s8_maxv_ultra'},enable_actions:true
  }}}};
  states['sensor.shared_temp']={state:'18.9',attributes:{device_class:'temperature'}};
  const cfg={room:'kitchen',profiles_entity:'sensor.room_control_profiles'};
  const model=buildModel(cfg,hass(states));
  assert.equal(model.profile.label,'Shared kitchen');
  assert.equal(model.temperature,'18.9');
  assert.equal(model.shared.quality,'ok');
  assert.equal(resolveAction(cfg,model,'hold',hass(states)),null); // shared config cannot enable commands
  const local=buildModel({...cfg,profile:{label:'Local kitchen'},bindings:{temperature:'sensor.kitchen_multi_sensor_temperature'}},hass(states));
  assert.equal(local.profile.label,'Local kitchen');
  assert.equal(local.temperature,'21.2');
  assert.equal(local.bindings.robot,'vacuum.s8_maxv_ultra');
});

test('missing, malformed and unsafe shared profiles fail closed to local defaults',()=>{
  const states=makeStates();
  const cfg={room:'kitchen',profiles_entity:'sensor.room_control_profiles'};
  assert.equal(buildModel(cfg,hass(states)).shared.quality,'unavailable');
  states['sensor.room_control_profiles']={state:'ready',attributes:{rooms:{kitchen:{profile:{path:'//bad.example'}}}}};
  const result=buildModel(cfg,hass(states));
  assert.equal(result.shared.quality,'invalid');
  assert.equal(result.profile.path,'/lovelace/kitchen');
  assert.throws(()=>validateConfig({room:'kitchen',profiles_entity:'vacuum.robot'}));
  assert.throws(()=>validateConfig({room:'kitchen',profiles_entity:'sensor.foo;bad'}));
});

test('a wrong-domain entity, wrong device class or invalid humidity is not displayed',()=>{
  const states=makeStates();
  states['binary_sensor.illuminance']={state:'25'};
  let m=buildModel({room:'kitchen',bindings:{temperature:'binary_sensor.illuminance'}},hass(states));
  assert.equal(m.temperature,null);
  assert.equal(m.diagnostic.temperature.quality,'wrong-domain');
  states['sensor.kitchen_multi_sensor_temperature']={state:'22.1',attributes:{device_class:'humidity'}};
  m=buildModel({room:'kitchen'},hass(states));
  assert.equal(m.temperature,null);
  assert.equal(m.diagnostic.temperature.quality,'wrong-device-class');
  states['sensor.kitchen_multi_sensor_humidity']={state:'150',attributes:{device_class:'humidity'}};
  m=buildModel({room:'kitchen'},hass(states));
  assert.equal(m.humidity,null);
  assert.equal(m.diagnostic.humidity.quality,'invalid-value');
});

test('profile metadata cannot make a new room control scripts unless local actions are enabled',()=>{
  const states=makeStates('utility');
  states['sensor.room_control_profiles']={state:'ready',attributes:{rooms:{utility:{
    profile:{label:'Utility',double_tap:'vacuum'},enable_actions:true
  }}}};
  const cfg={room:'utility',profiles_entity:'sensor.room_control_profiles'};
  const m=buildModel(cfg,hass(states));
  assert.equal(resolveAction(cfg,m,'double',hass(states)),null);
});

test('a shared profile sensor accepts JSON text in attributes.rooms and rejects malformed JSON',()=>{
  const states=makeStates();
  const config={room:'kitchen',profiles_entity:'sensor.room_control_profiles'};
  states['sensor.room_control_profiles']={state:'ready',attributes:{rooms:JSON.stringify({kitchen:{profile:{label:'Central Kitchen'}}})}};
  assert.equal(buildModel(config,hass(states)).profile.label,'Central Kitchen');
  states['sensor.room_control_profiles'].attributes.rooms='invalid json';
  assert.equal(buildModel(config,hass(states)).shared.quality,'invalid');
});

test('unsafe shared profile types cannot enable action capabilities',()=>{
 const s=makeStates();
 s['sensor.room_control_profiles']={state:'ready',attributes:{rooms:{kitchen:{profile:{mop:'false',double_tap:'untrusted-script'}}}}};
 const cfg={room:'kitchen',profiles_entity:'sensor.room_control_profiles'};
 const m=buildModel(cfg,hass(s));
 assert.equal(m.shared.quality,'invalid');
 assert.equal(m.profile.doubleTap,'none');
 assert.throws(()=>validateConfig({room:'kitchen',profile:{mop:'yes'}}));
});
