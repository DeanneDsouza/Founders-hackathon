
// ── Read URL params ──
const params = new URLSearchParams(window.location.search);
const FROM = params.get('from') || 'Origin';
const TO   = params.get('to')   || 'Destination';

// ── Route data per type ──
const ROUTE_DATA = {
  adventurous: {
    label: 'Adventurous Routes',
    routes: [
      {
        title: 'Off-Road Adventure',
        desc: 'Challenging terrain with river crossings and rugged trails.',
        time: '3h 30m', distance: '85 miles', difficulty: 'hard',
        highlights: ['River fords', 'Rocky trails', 'Wildlife viewing'],
        img: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=75',
        mapLabel: 'Rugged back-country route',
      },
      {
        title: 'Mountain Pass Route',
        desc: 'High-altitude route with steep climbs and sweeping vistas.',
        time: '3h 15m', distance: '92 miles', difficulty: 'extreme',
        highlights: ['Summit passes', 'Switchbacks', 'Alpine lakes'],
        img: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=75',
        mapLabel: 'Alpine pass crossing',
      },
      {
        title: 'Desert Canyon Run',
        desc: 'Winding roads through dramatic canyon walls and sandstone formations.',
        time: '2h 50m', distance: '74 miles', difficulty: 'medium',
        highlights: ['Canyon overlooks', 'Sandstone arches', 'Dry creek beds'],
        img: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=800&q=75',
        mapLabel: 'Canyon loop trail',
      },
    ],
  },
  cinematic: {
    label: 'Cinematic Routes',
    routes: [
      {
        title: 'Coastal Highway Drive',
        desc: 'Dramatic ocean cliffs and crashing waves the entire way.',
        time: '4h 10m', distance: '118 miles', difficulty: 'easy',
        highlights: ['Sea cliff viewpoints', 'Lighthouse stops', 'Tide pool access'],
        img: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=75',
        mapLabel: 'Coastal scenic corridor',
      },
      {
        title: 'Golden Valley Sweep',
        desc: 'Rolling hills, wildflowers, and golden-hour light all the way.',
        time: '3h 00m', distance: '88 miles', difficulty: 'easy',
        highlights: ['Vineyard rows', 'Rolling meadows', 'Sunset ridge'],
        img: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=800&q=75',
        mapLabel: 'Valley panorama route',
      },
      {
        title: 'Forest Fog Route',
        desc: 'Misty redwood corridors and cathedral-like old-growth canopy.',
        time: '3h 45m', distance: '96 miles', difficulty: 'medium',
        highlights: ['Ancient redwoods', 'Fern glades', 'Morning fog banks'],
        img: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&q=75',
        mapLabel: 'Old-growth forest corridor',
      },
    ],
  },
  fastest: {
    label: 'Fastest Routes',
    routes: [
      {
        title: 'Interstate Express',
        desc: 'Direct freeway route with minimal stops — maximum speed.',
        time: '1h 45m', distance: '62 miles', difficulty: 'easy',
        highlights: ['No toll roads', 'Clear sightlines', 'Rest stops every 20mi'],
        img: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=75',
        mapLabel: 'Direct freeway corridor',
      },
      {
        title: 'Bypass Loop',
        desc: 'Avoids city traffic via an outer ring road — saves up to 25 min.',
        time: '2h 05m', distance: '71 miles', difficulty: 'easy',
        highlights: ['Traffic-free bypass', 'Fewer signals', 'Smooth surface'],
        img: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=75',
        mapLabel: 'Outer ring bypass',
      },
    ],
  },
  scenic: {
    label: 'Scenic Routes',
    routes: [
      {
        title: 'Lakeside Meander',
        desc: 'Hugs the shoreline of three lakes with constant water views.',
        time: '3h 55m', distance: '102 miles', difficulty: 'easy',
        highlights: ['Lake overlooks', 'Boat launch access', 'Picnic areas'],
        img: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&q=75',
        mapLabel: 'Three-lake shoreline drive',
      },
      {
        title: 'Wildflower Highway',
        desc: 'Seasonal bloom corridor through protected grasslands.',
        time: '3h 20m', distance: '91 miles', difficulty: 'easy',
        highlights: ['Spring blooms', 'Butterfly reserves', 'Hawk migration'],
        img: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=800&q=75',
        mapLabel: 'Wildflower corridor',
      },
      {
        title: 'Ridgeline Panorama',
        desc: 'Follows a mountain ridgeline with 180-degree valley views.',
        time: '4h 30m', distance: '110 miles', difficulty: 'medium',
        highlights: ['Ridge viewpoints', 'Hang-glider launch', 'Valley farmland'],
        img: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=75',
        mapLabel: 'Ridgeline panorama road',
      },
    ],
  },
  offroad: {
    label: 'Off-Road Routes',
    routes: [
      {
        title: '4WD Rock Crawl',
        desc: 'Technical rock sections requiring low-range four-wheel drive.',
        time: '5h 00m', distance: '48 miles', difficulty: 'extreme',
        highlights: ['Boulder fields', 'Ledge drops', 'Creek crossings'],
        img: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=75',
        mapLabel: '4WD technical trail',
      },
      {
        title: 'Gravel Backroads',
        desc: 'Loose gravel fire roads through national forest land.',
        time: '3h 40m', distance: '78 miles', difficulty: 'medium',
        highlights: ['Forest access roads', 'Campsite pull-offs', 'Elk meadows'],
        img: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&q=75',
        mapLabel: 'National forest gravel roads',
      },
      {
        title: 'Dune & Sand Run',
        desc: 'Coastal sand dunes with tidal flats and beach driving sections.',
        time: '2h 30m', distance: '55 miles', difficulty: 'hard',
        highlights: ['Dune crests', 'Beach driving', 'Tidal flats'],
        img: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=800&q=75',
        mapLabel: 'Coastal dune corridor',
      },
    ],
  },
};

// Hero images per route type
const HERO_IMAGES = {
  adventurous: [
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=75',
    'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=900&q=75',
  ],
  cinematic: [
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=900&q=75',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=900&q=75',
  ],
  fastest: [
    'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=900&q=75',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=75',
  ],
  scenic: [
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=900&q=75',
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=900&q=75',
  ],
  offroad: [
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=75',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=75',
  ],
};

// ── SVG icons ──
const icons = {
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  distance: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 6-8 14-8 14S4 16 4 10a8 8 0 0 1 8-8z"/></svg>`,
  smallArrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
};

const diffLabel = { easy: 'Easy', medium: 'Moderate', hard: 'Hard', extreme: 'Extreme' };

// ── Render ──
function renderCrumb() {
  document.getElementById('routeCrumb').innerHTML = `
    <span class="pin-icon">${icons.pin}</span>
    <span class="loc">${FROM}</span>
    <span class="arrow-icon">${icons.arrow}</span>
    <span class="pin-icon">${icons.pin}</span>
    <span class="loc">${TO}</span>
  `;
}

function renderHero(type) {
  const imgs = HERO_IMAGES[type] || HERO_IMAGES.adventurous;
  document.getElementById('heroImages').innerHTML = imgs.map(src =>
    `<div class="hero-img" style="background-image:url('${src}')"></div>`
  ).join('');
  document.getElementById('heroSub').textContent = `${FROM} → ${TO}`;
}

function renderRoutes(type) {
  const data = ROUTE_DATA[type] || ROUTE_DATA.adventurous;
  document.getElementById('sectionTitle').textContent = data.label;

  const list = document.getElementById('routesList');

  // Fade-out old cards
  list.style.opacity = '0';
  list.style.transform = 'translateY(10px)';
  list.style.transition = 'opacity 0.25s, transform 0.25s';

  setTimeout(() => {
    list.innerHTML = data.routes.map((r, i) => `
      <div class="route-card" style="animation-delay:${i * 0.09}s">
        <div class="card-info">
          <span class="badge ${r.difficulty}">${diffLabel[r.difficulty]}</span>
          <div class="card-title">${r.title}</div>
          <div class="card-desc">${r.desc}</div>
          <div class="card-meta">
            <div class="meta-item">${icons.clock} ${r.time}</div>
            <div class="meta-item">${icons.distance} ${r.distance}</div>
          </div>
          <div class="highlights-title">Highlights</div>
          <ul class="highlights-list">
            ${r.highlights.map(h => `<li>${h}</li>`).join('')}
          </ul>
          <button class="select-route-btn">
            Select This Route ${icons.smallArrow}
          </button>
        </div>
        <div class="card-map">
          <img class="card-map-img" src="${r.img}" alt="${r.title}" loading="lazy"/>
          <div class="card-map-label">${r.mapLabel} — ${FROM} to ${TO}</div>
        </div>
      </div>
    `).join('');

    list.style.opacity = '1';
    list.style.transform = 'translateY(0)';
  }, 250);
}

// ── Init ──
renderCrumb();

const typeSelect = document.getElementById('routeType');

function init(type) {
  renderHero(type);
  renderRoutes(type);
}

typeSelect.addEventListener('change', () => {
  init(typeSelect.value);
});

init(typeSelect.value);