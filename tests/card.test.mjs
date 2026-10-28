import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const bundle=readFileSync(resolve(root,'dist/ha-room-control-card.js'),'utf8');

function setup() {
  const registry=new Map(), calls=[];
  class Element {
    attachShadow(){this.shadowRoot={innerHTML:'',querySelector:()=>({addEventListener(){}}),querySelectorAll:()=>[],getElementById:()=>({addEventListener(){}}),activeElement:null,host:this};return this.shadowRoot;}
    dispatchEvent(event){calls.push(['event',event.type]);}
  }
  const window={customCards:[],history:{pushState(...args){calls.push(['navigate',args[2]]);}},dispatchEvent(){},confirm(){return false;}};
  const document={createElement(type){return new (registry.get(type))();}};
  const ctx={HTMLElement:Element,customElements:{define(n,c){registry.set(n,c);}},window,document,setTimeout,clearTimeout,Event:class Event{},CustomEvent:class CustomEvent{constructor(type){this.type=type;}},console};
  runInNewContext(bundle,ctx);
  return {registry,calls,window};
}
function kitchen(){return {
 'vacuum.s8_maxv_ultra':{state:'docked'},
 'binary_sensor.kitchen_state':{state:'on'},
 'sensor.kitchen_multi_sensor_temperature':{state:'21.8'},
 'sensor.kitchen_multi_sensor_humidity':{state:'49'},
 'input_boolean.vacuum_que_kitchen':{state:'on'},
 'input_boolean.cleaning_kitchen':{state:'off'},
 'counter.kitchen_days_since_vacuum':{state:'3'},
 'input_boolean.mop_que_kitchen':{state:'on'},
 'input_boolean.mopping_kitchen':{state:'off'},
 'counter.kitchen_days_since_mop':{state:'4'},
 'binary_sensor.s8_maxv_ultra_mop_attached':{state:'on'},
 'binary_sensor.s8_maxv_ultra_water_box_attached':{state:'on'},
 'binary_sensor.s8_maxv_ultra_water_shortage':{state:'off'},
 'sensor.s8_maxv_ultra_dock_dock_error':{state:'ok'},
 'sensor.s8_maxv_ultra_status':{state:'charging'},
 'binary_sensor.s8_maxv_ultra_cleaning':{state:'off'}
};}

test('bundle registers a custom:room-control-card and visual editor',()=>{
 const {registry,window}=setup();
 assert.ok(registry.has('room-control-card'));
 assert.ok(registry.has('room-control-card-editor'));
 assert.equal(window.customCards[0].type,'room-control-card');
});

test('card renders room center icon, vacuum/mop top-right, bottom-right climate and rounded theme',()=>{
 const {registry}=setup();const c=new (registry.get('room-control-card'))();
 c.setConfig({room:'kitchen'});c.hass={states:kitchen()};
 const html=c.shadowRoot.innerHTML;
 for(const item of ['mdi:fridge','mdi:robot-vacuum','mdi:water','21.8 °C','49.0 %','top-right','bottom-right','border-radius:var(--ha-card-border-radius'])assert.ok(html.includes(item),item);
 assert.ok(!html.includes('mdi:weather-night'));
});

test('card displays confirmed water blocker, notifies nobody itself',()=>{
 const {registry}=setup();const c=new (registry.get('room-control-card'))();
 const states=kitchen();states['binary_sensor.s8_maxv_ultra_water_shortage'].state='on';
 let called=false;c.setConfig({room:'kitchen'});c.hass={states,callService(){called=true;}};
 assert.ok(c.shadowRoot.innerHTML.includes('mdi:alert-circle'));
 assert.ok(c.shadowRoot.innerHTML.includes('Connection diagnostics'));
 assert.equal(called,false);
});

test('unsafe markup in room label is escaped',()=>{
 const {registry}=setup();const c=new (registry.get('room-control-card'))();
 c.setConfig({room:'kitchen',profile:{label:'<script>alert(1)</script>'}});c.hass={states:kitchen()};
 assert.ok(c.shadowRoot.innerHTML.includes('&lt;script&gt;'));
 assert.ok(!c.shadowRoot.innerHTML.includes('<script>'));
});

test('config editor emits complete config when room changes',()=>{
 const {registry}=setup();const editor=new (registry.get('room-control-card-editor'))();
 editor.setConfig({room:'kitchen'});
 assert.ok(editor.shadowRoot.innerHTML.includes('Entity bindings'));
 assert.ok(editor.shadowRoot.innerHTML.includes('Home Assistant room (Area)'));
});


test('card loads Area, Device and Entity registry to select a unique local temperature sensor',async()=>{
 const {registry}=setup();const c=new (registry.get('room-control-card'))();
 c.setConfig({room:'kitchen'});
 const states=kitchen();states['sensor.area_t']={state:'18.5',attributes:{device_class:'temperature'}};
 const calls=[];
 const data={
  'config/area_registry/list':[{area_id:'kitchen',name:'Kitchen',aliases:[]}],
  'config/device_registry/list':[{id:'kdev',area_id:'kitchen'}],
  'config/entity_registry/list':[{entity_id:'sensor.area_t',device_id:'kdev',area_id:null}]
 };
 c.hass={states,connection:{},callWS:async({type})=>{calls.push(type);return data[type];}};
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(c._model.temperature,'18.5');
 assert.equal(c._model.diagnostic.temperature.source,'area-device');
 assert.equal(c._model.bindings.mop_queue,'input_boolean.mop_que_kitchen');
 assert.equal(calls.length,3);
 c.hass={states,connection:c._hass.connection,callWS:async()=>{throw new Error('unexpected refetch');}};
 assert.equal(calls.length,3);
});

test('editor shows exact ambiguous Area sensor candidates rather than picking one',async()=>{
 const {registry}=setup();const editor=new (registry.get('room-control-card-editor'))();
 editor.setConfig({room:'kitchen'});
 const states=kitchen();
 states['sensor.first']={state:'18',attributes:{device_class:'temperature'}};
 states['sensor.second']={state:'19',attributes:{device_class:'temperature'}};
 const data={
  'config/area_registry/list':[{area_id:'kitchen',name:'Kitchen',aliases:[]}],
  'config/device_registry/list':[],
  'config/entity_registry/list':[
   {entity_id:'sensor.first',area_id:'kitchen'},
   {entity_id:'sensor.second',area_id:'kitchen'}
  ]
 };
 editor.hass={states,connection:{},callWS:async({type})=>data[type]};
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(editor.shadowRoot.innerHTML.includes('sensor.first, sensor.second'));
 assert.ok(editor.shadowRoot.innerHTML.includes('ambiguous'));
 assert.ok(editor.shadowRoot.innerHTML.includes('Refresh Area/Device/Entity registries'));
});
