// ═══════════════════════════════════════════════════════════
//  SCHNELL FLEET DEBUGGING DASHBOARD
// ═══════════════════════════════════════════════════════════
const D={};
let charts={},activeHub=null,_dockSortAsc=false,_lastDockStats=[],activeFrom='',activeTo='';

const TARGETS={
  reliability: {val:97,   dir:'gte', lbl:'≥97%'},
  northStar:   {val:85,   dir:'gte', lbl:'≥85%'},
  p50Local:    {val:1000, dir:'lte', lbl:'<1000ms'},
  hubSnap:     {val:300,  dir:'lte', lbl:'<300ms'},
  hubApp:      {val:200,  dir:'lte', lbl:'<200ms'},
  localE2e:    {val:1000, dir:'lte', lbl:'<1000ms'},
  remoteE2e:   {val:3000, dir:'lte', lbl:'<3000ms'},
  dockRel:     {val:97,   dir:'gte', lbl:'≥97%'},
  appTrigger:  {val:97,   dir:'gte', lbl:'≥97%'},
};
function tgtLine(actual,t){
  const met=t.dir==='gte'?actual>=t.val:actual<=t.val;
  return `<span style="font-size:9px;color:${met?'var(--green)':'var(--red)'}">Target ${t.lbl}</span>`;
}
function _defaultDates(){const now=new Date(),pad=n=>String(n).padStart(2,'0'),fmt=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;activeTo=fmt(now);const f=new Date(now);f.setDate(f.getDate()-30);activeFrom=fmt(f);}
function activeDaysCount(){if(!activeFrom||!activeTo)return 30;return Math.round((new Date(activeTo)-new Date(activeFrom))/864e5)+1;}
function activePeriodLabel(){if(!activeFrom||!activeTo)return'30-day window';const fmt=s=>{const[y,m,d]=s.split('-');return`${m}/${d}/${y.slice(2)}`};return`${fmt(activeFrom)}–${fmt(activeTo)}`;}
async function fetchAllHubs(showLoading){
  if(showLoading){const s=document.getElementById('drStatus');if(s){s.textContent='Loading…';s.style.color='var(--blue)';}}
  const{hubs}=await fetch('/api/hubs').then(r=>r.json());
  await Promise.all(hubs.map(async h=>{D[h]=await fetch(`/api/hub/${h}?from_date=${activeFrom}&to_date=${activeTo}`).then(r=>r.json())}));
  const s=document.getElementById('drStatus');if(s){s.textContent='';s.style.color='';}
  const lbl=document.getElementById('headerPeriodLabel');if(lbl)lbl.textContent=activePeriodLabel();
  document.getElementById('hubCount').textContent=Object.keys(D).length;
  return hubs;
}
window.applyDateRange=async function(){
  const f=document.getElementById('drFrom'),t=document.getElementById('drTo');
  if(!f||!t||!f.value||!t.value)return;
  const fd=new Date(f.value),td=new Date(t.value);
  if(fd>td){alert('Start date must be before end date.');return;}
  if((td-fd)/864e5>90){alert('Maximum range is 90 days.');return;}
  activeFrom=f.value;activeTo=t.value;
  await fetchAllHubs(true);
  if(activeHub)renderDetail(activeHub);else renderLanding();
};
document.getElementById('hubCount').textContent=Object.keys(D).length;
Chart.defaults.color='#5a7090';Chart.defaults.borderColor='#1d2d40';
Chart.defaults.font.family='Inter';Chart.defaults.font.size=10;

// ─── Utilities ───────────────────────────────────────────
function destroyCharts(){Object.values(charts).forEach(c=>{if(c&&c.destroy)c.destroy()});charts={}}
function mc(id,cfg){const x=document.getElementById(id);return x?new Chart(x.getContext('2d'),cfg):null}
function tsMs(ts){if(!ts||ts==='—')return null;try{return new Date(ts.replace(' ','T')).getTime()}catch(e){return null}}
function msDiff(a,b){const t1=tsMs(a),t2=tsMs(b);return(t1&&t2)?Math.abs(t2-t1):null}
function segStatus(ms){return !ms?'tp-ok':ms>500?'tp-slow':ms>200?'tp-warn':'tp-ok'}
function relColor(r){return r>97?'var(--green)':r>93?'var(--yellow)':'var(--red)'}
function relTag(r){return r>97?'tag-green':r>93?'tag-yellow':'tag-red'}
function statusLabel(r){return r>97?'Healthy':r>93?'Warning':'Critical'}

function failuresFor(hub,predFn){return(D[hub].failures||[]).filter(predFn)}
// UC → src matching based on actual data values:
// App Control  → src: 'app'
// Dock Control → src: 'docklet'
// Remote App   → src: 'app_remote'
// Automation   → src: 'direct_thread'
function srcPred(key){
  const k=(key||'').toLowerCase();
  if(k.includes('dock'))return f=>(f.src||'').toLowerCase().includes('docklet');
  if(k.includes('remote'))return f=>{const s=(f.src||'').toLowerCase();return s.includes('app_remote')||s.includes('remote_app')||s==='remote';};
  if(k.includes('auto'))return f=>(f.src||'').toLowerCase().includes('direct');
  // App Control: src='app' only (not app_remote)
  return f=>(f.src||'').toLowerCase()==='app';
}

function showModal(title,html){
  document.getElementById('modalTitle').querySelector('span').textContent=title;
  document.getElementById('modalBody').innerHTML=typeof html==='string'?html:html;
  document.getElementById('modalOverlay').classList.add('show');
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('show')}

function evTable(events,cols){
  if(!events||!events.length)return'<p class="dbg-empty">No events in sample.</p>';
  let h='<div style="overflow-x:auto"><table><thead><tr>'+cols.map(c=>'<th>'+c.label+'</th>').join('')+'</tr></thead><tbody>';
  events.forEach(e=>{h+='<tr>'+cols.map(c=>'<td style="font-size:10px">'+((e[c.key]!==undefined)?e[c.key]:'—')+'</td>').join('')+'</tr>'});
  return h+'</tbody></table></div>';
}

let _lcBtnStore={};
function lcBtn(opts,label='View all in Log Center →'){
  const k='_lcb'+Date.now()+(Math.random()*1e6|0);
  _lcBtnStore[k]=opts;
  return `<div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(_lcBtnStore['${k}'])">${label}</button></div>`;
}

function setNav(active){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const el=document.getElementById(active);
  if(el)el.classList.add('active');
}

// ═══════════════════════════════════════════════════════════
//  SECTION 1 — LANDING VIEW
// ═══════════════════════════════════════════════════════════
function renderLanding(){
  const _drF=document.getElementById('drFrom'),_drT=document.getElementById('drTo');
  if(_drF&&activeFrom)_drF.value=activeFrom;if(_drT&&activeTo)_drT.value=activeTo;
  document.getElementById('landingView').style.display='block';
  document.getElementById('detailView').style.display='none';
  document.getElementById('logCenterView').style.display='none';
  setNav('navFleet');
  destroyCharts();
  const hubs=Object.keys(D);

  let fTotal=0,fSuccess=0,fFail=0,fLatencies=[],fNS=[];
  hubs.forEach(h=>{const d=D[h];fTotal+=d.total;fSuccess+=d.success;fFail+=d.total-d.success;
    fLatencies.push(d.speed.local_e2e.p50);
    if(d.daily)d.daily.forEach(dy=>{if(dy.ns!==undefined)fNS.push(dy.ns)})});
  const fRel=fTotal>0?((fSuccess/fTotal)*100).toFixed(2):0;
  const fP50=fLatencies.length>0?Math.round(fLatencies.reduce((a,b)=>a+b,0)/fLatencies.length):0;
  const fNSavg=fNS.length>0?(fNS.reduce((a,b)=>a+b,0)/fNS.length).toFixed(1):0;
  const anyCritical=hubs.some(h=>D[h].reliability<=93);
  const anyWarning=hubs.some(h=>D[h].reliability<=97&&D[h].reliability>93);

  const badge=document.getElementById('fleetStatusBadge');
  if(anyCritical){badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block"></span><span style="color:var(--red)">Critical</span>';badge.style.borderColor='var(--red)'}
  else if(anyWarning){badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--yellow);display:inline-block"></span><span style="color:var(--yellow)">Warning</span>';badge.style.borderColor='var(--yellow)'}
  else{badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 2s infinite"></span><span style="color:var(--green)">All Systems Operational</span>';badge.style.borderColor='var(--green)'}

  document.getElementById('fleetKPIs').innerHTML=`
    <div class="kpi"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Total Fleet Events<button class="info-btn" onclick="event.stopPropagation();showInfo('fleet_total')">ⓘ</button></div><div class="value">${fTotal.toLocaleString()}</div><div class="sub">${hubs.length} hubs · ${activePeriodLabel()}</div></div>
    <div class="kpi" onclick="showFleetModal('reliability')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Fleet Reliability<button class="info-btn" onclick="event.stopPropagation();showInfo('fleet_reliability')">ⓘ</button></div><div class="value" style="color:${relColor(fRel)}">${fRel}%</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">${fSuccess.toLocaleString()} success · ${fFail} failures</span>${tgtLine(parseFloat(fRel),TARGETS.reliability)}</div></div>
    <div class="kpi" onclick="showFleetModal('latency')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Avg P50 Speed<button class="info-btn" onclick="event.stopPropagation();showInfo('fleet_latency')">ⓘ</button></div><div class="value">${fP50}ms</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Median end-to-end response</span>${tgtLine(fP50,TARGETS.p50Local)}</div></div>
    <div class="kpi" onclick="showFleetModal('northstar')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">North Star (Sub-1s)<button class="info-btn" onclick="event.stopPropagation();showInfo('fleet_northstar')">ⓘ</button></div><div class="value" style="color:${fNSavg>85?'var(--green)':fNSavg>70?'var(--yellow)':'var(--red)'}">${fNSavg}%</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Fleet avg under-1-second rate</span>${tgtLine(parseFloat(fNSavg),TARGETS.northStar)}</div></div>`;

  const grid=document.getElementById('hubCardsGrid');grid.innerHTML='';
  hubs.forEach(h=>{
    const d=D[h];
    const rc=relColor(d.reliability);
    const tag=relTag(d.reliability);
    const sl=statusLabel(d.reliability);
    const hasIssues=d.reliability<97||(d.speed.local_e2e.p50>800);
    const failCount=d.total-d.success;
    const card=document.createElement('div');
    card.className='hub-grid-card';card.dataset.hub=h;
    card.innerHTML=`
      <div class="hgc-header">
        <div class="hgc-name"><span class="hgc-dot" style="background:${rc}"></span>${h.toUpperCase()}</div>
        <div style="display:flex;align-items:center;gap:8px">
          ${hasIssues?`<button class="investigate-btn" onclick="event.stopPropagation();openLogCenter({hub:'${h}',tab:'failures',context:{label:'Investigating ${h.toUpperCase()}',desc:'All failure events for this hub'}})">Investigate →</button>`:''}
          <span class="tag ${tag}">${sl}</span>
        </div>
      </div>
      <div class="hgc-metrics">
        <div class="hgc-metric">
          <div class="hgc-m-label">Reliability</div>
          <div class="hgc-m-value" style="color:${rc}">${d.reliability}%</div>
          <div style="display:flex;justify-content:space-between;gap:4px;margin-top:3px"><span class="hgc-m-sub">${failCount} fail</span>${tgtLine(d.reliability,TARGETS.reliability)}</div>
        </div>
        <div class="hgc-metric">
          <div class="hgc-m-label">P50 Speed</div>
          <div class="hgc-m-value" style="color:${d.speed.local_e2e.p50>800?'var(--yellow)':'#e8edf5'}">${d.speed.local_e2e.p50}ms</div>
          <div style="display:flex;justify-content:space-between;gap:4px;margin-top:3px"><span class="hgc-m-sub">end-to-end</span>${tgtLine(d.speed.local_e2e.p50,TARGETS.p50Local)}</div>
        </div>
        <div class="hgc-metric">
          <div class="hgc-m-label">Total Events</div>
          <div class="hgc-m-value" style="color:#e8edf5">${d.total.toLocaleString()}</div>
          <div class="hgc-m-sub">${activePeriodLabel()}</div>
        </div>
      </div>
      <div class="hgc-footer">View detailed analytics →</div>`;
    card.onclick=()=>openHub(h);
    grid.appendChild(card);
  });
}

window.filterHubs=function(q){
  const term=q.toLowerCase().trim();
  const cards=document.querySelectorAll('.hub-grid-card');
  let vis=0;
  cards.forEach(c=>{const m=!term||c.dataset.hub.toLowerCase().includes(term);c.style.display=m?'':'none';if(m)vis++});
  const empty=document.getElementById('hubSearchEmpty');
  if(empty)empty.style.display=vis===0?'block':'none';
};

function openHub(hub){
  activeHub=hub;
  document.getElementById('landingView').style.display='none';
  document.getElementById('detailView').style.display='block';
  document.getElementById('logCenterView').style.display='none';
  setNav('navFleet');
  document.getElementById('hubTitle').textContent=hub.toUpperCase()+' — Detailed Analytics';
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  document.querySelectorAll('.tab-pane').forEach((p,i)=>p.style.display=i===0?'block':'none');
  renderDetail(hub);
}
function showLanding(){
  activeHub=null;destroyCharts();renderLanding();
  const s=document.getElementById('hubSearch');if(s)s.value='';
}
function switchTab(el,id){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p=>p.style.display='none');
  el.classList.add('active');document.getElementById('tab-'+id).style.display='block';
}

// ═══════════════════════════════════════════════════════════
//  SECTION 2 — LOG CENTER
// ═══════════════════════════════════════════════════════════
let lcState={hub:null,tab:'failures',filters:{},context:null,expandedRow:null,
  srcFilter:null,   // source display name → srcPred()
  ucFilter:null,    // use case name string
  segFilter:null,   // segType: 'local_e2e' | 'remote_e2e' | 'hub_snap'
  latMin:null,      // minimum latency ms
  latMax:null       // maximum latency ms (null = unbounded)
};
let lcOrigin=null;

function getActiveTabId(){
  for(const id of ['speed','reliability','usage','overall']){
    const el=document.getElementById('tab-'+id);
    if(el&&el.style.display!=='none')return id;
  }
  return'overall';
}

window.lcGoBack=function(){
  if(!lcOrigin){showLanding();return}
  if(lcOrigin.view==='detail'&&lcOrigin.hub){
    openHub(lcOrigin.hub);
    if(lcOrigin.tabId&&lcOrigin.tabId!=='overall'){
      const tabEl=document.querySelector(`.tab[onclick*="'${lcOrigin.tabId}'"]`);
      if(tabEl)switchTab(tabEl,lcOrigin.tabId);
    }
  } else showLanding();
};

function buildEventPool(hub){
  const d=D[hub];const seen=new Set();const events=[];
  const add=(ev)=>{const key=ev.ts+'|'+ev.dev;if(seen.has(key))return;seen.add(key);events.push(ev)};

  (d.failures||[]).forEach(f=>add({hub,ts:f.ts,uc:f.uc||'—',dev:f.dev||'—',room:f.room||'—',
    src:f.src||'—',lat:f.lat,reason:f.reason||'—',net:f.net||'—',dock:f.dock||'—',
    status:'fail',segType:'failure',hasTiming:false}));

  (d.speed?.local_e2e?.events||[]).forEach(e=>{
    const lat=parseFloat(e.lat)||0;
    const t1=tsMs(e.rest_resp),t2=tsMs(e.ws_conf);
    const hubAppLat=(t1&&t2)?Math.abs(t2-t1):null;
    add({hub,ts:e.ts,uc:e.uc||'—',dev:e.dev||'—',room:e.room||'—',
      src:e.src||'app',lat:e.lat,reason:null,net:e.net||'local',dock:'—',
      status:lat>1000?'slow':lat>800?'warn':'ok',segType:'local_e2e',hasTiming:true,
      tap:e.tap,cmd_sent:e.cmd_sent,rest_resp:e.rest_resp,ws_conf:e.ws_conf,
      hub_app_lat:hubAppLat})});

  (d.speed?.remote_e2e?.events||[]).forEach(e=>{
    const lat=parseFloat(e.lat)||0;
    const t1=tsMs(e.rest_resp),t2=tsMs(e.ws_conf);
    const hubAppLat=(t1&&t2)?Math.abs(t2-t1):null;
    add({hub,ts:e.ts,uc:e.uc||'Remote App',dev:e.dev||'—',room:e.room||'—',
      src:e.src||'app_remote',lat:e.lat,reason:null,net:e.net||'remote',dock:'—',
      status:lat>1000?'slow':lat>800?'warn':'ok',segType:'remote_e2e',hasTiming:true,
      tap:e.tap,cmd_sent:e.cmd_sent,rest_resp:e.rest_resp,ws_conf:e.ws_conf,
      hub_app_lat:hubAppLat})});

  (d.speed?.hub_snap_hub?.events||[]).forEach(e=>{
    const lat=parseFloat(e.lat)||0;
    add({hub,ts:e.ts,uc:e.uc||'—',dev:e.dev||'—',room:e.room||'—',
      src:'hub',lat:e.lat,reason:null,net:'thread',dock:'—',
      status:lat>800?'slow':'ok',segType:'hub_snap',hasTiming:true,
      matter_ts:e.matter_ts,snap_ts:e.snap_ts})});

  // All bucket events (including fast ones — gives broadest date coverage)
  Object.entries(d.speed?.bucket_events||{}).forEach(([bucket,evList])=>{
    (evList||[]).forEach(e=>{
      const lat=parseFloat(e.lat)||0;
      add({hub,ts:e.ts,uc:e.uc||'—',dev:e.dev||'—',room:e.room||'—',
        src:e.src||'—',lat:e.lat,reason:null,net:'—',dock:'—',
        status:lat>1000?'slow':lat>800?'warn':'ok',segType:'bucket',hasTiming:false})});
  });

  // Per use-case events — largest pool, broadest date spread
  Object.entries(d.speed?.per_uc||{}).forEach(([uc,v])=>{
    (v.events||[]).forEach(e=>{
      const lat=parseFloat(e.lat)||0;
      add({hub,ts:e.ts,uc,dev:e.dev||'—',room:e.room||'—',
        src:e.src||'—',lat:e.lat,reason:null,net:'—',dock:'—',
        status:lat>1000?'slow':lat>800?'warn':'ok',segType:'per_uc',hasTiming:false})});
  });

  return events.sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
}

function getAllEvents(hubFilter){
  const hubs=hubFilter?[hubFilter]:Object.keys(D);
  const all=[];
  hubs.forEach(h=>all.push(...buildEventPool(h)));
  return all.sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
}

function getDockLossRows(hubFilter){
  const hubs=hubFilter?[hubFilter]:Object.keys(D);
  const rows=[];
  hubs.forEach(hub=>{
    const d=D[hub],r=d.reliability_detail;if(!r)return;
    const transitLost=(r.dock_total_offline||0)-(r.dock_triggers||0);
    (r.dock_detail||[]).forEach(dd=>{
      rows.push({hub,dock_id:dd.dock_id,total:dd.total,success:dd.success,fail:dd.fail,
        avg_resp:dd.avg_resp,rel:dd.total>0?((dd.success/dd.total)*100).toFixed(1):'N/A',isTransit:false})});
    if(transitLost>0){
      rows.push({hub,dock_id:'(Thread Transit Loss)',total:r.dock_total_offline,
        success:r.dock_triggers,fail:transitLost,avg_resp:0,rel:r.dock_to_hub,isTransit:true});}
  });
  return rows;
}

window.openLogCenter=function(opts={}){
  // Capture where we came from before switching views
  const detailVisible=document.getElementById('detailView').style.display!=='none';
  const landingVisible=document.getElementById('landingView').style.display!=='none';
  if(detailVisible&&activeHub) lcOrigin={view:'detail',hub:activeHub,tabId:getActiveTabId()};
  else if(landingVisible) lcOrigin={view:'landing'};
  else lcOrigin=null;

  lcState.hub=opts.hub||null;
  lcState.tab=opts.tab||'failures';
  lcState.filters=Object.assign({src:'',reason:'',search:''},opts.filters||{});
  lcState.context=opts.context||null;
  lcState.expandedRow=null;
  lcState.srcFilter=opts.srcFilter||null;
  lcState.ucFilter=opts.ucFilter||null;
  lcState.segFilter=opts.segFilter||null;
  lcState.latMin=opts.latMin!==undefined?opts.latMin:null;
  lcState.latMax=opts.latMax!==undefined?opts.latMax:null;
  lcState.hourFilter=opts.hourFilter!==undefined?opts.hourFilter:null;

  document.getElementById('landingView').style.display='none';
  document.getElementById('detailView').style.display='none';
  document.getElementById('logCenterView').style.display='block';
  setNav('navLogs');

  // Back button
  const backBtn=document.getElementById('lcBackBtn');
  if(backBtn&&lcOrigin){
    const tabNames={overall:'Overview',speed:'Speed',reliability:'Reliability',usage:'Usage'};
    const where=lcOrigin.view==='detail'
      ?`${lcOrigin.hub.toUpperCase()} · ${tabNames[lcOrigin.tabId]||'Overview'}`
      :'Fleet Overview';
    backBtn.innerHTML=`<button class="btn" onclick="lcGoBack()" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:5px 12px">
      <span style="font-size:14px;line-height:1">←</span>
      <span><div style="font-weight:600;color:#e8edf5">${where}</div><div style="font-size:9px;color:var(--muted);margin-top:1px">Return to previous view</div></span>
    </button>`;
    backBtn.style.display='block';
  } else if(backBtn) backBtn.style.display='none';

  const els={src:'lcFilterSrc',reason:'lcFilterReason',search:'lcFilterSearch'};
  Object.entries(els).forEach(([k,id])=>{const el=document.getElementById(id);if(el)el.value=lcState.filters[k]||''});
  document.querySelectorAll('.lc-tab').forEach(t=>t.classList.remove('active'));
  const tabEl=document.querySelector(`.lc-tab[data-tab="${lcState.tab}"]`);
  if(tabEl)tabEl.classList.add('active');

  renderHubPills();renderLogCenter();
};

window.lcSetTab=function(tab){
  lcState.tab=tab;lcState.expandedRow=null;
  document.querySelectorAll('.lc-tab').forEach(t=>t.classList.remove('active'));
  const tabEl=document.querySelector(`.lc-tab[data-tab="${tab}"]`);
  if(tabEl)tabEl.classList.add('active');
  renderLogCenter();
};

window.lcSetHub=function(hub){lcState.hub=hub;lcState.expandedRow=null;renderHubPills();renderLogCenter()};

function renderHubPills(){
  const pills=document.getElementById('lcHubPills');if(!pills)return;
  pills.innerHTML=`<button class="lc-hub-pill ${!lcState.hub?'active':''}" onclick="lcSetHub(null)">All Hubs</button>`+
    Object.keys(D).map(h=>{
      const d=D[h];const dot=relColor(d.reliability);
      return`<button class="lc-hub-pill ${lcState.hub===h?'active':''}" onclick="lcSetHub('${h}')">
        <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dot};margin-right:4px;vertical-align:middle"></span>${h.toUpperCase()}</button>`;
    }).join('');
}

window.lcClearFilters=function(){
  lcState.filters={src:'',reason:'',search:''};lcState.context=null;
  lcState.srcFilter=null;lcState.ucFilter=null;lcState.segFilter=null;lcState.latMin=null;lcState.latMax=null;lcState.hourFilter=null;
  ['lcFilterSrc','lcFilterReason','lcFilterSearch'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
  const b=document.getElementById('lcContextBanner');if(b)b.style.display='none';
  renderLogCenter();
};

function applyFilters(events){
  const src=(document.getElementById('lcFilterSrc')?.value||'').toLowerCase();
  const reason=(document.getElementById('lcFilterReason')?.value||'').toLowerCase();
  const search=(document.getElementById('lcFilterSearch')?.value||'').toLowerCase();
  const pred=lcState.srcFilter?srcPred(lcState.srcFilter):null;
  return events.filter(e=>{
    if(pred&&!pred(e))return false;
    if(lcState.ucFilter&&!(e.uc||'').toLowerCase().includes(lcState.ucFilter.toLowerCase()))return false;
    if(lcState.segFilter){
      if(lcState.segFilter==='hub_app'){
        // Hub→App: show hub_snap events (snap_ts = state confirm = start of WS push to app)
        if(e.segType!=='hub_snap')return false;
      } else {
        if(e.segType!==lcState.segFilter)return false;
      }
    }
    if(lcState.latMin!==null||lcState.latMax!==null){
      const _l=parseFloat(e.lat);
      if(isNaN(_l))return false;
      if(lcState.latMin!==null&&_l<lcState.latMin)return false;
      if(lcState.latMax!==null&&_l>lcState.latMax)return false;
    }
    if(lcState.hourFilter!==null){const hr=e.ts?parseInt(e.ts.slice(11,13)):-1;if(hr!==lcState.hourFilter)return false;}
    if(src){
      const esrc=(e.src||'').toLowerCase();
      // 'remote' matches both 'app_remote' and 'remote_app'; 'app' must not match 'app_remote'
      if(src==='app'&&esrc!=='app')return false;
      else if(src!=='app'&&!esrc.includes(src))return false;
    }
    if(reason&&!(e.reason||'').toLowerCase().includes(reason))return false;
    if(search&&!`${e.ts} ${e.dev} ${e.room} ${e.uc} ${e.hub}`.toLowerCase().includes(search))return false;
    return true;
  });
}

function parseBucketFilter(bucket){
  if(bucket.startsWith('<'))return{latMin:0,latMax:parseInt(bucket.slice(1))};
  if(bucket.startsWith('>'))return{latMin:parseInt(bucket.slice(1)),latMax:null};
  const[a,b]=bucket.split('-').map(Number);return{latMin:a,latMax:b};
}

// ─── Segment-aware Log Center column definitions ─────────────
const LC_SEG_COLS={
  // Hub→SNAP→Hub: shows the device actuation path — hub issues command, SNAP device activates, state reflected back
  'hub_snap':{
    colspan:9,
    head:`<tr>
      <th style="width:22px"></th>
      <th>Event Time</th><th>Hub</th><th>Triggered By</th><th>Device</th><th>Room</th>
      <th>Hub→Matter CMD</th><th>Device State Confirmed</th><th>Round-trip</th>
    </tr>`,
    row(ev,latColor,latDisp,isExp,dev){return`
      <td style="width:22px;text-align:center;color:var(--muted);font-size:11px;user-select:none">${isExp?'▾':'▸'}</td>
      <td style="font-family:monospace;font-size:10px;white-space:nowrap;color:var(--muted)">${ev.ts||'—'}</td>
      <td><span style="font-size:10px;background:var(--surface2);padding:2px 7px;border-radius:4px;font-weight:600">${(ev.hub||'—').toUpperCase()}</span></td>
      <td style="font-size:11px">${ev.uc||'—'}</td>
      <td style="font-family:monospace;font-size:10px">${dev}</td>
      <td style="font-size:11px">${ev.room||'—'}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${ev.matter_ts||'—'}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${ev.snap_ts||'—'}</td>
      <td style="font-weight:700;color:${latColor};font-size:13px">${latDisp}</td>`;}
  },
  // Hub→App: device state is confirmed at hub (snap_ts) → hub pushes via WebSocket → app reflects new state
  // snap_ts == ws_conf (push happens at state confirm moment); hub_app.p50 = backend-measured WS push duration
  'hub_app':{
    colspan:9,
    head:`<tr>
      <th style="width:22px"></th>
      <th>Event Time</th><th>Hub</th><th>Triggered By</th><th>Device</th><th>Room</th>
      <th>State Confirmed (snap_ts)</th><th>App Reflected (ws_conf)</th><th>Hub→App</th>
    </tr>`,
    row(ev,latColor,latDisp,isExp,dev){
      // For hub→app: snap_ts = state confirmed at hub = start of WS push
      // ws_conf = app received state = end of WS push (snap_ts ≈ ws_conf from data)
      const snapTs=ev.snap_ts||'—';
      const wsConf=ev.ws_conf||ev.snap_ts||'—'; // ws_conf on matched local_e2e, snap_ts as fallback
      const haLat=ev.hub_app_lat!=null?`${ev.hub_app_lat}ms`:'≈'+D[ev.hub]?.speed?.hub_app?.p50+'ms';
      const haC=ev.hub_app_lat>200?'var(--yellow)':'var(--green)';
      return`
      <td style="width:22px;text-align:center;color:var(--muted);font-size:11px;user-select:none">${isExp?'▾':'▸'}</td>
      <td style="font-family:monospace;font-size:10px;white-space:nowrap;color:var(--muted)">${ev.ts||'—'}</td>
      <td><span style="font-size:10px;background:var(--surface2);padding:2px 7px;border-radius:4px;font-weight:600">${(ev.hub||'—').toUpperCase()}</span></td>
      <td style="font-size:11px">${ev.uc||'—'}</td>
      <td style="font-family:monospace;font-size:10px">${dev}</td>
      <td style="font-size:11px">${ev.room||'—'}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${snapTs}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${wsConf}</td>
      <td style="font-weight:700;color:${haC};font-size:12px">${haLat}</td>`;}
  },
  'local_e2e':{
    colspan:11,
    head:`<tr>
      <th style="width:22px"></th>
      <th>App Tap</th><th>Hub</th><th>Device</th><th>Room</th><th>Use Case</th>
      <th>CMD Sent</th><th>Hub ACK'd</th><th>App Updated</th>
      <th>Hub→App</th><th>Total E2E</th>
    </tr>`,
    row(ev,latColor,latDisp,isExp,dev){
      const haLat=ev.hub_app_lat!=null?ev.hub_app_lat+'ms':'—';
      const haC=ev.hub_app_lat>500?'var(--red)':ev.hub_app_lat>200?'var(--yellow)':'var(--green)';
      return`
      <td style="width:22px;text-align:center;color:var(--muted);font-size:11px;user-select:none">${isExp?'▾':'▸'}</td>
      <td style="font-family:monospace;font-size:9px;white-space:nowrap;color:var(--muted)">${ev.ts||'—'}</td>
      <td><span style="font-size:10px;background:var(--surface2);padding:2px 7px;border-radius:4px;font-weight:600">${(ev.hub||'—').toUpperCase()}</span></td>
      <td style="font-family:monospace;font-size:10px">${dev}</td>
      <td style="font-size:11px">${ev.room||'—'}</td>
      <td style="font-size:11px">${ev.uc||'—'}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${ev.cmd_sent||'—'}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${ev.rest_resp||'—'}</td>
      <td style="font-family:monospace;font-size:9px;color:var(--muted)">${ev.ws_conf||'—'}</td>
      <td style="font-size:11px;font-weight:600;color:${haC}">${haLat}</td>
      <td style="font-weight:700;color:${latColor};font-size:13px">${latDisp}</td>`;}
  }
};
LC_SEG_COLS['remote_e2e']=LC_SEG_COLS['local_e2e']; // same columns, different context

const DEFAULT_LC_HEAD=`<tr>
  <th style="width:22px"></th>
  <th>Timestamp</th><th>Hub</th><th>Use Case</th><th>Source</th><th>Device</th>
  <th>Room</th><th>Speed</th><th>Status / Reason</th><th>Network</th>
</tr>`;
const DEFAULT_LC_COLSPAN=10;

function renderLogCenter(){
  const body=document.getElementById('lcTableBody');
  const summary=document.getElementById('lcSummaryRow');
  const empty=document.getElementById('lcEmptyState');
  const banner=document.getElementById('lcContextBanner');
  if(!body)return;

  const hasFilter=lcState.context||lcState.srcFilter||lcState.ucFilter||lcState.segFilter||lcState.latMin!==null;
  if(hasFilter&&banner){
    banner.style.display='flex';
    const parts=[];
    if(lcState.srcFilter)parts.push(`Source: ${lcState.srcFilter}`);
    if(lcState.ucFilter)parts.push(`Use Case: ${lcState.ucFilter}`);
    if(lcState.segFilter)parts.push(`Segment: ${lcState.segFilter}`);
    if(lcState.latMin!==null)parts.push(`Speed: ${lcState.latMin}${lcState.latMax?'–'+lcState.latMax:'+'} ms`);
    const desc=(lcState.context?.desc||'')+(parts.length?` · Filter — ${parts.join(' · ')}`: '');
    banner.innerHTML=`<div><div class="lc-context-label">${lcState.context?.label||'Filtered View'}</div><div class="lc-context-desc">${desc}</div></div>
      <button class="lc-context-clear" onclick="lcClearFilters()">Clear Filter</button>`;
  } else if(banner) banner.style.display='none';

  if(lcState.tab==='dock_loss'){renderDockLossTab();return}

  let events=getAllEvents(lcState.hub);
  if(lcState.tab==='failures')events=events.filter(e=>e.status==='fail');
  else if(lcState.tab==='slow')events=events.filter(e=>e.status==='slow'||e.status==='warn');
  events=applyFilters(events);

  const failCnt=events.filter(e=>e.status==='fail').length;
  const slowCnt=events.filter(e=>e.status==='slow'||e.status==='warn').length;
  summary.innerHTML=`<span class="lc-cnt">${events.length}</span> events shown`+
    (failCnt>0?` · <span class="lc-cnt-r">${failCnt} failure${failCnt!==1?'s':''}</span>`:'')+
    (slowCnt>0&&lcState.tab!=='slow'?` · <span class="lc-cnt-y">${slowCnt} slow</span>`:'')+
    ` · ${lcState.hub?lcState.hub.toUpperCase():'All Hubs'} · ${activePeriodLabel()}`;

  if(!events.length){body.innerHTML='';empty.style.display='block';return}
  empty.style.display='none';body.innerHTML='';

  // Segment-aware column switching
  const segCols=LC_SEG_COLS[lcState.segFilter]||null;
  const thead=document.getElementById('lcTableHead');
  if(thead)thead.innerHTML=segCols?segCols.head:DEFAULT_LC_HEAD;
  const colspan=segCols?segCols.colspan:DEFAULT_LC_COLSPAN;

  events.forEach((ev,idx)=>{
    const rowCls=ev.status==='fail'?'lc-row-fail':ev.status==='slow'||ev.status==='warn'?'lc-row-slow':'lc-row-ok';
    const latColor=ev.status==='fail'?'var(--red)':ev.status==='slow'?'var(--red)':ev.status==='warn'?'var(--yellow)':'var(--green)';
    const latDisp=ev.lat&&ev.lat!=='N/A'?`${ev.lat}ms`:'—';
    const statusCell=ev.status==='fail'
      ?`<span class="tag tag-red">${ev.reason||'FAILED'}</span>`
      :ev.status==='slow'||ev.status==='warn'
        ?`<span class="tag tag-yellow">SLOW</span>`
        :`<span class="tag tag-green">OK</span>`;
    const isExp=lcState.expandedRow===idx;
    const devShort=(ev.dev||'—').replace('light.snap_','').replace('switch.snap_','');

    const tr=document.createElement('tr');
    tr.className=`lc-row ${rowCls}${isExp?' lc-expanded':''}`;

    if(segCols){
      tr.innerHTML=segCols.row(ev,latColor,latDisp,isExp,devShort);
    } else {
      tr.innerHTML=`
        <td style="width:22px;text-align:center;color:var(--muted);font-size:11px;user-select:none">${isExp?'▾':'▸'}</td>
        <td style="font-family:monospace;font-size:10px;white-space:nowrap;color:var(--muted)">${ev.ts||'—'}</td>
        <td><span style="font-size:10px;background:var(--surface2);padding:2px 7px;border-radius:4px;font-weight:600">${(ev.hub||'—').toUpperCase()}</span></td>
        <td style="font-size:11px">${ev.uc||'—'}</td>
        <td style="font-size:10px;color:var(--muted)">${ev.src||'—'}</td>
        <td style="font-family:monospace;font-size:10px">${devShort}</td>
        <td style="font-size:11px">${ev.room||'—'}</td>
        <td style="font-weight:700;color:${latColor};font-size:13px">${latDisp}</td>
        <td>${statusCell}</td>
        <td style="font-size:10px;color:var(--muted)">${ev.net||'—'}</td>`;
    }
    tr.onclick=()=>{lcState.expandedRow=(lcState.expandedRow===idx?null:idx);renderLogCenter()};
    body.appendChild(tr);

    if(isExp){
      const expTr=document.createElement('tr');expTr.className='lc-expand-row';
      const td=document.createElement('td');td.colSpan=colspan;
      td.innerHTML=buildTimingExpand(ev);
      expTr.appendChild(td);body.appendChild(expTr);
    }
  });
  // Reset thead to default when no segFilter (e.g. after clear)
  if(!segCols&&thead)thead.innerHTML=DEFAULT_LC_HEAD;
}

function renderDockLossTab(){
  const body=document.getElementById('lcTableBody');
  const summary=document.getElementById('lcSummaryRow');
  const empty=document.getElementById('lcEmptyState');
  if(!body)return;
  const rows=getDockLossRows(lcState.hub);
  summary.innerHTML=`<span class="lc-cnt">${rows.length}</span> dock records · ${lcState.hub?lcState.hub.toUpperCase():'All Hubs'}`;
  if(!rows.length){body.innerHTML='';empty.style.display='block';empty.textContent='No dock data found.';return}
  empty.style.display='none';
  body.innerHTML=rows.map(r=>{
    const rn=parseFloat(r.rel);const tag=relTag(rn);
    const rowCls=r.fail>0?'lc-row lc-row-fail':'lc-row lc-row-ok';
    return`<tr class="${rowCls}">
      <td></td>
      <td style="font-size:10px;color:var(--muted)">${r.hub.toUpperCase()}</td>
      <td colspan="2" style="font-family:monospace;font-size:11px;font-weight:600">${r.dock_id}</td>
      <td style="font-size:11px">Total: <strong>${r.total}</strong></td>
      <td style="font-size:11px;color:var(--green)">Success: ${r.success}</td>
      <td style="font-size:11px;color:${r.fail>0?'var(--red)':'inherit'}">Failed: <strong>${r.fail}</strong></td>
      <td style="font-weight:700;font-size:13px;color:${r.fail>0?'var(--red)':'var(--green)'}">${r.fail} ${r.isTransit?'lost in transit':'failed'}</td>
      <td><span class="tag ${tag}">${r.rel}%</span></td>
      <td style="font-size:10px;color:var(--muted)">${r.isTransit?'Thread mesh loss':r.avg_resp?(r.avg_resp*1000).toFixed(0)+'ms avg':''}</td>
    </tr>`;
  }).join('');
}

function buildTimingExpand(ev){
  let html='<div class="timing-pipeline-wrap">';
  if(ev.status==='fail'){
    html+=`<div class="tp-fail-banner"><div class="tp-fail-reason">${ev.reason||'FAILED'}</div><div class="tp-fail-meta">${ev.ts} · ${ev.uc} · ${ev.src}</div></div>
    <div class="tp-fields">
      ${tpField('Timestamp',ev.ts)}${tpField('Hub',ev.hub?.toUpperCase())}${tpField('Use Case',ev.uc)}
      ${tpField('Device',ev.dev)}${tpField('Room',ev.room)}${tpField('Source',ev.src)}
      ${tpField('Speed',ev.lat&&ev.lat!=='N/A'?ev.lat+'ms':'N/A')}${tpField('Network',ev.net)}
      ${ev.dock&&ev.dock!=='—'?tpField('Dock',ev.dock):''}
      ${tpField('Failure Reason',`<span class="tag tag-red">${ev.reason||'—'}</span>`)}
    </div>`;
  } else if(ev.hasTiming&&(ev.segType==='local_e2e'||ev.segType==='remote_e2e')){
    const s1=msDiff(ev.tap,ev.cmd_sent);
    const s2=msDiff(ev.cmd_sent,ev.rest_resp);
    const s3=msDiff(ev.rest_resp,ev.ws_conf);
    const total=parseFloat(ev.lat)||0;
    const ss1=segStatus(s1),ss2=segStatus(s2),ss3=segStatus(s3);
    const lastDot=total>1000?'tp-slow':total>800?'tp-warn':'tp-ok';
    // Segment meanings:
    // s1 = tap → cmd_sent       : User tapped, app processed and sent REST command
    // s2 = cmd_sent → rest_resp : REST command travels to hub + hub sends ACK back to app
    // s3 = rest_resp → ws_conf  : Hub commands SNAP device (Thread mesh) + device activates + state reflected to hub + hub pushes to app via WebSocket
    const network=ev.segType==='remote_e2e'?'Remote via Internet':'Local via Wi-Fi';
    html+=`<div class="tp-title">End-to-End Request Flow · ${network} · Total: ${total}ms</div>`;
    html+=`<div class="timing-pipeline">
      <div class="tp-node"><div class="tp-node-dot ${ss1}"></div><div class="tp-node-label">App Tap</div></div>
      ${tpSeg(s1,'App Sends CMD',ss1)}
      <div class="tp-node"><div class="tp-node-dot ${ss2}"></div><div class="tp-node-label">CMD Sent</div></div>
      ${tpSeg(s2,'App→Hub Transit',ss2)}
      <div class="tp-node"><div class="tp-node-dot ${ss3}"></div><div class="tp-node-label">Hub ACK'd</div></div>
      ${tpSeg(s3,'Hub→Device→App',ss3)}
      <div class="tp-node"><div class="tp-node-dot ${lastDot}"></div><div class="tp-node-label">App Updated</div></div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px 12px;font-size:10px;color:var(--muted);margin-top:10px;line-height:1.7">
      <strong style="color:#e8edf5">Segment breakdown:</strong><br>
      <strong>App Sends CMD (${s1!==null?s1+'ms':'—'}):</strong> App processes tap and dispatches REST command<br>
      <strong>App→Hub Transit (${s2!==null?s2+'ms':'—'}):</strong> Command travels to hub · Hub receives and ACKs<br>
      <strong>Hub→Device→App (${s3!==null?s3+'ms':'—'}):</strong> Hub → SNAP device (Thread mesh) → Device activates → State reflected to hub → Hub pushes state to app via WebSocket
    </div>
    <div class="tp-fields" style="margin-top:10px">${tpField('Device',ev.dev)}${tpField('Room',ev.room)}${tpField('Network',ev.net)}${tpField('Use Case',ev.uc)}
      ${ev.hub_app_lat!=null?tpField('Hub→App WS Push',`<strong style="color:${ev.hub_app_lat>500?'var(--red)':ev.hub_app_lat>200?'var(--yellow)':'var(--green)'}">${ev.hub_app_lat}ms</strong>`):''}
    </div>`;
  } else if(ev.hasTiming&&ev.segType==='hub_snap'){
    const s1=msDiff(ev.ts,ev.matter_ts);
    const s2=msDiff(ev.matter_ts,ev.snap_ts);
    const total=parseFloat(ev.lat)||0;
    const ss1=segStatus(s1),ss2=segStatus(s2);
    // s1 = ts → matter_ts : Hub issues Matter command to Thread mesh
    // s2 = matter_ts → snap_ts : Matter command reaches SNAP device → device activates → state reflected back to hub
    html+=`<div class="tp-title">Hub → SNAP Device → Hub Flow · Total: ${total}ms</div>`;
    html+=`<div class="timing-pipeline">
      <div class="tp-node"><div class="tp-node-dot tp-ok"></div><div class="tp-node-label">Hub Issues CMD</div></div>
      ${tpSeg(s1,'Hub→Thread Mesh',ss1)}
      <div class="tp-node"><div class="tp-node-dot ${ss1}"></div><div class="tp-node-label">Matter CMD Sent</div></div>
      ${tpSeg(s2,'Device Activates + State Reflects',ss2)}
      <div class="tp-node"><div class="tp-node-dot ${total>800?'tp-slow':'tp-ok'}"></div><div class="tp-node-label">State Confirmed at Hub<br><span style="color:var(--blue);font-size:8px">→ WS push to App starts here</span></div></div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px 12px;font-size:10px;color:var(--muted);margin-top:10px;line-height:1.7">
      <strong style="color:#e8edf5">Flow:</strong> Hub issues Matter command → Thread mesh transit → SNAP device activates → State change reflected back to hub<br>
      <strong>Hub→Thread Mesh (${s1!==null?s1+'ms':'—'}):</strong> Hub dispatches Matter protocol command<br>
      <strong>Device Activates (${s2!==null?s2+'ms':'—'}):</strong> SNAP device receives, activates, and reflects state back to hub<br>
      <strong style="color:var(--blue)">After this point:</strong> Hub immediately pushes state to app via WebSocket (~${ev.hub&&D[ev.hub]&&D[ev.hub].speed.hub_app.p50?D[ev.hub].speed.hub_app.p50+'ms':'—'} average)
    </div>
    <div class="tp-fields" style="margin-top:10px">${tpField('Device',ev.dev)}${tpField('Room',ev.room)}${tpField('Use Case',ev.uc)}</div>`;
  } else {
    html+=`<div class="tp-fields">
      ${tpField('Timestamp',ev.ts)}${tpField('Hub',ev.hub?.toUpperCase())}${tpField('Use Case',ev.uc)}
      ${tpField('Source',ev.src)}${tpField('Device',ev.dev)}${tpField('Room',ev.room)}
      ${tpField('Speed',ev.lat?ev.lat+'ms':'—')}${tpField('Network',ev.net)}
    </div>`;
  }
  html+='</div>';return html;
}

function tpField(label,value){
  return`<div class="tp-field"><div class="tp-field-label">${label}</div><div class="tp-field-val">${value||'—'}</div></div>`;
}
function tpSeg(ms,label,status){
  return`<div class="tp-seg"><div class="tp-seg-ms ${status}">${ms!==null?ms+'ms':'—'}</div><div class="tp-seg-line ${status}"></div><div class="tp-seg-label">${label}</div></div>`;
}

// ═══════════════════════════════════════════════════════════
//  SECTION 3 — HUB DETAIL
// ═══════════════════════════════════════════════════════════
function renderDetail(hub){
  destroyCharts();const d=D[hub],f=d.total-d.success;
  const nsAvg=d.daily&&d.daily.length?(d.daily.reduce((s,dy)=>s+(dy.ns||0),0)/d.daily.length).toFixed(1):0;
  const nsC=parseFloat(nsAvg)>=85?'var(--green)':parseFloat(nsAvg)>=70?'var(--yellow)':'var(--red)';
  const kpiEl=document.getElementById('topKPIs');
  kpiEl.style.gridTemplateColumns='repeat(6,1fr)';
  kpiEl.innerHTML=`
    <div class="kpi" onclick="switchTab(document.querySelectorAll('.tab')[0],'overall')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Total Events<button class="info-btn" onclick="event.stopPropagation();showInfo('hub_total')">ⓘ</button></div><div class="value">${d.total}</div><div class="sub">Click for daily trend</div></div>
    <div class="kpi" onclick="switchTab(document.querySelectorAll('.tab')[2],'reliability')"><div class="label">Total Devices</div><div class="value">${d.total_devices || 0}</div><div class="sub">Active in window</div></div>
    <div class="kpi" onclick="switchTab(document.querySelectorAll('.tab')[2],'reliability')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Reliability<button class="info-btn" onclick="event.stopPropagation();showInfo('hub_reliability')">ⓘ</button></div><div class="value" style="color:${relColor(d.reliability)}">${d.reliability}%</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="switchTab(document.querySelectorAll('.tab')[1],'speed')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">P50 Speed<button class="info-btn" onclick="event.stopPropagation();showInfo('hub_latency')">ⓘ</button></div><div class="value" style="color:${d.speed.local_e2e.p50>800?'var(--yellow)':'#e8edf5'}">${d.speed.local_e2e.p50}ms</div><div class="sub">Click for speed drill-down</div></div>
    <div class="kpi" style="cursor:pointer" onclick="openLogCenter({hub:'${hub}',tab:'failures',context:{label:'${hub.toUpperCase()} — All Failures',desc:'${f} failures · ${activePeriodLabel()}'}})">
      <div class="label" style="display:flex;justify-content:space-between;align-items:center">Failures<button class="info-btn" onclick="event.stopPropagation();showInfo('hub_failures')">ⓘ</button></div><div class="value" style="color:var(--red)">${f}</div>
      <div class="sub" style="color:var(--blue)">Click → Log Center</div></div>
    <div class="kpi" style="cursor:pointer" onclick="showHubNSModal('${hub}')">
      <div class="label" style="display:flex;justify-content:space-between;align-items:center">North Star (Sub-1s)<button class="info-btn" onclick="event.stopPropagation();showInfo('fleet_northstar')">ⓘ</button></div>
      <div class="value" style="color:${nsC}">${nsAvg}%</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Click for breakdown</span>${tgtLine(parseFloat(nsAvg),TARGETS.northStar)}</div></div>`;
  renderOverall(d);renderSpeed(d);renderReliability(d);renderUsage(d);
}

// focus: 'events' | 'reliability' | 'ns'
function showDayDebug(hub,dayIdx,focus){
  const d=D[hub],day=d.daily[dayIdx];if(!day)return;
  const nsC=(day.ns||0)>85?'var(--green)':(day.ns||0)>70?'var(--yellow)':'var(--red)';
  const relC=relColor(day.rel);

  const pool=buildEventPool(hub);
  const dayAll=pool.filter(e=>(e.ts||'').startsWith(day.date));
  const dayFails=dayAll.filter(e=>e.status==='fail');
  const dayNsMiss=dayAll.filter(e=>parseFloat(e.lat||0)>1000);
  const cols=[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'lat',label:'Speed'},{key:'reason',label:'Reason'}];

  const statBar=`<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
    <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Total Events</div>
      <div style="font-size:20px;font-weight:700;color:#e8edf5">${day.total}</div>
    </div>
    <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">Reliability</div>
      <div style="font-size:20px;font-weight:700;color:${relC}">${day.rel}%</div>
    </div>
    <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">P50 Speed</div>
      <div style="font-size:20px;font-weight:700;color:${day.p50>800?'var(--yellow)':'#e8edf5'}">${day.p50}ms</div>
    </div>
    <div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">North Star</div>
      <div style="font-size:20px;font-weight:700;color:${nsC}">${(day.ns||0).toFixed(1)}%</div>
    </div>
  </div>`;

  const lcAllFails={hub,tab:'failures',filters:{search:day.date},context:{label:`Failures on ${day.date}`,desc:`${hub.toUpperCase()} · Reliability was ${day.rel}%`}};
  const lcAllSlow={hub,tab:'slow',filters:{search:day.date},context:{label:`Slow Events on ${day.date}`,desc:`${hub.toUpperCase()} · North Star was ${(day.ns||0).toFixed(1)}%`}};
  const lcAllEvs={hub,tab:'all',filters:{search:day.date},context:{label:`All Events on ${day.date}`,desc:`${hub.toUpperCase()} · ${day.total} total events`}};

  let body=statBar,title='',logOpts=null,rows=[],emptyMsg='';

  if(focus==='events'){
    // Show ALL sampled events for the day — what the bar actually represents
    title=`${day.date} — ${day.total} Events`;
    rows=[...dayAll].sort((a,b)=>{const r=s=>s==='fail'?0:s==='slow'?1:s==='warn'?2:3;return r(a.status)-r(b.status);});
    logOpts=lcAllEvs;
    emptyMsg=`No sampled events found for ${day.date}. The pool contains events distributed across all 30 days.`;
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Events on ${day.date} — ${rows.length} sampled of ${day.total} total</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(logOpts).replace(/"/g,'&quot;')})">View ${day.date} in Log Center →</button>
      </div>
      ${rows.length?evTable(rows,cols)+`<p style="font-size:10px;color:var(--muted);margin-top:6px">Showing ${rows.length} sampled events of ${day.total} total on this day.</p>`:`<div class="dbg-empty">${emptyMsg}</div>`}
    </div>`;

  } else if(focus==='reliability'){
    title=`${day.date} — Reliability ${day.rel}%`;
    rows=dayFails;
    logOpts=lcAllFails;
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Failures on ${day.date} — ${rows.length} found in sample</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(logOpts).replace(/"/g,'&quot;')})">View ${day.date} failures in Log Center →</button>
      </div>
      ${rows.length?evTable(rows,cols):`<div class="dbg-empty">No failures in sample for ${day.date}. Click "View in Log Center →" — it will search all events for this date.</div>`}
    </div>`;

  } else if(focus==='ns'){
    const nsFail=Math.round(day.total*(1-(day.ns||0)/100));
    title=`${day.date} — North Star ${(day.ns||0).toFixed(1)}%`;
    rows=dayNsMiss;
    logOpts=lcAllSlow;
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Events >1s on ${day.date} — ${rows.length} sampled · ~${nsFail} missed target</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(logOpts).replace(/"/g,'&quot;')})">View ${day.date} slow events in Log Center →</button>
      </div>
      ${rows.length?evTable(rows,cols):`<div class="dbg-empty">No >1s events in sample for ${day.date}. ~${nsFail} events missed the 1s target. Click "View in Log Center →" to search by this date.</div>`}
    </div>`;
  }

  showModal(title,body);
}

function renderOverall(d){
  const _nsAvg=d.daily&&d.daily.length?(d.daily.reduce((s,dy)=>s+(dy.ns||0),0)/d.daily.length).toFixed(1):0;
  const _nsC=parseFloat(_nsAvg)>=85?'var(--green)':parseFloat(_nsAvg)>=70?'var(--yellow)':'var(--red)';
  const _nsBar=document.getElementById('nsKpiBar');
  if(_nsBar)_nsBar.innerHTML=`<div onclick="showHubNSModal('${activeHub}')" style="display:flex;align-items:center;gap:14px;padding:9px 14px;background:var(--bg);border-radius:6px;margin-bottom:10px;cursor:pointer;border:1px solid var(--border);transition:border-color .15s" onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border)'"><div style="font-size:26px;font-weight:700;color:${_nsC};line-height:1">${_nsAvg}%</div><div><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:12px;color:#e8edf5;font-weight:600">Period Average</span>${tgtLine(parseFloat(_nsAvg),TARGETS.northStar)}</div><div style="font-size:9px;color:var(--blue);margin-top:3px">Click to see formula &amp; full breakdown →</div></div></div>`;
  const dates=d.daily.map(r=>r.date.slice(5));
  charts.daily=mc('dailyChart',{type:'bar',data:{labels:dates,datasets:[
    {label:'Events',data:d.daily.map(r=>r.total),backgroundColor:'#2a6bd4',borderRadius:2,order:2},
    {label:'Reliability %',data:d.daily.map(r=>r.rel),type:'line',borderColor:'#1fa355',yAxisID:'y1',tension:.3,pointRadius:3,borderWidth:1.5,order:1},
    {label:'Target 97%',data:dates.map(()=>97),type:'line',yAxisID:'y1',borderColor:'rgba(220,232,248,.25)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,tension:0,order:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;
        // datasetIndex 0 = Events bar, 1 = Reliability line, 2 = target
        const focus=els[0].datasetIndex===1?'reliability':'events';
        showDayDebug(activeHub,els[0].index,focus);},
      plugins:{tooltip:{filter:function(item){return item.datasetIndex<2;},callbacks:{label:function(ctx){return ctx.dataset.label+': '+(ctx.dataset.yAxisID==='y1'?ctx.parsed.y.toFixed(2)+'%':ctx.parsed.y+' events')}}}},
      scales:{y:{title:{display:true,text:'Event Count'},beginAtZero:true},
        y1:{title:{display:true,text:'Reliability %'},position:'right',min:85,max:102,grid:{display:false}},
        x:{title:{display:true,text:'Date'}}}}});

  charts.ns=mc('nsChart',{type:'line',data:{labels:dates,datasets:[
    {label:'Sub-1s %',data:d.daily.map(r=>r.ns),borderColor:'#3d82f0',backgroundColor:'rgba(61,130,240,.1)',fill:true,tension:.3,pointRadius:3},
    {label:'Target 85%',data:dates.map(()=>85),borderColor:'rgba(220,232,248,.25)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,tension:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;showDayDebug(activeHub,els[0].index,'ns');},
      plugins:{tooltip:{filter:function(item){return item.datasetIndex===0;},callbacks:{label:function(ctx){return 'Sub-1s: '+ctx.parsed.y.toFixed(1)+'%'}}}},
      scales:{y:{title:{display:true,text:'% Events Under 1 Second (click to inspect)'},min:60,max:102},x:{title:{display:true,text:'Date'}}}}});

  const hm=document.getElementById('heatmapContainer');hm.innerHTML='';
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  hm.innerHTML+='<div class="heatmap-label"></div>';
  for(let h=0;h<24;h++)hm.innerHTML+=`<div class="heatmap-label" style="text-align:center">${h}</div>`;
  const vals=Object.values(d.heatmap),maxV=Math.max(...vals,1);
  days.forEach(day=>{
    hm.innerHTML+=`<div class="heatmap-label">${day.slice(0,3)}</div>`;
    for(let h=0;h<24;h++){
      const k=`${day}_${h}`,v=d.heatmap[k]||0,intensity=v/maxV;
      const bg=intensity>0?`rgba(239,83,80,${.08+intensity*.72})`:'#0c1018';
      const det=d.heatmap_detail[k]||{events:0,failures:0,app:0,dock:0,remote:0,auto:0};
      hm.innerHTML+=`<div class="heatmap-cell" style="background:${bg};color:${intensity>.5?'#fff':'var(--muted)'}"
        onmouseover="showHeatTip(this,'${day}',${h},${v},${det.events},${det.failures},${det.app},${det.dock},${det.remote},${det.auto})"
        onmouseout="hideHeatTip(this)"
        onclick="openLogCenter({hub:'${activeHub}',tab:'all',hourFilter:${h},context:{label:'${day} ${h}:00 — ${v}% Fail Rate',desc:'Events: ${det.events} · Failures: ${det.failures}'}})">
        ${v?v+'%':''}</div>`}});
}

window.showHeatTip=function(el,day,h,v,ev,fail,app,dock,rem,auto){
  let tip=document.createElement('div');tip.className='tooltip-box';
  tip.innerHTML=`<strong>${day} ${h}:00</strong><br>${v}% fail rate<hr style="border-color:var(--border);margin:4px 0">Events: ${ev} · Failures: ${fail}<br>App: ${app} · Dock: ${dock}<br>Remote: ${rem} · Auto: ${auto}<br><span style="font-size:9px;color:var(--blue)">Click → Log Center</span>`;
  el.style.position='relative';el.appendChild(tip);tip.style.position='absolute';tip.style.bottom='100%';tip.style.left='50%';tip.style.transform='translateX(-50%)'};
window.hideHeatTip=function(el){const t=el.querySelector('.tooltip-box');if(t)t.remove()};

// ═══════════════════════════════════════════════════════════
//  SECTION 4 — SPEED TAB
// ═══════════════════════════════════════════════════════════
function renderSpeed(d){
  const s=d.speed;
  const maxBar=Math.max(s.hub_snap_hub.p50||1,48,s.local_e2e.p50||1,s.remote_e2e.p50||1);

  // Derive Hub→App events: ws_conf - rest_resp from local_e2e events
  const hubAppEvents=(s.local_e2e?.events||[]).map(e=>{
    const t1=tsMs(e.rest_resp),t2=tsMs(e.ws_conf);
    const pushLat=(t1&&t2)?Math.abs(t2-t1):null;
    return{ts:e.ts,dev:e.dev,uc:e.uc,room:e.room,
      hub_dispatched:e.rest_resp,app_confirmed:e.ws_conf,
      lat:pushLat!==null?String(pushLat):null};
  }).filter(e=>e.lat!==null);

  const segs=[
    {key:'hub_snap_hub',name:'Hub → SNAP → Hub',desc:'App triggers hub → hub issues Matter cmd over Thread mesh → SNAP device activates → state reflected back to hub',val:s.hub_snap_hub,color:'var(--green)',target:TARGETS.hubSnap,
     cols:[{key:'ts',label:'Event Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'matter_ts',label:'Matter CMD Sent'},{key:'snap_ts',label:'State Reflected'},{key:'lat',label:'Total (ms)'},{key:'room',label:'Room'}]},
    {key:'hub_app',name:'Hub → App (WebSocket Push)',desc:'Device state confirmed at hub (snap_ts) → hub immediately pushes via WebSocket → app reflects new state. P50: '+s.hub_app.p50+'ms',val:s.hub_app,color:'var(--blue)',target:TARGETS.hubApp,
     derivedEvents:hubAppEvents,
     cols:[{key:'ts',label:'Event Time'},{key:'hub_dispatched',label:'State Confirmed at Hub'},{key:'app_confirmed',label:'App Received (ws_conf)'},{key:'lat',label:'Push (ms)'},{key:'dev',label:'Device'},{key:'room',label:'Room'}]},
    {key:'local_e2e',name:'Local E2E (App → Hub → Device → Hub → App)',desc:'Full round-trip: App sends cmd → Hub receives → SNAP device activates → state pushed back to app via WebSocket (Wi-Fi)',val:s.local_e2e,color:'var(--purple)',target:TARGETS.localE2e,
     cols:[{key:'ts',label:'Tap Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'cmd_sent',label:'CMD Sent'},{key:'rest_resp',label:'Hub ACK\'d'},{key:'ws_conf',label:'App Updated'},{key:'lat',label:'E2E (ms)'}]},
    {key:'remote_e2e',name:'Remote E2E (App → Hub → Device → Hub → App)',desc:'Full round-trip via Internet: App sends cmd remotely → Hub receives → SNAP device activates → state pushed back to app via WebSocket',val:s.remote_e2e,color:'var(--yellow)',target:TARGETS.remoteE2e,
     cols:[{key:'ts',label:'Tap Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'cmd_sent',label:'CMD Sent'},{key:'rest_resp',label:'Hub ACK\'d'},{key:'ws_conf',label:'App Updated'},{key:'lat',label:'E2E (ms)'}]}
  ];

  const el=document.getElementById('speedSegments');el.innerHTML='';
  segs.forEach(sg=>{
    const pct=Math.min((sg.val.p50/maxBar)*100,100);
    const isSlow=sg.target?sg.val.p50>sg.target.val:sg.val.p50>800;
    const div=document.createElement('div');div.className='speed-segment';
    div.innerHTML=`<div class="seg-name"><strong>${sg.name}</strong><br><span style="color:var(--muted);font-size:9px">${sg.desc}</span></div>
      <div class="seg-bar"><div class="seg-fill" style="width:${pct}%;background:${isSlow?'var(--yellow)':sg.color}"></div></div>
      <div style="text-align:right;min-width:105px">
        <div class="seg-val" style="color:${isSlow?'var(--yellow)':'#e8edf5'}">${sg.val.p50}ms</div>
        <div style="font-size:9px;color:var(--muted);margin-top:2px">P50 · ${tgtLine(sg.val.p50,sg.target)}</div>
      </div>`;
    div.onclick=()=>{
      const row=(l,v)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0;white-space:nowrap">${l}</td><td>${v}</td></tr>`;
      let body=`<table style="font-size:12px;margin-bottom:14px">
        ${row('Segment',`<strong>${sg.name}</strong>`)}${row('Description',sg.desc)}
        ${row('Avg',sg.val.avg+'ms')}${row('P50',`<strong style="font-size:16px;color:${isSlow?'var(--yellow)':'#e8edf5'}">${sg.val.p50}ms</strong>`)}
        ${row('P95',`<span style="color:${sg.val.p95>1000?'var(--red)':sg.val.p95>500?'var(--yellow)':'var(--green)'}">${sg.val.p95}ms</span>`)}
      </table>`;
      const segF=sg.key==='hub_snap_hub'?'hub_snap':sg.key==='hub_app'?'hub_app':sg.key;
      const lcOpts={hub:activeHub,tab:'all',segFilter:segF,
        context:{label:sg.name,desc:`P50: ${sg.val.p50}ms · P95: ${sg.val.p95}ms`}};
      // hub_app uses derived events (ws_conf − rest_resp per local_e2e event); others use raw events
      const displayEvents=sg.key==='hub_app'?sg.derivedEvents:(sg.val.events||[]);
      const displayCols=sg.cols;
      if(displayEvents&&displayEvents.length){
        body+=`<div class="dbg-section-hdr" style="margin-bottom:8px">
          <span class="dbg-section-title">Sample Events (${displayEvents.length})</span>
          <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View in Log Center →</button>
        </div>`+evTable(displayEvents,displayCols);
      } else {
        body+=`<div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View in Log Center →</button></div>`;
      }
      showModal(sg.name+' — Detail',body);
    };
    el.appendChild(div);
  });

  const b=s.buckets,bk=Object.keys(b);
  const bucketColors=['#1fa355','#1fa355','#3d82f0','#d4961f','#d4961f','#e04545'];
  charts.latDist=mc('latDistChart',{type:'bar',data:{labels:bk,datasets:[{label:'Events',data:Object.values(b),backgroundColor:bucketColors,borderRadius:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      onClick:(e,els)=>{if(!els.length)return;
        const k=bk[els[0].index],evs=s.bucket_events[k],isProblematic=k.includes('800')||k.includes('>1000')||k.includes('600');
        const row=(l,v)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0">${l}</td><td>${v}</td></tr>`;
        let body=`<table style="font-size:12px;margin-bottom:14px">
          ${row('Speed Range',`<strong>${k}ms</strong>`)}
          ${row('Event Count',`<strong>${b[k]}</strong>`)}
          ${isProblematic?row('Assessment',`<span style="color:var(--red)">Above 600ms — degraded user experience</span>`):''}
        </table>`;
        if(evs&&evs.length){
          body+=`<div class="dbg-section-hdr" style="margin-bottom:8px">
            <span class="dbg-section-title">Sample Events</span>
            <button class="dbg-lc-link" onclick="(()=>{const f=parseBucketFilter('${k}');closeModal();openLogCenter(Object.assign({hub:'${activeHub}',tab:'all',context:{label:'Speed ${k}ms — ${b[k]} events',desc:'${activeHub.toUpperCase()} · ${b[k]} events in this speed range'}},f))})()">View in Log Center →</button>
          </div>`+evTable(evs,[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'src',label:'Source'},{key:'lat',label:'Speed'},{key:'room',label:'Room'}]);
        }
        showModal(`Speed ${k}ms — ${b[k]} Events`,body)},
      scales:{y:{title:{display:true,text:'Event Count'},beginAtZero:true},x:{title:{display:true,text:'Speed Range (ms)'}}}}});

  renderUCCards(s.per_uc);
}

function renderUCCards(perUc){
  const BKTS=[
    {k:'<500ms',     color:'#1fa355',label:'<500ms'},
    {k:'500-1000ms', color:'#d4961f',label:'500ms–1s'},
    {k:'1-2s',       color:'#e07a20',label:'1–2s'},
    {k:'2-5s',       color:'#e04545',label:'2–5s'},
    {k:'>5s',        color:'#b02a2a',label:'>5s'},
  ];
  const grid=document.getElementById('ucCardsGrid');
  if(!grid)return;
  grid.innerHTML='';
  Object.keys(perUc).sort().forEach(uc=>{
    const v=perUc[uc];
    const st=v.p95<1000?'Healthy':v.p95<2000?'Warning':'Critical';
    const sc=st==='Healthy'?'tag-green':st==='Warning'?'tag-yellow':'tag-red';
    const p50c=v.p50<500?'var(--green)':v.p50<1000?'var(--yellow)':'var(--red)';
    const p95c=v.p95<1000?'var(--green)':v.p95<2000?'var(--yellow)':'var(--red)';
    const bkts=v.buckets||{};
    const bkTotal=BKTS.reduce((s,b)=>s+(bkts[b.k]||0),0)||1;
    const under1k=(bkts['<500ms']||0)+(bkts['500-1000ms']||0);
    const sub1sPct=bkTotal>1?((under1k/bkTotal)*100).toFixed(0):0;
    const sub1sC=sub1sPct>=85?'var(--green)':sub1sPct>=70?'var(--yellow)':'var(--red)';

    const barSegs=BKTS.map(b=>{
      const cnt=bkts[b.k]||0;if(!cnt)return'';
      const pct=(cnt/bkTotal*100).toFixed(2);
      return `<div style="width:${pct}%;background:${b.color};height:100%" title="${b.k}: ${cnt} events (${parseFloat(pct).toFixed(1)}%)"></div>`;
    }).join('');

    const legend=BKTS.filter(b=>(bkts[b.k]||0)>0).map(b=>{
      const pct=((bkts[b.k]||0)/bkTotal*100).toFixed(0);
      return `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:7px;height:7px;border-radius:1px;background:${b.color};display:inline-block;flex-shrink:0"></span>${b.label} ${pct}%</span>`;
    }).join('');

    const card=document.createElement('div');
    card.className='uc-card';
    card.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <div style="font-size:12px;font-weight:600;color:#e8edf5;line-height:1.3;padding-right:8px">${uc}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <button class="info-btn" onclick="event.stopPropagation();showInfo('uc_speed_metrics')" title="What do these numbers mean?">ⓘ</button>
          <span class="tag ${sc}">${st}</span>
        </div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:12px">${v.count.toLocaleString()} events · ${activePeriodLabel()}</div>
      <div style="font-size:26px;font-weight:700;color:${p50c};line-height:1">${v.p50}ms</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:10px">Median (P50)</div>
      <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;margin-bottom:12px">
        <div style="flex:1;padding:6px 8px;text-align:center;border-right:1px solid var(--border)">
          <div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:2px">Avg</div>
          <div style="font-size:12px;font-weight:600">${v.avg}ms</div>
        </div>
        <div style="flex:1;padding:6px 8px;text-align:center;border-right:1px solid var(--border)">
          <div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:2px">P95</div>
          <div style="font-size:12px;font-weight:600;color:${p95c}">${v.p95}ms</div>
        </div>
        <div style="flex:1;padding:6px 8px;text-align:center;border-right:1px solid var(--border)">
          <div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:2px">Std Dev</div>
          <div style="font-size:12px;font-weight:600;color:${(v.stddev||0)>500?'var(--red)':(v.stddev||0)>200?'var(--yellow)':'var(--green)'}">${v.stddev??'—'}ms</div>
        </div>
        <div style="flex:1;padding:6px 8px;text-align:center">
          <div style="font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:2px">Sub-1s</div>
          <div style="font-size:12px;font-weight:600;color:${sub1sC}">${sub1sPct}%</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:9px;color:var(--muted);margin-bottom:5px">
        <span>Latency distribution</span>
        <span style="color:${sub1sC}">Under 1s: ${sub1sPct}%</span>
      </div>
      <div style="display:flex;height:9px;border-radius:4px;overflow:hidden;background:var(--border);margin-bottom:8px">
        ${barSegs||`<div style="width:100%;background:var(--border)"></div>`}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:9px;color:var(--muted);margin-bottom:10px;line-height:1.6">
        ${legend||'<span>No latency data</span>'}
      </div>
      <div style="font-size:10px;color:var(--blue);text-align:right;opacity:.8">Click to inspect events →</div>
    `;
    card.onclick=()=>showUCDetail(uc);
    grid.appendChild(card);
  });
}

// Named function — avoids closure/scope issues in onclick attributes
const UC_DESC={
  'App Control':'User controls device via mobile app over local Wi-Fi — App Tap → REST to Hub → SNAP device → WS push back to App',
  'Dock Control':'User presses physical dock button → signal traverses Thread mesh → Hub receives → SNAP device activates',
  'Remote App':'User controls device via mobile app over the Internet — same flow as App Control but routed remotely',
  'Automation':'Automated/scheduled trigger via direct Thread command — no user interaction, hub-initiated'
};

window.showUCDetail=function(uc){
  const hub=activeHub,v=D[hub]?.speed?.per_uc?.[uc];if(!v)return;
  const desc=UC_DESC[uc]||uc;
  const row=(l,val)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0;white-space:nowrap">${l}</td><td>${val}</td></tr>`;
  const lcOpts={hub,tab:'all',ucFilter:uc,context:{label:`${uc} — Events`,desc:`${hub.toUpperCase()} · P50: ${v.p50}ms · P95: ${v.p95}ms · ${v.count} total`}};
  const stddevC=v.stddev>500?'var(--red)':v.stddev>200?'var(--yellow)':'var(--green)';
  let body=`<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:var(--muted);line-height:1.6">
    <strong style="color:#e8edf5">${uc}</strong><br>${desc}
  </div>
  <table style="font-size:12px;margin-bottom:14px">
    ${row('Total Events',`<strong style="font-size:16px">${v.count}</strong>`)}
    ${row('Avg',v.avg+'ms')}
    ${row('P50 (median)',`<strong style="font-size:16px;color:#e8edf5">${v.p50}ms</strong>`)}
    ${row('P95',`<span style="color:${v.p95>1000?'var(--red)':v.p95>500?'var(--yellow)':'var(--green)'}">${v.p95}ms${v.p95>1000?' — CRITICAL':v.p95>500?' — WARNING':''}</span>`)}
    ${row('Std Dev',`<span style="color:${stddevC};font-weight:600">${v.stddev}ms</span><span style="font-size:10px;color:var(--muted);margin-left:8px">${v.stddev>500?'erratic':v.stddev>200?'moderate variability':'consistent'}</span>`)}
  </table>`;
  if(v.events&&v.events.length){
    body+=`<div class="dbg-section-hdr" style="margin-bottom:8px">
      <span class="dbg-section-title">Sample Events (${v.events.length} of ${v.count})</span>
      <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all ${uc} in Log Center →</button>
    </div>`+evTable(v.events,[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'lat',label:'Speed (ms)'},{key:'src',label:'Source'},{key:'room',label:'Room'}]);
  } else {
    body+=`<div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View ${uc} events in Log Center →</button></div>`;
  }
  showModal(uc+' — Speed Detail',body);
};

// ═══════════════════════════════════════════════════════════
//  SECTION 5 — RELIABILITY TAB
// ═══════════════════════════════════════════════════════════
window.toggleDockSort=function(){
  _dockSortAsc=!_dockSortAsc;
  const btn=document.getElementById('dockSortBtn');
  if(btn)btn.textContent=_dockSortAsc?'Fewest ▲':'Most ▼';
  _renderDockTable(_lastDockStats);
};

function _renderDockTable(dockStats){
  _lastDockStats=dockStats;
  const sorted=[...dockStats].sort((a,b)=>_dockSortAsc?(a.failure||0)-(b.failure||0):(b.failure||0)-(a.failure||0));
  const ddt=document.getElementById('dockDetailTable');
  if(!ddt)return;
  ddt.innerHTML='';
  if(sorted.length){
    sorted.forEach(ds=>{
      const rc2=relTag(ds.rel||0);
      const dkCount=(ds.docklets||[]).length;
      ddt.innerHTML+=`<tr class="clickable" onclick="showDockStatModal(${JSON.stringify(ds).replace(/"/g,'&quot;')})">
      <td style="font-family:monospace;font-size:11px">${ds.dock_id}</td><td>${ds.total}</td>
      <td style="color:var(--green)">${ds.success}</td>
      <td style="color:${ds.failure>0?'var(--red)':'inherit'};font-weight:${ds.failure>0?600:400}">${ds.failure}</td>
      <td><span class="tag ${rc2}">${ds.rel}%</span></td>
      <td style="font-size:10px;color:var(--muted)">${dkCount} docklet${dkCount!==1?'s':''}</td></tr>`;
    });
  } else {
    ddt.innerHTML='<tr><td colspan="6" style="color:var(--muted);font-size:11px;text-align:center;padding:14px">No dock data yet</td></tr>';
  }
}

function renderReliability(d){
  const r=d.reliability_detail;
  const dockStats=r.dock_stats||[];
  const dsTot=dockStats.reduce((s,dk)=>s+dk.total,0);
  const dsSucc=dockStats.reduce((s,dk)=>s+dk.success,0);
  const dockRel=dsTot>0?+(100*dsSucc/dsTot).toFixed(2):(r.dock_trigger_feedback||0);
  const relKPIEl=document.getElementById('relKPIs');
  if(relKPIEl)relKPIEl.style.gridTemplateColumns='repeat(2,1fr)';
  document.getElementById('relKPIs').innerHTML=`
    <div class="kpi" onclick="showRelModal('app_trigger')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">App Trigger → Feedback<button class="info-btn" onclick="event.stopPropagation();showInfo('rel_kpis')">ⓘ</button></div><div class="value" style="color:${relColor(r.app_trigger_feedback)}">${r.app_trigger_feedback}%</div><div class="formula-ref">= ${r.app_feedbacks||0} ÷ ${r.app_triggers||0}</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:3px"><span class="sub" style="margin:0">Click to debug</span>${tgtLine(r.app_trigger_feedback,TARGETS.appTrigger)}</div></div>
    <div class="kpi" onclick="showRelModal('dock_trigger')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Dock Trigger Reliability<button class="info-btn" onclick="event.stopPropagation();showInfo('rel_kpis')">ⓘ</button></div><div class="value" style="color:${relColor(dockRel)}">${dockRel}%</div><div class="formula-ref">${dsSucc} success · ${dsTot-dsSucc} failed of ${dsTot}</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:3px"><span class="sub" style="margin:0">Click for breakdown</span>${tgtLine(dockRel,TARGETS.dockRel)}</div></div>`;

  const srt=document.getElementById('srcRelTable');srt.innerHTML='';
  if(r.src_rel){Object.entries(r.src_rel).forEach(([src,v])=>{
    const rc=relTag(v.rel);const hasFails=v.fail>0;
    srt.innerHTML+=`<tr class="clickable" onclick="showSrcRelModal('${src}',${v.total},${v.success},${v.fail},${v.rel})">
      <td><strong>${src}</strong></td><td>${v.total}</td><td style="color:var(--green)">${v.success}</td>
      <td style="color:${hasFails?'var(--red)':'inherit'};font-weight:${hasFails?600:400}">${v.fail}</td>
      <td><span class="tag ${rc}">${v.rel}%</span></td>
      <td style="font-size:10px;color:var(--blue)">${hasFails?'View failures →':'No failures'}</td>
    </tr>`})}

  _renderDockTable(dockStats);

  const dates=d.daily.map(r=>r.date.slice(5));
  charts.relTrend=mc('relTrendChart',{type:'line',data:{labels:dates,datasets:[
    {label:'Reliability %',data:d.daily.map(r=>r.rel),borderColor:'#1fa355',tension:.3,pointRadius:3,fill:true,backgroundColor:'rgba(31,163,85,.06)'},
    {label:'Target 97%',data:dates.map(()=>97),borderColor:'rgba(220,232,248,.25)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,tension:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;
        const day=d.daily[els[0].index];
        openLogCenter({hub:activeHub,tab:'failures',filters:{search:day.date},context:{label:`Failures on ${day.date}`,desc:`${activeHub.toUpperCase()} · Reliability was ${day.rel}%`}});},
      plugins:{tooltip:{filter:function(item){return item.datasetIndex===0;},callbacks:{label:function(ctx){return 'Reliability: '+ctx.parsed.y.toFixed(2)+'%'}}}},
      scales:{y:{title:{display:true,text:'Reliability % (click to inspect failures)'},min:85,max:102},x:{title:{display:true,text:'Date'}}}}});

  const frt=document.getElementById('failReasonTable');frt.innerHTML='';
  if(d.fail_by_reason){Object.entries(d.fail_by_reason).sort((a,b)=>b[1].count-a[1].count).forEach(([reason,v])=>{
    frt.innerHTML+=`<tr class="clickable" onclick="showReasonModal('${reason}',${v.count})">
    <td><span class="tag tag-red">${reason}</span></td><td style="font-weight:600;color:var(--red)">${v.count}</td>
    <td style="color:var(--blue);font-size:10px">Inspect events →</td></tr>`})}

  const fdt=document.getElementById('failDevTable');
  const fdtHead=fdt.previousElementSibling;
  fdt.innerHTML='';
  if(d.fail_by_device){
    const reasonsArray = ['DEVICE_OFFLINE', 'NO_RESPONSE', 'THREAD_MESH_FAIL', 'TIMEOUT'];
    
    let thHTML = `<tr><th>Device</th><th>Count</th>`;
    reasonsArray.forEach(r => thHTML += `<th>${r}</th>`);
    thHTML += `<th>Action</th></tr>`;
    if(fdtHead) fdtHead.innerHTML = thHTML;

    Object.entries(d.fail_by_device).sort((a,b)=>b[1].count-a[1].count).forEach(([dev,v])=>{
      const reasonsStr=Object.entries(v.reasons).map(([r,c])=>`${r}:${c}`).join(', ');
      let tdHTML = `<tr class="clickable" onclick="showDevFailModal('${dev}',${v.count},'${reasonsStr}')">
      <td style="font-family:monospace;font-size:10px">${dev}</td>
      <td style="font-weight:600;color:var(--red)">${v.count}</td>`;
      reasonsArray.forEach(r => {
        const c = v.reasons[r] || 0;
        tdHTML += `<td style="font-size:10px;color:var(--muted)">${c > 0 ? c : '-'}</td>`;
      });
      tdHTML += `<td style="font-size:10px;color:var(--blue)">Inspect →</td></tr>`;
      fdt.innerHTML += tdHTML;
    });
  }

  const dat=document.getElementById('devActivityTable');if(dat){
    dat.innerHTML='';
    if(d.devices&&d.devices.length){
      d.devices.forEach(dev=>{
        const rc=relTag(dev.rel);
        const failC=Math.round(dev.total*(100-dev.rel)/100);
        const devShort=(dev.id||'').replace('light.snap_','').replace('switch.snap_','');
        dat.innerHTML+=`<tr class="clickable" onclick="showDevModal('${dev.id}','${dev.room}',${dev.total},${dev.rel},${dev.p50},${failC})">
          <td style="font-size:10px;font-family:monospace">${devShort}</td>
          <td style="font-size:11px">${dev.room}</td>
          <td>${dev.total}</td>
          <td><span class="tag ${rc}">${dev.rel}%</span></td>
          <td style="color:${dev.p50>800?'var(--yellow)':'inherit'}">${dev.p50}ms</td>
        </tr>`;
      });
    } else {
      dat.innerHTML='<tr><td colspan="5" style="color:var(--muted);font-size:11px;text-align:center;padding:14px">No device data yet</td></tr>';
    }
  }
}

window.showSrcRelModal=function(src,total,success,fail,rel){
  const hub=activeHub;
  const pred=srcPred(src);
  const fails=failuresFor(hub,pred);
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Source',`<strong>${src}</strong>`)}
    ${row('Total Events',`<strong style="font-size:16px">${total}</strong>`)}
    ${row('Successful',`<strong style="color:var(--green)">${success}</strong>`)}
    ${row('Failed',`<strong style="color:var(--red);font-size:16px">${fail}</strong>`)}
    ${row('Reliability',`<strong style="color:${relColor(rel)};font-size:16px">${rel}%</strong>`)}
  </table>`;
  if(fail>0){
    const lcOpts={hub,tab:'failures',srcFilter:src,context:{label:`Failures — ${src}`,desc:`${fail} failed events from ${src} on ${hub.toUpperCase()}`}};
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Failure Events for ${src} (${fails.length})</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all in Log Center →</button>
      </div>
      ${evTable(fails.slice(0,10),[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'reason',label:'Reason'},{key:'lat',label:'Speed'}])}
      ${fails.length>10?`<p style="font-size:10px;color:var(--muted);margin-top:6px">Showing 10 of ${fails.length}.</p>`:''}
    </div>`;
  } else {
    body+=`<div class="dbg-section"><div class="dbg-empty">No failures for this source.</div></div>`;
  }
  showModal(`${src} — Reliability Debug`,body);
};

window.showReasonModal=function(reason,count){
  const hub=activeHub;
  const v=D[hub].fail_by_reason?.[reason];
  const row=(l,val)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${val}</td></tr>`;
  const remediation={TIMEOUT:'Command reached hub but did not complete within time window. Check device firmware, SNAP responsiveness, and network congestion.',NO_RESPONSE:'Hub sent command but received no acknowledgement. Verify device is online and check Thread node connectivity.',DEVICE_OFFLINE:'Device was not reachable when command was issued. Check power state and Thread mesh coverage.',THREAD_MESH_FAIL:'Command failed at Thread mesh layer before reaching device. Check Thread border router and mesh node placement.'};
  const lcOpts={hub,tab:'failures',filters:{reason},context:{label:`${reason} Failures`,desc:`${count} events failed with this reason`}};
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Failure Reason',`<span class="tag tag-red">${reason}</span>`)}
    ${row('Occurrence Count',`<strong style="font-size:18px;color:var(--red)">${count}</strong>`)}
    ${row('Diagnosis',`<span style="font-size:11px;line-height:1.5">${remediation[reason]||'Unknown failure type.'}</span>`)}
  </table>`;
  if(v?.events?.length){
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Events with this failure (${v.events.length} samples)</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all in Log Center →</button>
      </div>
      ${evTable(v.events,[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'lat',label:'Speed'}])}
    </div>`;
  }
  showModal(`${reason} — Failure Analysis`,body);
};

window.showDevFailModal=function(dev,count,reasons){
  const hub=activeHub;
  const fails=failuresFor(hub,f=>f.dev===dev);
  const lcOpts={hub,tab:'failures',filters:{search:dev.replace('light.snap_','').replace('switch.snap_','')},context:{label:`Failures — ${dev}`,desc:`${count} failures on this device`}};
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Device',`<strong style="font-family:monospace">${dev}</strong>`)}
    ${row('Total Failures',`<strong style="font-size:18px;color:var(--red)">${count}</strong>`)}
    ${row('Failure Breakdown',reasons)}
  </table>
  <div class="dbg-section">
    <div class="dbg-section-hdr">
      <span class="dbg-section-title">Failure Events (${fails.length})</span>
      <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all in Log Center →</button>
    </div>
    ${evTable(fails.slice(0,10),[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'reason',label:'Reason'},{key:'lat',label:'Speed'}])}
    ${fails.length>10?`<p style="font-size:10px;color:var(--muted);margin-top:6px">Showing 10 of ${fails.length}.</p>`:''}
  </div>`;
  showModal(`Device Failures — ${dev.replace('light.snap_','').replace('switch.snap_','')}`,body);
};

window.showFailModal=function(idx){
  const hub=activeHub;
  const f=D[hub].failures[idx];if(!f)return;
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0;white-space:nowrap">${l}</td><td>${v}</td></tr>`;
  const remediation={TIMEOUT:'Command timed out.',NO_RESPONSE:'No response received.',DEVICE_OFFLINE:'Device was unreachable.',THREAD_MESH_FAIL:'Wireless mesh layer dropped the packet.'};
  const lcOpts={hub,tab:'failures',filters:{reason:f.reason},context:{label:`${f.reason} — Failure Detail`,desc:`Investigating similar failures on ${hub.toUpperCase()}`}};
  let body=`<div class="tp-fail-banner"><div class="tp-fail-reason">${f.reason}</div><div class="tp-fail-meta">${remediation[f.reason]||''}</div></div>
  <table style="font-size:12px;margin-bottom:4px">
    ${row('Timestamp',`<span style="font-family:monospace">${f.ts}</span>`)}
    ${row('Use Case',f.uc)}${row('Device',`<span style="font-family:monospace">${f.dev}</span>`)}
    ${row('Room',f.room)}${row('Source',f.src)}${row('Network',f.net||'—')}
    ${row('Speed',f.lat&&f.lat!=='N/A'?`<span style="color:var(--red);font-weight:600">${f.lat}ms</span>`:'N/A')}
    ${f.dock&&f.dock!=='—'?row('Dock',f.dock):''}
  </table>
  <div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all ${f.reason} failures in Log Center →</button></div>`;
  showModal('Failure Detail — '+f.reason,body);
};

function showRelModal(type){
  const r=D[activeHub].reliability_detail;const hub=activeHub;
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let title='',body='';

  if(type==='app_trigger'){
    title='App Trigger → Feedback — Debug';
    const fails=failuresFor(hub,f=>!(f.src||'').toLowerCase().includes('remote')&&(f.src||'').toLowerCase().includes('app'));
    const lcOpts={hub,tab:'failures',srcFilter:'App Control',context:{label:'App Trigger Failures',desc:`${r.app_triggers-r.app_feedbacks} failed app-initiated commands on ${hub.toUpperCase()}`}};
    body=`<table style="font-size:12px;margin-bottom:4px">
      ${row('Formula','App Feedbacks ÷ App Triggers')}
      ${row('App Triggers',`<strong style="font-size:16px">${r.app_triggers}</strong>`)}
      ${row('App Feedbacks',`<strong>${r.app_feedbacks}</strong>`)}
      ${row('Failed',`<strong style="color:var(--red)">${r.app_triggers-r.app_feedbacks}</strong>`)}
      ${row('Reliability',`<strong style="font-size:16px;color:${relColor(r.app_trigger_feedback)}">${r.app_trigger_feedback}%</strong>`)}
    </table>
    <div class="dbg-section"><div class="dbg-section-hdr">
      <span class="dbg-section-title">App Failure Events (${fails.length})</span>
      <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View in Log Center →</button>
    </div>${evTable(fails.slice(0,8),[{key:'ts',label:'Time'},{key:'uc',label:'UC'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'reason',label:'Reason'},{key:'lat',label:'Speed'}])}</div>`;

  } else if(type==='dock_trigger'){
    title='Dock Trigger Reliability — Debug';
    const dockStats=r.dock_stats||[];
    const dsTot=dockStats.reduce((s,dk)=>s+dk.total,0);
    const dsSucc=dockStats.reduce((s,dk)=>s+dk.success,0);
    const dsFail=dockStats.reduce((s,dk)=>s+dk.failure,0);
    const dockRel=dsTot>0?+(100*dsSucc/dsTot).toFixed(2):0;
    body=`<table style="font-size:12px;margin-bottom:4px">
      ${row('Total Dock Actions',`<strong style="font-size:16px">${dsTot||'No data yet'}</strong>`)}
      ${dsTot?row('Successful',`<strong style="color:var(--green)">${dsSucc}</strong>`):''}
      ${dsTot?row('Failed',`<strong style="color:var(--red);font-size:16px">${dsFail}</strong>`):''}
      ${dsTot?row('Reliability',`<strong style="font-size:16px;color:${relColor(dockRel)}">${dockRel}%</strong>`):''}
    </table>
    ${dockStats.length?`<div class="dbg-section">
      <div class="dbg-section-hdr"><span class="dbg-section-title">Per Dock Breakdown (${dockStats.length} dock${dockStats.length!==1?'s':''})</span></div>
      <table style="font-size:11px"><thead><tr><th>Dock</th><th>Total</th><th>Success</th><th>Failed</th><th>Reliability</th></tr></thead><tbody>
      ${dockStats.map(ds=>`<tr class="clickable" onclick="closeModal();setTimeout(()=>showDockStatModal(${JSON.stringify(ds).replace(/"/g,'&quot;')}),50)">
        <td style="font-family:monospace;font-size:10px">${ds.dock_id}</td>
        <td>${ds.total}</td><td style="color:var(--green)">${ds.success}</td>
        <td style="color:${ds.failure>0?'var(--red)':'inherit'}">${ds.failure}</td>
        <td><span class="tag ${relTag(ds.rel||0)}">${ds.rel}%</span></td></tr>`).join('')}
      </tbody></table></div>`:'<div class="dbg-section"><p style="font-size:11px;color:var(--muted);padding:8px 0">Dock data will appear here once dock logs are connected.</p></div>'}`;

  }
  showModal(title,body);
}

function showDockStatModal(ds){
  if(!ds)return;
  const relPct=ds.rel!=null?ds.rel:(ds.total>0?+(100*ds.success/ds.total).toFixed(2):0);
  const rc=relColor(relPct);
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  const docklets=ds.docklets||[];
  let dockletHtml='';
  if(docklets.length){
    dockletHtml=`<div class="dbg-section"><div class="dbg-section-hdr"><span class="dbg-section-title">Docklet Breakdown (${docklets.length} docklet${docklets.length!==1?'s':''})</span></div>
    <table style="font-size:11px;width:100%"><thead><tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:5px 8px">Docklet ID</th><th>Total</th><th>Success</th><th>Fail</th><th>Reliability</th>
    </tr></thead><tbody>
    ${docklets.map(dk=>{const dkrc=relTag(dk.rel||0);return`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:5px 8px;font-family:monospace;font-size:10px">${dk.docklet_id}</td>
      <td style="text-align:center;padding:5px 8px">${dk.total}</td>
      <td style="text-align:center;padding:5px 8px;color:var(--green)">${dk.success}</td>
      <td style="text-align:center;padding:5px 8px;color:${dk.failure>0?'var(--red)':'inherit'}">${dk.failure}</td>
      <td style="text-align:center;padding:5px 8px"><span class="tag ${dkrc}">${dk.rel||0}%</span></td>
    </tr>`;}).join('')}
    </tbody></table></div>`;
  }
  showModal(`Dock: ${ds.dock_id}`,`<table style="font-size:12px;margin-bottom:4px">
    ${row('Dock ID',`<strong style="font-family:monospace;font-size:13px">${ds.dock_id}</strong>`)}
    ${row('Total Actions',`<strong style="font-size:16px">${ds.total||'No data'}</strong>`)}
    ${ds.total?row('Successful',`<strong style="color:var(--green)">${ds.success}</strong>`):''}
    ${ds.total?row('Failed',`<strong style="color:var(--red);font-size:16px">${ds.failure}</strong>`):''}
    ${ds.total?row('Reliability',`<strong style="color:${rc};font-size:16px">${relPct}%</strong>`):''}
  </table>${dockletHtml}
  ${!docklets.length?'<p style="font-size:11px;color:var(--muted);padding:4px 0">No per-docklet breakdown available for this dock.</p>':''}`);
}

// ═══════════════════════════════════════════════════════════
//  SECTION 6 — USAGE TAB
// ═══════════════════════════════════════════════════════════
function renderUsage(d){
  const u=d.usage||{app:0,remote:0,docklet:0,direct:0,app_ratio:0,dock_ratio:0,scene_per_day:0};
  const hTotal=(u.app||0)+(u.docklet||0);
  document.getElementById('usageKPIs').innerHTML=`
    <div class="kpi" onclick="showUsageModal('auto')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Automation / Day<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_auto')">ⓘ</button></div><div class="value">${u.scene_per_day||0}</div><div class="formula-ref">= ${u.direct||0} ÷ ${activeDaysCount()} days</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="showUsageModal('app')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">App Usage Ratio<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_app')">ⓘ</button></div><div class="value">${u.app_ratio||0}%</div><div class="formula-ref">= ${u.app||0} ÷ ${hTotal}</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="showUsageModal('dock')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Dock Usage Ratio<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_dock')">ⓘ</button></div><div class="value">${u.dock_ratio||0}%</div><div class="formula-ref">= ${u.docklet||0} ÷ ${hTotal}</div><div class="sub">Click for breakdown</div></div>`;
  const srcLabels=['App (Local)','Remote App','Dock Control','Automation'];
  charts.src=mc('srcChart',{type:'doughnut',data:{labels:srcLabels,datasets:[{data:[u.app||0,u.remote||0,u.docklet||0,u.direct||0],backgroundColor:['#3d82f0','#7a5dcf','#1fa355','#d4961f'],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      onClick:(e,els)=>{if(!els.length)return;
        const src=srcLabels[els[0].index];
        openLogCenter({hub:activeHub,tab:'all',srcFilter:src,context:{label:`${src} Events`,desc:`${activeHub.toUpperCase()} · all events from this source`}});},
      plugins:{legend:{position:'bottom',labels:{font:{size:10}}}}}});

  // Dock usage panel — populated when dock_table is connected
  const dockUsageEl=document.getElementById('dockUsagePanel');
  if(dockUsageEl){
    const du=d.dock_usage||{};
    const dockStats=(d.reliability_detail||{}).dock_stats||[];
    if(dockStats.length){
      const totalDockActions=dockStats.reduce((s,dk)=>s+dk.total,0);
      const uniqueDockCount=new Set(dockStats.map(ds=>ds.dock_id)).size;
      dockUsageEl.style.display='';
      dockUsageEl.innerHTML=`<h3 style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 10px;display:flex;justify-content:space-between;align-items:center">Dock Usage<button class="info-btn" onclick="event.stopPropagation();showInfo('dock_usage')">ⓘ</button></h3>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">
        <div class="kpi" style="flex:1;min-width:120px"><div class="label">Total Actions</div><div class="value">${totalDockActions}</div></div>
        <div class="kpi" style="flex:1;min-width:120px"><div class="label">Active Docks</div><div class="value">${uniqueDockCount}</div></div>
        <div class="kpi" style="flex:1;min-width:120px"><div class="label">Active Docklets</div><div class="value">${dockStats.reduce((s,dk)=>s+(dk.docklets||[]).length,0)}</div></div>
      </div>
      <table style="font-size:11px;width:100%"><thead><tr>
        <th style="text-align:left;padding:4px 8px">Dock</th><th>Total</th><th>Success</th><th>Fail</th><th>Reliability</th>
      </tr></thead><tbody>
      ${dockStats.map(ds=>`<tr class="clickable" onclick="showDockStatModal(${JSON.stringify(ds).replace(/"/g,'&quot;')})">
        <td style="font-family:monospace;font-size:10px;padding:4px 8px">${ds.dock_id}</td>
        <td style="text-align:center">${ds.total}</td>
        <td style="text-align:center;color:var(--green)">${ds.success}</td>
        <td style="text-align:center;color:${ds.failure>0?'var(--red)':'inherit'}">${ds.failure}</td>
        <td style="text-align:center"><span class="tag ${relTag(ds.rel||0)}">${ds.rel}%</span></td>
      </tr>`).join('')}
      </tbody></table>`;
    } else {
      dockUsageEl.style.display='';
      dockUsageEl.innerHTML=`<h3 style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 8px;display:flex;justify-content:space-between;align-items:center">Dock Usage<button class="info-btn" onclick="event.stopPropagation();showInfo('dock_usage')">ⓘ</button></h3>
      <p style="font-size:11px;color:var(--muted)">Dock usage data will appear here once dock logs are connected.</p>`;
    }
  }
}

window.showDevModal=function(id,room,total,rel,p50,fail){
  const hub=activeHub;
  const fails=failuresFor(hub,f=>f.dev===id);
  const lcOpts={hub,tab:'failures',filters:{search:id.replace('light.snap_','').replace('switch.snap_','')},context:{label:`Device Failures — ${id}`,desc:`${fail} failures`}};
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0">${l}</td><td>${v}</td></tr>`;
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Device',`<strong style="font-family:monospace">${id}</strong>`)}${row('Room',room)}
    ${row('Total Events',total)}${row('Reliability',`<strong style="color:${relColor(rel)};font-size:16px">${rel}%</strong>`)}
    ${row('P50 Speed',`<span style="color:${p50>800?'var(--yellow)':'#e8edf5'}">${p50}ms</span>`)}
    ${row('Failures',`<strong style="color:var(--red);font-size:16px">${fail}</strong>`)}
  </table>`;
  if(fail>0){
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Failure Events (${fails.length})</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View in Log Center →</button>
      </div>
      ${evTable(fails.slice(0,8),[{key:'ts',label:'Time'},{key:'uc',label:'UC'},{key:'src',label:'Source'},{key:'reason',label:'Reason'},{key:'lat',label:'Speed'}])}
    </div>`;
  } else {
    body+=`<div class="dbg-section"><div class="dbg-empty">No failures recorded for this device.</div></div>`;
  }
  showModal(id,body);
};

window.showUsageModal=function(type){
  const hub=activeHub,d=D[hub];
  const u=d.usage||{};
  const app=u.app||0,docklet=u.docklet||0,remote=u.remote||0,direct=u.direct||0;
  const total=app+docklet+remote+direct,hTotal=app+docklet;
  const app_ratio=u.app_ratio||0,dock_ratio=u.dock_ratio||0,scene_per_day=u.scene_per_day||0;
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let title='',body='',lcOpts=null;
  if(type==='auto'){
    title='Automation / Day';
    lcOpts={hub,tab:'all',srcFilter:'Automation',context:{label:'Automation Events',desc:`${hub.toUpperCase()} · ${direct} automation triggers · 30-day window`}};
    body=`<table style="font-size:12px">${row('Formula','Automation Events ÷ 30 days')}${row('Total Automation',`<strong style="font-size:16px">${direct}</strong>`)}${row('Per Day',`<strong>${scene_per_day}</strong>`)}${row('% of All Events',total>0?`${(direct/total*100).toFixed(1)}%`:'0%')}</table>`;
  } else if(type==='app'){
    title='App Usage Ratio';
    lcOpts={hub,tab:'all',srcFilter:'App Control',context:{label:'App (Local) Events',desc:`${hub.toUpperCase()} · ${app} local app events · 30-day window`}};
    body=`<table style="font-size:12px">${row('Formula','App ÷ (App + Dock)')}${row('App Events',`<strong style="font-size:16px;color:var(--blue)">${app}</strong>`)}${row('Dock Events',docklet)}${row('Ratio',`<strong style="font-size:16px;color:var(--blue)">${app_ratio}%</strong>`)}</table>`;
  } else {
    title='Dock Usage Ratio';
    lcOpts={hub,tab:'all',srcFilter:'Dock Control',context:{label:'Dock Control Events',desc:`${hub.toUpperCase()} · ${docklet} dock events · 30-day window`}};
    body=`<table style="font-size:12px">${row('Formula','Dock ÷ (App + Dock)')}${row('Dock Events',`<strong style="font-size:16px;color:var(--green)">${docklet}</strong>`)}${row('App Events',app)}${row('Ratio',`<strong style="font-size:16px;color:var(--green)">${dock_ratio}%</strong>`)}</table>`;
  }
  body+=`<div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View ${title} in Log Center →</button></div>`;
  showModal(title,body);
};

// ═══════════════════════════════════════════════════════════
//  SECTION 7 — FLEET MODALS
// ═══════════════════════════════════════════════════════════
function showFleetModal(type){
  const hubs=Object.keys(D);
  let fTotal=0,fSuccess=0,fFail=0,fLatencies=[],fNS=[];
  hubs.forEach(h=>{const d=D[h];fTotal+=d.total;fSuccess+=d.success;fFail+=d.total-d.success;
    fLatencies.push({hub:h,p50:d.speed.local_e2e.p50});
    if(d.daily)d.daily.forEach(dy=>{if(dy.ns!==undefined)fNS.push(dy.ns)})});
  const fRel=fTotal>0?((fSuccess/fTotal)*100).toFixed(2):0;
  const fP50=Math.round(fLatencies.reduce((a,b)=>a+b.p50,0)/fLatencies.length);
  const fNSavg=fNS.length>0?(fNS.reduce((a,b)=>a+b,0)/fNS.length).toFixed(1):0;
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;

  let title='',body='';
  if(type==='reliability'){
    title='Fleet Reliability — Debug View';
    body=`<table style="font-size:12px;margin-bottom:4px">
      ${row('Formula','Σ Successful ÷ Σ Total (All Hubs)')}
      ${row('Total Events',`<strong style="font-size:16px">${fTotal.toLocaleString()}</strong>`)}
      ${row('Successful',`<strong style="color:var(--green)">${fSuccess.toLocaleString()}</strong>`)}
      ${row('Failed',`<strong style="color:var(--red);font-size:16px">${fFail.toLocaleString()}</strong>`)}
      ${row('Fleet Reliability',`<strong style="font-size:16px;color:${relColor(fRel)}">${fRel}%</strong>`)}
    </table>
    <div class="dbg-section"><div class="dbg-section-hdr"><span class="dbg-section-title">Per Hub Breakdown</span></div>
    <table style="font-size:11px"><thead><tr><th>Hub</th><th>Reliability</th><th>Failures</th><th>Action</th></tr></thead><tbody>
    ${hubs.map(h=>{const d=D[h],f=d.total-d.success;const tag=relTag(d.reliability);
      return`<tr><td><strong>${h.toUpperCase()}</strong></td>
        <td><span class="tag ${tag}">${d.reliability}%</span></td>
        <td style="color:${f>0?'var(--red)':'var(--green)'}">${f}</td>
        <td><button class="dbg-lc-link" onclick="closeModal();openLogCenter({hub:'${h}',tab:'failures',context:{label:'${h.toUpperCase()} Failures',desc:'${f} total failures'}})">Inspect →</button></td></tr>`;
    }).join('')}
    </tbody></table></div>
    <div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter({tab:'failures',context:{label:'All Fleet Failures',desc:'${fFail} failures across all hubs'}})">View All Fleet Failures →</button></div>`;

  } else if(type==='latency'){
    title='Fleet P50 Speed — Debug View';
    body=`<table style="font-size:12px;margin-bottom:4px">
      ${row('Fleet Avg P50',`<strong style="font-size:18px">${fP50}ms</strong>`)}
    </table>
    <div class="dbg-section"><div class="dbg-section-hdr"><span class="dbg-section-title">Per Hub Speed</span></div>
    <table style="font-size:11px"><thead><tr><th>Hub</th><th>P50</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${fLatencies.map(l=>{const isSlow=l.p50>800;
      return`<tr><td><strong>${l.hub.toUpperCase()}</strong></td>
        <td style="font-weight:600;color:${isSlow?'var(--yellow)':'#e8edf5'}">${l.p50}ms</td>
        <td><span class="tag ${isSlow?'tag-yellow':'tag-green'}">${isSlow?'Slow':'OK'}</span></td>
        <td>${isSlow?`<button class="dbg-lc-link" onclick="closeModal();openLogCenter({hub:'${l.hub}',tab:'slow',context:{label:'${l.hub.toUpperCase()} Slow Events',desc:'P50: ${l.p50}ms'}})">Inspect →</button>`:'—'}</td></tr>`;
    }).join('')}
    </tbody></table></div>`;

  } else if(type==='northstar'){
    title='Fleet North Star — Sub-1s Rate';
    const nsGap=(85-parseFloat(fNSavg)).toFixed(1);
    body=`<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px 16px;margin-bottom:14px"><div style="font-size:11px;color:var(--muted);line-height:1.7"><strong style="color:#e8edf5">What is North Star?</strong><br>The percentage of all device control events completed end-to-end in under 1 second. This is the single most user-facing quality metric — anything over 1s feels like lag to the user. Target: ≥ 85%.</div><div style="font-size:10px;font-family:monospace;background:var(--surface2);border:1px solid var(--border2);padding:8px 12px;border-radius:4px;color:var(--blue);margin-top:10px">NS = ROUND(100 × COUNT(latency_ms &lt; 1000) / NULLIF(COUNT(latency_ms IS NOT NULL), 0), 2)</div></div>
    <table style="font-size:12px;margin-bottom:14px">
      ${row('Fleet North Star',`<strong style="font-size:20px;color:${fNSavg>85?'var(--green)':fNSavg>70?'var(--yellow)':'var(--red)'}">${fNSavg}%</strong>`)}
      ${row('Target','<strong style="color:var(--green)">≥ 85%</strong>')}
      ${row('Status',parseFloat(fNSavg)>=85?'<span class="tag tag-green">On Target</span>':`<span class="tag tag-red">Below Target — ${nsGap}% gap</span>`)}
      ${row('Period',`<span style="font-size:11px">${activePeriodLabel()}</span>`)}
    </table>
    <div class="dbg-section"><div class="dbg-section-hdr"><span class="dbg-section-title">Per Hub North Star</span></div>
    <table style="font-size:11px"><thead><tr><th>Hub</th><th>NS Avg</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${hubs.map(h=>{const d=D[h];const nsA=d.daily?((d.daily.reduce((s,dy)=>s+(dy.ns||0),0))/d.daily.length).toFixed(1):'—';const isBad=parseFloat(nsA)<85;
      return`<tr><td><strong>${h.toUpperCase()}</strong></td>
        <td style="font-weight:600;color:${isBad?'var(--red)':'var(--green)'}">${nsA}%</td>
        <td><span class="tag ${isBad?'tag-red':'tag-green'}">${isBad?'Below Target':'On Target'}</span></td>
        <td>${isBad?`<button class="dbg-lc-link" onclick="closeModal();openLogCenter({hub:'${h}',tab:'slow',context:{label:'${h.toUpperCase()} Slow Events',desc:'North Star at ${nsA}%'}})">Inspect →</button>`:`<button class="dbg-lc-link" onclick="closeModal();showHubNSModal('${h}')">Drill-down →</button>`}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter({tab:'slow',context:{label:'All Fleet Slow Events',desc:'Events exceeding 800ms across all hubs'}})">View All Slow Events →</button></div>`;
  }
  showModal(title,body);
}

window.showHubNSModal=function(hub){
  const d=D[hub];if(!d)return;
  const nsAvg=d.daily&&d.daily.length?(d.daily.reduce((s,dy)=>s+(dy.ns||0),0)/d.daily.length).toFixed(1):0;
  const nsC=parseFloat(nsAvg)>=85?'var(--green)':parseFloat(nsAvg)>=70?'var(--yellow)':'var(--red)';
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  const recentDays=[...(d.daily||[])].reverse().slice(0,14);
  const dayRows=recentDays.map(dy=>{
    const c=(dy.ns||0)>=85?'var(--green)':(dy.ns||0)>=70?'var(--yellow)':'var(--red)';
    const isBad=(dy.ns||0)<85;
    return`<tr><td style="font-family:monospace;font-size:10px;color:var(--muted)">${dy.date}</td><td style="font-weight:600;color:${c}">${(dy.ns||0).toFixed(1)}%</td><td style="color:var(--muted)">${dy.total}</td><td>${isBad?`<button class="dbg-lc-link" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'slow',filters:{search:'${dy.date}'},context:{label:'Slow Events ${dy.date}',desc:'NS was ${(dy.ns||0).toFixed(1)}%'}})">Inspect &rarr;</button>`:'—'}</td></tr>`;
  }).join('');
  const lcSlow={hub,tab:'slow',context:{label:`${hub.toUpperCase()} — Slow Events`,desc:`North Star at ${nsAvg}% · target ≥85%`}};
  const body=`<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px 16px;margin-bottom:14px"><div style="font-size:11px;color:var(--muted);line-height:1.7"><strong style="color:#e8edf5">What is North Star?</strong><br>The percentage of all device control events completed end-to-end in under 1 second. This is the single most user-facing quality metric — anything over 1s feels like lag to the user.</div><div style="font-size:10px;font-family:monospace;background:var(--surface2);border:1px solid var(--border2);padding:8px 12px;border-radius:4px;color:var(--blue);margin-top:10px">NS = ROUND(100 &times; COUNT(latency_ms &lt; 1000) / NULLIF(COUNT(latency_ms IS NOT NULL), 0), 2)</div></div>
  <table style="font-size:12px;margin-bottom:14px">${row('Hub',`<strong>${hub.toUpperCase()}</strong>`)}${row('Period Average',`<strong style="font-size:20px;color:${nsC}">${nsAvg}%</strong>`)}${row('Target','<strong style="color:var(--green)">≥85%</strong>')}${row('Status',parseFloat(nsAvg)>=85?'<span class="tag tag-green">On Target</span>':`<span class="tag tag-red">Below Target — ${(85-parseFloat(nsAvg)).toFixed(1)}% gap</span>`)}${row('Period',activePeriodLabel())}</table>
  <div class="dbg-section"><div class="dbg-section-hdr"><span class="dbg-section-title">Daily Trend — last ${recentDays.length} days (most recent first)</span></div>
  <table style="font-size:11px"><thead><tr><th>Date</th><th>NS %</th><th>Total Events</th><th>Action</th></tr></thead><tbody>${dayRows}</tbody></table></div>
  ${lcBtn(lcSlow,'View All Slow Events in Log Center →')}`;
  showModal(`${hub.toUpperCase()} — North Star Drill-down`,body);
};

window.showInfo=function(key){
  const INFO={
    fleet_total:{title:'Total Fleet Events',body:'The total number of device control commands sent across all your hubs in the last 30 days. Every time someone taps to turn a light on or off — or a dock button is pressed — that counts as one event.'},
    fleet_reliability:{title:'Fleet Reliability',body:'Out of all commands sent across every hub, what percentage actually worked? 100% = every command succeeded. Anything below 97% means some lights aren\'t responding as expected. Click the card to see which specific hubs are pulling this number down.'},
    fleet_latency:{title:'Average P50 Latency',body:'"P50" means the median — half of all commands finished faster than this number, half were slower. Under 500ms feels near-instant to the user. Over 800ms starts to feel noticeably sluggish. This is the average P50 across all your hubs.'},
    fleet_northstar:{title:'North Star — Sub-1s Rate',body:'What percentage of all commands completed in under 1 second? This is the single most user-facing quality metric — anything over 1s is perceptible lag. A healthy system should stay at 85% or above.'},
    hub_total:{title:'Total Events',body:'All device commands sent through this specific hub in the last 30 days — from the app, dock buttons, remote access, and automations combined.'},
    hub_reliability:{title:'Reliability',body:'The percentage of commands on this hub that completed successfully. Click to jump to the Reliability tab for a full breakdown by control source, failure reason, and per-device failure count.'},
    hub_latency:{title:'P50 Latency',body:'The median response time for commands through this hub. Half of all commands were faster than this number. Click to jump to the Speed tab, which breaks down latency by each stage of the request pipeline.'},
    hub_failures:{title:'Failures',body:'The number of commands that failed to complete on this hub in the last 30 days. Click to open the Log Center pre-filtered to this hub\'s failures for event-level investigation.'},
    daily_chart:{title:'Daily Events & Reliability',body:'A day-by-day view of two things at once:\n\n• Blue bars = how many commands were sent that day (activity volume)\n• Green line = what percentage succeeded (reliability)\n\nA dip in the green line on a specific day means more commands were failing. Click any bar to investigate what happened on that day.'},
    ns_chart:{title:'North Star — Sub-1s Rate',body:'Each point shows what percentage of commands on that day finished in under 1 second. A healthy system stays above 85% consistently. Drops usually indicate network congestion, a device issue, or Thread mesh instability. Click any point to see the slow events from that day.'},
    heatmap:{title:'Activity Heatmap',body:'Shows when devices are controlled most — rows are days of the week, columns are hours of the day (0–23). Darker blue means more activity in that slot.\n\nUseful for spotting patterns like "most control happens on weekday evenings at 7–9pm." Hover any cell for a source breakdown (app vs dock vs remote vs auto). Click any cell to inspect those specific events in the Log Center.'},
    speed_segments:{title:'Speed Segments',body:'Breaks down where time is actually spent when a command is sent. There are 4 stages:\n\n• Hub→SNAP→Hub: How long for the hub to command the physical device and get state confirmed back\n• Hub→App: How long for the hub to push the new state to the phone via WebSocket\n• Local E2E: Full round trip when the user is on the same Wi-Fi as the hub\n• Remote E2E: Full round trip when controlling from outside the home\n\nClick any row for event-level detail.'},
    lat_dist:{title:'Latency Distribution',body:'How many commands fell into each speed bucket:\n\n• Green (under 500ms): Fast — feels instant\n• Green (500–800ms): Acceptable\n• Yellow (800ms–1s): Getting slow\n• Red (over 1s): Noticeably sluggish\n\nA healthy system has the vast majority of events in the fast buckets. Click any bar to see the actual events in that range.'},
    uc_lat:{title:'Latency by Use Case',body:'Compares speed across the different ways devices can be controlled:\n\n• App Control: User tapped the phone app on local Wi-Fi\n• Dock Control: Physical dock button was pressed\n• Remote App: User controlled from outside the home\n• Automation: Triggered automatically by a schedule or rule\n\nShows Avg, P50 (typical), and P95 (worst-case). Useful for spotting if one control method is consistently slower.'},
    uc_table:{title:'Per Use Case Speed',body:'Detailed latency numbers for each control method. The most important column is P95 — it represents the slowest 5% of commands, your worst-case user experience. P95 above 1 second is flagged as Critical and should be investigated. Click any row for event-level detail.'},
    uc_speed_metrics:{title:'Speed Metrics Explained',body:'Every use-case card shows four numbers:\n\n• Avg — The simple average of all command times. Easy to read but one very slow event can pull it up and make things look worse than they are.\n\n• P50 (Median) — Sort all command times; P50 is the middle value. Half finished faster, half slower. This is what a typical user actually experiences day-to-day.\n\n• P95 — 95% of commands finished faster than this number. Only the slowest 5% were slower. This is your worst-case experience — if P95 is under 1000ms, even your slowest users are getting a decent experience.\n\n• Std Dev (Standard Deviation) — Measures how consistent the times are. A low number means most commands take a similar amount of time (predictable). A high number means some are fast and some are very slow (erratic). Green under 200ms · Yellow 200–500ms · Red above 500ms.'},
    rel_kpis:{title:'Reliability KPIs',body:'Two ways of measuring how reliably commands are confirmed:\n\n• App Trigger Feedback: When a user taps in the app, does the app receive confirmation that the command worked? This is the most direct measure of app-facing reliability.\n• Dock Trigger Reliability: When a physical dock button is pressed, does the command succeed? This comes from the physical dock hardware logs.\n\nClick either card to debug failures for that source.'},
    src_rel:{title:'Per-Source Reliability',body:'Reliability broken down by how the device was controlled — App, Remote App, Dock Control, or Automation. Lets you pinpoint whether one control method is failing more than others.\n\nIf App Control is 99% but Dock Control is 85%, the issue is specific to dock hardware or Thread mesh coverage near those docks. Click any row to see its failure events.'},
    rel_trend:{title:'Reliability Trend',body:'How reliability changed over the past 30 days. A sustained drop indicates a persistent problem. A one-day spike usually points to a temporary event like a power outage or network hiccup.\n\nClick any point to jump directly to the Log Center filtered to that day\'s failures.'},
    dock_rel:{title:'Dock Reliability',body:'Reliability per physical dock device. Each row shows one dock — how many button presses succeeded versus failed. If a specific dock has low reliability, it may have a Thread mesh coverage issue or a hardware fault.\n\nClick any row to see a per-action breakdown (which specific button assignments are failing).'},
    fail_reason:{title:'Failures by Reason',body:'Groups all failures by what went wrong:\n\n• TIMEOUT: Command reached the hub but the device didn\'t respond in time\n• DEVICE_OFFLINE: Device wasn\'t reachable when the command was sent\n• NO_RESPONSE: Hub got no acknowledgement from the device\n• THREAD_MESH_FAIL: The wireless mesh dropped the packet before reaching the device\n\nClick any reason to see which devices and rooms are affected.'},
    fail_device:{title:'Failures by Device',body:'Which individual lights or switches are failing the most. If one device appears here consistently, it likely needs attention — check Thread mesh coverage near it, verify the device is powered, or check if a firmware update is available.\n\nClick any row to inspect the failure events for that specific device.'},
    usage_auto:{title:'Automation / Day',body:'How many automated or scheduled events happen per day on average. These are commands triggered without any user tapping — schedules, scenes, or rules set up in Home Assistant.\n\nA rising number here means the system is doing more work automatically, which is generally good.'},
    usage_app:{title:'App Usage Ratio',body:'Of all manual controls (app + dock combined), what percentage came from someone tapping the phone app? A high app ratio means users prefer the app over physical dock buttons.\n\nUseful for understanding how the system is actually being used day-to-day and whether dock hardware is being adopted.'},
    usage_dock:{title:'Dock Usage Ratio',body:'Of all manual controls (app + dock combined), what percentage came from pressing a physical dock button? A high dock ratio means users find the physical interface more natural or convenient than the app.'},
    src_chart:{title:'Source Breakdown',body:'A visual split of all events by how they were triggered:\n\n• App (Local): User tapped the phone app on the same Wi-Fi\n• Remote App: User tapped the app from outside the home\n• Dock Control: Physical dock button was pressed\n• Automation: Triggered automatically by a schedule or rule\n\nClick any segment to see those specific events in the Log Center.'},
    dock_usage:{title:'Dock Usage',body:'A summary of physical dock button activity:\n\n• Total Actions: All button presses across all docks in this period\n• Active Docks: How many unique dock devices have been used\n• Active Docklets: How many individual button assignments have been pressed\n\nThe table below shows per-docklet success and failure counts — useful for spotting a specific button that isn\'t working reliably. Click any row for a full action breakdown.'},
    dev_activity:{title:'Device Activity',body:'A ranked list of every device (light or switch) controlled through this hub, sorted by most-used first. Shows:\n\n• Device: The entity ID (short name) of the device\n• Room: Which room it\'s in\n• Events: Total commands sent to this device in the 30-day window\n• Reliability: What percentage of commands on this device succeeded\n• P50: The median response time for this specific device\n\nClick any row to see the full stats for that device including its failure events.'},
    log_center:{title:'Log Center',body:'A detailed event-level workspace for debugging. Every command event appears here with its timestamp, device, room, control method, latency, and failure reason.\n\nHow to use it:\n• Failures tab: Shows only failed commands — start here when investigating an issue\n• Slow Events tab: Shows commands that took over 800ms\n• All Events tab: Every event in the 30-day window\n• Source / Reason filters: Narrow down to a specific control method or failure type\n• Search box: Filter by device name, room, or date\n• Click any row: Expands a visual timing pipeline showing exactly where time was spent in that specific command'}
  };
  const item=INFO[key];if(!item)return;
  const bodyHtml=item.body.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>').replace(/•/g,'<span style="color:var(--blue);margin-right:2px">•</span>');
  showModal(item.title,`<div style="font-size:12px;color:var(--muted);line-height:1.9">${bodyHtml}</div>`);
};

window.onload=async()=>{
  _defaultDates();
  const drFrom=document.getElementById('drFrom'),drTo=document.getElementById('drTo');
  if(drFrom)drFrom.value=activeFrom;if(drTo)drTo.value=activeTo;
  const lbl=document.getElementById('headerPeriodLabel');if(lbl)lbl.textContent=activePeriodLabel();

  // Show landing shell immediately — user sees the page layout right away
  document.getElementById('landingView').style.display='block';
  document.getElementById('detailView').style.display='none';
  document.getElementById('logCenterView').style.display='none';

  const s=document.getElementById('drStatus');
  if(s){s.textContent='Connecting…';s.style.color='var(--blue)';}

  // Hub list is fast (no BigQuery)
  const{hubs}=await fetch('/api/hubs').then(r=>r.json());
  document.getElementById('hubCount').textContent=hubs.length;

  // Skeleton cards with hub IDs so user sees something immediately
  const grid=document.getElementById('hubCardsGrid');
  grid.innerHTML=hubs.map(h=>`
    <div class="hub-grid-card" style="opacity:.45">
      <div class="hgc-header">
        <div class="hgc-name"><span class="hgc-dot" style="background:var(--muted)"></span>${h.toUpperCase()}</div>
        <span style="font-size:10px;color:var(--muted)">Loading…</span>
      </div>
      <div style="padding:10px 0 6px;color:var(--muted);font-size:11px">Fetching analytics data…</div>
    </div>`).join('');

  // Fetch all hubs in parallel with progress counter
  let loaded=0;
  if(s)s.textContent=`Loading 0/${hubs.length}…`;
  await Promise.all(hubs.map(async h=>{
    D[h]=await fetch(`/api/hub/${h}?from_date=${activeFrom}&to_date=${activeTo}`).then(r=>r.json());
    loaded++;
    if(s)s.textContent=loaded<hubs.length?`Loading ${loaded}/${hubs.length}…`:'';
  }));

  if(s)s.textContent='';
  renderLanding();
};
