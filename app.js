// ════════════════════════════════════════════════════════
//  app.js — RouteFinder page 1
//
//  Address autocomplete: Nominatim (OpenStreetMap) — free,
//  no API key needed. Suggestions come from real OSM data.
//  Custom dropdown rendered by us, nothing touches the inputs.
// ════════════════════════════════════════════════════════

const TOTAL = 5;
const SLIDE_URLS = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=60',
  'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60',
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=400&q=60',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=60',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=60',
];

// ── State ──────────────────────────────────────────────
let current = 0, isAnimating = false, darkMode = false;
const paletteCache = {};
const confirmed = { start: false, end: false };
const placeData  = { start: null,  end: null  }; // stores full Nominatim result

// ── Element refs ───────────────────────────────────────
const slides     = document.querySelectorAll('.bg-slide');
const dotsWrap   = document.getElementById('dots');
const zoneLeft   = document.getElementById('zoneLeft');
const zoneRight  = document.getElementById('zoneRight');
const startInput = document.getElementById('startInput');
const endInput   = document.getElementById('endInput');
const calcBtn    = document.getElementById('calcBtn');
const darkToggle = document.getElementById('darkToggle');
const logoIcon   = document.querySelector('.logo-icon');
const startValid = document.getElementById('startValid');
const endValid   = document.getElementById('endValid');
const validMsg   = document.getElementById('validationMsg');
const startDrop  = document.getElementById('startDropdown');
const endDrop    = document.getElementById('endDropdown');

// ════════════════════════════════════════════════════════
//  CAROUSEL
// ════════════════════════════════════════════════════════
slides[0].classList.add('active');

for (let i = 0; i < TOTAL; i++) {
  const dot = document.createElement('div');
  dot.className = 'dot' + (i === 0 ? ' active' : '');
  dot.addEventListener('click', () => goTo(i));
  dotsWrap.appendChild(dot);
}

function updateDots() {
  document.querySelectorAll('.dot').forEach((d, i) =>
    d.classList.toggle('active', i === current));
}

function goTo(index) {
  if (isAnimating || index === current) return;
  isAnimating = true;
  const prev = current;
  current = ((index % TOTAL) + TOTAL) % TOTAL;
  slides[prev].classList.add('leaving');
  slides[prev].classList.remove('active');
  slides[current].classList.add('active');
  setTimeout(() => { slides[prev].classList.remove('leaving'); isAnimating = false; }, 1300);
  updateDots();
  applyPaletteForSlide(current);
}

const nextSlide = () => goTo(current + 1);
const prevSlide = () => goTo(current - 1);
zoneRight.addEventListener('click', nextSlide);
zoneLeft.addEventListener('click',  prevSlide);

document.addEventListener('keydown', e => {
  const dropOpen = startDrop.classList.contains('open') || endDrop.classList.contains('open');
  if (!dropOpen) {
    if (e.key === 'ArrowRight') nextSlide();
    if (e.key === 'ArrowLeft')  prevSlide();
  }
});

let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) dx < 0 ? nextSlide() : prevSlide();
});

// ── Dark Mode ──────────────────────────────────────────
darkToggle.addEventListener('click', () => {
  darkMode = !darkMode;
  document.body.classList.toggle('dark-mode', darkMode);
  darkToggle.querySelector('.icon-moon').style.display = darkMode ? 'none'  : 'block';
  darkToggle.querySelector('.icon-sun').style.display  = darkMode ? 'block' : 'none';
});

// ════════════════════════════════════════════════════════
//  VALIDATION
// ════════════════════════════════════════════════════════
function updateButtonState() {
  calcBtn.disabled = !(confirmed.start && confirmed.end);
  if (confirmed.start && confirmed.end) validMsg.textContent = '';
}

function markConfirmed(field) {
  confirmed[field] = true;
  const icon  = field === 'start' ? startValid : endValid;
  const input = field === 'start' ? startInput : endInput;
  icon.classList.add('visible');
  input.classList.add('input-confirmed');
  input.classList.remove('input-error');
  updateButtonState();
}

function markUnconfirmed(field) {
  confirmed[field] = false;
  placeData[field]  = null;
  const icon  = field === 'start' ? startValid : endValid;
  const input = field === 'start' ? startInput : endInput;
  icon.classList.remove('visible');
  input.classList.remove('input-confirmed', 'input-error');
  calcBtn.disabled = true;
}

// ── Navigate to routes page ────────────────────────────
calcBtn.addEventListener('click', () => {
  if (calcBtn.disabled) return;
  const s = placeData.start;
  const e = placeData.end;
  const params = new URLSearchParams({
    from:   s.display_name,
    to:     e.display_name,
    fromLat: s.lat,
    fromLon: s.lon,
    toLat:   e.lat,
    toLon:   e.lon,
  });
  window.location.href = `routes.html?${params}`;
});

// ════════════════════════════════════════════════════════
//  NOMINATIM AUTOCOMPLETE
//
//  Nominatim is the geocoding API for OpenStreetMap.
//  Endpoint: https://nominatim.openstreetmap.org/search
//  Free, no key, just requires a unique User-Agent header
//  and respectful usage (1 req/sec max — we debounce 100ms).
// ════════════════════════════════════════════════════════

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE  = 100; // ms — stay within Nominatim's 1 req/s policy

let debounceTimers = { start: null, end: null };
let activeIdx      = { start: -1,   end: -1  };
let abortCtrls     = { start: null, end: null }; // AbortController per field

async function fetchSuggestions(field, query) {
  // Cancel any in-flight request for this field
  if (abortCtrls[field]) abortCtrls[field].abort();
  abortCtrls[field] = new AbortController();

  const url = new URL(NOMINATIM);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '5');
  url.searchParams.set('dedupe', '1');

  try {
    const res = await fetch(url, {
      signal: abortCtrls[field].signal,
      headers: { 'Accept-Language': 'en' },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') return null; // silently cancelled
    console.warn('Nominatim error:', err);
    return [];
  }
}

function setupField(field) {
  const inputEl = field === 'start' ? startInput : endInput;
  const dropEl  = field === 'start' ? startDrop  : endDrop;

  // Typing handler
  inputEl.addEventListener('input', () => {
    markUnconfirmed(field);
    const q = inputEl.value.trim();
    if (q.length < 2) { closeDropdown(field); return; }

    clearTimeout(debounceTimers[field]);
    debounceTimers[field] = setTimeout(async () => {
      showLoading(dropEl);
      const results = await fetchSuggestions(field, q);
      if (results === null) return; // aborted
      if (!results.length) { showNoResults(dropEl); return; }
      renderDropdown(field, dropEl, results);
    }, DEBOUNCE);
  });

  // Keyboard navigation
  inputEl.addEventListener('keydown', e => {
    const items = dropEl.querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx[field] = Math.min(activeIdx[field] + 1, items.length - 1);
      highlightItem(dropEl, activeIdx[field]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx[field] = Math.max(activeIdx[field] - 1, 0);
      highlightItem(dropEl, activeIdx[field]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = dropEl.querySelector('.ac-item-active');
      if (active) active.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    } else if (e.key === 'Escape') {
      closeDropdown(field);
    } else if (e.key === 'Tab') {
      closeDropdown(field);
    }
  });

  // Click outside → close
  document.addEventListener('mousedown', e => {
    if (!inputEl.contains(e.target) && !dropEl.contains(e.target)) {
      closeDropdown(field);
    }
  });
}

function renderDropdown(field, dropEl, results) {
  activeIdx[field] = -1;
  dropEl.innerHTML = '';

  results.forEach(place => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    item.setAttribute('role', 'option');

    // Split display_name: first part is the main name, rest is secondary
    const parts = place.display_name.split(', ');
    const main  = parts.slice(0, 2).join(', ');
    const sub   = parts.slice(2, 5).join(', ');

    // Icon varies by place type
    const icon = getPlaceIcon(place.type || place.class);

    item.innerHTML = `
      <span class="ac-icon">${icon}</span>
      <span class="ac-text">
        <span class="ac-main">${esc(main)}</span>
        ${sub ? `<span class="ac-sub">${esc(sub)}</span>` : ''}
      </span>`;

    // mousedown fires before blur — prevents the dropdown closing before selection
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      selectPlace(field, place);
    });

    dropEl.appendChild(item);
  });

  openDropdown(dropEl);
}

function showLoading(dropEl) {
  dropEl.innerHTML = `<div class="ac-status"><span class="ac-spinner"></span>Searching…</div>`;
  openDropdown(dropEl);
}

function showNoResults(dropEl) {
  dropEl.innerHTML = `<div class="ac-status ac-no-results">No places found</div>`;
  openDropdown(dropEl);
}

function openDropdown(dropEl) {
  dropEl.classList.add('open');
}

function closeDropdown(field) {
  const dropEl = field === 'start' ? startDrop : endDrop;
  dropEl.classList.remove('open');
  activeIdx[field] = -1;
  // Clear after transition
  setTimeout(() => { if (!dropEl.classList.contains('open')) dropEl.innerHTML = ''; }, 200);
}

function highlightItem(dropEl, index) {
  dropEl.querySelectorAll('.ac-item').forEach((el, i) =>
    el.classList.toggle('ac-item-active', i === index));
}

function selectPlace(field, place) {
  const inputEl = field === 'start' ? startInput : endInput;
  // Use a shorter version of the name for the input field
  const parts = place.display_name.split(', ');
  inputEl.value = parts.slice(0, 3).join(', ');
  placeData[field] = place;
  closeDropdown(field);
  markConfirmed(field);
  validMsg.textContent = '';
  // Auto-advance focus
  if (field === 'start' && !confirmed.end) endInput.focus();
}

function getPlaceIcon(type) {
  // Map Nominatim place types to icons
  const icons = {
    city:         pinIcon(),
    town:         pinIcon(),
    village:      pinIcon(),
    suburb:       pinIcon(),
    airport:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19 4s-2 1-3.5 2.5L8 11 .8 9.2C.3 9.1 0 9.6 0 10l6.9 4.9L5 21c0 .5.5.8.9.5L12 18l5.8 3.2c.4.2.9-.1.9-.5l-.9-1.5z"/></svg>`,
    railway:      trainIcon(),
    station:      trainIcon(),
    default:      pinIcon(),
  };
  return icons[type] || icons.default;
}

function pinIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 6-8 14-8 14S4 16 4 10a8 8 0 0 1 8-8z"/></svg>`;
}
function trainIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="M8 19l-2 3"/><path d="M18 22l-2-3"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/></svg>`;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Boot autocomplete
setupField('start');
setupField('end');

// ════════════════════════════════════════════════════════
//  COLOR EXTRACTION
// ════════════════════════════════════════════════════════
const COLOR_T = '1.4s cubic-bezier(0.4,0,0.2,1)';

function initColorTransitions() {
  logoIcon.style.transition = `background ${COLOR_T}, box-shadow ${COLOR_T}`;
  calcBtn.style.transition  = `background ${COLOR_T}, box-shadow ${COLOR_T}, transform 0.15s, opacity 0.2s`;
}

function extractPalette(url) {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const S = 80, c = document.createElement('canvas');
      c.width = c.height = S;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, S, S);
      const d = ctx.getImageData(0,0,S,S).data, bk = {};
      for (let i=0;i<d.length;i+=4) {
        if (d[i+3]<200) continue;
        const k=`${Math.round(d[i]/32)*32},${Math.round(d[i+1]/32)*32},${Math.round(d[i+2]/32)*32}`;
        if (!bk[k]) bk[k]={r:0,g:0,b:0,n:0};
        bk[k].r+=d[i]; bk[k].g+=d[i+1]; bk[k].b+=d[i+2]; bk[k].n++;
      }
      const pal = Object.values(bk)
        .map(x=>{
          const r=x.r/x.n,g=x.g/x.n,b=x.b/x.n;
          const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
          const s=mx?((mx-mn)/mx):0,l=(mx+mn)/(2*255);
          return {r,g,b,score:s*x.n*(1-Math.abs(l-0.45))};
        })
        .filter(c=>{const l=(c.r+c.g+c.b)/(3*255);return l>0.08&&l<0.92;})
        .sort((a,b)=>b.score-a.score).slice(0,5);
      resolve(pal.length?pal:[{r:124,g:92,b:252}]);
    };
    img.onerror=()=>resolve([{r:124,g:92,b:252}]); img.src=url;
  });
}

const mW=({r,g,b},t=.3)=>({r:r+(255-r)*t,g:g+(255-g)*t,b:b+(255-b)*t});
const mB=({r,g,b},t=.2)=>({r:r*(1-t),g:g*(1-t),b:b*(1-t)});
const hx=({r,g,b})=>{const h=v=>Math.round(v).toString(16).padStart(2,'0');return`#${h(r)}${h(g)}${h(b)}`;};
const rg=({r,g,b},a)=>`rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

function applyPalette(p) {
  const p1=p[0],p2=p[1]||mW(p1,.3);
  logoIcon.style.background=`linear-gradient(135deg,${hx(mW(p1,.18))} 0%,${hx(mW(p2,.12))} 100%)`;
  logoIcon.style.boxShadow=`0 6px 32px ${rg(p1,.55)}`;
  calcBtn.style.background=`linear-gradient(90deg,${hx(mB(p1,.08))} 0%,${hx(p1)} 50%,${hx(mW(p2,.1))} 100%)`;
  calcBtn.style.backgroundSize='200% 100%';
  calcBtn.style.boxShadow=`0 4px 24px ${rg(mB(p1,.15),.5)}`;
}

async function applyPaletteForSlide(i) {
  if (!paletteCache[i]) paletteCache[i]=await extractPalette(SLIDE_URLS[i]);
  applyPalette(paletteCache[i]);
}

(async()=>{
  initColorTransitions();
  const loads=SLIDE_URLS.map((u,i)=>extractPalette(u).then(p=>{paletteCache[i]=p;}));
  await loads[0]; applyPalette(paletteCache[0]);
  await Promise.all(loads.slice(1));
})();