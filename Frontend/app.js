// ── Constants ──
const TOTAL = 5;

const SLIDE_URLS = [
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=60',
  'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60',
  'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=400&q=60',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=60',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=60',
];

// ── State ──
let current = 0;
let isAnimating = false;
let darkMode = false;
const paletteCache = {};

// ── Element refs ──
const slides     = document.querySelectorAll('.bg-slide');
const dotsWrap   = document.getElementById('dots');
const zoneLeft   = document.getElementById('zoneLeft');
const zoneRight  = document.getElementById('zoneRight');
const startInput = document.getElementById('startInput');
const endInput   = document.getElementById('endInput');
const calcBtn    = document.getElementById('calcBtn');
const darkToggle = document.getElementById('darkToggle');
const logoIcon   = document.querySelector('.logo-icon');

// ── Init: show first slide ──
slides[0].classList.add('active');

// ── Build dot indicators ──
for (let i = 0; i < TOTAL; i++) {
  const dot = document.createElement('div');
  dot.className = 'dot' + (i === 0 ? ' active' : '');
  dot.addEventListener('click', () => goTo(i));
  dotsWrap.appendChild(dot);
}

function updateDots() {
  document.querySelectorAll('.dot').forEach((d, i) => {
    d.classList.toggle('active', i === current);
  });
}

// ── Crossfade transition ──
function goTo(index) {
  if (isAnimating || index === current) return;
  isAnimating = true;

  const prev = current;
  current = ((index % TOTAL) + TOTAL) % TOTAL;

  // Outgoing slide: add 'leaving', remove 'active'
  slides[prev].classList.add('leaving');
  slides[prev].classList.remove('active');

  // Incoming slide: add 'active'
  slides[current].classList.add('active');

  // Clean up 'leaving' after transition completes
  setTimeout(() => {
    slides[prev].classList.remove('leaving');
    isAnimating = false;
  }, 1300); // matches CSS transition duration

  updateDots();
  applyPaletteForSlide(current);
}

function next() { goTo(current + 1); }
function prev() { goTo(current - 1); }

zoneRight.addEventListener('click', next);
zoneLeft.addEventListener('click',  prev);

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') next();
  if (e.key === 'ArrowLeft')  prev();
});

let touchStartX = 0;
document.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) dx < 0 ? next() : prev();
});

// ── Calculate Routes ──
const calcIconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

calcBtn.addEventListener('click', () => {
  const s = startInput.value.trim();
  const e = endInput.value.trim();
  if (!s) startInput.style.boxShadow = '0 0 0 3px rgba(255,80,80,0.55)';
  if (!e) endInput.style.boxShadow   = '0 0 0 3px rgba(255,80,80,0.55)';
  if (!s || !e) {
    setTimeout(() => {
      startInput.style.boxShadow = '';
      endInput.style.boxShadow   = '';
    }, 1200);
    return;
  }
  calcBtn.innerHTML = '🗺 Finding routes…';
  calcBtn.style.opacity = '0.75';
  calcBtn.disabled = true;
  setTimeout(() => {
    calcBtn.innerHTML = calcIconSVG + ' Calculate Routes';
    calcBtn.style.opacity = '1';
    calcBtn.disabled = false;
  }, 2000);
});

// ── Dark Mode ──
darkToggle.addEventListener('click', () => {
  darkMode = !darkMode;
  document.body.classList.toggle('dark-mode', darkMode);
  darkToggle.querySelector('.icon-moon').style.display = darkMode ? 'none'  : 'block';
  darkToggle.querySelector('.icon-sun').style.display  = darkMode ? 'block' : 'none';
});

// ════════════════════════════════════════════════
// ── Color Extraction & Smooth Dynamic Theming ──
// ════════════════════════════════════════════════

// How long color transitions take — slightly longer than the slide fade
const COLOR_TRANSITION = '1.4s cubic-bezier(0.4, 0, 0.2, 1)';

// Set transition durations on themed elements once at boot
function initColorTransitions() {
  logoIcon.style.transition = `background ${COLOR_TRANSITION}, box-shadow ${COLOR_TRANSITION}`;
  calcBtn.style.transition  = `background ${COLOR_TRANSITION}, box-shadow ${COLOR_TRANSITION}, transform 0.15s, opacity 0.2s`;
}

function extractPalette(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const SIZE = 80;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

      const buckets = {};
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        if (a < 200) continue;
        const key = `${Math.round(r/32)*32},${Math.round(g/32)*32},${Math.round(b/32)*32}`;
        if (!buckets[key]) buckets[key] = { r:0, g:0, b:0, count:0 };
        buckets[key].r += r; buckets[key].g += g; buckets[key].b += b; buckets[key].count++;
      }

      const palette = Object.values(buckets)
        .map(bk => {
          const r = bk.r/bk.count, g = bk.g/bk.count, b = bk.b/bk.count;
          const max = Math.max(r,g,b), min = Math.min(r,g,b);
          const saturation = max === 0 ? 0 : (max - min) / max;
          const lightness  = (max + min) / (2 * 255);
          const score = saturation * bk.count * (1 - Math.abs(lightness - 0.45));
          return { r, g, b, score };
        })
        .filter(c => {
          const l = (c.r + c.g + c.b) / (3 * 255);
          return l > 0.08 && l < 0.92;
        })
        .sort((a, bb) => bb.score - a.score)
        .slice(0, 5);

      resolve(palette.length ? palette : [{ r:124, g:92, b:252, score:1 }]);
    };
    img.onerror = () => resolve([{ r:124, g:92, b:252, score:1 }]);
    img.src = url;
  });
}

function mixWhite({ r, g, b }, t = 0.30) {
  return { r: r+(255-r)*t, g: g+(255-g)*t, b: b+(255-b)*t };
}
function mixBlack({ r, g, b }, t = 0.20) {
  return { r: r*(1-t), g: g*(1-t), b: b*(1-t) };
}
function hex({ r, g, b }) {
  const h = v => Math.round(v).toString(16).padStart(2,'0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function rgba({ r, g, b }, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function applyPalette(palette) {
  const p1 = palette[0];
  const p2 = palette[1] || mixWhite(p1, 0.30);

  const l1 = mixWhite(p1, 0.18);
  const l2 = mixWhite(p2, 0.12);

  logoIcon.style.background = `linear-gradient(135deg, ${hex(l1)} 0%, ${hex(l2)} 100%)`;
  logoIcon.style.boxShadow  = `0 6px 32px ${rgba(p1, 0.55)}`;

  const btnFrom = mixBlack(p1, 0.08);
  const btnTo   = mixWhite(p2, 0.10);
  calcBtn.style.background     = `linear-gradient(90deg, ${hex(btnFrom)} 0%, ${hex(p1)} 50%, ${hex(btnTo)} 100%)`;
  calcBtn.style.backgroundSize = '200% 100%';
  calcBtn.style.boxShadow      = `0 4px 24px ${rgba(mixBlack(p1, 0.15), 0.50)}`;
}

async function applyPaletteForSlide(index) {
  if (!paletteCache[index]) {
    paletteCache[index] = await extractPalette(SLIDE_URLS[index]);
  }
  applyPalette(paletteCache[index]);
}

// ── Boot ──
(async () => {
  initColorTransitions();
  const loads = SLIDE_URLS.map((url, i) =>
    extractPalette(url).then(p => { paletteCache[i] = p; })
  );
  await loads[0];
  applyPalette(paletteCache[0]);
  await Promise.all(loads.slice(1));
})();