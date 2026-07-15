// ═══════════════════════════════════════════════════════════
//  SCHNELL FLEET DEBUGGING DASHBOARD
// ═══════════════════════════════════════════════════════════
const D={};
let charts={},activeHub=null,_dockSortAsc=false,_lastDockStats=[],activeFrom='',activeTo='';

// ── Matter Server UI (Node list + Thread mesh) — hardcoded connection ─────────
// The Node / Thread tabs embed (or link to) the Matter server's own dashboard.
// base   : where the Matter dashboard is served (matter server serves it on :5580)
// ip     : value the Matter UI logs in with (HA :8123 → converted to :5580/ws)
// user   : Matter UI username (its login does not validate the password)
// The trimmed Matter Node/Thread UI is BUILT into this project and served by the
// analytics app at /matter (see matter-ui/ source + build-matter.sh). It's loaded
// same-origin (no iframe mixed-content issues) and connects to the hub's Matter
// WebSocket for live data via ?ac=1&ip=… (auto-connect, login skipped).
//   base : same-origin path where the built Matter UI is served
//   hub  : the hub host (shown in the header; data comes from ws://hub:5580/ws)
//   ip   : login value the Matter UI converts to the WS URL (HA :8123 → :5580/ws)
//   user : Matter UI username (its login does not validate the password)
const MATTER_UI={ base:'/matter', hub:'192.168.0.41', ip:'192.168.0.41:8123', user:'dhanush' };
function _matterUrl(kind){
  const q='?ac=1&ip='+encodeURIComponent(MATTER_UI.ip)+'&user='+encodeURIComponent(MATTER_UI.user);
  // Explicit /index.html so it works the same on FastAPI (no dir-index) and Firebase.
  return MATTER_UI.base.replace(/\/$/,'')+'/index.html'+q+(kind==='thread'?'#thread':'');
}
// Render the Node/Thread pane — same-origin iframe of the built Matter UI. Its own
// header/nav bar hides itself in embedded mode (?ac=1), so no cropping needed.
function renderMatterEmbed(kind){
  const pane=document.getElementById('tab-'+kind);if(!pane)return;
  const url=_matterUrl(kind);
  const label=kind==='thread'?'Thread Network Mesh':'Nodes / Devices';
  const head=`<div class="panel" style="padding:0;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;color:#e8edf5">Matter Server — ${label} <span style="color:var(--muted);font-weight:400;font-size:11px">· live from hub ${MATTER_UI.hub}</span></div>
      <a href="${url}" target="_blank" rel="noopener" class="btn" style="text-decoration:none;white-space:nowrap">Open in new tab ↗</a>
    </div>`;
  pane.innerHTML=head+`<iframe src="${url}" title="Matter ${label}" style="width:100%;height:78vh;border:0;background:#fff;display:block"></iframe></div>`;
}

const TARGETS={
  reliability: {val:97,   dir:'gte', lbl:'≥97%'},
  northStar:   {val:95,   dir:'gte', lbl:'≥95%'},
  p50Local:    {val:1000, dir:'lte', lbl:'<1000ms'},
  hubSnap:     {val:300,  dir:'lte', lbl:'<300ms'},
  hubApp:      {val:200,  dir:'lte', lbl:'<200ms'},
  localE2e:    {val:1000, dir:'lte', lbl:'<1000ms'},
  remoteE2e:   {val:3000, dir:'lte', lbl:'<3000ms'},
  dockRel:     {val:97,   dir:'gte', lbl:'≥97%'},
  appTrigger:  {val:97,   dir:'gte', lbl:'≥97%'},
};
function tgtLine(actual,t){
  return `<span style="font-size:9px;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:3px 8px;font-weight:500;white-space:nowrap;">Target ${t.lbl}</span>`;
}
function _defaultDates(){const now=new Date(),pad=n=>String(n).padStart(2,'0'),fmt=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;activeTo=fmt(now);const f=new Date(now);f.setDate(f.getDate()-30);activeFrom=fmt(f);}
function activeDaysCount(){if(!activeFrom||!activeTo)return 30;return Math.round((new Date(activeTo)-new Date(activeFrom))/864e5)+1;}
function activePeriodLabel(){if(!activeFrom||!activeTo)return'30-day window';const fmt=s=>{const[y,m,d]=s.split('-');return`${m}/${d}/${y.slice(2)}`};return`${fmt(activeFrom)}–${fmt(activeTo)}`;}
async function fetchAllHubs(showLoading){
  const loader=document.getElementById('fullPageLoader');
  if(showLoading&&loader) loader.style.display='flex';
  const{hubs}=await fetch('/api/hubs').then(r=>r.json());
  await Promise.all(hubs.map(async h=>{D[h]=await fetch(`/api/hub/${h}?from_date=${activeFrom}&to_date=${activeTo}`).then(r=>r.json())}));
  if(showLoading&&loader) loader.style.display='none';
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

// All-source failures for a hub: pull from the complete event pool (app + dock + hub),
// not the app-only D[hub].failures sample — otherwise Dock/Hub source drill-downs would
// list nothing even though the card shows a failure count.
function failuresFor(hub,predFn){return buildEventPool(hub).filter(e=>e.status==='fail').filter(predFn)}
// UC → src matching based on actual data values:
// App Control  → src: 'app'
// Dock Control → src: 'docklet'
// Remote App   → src: 'app_remote'
// Automation   → src: 'direct_thread'
function srcPred(key){
  const k=(key||'').toLowerCase();
  if(k.includes('dock'))return f=>(f.src||'').toLowerCase().includes('docklet');
  if(k.includes('remote'))return f=>{const s=(f.src||'').toLowerCase();return s.includes('app_remote')||s.includes('remote_app')||s==='remote';};
  // Hub = everything the hub itself originated: direct hub control + scenes + automations
  // (all tagged src 'direct_hub' / 'direct_hub_ui').
  if(k.includes('hub')||k.includes('auto')||k.includes('scene')||k.includes('observ'))
    return f=>(f.src||'').toLowerCase().includes('direct');
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

  let fActivity=0,fActSucc=0,fActFail=0,fLatencies=[],fNS=[];
  hubs.forEach(h=>{const d=D[h];
    fActivity+=(d.total_activity!=null?d.total_activity:d.total);
    fActSucc+=(d.activity_success!=null?d.activity_success:d.success);
    fActFail+=(d.activity_fail!=null?d.activity_fail:(d.total-d.success));
    const _p=d.speed.local_e2e.p50;if(d.total&&_p!=null)fLatencies.push(_p);
    if(d.daily)d.daily.forEach(dy=>{if(dy.ns!==undefined)fNS.push(dy.ns)})});
  const fRel=fActivity>0?((fActSucc/fActivity)*100).toFixed(2):0;
  const fP50=fLatencies.length>0?Math.round(fLatencies.reduce((a,b)=>a+b,0)/fLatencies.length):0;
  const fNSavg=fNS.length>0?(fNS.reduce((a,b)=>a+b,0)/fNS.length).toFixed(1):0;
  // Judge status on all-source reliability for hubs that had any activity
  const hubRel=h=>D[h].activity_reliability!=null?D[h].activity_reliability:D[h].reliability;
  const actHubs=hubs.filter(h=>(D[h].total_activity!=null?D[h].total_activity:D[h].total)>0);
  const anyCritical=actHubs.some(h=>hubRel(h)<=93);
  const anyWarning=actHubs.some(h=>hubRel(h)<=97&&hubRel(h)>93);

  const badge=document.getElementById('fleetStatusBadge');
  if(!actHubs.length){badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--muted);display:inline-block"></span><span style="color:var(--muted)">No activity in range</span>';badge.style.borderColor='var(--border)'}
  else if(anyCritical){badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block"></span><span style="color:var(--red)">Critical</span>';badge.style.borderColor='var(--red)'}
  else if(anyWarning){badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--yellow);display:inline-block"></span><span style="color:var(--yellow)">Warning</span>';badge.style.borderColor='var(--yellow)'}
  else{badge.innerHTML='<span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse 2s infinite"></span><span style="color:var(--green)">All Systems Operational</span>';badge.style.borderColor='var(--green)'}

  const INFO_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin-left:2px;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  const titleStyle = "display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:#e8edf5;";

  document.getElementById('fleetKPIs').innerHTML=`
    <div class="kpi"><div class="label" style="${titleStyle}">TOTAL EVENTS<button class="info-btn" style="border:none;background:none" onclick="event.stopPropagation();showInfo('fleet_total')">${INFO_ICON}</button></div><div class="value">${fActivity.toLocaleString()}</div><div class="sub">${hubs.length} Hubs</div></div>
    <div class="kpi" onclick="showFleetModal('reliability')"><div class="label" style="${titleStyle}">RELIABILITY<button class="info-btn" style="border:none;background:none" onclick="event.stopPropagation();showInfo('fleet_reliability')">${INFO_ICON}</button></div><div class="value" style="color:${fActivity?relColor(fRel):'var(--muted)'}">${fActivity?fRel+'%':'—'}</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">${fActivity?fActSucc.toLocaleString()+' Success, '+fActFail.toLocaleString()+' Failures':'no activity'}</span>${fActivity?tgtLine(parseFloat(fRel),TARGETS.reliability):''}</div></div>
    <div class="kpi" onclick="showFleetModal('latency')"><div class="label" style="${titleStyle}">AVG P50 SPEED<button class="info-btn" style="border:none;background:none" onclick="event.stopPropagation();showInfo('fleet_latency')">${INFO_ICON}</button></div><div class="value">${fP50}ms</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Median Response Time</span>${tgtLine(fP50,TARGETS.p50Local)}</div></div>
    <div class="kpi" onclick="showFleetModal('northstar')"><div class="label" style="${titleStyle}">NORTH STAR<button class="info-btn" style="border:none;background:none" onclick="event.stopPropagation();showInfo('fleet_northstar')">${INFO_ICON}</button></div><div class="value" style="color:${fNSavg>=95?'var(--green)':fNSavg>=80?'var(--yellow)':'var(--red)'}">${fNSavg}%</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Actions completed in &lt; 1 second</span>${tgtLine(parseFloat(fNSavg),TARGETS.northStar)}</div></div>`;

  const grid=document.getElementById('hubCardsGrid');grid.innerHTML='';
  const getScore = h => {
    const d=D[h];
    if(!d) return 4;
    const act=d.total_activity!=null?d.total_activity:d.total;
    if(!act||act<=0) return 4;
    const rel=d.activity_reliability!=null?d.activity_reliability:d.reliability;
    if(rel<95||(d.total&&d.speed&&d.speed.local_e2e.p50>1000)) return 1;
    if(rel<97||(d.total&&d.speed&&d.speed.local_e2e.p50>800)) return 2;
    return 3;
  };
  [...hubs].sort((a,b)=>getScore(a)-getScore(b)).forEach(h=>{
    const d=D[h];
    const activity=d.total_activity!=null?d.total_activity:d.total;
    const arel=d.activity_reliability!=null?d.activity_reliability:d.reliability;
    const hasAct=activity>0;
    const rc=hasAct?relColor(arel):'var(--muted)';
    const tag=hasAct?relTag(arel):'';
    const sl=hasAct?statusLabel(arel):'No activity';
    const hasIssues=hasAct&&(arel<97||(d.total&&d.speed.local_e2e.p50>800));
    const failCount=d.activity_fail!=null?d.activity_fail:(d.total-d.success);
    const nsNS = d.daily&&d.daily.length ? (d.daily.reduce((s,dy)=>s+(dy.ns||0),0)/d.daily.length).toFixed(1)+'%' : '—';
    const card=document.createElement('div');
    card.className='hub-grid-card';card.dataset.hub=h;
    card.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:16px;margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;color:#e8edf5;font-family:monospace;letter-spacing:0.5px">${h.toUpperCase()}</div>
        <div style="display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid ${rc};border-radius:20px;padding:4px 12px;font-size:11px;font-weight:500"><span style="width:8px;height:8px;border-radius:50%;background:${rc};display:inline-block"></span><span style="color:${rc}">${sl}</span></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;margin-bottom:30px;gap:4px">
        <div style="flex:1;text-align:center">
          <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:0;white-space:nowrap;margin-bottom:8px">TOTAL EVENTS</div>
          <div style="font-size:15px;color:#e8edf5;font-weight:700">${activity.toLocaleString()}</div>
        </div>
        <div style="width:1px;height:44px;background:var(--border2)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:0;white-space:nowrap;margin-bottom:8px">RELIABILITY</div>
          <div style="font-size:15px;color:${rc};font-weight:700">${hasAct?arel+'%':'—'}</div>
        </div>
        <div style="width:1px;height:44px;background:var(--border2)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:0;white-space:nowrap;margin-bottom:8px">P50 SPEED</div>
          <div style="font-size:15px;color:#e8edf5;font-weight:700">${d.total&&d.speed.local_e2e.p50!=null?d.speed.local_e2e.p50+'ms':'—'}</div>
        </div>
        <div style="width:1px;height:44px;background:var(--border2)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:0;white-space:nowrap;margin-bottom:8px">NORTH STAR</div>
          <div style="font-size:15px;color:#e8edf5;font-weight:700">${nsNS}</div>
        </div>
        <div style="width:1px;height:44px;background:var(--border2)"></div>
        <div style="flex:1;text-align:center">
          <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:0;white-space:nowrap;margin-bottom:8px">FAILURES</div>
          <div style="font-size:15px;color:#e8edf5;font-weight:700">${hasAct?failCount:'—'}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <button class="card-btn-investigate" onclick="event.stopPropagation();openLogCenter({hub:'${h}',tab:'failures'})">Investigate</button>
        <button class="card-btn-view">View</button>
      </div>`;
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
  document.getElementById('hubTitle').textContent=hub.toUpperCase();
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
  // Node / Thread panes embed the Matter server UI (rendered once, lazily)
  if((id==='node'||id==='thread')){
    const pane=document.getElementById('tab-'+id);
    if(pane&&!pane.dataset.loaded){renderMatterEmbed(id);pane.dataset.loaded='1';}
  }
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
  // Built from the COMPLETE authoritative lists returned by the backend, so Log
  // Center counts reconcile exactly with the summary cards:
  //   all_events         → every genuine app-triggered command (app_logs)
  //   dock_events        → dock device-side activations (ha_logs — reliable)
  //   hub_observed_events → scene activations & automation runs (ha_logs)
  // App-observed "Observed Change (App)" is intentionally NOT included — it is
  // unreliable (only seen while the app is open) and kept internal-only.
  const d=D[hub];const events=[];

  (d.all_events||[]).forEach(e=>{
    const lat=parseFloat(e.lat);const hasLat=!isNaN(lat);
    const t1=tsMs(e.rest_resp),t2=tsMs(e.ws_conf);
    const hubAppLat=(t1&&t2&&t2>=t1)?(t2-t1):null;
    const status=e.success===false?'fail':(hasLat&&lat>1000)?'slow':(hasLat&&lat>800)?'warn':'ok';
    events.push({hub,ts:e.ts,uc:e.uc||'—',dev:e.dev||'—',room:e.room||'—',
      src:e.src||'app',lat:e.lat,reason:e.reason||null,net:e.net||'—',dock:'—',
      status,segType:(e.uc==='Remote App Control')?'remote_e2e':'local_e2e',
      hasTiming:!!(e.rest_resp&&e.ws_conf),
      tap:e.tap,cmd_sent:e.cmd_sent,rest_resp:e.rest_resp,ws_conf:e.ws_conf,
      hub_app_lat:hubAppLat});
  });

  // Dock presses (ha_logs) — a press FAILS if its bound device didn't reach on/off
  (d.dock_events||[]).forEach(e=>{const failed=e.success===false;
    events.push({hub,ts:e.ts,uc:'Dock Control',
    dev:e.dev||e.docklet_id||'—',room:e.room||'—',src:'docklet',lat:null,
    reason:failed?'DEVICE_UNAVAILABLE':null,net:'dock',dock:e.dock_id||'—',action:e.action||'',
    status:failed?'fail':'ok',segType:'dock',hasTiming:false});});

  // (SNAP-board actuations are NOT added here — they're the device-layer of actions
  //  already counted via their trigger; adding them would double-count.)

  // Hub-recorded scene activations & automation runs (ha_logs — reliable source)
  (d.hub_observed_events||[]).forEach(e=>events.push({hub,ts:e.ts,uc:e.uc||'Hub Event',
    dev:e.dev||'—',room:e.room||'—',src:'direct_hub',lat:null,
    reason:null,net:'hub',dock:'—',status:'ok',segType:'hub_observed',hasTiming:false}));

  // Direct hub control (Hub Logging Spec, actuation_source 'ha:*') — a device driven
  // from the hub's own HA screen. Folded into the all-source totals; part of "Hub".
  (d.hub_ha_ui_events||[]).forEach(e=>events.push({hub,ts:e.ts,uc:'Hub Control',
    dev:e.dev||'—',room:e.room||'—',src:'direct_hub_ui',lat:null,action:e.action||'',
    reason:null,net:'hub',dock:'—',status:(e.success===false)?'fail':'ok',
    segType:'hub_ha_ui',hasTiming:false}));

  return events.sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
}
// Source classification for Log Center count breakdown
function eventSrcClass(e){
  const s=(e.src||'').toLowerCase();
  if(s.includes('docklet'))return'dock';
  if(s.includes('remote'))return'remote';
  if(s.includes('direct_hub')||e.segType==='hub_observed')return'hub';
  return'app';
}
// Day-of-week + hour derived from an event timestamp — used identically by the
// heatmap grouping AND the Log Center day/hour filters, so a heatmap cell count
// always equals its drill-down count.
const _DOW=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function evDow(ts){if(!ts)return null;const d=new Date(ts.slice(0,10)+'T00:00:00Z');return isNaN(d)?null:_DOW[d.getUTCDay()];}
function evHour(ts){if(!ts||ts.length<13)return -1;const h=parseInt(ts.slice(11,13));return isNaN(h)?-1:h;}
// All-source per-day series (built from the same pool → matches Total Events and
// the heatmap). Reliability = non-failed / total across all sources; P50 & North
// Star are merged from the app-command daily (only app has latency).
let _dailyArr=[];
function allSourceDaily(hub){
  const pool=buildEventPool(hub),m={};
  pool.forEach(e=>{
    const day=(e.ts||'').slice(0,10);if(!day)return;
    const o=m[day]||(m[day]={total:0,fail:0,app:0,dock:0,hub:0,failApp:0,failDock:0,failHub:0});
    o.total++;
    const src = eventSrcClass(e);
    if(src==='app'||src==='remote') o.app++;
    else if(src==='dock') o.dock++;
    else o.hub++;
    
    if(e.status==='fail'){
      o.fail++;
      if(src==='app'||src==='remote') o.failApp++;
      else if(src==='dock') o.failDock++;
      else o.failHub++;
    }
  });
  const appByDate={};(D[hub].daily||[]).forEach(r=>{appByDate[r.date]=r;});
  return Object.keys(m).sort().map(date=>{const a=appByDate[date]||{};return{
    date,total:m[date].total,fail:m[date].fail,
    app:m[date].app, dock:m[date].dock, hub:m[date].hub,
    failApp:m[date].failApp, failDock:m[date].failDock, failHub:m[date].failHub,
    rel:m[date].total?+(100*(m[date].total-m[date].fail)/m[date].total).toFixed(2):0,
    p50:a.p50!=null?a.p50:null,p95:a.p95!=null?a.p95:null,ns:a.ns!=null?a.ns:null,avg:a.avg!=null?a.avg:null,sd:a.sd!=null?a.sd:null};});
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
  lcState.dayFilter=opts.dayFilter||null;

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
  lcState.srcFilter=null;lcState.ucFilter=null;lcState.segFilter=null;lcState.latMin=null;lcState.latMax=null;lcState.hourFilter=null;lcState.dayFilter=null;
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
    if(lcState.hourFilter!==null){if(evHour(e.ts)!==lcState.hourFilter)return false;}
    if(lcState.dayFilter){if(evDow(e.ts)!==lcState.dayFilter)return false;}
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
      const haLat=ev.hub_app_lat!=null?`${ev.hub_app_lat}ms`:'—';
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
  <th>Room</th><th>Latency</th><th>Status / Reason</th><th>Network</th>
</tr>`;
const DEFAULT_LC_COLSPAN=10;

function renderLogCenter(){
  const body=document.getElementById('lcTableBody');
  const summary=document.getElementById('lcSummaryRow');
  const empty=document.getElementById('lcEmptyState');
  const banner=document.getElementById('lcContextBanner');
  if(!body)return;
  // Keep the subtitle in sync with the selected date range
  const _sub=document.getElementById('lcSubtitle');
  if(_sub)_sub.textContent=`Event-level debugging workspace · Click any row to expand timing pipeline · ${activePeriodLabel()}`;

  const hasFilter=lcState.context||lcState.srcFilter||lcState.ucFilter||lcState.segFilter||lcState.latMin!==null;
  if(hasFilter&&banner){
    banner.style.display='flex';
    const parts=[];
    if(lcState.srcFilter)parts.push(`Source: ${lcState.srcFilter}`);
    if(lcState.ucFilter)parts.push(`Use Case: ${lcState.ucFilter}`);
    if(lcState.segFilter)parts.push(`Segment: ${lcState.segFilter}`);
    if(lcState.latMin!==null)parts.push(`Latency: ${lcState.latMin}${lcState.latMax?'–'+lcState.latMax:'+'} ms`);
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
  // Source breakdown of the shown events (App / Dock / Hub) — lets a card count
  // be verified against the drill-down (e.g. 1717 app events on the card = 1717 here).
  const byClass={app:0,remote:0,dock:0,hub:0};
  events.forEach(e=>{byClass[eventSrcClass(e)]++;});
  const srcParts=[];
  if(byClass.app)srcParts.push(`App ${byClass.app}`);
  if(byClass.remote)srcParts.push(`Remote ${byClass.remote}`);
  if(byClass.dock)srcParts.push(`Dock ${byClass.dock}`);
  if(byClass.hub)srcParts.push(`Hub ${byClass.hub}`);
  summary.innerHTML=`<span class="lc-cnt">${events.length}</span> events shown`+
    (srcParts.length?` <span style="color:var(--muted)">(${srcParts.join(' · ')})</span>`:'')+
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
      ${tpField('Latency',ev.lat&&ev.lat!=='N/A'?ev.lat+'ms':'N/A')}${tpField('Network',ev.net)}
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
      ${tpField('Latency',ev.lat?ev.lat+'ms':'—')}${tpField('Network',ev.net)}
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
  destroyCharts();const d=D[hub];
  const _act=d.total_activity!=null?d.total_activity:d.total;
  const _arel=d.activity_reliability!=null?d.activity_reliability:d.reliability;
  const f=d.activity_fail!=null?d.activity_fail:(d.total-d.success);
  const nsAvg=d.daily&&d.daily.length?(d.daily.reduce((s,dy)=>s+(dy.ns||0),0)/d.daily.length).toFixed(1):0;
  const nsC=parseFloat(nsAvg)>=95?'var(--green)':parseFloat(nsAvg)>=80?'var(--yellow)':'var(--red)';
  const kpiEl=document.getElementById('topKPIs');
  kpiEl.style.gridTemplateColumns='repeat(5,1fr)';
  const INFO_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin-left:2px;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  const ts = "display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:#e8edf5;";
  const ib = (key) => `<button class="info-btn" style="border:none;background:none" onclick="event.stopPropagation();showInfo('${key}')">${INFO_ICON}</button>`;

  const appFails=(D[hub].failures||[]).filter(f=>f.src==='App Control'||f.src==='Remote App').length;
  const dockFails=(D[hub].failures||[]).filter(f=>f.src==='Dock Control').length;
  const hubFails=f-appFails-dockFails;

  kpiEl.innerHTML=`
    <div class="kpi" onclick="openLogCenter({hub:'${hub}',tab:'all',context:{label:'${hub.toUpperCase()} — All Activity',desc:'All reliable events · ${activePeriodLabel()}'}})"><div class="label" style="${ts}">TOTAL EVENTS${ib('hub_total')}</div><div class="value">${(d.total_activity!=null?d.total_activity:d.total).toLocaleString()}</div><div class="sub">App ${(d.usage&&d.usage.app)||0} · Dock ${(d.usage&&d.usage.docklet)||0} · Hub ${((d.usage&&(d.usage.hub_total!=null?d.usage.hub_total:(d.usage.hub_scene_total||0)+(d.usage.hub_auto_total||0)+(d.usage.hub_direct_total||0))))||0}</div></div>
    <div class="kpi" onclick="showHubRelModal('${hub}')"><div class="label" style="${ts}">RELIABILITY${ib('hub_reliability')}</div><div class="value" style="color:${_act?relColor(_arel):'var(--muted)'}">${_act?_arel+'%':'—'}</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">${_act?(_act-f).toLocaleString()+' Success, '+f.toLocaleString()+' Failures':'No activity in range'}</span>${_act?tgtLine(parseFloat(_arel),TARGETS.reliability):''}</div></div>
    <div class="kpi" onclick="showHubSpeedModal('${hub}')"><div class="label" style="${ts}">P50 SPEED${ib('hub_latency')}</div><div class="value" style="color:${d.speed.local_e2e.p50>800?'var(--yellow)':'#e8edf5'}">${d.total&&d.speed.local_e2e.p50!=null?d.speed.local_e2e.p50+'ms':'—'}</div><div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Median Response Time</span>${tgtLine(d.speed.local_e2e.p50,TARGETS.p50Local)}</div></div>
    <div class="kpi" style="cursor:pointer" onclick="showHubNSModal('${hub}')">
      <div class="label" style="${ts}">NORTH STAR${ib('fleet_northstar')}</div>
      <div class="value" style="color:${nsC}">${nsAvg}%</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="sub" style="margin:0">Actions completed in &lt; 1 second</span>${tgtLine(parseFloat(nsAvg),TARGETS.northStar)}</div></div>
    <div class="kpi" style="cursor:pointer" onclick="openLogCenter({hub:'${hub}',tab:'failures',context:{label:'${hub.toUpperCase()} — All Failures',desc:'${f} failures · ${activePeriodLabel()}'}})">
      <div class="label" style="${ts}">FAILURES${ib('hub_failures')}</div><div class="value" style="color:var(--red)">${f}</div>
      <div class="sub" style="margin-top:4px">App ${appFails} · Dock ${dockFails} · Hub ${hubFails}</div></div>`;
  // Empty-period notice: app-side panels are all zero when no app events fall in
  // the selected range (not a bug — hub-recorded activity may still exist under Usage).
  const _eb=document.getElementById('emptyPeriodBanner');
  if(_eb){
    const _act=d.total_activity!=null?d.total_activity:d.total;
    if(!_act){
      _eb.style.display='block';
      _eb.innerHTML=`<div style="font-size:12px;font-weight:600;color:var(--yellow);margin-bottom:3px">No activity recorded in ${activePeriodLabel()}</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.6">No app commands, dock presses, scene activations, or automation runs from any source in this date range. Pick a range that includes days with activity.</div>`;
    } else if(!d.total){
      // Activity exists, but none of it is app-initiated (all dock / scene / automation from the hub)
      _eb.style.display='block';
      _eb.innerHTML=`<div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:3px">No app commands in ${activePeriodLabel()} — showing hub-recorded activity</div>
        <div style="font-size:11px;color:var(--muted);line-height:1.6">The app initiated nothing in this range, so app reliability/latency read “—”. The ${_act} event(s) shown come from the hub (dock presses, scene activations, automation runs) — see the heatmap, Usage, and Log Center.</div>`;
    } else _eb.style.display='none';
  }
  renderOverall(d);renderSpeed(d);renderReliability(d);renderUsage(d);
}

// focus: 'events' | 'reliability' | 'ns'
function showDayDebug(hub,dayIdx,focus){
  const d=D[hub],day=(_dailyArr&&_dailyArr[dayIdx])||(d.daily&&d.daily[dayIdx]);if(!day)return;
  const nsC=(day.ns||0)>=95?'var(--green)':(day.ns||0)>=80?'var(--yellow)':'var(--red)';
  const relC=relColor(day.rel);
  // null/NaN-safe formatter — app-latency metrics (p50/p95/avg/ns) are null on days
  // with only hub/dock activity, so never render "nullms".
  const fmt=(v,s)=>(v==null||isNaN(v))?'—':(v+(s||''));

  const pool=buildEventPool(hub);
  const dayAll=pool.filter(e=>(e.ts||'').startsWith(day.date));
  const dayFails=dayAll.filter(e=>e.status==='fail');
  const dayNsMiss=dayAll.filter(e=>parseFloat(e.lat||0)>1000);
  const cols=[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'lat',label:'Latency'},{key:'reason',label:'Reason'}];

  const tile=(label,val,color)=>`<div style="flex:1;min-width:100px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:4px">${label}</div>
      <div style="font-size:20px;font-weight:700;color:${color||'#e8edf5'}">${val}</div>
    </div>`;
  // Only show the tiles relevant to what was clicked. Failures trend → no P50/North Star.
  let tiles;
  if(focus==='reliability'){
    tiles=tile('Total Events',day.total)+tile('Reliability',fmt(day.rel,'%'),relC)+tile('Failed',dayFails.length,'var(--red)');
  } else if(focus==='ns'){
    tiles=tile('Total Events',day.total)+tile('North Star',fmt(day.ns!=null?(+day.ns).toFixed(1):null,'%'),nsC)+tile('Events >1s',dayNsMiss.length,'var(--yellow)');
  } else if(focus==='speed'){
    tiles=tile('Total Events',day.total)+tile('P50',fmt(day.p50,'ms'),(day.p50>800?'var(--yellow)':'#e8edf5'))+tile('P95',fmt(day.p95,'ms'))+tile('Avg',fmt(day.avg!=null?Math.round(day.avg):null,'ms'));
  } else {
    tiles=tile('Total Events',day.total)+tile('Reliability',fmt(day.rel,'%'),relC)+tile('P50 Latency',fmt(day.p50,'ms'),(day.p50>800?'var(--yellow)':'#e8edf5'))+tile('North Star',fmt(day.ns!=null?(+day.ns).toFixed(1):null,'%'),nsC);
  }
  const statBar=`<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">${tiles}</div>`;

  const lcAllFails={hub,tab:'failures',filters:{search:day.date},context:{label:`Failures on ${day.date}`,desc:`${hub.toUpperCase()} · Reliability was ${day.rel}%`}};
  const lcAllSlow={hub,tab:'slow',filters:{search:day.date},context:{label:`Slow Events on ${day.date}`,desc:`${hub.toUpperCase()} · North Star was ${(day.ns||0).toFixed(1)}%`}};
  const lcAllEvs={hub,tab:'all',filters:{search:day.date},context:{label:`All Events on ${day.date}`,desc:`${hub.toUpperCase()} · ${day.total} total events`}};

  let body=statBar,title='',logOpts=null,rows=[],emptyMsg='';

  if(focus==='events'){
    // Show ALL sampled events for the day — what the bar actually represents
    title=`${day.date} — ${day.total} Events`;
    rows=[...dayAll].sort((a,b)=>{const r=s=>s==='fail'?0:s==='slow'?1:s==='warn'?2:3;return r(a.status)-r(b.status);});
    logOpts=lcAllEvs;
    emptyMsg=`No sampled events found for ${day.date}. The pool contains events distributed across the selected period.`;
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

  } else if(focus==='speed'){
    // P50/P95 speed trend + AVG/SD trend drill-down: this day's timed events, slowest first.
    title=`${day.date} — Speed (P50 ${fmt(day.p50,'ms')} · P95 ${fmt(day.p95,'ms')})`;
    const timed=dayAll.filter(e=>{const l=parseFloat(e.lat);return !isNaN(l)&&l>0;})
                      .sort((a,b)=>parseFloat(b.lat||0)-parseFloat(a.lat||0));
    rows=timed;
    logOpts=lcAllEvs;
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Timed app commands on ${day.date} — ${rows.length} sampled (slowest first)</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(logOpts).replace(/"/g,'&quot;')})">View ${day.date} in Log Center →</button>
      </div>
      <p style="font-size:10px;color:var(--muted);margin:0 0 8px">Speed (P50/P95/Avg/StdDev) is measured from app-command round-trips only — hub-initiated and dock events have no app latency.</p>
      ${rows.length?evTable(rows,cols):`<div class="dbg-empty">No timed events in sample for ${day.date}.</div>`}
    </div>`;
  }

  showModal(title,body);
}

function renderOverall(d){

  _dailyArr=allSourceDaily(activeHub);
  const interp = (arr) => {
    let res = [...arr];
    for(let i=0;i<res.length;i++){
      if(res[i]==null){
        let p=res.slice(0,i).reverse().find(v=>v!=null);
        let n=res.slice(i+1).find(v=>v!=null);
        res[i] = (p!=null && n!=null) ? (p+n)/2 : (p!=null?p:(n!=null?n:0));
      }
    }
    return res;
  };
  const _p50Arr = interp(_dailyArr.map(r=>r.p50));
    const _p95Arr = interp(_dailyArr.map(r=>r.p95));
  const _nsArr = interp(_dailyArr.map(r=>r.ns));
  const dates=_dailyArr.map(r=>`${r.date.slice(8,10)}-${r.date.slice(5,7)}`);
  const relPt=document.createElement('canvas'); relPt.width=24; relPt.height=10;
  const ctxR=relPt.getContext('2d'); ctxR.strokeStyle='#1fa355'; ctxR.fillStyle='#1fa355'; ctxR.lineWidth=1.5; ctxR.setLineDash([3,3]); ctxR.beginPath(); ctxR.moveTo(0,5); ctxR.lineTo(24,5); ctxR.stroke(); ctxR.setLineDash([]); ctxR.beginPath(); ctxR.arc(12,5,3.5,0,Math.PI*2); ctxR.fill();
  const tgtPt=document.createElement('canvas'); tgtPt.width=24; tgtPt.height=10;
  const ctxT=tgtPt.getContext('2d'); ctxT.strokeStyle='rgba(160,160,160,1)'; ctxT.lineWidth=1.5; ctxT.setLineDash([3,3]); ctxT.beginPath(); ctxT.moveTo(0,5); ctxT.lineTo(24,5); ctxT.stroke();
  const p50Pt=document.createElement('canvas'); p50Pt.width=24; p50Pt.height=10;
  const ctxP=p50Pt.getContext('2d'); ctxP.strokeStyle='#d4961f'; ctxP.fillStyle='#d4961f'; ctxP.lineWidth=1.5; ctxP.beginPath(); ctxP.moveTo(0,5); ctxP.lineTo(24,5); ctxP.stroke(); ctxP.beginPath(); ctxP.arc(12,5,3.5,0,Math.PI*2); ctxP.fill();
  const p95Pt=document.createElement('canvas'); p95Pt.width=24; p95Pt.height=10;
  const ctxP95=p95Pt.getContext('2d'); ctxP95.strokeStyle='#e74c3c'; ctxP95.fillStyle='#e74c3c'; ctxP95.lineWidth=1.5; ctxP95.beginPath(); ctxP95.moveTo(0,5); ctxP95.lineTo(24,5); ctxP95.stroke(); ctxP95.beginPath(); ctxP95.arc(12,5,3.5,0,Math.PI*2); ctxP95.fill();
  const nsPt=document.createElement('canvas'); nsPt.width=24; nsPt.height=10;
  const ctxN=nsPt.getContext('2d'); ctxN.strokeStyle='#3d82f0'; ctxN.fillStyle='#3d82f0'; ctxN.lineWidth=1.5; ctxN.beginPath(); ctxN.moveTo(0,5); ctxN.lineTo(24,5); ctxN.stroke(); ctxN.beginPath(); ctxN.arc(12,5,3.5,0,Math.PI*2); ctxN.fill();

  charts.daily=mc('dailyChart',{type:'bar',data:{labels:dates,datasets:[
    {label:'Hub Events',data:_dailyArr.map(r=>r.hub),backgroundColor:'#9353d4',pointStyle:'rect',order:4,stack:'Stack 0'},
    {label:'App Events',data:_dailyArr.map(r=>r.app),backgroundColor:'#3d82f0',pointStyle:'rect',order:3,stack:'Stack 0'},
    {label:'Dock Events',data:_dailyArr.map(r=>r.dock),backgroundColor:'#d4961f',pointStyle:'rect',order:2,stack:'Stack 0'},
    {label:'Reliability %',data:_dailyArr.map(r=>r.rel),type:'line',borderColor:'#1fa355',backgroundColor:'#1fa355',yAxisID:'y1',tension:.3,pointRadius:3,pointStyle:'circle',borderWidth:1.5,borderDash:[3,3],order:1},
    {label:'Target %',data:dates.map(()=>97),type:'line',yAxisID:'y1',borderColor:'rgba(160,160,160,1)',borderDash:[3,3],borderWidth:1.5,pointRadius:0,pointStyle:'line',fill:false,tension:0,order:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;
        const focus=els[0].datasetIndex===3?'reliability':'events';
        showDayDebug(activeHub,els[0].index,focus);},
      plugins:{
        legend:{
          labels:{
            usePointStyle:true,boxWidth:32,padding:20,sort:(a,b)=>a.datasetIndex-b.datasetIndex,
            generateLabels:function(chart){
              const labels=Chart.defaults.plugins.legend.labels.generateLabels(chart);
              labels.forEach(l=>{
                if(l.datasetIndex===3){l.pointStyle=relPt; l.boxWidth=32;}
                else if(l.datasetIndex===4){l.pointStyle=tgtPt; l.boxWidth=32;}
                else { l.pointStyle='rect'; l.boxWidth=12; }
              });
              return labels;
            }
          }
        },
        tooltip:{
          usePointStyle:true,boxWidth:28,boxHeight:10,itemSort:(a,b)=>a.datasetIndex-b.datasetIndex,filter:function(item){return item.datasetIndex<4;},
          callbacks:{
            labelPointStyle:function(ctx){
              if(ctx.datasetIndex===3)return{pointStyle:relPt,rotation:0};
              if(ctx.datasetIndex===4)return{pointStyle:tgtPt,rotation:0};
              return{pointStyle:'rect',rotation:0};
            },
            label:function(ctx){return ctx.dataset.label+': '+(ctx.dataset.yAxisID==='y1'?ctx.parsed.y.toFixed(2)+'%':ctx.parsed.y+' events')}
          }
        }
      },
      scales:{
        x:{stacked:true, title:{display:true,text:'Date'}, grid:{color:'rgba(255,255,255,0.02)'}},
        y:{stacked:true, title:{display:true,text:'Event Count'},beginAtZero:true, grid:{color:'rgba(255,255,255,0.02)'}},
        y1:{title:{display:true,text:'Reliability %'},position:'right',min:0,max:102,grid:{display:false}}
      }
    }
  });

  charts.p50=mc('p50Chart',{type:'line',data:{labels:dates,datasets:[
    {label:'P50 Speed (ms)',data:_p50Arr,borderColor:'#d4961f',backgroundColor:'rgba(212,150,31,.1)',fill:true,tension:.3,pointRadius:3,spanGaps:true,order:1},
    {label:'P95 Speed (ms)',data:_p95Arr,borderColor:'#e74c3c',backgroundColor:'rgba(231,76,60,0.1)',fill:true,tension:.3,pointRadius:3,spanGaps:true,order:2},
    {label:'Target (ms)',data:dates.map(()=>1000),borderColor:'rgba(160,160,160,1)',borderDash:[3,3],borderWidth:1.5,pointRadius:0,fill:false,tension:0,order:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;showDayDebug(activeHub,els[0].index,'speed');},
      plugins:{
        legend:{
          labels:{
            usePointStyle:true,boxWidth:32,padding:20,sort:(a,b)=>a.datasetIndex-b.datasetIndex,
            generateLabels:function(chart){
              const labels=Chart.defaults.plugins.legend.labels.generateLabels(chart);
              labels.forEach(l=>{
                if(l.datasetIndex===0){l.pointStyle=p50Pt; l.boxWidth=32;}
                else if(l.datasetIndex===1){l.pointStyle=p95Pt; l.boxWidth=32;}
                else if(l.datasetIndex===2){l.pointStyle=tgtPt; l.boxWidth=32;}
              });
              return labels;
            }
          }
        },
        tooltip:{
          usePointStyle:true,boxWidth:28,boxHeight:10,itemSort:(a,b)=>a.datasetIndex-b.datasetIndex,
          callbacks:{
            labelPointStyle:function(ctx){
              if(ctx.datasetIndex===0)return{pointStyle:p50Pt,rotation:0};
              if(ctx.datasetIndex===1)return{pointStyle:p95Pt,rotation:0};
              if(ctx.datasetIndex===2)return{pointStyle:tgtPt,rotation:0};
              return{pointStyle:'circle',rotation:0};
            },
            label:function(ctx){
              if(ctx.datasetIndex===0)return 'P50 (ms) : '+Math.round(ctx.parsed.y)+' ms';
              if(ctx.datasetIndex===1)return 'P95 (ms) : '+Math.round(ctx.parsed.y)+' ms';
              if(ctx.datasetIndex===2)return 'Target (ms) : <1000 ms';
              return ctx.dataset.label+': '+ctx.parsed.y+' ms';
            }
          }
        }
      },
      scales:{
        x:{title:{display:true,text:'Date'}, grid:{color:'rgba(255,255,255,0.02)'}},
        y:{title:{display:true,text:'Speed (ms)'},beginAtZero:true, grid:{color:'rgba(255,255,255,0.02)'}}
      }
    }
  });

  charts.ns=mc('nsChart',{type:'line',data:{labels:dates,datasets:[
    {label:'North Star %',data:_nsArr,borderColor:'#3d82f0',backgroundColor:'rgba(61,130,240,.1)',fill:true,tension:.3,pointRadius:3,spanGaps:true,order:1},
    {label:'Target %',data:dates.map(()=>95),borderColor:'rgba(160,160,160,1)',borderDash:[3,3],borderWidth:1.5,pointRadius:0,fill:false,tension:0,order:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;showDayDebug(activeHub,els[0].index,'ns');},
      plugins:{
        legend:{
          labels:{
            usePointStyle:true,boxWidth:32,padding:20,sort:(a,b)=>a.datasetIndex-b.datasetIndex,
            generateLabels:function(chart){
              const labels=Chart.defaults.plugins.legend.labels.generateLabels(chart);
              labels.forEach(l=>{
                if(l.datasetIndex===0){l.pointStyle=nsPt; l.boxWidth=32;}
                else if(l.datasetIndex===1){l.pointStyle=tgtPt; l.boxWidth=32;}
              });
              return labels;
            }
          }
        },
        tooltip:{
          usePointStyle:true,boxWidth:28,boxHeight:10,itemSort:(a,b)=>a.datasetIndex-b.datasetIndex,
          callbacks:{
            labelPointStyle:function(ctx){
              if(ctx.datasetIndex===0)return{pointStyle:nsPt,rotation:0};
              if(ctx.datasetIndex===1)return{pointStyle:tgtPt,rotation:0};
              return{pointStyle:'circle',rotation:0};
            },
            label:function(ctx){
              if(ctx.datasetIndex===0)return 'NS: '+ctx.parsed.y.toFixed(1)+'%';
              if(ctx.datasetIndex===1)return 'Target: >= 95%';
              return ctx.dataset.label+': '+ctx.parsed.y;
            }
          }
        }
      },
      scales:{
        x:{title:{display:true,text:'Date'}, grid:{color:'rgba(255,255,255,0.02)'}},
        y:{title:{display:true,text:'North Star %'},beginAtZero:false,min:60,max:102, grid:{color:'rgba(255,255,255,0.02)'}}
      }
    }
  });

  charts.failTrend=mc('failTrendChart',{type:'bar',data:{labels:dates,datasets:[
    {label:'Hub Failures',data:_dailyArr.map(r=>r.failHub),backgroundColor:'#9353d4',pointStyle:'rect',order:3,stack:'Stack 0'},
    {label:'App Failures',data:_dailyArr.map(r=>r.failApp),backgroundColor:'#e04545',pointStyle:'rect',order:2,stack:'Stack 0'},
    {label:'Dock Failures',data:_dailyArr.map(r=>r.failDock),backgroundColor:'#d4961f',pointStyle:'rect',order:1,stack:'Stack 0'}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;showDayDebug(activeHub,els[0].index,'reliability');},
      plugins:{
        legend:{
          labels:{
            usePointStyle:true,boxWidth:12,padding:20,sort:(a,b)=>a.datasetIndex-b.datasetIndex
          }
        },
        tooltip:{
          usePointStyle:true,boxWidth:12,itemSort:(a,b)=>a.datasetIndex-b.datasetIndex,
          callbacks:{label:function(ctx){return ctx.dataset.label+': '+ctx.parsed.y}}
        }
      },
      scales:{
        x:{stacked:true, title:{display:true,text:'Date'}, grid:{color:'rgba(255,255,255,0.02)'}},
        y:{stacked:true, title:{display:true,text:'Failure Count'},beginAtZero:true, grid:{color:'rgba(255,255,255,0.02)'}}
      }
    }
  });

  // ── Heatmaps built from the SAME event pool the Log Center uses, so a cell
  // count always equals its day+hour drill-down (all sources: app/remote/dock/hub).
  const pool=buildEventPool(activeHub);
  const hmAll={},hmDet={},hmFail={},hmFailDet={};
  pool.forEach(e=>{const dw=evDow(e.ts),hr=evHour(e.ts);if(dw===null||hr<0)return;
    const k=`${dw}_${hr}`;
    hmAll[k]=(hmAll[k]||0)+1;
    const det=hmDet[k]||(hmDet[k]={app:0,remote:0,dock:0,hub:0});det[eventSrcClass(e)]++;
    if(e.status==='fail'){
      hmFail[k]=(hmFail[k]||0)+1;
      const fdet=hmFailDet[k]||(hmFailDet[k]={app:0,remote:0,dock:0,hub:0});fdet[eventSrcClass(e)]++;
    }});

  const hm=document.getElementById('heatmapContainer');
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const maxV=Math.max(...Object.values(hmAll),1);
  let hmHTML = '';
  days.forEach(day=>{
    hmHTML+=`<div class="heatmap-label" style="border-right:1px solid var(--border)">${day.slice(0,3)}</div>`;
    for(let h=0;h<24;h++){
      const k=`${day}_${h}`,v=hmAll[k]||0,intensity=v/maxV;
      const bg=intensity>0?`rgba(61,130,240,${.08+intensity*.72})`:'#0c1018';
      const det=hmDet[k]||{app:0,remote:0,dock:0,hub:0};
      
      const tooltip = `<div class="heatmap-tooltip">
  <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:bold;">
    <span>${day.toUpperCase()}</span><span>${h}:00</span>
  </div>
  <hr style="border:0; border-top:1px solid rgba(255,255,255,0.15); margin:4px 0 8px 0;">
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> HUB: ${det.hub}</div>
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> APP: ${det.app}</div>
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> DOCK: ${det.dock}</div>
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> REMOTE: ${det.remote}</div>
</div>`;

      hmHTML+=`<div class="heatmap-cell" style="background:${bg};color:${intensity>.5?'#fff':'var(--muted)'}"
        onclick="openLogCenter({hub:'${activeHub}',tab:'all',dayFilter:'${day}',hourFilter:${h},context:{label:'${day} ${h}:00 - ${v} Events',desc:'App: ${det.app} � Remote: ${det.remote} � Dock: ${det.dock} � Hub: ${det.hub}'}})">
        ${v||''}${tooltip}</div>`}});
  hmHTML+='<div class="heatmap-label" style="border-right:1px solid var(--border);border-top:1px solid var(--border)"></div>';
  for(let h=0;h<24;h++)hmHTML+=`<div class="heatmap-label" style="text-align:center;border-top:1px solid var(--border)">${h}</div>`;
  hm.innerHTML=hmHTML;

  const fhm=document.getElementById('failHeatmapContainer');
  if(fhm){
    let fhmHTML='';
    const fmaxV=Math.max(...Object.values(hmFail),1);
    days.forEach(day=>{
      fhmHTML+=`<div class="heatmap-label" style="border-right:1px solid var(--border)">${day.slice(0,3)}</div>`;
      for(let h=0;h<24;h++){
        const k=`${day}_${h}`,v=(hmFail[k]||0),intensity=v/fmaxV;
        const bg=intensity>0?`rgba(224,69,69,${.1+intensity*.8})`:'#0c1018';
        const fdet=hmFailDet[k]||{app:0,remote:0,dock:0,hub:0};
        
        const ftooltip = `<div class="heatmap-tooltip">
  <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:bold;">
    <span>${day.toUpperCase()}</span><span>${h}:00</span>
  </div>
  <hr style="border:0; border-top:1px solid rgba(255,255,255,0.15); margin:4px 0 8px 0;">
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> HUB: ${fdet.hub}</div>
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> APP: ${fdet.app}</div>
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> DOCK: ${fdet.dock}</div>
  <div style="display:flex; align-items:center; margin:3px 0"><span style="display:inline-block; width:6px; height:6px; background:#888888; border-radius:50%; margin-right:6px;"></span> REMOTE: ${fdet.remote}</div>
</div>`;

        fhmHTML+=`<div class="heatmap-cell" style="background:${bg};color:${intensity>.5?'#fff':'var(--muted)'}"
          onclick="openLogCenter({hub:'${activeHub}',tab:'failures',dayFilter:'${day}',hourFilter:${h},context:{label:'${day} ${h}:00 - ${v} Failures',desc:'Failures in this time slot'}})">
          ${v||''}${ftooltip}</div>`}});
    fhmHTML+='<div class="heatmap-label" style="border-right:1px solid var(--border);border-top:1px solid var(--border)"></div>';
    for(let h=0;h<24;h++)fhmHTML+=`<div class="heatmap-label" style="text-align:center;border-top:1px solid var(--border)">${h}</div>`;
    fhm.innerHTML=fhmHTML;
  }
}

window.showFailHeatTip=function(el,day,h,v){
  let tip=document.createElement('div');tip.className='tooltip-box';
  tip.innerHTML=`<strong>${day} ${h}:00</strong><br><span style="color:var(--red);font-weight:700">${v} failure${v!==1?'s':''}</span><br><span style="font-size:9px;color:var(--blue)">Click → Log Center</span>`;
  el.style.position='relative';el.appendChild(tip);tip.style.position='absolute';tip.style.bottom='100%';tip.style.left='50%';tip.style.transform='translateX(-50%)';};

// ═══════════════════════════════════════════════════════════
//  SECTION 4 — SPEED TAB
// ═══════════════════════════════════════════════════════════
function renderSpeed(d){
  const s=d.speed;

  // Hub→App stats (avg/p50/p95) come from the backend, computed over ALL
  // ws_conf − rest_resp diffs in the selected period. The per-event list below
  // is derived from the recent samples and used only for the modal's table.
  const hubAppEvents=(s.local_e2e?.events||[]).map(e=>{
    const t1=tsMs(e.rest_resp),t2=tsMs(e.ws_conf);
    const pushLat=(t1&&t2&&t2>=t1)?(t2-t1):null;
    return{ts:e.ts,dev:e.dev,uc:e.uc,room:e.room,
      hub_dispatched:e.rest_resp,app_confirmed:e.ws_conf,
      lat:pushLat!==null?String(pushLat):null};
  }).filter(e=>e.lat!==null);

  const maxBar=Math.max(s.hub_snap_hub.p50||1,s.hub_app.p50||1,48,s.local_e2e.p50||1);

  const segs=[
    {key:'hub_snap_hub',name:'Hub &rarr; SNAP &rarr; Hub',desc:'Hub issues Matter cmd over Thread mesh &rarr; SNAP device activates &rarr; state reflected back to Hub.',val:s.hub_snap_hub,color:'var(--green)',target:TARGETS.hubSnap,
     cols:[{key:'ts',label:'Event Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'origin',label:'Origin'},{key:'matter_ts',label:'Matter CMD Sent'},{key:'snap_ts',label:'State Reflected'},{key:'lat',label:'Total (ms)'},{key:'room',label:'Room'}]},
    {key:'hub_app',name:'Hub &rarr; App (WebSocket Push)',desc:'Device state confirmed at Hub &rarr; Hub immediately pushes via WebSocket &rarr; App reflects new state.',val:s.hub_app,color:'var(--blue)',target:TARGETS.hubApp,
     derivedEvents:hubAppEvents,
     cols:[{key:'ts',label:'Event Time'},{key:'hub_dispatched',label:'State Confirmed at Hub'},{key:'app_confirmed',label:'App Received (ws_conf)'},{key:'lat',label:'Push (ms)'},{key:'dev',label:'Device'},{key:'room',label:'Room'}]},
    {key:'local_e2e',name:'App Control (Local)',desc:'Full round-trip on local Wi-Fi: App sends cmd &rarr; Hub receives &rarr; SNAP device activates &rarr; state pushed back to App via WebSocket',val:s.local_e2e,color:'var(--purple)',target:TARGETS.localE2e,
     cols:[{key:'ts',label:'Tap Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'cmd_sent',label:'CMD Sent'},{key:'rest_resp',label:'Hub ACK\'d'},{key:'ws_conf',label:'App Updated'},{key:'lat',label:'E2E (ms)'}]},
    {key:'remote_e2e',name:'App Control (Remote)',desc:'Full round-trip via Internet: App sends cmd remotely &rarr; Hub receives &rarr; SNAP device activates &rarr; state pushed back to App via WebSocket',val:s.remote_e2e,color:'var(--yellow)',target:TARGETS.remoteE2e,
     cols:[{key:'ts',label:'Tap Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'cmd_sent',label:'CMD Sent'},{key:'rest_resp',label:'Hub ACK\'d'},{key:'ws_conf',label:'App Updated'},{key:'lat',label:'E2E (ms)'}]}
  ];

  const el=document.getElementById('speedSegments');el.innerHTML='';
  segs.forEach(sg=>{
    const noData=sg.val.p50===0&&sg.val.avg===0;
    const div=document.createElement('div');div.className='speed-segment';
    
    const tgtText = sg.target ? `Target &lt;${sg.target.val}ms` : '';
    
    const makeBox = (label, value, isP50) => {
      const valColor = isP50 ? '#f39c12' : '#ffffff';
      return `<div style="border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 12px; width: 100px; text-align: center; background: rgba(0,0,0,0.2);">
        <div style="font-size: 10px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">${label}</div>
        <div style="font-size: 16px; font-weight: bold; color: ${valColor}; margin-bottom: 6px;">${value}ms</div>
        <div style="font-size: 9px; color: var(--muted); margin-top: 2px;">${tgtText}</div>
      </div>`;
    };

    let rightSide = '';
    if (noData) {
      rightSide = `<div style="font-size:12px; color:var(--muted); font-style:italic; padding-right:20px;">${sg.key==='remote_e2e'?'Not tracked yet':'No data'}</div>`;
    } else {
      rightSide = `<div style="display: flex; gap: 10px;">
        ${makeBox('P50', sg.val.p50, true)}
        ${makeBox('P95', sg.val.p95, false)}
        ${makeBox('AVG', Math.round(sg.val.avg), false)}
        ${makeBox('STD DEV', Math.round(sg.val.stddev), false)}
      </div>`;
    }

    const cleanDesc = sg.desc.replace(/ P50: \d+ms/,'').replace(/ This is the device round-trip itself.*/,'');
    
    div.innerHTML = `<div style="flex: 1; padding-right: 40px;">
      <div style="font-size: 13px; font-weight: bold; color: #fff; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${sg.name}</div>
      <div style="font-size: 11px; color: var(--muted); line-height: 1.5;">${cleanDesc}</div>
      <div style="font-size:10px;color:var(--blue);margin-top:8px;font-weight:600">Click for breakdown & Log Center →</div>
    </div>
    <div>${rightSide}</div>`;
    div.style.cursor='pointer';
    div.onclick=()=>{
      const row=(l,v)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0;white-space:nowrap">${l}</td><td>${v}</td></tr>`;
      // P50 above target = slow (used to colour the P50 figure in the modal).
      const isSlow = sg.target ? (sg.val.p50 > sg.target.val) : (sg.val.p50 > 1000);
      // No-data segments: explain WHY instead of showing stats/samples that would mislead
      if(noData){
        const why=sg.key==='remote_e2e'
          ?'No remote-control events were recorded in this period. This segment will populate once devices are controlled from outside the home network.'
          :'The hub is not recording timing values for this segment yet — every event reports 0ms (matter_command_ts and snap_state_change_ts carry identical timestamps). This is a hub-side data collection gap, not a dashboard issue. Latency stats will appear automatically once the hub firmware records real timestamps.';
        showModal(sg.name+' — No Data',`
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px 16px;margin-bottom:14px;font-size:11px;color:var(--muted);line-height:1.7">
            <strong style="color:#e8edf5">${sg.name}</strong><br>${sg.desc}
          </div>
          <div style="background:var(--surface2);border:1px solid var(--border2);border-radius:6px;padding:12px 16px;font-size:11px;line-height:1.7">
            <strong style="color:var(--yellow)">Why is there no data?</strong><br>
            <span style="color:var(--muted)">${why}</span>
          </div>`);
        return;
      }
      // Exact per-event formula behind each segment (matches docs/FORMULAS.md).
      const fMap={
        hub_snap_hub:{f:'snap_state_change_ts − matter_command_ts',src:'ha_logs · per event · 0 < gap ≤ 30s',note:'The device round-trip over the Thread mesh. Same for every origin (app, dock, automation, scene, hub UI). Stale/clock-skewed gaps > 30s excluded.'},
        hub_app:{f:'ws_confirmation_ts − rest_response_ts',src:'app_logs · per event · diff ≥ 0',note:'Time for the hub to push the confirmed state to the app over WebSocket.'},
        local_e2e:{f:'latency_ms = ws_confirmation_ts − tap_ts',src:'app_logs · Local App Control + Device Bind',note:'Full tap-to-confirmed round-trip on local Wi-Fi.'},
        remote_e2e:{f:'latency_ms = ws_confirmation_ts − tap_ts',src:'app_logs · Remote App Control',note:'Full round-trip when controlling from outside the home.'}};
      const fm=fMap[sg.key]||{f:'',src:'',note:''};
      let body=`<table style="font-size:12px;margin-bottom:14px">
        ${row('Segment',`<strong>${sg.name}</strong>`)}${row('Description',sg.desc)}
        ${row('Formula',`<code style="font-size:11px;color:#e8edf5">${fm.f}</code>`)}
        ${row('Source',`<span style="font-size:11px;color:var(--muted)">${fm.src}</span>`)}
        ${row('Aggregation',`<span style="font-size:11px;color:var(--muted)">P50/P95 = 50th/95th percentile · Avg = mean · Std Dev = σ, across all events in the period</span>`)}
        ${row('Notes',`<span style="font-size:11px;line-height:1.5;color:var(--muted)">${fm.note}</span>`)}
        ${row('Avg',sg.val.avg+'ms')}${row('P50',`<strong style="font-size:16px;color:${isSlow?'var(--yellow)':'#e8edf5'}">${sg.val.p50}ms</strong>`)}
        ${row('P95',`<span style="color:${sg.val.p95>1000?'var(--red)':sg.val.p95>500?'var(--yellow)':'var(--green)'}">${sg.val.p95}ms</span>`)}
        ${row('Std Dev',(sg.val.stddev!=null?Math.round(sg.val.stddev):0)+'ms')}
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
  const bucketColors=['#1fa355','#d4961f','#e07a20','#e04545','#b02a2a'];
  charts.latDist=mc('latDistChart',{type:'bar',data:{labels:bk,datasets:[{label:'Events',data:Object.values(b),backgroundColor:bucketColors,borderRadius:2}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      onClick:(e,els)=>{if(!els.length)return;
        const k=bk[els[0].index],evs=s.bucket_events[k],isProblematic=k.includes('800')||k.includes('>1000')||k.includes('600');
        const row=(l,v)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0">${l}</td><td>${v}</td></tr>`;
        let body=`<table style="font-size:12px;margin-bottom:14px">
          ${row('Latency Range',`<strong>${k}ms</strong>`)}
          ${row('Event Count',`<strong>${b[k]}</strong>`)}
          ${isProblematic?row('Assessment',`<span style="color:var(--red)">Above 600ms — degraded user experience</span>`):''}
        </table>`;
        if(evs&&evs.length){
          body+=`<div class="dbg-section-hdr" style="margin-bottom:8px">
            <span class="dbg-section-title">Sample Events</span>
            <button class="dbg-lc-link" onclick="(()=>{const f=parseBucketFilter('${k}');closeModal();openLogCenter(Object.assign({hub:'${activeHub}',tab:'all',context:{label:'Latency ${k}ms — ${b[k]} events',desc:'${activeHub.toUpperCase()} · ${b[k]} events in this latency range'}},f))})()">View in Log Center →</button>
          </div>`+evTable(evs,[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'src',label:'Source'},{key:'lat',label:'Latency'},{key:'room',label:'Room'}]);
        }
        showModal(`Latency ${k}ms — ${b[k]} Events`,body)},
      scales:{y:{title:{display:true,text:'Event Count'},beginAtZero:true},x:{title:{display:true,text:'Latency Range (ms)'}}}}});

  const speedDaily = (typeof _dailyArr !== 'undefined' && _dailyArr.length) ? _dailyArr : d.daily;
  const dates = speedDaily.map(r => {
    const parts = r.date.split('-');
    return parts.length === 3 ? `${parts[2]}-${parts[1]}` : r.date;
  });
  function interpolateArray(arr) {
    let lastVal = null, lastIdx = -1;
    const res = [...arr];
    for (let i = 0; i < res.length; i++) {
      if (res[i] !== null) {
        if (lastVal !== null && i - lastIdx > 1) {
          const step = (res[i] - lastVal) / (i - lastIdx);
          for (let j = lastIdx + 1; j < i; j++) res[j] = lastVal + step * (j - lastIdx);
        }
        lastVal = res[i]; lastIdx = i;
      }
    }
    return res;
  }
  const intAvg = interpolateArray(speedDaily.map(r=>r.avg));
  const intSd = interpolateArray(speedDaily.map(r=>r.sd));

  charts.avgSdTrend = mc('avgSdTrendChart', {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {label:'Avg Speed (ms)', data:intAvg, borderColor:'#3d82f0', backgroundColor:'rgba(61,130,240,0.1)', tension:0.3, fill:false, pointRadius:3, spanGaps:true},
        {label:'AVG + SD', data:intAvg.map((a,i)=>(a!=null&&intSd[i]!=null)?Math.round(a+intSd[i]):null), borderColor:'#1fa355', backgroundColor:'transparent', tension:0.3, fill:false, pointRadius:0, borderDash:[3,3], spanGaps:true},
        {label:'AVG - SD', data:intAvg.map((a,i)=>(a!=null&&intSd[i]!=null)?Math.max(0,Math.round(a-intSd[i])):null), borderColor:'#e04545', backgroundColor:'transparent', tension:0.3, fill:false, pointRadius:0, borderDash:[3,3], spanGaps:true}
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick:(e,els)=>{if(!els.length)return;showDayDebug(activeHub,els[0].index,'speed');},
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: function(context) {
            let tooltipEl = document.getElementById('chartjs-tooltip-avgsd');
            if (!tooltipEl) {
              tooltipEl = document.createElement('div');
              tooltipEl.id = 'chartjs-tooltip-avgsd';
              tooltipEl.className = 'tooltip-box';
              tooltipEl.style.pointerEvents = 'none';
              tooltipEl.style.background = 'rgba(0,0,0,0.8)';
              tooltipEl.style.border = 'none';
              tooltipEl.style.overflow = 'visible';
              document.body.appendChild(tooltipEl);
            }
            const tooltipModel = context.tooltip;
            if (tooltipModel.opacity === 0) {
              tooltipEl.style.opacity = 0;
              return;
            }
            tooltipEl.style.opacity = 1;
            
            if (tooltipModel.body) {
              const titleLines = tooltipModel.title || [];
              const dataPoint = tooltipModel.dataPoints[0];
              const avg = Math.round(dataPoint.raw);
              const sdRaw = intSd[dataPoint.dataIndex];
              const sdText = sdRaw != null ? `<div style="margin-top:4px; padding-left:30px">Std Dev : ${Math.round(sdRaw)} ms</div>` : '';
              
              tooltipEl.innerHTML = `
                <div style="font-weight:bold; margin-bottom:6px">${titleLines[0]}</div>
                <div style="display:flex; align-items:center; gap:6px">
                  <div style="width:24px; height:2px; background:#3d82f0; position:relative; display:flex; align-items:center; justify-content:center">
                     <div style="width:6px; height:6px; border-radius:50%; background:#3d82f0; border:1.5px solid var(--panel)"></div>
                  </div>
                  <span>Avg Speed : ${avg} ms</span>
                </div>
                ${sdText}
                <div style="position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); border-width:6px 6px 0 6px; border-style:solid; border-color:rgba(0,0,0,0.8) transparent transparent transparent;"></div>
              `;
            }
            const position = context.chart.canvas.getBoundingClientRect();
            tooltipEl.style.left = position.left + window.scrollX + tooltipModel.caretX + 'px';
            tooltipEl.style.top = position.top + window.scrollY + tooltipModel.caretY + 'px';
            tooltipEl.style.transform = 'translate(-50%, -100%)';
            tooltipEl.style.marginTop = '-10px';
          }
        }
      },
      scales: {
        y: { title: {display: true, text: 'Speed (ms)'}, beginAtZero: true },
        x: { title: {display: true, text: 'Date'} }
      }
    }
  });


  // Surface hub-initiated (direct) control in Speed-by-use-case. Hub actions have no
  // app round-trip, so their speed IS the Hub → SNAP → Hub device round-trip. Injected
  // into d.speed.per_uc so both the card and its drill-down (showUCDetail) see it.
  const _hd=d.usage&&d.usage.hub_direct_total;
  if(_hd&&s.hub_snap_hub&&(s.hub_snap_hub.p50||s.hub_snap_hub.avg)){
    s.per_uc['Hub Control (Direct)']={
      avg:s.hub_snap_hub.avg,p50:s.hub_snap_hub.p50,p95:s.hub_snap_hub.p95,
      stddev:s.hub_snap_hub.stddev,count:_hd,success:_hd,buckets:{},
      events:(d.hub_ha_ui_events||[]).slice(0,50).map(e=>({ts:e.ts,dev:e.dev,lat:'round-trip',src:'direct_hub_ui',room:e.room}))
    };
  }
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
    const sub1sC=sub1sPct>=95?'var(--green)':sub1sPct>=80?'var(--yellow)':'var(--red)';

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
        <div style="font-size:12px;font-weight:600;color:#e8edf5;line-height:1.3;padding-right:8px">${ucLabel(uc)}</div>
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

// Display-name mapping for use_case values — data keys stay raw so filters work
function ucLabel(uc){
  if(uc==='Docklet Press (App)')return'Docklet Press (Observed from App)';
  if(uc==='Local App Control')return'App Control (Local)';
  if(uc==='Remote App Control')return'App Control (Remote)';
  return uc;
}

// Named function — avoids closure/scope issues in onclick attributes
const UC_DESC={
  'Local App Control':'User controls device via mobile app over local Wi-Fi — App Tap → REST to Hub → SNAP device → WS push back to App',
  'Device Bind (App)':'User commissions or binds a device from the app — App → Hub (HA) → SNAP → WebSocket → App',
  'Docklet Press (App)':'User presses a physical dock button → Hub processes it → the app observes and records the resulting state change with its timing',
  'Remote App Control':'User controls device via mobile app over the Internet — same flow as local control but routed remotely',
  'Observed Change (App)':'State change the app observed but did not initiate — dock presses, automations, scene activations, manual switches',
  'Hub Control (Direct)':'Device driven directly from the hub\'s own Home Assistant screen (not the app). There is no app round-trip, so the speed shown is the Hub → SNAP → Hub device round-trip (snap_state_change_ts − matter_command_ts).'
};

window.showUCDetail=function(uc){
  const hub=activeHub,v=D[hub]?.speed?.per_uc?.[uc];if(!v)return;
  const desc=UC_DESC[uc]||uc;
  const lbl=ucLabel(uc);
  const row=(l,val)=>`<tr><td style="color:var(--muted);padding:5px 14px 5px 0;white-space:nowrap">${l}</td><td>${val}</td></tr>`;
  const lcOpts={hub,tab:'all',ucFilter:uc,context:{label:`${lbl} — Events`,desc:`${hub.toUpperCase()} · P50: ${v.p50}ms · P95: ${v.p95}ms · ${v.count} total`}};
  const stddevC=v.stddev>500?'var(--red)':v.stddev>200?'var(--yellow)':'var(--green)';
  let body=`<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:var(--muted);line-height:1.6">
    <strong style="color:#e8edf5">${lbl}</strong><br>${desc}
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
      <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all ${lbl} in Log Center →</button>
    </div>`+evTable(v.events,[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'lat',label:'Latency (ms)'},{key:'src',label:'Source'},{key:'room',label:'Room'}]);
  } else {
    body+=`<div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View ${lbl} events in Log Center →</button></div>`;
  }
  showModal(lbl+' — Speed Detail',body);
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

function renderReliability(d){
  const r=d.reliability_detail;
  
  // 1. Reliability Trend
  const _dArr=(_dailyArr&&_dailyArr.length)?_dailyArr:allSourceDaily(activeHub);
  const dates=_dArr.map(r=>{ const p=r.date.split('-'); return p[2]+'-'+p[1]; });
  const relTrendExtTooltip = (context) => {
    let tooltipEl = document.getElementById('chartjs-tooltip-relTrend');
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'chartjs-tooltip-relTrend';
      tooltipEl.className = 'tooltip-box';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.background = 'rgba(0,0,0,0.8)';
      tooltipEl.style.border = 'none';
      tooltipEl.style.overflow = 'visible';
      document.body.appendChild(tooltipEl);
    }
    const {chart, tooltip} = context;
    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = 0;
      return;
    }
    tooltipEl.style.opacity = 1;
    if (tooltip.body) {
      const val = tooltip.dataPoints[0].parsed.y;
      tooltipEl.innerHTML = `
        <div style="font-weight:bold; margin-bottom:6px">${tooltip.title[0]}</div>
        <div style="display:flex; align-items:center; gap:6px">
          <div style="width:24px; height:2px; background:#1fa355; position:relative; display:flex; align-items:center; justify-content:center">
            <div style="width:6px; height:6px; background:#1fa355; border-radius:50%; border:1.5px solid var(--panel)"></div>
          </div>
          <span>Reliability %: ${val}</span>
        </div>
        <div style="position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); border-width:6px 6px 0 6px; border-style:solid; border-color:rgba(0,0,0,0.8) transparent transparent transparent;"></div>
      `;
    }
    const rect = chart.canvas.getBoundingClientRect();
    tooltipEl.style.left = rect.left + window.scrollX + tooltip.caretX + 'px';
    tooltipEl.style.top = rect.top + window.scrollY + tooltip.caretY + 'px';
    tooltipEl.style.transform = 'translate(-50%, -100%)';
    tooltipEl.style.marginTop = '-10px';
  };

  charts.relTrend=mc('relTrendChart',{type:'line',data:{labels:dates,datasets:[
    {label:'Reliability percentage',data:_dArr.map(r=>r.rel),borderColor:'#1fa355',tension:.3,pointRadius:3,fill:true,backgroundColor:'rgba(31,163,85,.06)'},
    {label:'Target %',data:dates.map(()=>97),borderColor:'rgba(220,232,248,.25)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false,tension:0}]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      onClick:(e,els)=>{if(!els.length)return;
        const day=_dArr[els[0].index];
        openLogCenter({hub:activeHub,tab:'failures',filters:{search:day.date},context:{label:`Failures on ${day.date}`,desc:`${activeHub.toUpperCase()} Ã‚Â· Reliability was ${day.rel}%`}});},
      plugins:{
        legend:{display:false},
        tooltip:{enabled:false, external:relTrendExtTooltip}
      },
      scales:{y:{title:{display:true,text:'Reliability %'},min:0,max:102},x:{title:{display:true,text:'Date'}}}}});

  const srcContainer = document.getElementById('srcRelCards');
  const mkCard = (title, rel, fail, total, target, isLast, srcKey) => {
    const isRed = rel < target;
    const rc = isRed ? 'var(--red)' : (rel === 100 ? 'var(--green)' : 'var(--yellow)');
    const border = isLast ? 'none' : '1px solid rgba(255,255,255,0.05)';
    const click = srcKey ? ` class="clickable" style="cursor:pointer" onclick="showSrcRelModal('${srcKey}',${total},${total-fail},${fail},${rel})"` : '';
    return `<div${click} style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:${border}${srcKey?';cursor:pointer':''}">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text);letter-spacing:0.5px;margin-bottom:4px">${title}${srcKey?' <span style="font-size:9px;color:var(--blue);font-weight:600">Inspect →</span>':''}</div>
        <div style="font-size:11px;color:var(--muted)">${fail} Failed &nbsp;&bull;&nbsp; ${total} Total</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;color:${rc};line-height:1">${rel}%</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">Target: >=${target}%</div>
      </div>
    </div>`;
  };
  
  const appRel = r.app_trigger_feedback;
  const appTot = r.app_triggers || 0;
  const appFail = appTot - (r.app_feedbacks || 0);

  const dockStats=r.dock_stats||[];
  const dockTot=dockStats.reduce((s,dk)=>s+dk.total,0);
  const dockSucc=dockStats.reduce((s,dk)=>s+dk.success,0);
  const dockFail = dockTot - dockSucc;
  const dockRel=dockTot>0?+(100*dockSucc/dockTot).toFixed(2):(r.dock_trigger_feedback||0);

  // Hub = one source combining direct hub-UI control + automation runs + scene
  // activations (backend src_rel['Hub']). Not split into separate "Direct HA" /
  // "automation/scene" rows — just "Hub".
  const hubV = r.src_rel && r.src_rel['Hub'] ? r.src_rel['Hub'] : {rel:100, fail:0, total:0};

  srcContainer.innerHTML =
    mkCard('APP CONTROL', appRel, appFail, appTot, 97, false, 'App Control') +
    mkCard('DOCK CONTROL', dockRel, dockFail, dockTot, 97, false, 'Dock Control') +
    mkCard('HUB', hubV.rel, hubV.fail, hubV.total, 97, true, 'Hub');

  // 3. Failures by Reason (Donut Chart)
  if (charts.failReason) { charts.failReason.destroy(); }
  if (d.fail_by_reason && Object.keys(d.fail_by_reason).length > 0) {
    const sorted = Object.entries(d.fail_by_reason).sort((a,b)=>b[1].count-a[1].count);
    const labels = sorted.map(s => s[0]);
    const data = sorted.map(s => s[1].count);
    
    const palette = ['#e07a20','#d4961f','#1f7aa3','#9345e0','#4f627d'];
    let pIdx = 0;
    const finalColors = labels.map(label => {
      if (label === 'DEVICE_UNAVAILABLE' || label === 'DEVICE_OFFLINE') {
        return '#e04545'; // Explicit red
      }
      // If we already used all palette colors, loop around
      return palette[pIdx++ % palette.length];
    });
    
    charts.failReason = new Chart(document.getElementById('failReasonChart').getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: finalColors,
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: { legend: { display: false } }
      }
    });

    const leg = document.getElementById('failReasonLegend');
    leg.innerHTML = sorted.map((s, i) => {
      const c = finalColors[i];
      return `<div class="clickable" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:6px;background:rgba(255,255,255,0.02);border:1px solid var(--border2)" onclick="showReasonModal('${s[0]}',${s[1].count})">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${c}"></span>
          <span style="font-size:12px;color:#e8edf5;font-weight:600">${s[0]}</span>
        </div>
        <strong style="color:${c};font-size:14px">${s[1].count}</strong>
      </div>`;
    }).join('');
  } else {
    document.getElementById('failReasonLegend').innerHTML = '<div style="color:var(--muted);font-size:12px">No failures recorded.</div>';
  }

  // 4. Dock Reliability Table
  const drt = document.getElementById('dockRelTable');
  if(drt){
    window._dockStats = dockStats.slice();
    window.renderDockTable = function(sortMode = 'most') {
        const stats = window._dockStats;
        if(stats.length === 0){
          drt.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);font-size:11px;padding:14px">No dock failures recorded</td></tr>';
          return;
        }
        
        // Hide popups
        const p = document.getElementById('dockSortPopup');
        if(p) p.style.display = 'none';
        const p2 = document.getElementById('dockInfoPopup');
        if(p2) p2.style.display = 'none';

        // Update dots
        const md = document.getElementById('sortMostDot');
        const ld = document.getElementById('sortLeastDot');
        if(md) md.style.background = sortMode === 'most' ? 'var(--blue)' : 'transparent';
        if(ld) ld.style.background = sortMode === 'least' ? 'var(--blue)' : 'transparent';

        drt.innerHTML = stats.sort((a,b)=> {
            const failA = a.total - a.success;
            const failB = b.total - b.success;
            if (sortMode === 'most') {
                return failB - failA;
            } else {
                return failA - failB;
            }
        }).map(dk => {
          const dkFail = dk.total - dk.success;
          const rel = dk.total > 0 ? +(100*dk.success/dk.total).toFixed(2) : 0;
          const rc = relTag(rel);
          const cvar = rc === 'tag-red' ? 'var(--red)' : (rc === 'tag-yellow' ? 'var(--yellow)' : 'var(--green)');
          const stateText = rel < 93 ? 'Critical' : (rel < 97 ? 'Warning' : 'Healthy');
          const stateHtml = `<div style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9999px;font-size:11px;font-weight:600;background:rgba(0,0,0,0.3);color:${cvar};border:1px solid ${cvar};margin:0"><span style="width:7px;height:7px;border-radius:50%;background:${cvar}"></span>${stateText}</div>`;
          return `<tr class="clickable" onclick="showDockModal('${dk.dock_id}')">
            <td style="font-family:monospace;font-size:12px;color:var(--text);font-weight:600">${dk.dock_id}</td>
            <td style="text-align:center;font-size:13px">${dk.total}</td>
            <td style="text-align:center;font-weight:700;color:var(--text);font-size:13px">${dk.success}</td>
            <td style="text-align:center;font-weight:700;color:var(--text);font-size:13px">${dkFail}</td>
            <td style="color:${cvar};font-weight:700;font-size:13px">${rel}%</td>
            <td>${stateHtml}</td>
            <td><button style="background:transparent;border:1px solid var(--blue);color:var(--blue);padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-block;transition:all 0.2s;white-space:nowrap;" onmouseover="this.style.background='var(--blue)';this.style.color='#fff'" onmouseout="this.style.background='transparent';this.style.color='var(--blue)'">Inspect &rarr;</button></td>
          </tr>`;
        }).join('');
    };
    renderDockTable('most');
  }

  // 5. Failures by Device Table
  window._failDevData = [];
  if(d.devices && d.devices.length){
    window._failDevData = d.devices
      .filter(dev => dev.total > dev.success)
      .map(dev => {
        const failC = dev.total - dev.success;
        const reasons = (d.fail_by_device && d.fail_by_device[dev.id]) ? d.fail_by_device[dev.id].reasons : {};
        return { ...dev, failC, reasons };
      })
      .sort((a,b) => {
        if (a.rel !== b.rel) return a.rel - b.rel;
        return b.failC - a.failC;
      });
  }
  window._failDevLimit = 5;
  renderFailDevTable();
}

window._failDevSortDir = 'most';
window.renderFailDevTable = function(sortMode) {
  if (sortMode) {
    window._failDevSortDir = sortMode;
    const ov = document.getElementById('failSortOverlay');
    const po = document.getElementById('failSortPopup');
    if(ov) ov.style.display = 'none';
    if(po) po.style.display = 'none';
    
    const mostDot = document.getElementById('failSortMostDot');
    const leastDot = document.getElementById('failSortLeastDot');
    if(mostDot && leastDot) {
      mostDot.style.background = sortMode === 'most' ? 'var(--blue)' : 'transparent';
      leastDot.style.background = sortMode === 'least' ? 'var(--blue)' : 'transparent';
    }
  }

  const fdt = document.getElementById('failDevTable');
  if(!fdt) return;
  
  if(!window._failDevData || window._failDevData.length === 0){
    fdt.innerHTML = '<tr><td colspan="9" style="color:var(--muted);font-size:11px;text-align:center;padding:14px">No device failures recorded</td></tr>';
    return;
  }
  
  const sorted = window._failDevData.slice().sort((a, b) => {
    return window._failDevSortDir === 'most' ? (b.failC - a.failC) : (a.failC - b.failC);
  });
  
  fdt.innerHTML = sorted.map(dev => {
    const rc = relTag(dev.rel);
    const cvar = rc === 'tag-red' ? 'var(--red)' : (rc === 'tag-yellow' ? 'var(--yellow)' : 'var(--green)');
    const devShort = (dev.id||'').replace('light.snap_','').replace('switch.snap_','');
    
    const nr = dev.reasons['NO_RESPONSE'] || 0;
    const to = dev.reasons['TIMEOUT'] || 0;
    const doff = dev.reasons['DEVICE_OFFLINE'] || 0;
    const dun = dev.reasons['DEVICE_UNAVAILABLE'] || 0;
    const tmf = dev.reasons['THREAD_MESH_FAIL'] || 0;
    
    return `<tr class="clickable" onclick="showDevModal('${dev.id}','${dev.room}',${dev.total},${dev.rel},${dev.p50},${dev.failC})">
      <td style="font-family:monospace;font-size:12px;color:var(--text);font-weight:600">${devShort}</td>
      <td style="color:${cvar};font-weight:700;font-size:13px;text-align:center">${dev.rel}%</td>
      <td style="text-align:center;font-weight:700;color:var(--red);font-size:13px">${dev.failC}</td>
      <td style="text-align:center;font-size:13px">${nr}</td>
      <td style="text-align:center;font-size:13px">${to}</td>
      <td style="text-align:center;font-size:13px">${doff}</td>
      <td style="text-align:center;font-size:13px">${dun}</td>
      <td style="text-align:center;font-size:13px">${tmf}</td>
      <td><button style="background:transparent;border:1px solid var(--blue);color:var(--blue);padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;display:inline-block;transition:all 0.2s;white-space:nowrap;" onmouseover="this.style.background='var(--blue)';this.style.color='#fff'" onmouseout="this.style.background='transparent';this.style.color='var(--blue)'">Inspect &rarr;</button></td>
    </tr>`;
  }).join('');
}

window.showSrcRelModal=function(src,total,success,fail,rel){
  const hub=activeHub;
  const lbl=ucLabel(src);
  const pred=srcPred(src);
  const fails=failuresFor(hub,pred);
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Source',`<strong>${lbl}</strong>`)}
    ${row('Total Events',`<strong style="font-size:16px">${total}</strong>`)}
    ${row('Successful',`<strong style="color:var(--green)">${success}</strong>`)}
    ${row('Failed',`<strong style="color:var(--red);font-size:16px">${fail}</strong>`)}
    ${row('Reliability',`<strong style="color:${relColor(rel)};font-size:16px">${rel}%</strong>`)}
  </table>`;
  if(fail>0){
    const lcOpts={hub,tab:'failures',srcFilter:src,context:{label:`Failures — ${lbl}`,desc:`${fail} failed events from ${lbl} on ${hub.toUpperCase()}`}};
    body+=`<div class="dbg-section">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Failure Events for ${lbl} (${fails.length})</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View all in Log Center →</button>
      </div>
      ${evTable(fails.slice(0,10),[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'reason',label:'Reason'},{key:'lat',label:'Latency'}])}
      ${fails.length>10?`<p style="font-size:10px;color:var(--muted);margin-top:6px">Showing 10 of ${fails.length}.</p>`:''}
    </div>`;
  } else {
    body+=`<div class="dbg-section"><div class="dbg-empty">No failures for this source.</div></div>`;
  }
  showModal(`${lbl} — Reliability Debug`,body);
};

// Dock reliability row → drill-down (was referenced by the table but never defined).
window.showDockModal=function(dockId){
  const hub=activeHub;
  const dk=(window._dockStats||[]).find(x=>x.dock_id===dockId);
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  if(!dk){showModal('Dock — '+dockId,'<div class="dbg-empty">No data for this dock in the selected period.</div>');return;}
  const fail=dk.total-dk.success, rel=dk.total?+(100*dk.success/dk.total).toFixed(2):0;
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Dock',`<strong style="font-family:monospace">${dk.dock_id}</strong>`)}
    ${row('Total Presses',`<strong style="font-size:16px">${dk.total}</strong>`)}
    ${row('Successful',`<strong style="color:var(--green)">${dk.success}</strong>`)}
    ${row('Failed',`<strong style="color:var(--red);font-size:16px">${fail}</strong>`)}
    ${row('Reliability',`<strong style="color:${relColor(rel)};font-size:16px">${rel}%</strong>`)}
    ${row('How it\'s measured','A press = a dock call_service tagged with this dock_id (ha_logs). Success = its context_id produced an on/off device state.')}
  </table>`;
  if(dk.docklets&&dk.docklets.length){
    body+=`<div class="dbg-section"><div class="dbg-section-hdr"><span class="dbg-section-title">Per-docklet breakdown</span></div>`+
      evTable(dk.docklets.map(x=>({docklet:x.docklet_id,total:x.total,success:x.success,fail:x.total-x.success,rel:(x.total?+(100*x.success/x.total).toFixed(1):0)+'%'})),
        [{key:'docklet',label:'Docklet'},{key:'total',label:'Total'},{key:'success',label:'OK'},{key:'fail',label:'Fail'},{key:'rel',label:'Reliability'}])+`</div>`;
  }
  const lcOpts={hub,tab:'all',srcFilter:'Dock Control',filters:{search:dockId},context:{label:`Dock ${dockId}`,desc:`${hub.toUpperCase()} · ${dk.total} presses · ${rel}% reliable`}};
  body+=`<div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">Inspect dock events in Log Center →</button></div>`;
  showModal(`Dock Reliability — ${dockId}`,body);
};

// Failures-by-device row → drill-down (was referenced by the table but never defined).
window.showDevModal=function(id,room,total,rel,p50,failC){
  const hub=activeHub;
  const fails=failuresFor(hub,f=>f.dev===id);
  const reasons=(D[hub].fail_by_device&&D[hub].fail_by_device[id])?D[hub].fail_by_device[id].reasons:{};
  const reasonStr=Object.keys(reasons).length?Object.entries(reasons).map(([k,v])=>`${k}: <strong>${v}</strong>`).join(' &nbsp;·&nbsp; '):'—';
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let body=`<table style="font-size:12px;margin-bottom:4px">
    ${row('Device',`<strong style="font-family:monospace">${id}</strong>`)}
    ${row('Room',room||'—')}
    ${row('Total Commands',`<strong style="font-size:16px">${total}</strong>`)}
    ${row('Reliability',`<strong style="color:${relColor(rel)};font-size:16px">${rel}%</strong>`)}
    ${row('Failures',`<strong style="color:var(--red);font-size:16px">${failC}</strong>`)}
    ${row('Median (P50)',`${p50}ms`)}
    ${row('Failure Reasons',`<span style="font-size:11px">${reasonStr}</span>`)}
  </table>`;
  const lcOpts={hub,tab:'failures',filters:{search:(id||'').split('.').pop()},context:{label:`Failures — ${id}`,desc:`${hub.toUpperCase()} · ${failC} of ${total} commands failed`}};
  body+=`<div class="dbg-section">
    <div class="dbg-section-hdr">
      <span class="dbg-section-title">Failure Events (${fails.length} sampled)</span>
      <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">Inspect in Log Center →</button>
    </div>
    ${fails.length?evTable(fails.slice(0,12),[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'reason',label:'Reason'},{key:'lat',label:'Latency'}]):`<div class="dbg-empty">No failure events in sample. Click "Inspect in Log Center →" to search all events for this device.</div>`}
    ${fails.length>12?`<p style="font-size:10px;color:var(--muted);margin-top:6px">Showing 12 of ${fails.length}.</p>`:''}
  </div>`;
  showModal(`Device — ${id}`,body);
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
      ${evTable(v.events,[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'uc',label:'Use Case'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'lat',label:'Latency'}])}
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
    ${evTable(fails.slice(0,10),[{key:'ts',label:'Time'},{key:'uc',label:'Use Case'},{key:'room',label:'Room'},{key:'src',label:'Source'},{key:'reason',label:'Reason'},{key:'lat',label:'Latency'}])}
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
    ${row('Latency',f.lat&&f.lat!=='N/A'?`<span style="color:var(--red);font-weight:600">${f.lat}ms</span>`:'N/A')}
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
    </div>${evTable(fails.slice(0,8),[{key:'ts',label:'Time'},{key:'uc',label:'UC'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'reason',label:'Reason'},{key:'lat',label:'Latency'}])}</div>`;

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
  const u=d.usage||{app:0,remote:0,docklet:0,direct:0,app_ratio:0,dock_ratio:0,observed_per_day:0,scene_per_day:0,scene_total:0,snap_devices:0};
  // Usage share is a 3-way split: App vs Dock vs Hub (Hub = scenes + automations +
  // direct hub control). The ratios sum to 100%.
  const hubUse=(u.hub_total!=null)?u.hub_total:((u.hub_scene_total||0)+(u.hub_auto_total||0)+(u.hub_direct_total||0));
  const hTotal=(u.app||0)+(u.docklet||0)+hubUse;
  document.getElementById('usageKPIs').innerHTML=`
    <div class="kpi" onclick="showUsageModal('auto')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Automation / Day<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_auto')">ⓘ</button></div><div class="value">${u.hub_auto_per_day||0}</div><div class="formula-ref">= ${u.hub_auto_total||0} hub-recorded ÷ ${activeDaysCount()} days</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="showUsageModal('scene')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Scene / Day<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_scene')">ⓘ</button></div><div class="value">${u.hub_scene_per_day||0}</div><div class="formula-ref">= ${u.hub_scene_total||0} hub-recorded ÷ ${activeDaysCount()} days</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="showUsageModal('devices')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Active SNAP Devices<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_snap_devices')">ⓘ</button></div><div class="value">${u.snap_devices||0}</div><div class="formula-ref">Physical devices active this period</div><div class="sub">Click for device list</div></div>
    <div class="kpi" onclick="showUsageModal('app')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">App Usage Ratio<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_app')">ⓘ</button></div><div class="value">${u.app_ratio||0}%</div><div class="formula-ref">= ${u.app||0} ÷ ${hTotal}</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="showUsageModal('dock')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Dock Usage Ratio<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_dock')">ⓘ</button></div><div class="value">${u.dock_ratio||0}%</div><div class="formula-ref">= ${u.docklet||0} ÷ ${hTotal}</div><div class="sub">Click for breakdown</div></div>
    <div class="kpi" onclick="showUsageModal('ha_ui')"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Direct Hub Control<button class="info-btn" onclick="event.stopPropagation();showInfo('usage_ha_ui')">ⓘ</button></div><div class="value">${u.hub_direct_total||0}</div><div class="formula-ref">= ${u.hub_direct_per_day||0}/day · from hub HA screen</div><div class="sub">Click for breakdown</div></div>`;
  const hubSA=(u.hub_total!=null)?u.hub_total:((u.hub_scene_total||0)+(u.hub_auto_total||0)+(u.hub_direct_total||0));
  const srcLabels=['App (Local)','Remote App','Dock Control','Hub'];
  charts.src=mc('srcChart',{type:'doughnut',data:{labels:srcLabels,datasets:[{data:[u.app||0,u.remote||0,u.docklet||0,hubSA],backgroundColor:['#3d82f0','#1fa355','#d4961f','#9d65c9'],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      onClick:(e,els)=>{if(!els.length)return;
        const src=srcLabels[els[0].index];
        openLogCenter({hub:activeHub,tab:'all',srcFilter:src,context:{label:`${src} Events`,desc:`${activeHub.toUpperCase()} · all events from this source`}});},
      plugins:{legend:{display:false},
          tooltip: {
            callbacks: {
              label: (ctx) => {
                let v = ctx.parsed;
                let total = ctx.chart.data.datasets[0].data.reduce((a,b)=>a+b, 0);
                let pct = total > 0 ? ((v/total)*100).toFixed(1) : 0;
                return ` Events: ${v} | Percentage: ${pct}%`;
              }
            }
          }}}});

  const dock_usage = d.dock_usage || { total: 0, by_action: {} };
  const totalDockEvents = dock_usage.total;
  
  const allEvs = buildEventPool(activeHub);
  const dockEvs = allEvs.filter(e => e.src === 'docklet');
  const uniqueDocks = new Set(dockEvs.map(e => e.dock).filter(x => x && x !== '-')).size;
  const uniqueDocklets = new Set(dockEvs.map(e => e.dev).filter(x => x && x !== '-')).size;
  
  let toggleCnt = 0;
  let incCnt = 0;
  let decCnt = 0;
  for (const [k, v] of Object.entries(dock_usage.by_action)) {
    const a = (k || '').toLowerCase();
    if(a.includes('toggle')) toggleCnt += v;
    else if(a.includes('inc')) incCnt += v;
    else if(a.includes('dec')) decCnt += v;
  }

  const dockUsagePanel = document.getElementById('dockUsagePanel');
  if (dockUsagePanel) {
    if (totalDockEvents > 0) {
      dockUsagePanel.style.display = 'block';
      dockUsagePanel.style.padding = '16px';
      dockUsagePanel.innerHTML = `
        <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
          DOCK USAGE
          <button class="info-btn" style="border:none;background:none;padding:0;margin-left:6px" onclick="event.stopPropagation();showInfo('dock_usage')">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          </button>
        </div>
        <hr style="border:0;border-top:1px solid var(--border);margin:0 0 16px 0">
        
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:16px;">
          <div class="kpi" style="padding:16px;text-align:center;margin-bottom:0;cursor:default;background:rgba(0,0,0,0.25)">
            <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px">TOTAL DOCK EVENTS</div>
            <div style="font-size:24px;font-weight:700">${totalDockEvents}</div>
          </div>
          <div class="kpi" style="padding:16px;text-align:center;margin-bottom:0;cursor:default;background:rgba(0,0,0,0.25)">
            <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px">TOTAL DOCKS</div>
            <div style="font-size:24px;font-weight:700">${uniqueDocks}</div>
          </div>
          <div class="kpi" style="padding:16px;text-align:center;margin-bottom:0;cursor:default;background:rgba(0,0,0,0.25)">
            <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px">ACTIVE DOCKLETS</div>
            <div style="font-size:24px;font-weight:700">${uniqueDocklets}</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="kpi" style="padding:16px;margin-bottom:0;cursor:default">
            <div style="font-size:12px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between">
              <span>ACTION TYPE</span><span>COUNT</span>
            </div>
            <hr style="border:0;border-top:1px solid var(--border);margin:0 0 12px 0">
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px">
              <div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;background:#3d82f0;border-radius:2px"></div>Toggle</div>
              <strong>${toggleCnt}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px">
              <div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;background:#1fa355;border-radius:2px"></div>Increment</div>
              <strong>${incCnt}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px">
              <div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;background:#e04545;border-radius:2px"></div>Decrement</div>
              <strong>${decCnt}</strong>
            </div>
          </div>
          <div class="kpi" style="padding:16px;margin-bottom:0;cursor:default;display:flex;align-items:center;justify-content:center">
            <div class="chart-box" style="height:120px;width:100%;position:relative"><canvas id="dockActionChart"></canvas></div>
          </div>
        </div>
      `;
      
      setTimeout(() => {
        if(charts.dockAction) charts.dockAction.destroy();
        const ctx = document.getElementById('dockActionChart');
        if(ctx) {
          charts.dockAction = mc('dockActionChart', {
            type: 'pie',
            data: {
              labels: ['Toggle', 'Increment', 'Decrement'],
              datasets: [{
                data: [toggleCnt, incCnt, decCnt],
                backgroundColor: ['#3d82f0', '#1fa355', '#e04545'],
                borderWidth: 0
              }]
            },
            options: { 
              responsive: true, 
              maintainAspectRatio: false, 
              plugins: { 
                legend: { position: 'right', labels: { color: 'rgba(255,255,255,0.7)', font: { size: 10 } } },
                tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw}` } }
              } 
            }
          });
        }
      }, 0);
    } else {
      dockUsagePanel.style.display = 'none';
    }
  }

        // Usage Trend Chart
        const ds = (_dailyArr&&_dailyArr.length)?_dailyArr:allSourceDaily(activeHub);
    if(charts.usageTrend) charts.usageTrend.destroy();
    
    const usageTrendExtTooltip = (context) => {
      let tooltipEl = document.getElementById('chartjs-tooltip-usageTrend');
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'chartjs-tooltip-usageTrend';
        tooltipEl.className = 'tooltip-box';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.background = 'rgba(0,0,0,0.8)';
        tooltipEl.style.border = 'none';
        tooltipEl.style.overflow = 'visible';
        document.body.appendChild(tooltipEl);
      }
      const {chart, tooltip} = context;
      if (tooltip.opacity === 0) {
        tooltipEl.style.opacity = 0;
        return;
      }
      tooltipEl.style.opacity = 1;
      if (tooltip.body) {
        const title = tooltip.title[0] || '';
        let innerHtml = `<div style="font-weight:bold; margin-bottom:6px"></div>`;
        const colors = {'HUB':'#9d65c9','APP':'#3d82f0','DOCK':'#d4961f'};
        
        let total = 0;
        tooltip.dataPoints.forEach(dp => total += dp.parsed.y);

        tooltip.dataPoints.forEach(dp => {
          const lbl = dp.dataset.label;
          const val = dp.parsed.y;
          const c = colors[lbl] || '#fff';
          let pct = total > 0 ? ((val/total)*100).toFixed(1) : 0;
          innerHtml += `
            <div style="margin-bottom:6px">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px; font-size:12px; font-weight:bold">
                <div style="width:10px; height:10px; background:${c};"></div> ${lbl}
              </div>
              <div style="font-size:11px; color:var(--muted); padding-left:16px">Events: ${val}, Percentage: ${pct}%</div>
            </div>
          `;
        });
        innerHtml += `<div style="position:absolute; bottom:-6px; left:50%; transform:translateX(-50%); border-width:6px 6px 0 6px; border-style:solid; border-color:rgba(0,0,0,0.8) transparent transparent transparent;"></div>`;
        tooltipEl.innerHTML = innerHtml;
      }
      const rect = chart.canvas.getBoundingClientRect();
      tooltipEl.style.left = rect.left + window.scrollX + tooltip.caretX + 'px';
      tooltipEl.style.top = rect.top + window.scrollY + tooltip.caretY + 'px';
      tooltipEl.style.transform = 'translate(-50%, -100%)';
      tooltipEl.style.marginTop = '-10px';
    };

    const trendLabels = ds.map(x=>{ const p = x.date.split('-'); return p[2]+'-'+p[1]; });
    const trendHub = ds.map(x=>(x.hub||0));
    const trendApp = ds.map(x=>(x.app||0));
    const trendDock = ds.map(x=>(x.dock||0));
    charts.usageTrend = mc('usageTrendChart',{
      type:'bar',
      data:{
        labels:trendLabels,
        datasets:[
          {label:'HUB',data:trendHub,backgroundColor:'#9d65c9',},
          {label:'APP',data:trendApp,backgroundColor:'#3d82f0',},
          {label:'DOCK',data:trendDock,backgroundColor:'#d4961f',}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        onClick:(e,els)=>{if(!els.length)return;const x=ds[els[0].index];if(!x)return;
          const tot=(x.app||0)+(x.dock||0)+(x.hub||0);
          const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
          const lcOpts={hub:activeHub,tab:'all',filters:{search:x.date},context:{label:`Usage on ${x.date}`,desc:`${activeHub.toUpperCase()} · ${tot} events`}};
          let body=`<table style="font-size:12px;margin-bottom:4px">
            ${row('Date',`<strong>${x.date}</strong>`)}
            ${row('App',`<strong style="color:#3d82f0">${x.app||0}</strong>`)}
            ${row('Dock',`<strong style="color:#d4961f">${x.dock||0}</strong>`)}
            ${row('Hub',`<strong style="color:#9d65c9">${x.hub||0}</strong> <span style="font-size:10px;color:var(--muted)">(direct + automations + scenes)</span>`)}
            ${row('Total',`<strong style="font-size:16px">${tot}</strong>`)}
          </table>
          <div class="modal-cta"><button class="modal-cta-btn" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View ${x.date} in Log Center →</button></div>`;
          showModal(`Usage — ${x.date}`,body);},
        scales:{x:{title:{display:true,text:'Date'},stacked:true,grid:{display:false}},y:{title:{display:true,text:'Events'},stacked:true,grid:{color:'rgba(255,255,255,0.05)'}}},
        plugins:{
          legend:{display:false},
          tooltip:{enabled:false, mode:'index', intersect:false, external:usageTrendExtTooltip}
        }
      }
    });

    // ACTIVE SNAP DEVICES
    const snapBtn = document.getElementById('activeSnapBtn');
    if(snapBtn) {
      snapBtn.innerHTML = `ACTIVE SNAP DEVICES - ${u.snap_devices||0}<button class="info-btn" style="border:none;background:none;padding:0;margin-left:6px" onclick="event.stopPropagation();showInfo(\'usage_snap_devices\')"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button>`;
      snapBtn.onmouseover = () => snapBtn.style.background = 'rgba(255,255,255,0.1)';
      snapBtn.onmouseout = () => snapBtn.style.background = 'transparent';
      snapBtn.style.transition = 'background 0.2s';
      snapBtn.onclick = () => showInfo('usage_snap_devices');
    }

    // 5 KPI CARDS
    const kpisEl = document.getElementById('usageKPIs');
    if(kpisEl) {
      kpisEl.innerHTML = `
        <div class="kpi" style="padding:16px;cursor:pointer" onclick="showUsageModal('auto')">
          <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">AUTOMATION / DAY<button class="info-btn" style="border:none;background:none;padding:0;margin-left:4px" onclick="event.stopPropagation();showInfo('usage_auto')"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button></div><hr style="border:0;border-top:1px solid var(--border);margin:0 0 12px 0">
          <div style="font-size:24px;font-weight:700">${u.hub_auto_per_day||0}</div>
        </div>
        <div class="kpi" style="padding:16px;cursor:pointer" onclick="showUsageModal('scene')">
          <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">SCENE / DAY<button class="info-btn" style="border:none;background:none;padding:0;margin-left:4px" onclick="event.stopPropagation();showInfo('usage_scene')"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button></div><hr style="border:0;border-top:1px solid var(--border);margin:0 0 12px 0">
          <div style="font-size:24px;font-weight:700">${u.hub_scene_per_day||0}</div>
        </div>
        <div class="kpi" style="padding:16px;cursor:pointer" onclick="showUsageModal('app')">
          <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">APP USAGE RATIO<button class="info-btn" style="border:none;background:none;padding:0;margin-left:4px" onclick="event.stopPropagation();showInfo('usage_app')"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button></div><hr style="border:0;border-top:1px solid var(--border);margin:0 0 12px 0">
          <div style="font-size:24px;font-weight:700">${u.app_ratio||0}%</div>
        </div>
        <div class="kpi" style="padding:16px;cursor:pointer" onclick="showUsageModal('dock')">
          <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">DOCK USAGE RATIO<button class="info-btn" style="border:none;background:none;padding:0;margin-left:4px" onclick="event.stopPropagation();showInfo('usage_dock')"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button></div><hr style="border:0;border-top:1px solid var(--border);margin:0 0 12px 0">
          <div style="font-size:24px;font-weight:700">${u.dock_ratio||0}%</div>
        </div>
        <div class="kpi" style="padding:16px;cursor:pointer" onclick="showUsageModal('ha_ui')">
          <div style="font-size:10px;font-weight:700;color:#fff;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">DIRECT HUB CONTROL<button class="info-btn" style="border:none;background:none;padding:0;margin-left:4px" onclick="event.stopPropagation();showInfo('usage_ha_ui')"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;opacity:0.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></button></div><hr style="border:0;border-top:1px solid var(--border);margin:0 0 12px 0">
          <div style="font-size:24px;font-weight:700">${u.hub_direct_total||0}</div>
        </div>
      `;
    } else {
      /* dead branch: #usageKPIs always exists. Orphaned device-modal markup removed. */
  }
  /* Removed an orphaned showModal(id,body) here — leftover device-modal code that
     referenced undefined id/body and threw at the end of every renderUsage().
     The real device drill-down is window.showDevModal. */
};

window.showUsageModal=function(type){
  const hub=activeHub,d=D[hub];
  const u=d.usage||{};
  const app=u.app||0,docklet=u.docklet||0,remote=u.remote||0,direct=u.direct||0;
  const hubUse=(u.hub_total!=null)?u.hub_total:((u.hub_scene_total||0)+(u.hub_auto_total||0)+(u.hub_direct_total||0));
  const total=app+docklet+remote+direct,hTotal=app+docklet+hubUse;
  const app_ratio=u.app_ratio||0,dock_ratio=u.dock_ratio||0,hub_ratio=u.hub_ratio||0;
  const observed_per_day=u.observed_per_day||0,scene_per_day=u.scene_per_day||0,scene_total=u.scene_total||0;
  const row=(l,v)=>`<tr><td style="color:var(--muted);padding:6px 16px 6px 0;white-space:nowrap">${l}</td><td style="padding:6px 0">${v}</td></tr>`;
  let title='',body='',lcOpts=null;
  if(type==='auto'){
    title='Automation / Day';
    lcOpts={hub,tab:'all',ucFilter:'Automation Run (Hub)',context:{label:'Hub-Recorded Automation Runs',desc:`${hub.toUpperCase()} · ${u.hub_auto_total||0} runs from ha_logs · ${activePeriodLabel()}`}};
    body=`<table style="font-size:12px">${row('Formula',`<code style="font-size:11px;color:#e8edf5">${u.hub_auto_total||0} runs ÷ ${activeDaysCount()} days = ${u.hub_auto_per_day||0}/day</code>`)}${row('Hub-recorded runs (tile value)',`<strong style="font-size:16px">${u.hub_auto_total||0}</strong> <span style="font-size:10px;color:var(--muted)">ha_logs automation_triggered — recorded even when the app is closed</span>`)}${row('Per Day',`<strong>${u.hub_auto_per_day||0}</strong>`)}${row('Why hub-recorded?',`<span style="font-size:11px;line-height:1.5;color:var(--muted)">The app only observes changes while it is open, so its automation counts are inconsistent. The hub records every run.</span>`)}</table>`;
  } else if(type==='scene'){
    title='Scene / Day';
    lcOpts={hub,tab:'all',ucFilter:'Scene Activated (Hub)',context:{label:'Hub-Recorded Scene Activations',desc:`${hub.toUpperCase()} · ${u.hub_scene_total||0} activations from ha_logs · ${activePeriodLabel()}`}};
    body=`<table style="font-size:12px">${row('Formula',`<code style="font-size:11px;color:#e8edf5">${u.hub_scene_total||0} activations ÷ ${activeDaysCount()} days = ${u.hub_scene_per_day||0}/day</code>`)}${row('Hub-recorded activations (tile value)',`<strong style="font-size:16px">${u.hub_scene_total||0}</strong> <span style="font-size:10px;color:var(--muted)">ha_logs scene call_service — recorded even when the app is closed</span>`)}${row('Per Day',`<strong>${u.hub_scene_per_day||0}</strong>`)}${row('Why hub-recorded?',`<span style="font-size:11px;line-height:1.5;color:var(--muted)">The app only observes activations while it is open and can log state-refresh bursts as activations, so its scene counts are inconsistent. The hub records every activation.</span>`)}</table>`;
  } else if(type==='devices'){
    title='Active SNAP Devices';
    lcOpts={hub,tab:'all',context:{label:'All Device Events',desc:`${hub.toUpperCase()} · all physical SNAP device activity`}};
    body=`<table style="font-size:12px">${row('Count',`<strong style="font-size:20px">${u.snap_devices||0}</strong>`)}${row('What counts','Physical SNAP-connected devices that had at least one event in this period')}${row('Excluded','scene.*, automation.*, script.*, group.* entities — only light, switch, fan domains count')}</table>`;
  } else if(type==='app'){
    title='App Usage Ratio';
    lcOpts={hub,tab:'all',srcFilter:'App Control',context:{label:'App (Local) Events',desc:`${hub.toUpperCase()} · ${app} local app events · ${activePeriodLabel()}`}};
    body=`<table style="font-size:12px">${row('Formula','App ÷ (App + Dock + Hub)')}${row('App Events',`<strong style="font-size:16px;color:var(--blue)">${app}</strong>`)}${row('Dock Events',docklet)}${row('Hub Events',hubUse)}${row('Ratio',`<strong style="font-size:16px;color:var(--blue)">${app_ratio}%</strong>`)}</table>`;
  } else if(type==='dock'){
    title='Dock Usage Ratio';
    lcOpts={hub,tab:'all',srcFilter:'Dock Control',context:{label:'Dock Control Events',desc:`${hub.toUpperCase()} · ${docklet} dock events · ${activePeriodLabel()}`}};
    body=`<table style="font-size:12px">${row('Formula','Dock ÷ (App + Dock + Hub)')}${row('Dock Events',`<strong style="font-size:16px;color:var(--green)">${docklet}</strong>`)}${row('App Events',app)}${row('Hub Events',hubUse)}${row('Ratio',`<strong style="font-size:16px;color:var(--green)">${dock_ratio}%</strong>`)}</table>`;
  } else {
    title='Direct Hub Control';
    lcOpts={hub,tab:'all',ucFilter:'Hub Control',context:{label:'Direct Hub Control Events',desc:`${hub.toUpperCase()} · ${u.hub_direct_total||0} devices driven directly from the hub's own Home Assistant screen`}};
    body=`<table style="font-size:12px">${row('Formula','Controllable devices (light/switch/fan/…) actuated with actuation_source ha:* — the hub UI, not the app, a dock, an automation or a scene')}${row('Count (tile value)',`<strong style="font-size:16px">${u.hub_direct_total||0}</strong>`)}${row('Per Day',`<strong>${u.hub_direct_per_day||0}</strong>`)}${row('Part of "Hub"',`<span style="font-size:11px;line-height:1.5;color:var(--muted)">Counted in Total Events / Reliability and grouped under the <strong>Hub</strong> source together with automation runs (${u.hub_auto_total||0}) and scene activations (${u.hub_scene_total||0}). The hub's <code>actuation_source</code> field records the real origin, so hub-screen control is separated from app-relayed commands.</span>`)}</table>`;
  }
  // For the hub-recorded sources (automations / scenes / direct hub control), show a
  // real sample of the actual events inline so the drill-down is more than a formula.
  const ucForType={auto:'Automation Run (Hub)',scene:'Scene Activated (Hub)',ha_ui:'Hub Control'};
  if(ucForType[type]){
    const evs=buildEventPool(hub).filter(e=>e.uc===ucForType[type]);
    body+=`<div class="dbg-section" style="margin-top:12px">
      <div class="dbg-section-hdr">
        <span class="dbg-section-title">Sample Events (${evs.length})</span>
        <button class="dbg-lc-link" onclick="closeModal();openLogCenter(${JSON.stringify(lcOpts).replace(/"/g,'&quot;')})">View in Log Center →</button>
      </div>
      ${evs.length?evTable(evs.slice(0,15),[{key:'ts',label:'Time'},{key:'dev',label:'Device'},{key:'room',label:'Room'},{key:'action',label:'Action'},{key:'src',label:'Source'}]):`<div class="dbg-empty">No ${title} events in the selected period.</div>`}
      ${evs.length>15?`<p style="font-size:10px;color:var(--muted);margin-top:6px">Showing 15 of ${evs.length}.</p>`:''}
    </div>`;
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
  hubs.forEach(h=>{const d=D[h];
    fTotal  +=(d.total_activity!=null?d.total_activity:d.total);
    fSuccess+=(d.activity_success!=null?d.activity_success:d.success);
    fFail   +=(d.activity_fail!=null?d.activity_fail:(d.total-d.success));
    if(d.total&&d.speed.local_e2e.p50!=null)fLatencies.push({hub:h,p50:d.speed.local_e2e.p50});
    if(d.daily)d.daily.forEach(dy=>{if(dy.ns!==undefined)fNS.push(dy.ns)})});
  const fRel=fTotal>0?((fSuccess/fTotal)*100).toFixed(2):0;
  const fP50=fLatencies.length?Math.round(fLatencies.reduce((a,b)=>a+b.p50,0)/fLatencies.length):0;
  const fNSavg=fNS.length>0?(fNS.reduce((a,b)=>a+b,0)/fNS.length).toFixed(1):0;

  let title='',body='';
  if(type==='reliability'){
    title='';
    body=`
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;font-weight:normal;margin-top:-24px">Debug View</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf5;margin-bottom:8px">RELIABILITY</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:24px;font-family:monospace">Formula: Σ Successful ÷ Σ Total (All Hubs)</div>
    
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">RELIABILITY</div>
        <div style="font-size:20px;font-weight:700;color:${relColor(fRel)}">${fRel}%</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">SUCCESS</div>
        <div style="font-size:20px;font-weight:700;color:#e8edf5">${fSuccess.toLocaleString()}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">FAILURES</div>
        <div style="font-size:20px;font-weight:700;color:#e8edf5">${fFail.toLocaleString()}</div>
      </div>
    </div>
    
    <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
    
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#e8edf5;margin-bottom:12px">HUB - WISE BREAKDOWN</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">HUB</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">RELIABILITY</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">FAILURES</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${hubs.map(h=>{
            const d=D[h]; const f=d.total-d.success;
            const rc=relColor(d.reliability);
            const sl=statusLabel(d.reliability);
          return `<tr>
            <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-weight:600">${h.toUpperCase()}</td>
            <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:${rc};font-weight:600">${d.reliability}%</td>
            <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:#e8edf5">${f.toLocaleString()}</td>
            <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
              <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${rc};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${rc}"></span><span style="color:${rc}">${sl}</span></div>
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
              <button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openLogCenter({hub:'${h}',tab:'failures'})">Inspect →</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
    
    <div style="display:flex;justify-content:flex-end;margin-top:20px">
      <button class="card-btn-investigate" onclick="closeModal();openLogCenter({tab:'failures'})">VIEW ALL FAILURES</button>
    </div>`;

  } else if(type==='latency'){
    title='';
    body=`
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;font-weight:normal;margin-top:-24px">Debug View</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf5;margin-bottom:8px">AVG P50 SPEED</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:24px;font-family:monospace">Formula: Median Latency (50th Percentile) of all successful App events</div>
    
    <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:24px">
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">AVG P50 SPEED</div>
        <div style="font-size:20px;font-weight:700;color:#e8edf5">${fP50}ms</div>
      </div>
    </div>
    
    <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
    
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#e8edf5;margin-bottom:12px">HUB - WISE BREAKDOWN</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">HUB</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">P50</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${fLatencies.map(l=>{
            let sl='Healthy', rc='var(--green)';
            if(l.p50>1000){ sl='Critical'; rc='var(--red)'; }
            else if(l.p50>800){ sl='Warning'; rc='var(--yellow)'; }
            return `<tr>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-weight:600">${l.hub.toUpperCase()}</td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:${rc};font-weight:600">${l.p50}ms</td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
                <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${rc};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${rc}"></span><span style="color:${rc}">${sl}</span></div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
                <button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openLogCenter({hub:'${l.hub}',tab:'slow'})">Inspect →</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    
    <div style="display:flex;justify-content:flex-end;margin-top:20px">
      <button class="card-btn-view" onclick="closeModal();openLogCenter({tab:'slow'})">VIEW ALL LOGS</button>
    </div>`;

  } else if(type==='northstar'){
    title='';
    const nsGap=(95-parseFloat(fNSavg)).toFixed(1);
    const nsColor=fNSavg>=95?'var(--green)':fNSavg>=80?'var(--yellow)':'var(--red)';
    body=`
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;font-weight:normal;margin-top:-24px">Debug View</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf5;margin-bottom:8px">NORTH STAR</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:24px;font-family:monospace">Formula: ROUND(100 × COUNT(latency_ms < 1000) / NULLIF(COUNT(latency_ms IS NOT NULL), 0), 2)</div>
    
    <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:24px">
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">NORTH STAR</div>
        <div style="font-size:20px;font-weight:700;color:${nsColor}">${fNSavg}%</div>
      </div>
    </div>
    
    <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
    
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#e8edf5;margin-bottom:12px">HUB - WISE BREAKDOWN</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">HUB</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">NORTH STAR</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${hubs.map(h=>{
            const d=D[h];const nsA=d.daily?((d.daily.reduce((s,dy)=>s+(dy.ns||0),0))/d.daily.length).toFixed(1):'—';
            const val=parseFloat(nsA);
            let sl='Healthy', rc='var(--green)';
            const isBad = val<95;
            if(val<80){ sl='Critical'; rc='var(--red)'; }
            else if(val<95){ sl='Warning'; rc='var(--yellow)'; }
            return `<tr>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-weight:600">${h.toUpperCase()}</td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:${rc};font-weight:600">${nsA}%</td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
                <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${rc};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${rc}"></span><span style="color:${rc}">${sl}</span></div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
                ${isBad? `<button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openLogCenter({hub:'${h}',tab:'slow'})">Inspect →</button>` : `<button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();showHubNSModal('${h}')">Inspect →</button>`}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    
    <div style="display:flex;justify-content:flex-end;margin-top:20px">
      <button class="card-btn-view" onclick="closeModal();openLogCenter({tab:'slow'})">VIEW ALL LOGS</button>
    </div>`;
  }
  showModal(title,body);
}

window.showHubRelModal=function(hub){
  const d=D[hub];if(!d)return;
  const _act = d.total_activity!=null?d.total_activity:d.total;
  const f = d.activity_fail!=null?d.activity_fail:(d.total-d.success);
  const _arel = _act?((_act-f)/_act*100).toFixed(2):0;
  const recentDays=[...(allSourceDaily(hub)||[])].reverse().slice(0,14);
  
  const dayRows=recentDays.map(dy=>{
    const rc = relColor(dy.rel);
    const sl = statusLabel(dy.rel);
    return`<tr>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-family:monospace;font-size:10px;color:var(--muted)">${dy.date}</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:${rc};font-weight:600">${dy.rel}%</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:#e8edf5">${(dy.fail||0).toLocaleString()}</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
        <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${rc};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${rc}"></span><span style="color:${rc}">${sl}</span></div>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
        <button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'failures',filters:{search:'${dy.date}'}})">Inspect →</button>
      </td>
    </tr>`;
  }).join('');

  const body=`
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;font-weight:normal;margin-top:-24px">Debug View</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf5;margin-bottom:8px">RELIABILITY</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:24px;font-family:monospace">Formula: (Successful Commands / Total Attempted Commands) × 100</div>
    
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">RELIABILITY</div>
        <div style="font-size:20px;font-weight:700;color:${relColor(_arel)}">${_arel}%</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">SUCCESS</div>
        <div style="font-size:20px;font-weight:700;color:#e8edf5">${(_act-f).toLocaleString()}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">FAILURES</div>
        <div style="font-size:20px;font-weight:700;color:#e8edf5">${f.toLocaleString()}</div>
      </div>
    </div>
    
    <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
    
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#e8edf5;margin-bottom:12px">DAILY TREND</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">DATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">RELIABILITY</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">FAILURES</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${dayRows}
        </tbody>
      </table>
    </div>
    
    <div style="display:flex;justify-content:flex-end;margin-top:20px">
      <button class="card-btn-investigate" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'failures'})">VIEW ALL FAILURES</button>
    </div>`;
  showModal('', body);
};

window.showHubSpeedModal=function(hub){
  const d=D[hub];if(!d)return;
  const p50=d.total&&d.speed.local_e2e.p50!=null?d.speed.local_e2e.p50+'ms':'—';
  const recentDays=[...(allSourceDaily(hub)||[])].reverse().slice(0,14);
  
  const dayRows=recentDays.map(dy=>{
    const v=dy.p50;
    let sl='Healthy', rc='var(--green)';
    if(v>1000){ sl='Critical'; rc='var(--red)'; }
    else if(v>800){ sl='Warning'; rc='var(--yellow)'; }
    return`<tr>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-family:monospace;font-size:10px;color:var(--muted)">${dy.date}</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:${rc};font-weight:600">${v}ms</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
        <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${rc};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${rc}"></span><span style="color:${rc}">${sl}</span></div>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
        <button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'slow',filters:{search:'${dy.date}'}})">Inspect →</button>
      </td>
    </tr>`;
  }).join('');

  const body=`
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;font-weight:normal;margin-top:-24px">Debug View</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf5;margin-bottom:8px">P50 SPEED</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:24px;font-family:monospace">Formula: Median Latency (50th Percentile) of all successful App events</div>
    
    <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:24px">
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">P50 SPEED</div>
        <div style="font-size:20px;font-weight:700;color:#e8edf5">${p50}</div>
      </div>
    </div>
    
    <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
    
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#e8edf5;margin-bottom:12px">DAILY TREND</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">DATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">P50</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${dayRows}
        </tbody>
      </table>
    </div>
    
    <div style="display:flex;justify-content:flex-end;margin-top:20px">
      <button class="card-btn-view" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'slow'})">VIEW ALL LOGS</button>
    </div>`;
  showModal('', body);
};

window.showHubNSModal=function(hub){
  const d=D[hub];if(!d)return;
  const nsAvg=d.daily&&d.daily.length?(d.daily.reduce((s,dy)=>s+(dy.ns||0),0)/d.daily.length).toFixed(1):0;
  const nsC=parseFloat(nsAvg)>=95?'var(--green)':parseFloat(nsAvg)>=80?'var(--yellow)':'var(--red)';
  const recentDays=[...(allSourceDaily(hub)||[])].reverse().slice(0,14);
  
  const dayRows=recentDays.map(dy=>{
    const c=(dy.ns||0)>=95?'var(--green)':(dy.ns||0)>=80?'var(--yellow)':'var(--red)';
    const sl=(dy.ns||0)>=95?'Healthy':(dy.ns||0)>=80?'Warning':'Critical';
    const under1s=Math.round(dy.total * (dy.ns||0) / 100);
    return`<tr>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-family:monospace;font-size:10px;color:var(--muted)">${dy.date}</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:#e8edf5;font-weight:600">${dy.total.toLocaleString()}</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:#e8edf5">${under1s.toLocaleString()}</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border);color:${c};font-weight:600">${(dy.ns||0).toFixed(1)}%</td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
        <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${c};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${c}"></span><span style="color:${c}">${sl}</span></div>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
        <button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'slow',filters:{search:'${dy.date}'}})">Inspect →</button>
      </td>
    </tr>`;
  }).join('');

  const body=`
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;font-weight:normal;margin-top:-24px">Debug View</div>
    <div style="font-size:18px;font-weight:700;color:#e8edf5;margin-bottom:8px">NORTH STAR</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:24px;font-family:monospace">Formula: (Commands Completed < 1.0s / Total Commands) × 100</div>
    
    <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:24px">
      <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:16px;text-align:center">
        <div style="font-size:10px;color:var(--muted);font-weight:700;margin-bottom:8px">NORTH STAR</div>
        <div style="font-size:20px;font-weight:700;color:${nsC}">${nsAvg}%</div>
      </div>
    </div>
    
    <div style="height:1px;background:var(--border);margin-bottom:20px"></div>
    
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:#e8edf5;margin-bottom:12px">DAILY TREND</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">DATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">TOTAL EVENTS</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">EVENTS UNDER 1 SEC</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">NORTH STAR</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${dayRows}
        </tbody>
      </table>
    </div>
    
    <div style="display:flex;justify-content:flex-end;margin-top:20px">
      <button class="card-btn-view" onclick="closeModal();openLogCenter({hub:'${hub}',tab:'slow'})">VIEW ALL LOGS</button>
    </div>`;
  showModal('', body);
};

window.showHubListModal=function(){
  const hubs=Object.keys(D);
  let body=`
    <div style="background:var(--card);border:1px solid var(--border2);border-radius:6px;padding:20px;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">HUB MAC ID</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">STATE</th>
            <th style="text-align:left;padding:8px;color:var(--muted);border-bottom:1px solid var(--border)">ACTION</th>
          </tr>
        </thead>
        <tbody>
          ${hubs.map(h=>{
            const d=D[h];
            const arel=d.activity_reliability!=null?d.activity_reliability:d.reliability;
            const rc=relColor(arel);
            const sl=statusLabel(arel);
            return `<tr>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border);font-weight:600;font-family:monospace">${h.toUpperCase()}</td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
                <div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface);border:1px solid ${rc};border-radius:12px;padding:3px 8px;font-size:10px"><span style="width:6px;height:6px;border-radius:50%;background:${rc}"></span><span style="color:${rc}">${sl}</span></div>
              </td>
              <td style="padding:10px 8px;border-bottom:1px solid var(--border)">
                <button class="card-btn-view" style="padding:4px 12px;font-size:10px" onclick="closeModal();openHub('${h}')">View Hub →</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  showModal('HUBS OVERVIEW',body);
};

window.showInfo=function(key){
  const INFO={
    overall_usage:{title:'OVERALL USAGE',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Shows the total proportion of commands originating from each source.\n\n  HUB: Everything the hub itself originated — direct hub-screen control, automations and scenes.\n  APP (Local): Commands from the app while on the same Wi-Fi network.\n  DOCK: Commands from physical dock button presses.\n  APP (Remote): Commands from the app while away from home.\n\nAnalyze this chart to understand how users interact with the system.'},
    usage_trend:{title:'USAGE TREND',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Provides a daily breakdown of system interactions across all control sources.\n\n  HUB: Everything the hub originated — direct hub-screen control, automations and scenes.\n  APP: Manual interactions initiated through the mobile app (Local & Remote).\n  DOCK: Physical interactions via dock button presses.\n\nMonitor these trends over time to understand user behavior. A steady shift away from manual App usage towards Hub and Dock controls often indicates a well-automated, highly optimized smart home environment.'},
dock_usage:{title:'DOCK USAGE',body:'<hr style=\"border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0\">Detailed breakdown of physical dock interactions.<br><br><b>Total Dock Events</b>: The total number of button presses recorded.<br><b>Total Docks</b>: The number of unique dock hubs sending commands.<br><b>Active Docklets</b>: The number of individual docklet buttons pressed.<br><br><b>Action Types</b>: Shows how users are utilizing the buttons (toggling states vs adjusting brightness/volume).'},
    fleet_total:{title:'TOTAL EVENTS',body:'The total number of commands successfully processed across the entire system. This count includes all actions originating from the APP + DOCK + HUB.'},
    fleet_reliability:{title:'RELIABILITY',body:'Measures the percentage of commands successfully executed by the system out of all commands attempted.\n\n<b>Formula:</b> (Successful Commands / Total Attempted Commands) × 100\n\n<b>Ranges:</b>\n• Good: > 97%\n• Acceptable: 95% - 97%\n• Bad: < 95%'},
    fleet_latency:{title:'AVG P50 SPEED',body:'The median response time for commands. Exactly half of all commands are processed faster than this speed, providing a realistic view of typical system performance.\n\n<b>Formula:</b> The 50th percentile value of all end-to-end command execution times.\n\n<b>Ranges:</b>\n• Good: < 800ms\n• Acceptable: 800ms - 1000ms\n• Bad: > 1000ms'},
    fleet_northstar:{title:'NORTH STAR',body:'The ultimate performance metric reflecting a flawless user experience, defined as the percentage of all commands that complete almost instantly.\n\n<b>Formula:</b> (Commands Completed < 1.0s / Total Commands) × 100\n\n<b>Ranges:</b>\n• Good: > 95%\n• Acceptable: 80% - 95%\n• Bad: < 80%'},
    hub_total:{title:'TOTAL EVENTS',body:'The total number of commands successfully processed across this system. This count includes all actions originating from the APP + DOCK + HUB.'},
    hub_reliability:{title:'RELIABILITY',body:'Measures the percentage of commands successfully executed by the system out of all commands attempted.\n\n<b>Formula:</b> (Successful Commands / Total Attempted Commands) × 100\n\n<b>Ranges:</b>\n• Good: > 97%\n• Acceptable: 95% - 97%\n• Bad: < 95%'},
    hub_latency:{title:'P50 SPEED',body:'The median response time for commands. Exactly half of all commands are processed faster than this speed, providing a realistic view of typical system performance.\n\n<b>Formula:</b> The 50th percentile value of all end-to-end command execution times.\n\n<b>Ranges:</b>\n• Good: < 800ms\n• Acceptable: 800ms - 1000ms\n• Bad: > 1000ms'},
    hub_failures:{title:'FAILURES',body:'The total number of commands that failed to complete on this hub. In our context, a failure means the system could not successfully execute a command.\n\nThis total includes:\n• App Failures: Commands sent from the user app that failed\n• Dock Failures: Physical docklet presses that failed\n• Hub Failures: Automated scene or schedule executions from the hub that failed'},
    daily_chart:{title:'DAILY EVENTS & RELIABILITY',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">A day-by-day breakdown of system activity and its success rate.\n\n• Hub Events (Violet): Everything the hub originated — direct hub-screen control, automations and scenes.\n• App Events (Blue): Manual controls from the user app.\n• Dock Events (Orange): Physical dock button presses.\n• Reliability % (Green Dotted Line): Percentage of total commands that successfully executed.\n• Target % (Grey Dotted Line): The 97% reliability is the goal.\n\nA dip in the green line indicates system issues on that day.'},
    p50_chart:{title:'P50 & P95 SPEED TREND',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Tracks the median (P50) and worst-case (P95) response times of system commands over time.\n\n  P50 Speed (ms) (Orange Line with Dot): The median speed of commands for that day.\n  P95 Speed (ms) (Red Line with Dot): The worst-case response time where 95% of all commands finished faster than this value.\n  Target (ms) (Grey Dotted Line): The target response time (<1000ms).\n\nIf the red or orange lines spike above the target line, it indicates the system was abnormally slow on that day.'},
    ns_chart:{title:'NORTH STAR TREND',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Tracks the percentage of commands that completed almost instantly (under 1 second) over time.\n\n• North Star % (Blue Line with Dot): The percentage of lightning-fast commands for that day.\n• Target % (Grey Dotted Line): The baseline goal of 95%.\n\nDrops in the blue line usually indicate temporary network congestion, a struggling device, or Thread mesh instability. Investigating these dips helps maintain a flawless user experience.'},
    fail_trend_chart:{title:'FAILURES TREND',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Breaks down exactly which commands failed each day across the system.\n\n• Hub Failures (Violet): Failures from automated hub scenes and schedules.\n• App Failures (Red): Failures from manual controls via the user app.\n• Dock Failures (Orange): Failures from physical dock button presses.\n\nMonitor this graph to easily identify if a spike in unreliability is caused by a specific source (e.g., dock commands failing constantly).'},
    heatmap:{title:'ACTIVITY HEATMAP',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Shows when devices are controlled most across the entire week.\n\n• Dark Blue: High volume of commands during this hour.\n• Light/Black: Low or no activity during this hour.\n\nAnalyze this grid to spot usage patterns, like most activity happening on weekday evenings. Click any cell to jump into the Log Center and inspect those specific events.'},
    heatmap_fail:{title:'FAILURES HEATMAP',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Shows when system failures happen most across the entire week.\n\n• Dark Red: High volume of failures during this hour.\n• Light/Black: Low or no failures during this hour.\n\nAnalyze this grid to spot recurring failure patterns. A cell glowing red at the same time every day points to environmental interference, router reboots, or scheduled congestion. Click any cell to jump into the Log Center and inspect those specific failures.'},
    avg_sd_trend:{title:'AVG & SD TREND',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Visualizes the daily average speed and its standard deviation across the entire system.\n\n  Avg Speed (ms) (Blue line with dot): The mean response time of all commands on that day.\n  AVG + SD (Green Dotted Line): The upper boundary of typical response times.\n  AVG - SD (Red Dotted Line): The lower boundary of typical response times.\n\nA narrow gap between the green and red lines indicates highly consistent performance. A wide gap means speed is erratic and unpredictable. Spikes in the blue line point to specific days where the overall system slowed down.'},
    speed_segments:{title:'SPEED SEGMENTS',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Breaks down where time is actually spent when a command is sent. There are 4 roundtrips:\n\n  Hub &rarr; SNAP &rarr; Hub: How long for the hub to command the physical device and get state confirmed back.\n  Hub &rarr; App (WebSocket Push): How long for the hub to push the new state to the phone via WebSocket.\n  App Control (Local): Full round trip when the user is on the same Wi-Fi as the hub.\n  App Control (Remote): Full round trip when controlling from outside the home.\n\nCompare these segments to identify bottlenecks. If App Control is slow but Hub &rarr; SNAP is fast, the delay is in the network or WebSocket connection.'},
    lat_dist:{title:'SPEED DISTRIBUTION',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">How many commands fell into each speed bucket:\n\n  Green (<500ms): Fast & feels instant\n  Yellow (500ms-1s): Acceptable\n  Orange (1-2s): Getting slow\n  Red (2-5s): Noticeably sluggish\n  Deep Red (>5s): Very slow & investigate\n\nA healthy system has the vast majority of events in the green bucket.\nClick any bar to see the actual events in that range.'},
    uc_lat:{title:'Latency by Use Case',body:'Compares speed across the different ways devices can be controlled:\n\n• App Control: User tapped the phone app on local Wi-Fi\n• Dock Control: Physical dock button was pressed\n• Remote App: User controlled from outside the home\n• Observed Change: State change detected by the hub (e.g. manual switch)\n\nShows Avg, P50 (typical), and P95 (worst-case). Useful for spotting if one control method is consistently slower.'},
    uc_table:{title:'Per Use Case Speed',body:'Detailed latency numbers for each control method. The most important column is P95 — it represents the slowest 5% of commands, your worst-case user experience. P95 above 1 second is flagged as Critical and should be investigated. Click any row for event-level detail.'},
    uc_speed_metrics:{title:'Speed Metrics Explained',body:'Every use-case card shows four numbers:\n\n• Avg — The simple average of all command times. Easy to read but one very slow event can pull it up and make things look worse than they are.\n\n• P50 (Median) — Sort all command times; P50 is the middle value. Half finished faster, half slower. This is what a typical user actually experiences day-to-day.\n\n• P95 — 95% of commands finished faster than this number. Only the slowest 5% were slower. This is your worst-case experience — if P95 is under 1000ms, even your slowest users are getting a decent experience.\n\n• Std Dev (Standard Deviation) — Measures how consistent the times are. A low number means most commands take a similar amount of time (predictable). A high number means some are fast and some are very slow (erratic). Green under 200ms · Yellow 200–500ms · Red above 500ms.'},
    rel_kpis:{title:'Reliability KPIs',body:'Two ways of measuring how reliably commands are confirmed:\n\n• App Trigger Feedback: When a user taps in the app, does the app receive confirmation that the command worked? This is the most direct measure of app-facing reliability.\n• Dock Trigger Reliability: When a physical dock button is pressed, does the bound device actually activate? Computed from hub logs (ha_logs) — the reliable, always-on source.\n\nClick either card to debug failures for that source.'},
    rel_source:{title:'RELIABILITY BY SOURCE',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Reliability broken down by how the device was controlled.\n\n  APP CONTROL: Commands sent from the mobile app.\n  DOCK CONTROL: Commands triggered by pressing a physical dock button.\n  AUTOMATIONS: Commands triggered automatically by hub scenes or schedules.\n  DEVICE BIND: The process of pairing and adding new devices to the system.\n\nIt pinpoints whether one control method is failing more than others.'},
    rel_trend:{title:'RELIABILITY TREND',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">How reliability changed over the selected period across the entire system.\n\n  Reliability percentage (Green line with dot): The daily success rate of all commands.\n  Target % (Dashed Line): The minimum acceptable reliability target.\n\nA sustained drop indicates a persistent problem. A one-day drop usually points to a temporary event like a power outage or network hiccup. Click any point to jump directly to the Log Center filtered to that day\'s failures.'},
    dock_rel:{title:'DOCK RELIABILITY',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Reliability per physical dock device, computed from hub logs.\n\nA docklet press is a hub-recorded command; it succeeds when the bound SNAP device actually reached a real state (on/off), and fails when it did not respond.\n\nEach row shows one dock, how many presses succeeded versus failed.'},
    fail_reason:{title:'FAILURES BY REASON',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Groups all system failures by their root cause.\n\n  TIMEOUT: Command reached the hub but the device didn\'t respond in time.\n  DEVICE_OFFLINE: Device wasn\'t reachable when the command was sent.\n  NO_RESPONSE: Hub got no acknowledgement from the device.\n  THREAD_MESH_FAIL: The wireless mesh dropped the packet before reaching the device.\n  DEVICE_UNAVAILABLE: Device was disconnected from the network.\n\nClick any reason to see which specific devices and rooms are affected to analyze network or device-specific issues.'},
    fail_device:{title:'FAILURES BY DEVICE',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Identifies which individual lights or switches are failing the most frequently.\n\nIf one device appears here consistently, it likely needs attention.'},
    usage_auto:{title:'AUTOMATION / DAY',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">The average number of automated background routines triggered by the hub per day.'},
    usage_scene:{title:'SCENE / DAY',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">The average number of multi-device preset scenes activated by the hub per day.'},
    usage_snap_devices:{title:'ACTIVE SNAP DEVICES',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">SNAP devices are physical smart hardware connected to the system.<br><br>Counts real physical hardware like lights and switches that received commands.<br><br>Excludes virtual entities like scenes and automations.'},
    usage_app:{title:'APP USAGE RATIO',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Share of all activity that originated from the mobile app, out of App + Dock + Hub. The three ratios add up to 100%.'},
    usage_dock:{title:'DOCK USAGE RATIO',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Share of all activity that originated from physical dock buttons, out of App + Dock + Hub. The three ratios add up to 100%.'},
    usage_ha_ui:{title:'DIRECT HUB CONTROL',body:'<hr style="border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0">Devices driven directly from the hub\'s own Home Assistant screen — not the mobile app, a dock, an automation or a scene.\n\nIdentified by the hub\'s actuation_source field (ha:*), which records the real origin of each actuation, restricted to controllable devices (light, switch, fan, …) that reached a concrete state. It is counted in Total Events / Reliability and grouped under the Hub source alongside automation runs and scene activations.'},
    src_chart:{title:'Source Breakdown',body:'A visual split of all events by how they were triggered:\n\n• App (Local): User tapped the phone app on the same Wi-Fi\n• Remote App: User tapped the app from outside the home\n• Dock Control: Physical dock button was pressed\n• Observed Change: State change detected automatically (e.g. manual switch, scene activation)\n\nClick any segment to see those specific events in the Log Center.'},
    dock_usage:{title:'DOCK USAGE',body:'<hr style=\"border:0;border-top:1px solid var(--border);margin:-4px 0 12px 0\">Visualizes the physical interactions and action types generated by smart docks in the system.\n\n• TOTAL DOCK EVENTS: The total count of dock button presses recorded during this period.\n\n• ACTIVE DOCKLETS: The number of distinct individual dock buttons that were used.\n\n• ACTION TYPE COUNT: A breakdown showing exactly what kind of commands were sent (Toggle on/off, Increment brightness/volume, Decrement brightness/volume).\n\nAnalyze this data to understand how users physically interact with the smart home environment.'},
    dev_activity:{title:'Device Activity',body:'A ranked list of every device (light or switch) controlled through this hub, sorted by most-used first. Shows:\n\n• Device: The entity ID (short name) of the device\n• Room: Which room it\'s in\n• Events: Total commands sent to this device in the selected period\n• Reliability: What percentage of commands on this device succeeded\n• P50: The median response time for this specific device\n\nClick any row to see the full stats for that device including its failure events.'},
    log_center:{title:'Log Center',body:'A detailed event-level workspace for debugging. Every command event appears here with its timestamp, device, room, control method, latency, and failure reason.\n\nHow to use it:\n• Failures tab: Shows only failed commands — start here when investigating an issue\n• Slow Events tab: Shows commands that took over 800ms\n• All Events tab: Every event in the selected period\n• Source / Reason filters: Narrow down to a specific control method or failure type\n• Search box: Filter by device name, room, or date\n• Click any row: Expands a visual timing pipeline showing exactly where time was spent in that specific command'}
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

  const loader=document.getElementById('fullPageLoader');
  if(loader) loader.style.display='flex';

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
  await Promise.all(hubs.map(async h=>{
    D[h]=await fetch(`/api/hub/${h}?from_date=${activeFrom}&to_date=${activeTo}`).then(r=>r.json());
  }));

  if(loader) loader.style.display='none';
  renderLanding();
};
