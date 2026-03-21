// ════════════════════════════════════════════════════════
//  directions.js  —  RouteFinder
//
//  Three-segment route:
//    Leg 0 (grey dashed):   Your GPS location → Start point
//    Leg 1 (route colour):  Start point → Destination (vibe)
//
//  Steps panel shows all legs with clear dividers.
//  Light / dark mode toggled via body.dark class.
// ════════════════════════════════════════════════════════

// ── URL params ──────────────────────────────────────────
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
const BACK_PARAMS = q.get('backParams') || '';

// ── APIs ────────────────────────────────────────────────
const OSRM     = 'https://router.project-osrm.org/route/v1';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR  = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>';

const hasCoords = !isNaN(FROM_LAT) && !isNaN(FROM_LON) && !isNaN(TO_LAT) && !isNaN(TO_LON);

// ── State ───────────────────────────────────────────────
let map, tileLayer;
let isDark        = true;
let attractionMarkers = [];
let gpsWatchId    = null;
let gpsMarker     = null;
let gpsAccCircle  = null;
let gpsFollowing  = true;
let userLat       = null;
let userLon       = null;
let gpsPhase      = 'waiting'; // 'waiting'|'to_start'|'vibe'|'arrived'

let toStartPoly   = null;   // grey dashed: user → start
let vibePoly      = null;   // coloured: start → dest

let toStartSteps  = [];
let vibeSteps     = [];

let currentLeg    = 'to_start'; // which leg we're tracking
let currentStepIdx = 0;

let offRouteTimer  = null;
let isRerouting    = false;
const OFF_ROUTE_M  = 80;
const REROUTE_M    = 150;

// ── Helpers ─────────────────────────────────────────────
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
const fmtTime = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m} min`; };
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, dLa = (la2-la1)*Math.PI/180, dLo = (lo2-lo1)*Math.PI/180;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcWaypoint(la1, lo1, la2, lo2, offset) {
  const mLa=(la1+la2)/2, mLo=(lo1+lo2)/2;
  const dLa=la2-la1, dLo=lo2-lo1, len=Math.sqrt(dLa*dLa+dLo*dLo)||1;
  return { lat: mLa + (-dLo/len)*offset, lon: mLo + (dLa/len)*offset };
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx=bx-ax, dy=by-ay;
  if (!dx && !dy) return haversine(px,py,ax,ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
  return haversine(px, py, ax+t*dx, ay+t*dy);
}

function distToPoly(lat, lon, poly) {
  if (!poly) return Infinity;
  const lls = poly.getLatLngs();
  let best = Infinity;
  for (let i = 0; i < lls.length-1; i++) {
    const d = distToSegment(lat, lon, lls[i].lat, lls[i].lng, lls[i+1].lat, lls[i+1].lng);
    if (d < best) best = d;
  }
  return best;
}

function nearestStep(lat, lon, steps) {
  let best = 0, bestD = Infinity;
  steps.forEach((s, i) => {
    const loc = s.maneuver?.location;
    if (!loc) return;
    const d = haversine(lat, lon, loc[1], loc[0]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// ── OSRM fetch ──────────────────────────────────────────
async function fetchOSRM(profile, pairs) {
  const str = pairs.map(([la, lo]) => `${lo},${la}`).join(';');
  try {
    const r = await fetch(`${OSRM}/${profile}/${str}?overview=full&geometries=geojson&steps=true`);
    if (!r.ok) return null;
    const d = await r.json();
    return (d.code === 'Ok' && d.routes?.length) ? d.routes[0] : null;
  } catch { return null; }
}

// ── Map ─────────────────────────────────────────────────
function initMap() {
  // Fix: Leaflet's default marker tries to load marker-icon.png from a
  // broken relative path when served locally, rendering as a giant arrow.
  // We use only custom divIcons so just delete the default entirely.
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl:       'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    shadowUrl:     'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    iconRetinaUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
  });

  map = L.map('map', {
    zoomControl: true,
    scrollWheelZoom: true,
    // Start centred on the destination area so the map isn't blank
    center: [isNaN(FROM_LAT) ? 0 : (FROM_LAT + TO_LAT) / 2,
             isNaN(FROM_LON) ? 0 : (FROM_LON + TO_LON) / 2],
    zoom: 10,
  });

  tileLayer = L.tileLayer(TILE_DARK, {
    attribution: TILE_ATTR,
    subdomains: 'abcd',
    maxZoom: 19,
    // Retry failed tiles up to 3 times
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
  }).addTo(map);

  map.on('dragstart', () => {
    if (gpsFollowing) { gpsFollowing = false; updateFollowBtn(); }
  });
}

function setMapTheme(dark) {
  if (!map || !tileLayer) return;
  map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(dark ? TILE_DARK : TILE_LIGHT, {
    attribution: TILE_ATTR, subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
  tileLayer.bringToBack();
}

// ── Icons ───────────────────────────────────────────────
function pinIcon(color, label) {
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;
      background:${color};border:3px solid #fff;transform:rotate(-45deg);
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 3px 12px rgba(0,0,0,0.45);">
      <span style="transform:rotate(45deg);color:#fff;font-size:11px;font-weight:800">${label}</span>
    </div>`,
    iconSize: [34,34], iconAnchor: [17,34]
  });
}

function attrIcon(emoji) {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:50%;
      background:rgba(20,20,28,0.9);border:1.5px solid rgba(255,255,255,0.18);
      display:flex;align-items:center;justify-content:center;
      font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`,
    iconSize: [30,30], iconAnchor: [15,15]
  });
}

// ── Animated polyline ────────────────────────────────────
function animatePoly(latLngs, color, dashed = false) {
  const total = latLngs.length;
  let drawn = 0;
  const step = Math.max(1, Math.floor(total / 100));
  const poly = L.polyline([], {
    color, weight: dashed ? 3 : 5, opacity: dashed ? 0.55 : 0.9,
    lineJoin: 'round', lineCap: 'round',
    ...(dashed ? { dashArray: '8 6' } : {})
  }).addTo(map);
  return new Promise(resolve => {
    function tick() {
      drawn = Math.min(drawn + step, total);
      poly.setLatLngs(latLngs.slice(0, drawn));
      if (drawn < total) requestAnimationFrame(tick);
      else resolve(poly);
    }
    requestAnimationFrame(tick);
  });
}

// ── Manoeuvre icons ──────────────────────────────────────
function mIcon(type, mod) {
  const t = (type||'').toLowerCase(), m = (mod||'').toLowerCase();
  if (t === 'depart')  return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>`;
  if (t === 'arrive')  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
  if (t==='roundabout'||t==='rotary') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 7V3M17 12h4M12 17v4M7 12H3"/></svg>`;
  if (m.includes('left'))   return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  if (m.includes('right'))  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  if (m.includes('u-turn')) return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 11V7a5 5 0 0 1 10 0v10"/><polyline points="9 17 13 21 17 17"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
}

function buildInstruction(step) {
  const m = step.maneuver, type = m.type||'', mod = m.modifier||'', name = step.name||step.ref||'';
  if (type==='depart')  return `Depart${name ? ' from '+name : ''}`;
  if (type==='arrive')  return `Arrive${name ? ': '+name : ' at destination'}`;
  if (type==='roundabout'||type==='rotary') return `Enter roundabout${m.exit?`, exit ${m.exit}`:''}${name?' onto '+name:''}`;
  if (type==='fork')    return `Keep ${mod||'straight'} at fork${name?' onto '+name:''}`;
  if (type==='merge')   return `Merge onto ${name||'road'}`;
  if (type==='on ramp') return `Take on-ramp${name?' onto '+name:''}`;
  if (type==='off ramp') return `Take off-ramp${name?' for '+name:''}`;
  const dirs = { 'uturn':'U-turn','sharp left':'Turn sharp left','sharp right':'Turn sharp right',
    'slight left':'Keep slightly left','slight right':'Keep slightly right',
    'left':'Turn left','right':'Turn right','straight':'Continue straight' };
  return `${dirs[mod]||(mod?cap(mod):'Continue')}${name?' onto '+name:''}`;
}

// ── Render full steps panel ──────────────────────────────
// Called once with both legs so everything is visible up front
function renderAllSteps(userLabel) {
  const list = document.getElementById('stepsList');
  list.innerHTML = '';

  // ── Leg 0: User → Start ──────────────────────────────
  if (toStartSteps.length) {
    appendDivider(list, '🔵', `${userLabel || 'Your location'} → ${FROM.split(',')[0]}`, '#888');
    toStartSteps.forEach((step, i) => appendStep(list, step, i, 'leg0', '#888'));
  }

  // ── Transition divider ───────────────────────────────
  if (toStartSteps.length && vibeSteps.length) {
    const trans = document.createElement('div');
    trans.className = 'steps-transition';
    trans.innerHTML = `
      <div class="trans-dot" style="background:${ROUTE_COLOR}"></div>
      <div class="trans-label">Begin ${ROUTE_TITLE}</div>
      <div class="trans-dot" style="background:${ROUTE_COLOR}"></div>`;
    list.appendChild(trans);
  }

  // ── Leg 1: Start → Destination ───────────────────────
  if (vibeSteps.length) {
    appendDivider(list, '🟣', `${FROM.split(',')[0]} → ${TO.split(',')[0]}`, ROUTE_COLOR);
    vibeSteps.forEach((step, i) => appendStep(list, step, i, 'leg1', ROUTE_COLOR));
  }
}

function appendDivider(list, icon, label, color) {
  const div = document.createElement('div');
  div.className = 'leg-divider';
  div.innerHTML = `
    <div class="leg-divider-bar" style="background:${color}20;border-left:3px solid ${color}">
      <span class="leg-divider-icon">${icon}</span>
      <span class="leg-divider-label">${esc(label)}</span>
    </div>`;
  list.appendChild(div);
}

function appendStep(list, step, i, legClass, color) {
  const isFirst = i === 0, isLast = i === (legClass === 'leg0' ? toStartSteps : vibeSteps).length - 1;
  const inst = buildInstruction(step);
  const icon = mIcon(step.maneuver.type, step.maneuver.modifier);
  const dist = step.distance > 10 ? fmtDist(step.distance) : '';
  const iconBg = isFirst ? `${color}30` : isLast ? 'rgba(255,255,255,0.08)' : '';
  const iconBorder = isFirst ? color : isLast ? 'rgba(255,255,255,0.2)' : '';

  const div = document.createElement('div');
  div.className = `step-item ${legClass}`;
  div.dataset.leg = legClass;
  div.dataset.idx = i;

  const loc = step.maneuver.location;
  if (loc) {
    div.style.cursor = 'pointer';
    div.addEventListener('click', () => map.flyTo([loc[1], loc[0]], 16, { duration: 0.8 }));
  }

  div.innerHTML = `
    <div class="step-icon" style="${iconBg?`background:${iconBg};border-color:${iconBorder};color:${color}`:''}">
      ${icon}
    </div>
    <div class="step-body">
      <div class="step-instruction">${esc(inst)}</div>
      ${step.name ? `<div class="step-road">${esc(step.name)}</div>` : ''}
    </div>
    ${dist ? `<div class="step-dist">${esc(dist)}</div>` : ''}`;

  list.appendChild(div);
}

function highlightStep(leg, idx) {
  document.querySelectorAll('.step-item').forEach(el => {
    el.classList.toggle('step-active',
      el.dataset.leg === leg && parseInt(el.dataset.idx) === idx);
  });
  const active = document.querySelector(`.step-item[data-leg="${leg}"][data-idx="${idx}"]`);
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Attractions ──────────────────────────────────────────
const ATTR_CATS = {
  viewpoint:{emoji:'🔭',label:'Viewpoint'}, museum:{emoji:'🏛',label:'Museum'},
  gallery:{emoji:'🎨',label:'Gallery'}, park:{emoji:'🌳',label:'Park'},
  beach:{emoji:'🏖',label:'Beach'}, waterfall:{emoji:'💧',label:'Waterfall'},
  monument:{emoji:'🗿',label:'Monument'}, castle:{emoji:'🏰',label:'Castle'},
  church:{emoji:'⛪',label:'Church'}, ruins:{emoji:'🏚',label:'Ruins'},
  zoo:{emoji:'🦁',label:'Zoo'}, theme_park:{emoji:'🎢',label:'Theme Park'},
  attraction:{emoji:'⭐',label:'Attraction'}, artwork:{emoji:'🎨',label:'Artwork'},
  camp_site:{emoji:'⛺',label:'Campsite'}, picnic_site:{emoji:'🧺',label:'Picnic Area'},
  restaurant:{emoji:'🍽',label:'Restaurant'}, cafe:{emoji:'☕',label:'Cafe'},
  bar:{emoji:'🍺',label:'Bar'}, hotel:{emoji:'🏨',label:'Hotel'},
  tourism:{emoji:'🏛',label:'Tourism'}, historic:{emoji:'🏰',label:'Historic'},
  natural:{emoji:'🌿',label:'Nature'}, leisure:{emoji:'🎡',label:'Leisure'},
};

function attrMeta(tags) {
  for (const key of ['tourism','historic','leisure','natural','amenity']) {
    const val = tags[key];
    if (!val) continue;
    return ATTR_CATS[val] || ATTR_CATS[key] || { emoji:'📍', label: cap(val.replace(/_/g,' ')) };
  }
  return { emoji:'📍', label:'Place' };
}

async function fetchAttractions(bounds) {
  const attrList = document.getElementById('attractionsList');
  const b = [bounds.getSouth().toFixed(5), bounds.getWest().toFixed(5),
             bounds.getNorth().toFixed(5), bounds.getEast().toFixed(5)];
  const query = `[out:json][timeout:25];(
    node["tourism"]["name"](${b});node["historic"]["name"](${b});
    node["natural"~"peak|waterfall|beach|spring|cave_entrance"]["name"](${b});
    node["leisure"~"park|nature_reserve|garden|marina"]["name"](${b});
    node["amenity"~"restaurant|cafe|bar"]["name"](${b});
    way["tourism"]["name"](${b});way["historic"]["name"](${b});
    way["leisure"~"park|nature_reserve|garden"]["name"](${b});
  );out center 60;`;
  try {
    const r = await fetch(OVERPASS, { method:'POST', body:'data='+encodeURIComponent(query) });
    const d = await r.json();
    renderAttractions(d.elements || []);
  } catch {
    attrList.innerHTML = `<div class="loading-state">Could not load attractions</div>`;
  }
}

function renderAttractions(elements) {
  const attrList = document.getElementById('attractionsList');
  attrList.innerHTML = '';
  const seen = new Set(), items = [];

  for (const el of elements) {
    const name = el.tags?.name;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) continue;
    const mid = { lat: (FROM_LAT+TO_LAT)/2, lon: (FROM_LON+TO_LON)/2 };
    items.push({ name, tags: el.tags, lat, lon, dist: haversine(mid.lat, mid.lon, lat, lon) });
  }

  items.sort((a, b) => a.dist - b.dist);

  if (!items.length) {
    attrList.innerHTML = `<div class="loading-state" style="opacity:0.5">No attractions found along this route</div>`;
    return;
  }

  const along  = items.filter(i => i.dist < 50000);
  const nearby = items.filter(i => i.dist >= 50000).slice(0, 5);

  function renderGroup(label, group) {
    if (!group.length) return;
    const lbl = document.createElement('div');
    lbl.className = 'attr-section-label';
    lbl.textContent = label;
    attrList.appendChild(lbl);

    group.slice(0, 15).forEach(item => {
      const meta = attrMeta(item.tags);
      const distLabel = item.dist < 1000 ? Math.round(item.dist)+' m' : (item.dist/1000).toFixed(1)+' km';
      const div = document.createElement('div');
      div.className = 'attraction-item';
      div.innerHTML = `
        <div class="attr-icon">${meta.emoji}</div>
        <div class="attr-body">
          <div class="attr-name">${esc(item.name)}</div>
          <div class="attr-type">${esc(meta.label)}${item.tags.operator?' · '+esc(item.tags.operator):''}</div>
        </div>
        <div class="attr-dist">${distLabel}</div>`;
      div.addEventListener('click', () => {
        map.flyTo([item.lat, item.lon], 15, { duration: 0.9 });
        attrList.querySelectorAll('.attraction-item').forEach(e => e.classList.remove('highlighted'));
        div.classList.add('highlighted');
      });
      attrList.appendChild(div);

      const mk = L.marker([item.lat, item.lon], { icon: attrIcon(meta.emoji) })
        .bindTooltip(item.name, { className: 'attr-tooltip', direction: 'top' })
        .addTo(map);
      mk.on('click', () => {
        attrList.querySelectorAll('.attraction-item').forEach(e => e.classList.remove('highlighted'));
        div.classList.add('highlighted');
        div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        switchTab('attractions');
      });
      attractionMarkers.push(mk);
    });
  }

  renderGroup('Along The Way', along);
  renderGroup('Nearby', nearby);
}

// ════════════════════════════════════════════════════════
//  ROUTING LOGIC
// ════════════════════════════════════════════════════════

// Draw leg 0 (user → start) and leg 1 (start → dest) together
async function drawAllLegs(uLat, uLon, userLabel) {
  showBanner('Calculating your route…', 'info');

  // Fetch both legs in parallel
  const vibeCoords = [[FROM_LAT, FROM_LON]];
  if (WP_OFFSET) {
    const wp = calcWaypoint(FROM_LAT, FROM_LON, TO_LAT, TO_LON, WP_OFFSET);
    vibeCoords.push([wp.lat, wp.lon]);
  }
  vibeCoords.push([TO_LAT, TO_LON]);

  const distToStart = haversine(uLat, uLon, FROM_LAT, FROM_LON);
  const needToStartLeg = distToStart > 50; // skip if already at start

  const [toStartRoute, vibeRoute] = await Promise.all([
    needToStartLeg ? fetchOSRM('driving', [[uLat, uLon], [FROM_LAT, FROM_LON]]) : Promise.resolve(null),
    fetchOSRM(ROUTE_PROF, vibeCoords),
  ]);

  // ── Remove old polylines ─────────────────────────────
  if (toStartPoly) { map.removeLayer(toStartPoly); toStartPoly = null; }
  if (vibePoly)    { map.removeLayer(vibePoly);    vibePoly = null;    }

  // ── Draw leg 0 ───────────────────────────────────────
  if (toStartRoute) {
    const lls = toStartRoute.geometry.coordinates.map(([lo, la]) => [la, lo]);
    toStartPoly  = await animatePoly(lls, '#9ca3af', true);
    toStartSteps = toStartRoute.legs.flatMap(l => l.steps);
  } else {
    toStartSteps = [];
  }

  // ── Draw leg 1 ───────────────────────────────────────
  if (vibeRoute) {
    const lls = vibeRoute.geometry.coordinates.map(([lo, la]) => [la, lo]);
    vibePoly  = await animatePoly(lls, ROUTE_COLOR, false);
    vibeSteps = vibeRoute.legs.flatMap(l => l.steps);

    // Stats from vibe leg
    document.getElementById('statTime').querySelector('span').textContent = fmtTime(vibeRoute.duration);
    document.getElementById('statDist').querySelector('span').textContent = fmtDist(vibeRoute.distance);
    document.getElementById('statProfile').querySelector('span').textContent = cap(ROUTE_PROF);
    document.getElementById('mfTime').textContent = fmtTime(vibeRoute.duration);
    document.getElementById('mfDist').textContent = fmtDist(vibeRoute.distance);

    fetchAttractions(vibePoly.getBounds());
  } else {
    vibeSteps = [];
    document.getElementById('stepsList').innerHTML =
      `<div class="loading-state" style="color:#f87171">Could not load route from OSRM</div>`;
  }

  // ── Markers ──────────────────────────────────────────
  // Clear old markers (keep gpsMarker)
  map.eachLayer(l => {
    if (l instanceof L.Marker && l !== gpsMarker) map.removeLayer(l);
  });
  if (needToStartLeg) {
    L.marker([uLat, uLon], { icon: pinIcon('#9ca3af', '📍') })
      .bindTooltip('Your location', { className: 'attr-tooltip' }).addTo(map);
  }
  L.marker([FROM_LAT, FROM_LON], { icon: pinIcon(ROUTE_COLOR, 'A') })
    .bindTooltip(FROM.split(',')[0], { className: 'attr-tooltip' }).addTo(map);
  L.marker([TO_LAT, TO_LON], { icon: pinIcon('#ffffff', 'B') })
    .bindTooltip(TO.split(',')[0], { className: 'attr-tooltip' }).addTo(map);

  // ── Fit bounds ───────────────────────────────────────
  const allLls = [];
  if (toStartPoly) allLls.push(...toStartPoly.getLatLngs());
  if (vibePoly)    allLls.push(...vibePoly.getLatLngs());
  if (allLls.length) map.fitBounds(L.latLngBounds(allLls), { padding: [40, 40] });

  // ── Steps panel ──────────────────────────────────────
  renderAllSteps(userLabel || 'Your location');

  // ── Footer from/to ───────────────────────────────────
  document.getElementById('mfFrom').textContent = needToStartLeg ? 'Your location' : FROM.split(',')[0];
  document.getElementById('mfTo').textContent   = TO.split(',')[0];

  hideBanner();

  // Set initial phase
  if (needToStartLeg && toStartSteps.length) {
    gpsPhase   = 'to_start';
    currentLeg = 'leg0';
  } else {
    gpsPhase   = 'vibe';
    currentLeg = 'leg1';
  }
  currentStepIdx = 0;
  updateNextStep();
}

// ── Reroute both legs from new user position ─────────────
async function reroute(lat, lon) {
  if (isRerouting) return;
  isRerouting = true;
  showBanner('🔄 Recalculating…', 'info');
  await drawAllLegs(lat, lon);
  isRerouting = false;
}

// ── GPS callbacks ────────────────────────────────────────
function startGPS() {
  if (!navigator.geolocation) {
    showBanner('GPS not supported — showing planned route', 'warn');
    drawAllLegs(FROM_LAT, FROM_LON, FROM.split(',')[0]);
    return;
  }
  showBanner('Locating you…', 'info');
  gpsWatchId = navigator.geolocation.watchPosition(onGPS, onGPSErr,
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
}

function onGPS(pos) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const acc = pos.coords.accuracy;

  updateUserMarker(lat, lon, acc);
  if (gpsFollowing) map.panTo([lat, lon], { animate: true, duration: 0.4 });
  updateFollowBtn();

  if (gpsPhase === 'waiting') {
    // First GPS fix — draw everything
    userLat = lat; userLon = lon;
    drawAllLegs(lat, lon);
    return;
  }

  userLat = lat; userLon = lon;

  // Phase transitions
  if (gpsPhase === 'to_start') {
    const d = haversine(lat, lon, FROM_LAT, FROM_LON);
    if (d < 50) {
      // Reached start — transition to vibe phase
      gpsPhase = 'vibe'; currentLeg = 'leg1'; currentStepIdx = 0;
      if (toStartPoly) { map.removeLayer(toStartPoly); toStartPoly = null; }
      showBanner(`🛣 Now on ${ROUTE_TITLE}`, 'info');
      setTimeout(hideBanner, 3000);
    }
    // Highlight nearest to-start step
    const idx = nearestStep(lat, lon, toStartSteps);
    if (idx !== currentStepIdx) { currentStepIdx = idx; highlightStep('leg0', idx); updateNextStep(); }
    // Off-route check
    checkOffRoute(lat, lon, toStartPoly, () => reroute(lat, lon));
    return;
  }

  if (gpsPhase === 'vibe') {
    const d = haversine(lat, lon, TO_LAT, TO_LON);
    if (d < 50) {
      gpsPhase = 'arrived';
      document.getElementById('nextStepBanner').classList.add('hidden');
      showBanner('🎉 You have arrived!', 'info');
      return;
    }
    const idx = nearestStep(lat, lon, vibeSteps);
    if (idx !== currentStepIdx) { currentStepIdx = idx; highlightStep('leg1', idx); updateNextStep(); }
    checkOffRoute(lat, lon, vibePoly, () => reroute(lat, lon));
  }
}

function onGPSErr(err) {
  const msgs = { 1:'Location denied — showing planned route', 2:'Location unavailable', 3:'Location timed out' };
  showBanner(msgs[err.code] || 'GPS error', 'error');
  if (gpsPhase === 'waiting') drawAllLegs(FROM_LAT, FROM_LON, FROM.split(',')[0]);
}

function checkOffRoute(lat, lon, poly, fn) {
  clearTimeout(offRouteTimer);
  offRouteTimer = setTimeout(() => {
    const d = distToPoly(lat, lon, poly);
    if (d > REROUTE_M)      fn();
    else if (d > OFF_ROUTE_M) showBanner('⚠ You may be off-route', 'warn');
    else                      hideBanner();
  }, 800);
}

// ── User marker ──────────────────────────────────────────
function updateUserMarker(lat, lon, acc) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="gps-dot-wrap"><div class="gps-pulse"></div><div class="gps-dot"></div></div>`,
    iconSize: [24,24], iconAnchor: [12,12]
  });
  if (!gpsMarker) gpsMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map);
  else gpsMarker.setLatLng([lat, lon]);

  if (!gpsAccCircle) gpsAccCircle = L.circle([lat, lon],
    { radius: acc, color: ROUTE_COLOR, fillColor: ROUTE_COLOR, fillOpacity: 0.07, weight: 1 }).addTo(map);
  else gpsAccCircle.setLatLng([lat, lon]).setRadius(acc);
}

// ── Next step banner ─────────────────────────────────────
function updateNextStep() {
  const steps = currentLeg === 'leg0' ? toStartSteps : vibeSteps;
  const step  = steps[currentStepIdx];
  const el    = document.getElementById('nextStepBanner');
  if (!el || !step) return;
  el.querySelector('.nsb-icon').innerHTML = mIcon(step.maneuver.type, step.maneuver.modifier);
  el.querySelector('.nsb-text').textContent = buildInstruction(step);
  el.querySelector('.nsb-dist').textContent = step.distance > 10 ? fmtDist(step.distance) : '';
  el.classList.remove('hidden');
}

// ── Follow toggle ────────────────────────────────────────
function toggleFollow() {
  gpsFollowing = !gpsFollowing; updateFollowBtn();
  if (gpsFollowing && gpsMarker) map.panTo(gpsMarker.getLatLng(), { animate: true });
}
function updateFollowBtn() {
  const btn = document.getElementById('followBtn'); if (!btn) return;
  btn.classList.toggle('follow-active', gpsFollowing);
}

// ── Banner helpers ───────────────────────────────────────
function showBanner(msg, type = 'info') {
  const el = document.getElementById('gpsBanner'); if (!el) return;
  el.textContent = msg;
  el.className   = `gps-banner gps-banner-${type}`;
  el.style.display = 'block';
}
function hideBanner() {
  const el = document.getElementById('gpsBanner');
  if (el) el.style.display = 'none';
}

// ── About tab ────────────────────────────────────────────
function renderAbout() {
  const dc = { easy:'badge-easy', medium:'badge-medium', hard:'badge-hard', extreme:'badge-extreme' };
  const dl = { easy:'Easy', medium:'Moderate', hard:'Hard', extreme:'Extreme' };
  document.getElementById('aboutContent').innerHTML = `
    <span class="about-badge ${dc[ROUTE_DIFF]||'badge-easy'}">${dl[ROUTE_DIFF]||'Easy'}</span>
    <p class="about-desc">${esc(ROUTE_DESC)}</p>
    ${HIGHLIGHTS.length ? `<div class="about-highlights-label">What you'll see</div>
    <ul class="about-highlights">${HIGHLIGHTS.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}`;
}

// ── Tabs ─────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === `tab-${name}`));
}
document.querySelector('.panel-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.ptab');
  if (btn) switchTab(btn.dataset.tab);
});

// ── Panel collapse ───────────────────────────────────────
const sidePanel   = document.getElementById('sidePanel');
const collapseBtn = document.getElementById('collapseBtn');
const expandBtn   = document.getElementById('expandBtn');

collapseBtn.addEventListener('click', () => {
  sidePanel.classList.add('collapsed');
  expandBtn.classList.remove('hidden');
  setTimeout(() => map.invalidateSize(), 320);
});
expandBtn.addEventListener('click', () => {
  sidePanel.classList.remove('collapsed');
  expandBtn.classList.add('hidden');
  setTimeout(() => map.invalidateSize(), 320);
});

document.getElementById('followBtn')?.addEventListener('click', toggleFollow);

// ── Light / Dark Mode ────────────────────────────────────
function toggleTheme() {
  isDark = !isDark;
  document.body.classList.toggle('light-mode', !isDark);
  setMapTheme(isDark);
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  btn.querySelector('.icon-moon').style.display = isDark  ? 'block' : 'none';
  btn.querySelector('.icon-sun').style.display  = !isDark ? 'block' : 'none';
}
document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);

// ── Boot ─────────────────────────────────────────────────
async function boot() {
  document.getElementById('backToRoutes').href = `routes.html?${BACK_PARAMS}`;

  if (!hasCoords) {
    document.getElementById('stepsList').innerHTML =
      `<div class="loading-state" style="color:#f87171">
        No coordinates — <a href="index.html" style="color:var(--accent)">go back</a></div>`;
    return;
  }

  // Fill static UI
  document.getElementById('summaryName').textContent = ROUTE_TITLE;
  document.getElementById('summaryFrom').textContent = FROM;
  document.getElementById('summaryTo').textContent   = TO;
  document.getElementById('mfFrom').textContent      = FROM.split(',')[0];
  document.getElementById('mfTo').textContent        = TO.split(',')[0];
  renderAbout();
  initMap();
  startGPS();
}

boot();