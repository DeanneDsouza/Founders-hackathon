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

// ── Read URL params ─────────────────────────────────────
const p       = new URLSearchParams(window.location.search);
const FROM     = p.get('from')    || 'Origin';
const TO       = p.get('to')      || 'Destination';
const FROM_LAT = parseFloat(p.get('fromLat'));
const FROM_LON = parseFloat(p.get('fromLon'));
const TO_LAT   = parseFloat(p.get('toLat'));
const TO_LON   = parseFloat(p.get('toLon'));

// Validate we actually have coordinates
const hasCoords = !isNaN(FROM_LAT) && !isNaN(FROM_LON) && !isNaN(TO_LAT) && !isNaN(TO_LON);

// ── OSRM endpoint ───────────────────────────────────────
const OSRM = 'https://router.project-osrm.org/route/v1';

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
  return `${OSRM}/${profile}/${coordStr}?overview=full&geometries=geojson&steps=true`;
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
        <div class="meta-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span id="time-${variant.id}">Calculating…</span>
        </div>
        <div class="meta-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span id="dist-${variant.id}">—</span>
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
    scrollWheelZoom: false,
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

  // Update meta
  if (timeEl) timeEl.textContent = fmtTime(route.duration);
  if (distEl) distEl.textContent = fmtDist(route.distance);

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
  const def  = ROUTE_TYPES[typeKey];
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
        routeProfile:   def.profile,
        waypointOffset: variant.waypointOffset || 0,
        routeHighlights: encodeURIComponent(JSON.stringify(variant.highlights)),
        backParams:     backParams,
      });
      window.location.href = `directions.html?${dp}`;
    });
  });

  // Then asynchronously fetch + draw each map
  def.variants.forEach(variant => {
    initMap(variant, def.profile);
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
document.getElementById('typeTabs').addEventListener('click', e => {
  const btn = e.target.closest('.type-tab');
  if (!btn) return;
  document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderType(btn.dataset.type);
});

// ── Boot ─────────────────────────────────────────────────
renderCrumb();
renderType('fastest');