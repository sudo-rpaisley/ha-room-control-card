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
