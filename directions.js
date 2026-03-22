// ════════════════════════════════════════════════════════
//  directions.js — RouteFinder directions page
// ════════════════════════════════════════════════════════

const q           = new URLSearchParams(window.location.search);
const FROM        = q.get('from')         || 'Start';
const TO          = q.get('to')           || 'Destination';
const FROM_LAT    = parseFloat(q.get('fromLat'));
const FROM_LON    = parseFloat(q.get('fromLon'));
const TO_LAT      = parseFloat(q.get('toLat'));
const TO_LON      = parseFloat(q.get('toLon'));
const ROUTE_TITLE = q.get('routeTitle')   || 'Route';
const ROUTE_DESC  = q.get('routeDesc')    || '';
const ROUTE_DIFF  = q.get('routeDiff')    || 'easy';
const ROUTE_COLOR = q.get('routeColor')   || '#7c5cfc';
const ROUTE_PROF  = q.get('routeProfile') || 'driving';
const WP_OFFSET   = parseFloat(q.get('waypointOffset')) || 0;
const HIGHLIGHTS  = (() => {
  try { return JSON.parse(decodeURIComponent(q.get('routeHighlights') || '[]')); }
  catch { return []; }
})();
let ROUTE_STOPS   = (() => {
  try { return JSON.parse(q.get('routeStops') || '[]'); }
  catch { return []; }
})();
const VIBE_EXPLANATION = q.get('vibeExplanation') || '';
const BACK_PARAMS = q.get('backParams') || '';

const OSRM_BASE = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1',
  foot:    'https://routing.openstreetmap.de/routed-foot/route/v1',
};
const OVERPASS   = 'https://overpass-api.de/api/interpreter';
const TILE_DARK  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR  = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>';
const BLANK_GIF  = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

const hasCoords  = !isNaN(FROM_LAT) && !isNaN(FROM_LON) && !isNaN(TO_LAT) && !isNaN(TO_LON);
const ARRIVE_START = 150;
const ARRIVE_DEST  = 200;
const OFF_ROUTE_M  = 80;
const REROUTE_M    = 200;
const MODE_LABELS  = { driving:'Car', cycling:'Cycling', foot:'Walking' };

// ── State ───────────────────────────────────────────────
let map, tileLayer;
let isDark          = true;
let attractionMarkers = [];
let gpsWatchId      = null;
let gpsMarker       = null;
let gpsAccCircle    = null;
let gpsFollowing    = true;
let userLat         = null;
let userLon         = null;
let gpsPhase        = 'waiting';
let activeMode      = null;

// These hold the CURRENT polylines on the map — only ever one of each
let toStartPoly     = null;
let vibePoly        = null;
let toStartSteps    = [];
let vibeSteps       = [];
let currentLeg      = 'leg0';
let currentStepIdx  = 0;
let offRouteTimer   = null;
let rerouteTimer    = null;

// Single draw lock — only one draw() runs at a time
let drawVersion     = 0;  // increment to cancel any in-progress draw
let sheetExpanded   = false;

// ── Helpers ─────────────────────────────────────────────
const fmtDist = m => m >= 1000 ? (m/1000).toFixed(1)+' km' : Math.round(m)+' m';
const fmtTime = s => { const m=Math.round(s/60); return m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m} min`; };
const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : '';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const isMobile = () => window.innerWidth <= 700;

function haversine(la1,lo1,la2,lo2) {
  const R=6371000,dLa=(la2-la1)*Math.PI/180,dLo=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dLa/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function calcWaypoint(la1,lo1,la2,lo2,offset) {
  const mLa=(la1+la2)/2,mLo=(lo1+lo2)/2;
  const dLa=la2-la1,dLo=lo2-lo1,len=Math.sqrt(dLa*dLa+dLo*dLo)||1;
  return { lat:mLa+(-dLo/len)*offset, lon:mLo+(dLa/len)*offset };
}
function distToSegment(px,py,ax,ay,bx,by) {
  const dx=bx-ax,dy=by-ay;
  if(!dx&&!dy) return haversine(px,py,ax,ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
  return haversine(px,py,ax+t*dx,ay+t*dy);
}
function distToPoly(lat,lon,poly) {
  if(!poly) return Infinity;
  const lls=poly.getLatLngs(); let best=Infinity;
  for(let i=0;i<lls.length-1;i++){
    const d=distToSegment(lat,lon,lls[i].lat,lls[i].lng,lls[i+1].lat,lls[i+1].lng);
    if(d<best) best=d;
  }
  return best;
}
function nearestStep(lat,lon,steps) {
  let best=0,bestD=Infinity;
  steps.forEach((s,i)=>{
    const loc=s.maneuver?.location; if(!loc) return;
    const d=haversine(lat,lon,loc[1],loc[0]);
    if(d<bestD){bestD=d;best=i;}
  });
  return best;
}

// ── OSRM fetch ──────────────────────────────────────────
async function fetchOSRM(profile, pairs) {
  const base = OSRM_BASE[profile] || OSRM_BASE.driving;
  const str  = pairs.map(([la,lo])=>`${lo},${la}`).join(';');
  try {
    const r = await fetch(`${base}/driving/${str}?overview=full&geometries=geojson&steps=true`);
    if(!r.ok) return null;
    const d = await r.json();
    return (d.code==='Ok' && d.routes?.length) ? d.routes[0] : null;
  } catch { return null; }
}

// ── Map ─────────────────────────────────────────────────
function initMap() {
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({ iconUrl:BLANK_GIF, shadowUrl:BLANK_GIF, iconRetinaUrl:BLANK_GIF });
  const center = hasCoords ? [(FROM_LAT+TO_LAT)/2,(FROM_LON+TO_LON)/2] : [0,0];
  map = L.map('map', { zoomControl:!isMobile(), scrollWheelZoom:true, tap:true, center, zoom:11 });
  tileLayer = L.tileLayer(TILE_DARK, { attribution:TILE_ATTR, subdomains:'abcd', maxZoom:19, errorTileUrl:BLANK_GIF }).addTo(map);
  map.on('dragstart', ()=>{ if(gpsFollowing){gpsFollowing=false;updateFollowBtn();} });
}
function setMapTheme(dark) {
  if(!map||!tileLayer) return;
  map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(dark?TILE_DARK:TILE_LIGHT, { attribution:TILE_ATTR, subdomains:'abcd', maxZoom:19 }).addTo(map);
  tileLayer.bringToBack();
}

// ── Icons ───────────────────────────────────────────────
function pinIcon(color,label) {
  return L.divIcon({ className:'',
    html:`<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:${color};border:3px solid #fff;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,0.45);"><span style="transform:rotate(45deg);color:#fff;font-size:10px;font-weight:800">${label}</span></div>`,
    iconSize:[32,32],iconAnchor:[16,32] });
}
function attrIcon(emoji) {
  return L.divIcon({ className:'',
    html:`<div style="width:28px;height:28px;border-radius:50%;background:rgba(20,20,28,0.92);border:1.5px solid rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`,
    iconSize:[28,28],iconAnchor:[14,14] });
}

// ────────────────────────────────────────────────────────
//  CORE DRAW FUNCTION
//  This is the ONLY place that touches the map polylines.
//  Every mode switch and GPS reroute goes through here.
// ────────────────────────────────────────────────────────
async function drawRoute(uLat, uLon, mode, userLabel) {
  // 1. Bump version so any previous call's awaits know they're stale
  const myVersion = ++drawVersion;

  // 2. Immediately remove ALL existing route layers from the map
  //    Do this SYNCHRONOUSLY before any async work
  if (toStartPoly) { map.removeLayer(toStartPoly); toStartPoly = null; }
  if (vibePoly)    { map.removeLayer(vibePoly);    vibePoly    = null; }
  map.eachLayer(l => { if(l instanceof L.Marker && l !== gpsMarker) map.removeLayer(l); });
  toStartSteps = [];
  vibeSteps    = [];

  // 3. Show loading state
  showBanner(`Calculating ${MODE_LABELS[mode]||mode} route…`, 'info');
  document.getElementById('stepsList').innerHTML =
    `<div class="loading-state"><div class="spin"></div><span>Calculating route…</span></div>`;
  document.getElementById('nextStepBanner').classList.add('hidden');

  // 4. Fetch both legs
  const vibeCoords = [[FROM_LAT,FROM_LON]];
  if(WP_OFFSET) {
    const wp = calcWaypoint(FROM_LAT,FROM_LON,TO_LAT,TO_LON,WP_OFFSET);
    vibeCoords.push([wp.lat,wp.lon]);
  }
  vibeCoords.push([TO_LAT,TO_LON]);

  const distToStart = haversine(uLat,uLon,FROM_LAT,FROM_LON);
  const needLeg0    = distToStart > ARRIVE_START;

  const [leg0Route, leg1Route] = await Promise.all([
    needLeg0 ? fetchOSRM('driving', [[uLat,uLon],[FROM_LAT,FROM_LON]]) : Promise.resolve(null),
    fetchOSRM(mode, vibeCoords),
  ]);

  // 5. Check if we're still the current draw — if not, bail silently
  if (drawVersion !== myVersion) return;

  // 6. Draw leg 0 (grey dashed — fastest to start)
  if (leg0Route) {
    const lls = leg0Route.geometry.coordinates.map(([lo,la])=>[la,lo]);
    toStartPoly  = L.polyline(lls, { color:'#9ca3af', weight:3, opacity:0.55, dashArray:'8 6', lineJoin:'round' }).addTo(map);
    toStartSteps = leg0Route.legs.flatMap(l=>l.steps);
  }

  // 7. Draw leg 1 (coloured — vibe route) — instant, no animation
  if (leg1Route) {
    const lls = leg1Route.geometry.coordinates.map(([lo,la])=>[la,lo]);
    vibePoly  = L.polyline(lls, { color:ROUTE_COLOR, weight:5, opacity:0.9, lineJoin:'round', lineCap:'round' }).addTo(map);
    vibeSteps = leg1Route.legs.flatMap(l=>l.steps);
    const t=fmtTime(leg1Route.duration), d=fmtDist(leg1Route.distance);
    setStatText('statTime',t); setStatText('statDist',d);
    setStatText('statProfile', MODE_LABELS[mode]||cap(mode));
    document.getElementById('mfTime').textContent = t;
    document.getElementById('mfDist').textContent = d;
    fetchAttractions(vibePoly.getBounds());
  } else {
    document.getElementById('stepsList').innerHTML =
      `<div class="loading-state" style="color:#f87171">Could not load route — try a different mode</div>`;
  }

  // 8. Final stale check before mutating more state
  if (drawVersion !== myVersion) {
    // Another draw started during fetchAttractions or setStatText — clean up what we just drew
    if(toStartPoly){map.removeLayer(toStartPoly);toStartPoly=null;}
    if(vibePoly){map.removeLayer(vibePoly);vibePoly=null;}
    return;
  }

  // 9. Markers
  if (needLeg0) {
    L.marker([uLat,uLon],{icon:pinIcon('#9ca3af','·')}).bindTooltip('Your location',{className:'attr-tooltip'}).addTo(map);
  }
  L.marker([FROM_LAT,FROM_LON],{icon:pinIcon(ROUTE_COLOR,'A')}).bindTooltip(FROM.split(',')[0],{className:'attr-tooltip'}).addTo(map);
  L.marker([TO_LAT,TO_LON],{icon:pinIcon('#ffffff','B')}).bindTooltip(TO.split(',')[0],{className:'attr-tooltip'}).addTo(map);

  // 10. Fit bounds
  const allLls = [];
  if(toStartPoly) allLls.push(...toStartPoly.getLatLngs());
  if(vibePoly)    allLls.push(...vibePoly.getLatLngs());
  if(allLls.length) map.fitBounds(L.latLngBounds(allLls), {padding:[isMobile()?20:40,isMobile()?20:40]});

  // 11. Update footer + steps panel
  document.getElementById('mfFrom').textContent = needLeg0 ? 'Your location' : FROM.split(',')[0];
  document.getElementById('mfTo').textContent   = TO.split(',')[0];
  renderAllSteps(userLabel || 'Your location');
  hideBanner();

  // 12. GPS phase
  gpsPhase      = needLeg0 && toStartSteps.length ? 'to_start' : 'vibe';
  currentLeg    = gpsPhase === 'to_start' ? 'leg0' : 'leg1';
  currentStepIdx = 0;
  updateNextStep();
}

function setStatText(id,text) {
  const el=document.getElementById(id);
  if(el) el.querySelector('span').textContent=text;
}

// ── Everything now calls drawRoute() ────────────────────
function drawAllLegs(uLat, uLon, userLabel) {
  return drawRoute(uLat, uLon, activeMode||ROUTE_PROF, userLabel);
}

// ── Reroute (debounced) ──────────────────────────────────
function scheduleReroute(lat,lon) {
  clearTimeout(rerouteTimer);
  rerouteTimer = setTimeout(() => {
    showBanner('🔄 Recalculating…','info');
    drawRoute(lat, lon, activeMode||ROUTE_PROF);
  }, 2000);
}

// ── GPS ──────────────────────────────────────────────────
function startGPS() {
  if(!navigator.geolocation){
    showBanner('GPS unavailable — showing planned route','warn');
    setTimeout(hideBanner,3000);
    drawRoute(FROM_LAT,FROM_LON,activeMode||ROUTE_PROF,FROM.split(',')[0]);
    return;
  }
  showBanner('Locating you…','info');
  gpsWatchId = navigator.geolocation.watchPosition(onGPS,onGPSErr,
    {enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}

function onGPS(pos) {
  const lat=pos.coords.latitude, lon=pos.coords.longitude, acc=pos.coords.accuracy;
  updateUserMarker(lat,lon,acc);
  if(gpsFollowing) map.panTo([lat,lon],{animate:true,duration:0.4});
  updateFollowBtn();

  if(gpsPhase==='waiting'){
    userLat=lat; userLon=lon;
    drawRoute(lat,lon,activeMode||ROUTE_PROF);
    return;
  }
  userLat=lat; userLon=lon;

  if(gpsPhase==='to_start'){
    if(haversine(lat,lon,FROM_LAT,FROM_LON)<ARRIVE_START){
      gpsPhase='vibe'; currentLeg='leg1'; currentStepIdx=0;
      if(toStartPoly){map.removeLayer(toStartPoly);toStartPoly=null;}
      showBanner(`🛣 Now on: ${ROUTE_TITLE}`,'info');
      setTimeout(hideBanner,3500);
      updateNextStep(); return;
    }
    const idx=nearestStep(lat,lon,toStartSteps);
    if(idx!==currentStepIdx){currentStepIdx=idx;highlightStep('leg0',idx);updateNextStep();}
    checkOffRoute(lat,lon,toStartPoly,()=>scheduleReroute(lat,lon));
    return;
  }
  if(gpsPhase==='vibe'){
    if(haversine(lat,lon,TO_LAT,TO_LON)<ARRIVE_DEST){
      gpsPhase='arrived';
      document.getElementById('nextStepBanner').classList.add('hidden');
      showBanner('🎉 You have arrived!','info');
      if(vibeSteps.length) highlightStep('leg1',vibeSteps.length-1);
      return;
    }
    const idx=nearestStep(lat,lon,vibeSteps);
    if(idx!==currentStepIdx){currentStepIdx=idx;highlightStep('leg1',idx);updateNextStep();}
    checkOffRoute(lat,lon,vibePoly,()=>scheduleReroute(lat,lon));
  }
}

function onGPSErr(err) {
  const msgs={1:'Location access denied',2:'Location unavailable',3:'Location timed out'};
  showBanner(msgs[err.code]||'GPS error','error');
  if(gpsPhase==='waiting') drawRoute(FROM_LAT,FROM_LON,activeMode||ROUTE_PROF,FROM.split(',')[0]);
}

function checkOffRoute(lat,lon,poly,fn) {
  clearTimeout(offRouteTimer);
  offRouteTimer=setTimeout(()=>{
    const d=distToPoly(lat,lon,poly);
    if(d>REROUTE_M) fn();
    else if(d>OFF_ROUTE_M) showBanner('⚠ You may be off-route','warn');
    else hideBanner();
  },1000);
}

// ── User position marker ─────────────────────────────────
function updateUserMarker(lat,lon,acc) {
  const icon=L.divIcon({className:'',
    html:`<div class="gps-dot-wrap"><div class="gps-pulse"></div><div class="gps-dot"></div></div>`,
    iconSize:[24,24],iconAnchor:[12,12]});
  if(!gpsMarker) gpsMarker=L.marker([lat,lon],{icon,zIndexOffset:1000}).addTo(map);
  else gpsMarker.setLatLng([lat,lon]);
  if(!gpsAccCircle) gpsAccCircle=L.circle([lat,lon],
    {radius:acc,color:ROUTE_COLOR,fillColor:ROUTE_COLOR,fillOpacity:0.07,weight:1}).addTo(map);
  else gpsAccCircle.setLatLng([lat,lon]).setRadius(acc);
}

// ── Steps panel ──────────────────────────────────────────
function renderAllSteps(userLabel) {
  const list=document.getElementById('stepsList');
  list.innerHTML='';
  if(toStartSteps.length) {
    appendLegHeader(list,'🔵',`${userLabel||'Your location'} → ${FROM.split(',')[0]}`,'Get to start','#9ca3af');
    toStartSteps.forEach((s,i)=>appendStep(list,s,i,'leg0','#9ca3af'));
  }
  if(toStartSteps.length&&vibeSteps.length) {
    const t=document.createElement('div'); t.className='steps-transition';
    t.innerHTML=`<div class="trans-pip" style="background:${ROUTE_COLOR}"></div><span class="trans-text">▶ Begin ${esc(ROUTE_TITLE)}</span><div class="trans-pip" style="background:${ROUTE_COLOR}"></div>`;
    list.appendChild(t);
  }
  if(vibeSteps.length) {
    appendLegHeader(list,'🟣',`${FROM.split(',')[0]} → ${TO.split(',')[0]}`,ROUTE_TITLE,ROUTE_COLOR);
    vibeSteps.forEach((s,i)=>appendStep(list,s,i,'leg1',ROUTE_COLOR));
  }
}

function appendLegHeader(list,icon,route,subtitle,color) {
  const d=document.createElement('div'); d.className='leg-header';
  d.style.setProperty('--lc',color);
  d.innerHTML=`<div class="lh-bar"><span class="lh-icon">${icon}</span><div class="lh-text"><div class="lh-route">${esc(route)}</div><div class="lh-sub">${esc(subtitle)}</div></div></div>`;
  list.appendChild(d);
}

function appendStep(list,step,i,legClass,color) {
  const steps=legClass==='leg0'?toStartSteps:vibeSteps;
  const isFirst=i===0, isLast=i===steps.length-1;
  const inst=buildInstruction(step), icon=mIcon(step.maneuver.type,step.maneuver.modifier);
  const dist=step.distance>10?fmtDist(step.distance):'';
  let iconStyle='';
  if(isFirst) iconStyle=`background:${color}25;border-color:${color};color:${color}`;
  else if(isLast) iconStyle=`background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.18);color:#fff`;
  const div=document.createElement('div');
  div.className=`step-item ${legClass}`; div.dataset.leg=legClass; div.dataset.idx=i;
  const loc=step.maneuver.location;
  if(loc){ div.style.cursor='pointer';
    div.addEventListener('click',()=>{ map.flyTo([loc[1],loc[0]],16,{duration:0.7}); if(isMobile()) collapseSheet(); }); }
  div.innerHTML=`<div class="step-icon" style="${iconStyle}">${icon}</div><div class="step-body"><div class="step-instruction">${esc(inst)}</div>${step.name?`<div class="step-road">${esc(step.name)}</div>`:''}</div>${dist?`<div class="step-dist">${esc(dist)}</div>`:''}`;
  list.appendChild(div);
}

function highlightStep(leg,idx) {
  document.querySelectorAll('.step-item').forEach(el=>el.classList.toggle('step-active',el.dataset.leg===leg&&parseInt(el.dataset.idx)===idx));
  const active=document.querySelector(`.step-item[data-leg="${leg}"][data-idx="${idx}"]`);
  if(active) active.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function updateNextStep() {
  const steps=currentLeg==='leg0'?toStartSteps:vibeSteps;
  const step=steps[currentStepIdx];
  const el=document.getElementById('nextStepBanner');
  if(!el) return;
  if(!step){el.classList.add('hidden');return;}
  el.querySelector('.nsb-icon').innerHTML=mIcon(step.maneuver.type,step.maneuver.modifier);
  el.querySelector('.nsb-text').textContent=buildInstruction(step);
  el.querySelector('.nsb-dist').textContent=step.distance>10?fmtDist(step.distance):'';
  el.classList.remove('hidden');
}

function mIcon(type,mod) {
  const t=(type||'').toLowerCase(),m=(mod||'').toLowerCase();
  if(t==='depart')  return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>`;
  if(t==='arrive')  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
  if(t==='roundabout'||t==='rotary') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 7V3M17 12h4M12 17v4M7 12H3"/></svg>`;
  if(m.includes('left'))   return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  if(m.includes('right'))  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  if(m.includes('u-turn')) return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 11V7a5 5 0 0 1 10 0v10"/><polyline points="9 17 13 21 17 17"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
}

function buildInstruction(step) {
  const m=step.maneuver,type=m.type||'',mod=m.modifier||'',name=step.name||step.ref||'';
  if(type==='depart')   return `Depart${name?' from '+name:''}`;
  if(type==='arrive')   return `Arrive${name?': '+name:' at destination'}`;
  if(type==='roundabout'||type==='rotary') return `Roundabout${m.exit?`, exit ${m.exit}`:''}${name?' → '+name:''}`;
  if(type==='fork')     return `Keep ${mod||'straight'} at fork${name?' onto '+name:''}`;
  if(type==='merge')    return `Merge onto ${name||'road'}`;
  if(type==='on ramp')  return `On-ramp${name?' onto '+name:''}`;
  if(type==='off ramp') return `Off-ramp${name?' for '+name:''}`;
  const dirs={'uturn':'U-turn','sharp left':'Sharp left','sharp right':'Sharp right','slight left':'Slight left','slight right':'Slight right','left':'Turn left','right':'Turn right','straight':'Continue'};
  return `${dirs[mod]||(mod?cap(mod):'Continue')}${name?' onto '+name:''}`;
}

// ── Attractions ──────────────────────────────────────────
const ATTR_CATS={viewpoint:{emoji:'🔭',label:'Viewpoint'},museum:{emoji:'🏛',label:'Museum'},gallery:{emoji:'🎨',label:'Gallery'},park:{emoji:'🌳',label:'Park'},beach:{emoji:'🏖',label:'Beach'},waterfall:{emoji:'💧',label:'Waterfall'},monument:{emoji:'🗿',label:'Monument'},castle:{emoji:'🏰',label:'Castle'},church:{emoji:'⛪',label:'Church'},ruins:{emoji:'🏚',label:'Ruins'},zoo:{emoji:'🦁',label:'Zoo'},theme_park:{emoji:'🎢',label:'Theme Park'},attraction:{emoji:'⭐',label:'Attraction'},artwork:{emoji:'🎨',label:'Artwork'},camp_site:{emoji:'⛺',label:'Campsite'},picnic_site:{emoji:'🧺',label:'Picnic Area'},restaurant:{emoji:'🍽',label:'Restaurant'},cafe:{emoji:'☕',label:'Cafe'},bar:{emoji:'🍺',label:'Bar'},hotel:{emoji:'🏨',label:'Hotel'},tourism:{emoji:'🏛',label:'Tourism'},historic:{emoji:'🏰',label:'Historic'},natural:{emoji:'🌿',label:'Nature'},leisure:{emoji:'🎡',label:'Leisure'}};
function attrMeta(tags){for(const key of ['tourism','historic','leisure','natural','amenity']){const val=tags[key];if(!val)continue;return ATTR_CATS[val]||ATTR_CATS[key]||{emoji:'📍',label:cap(val.replace(/_/g,' '))};}return{emoji:'📍',label:'Place'};}
async function fetchAttractions(bounds){
  // If we have AI-generated stops, use those first
  if (ROUTE_STOPS && ROUTE_STOPS.length > 0) {
    renderAttractions(ROUTE_STOPS, true);
    return;
  }
  const attrList=document.getElementById('attractionsList');
  const b=[bounds.getSouth().toFixed(5),bounds.getWest().toFixed(5),bounds.getNorth().toFixed(5),bounds.getEast().toFixed(5)];
  const q2=`[out:json][timeout:25];(node["tourism"]["name"](${b});node["historic"]["name"](${b});node["natural"~"peak|waterfall|beach|spring|cave_entrance"]["name"](${b});node["leisure"~"park|nature_reserve|garden|marina"]["name"](${b});node["amenity"~"restaurant|cafe|bar"]["name"](${b});way["tourism"]["name"](${b});way["historic"]["name"](${b});way["leisure"~"park|nature_reserve|garden"]["name"](${b}););out center 60;`;
  try{const r=await fetch(OVERPASS,{method:'POST',body:'data='+encodeURIComponent(q2)});const d=await r.json();renderAttractions(d.elements||[],false);}
  catch{attrList.innerHTML=`<div class="loading-state">Could not load attractions</div>`;}
}
function renderAttractions(elements,isAiGenerated=false){
  const attrList=document.getElementById('attractionsList');attrList.innerHTML='';
  if(isAiGenerated){
    if(!elements||!elements.length){attrList.innerHTML=`<div class="loading-state" style="opacity:0.5">No stops available</div>`;return;}
    const lbl=document.createElement('div');lbl.className='attr-section-label';lbl.textContent='Attractions & Stops Along Route';attrList.appendChild(lbl);
    elements.slice(0,15).forEach((item,i)=>{const div=document.createElement('div');div.className='attraction-item';div.innerHTML=`<div class="attr-icon">⭐</div><div class="attr-body"><div class="attr-name">${esc(item.name)}</div><div class="attr-type" style="white-space:normal;font-size:0.85em;margin-top:2px;">${esc(item.description)}</div></div><div class="attr-dist">Stop ${i+1}</div>`;attrList.appendChild(div);});
    return;
  }
  const seen=new Set(),items=[];
  for(const el of elements){const name=el.tags?.name;if(!name||seen.has(name.toLowerCase()))continue;seen.add(name.toLowerCase());const lat=el.lat??el.center?.lat,lon=el.lon??el.center?.lon;if(!lat||!lon)continue;items.push({name,tags:el.tags,lat,lon,dist:haversine((FROM_LAT+TO_LAT)/2,(FROM_LON+TO_LON)/2,lat,lon)});}
  items.sort((a,b)=>a.dist-b.dist);
  if(!items.length){attrList.innerHTML=`<div class="loading-state" style="opacity:0.5">No attractions found</div>`;return;}
  const along=items.filter(i=>i.dist<50000),nearby=items.filter(i=>i.dist>=50000).slice(0,5);
  function renderGroup(label,group){if(!group.length)return;const lbl=document.createElement('div');lbl.className='attr-section-label';lbl.textContent=label;attrList.appendChild(lbl);
    group.slice(0,15).forEach(item=>{const meta=attrMeta(item.tags);const distLabel=item.dist<1000?Math.round(item.dist)+' m':(item.dist/1000).toFixed(1)+' km';const div=document.createElement('div');div.className='attraction-item';div.innerHTML=`<div class="attr-icon">${meta.emoji}</div><div class="attr-body"><div class="attr-name">${esc(item.name)}</div><div class="attr-type">${esc(meta.label)}</div></div><div class="attr-dist">${distLabel}</div>`;div.addEventListener('click',()=>{map.flyTo([item.lat,item.lon],15,{duration:0.9});attrList.querySelectorAll('.attraction-item').forEach(e=>e.classList.remove('highlighted'));div.classList.add('highlighted');if(isMobile())collapseSheet();});attrList.appendChild(div);const mk=L.marker([item.lat,item.lon],{icon:attrIcon(meta.emoji)}).bindTooltip(item.name,{className:'attr-tooltip',direction:'top'}).addTo(map);mk.on('click',()=>{attrList.querySelectorAll('.attraction-item').forEach(e=>e.classList.remove('highlighted'));div.classList.add('highlighted');div.scrollIntoView({behavior:'smooth',block:'nearest'});switchTab('attractions');if(isMobile())expandSheet();});attractionMarkers.push(mk);});}
  renderGroup('Along The Way',along);renderGroup('Nearby',nearby);
}

// ── About ────────────────────────────────────────────────
function renderAbout(){
  const dc={easy:'badge-easy',medium:'badge-medium',hard:'badge-hard',extreme:'badge-extreme'};
  const dl={easy:'Easy',medium:'Moderate',hard:'Hard',extreme:'Extreme'};
  document.getElementById('aboutContent').innerHTML=`<span class="about-badge ${dc[ROUTE_DIFF]||'badge-easy'}">${dl[ROUTE_DIFF]||'Easy'}</span><p class="about-desc">${esc(ROUTE_DESC)}</p>${HIGHLIGHTS.length?`<div class="about-highlights-label">What you'll see</div><ul class="about-highlights">${HIGHLIGHTS.map(h=>`<li>${esc(h)}</li>`).join('')}</ul>`:''}`;
}

// ── GPS UI ───────────────────────────────────────────────
function showBanner(msg,type='info'){const el=document.getElementById('gpsBanner');if(!el)return;el.textContent=msg;el.className=`gps-banner gps-banner-${type}`;el.style.display='block';}
function hideBanner(){const el=document.getElementById('gpsBanner');if(el)el.style.display='none';}
function toggleFollow(){gpsFollowing=!gpsFollowing;updateFollowBtn();if(gpsFollowing&&gpsMarker)map.panTo(gpsMarker.getLatLng(),{animate:true});}
function updateFollowBtn(){const btn=document.getElementById('followBtn');if(!btn)return;btn.classList.toggle('follow-active',gpsFollowing);}

// ── Tabs ─────────────────────────────────────────────────
function switchTab(name){document.querySelectorAll('.ptab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('.tab-content').forEach(el=>el.classList.toggle('active',el.id===`tab-${name}`));}
document.querySelector('.panel-tabs').addEventListener('click',e=>{const btn=e.target.closest('.ptab');if(btn)switchTab(btn.dataset.tab);});

// ── Panel collapse ───────────────────────────────────────
const sidePanel=document.getElementById('sidePanel');
const collapseBtn=document.getElementById('collapseBtn');
const expandBtn=document.getElementById('expandBtn');
const sheetHandle=document.getElementById('sheetHandle');
function collapseSheet(){sidePanel.classList.add('sheet-collapsed');sidePanel.classList.remove('sheet-expanded');sheetExpanded=false;if(expandBtn)expandBtn.classList.remove('hidden');setTimeout(()=>map&&map.invalidateSize(),350);}
function expandSheet(){sidePanel.classList.remove('sheet-collapsed');sidePanel.classList.add('sheet-expanded');sheetExpanded=true;if(expandBtn)expandBtn.classList.add('hidden');setTimeout(()=>map&&map.invalidateSize(),350);}
collapseBtn?.addEventListener('click',()=>{if(isMobile())collapseSheet();else{sidePanel.classList.add('collapsed');expandBtn?.classList.remove('hidden');setTimeout(()=>map&&map.invalidateSize(),350);}});
expandBtn?.addEventListener('click',()=>{if(isMobile())expandSheet();else{sidePanel.classList.remove('collapsed');expandBtn?.classList.add('hidden');setTimeout(()=>map&&map.invalidateSize(),350);}});
sheetHandle?.addEventListener('click',()=>{sheetExpanded?collapseSheet():expandSheet();});
document.getElementById('followBtn')?.addEventListener('click',toggleFollow);

// ── Theme ────────────────────────────────────────────────
function toggleTheme(){isDark=!isDark;document.body.classList.toggle('light-mode',!isDark);setMapTheme(isDark);const btn=document.getElementById('themeBtn');if(!btn)return;btn.querySelector('.icon-moon').style.display=isDark?'block':'none';btn.querySelector('.icon-sun').style.display=!isDark?'block':'none';}
document.getElementById('themeBtn')?.addEventListener('click',toggleTheme);

// ── Mode switcher ────────────────────────────────────────
function setActiveModeBtn(mode){document.querySelectorAll('.mode-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));}

async function fetchAllModeTimes(){
  const baseCoords=[[FROM_LAT,FROM_LON],[TO_LAT,TO_LON]];
  ['driving','cycling','foot'].forEach(async mode=>{
    const route=await fetchOSRM(mode,baseCoords);
    const el=document.getElementById(`modeTime-${mode}`);
    if(el) el.textContent=route?fmtTime(route.duration):'—';
  });
}

document.getElementById('modeSwitcher')?.addEventListener('click', e=>{
  const btn=e.target.closest('.mode-btn');
  if(!btn||btn.dataset.mode===activeMode) return;
  activeMode=btn.dataset.mode;
  setActiveModeBtn(activeMode);
  const uLat=userLat??FROM_LAT, uLon=userLon??FROM_LON;
  drawRoute(uLat, uLon, activeMode);
});

// ── Boot ─────────────────────────────────────────────────
async function boot(){
  document.getElementById('backToRoutes').href=`routes.html?${BACK_PARAMS}`;
  if(!hasCoords){document.getElementById('stepsList').innerHTML=`<div class="loading-state" style="color:#f87171">No coordinates — <a href="index.html" style="color:var(--accent)">go back</a></div>`;return;}
  activeMode=ROUTE_PROF;
  setActiveModeBtn(activeMode);
  fetchAllModeTimes();
  document.getElementById('summaryName').textContent=ROUTE_TITLE;
  document.getElementById('summaryFrom').textContent=FROM;
  document.getElementById('summaryTo').textContent=TO;
  document.getElementById('mfFrom').textContent=FROM.split(',')[0];
  document.getElementById('mfTo').textContent=TO.split(',')[0];
  renderAbout();
  initMap();
  if(isMobile()) sidePanel.classList.add('sheet-peek');
  startGPS();
}
boot();