/* Room Control Card: browser frontend. Built with src/model.mjs into one HACS module. */
const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeIcon = (value) => /^[a-z][a-z0-9_-]*:[a-z0-9_-]+$/.test(value||'') ? value : 'mdi:home-outline';

const BASE_CSS = `
:host { display:block; color:var(--primary-text-color); }
ha-card { position:relative; background:var(--ha-card-background,var(--card-background-color)); border-radius:var(--ha-card-border-radius,16px); overflow:hidden; border:1px solid var(--divider-color); }
.room-button { display:block; width:100%; min-height:clamp(115px,20vh,250px); background:none; border:0; padding:15px; cursor:pointer; color:inherit; font:inherit; position:relative; user-select:none; -webkit-user-select:none; -webkit-tap-highlight-color:transparent; }
.room-button:focus-visible { outline:3px solid var(--primary-color);outline-offset:-4px;border-radius:var(--ha-card-border-radius,16px) }
.center-icon {display:grid;place-content:center;min-height:115px;}
.center-icon ha-icon {--mdc-icon-size:clamp(52px,8vw,94px); color:var(--room-icon-color,#44739e); transition:color .15s ease}
.corner {position:absolute;z-index:1;display:flex;align-items:center;gap:7px;font-size:12px;line-height:1.2}
.top-left {top:11px;left:11px;}.top-right {top:11px;right:11px;max-width:53%;justify-content:end;flex-wrap:wrap}
.bottom-right {bottom:10px;right:12px;display:grid;justify-items:end;gap:3px;color:var(--secondary-text-color);background:color-mix(in srgb,var(--ha-card-background,var(--card-background-color)) 85%,transparent);border-radius:7px;padding:3px}
.corner ha-icon {--mdc-icon-size:20px}.corner .large {--mdc-icon-size:30px}
.good {color:var(--success-color,#43a047)} .warn {color:var(--warning-color,#ff9800)} .danger {color:var(--error-color,#e45858)} .normal {color:var(--secondary-text-color)} .active {color:var(--primary-color,#ffd60a)}
.label {position:absolute;bottom:13px;left:14px;font-weight:600;font-size:13px;max-width:58%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.health {position:absolute;bottom:9px;left:9px;z-index:2;border:1px solid var(--divider-color);background:var(--ha-card-background,var(--card-background-color));border-radius:99px;cursor:pointer;color:var(--warning-color,#ff9800);width:28px;height:28px}
.health ha-icon {--mdc-icon-size:18px}
.info {padding:13px 15px;border-top:1px solid var(--divider-color);background:var(--ha-card-background,var(--card-background-color));font-size:12px}
.info h4 {margin:0 0 8px;font-size:13px}.info ul{margin:0;padding-left:18px;line-height:1.5;max-height:160px;overflow:auto}
.info .ok {color:var(--success-color,#43a047)} .info .bad {color:var(--error-color,#e45858)}
@media (max-width:600px) {.room-button{min-height:clamp(110px,20vh,210px)}.center-icon ha-icon{--mdc-icon-size:60px}}
@media (prefers-reduced-motion:reduce) {.center-icon ha-icon{transition:none}}
`;
const INDICATORS = {
  active: ['mdi:robot-vacuum','good','Cleaning now'],
  queued: ['mdi:robot-vacuum','warn','Queued for cleaning'],
  due: ['mdi:robot-vacuum-alert','danger','Cleaning due'],
  recent: ['mdi:robot-vacuum','normal','Days since cleaning'],
  blocked: ['mdi:alert-circle','danger','Cleaning blocked'],
  uncertain: ['mdi:help-circle-outline','warn','Cleaning state unconfirmed'],
  unknown: ['mdi:help-circle-outline','warn','Cleaning status unavailable'],
  readiness_unknown: ['mdi:help-circle-outline','warn','Mop readiness unconfirmed']
};
function indicatorMarkup(kind, status) {
  if(status.state==='idle'||status.state==='disabled')return '';
  const [base,cls,title]=INDICATORS[status.state]||INDICATORS.unknown;
  const icon=kind==='mop'&&status.state!=='blocked'&&status.state!=='unknown'&&status.state!=='uncertain'&&status.state!=='readiness_unknown'?'mdi:water':base;
  const days=status.days!==null && status.days!==undefined ? `; ${status.days} days` : '';
  const hint=`${kind==='mop'?'Mop':'Vacuum'}: ${title}${days}`;
  return `<ha-icon class="${cls}" title="${escapeText(hint)}" aria-label="${escapeText(hint)}" icon="${icon}"></ha-icon>`;
}

class RoomControlCard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._more=false;this._touchLong=false;this._tapTimer=null;this._holdTimer=null;}
  static getStubConfig(){return {room:'kitchen'};}
  static getConfigElement(){return document.createElement('room-control-card-editor');}
  getCardSize(){return 3;}
  getGridOptions(){return {columns:6,min_columns:3,rows:3,min_rows:2};}
  setConfig(config){validateConfig(config);this._config={...config};this._render();}
  set hass(value){this._hass=value;if(this._config)this._render();}
  _render(){
    if(!this.shadowRoot||!this._config)return;
    let model;
    try {model=buildModel(this._config,this._hass);}catch(e){this.shadowRoot.innerHTML=`<style>${BASE_CSS}</style><ha-card><div class="info bad">${escapeText(e.message)}</div></ha-card>`;return;}
    this._model=model;
    const m=model,roomColor=m.roomOn===true?'var(--primary-color,#ffd60a)':'#44739e';
    const showNight=m.profile.bedtime&&m.bedtime===true;
    const showFan=m.profile.fan&&m.fan===true;
    const diagnostics=m.missing.map(x=>`${x.role}: ${x.quality} (${x.entity_id||'not configured'})`);
    const essentials=['room_state','temperature','humidity',...(m.profile.vacuum?['vacuum_queue','vacuum_active']:[]),...(m.profile.mop?['mop_queue','mop_active']:[])];
    const essentialsMissing=essentials.filter(x=>m.diagnostic[x] && m.diagnostic[x].quality!=='ok' && m.diagnostic[x].quality!=='pending');
    const health=essentialsMissing.length||m.vacuum.state==='blocked'||m.mop.state==='blocked'||m.mop.state==='uncertain'||m.mop.state==='readiness_unknown'||(m.diagnostic.robot?.quality==='ambiguous-or-missing'&&(m.vacuum.state==='queued'||m.mop.state!=='disabled'&&m.mop.state!=='idle'));
    const topRight=indicatorMarkup('vacuum',m.vacuum)+indicatorMarkup('mop',m.mop)+(showFan?`<ha-icon class="active large" icon="mdi:fan" title="Extractor running"></ha-icon>`:'');
    const label=this._config.show_name === false?'':`<span class="label">${escapeText(m.profile.label)}</span>`;
    const temp=m.temperature===null?'—':`${escapeText(m.temperature)} °C`;
    const humid=m.humidity===null?'—':`${escapeText(m.humidity)} %`;
    this.shadowRoot.innerHTML=`<style>${BASE_CSS}</style>
      <ha-card style="--room-icon-color:${roomColor}">
       <button class="room-button" type="button" aria-label="Open ${escapeText(m.profile.label)}" title="${escapeText(m.profile.label)}">
        <span class="corner top-left">${showNight?'<ha-icon class="large normal" icon="mdi:weather-night" title="Bedtime active"></ha-icon>':''}</span>
        <span class="corner top-right">${topRight}</span>
        <span class="center-icon"><ha-icon icon="${safeIcon(m.profile.icon)}"></ha-icon></span>
        ${label}
        <span class="corner bottom-right"><span>${humid}</span><span>${temp}</span></span>
       </button>
       ${health?'<button class="health" title="View binding and cleaning warnings" aria-label="Connection diagnostics"><ha-icon icon="mdi:alert-circle-outline"></ha-icon></button>':''}
       ${this._more?`<section class="info"><h4>Connections &amp; cleaning status</h4><ul>
         <li>Vacuum: ${escapeText(m.vacuum.state)}</li><li>Mop: ${escapeText(m.mop.state)}</li>
         <li>Robot: ${escapeText(m.robotState??'not configured')}</li>
         ${diagnostics.map(x=>`<li class="bad">${escapeText(x)}</li>`).join('')}
         ${m.mop.state==='blocked'?'<li class="bad">Mop hardware reports a confirmed blocker</li>':''}
         ${m.mop.state==='uncertain'?'<li class="bad">Mop active flag does not match confirmed robot activity</li>':''}
         ${m.mop.state==='readiness_unknown'?'<li class="bad">Mop hardware readiness cannot be confirmed from available sensors</li>':''}
       </ul></section>`:''}
      </ha-card>`;
    const btn=this.shadowRoot.querySelector('.room-button');
    btn.addEventListener('click',()=>{
      if(this._touchLong){this._touchLong=false;return;}
      clearTimeout(this._tapTimer);
      this._tapTimer=setTimeout(()=>{this._tapTimer=null;this._perform('tap');},260);
    });
    btn.addEventListener('dblclick',e=>{e.preventDefault();clearTimeout(this._tapTimer);this._tapTimer=null;this._perform('double');});
    btn.addEventListener('pointerdown',e=>{if(e.button!==0)return;clearTimeout(this._holdTimer);this._holdTimer=setTimeout(()=>{this._touchLong=true;this._perform('hold');},650);});
    for(const ev of ['pointerup','pointercancel','pointerleave'])btn.addEventListener(ev,()=>clearTimeout(this._holdTimer));
    btn.addEventListener('contextmenu',e=>e.preventDefault());
    this.shadowRoot.querySelector('.health')?.addEventListener('click',()=>{this._more=!this._more;this._render();});
  }
  async _perform(gesture){
    const act=resolveAction(this._config,this._model,gesture,this._hass);
    if(!act)return;
    if(act.type==='navigate'){
      // Use the HA frontend location-changed event to stay within the dashboard.
      window.history.pushState(null,'',act.path);
      window.dispatchEvent(new Event('location-changed'));
      return;
    }
    if(act.confirm&&!window.confirm(act.entity_id==='script.stop_vacuum'?'Stop Cassandra cleaning?':'Start Cassandra cleaning?'))return;
    try{
      if(act.type==='script') await this._hass.callService('script','turn_on',{entity_id:act.entity_id});
      if(act.type==='boolean') await this._hass.callService('input_boolean',act.service,{entity_id:act.entity_id});
    }catch(error){console.error('Room Control Card action failed:',error);this._more=true;this._render();}
  }
}

class RoomControlCardEditor extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this._registry=null;this._areas=null;this._requested=false;}
  setConfig(config){this._config={...config,bindings:{...(config.bindings||{})}};this._render();}
  set hass(value){this._hass=value;this._loadRegistry();if(!this.shadowRoot.activeElement || this.shadowRoot.activeElement===this.shadowRoot.host)this._render();}
  async _loadRegistry(){
    if(this._requested||!this._hass?.callWS)return;
    this._requested=true;
    try{
      const [entities,areas]=await Promise.all([
        this._hass.callWS({type:'config/entity_registry/list'}),
        this._hass.callWS({type:'config/area_registry/list'}),
      ]);
      this._registry=entities;this._areas=areas;this._render();
    }catch(error){this._registry=[];this._areas=[];this._render();}
  }
  _save(patch){
    const updated={...this._config,...patch};
    this._config=updated;
    this.dispatchEvent(new CustomEvent('config-changed',{detail:{config:updated},bubbles:true,composed:true}));
    this._render();
  }
  _render(){
    if(!this._config||!this.shadowRoot)return;
    const config=this._config, model=this._hass?buildModel(config,this._hass):null;
    const bindings=model?.bindings||proposedBindings(config.room,getPreset(config.room,config));
    const diagnostics=model?.diagnostic||{};
    const roomOptions=Object.keys(ROOM_PRESETS).map(x=>`<option value="${x}"></option>`).join('');
    const list=Object.keys(this._hass?.states||{}).sort();
    const idOptions=list.map(x=>`<option value="${escapeText(x)}"></option>`).join('');
    const areaList=this._areas || [];
    const areaOptions=areaList.map(a=>`<option value="${escapeText(a.area_id)}" ${config.area_id===a.area_id?'selected':''}>${escapeText(a.name)} (${escapeText(a.area_id)})</option>`).join('');
    const entityRegistries=this._registry||[];
    const row=(role)=>{
      const chosen=config.bindings?.[role]||'';
      const quality=diagnostics[role]?.quality||'not checked';
      const discovered=bindings[role]||'not discovered';
      return `<label>${escapeText(role.replaceAll('_',' '))}
        <input data-binding="${role}" list="room-control-entities" value="${escapeText(chosen)}" placeholder="${escapeText(discovered)}">
        <small class="${quality==='ok'?'ok':quality==='missing'||quality==='wrong-domain'?'bad':''}">Suggested: ${escapeText(discovered)} · ${escapeText(quality)}</small>
      </label>`;
    };
    const fieldNames=['room_state','temperature','humidity',...(model?.profile.vacuum?['vacuum_queue','vacuum_active','vacuum_days']:[]),...(model?.profile.mop?['mop_queue','mop_active','mop_days']:[]),...(model?.profile.bedtime?['bedtime']:[]),...(model?.profile.fan?['fan']:[]),'robot','robot_status','robot_cleaning','water_shortage','mop_attached','water_box_attached','dock_error'];
    const mismatches=entityRegistries.filter(e=>{
      const id=Object.values(config.bindings||{}).includes(e.entity_id);
      return id && e.area_id && config.area_id && e.area_id!==config.area_id;
    }).map(x=>x.entity_id);
    const unassigned=entityRegistries.filter(e=>Object.values(config.bindings||{}).includes(e.entity_id) && !e.area_id).map(x=>x.entity_id);
    this.shadowRoot.innerHTML=`<style>
      :host{display:block;color:var(--primary-text-color)}.editor{display:grid;gap:12px;padding:10px}
      label{display:grid;gap:4px;font-size:13px;text-transform:capitalize}input,select{background:var(--card-background-color);color:inherit;border:1px solid var(--divider-color);border-radius:6px;padding:9px;min-width:0}
      small{color:var(--secondary-text-color);font-size:11px;text-transform:none}.ok{color:var(--success-color,#43a047)}.bad{color:var(--error-color,#e45858)}
      details{border:1px solid var(--divider-color);border-radius:8px;padding:10px}summary{cursor:pointer;font-weight:600}
      .warning{color:var(--warning-color,#ff9800);font-size:12px}
    </style><div class="editor">
      <label>Room key<input id="room" list="room-control-rooms" value="${escapeText(config.room)}"></label>
      <label>Home Assistant area (optional, for connection auditing)<select id="area"><option value="">Not assigned</option>${areaOptions}</select></label>
      <datalist id="room-control-rooms">${roomOptions}</datalist><datalist id="room-control-entities">${idOptions}</datalist>
      <label>Navigation path (optional override)<input id="navigation" value="${escapeText(config.navigation_path||'')}" placeholder="${escapeText(model?.profile.path||'/lovelace/kitchen')}"></label>
      <label><span><input id="actions" type="checkbox" ${config.enable_actions===true?'checked':''}> Enable scripted hold/double-tap actions</span></label>
      <small>Actions are disabled by default. Cleaning actions require a confirmation. Robot queue and counters are never changed by this card.</small>
      <details><summary>Entity bindings &amp; diagnostics</summary><div class="editor">
        ${fieldNames.map(row).join('')}
        ${mismatches.length?`<span class="warning">Explicitly mapped entities are assigned to a different area: ${escapeText(mismatches.join(', '))}</span>`:''}
        ${config.area_id&&unassigned.length?`<span class="warning">No direct area assignment for: ${escapeText(unassigned.join(', '))}. This can be normal for device-inherited areas; check in Home Assistant.</span>`:''}
      </div></details>
      ${model?.missing?.length?`<span class="warning">${model.missing.length} missing, ambiguous or unavailable binding(s). Expand diagnostics for details.</span>`:''}
    </div>`;
    this.shadowRoot.getElementById('room').addEventListener('change',e=>{this._save({room:e.target.value.trim(),bindings:{},area_id:undefined,profile:undefined,navigation_path:undefined,enable_actions:false});});
    this.shadowRoot.getElementById('area').addEventListener('change',e=>{this._save({area_id:e.target.value || undefined});});
    this.shadowRoot.getElementById('navigation').addEventListener('change',e=>{
      const v=e.target.value.trim();let next={...this._config};if(v)next.navigation_path=v;else delete next.navigation_path;this._save(next);
    });
    this.shadowRoot.getElementById('actions').addEventListener('change',e=>this._save({enable_actions:e.target.checked}));
    this.shadowRoot.querySelectorAll('[data-binding]').forEach(el=>el.addEventListener('change',e=>{
      const name=e.target.dataset.binding, id=e.target.value.trim();
      const bindings={...this._config.bindings};if(id)bindings[name]=id;else delete bindings[name];
      this._save({bindings});
    }));
  }
}

customElements.define('room-control-card',RoomControlCard);
customElements.define('room-control-card-editor',RoomControlCardEditor);
window.customCards=window.customCards||[];
if(!window.customCards.some(card=>card.type==='room-control-card'))window.customCards.push({
  type:'room-control-card',name:'Room Control Card',description:'Room navigation with verified device connections and vacuum/mop indicators',preview:true
});
console.info('%c ROOM CONTROL CARD %c v0.1.0','color:white;background:#44739e;font-weight:bold','color:#44739e');
