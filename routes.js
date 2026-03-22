// ════════════════════════════════════════════════════════
//  routes.js  —  RouteFinder page 2
//
//  Stack:
//    • OSRM  (router.project-osrm.org) — free routing, no key
//    • Leaflet — interactive map rendering
//    • OpenStreetMap tiles — free map tiles
//
//  URL params expected from page 1:
//    from, to, fromLat, fromLon, toLat, toLon
// ════════════════════════════════════════════════════════

// ── Read URL params (fallback to session) ─────────────────────
const p = new URLSearchParams(window.location.search);
const savedRouteStr = sessionStorage.getItem('routeData');
const savedRoute = savedRouteStr ? JSON.parse(savedRouteStr) : {};

const pf = p.get('from');
const pt = p.get('to');
const FROM = (savedRoute.from || (pf ? pf.trim() : '') || '').trim();
const TO = (savedRoute.to || (pt ? pt.trim() : '') || '').trim();
const FROM_LAT = parseFloat(savedRoute.fromLat || p.get('fromLat') || '');
const FROM_LON = parseFloat(savedRoute.fromLon || p.get('fromLon') || '');
const TO_LAT = parseFloat(savedRoute.toLat || p.get('toLat') || '');
const TO_LON = parseFloat(savedRoute.toLon || p.get('toLon') || '');

// Validate we actually have coordinates
const hasCoords = !isNaN(FROM_LAT) && !isNaN(FROM_LON) && !isNaN(TO_LAT) && !isNaN(TO_LON);

const usingPlaceholders = !FROM || !TO || ['origin', 'destination'].includes(FROM.toLowerCase()) || ['origin', 'destination'].includes(TO.toLowerCase());

// ── OSRM endpoints — different servers per profile ──────
// router.project-osrm.org  = driving only
// routing.openstreetmap.de = car, bike, foot all supported
const OSRM_BASE = {
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1',
  cycling: 'https://routing.openstreetmap.de/routed-bike/route/v1',
  foot:    'https://routing.openstreetmap.de/routed-foot/route/v1',
};
function osrmBase(profile) {
  return OSRM_BASE[profile] || OSRM_BASE.driving;
}

// ── Route type definitions ──────────────────────────────
// Each type maps to an OSRM profile and optional waypoint strategy
const ROUTE_TYPES = {
  fastest: {
    label: 'Fastest Routes',
    profile: 'driving',
    variants: [
      {
        id: 'fast1',
        title: 'Direct Express',
        desc: 'The quickest path between your two points — prioritises motorways and dual carriageways.',
        difficulty: 'easy',
        highlights: ['Motorway priority', 'Minimal stops', 'Real-time optimised'],
        waypointOffset: null, // straight A→B
        color: '#22d3ee',
      },
      {
        id: 'fast2',
        title: 'Toll-Free Fast',
        desc: 'Nearly as quick as the express but avoids toll roads entirely.',
        difficulty: 'easy',
        highlights: ['No toll costs', 'A-roads preferred', 'Clear sightlines'],
        waypointOffset: 0.05, // slight nudge to differ
        color: '#34d399',
      },
    ],
  },
  scenic: {
    label: 'Scenic Routes',
    profile: 'driving',
    variants: [
      {
        id: 'sce1',
        title: 'Countryside Meander',
        desc: 'Weaves through rolling countryside, keeping to B-roads and local lanes.',
        difficulty: 'easy',
        highlights: ['Rolling hills', 'Village stops', 'Low traffic'],
        waypointOffset: 0.18,
        color: '#86efac',
      },
      {
        id: 'sce2',
        title: 'Elevated Ridge Run',
        desc: 'Takes the high road — favours elevated terrain for panoramic views.',
        difficulty: 'medium',
        highlights: ['Panoramic vistas', 'Ridge roads', 'Wide skies'],
        waypointOffset: -0.18,
        color: '#fde68a',
      },
      {
        id: 'sce3',
        title: 'Waterside Path',
        desc: 'Routes alongside rivers, lakes or coastline wherever possible.',
        difficulty: 'easy',
        highlights: ['Water views', 'Flat roads', 'Relaxed pace'],
        waypointOffset: 0.10,
        color: '#67e8f9',
      },
    ],
  },
  adventurous: {
    label: 'Adventurous Routes',
    profile: 'cycling',  // cycling profile picks back roads naturally
    variants: [
      {
        id: 'adv1',
        title: 'Back-Road Explorer',
        desc: 'Avoids all major roads. Discovers lanes, tracks and paths most drivers never see.',
        difficulty: 'hard',
        highlights: ['Unmapped lanes', 'Rural backroads', 'Slow & immersive'],
        waypointOffset: 0.22,
        color: '#fb923c',
      },
      {
        id: 'adv2',
        title: 'Hill Climb Challenge',
        desc: 'Seeks out elevation changes — maximum ascent and descent for a true physical challenge.',
        difficulty: 'extreme',
        highlights: ['Maximum elevation', 'Steep grades', 'Rewarding descents'],
        waypointOffset: -0.22,
        color: '#f87171',
      },
    ],
  },
  cinematic: {
    label: 'Cinematic Routes',
    profile: 'driving',
    variants: [
      {
        id: 'cin1',
        title: 'Golden Hour Drive',
        desc: 'Engineered for the magic hour — long straight roads, open skies, dramatic horizons.',
        difficulty: 'easy',
        highlights: ['Open horizons', 'Long straights', 'Sunset vantage'],
        waypointOffset: 0.15,
        color: '#fbbf24',
      },
      {
        id: 'cin2',
        title: 'Winding Gorge',
        desc: 'Snakes through valleys and gorges — every corner reveals a new composition.',
        difficulty: 'medium',
        highlights: ['Tight bends', 'Rock walls', 'Dramatic light'],
        waypointOffset: -0.15,
        color: '#c084fc',
      },
      {
        id: 'cin3',
        title: 'Forest Canopy Road',
        desc: 'Tunnels through dense forest — dappled light, misty mornings, cathedral trees.',
        difficulty: 'easy',
        highlights: ['Forest canopy', 'Dappled light', 'Wildlife'],
        waypointOffset: 0.25,
        color: '#6ee7b7',
      },
    ],
  },
  offroad: {
    label: 'Off-Road Routes',
    profile: 'foot',  // foot profile uses paths/tracks
    variants: [
      {
        id: 'off1',
        title: 'Trail Blazer',
        desc: 'Follows footpaths and bridleways. Requires a capable vehicle and low-range 4WD.',
        difficulty: 'extreme',
        highlights: ['Footpaths & tracks', '4WD required', 'Remote terrain'],
        waypointOffset: 0.20,
        color: '#a78bfa',
      },
      {
        id: 'off2',
        title: 'Forest Track',
        desc: 'Gravel forest service roads — accessible to most SUVs with decent ground clearance.',
        difficulty: 'hard',
        highlights: ['Gravel roads', 'Forest access', 'SUV-friendly'],
        waypointOffset: -0.20,
        color: '#86efac',
      },
    ],
  },
};

// ── Helpers ─────────────────────────────────────────────

// Given A→B and an offset ratio, compute a perpendicular waypoint
// offset > 0 nudges right of the A→B vector, < 0 nudges left
function calcWaypoint(lat1, lon1, lat2, lon2, offset) {
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  // Perpendicular direction (rotate 90°)
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const len  = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
  // Add perpendicular component scaled by offset
  return {
    lat: midLat + (-dLon / len) * offset,
    lon: midLon + ( dLat / len) * offset,
  };
}

// Decode OSRM polyline (they return encoded polyline by default)
// We request geojson so no decoding needed — just extract coordinates
function coordsFromGeoJSON(geometry) {
  // geometry.coordinates is [[lon,lat],[lon,lat]...]
  return geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

// Format metres → "X km" or "X m"
function fmtDist(metres) {
  return metres >= 1000
    ? (metres / 1000).toFixed(1) + ' km'
    : Math.round(metres) + ' m';
}

// Format seconds → "Xh Ym" or "X min"
function fmtTime(secs) {
  const m = Math.round(secs / 60);
  if (m >= 60) return `${Math.floor(m/60)}h ${m%60}m`;
  return `${m} min`;
}

// Build OSRM URL for a route
function osrmUrl(profile, coords) {
  // coords: [[lat,lon], [lat,lon], ...]  → OSRM wants lon,lat
  const coordStr = coords.map(([la, lo]) => `${lo},${la}`).join(';');
  // routing.openstreetmap.de uses /profile/route/v1/driving/coords
  // the "driving" at the end is always "driving" regardless of the subdomain
  return `${osrmBase(profile)}/driving/${coordStr}?overview=full&geometries=geojson&steps=true`;
}

// ── Fetch a single OSRM route ───────────────────────────
async function fetchRoute(profile, coords) {
  try {
    const res = await fetch(osrmUrl(profile, coords));
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');
    const route = data.routes[0];
    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry,
      steps:    route.legs.flatMap(leg =>
        leg.steps
          .filter(s => s.maneuver.type !== 'depart' || leg.steps.indexOf(s) !== leg.steps.length - 1)
          .map(s => s.name
            ? `${s.maneuver.modifier ? capitalize(s.maneuver.modifier) + ' onto ' : ''}${s.name}`
            : capitalize(s.maneuver.type))
          .filter(Boolean)
      ).slice(0, 8),
    };
  } catch (e) {
    console.warn('OSRM error:', e.message);
    return null;
  }
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ── Leaflet map tile URL (OpenStreetMap) ─────────────────
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Leaflet dark tile alternative (Carto dark)
const TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_DARK_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>';

// Keep track of created Leaflet maps so we can invalidate size
const leafletMaps = {};

// ── Render a single route card ───────────────────────────
function renderCard(variant, typeColor, index) {
  const card = document.createElement('div');
  card.className = 'route-card';
  card.style.animationDelay = `${index * 0.08}s`;

  const diffClass = { easy:'badge-easy', medium:'badge-medium', hard:'badge-hard', extreme:'badge-extreme' };
  const diffLabel = { easy:'Easy', medium:'Moderate', hard:'Hard', extreme:'Extreme' };

  card.innerHTML = `
    <div class="card-info">
      <span class="card-badge ${diffClass[variant.difficulty]}">${diffLabel[variant.difficulty]}</span>
      <div class="card-title">${variant.title}</div>
      <div class="card-desc">${variant.desc}</div>
      <div class="card-meta" id="meta-${variant.id}">
        <div class="meta-pill dist-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span id="dist-${variant.id}">—</span>
        </div>
      </div>
      <div class="mode-times" id="modes-${variant.id}">
        <div class="mode-pill" id="mode-car-${variant.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <span>—</span>
        </div>
        <div class="mode-pill" id="mode-bike-${variant.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 0 0 0-2H9l-3.5 9M5.5 17.5 9 9l3 3 4-6"/></svg>
          <span>—</span>
        </div>
        <div class="mode-pill" id="mode-walk-${variant.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="1.5"/><path d="M9 8l2.5 2.5L9 16"/><path d="M15 8l-2.5 2.5L15 16"/><path d="M12 11l-3 5"/><path d="M12 11l3 5"/></svg>
          <span>—</span>
        </div>
      </div>
      <div class="highlights-label">What you'll see</div>
      <ul class="highlights-list">
        ${variant.highlights.map(h => `<li>${h}</li>`).join('')}
      </ul>
      <div class="card-steps" id="steps-${variant.id}"></div>
      <button class="select-btn" type="button" data-variant-id="${variant.id}">
        Select Route
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="card-map" id="mapwrap-${variant.id}">
      <div id="map-${variant.id}" class="leaflet-map"></div>
      <div class="map-loading-overlay" id="mlo-${variant.id}">
        <div class="map-spinner"></div>
        <span>Loading map…</span>
      </div>
    </div>`;

  return card;
}

// ── Init a Leaflet map and draw the route ────────────────
async function initMap(variant, profile) {
  const mapEl  = document.getElementById(`map-${variant.id}`);
  const loEl   = document.getElementById(`mlo-${variant.id}`);
  const timeEl = document.getElementById(`time-${variant.id}`);
  const distEl = document.getElementById(`dist-${variant.id}`);
  const stepsEl= document.getElementById(`steps-${variant.id}`);

  if (!mapEl) return;

  // Build coordinate list for OSRM
  const coords = [[FROM_LAT, FROM_LON]];
  if (variant.waypointOffset) {
    const wp = calcWaypoint(FROM_LAT, FROM_LON, TO_LAT, TO_LON, variant.waypointOffset);
    coords.push([wp.lat, wp.lon]);
  }
  coords.push([TO_LAT, TO_LON]);

  // Fix: kill Leaflet default marker icon (causes giant arrow when PNG missing)
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl:       'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    shadowUrl:     'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
    iconRetinaUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
  });

  // Create Leaflet map
  const map = L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,   // prevent page-scroll hijack
    dragging: true,           // always allow drag
    touchZoom: true,
  });
  leafletMaps[variant.id] = map;

  // Dark Carto tiles
  L.tileLayer(TILE_DARK, {
    attribution: TILE_DARK_ATTR,
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  // Custom markers
  const pinSvg = (color, label) => L.divIcon({
    className: '',
    html: `<div style="
      width:32px;height:32px;border-radius:50% 50% 50% 0;
      background:${color};border:2.5px solid #fff;
      transform:rotate(-45deg);
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
    "><span style="transform:rotate(45deg);color:#fff;font-size:11px;font-weight:700">${label}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });

  // Fetch route from OSRM
  const route = await fetchRoute(profile, coords);

  // Hide loading overlay
  if (loEl) loEl.classList.add('hidden');

  if (!route) {
    // Show error state
    mapEl.parentElement.innerHTML = `
      <div class="map-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>
        <p>Route unavailable</p>
        <small>OSRM could not find a route for this profile</small>
      </div>`;
    if (timeEl) timeEl.textContent = '—';
    if (distEl) distEl.textContent = '—';
    return;
  }

  // Update distance (shared across modes)
  if (distEl) distEl.textContent = fmtDist(route.distance);

  // Populate primary mode time
  const modeMap = { driving: 'car', cycling: 'bike', foot: 'walk' };
  const primaryMode = modeMap[profile] || 'car';
  const primaryEl = document.getElementById(`mode-${primaryMode}-${variant.id}`);
  if (primaryEl) {
    primaryEl.querySelector('span').textContent = fmtTime(route.duration);
    primaryEl.classList.add('mode-primary');
  }

  // Fetch other two modes in parallel (use straight A→B, no waypoint — just for ETA)
  const otherModes = [
    { mode: 'driving', key: 'car' },
    { mode: 'cycling', key: 'bike' },
    { mode: 'foot',    key: 'walk' },
  ].filter(m => m.mode !== profile);

  const baseCoords = [[FROM_LAT, FROM_LON], [TO_LAT, TO_LON]];
  otherModes.forEach(async ({ mode, key }) => {
    const r = await fetchRoute(mode, baseCoords);
    const el = document.getElementById(`mode-${key}-${variant.id}`);
    if (el) el.querySelector('span').textContent = r ? fmtTime(r.duration) : '—';
  });

  // Draw polyline
  const latLngs = coordsFromGeoJSON(route.geometry);
  const polyline = L.polyline(latLngs, {
    color:   variant.color,
    weight:  5,
    opacity: 0.85,
    lineJoin: 'round',
    lineCap:  'round',
  }).addTo(map);

  // Markers
  const fromName = FROM.split(',')[0];
  const toName   = TO.split(',')[0];
  L.marker([FROM_LAT, FROM_LON], { icon: pinSvg(variant.color, 'A') })
    .bindTooltip(fromName, { permanent: false, className: 'map-tooltip' })
    .addTo(map);
  L.marker([TO_LAT, TO_LON], { icon: pinSvg('#ffffff', 'B') })
    .bindTooltip(toName, { permanent: false, className: 'map-tooltip' })
    .addTo(map);

  // Fit map to route
  map.fitBounds(polyline.getBounds(), { padding: [24, 24] });
  // Force Leaflet to recalculate container size after DOM paint — fixes drag misalignment
  requestAnimationFrame(() => {
    map.invalidateSize({ animate: false });
    map.fitBounds(polyline.getBounds(), { padding: [24, 24] });
  });

  // Turn-by-turn steps
  if (route.steps.length && stepsEl) {
    stepsEl.innerHTML = route.steps.map((s, i) => `
      <div class="step-item">
        <span class="step-num">${i + 1}</span>
        <span>${s}</span>
      </div>`).join('');
    stepsEl.classList.add('visible');
  }
}

// ── Render all cards for a route type ────────────────────
async function renderType(typeKey) {
  // Map backend vibe names to ROUTE_TYPES keys
  const vibeToRouteTypeMap = {
    'fast': 'fastest',
    'fastest': 'fastest',
    'scenic': 'scenic',
    'fun': 'adventurous',
    'adventurous': 'adventurous',
    'cinematic': 'cinematic',
    'calm': 'cinematic',
    'quiet': 'scenic',
    'offroad': 'offroad'
  };
  
  const routeTypeKey = vibeToRouteTypeMap[typeKey] || typeKey;
  const def  = ROUTE_TYPES[routeTypeKey];
  const list = document.getElementById('routesList');

  // Fade out current
  list.style.transition = 'opacity 0.2s, transform 0.2s';
  list.style.opacity    = '0';
  list.style.transform  = 'translateY(8px)';

  // Destroy existing Leaflet maps to avoid memory leaks
  Object.values(leafletMaps).forEach(m => m.remove());
  Object.keys(leafletMaps).forEach(k => delete leafletMaps[k]);

  await new Promise(r => setTimeout(r, 220));

  list.innerHTML = '';
  list.style.opacity   = '1';
  list.style.transform = 'translateY(0)';

  if (!hasCoords) {
    list.innerHTML = `
      <div class="map-error" style="padding:60px 0;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/></svg>
        <p style="font-size:1rem;color:#aaa;">No coordinates received</p>
        <small><a href="index.html" style="color:#7c5cfc">← Go back and select locations</a></small>
      </div>`;
    return;
  }

  // Determine OSRM profile based on transport mode
  const transportProfile = {
    'car': 'driving',
    'walking': 'foot',
    'bicycling': 'cycling'
  }[currentTransport] || 'driving';

  // Use transport profile for adventurous routes that specify cycling
  const profile = (typeKey === 'adventurous') ? 'cycling' : transportProfile;

  // Render all variant cards
  def.variants.forEach((variant, i) => {
    const card = renderCard(variant, variant.color, i);
    list.appendChild(card);

    // Wire Select Route button → navigate to directions page
    card.querySelector('.select-btn').addEventListener('click', () => {
      const currentType = document.querySelector('.type-tab.active')?.dataset.type || 'fastest';
      const backParams  = new URLSearchParams(window.location.search).toString();
      const dp = new URLSearchParams({
        from:           FROM,
        to:             TO,
        fromLat:        FROM_LAT,
        fromLon:        FROM_LON,
        toLat:          TO_LAT,
        toLon:          TO_LON,
        routeId:        variant.id,
        routeTitle:     variant.title,
        routeDesc:      variant.desc,
        routeDiff:      variant.difficulty,
        routeColor:     variant.color,
        routeProfile:   profile,
        waypointOffset: variant.waypointOffset || 0,
        routeHighlights: encodeURIComponent(JSON.stringify(variant.highlights)),
        backParams:     backParams,
      });
      window.location.href = `directions.html?${dp}`;
    });
  });

  // Then asynchronously fetch + draw each map
  def.variants.forEach(variant => {
    initMap(variant, profile);
  });
}

// ── Breadcrumb ───────────────────────────────────────────
function renderCrumb() {
  const crumb = document.getElementById('routeCrumb');
  const fromShort = FROM.split(',')[0];
  const toShort   = TO.split(',')[0];
  crumb.innerHTML = `
    <svg class="crumb-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 6-8 14-8 14S4 16 4 10a8 8 0 0 1 8-8z"/></svg>
    <span class="crumb-loc" title="${FROM}">${fromShort}</span>
    <svg class="crumb-arrow" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    <svg class="crumb-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 6-8 14-8 14S4 16 4 10a8 8 0 0 1 8-8z"/></svg>
    <span class="crumb-loc" title="${TO}">${toShort}</span>`;
}

// ── Tab switching ────────────────────────────────────────
// ── Tab handlers ───────────────────────────────────────
let currentVibe = 'scenic';
let currentTransport = 'car';

// Map frontend vibe names to backend vibe classifications
function mapVibeToBackend(frontendVibe) {
  const vibeMap = {
    'fastest': 'fast',
    'fast1': 'fast',
    'fast2': 'fast',
    'scenic': 'scenic',
    'sce1': 'scenic',
    'sce2': 'scenic',
    'sce3': 'scenic',
    'adventurous': 'fun',
    'adv1': 'fun',
    'adv2': 'fun',
    'cinematic': 'fun',
    'cin1': 'fun',
    'cin2': 'fun',
    'cin3': 'fun',
    'offroad': 'fun',
    'off1': 'fun',
    'off2': 'fun',
    'calm': 'calm',
    'quiet': 'quiet',
    'fun': 'fun',
    'fast': 'fast'
  };
  return vibeMap[frontendVibe] || 'scenic';
}

document.getElementById('vibeTabs').addEventListener('click', e => {
  const btn = e.target.closest('.type-tab');
  if (!btn) return;
  document.querySelectorAll('#vibeTabs .type-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentVibe = btn.dataset.vibe;
  loadRoutes();
});

document.getElementById('transportTabs').addEventListener('click', e => {
  const btn = e.target.closest('.transport-tab');
  if (!btn) return;
  document.querySelectorAll('#transportTabs .transport-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentTransport = btn.dataset.transport;
  loadRoutes();
});

// ── Load routes from backend ────────────────────────────
async function loadRoutes() {
  const container = document.getElementById('routesList');
  if (usingPlaceholders) {
    container.innerHTML = `<div class="error">Please go back to the search page and enter real start/end addresses (not Origin/Destination defaults).</div>`;
    return;
  }

  container.innerHTML = '<div class="loading">Loading routes...</div>';

  try {
    // Try to fetch AI-generated routes from backend
    const backendVibe = mapVibeToBackend(currentVibe);
    console.log(`Loading routes for vibe: ${currentVibe} (backend: ${backendVibe})`);
    
    const params = new URLSearchParams({
      start: FROM,
      end: TO,
      vibe: backendVibe,
      transport: currentTransport
    });
    
    const res = await fetch(`http://localhost:5000/api/routes?${params}`);
    if (res.ok) {
      const data = await res.json();
      console.log('AI routes response:', data);
      if (data.success && data.routes && data.routes.length > 0) {
        console.log(`Rendering ${data.routes.length} AI routes for vibe: ${backendVibe}`);
        renderRoutes(data.routes);
        return;
      }
    } else {
      console.log(`Backend returned: ${res.status} ${res.statusText}`);
    }
  } catch (e) {
    console.warn("AI routes fetch failed:", e);
  }
  
  // Fallback to OSRM vibe-based routes
  console.log(`Falling back to OSRM routes for vibe: ${currentVibe}`);
  try {
    await renderType(currentVibe);
  } catch (error) {
    container.innerHTML = `<div class="error">Failed to load routes: ${error.message}</div>`;
  }
}

// ── Render routes ───────────────────────────────────────
function renderRoutes(routes) {
  const container = document.getElementById('routesList');
  container.innerHTML = '';

  routes.forEach((route, index) => {
    const card = renderRouteCard(route, index);
    container.appendChild(card);
  });
}

// ── Render a single route card ──────────────────────────
function renderRouteCard(route, index) {
  const card = document.createElement('div');
  card.className = 'route-card';
  card.style.animationDelay = `${index * 0.08}s`;

  const stopsHtml = route.stops ? route.stops.map(stop => 
    `<div class="stop-item">
      <strong>${stop.name}</strong>: ${stop.description}
    </div>`
  ).join('') : '';

  card.innerHTML = `
    <div class="card-info">
      <div class="card-title">${route.name}</div>
      <div class="card-desc">${route.description}</div>
      <div class="card-meta">
        <div class="meta-pill dist-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span>${route.distance || '—'}</span>
        </div>
        <div class="meta-pill time-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${route.duration || '—'}</span>
        </div>
      </div>
      <div class="vibe-explanation">${route.vibe_explanation}</div>
      <div class="stops-section">
        <div class="stops-label">Attractions & Stops</div>
        <div class="stops-list">${stopsHtml}</div>
      </div>
      <div class="card-actions">
        <button class="action-btn select-btn" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          Start Route
        </button>
        <button class="action-btn open-btn" onclick="openGoogleMaps('${route.google_maps_url || '#'}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open Maps
        </button>
        <button class="action-btn copy-btn" onclick="copyGoogleMapsLink('${route.google_maps_url || '#'}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          Copy Link
        </button>
      </div>
    </div>`;

  // Add click handler for Select Route button
  const selectBtn = card.querySelector('.select-btn');
  if (selectBtn) {
    selectBtn.addEventListener('click', () => {
      const dp = new URLSearchParams({
        from: FROM,
        to: TO,
        fromLat: FROM_LAT,
        fromLon: FROM_LON,
        toLat: TO_LAT,
        toLon: TO_LON,
        routeTitle: route.name || 'Route',
        routeDesc: route.description || '',
        routeColor: '#7c5cfc',
        routeStops: JSON.stringify(route.stops || []),
        vibeExplanation: route.vibe_explanation || '',
      });
      window.location.href = `directions.html?${dp}`;
    });
  }

  return card;
}

// ── Open Google Maps ────────────────────────────────────
function openGoogleMaps(url) {
  window.open(url, '_blank');
}

// ── Copy Google Maps Link ───────────────────────────────
function copyGoogleMapsLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    const btn = event.target.closest('.copy-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied!';
    btn.style.background = 'rgba(52,211,153,0.2)';
    btn.style.borderColor = 'rgba(52,211,153,0.5)';
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.background = '';
      btn.style.borderColor = '';
    }, 2000);
  }).catch(() => {
    alert('Failed to copy link');
  });
}

// ── Boot ─────────────────────────────────────────────────
renderCrumb();
loadRoutes();