// The cut-paper opening, now the alternative: it plays with ?scene=simple, and wherever WebGL 2 is
// missing; the default is the same flight in 3D (intro-real.js), loaded below.
//
// A short flight up the Abisko valley, the first day of the next expedition. The terrain
// is real (the elevation model the relief objects use), drawn as layers of cut paper, near to far:
// spruce forest, the lake, open fell, snow on the tops. Vector shapes on a 2D canvas at the screen's
// own resolution, so it is sharp everywhere and light on any machine. At the end the colour drains
// out of the layers until only their edges remain, a contour drawing on paper, and the title card
// condenses out of it. Scroll is never hijacked: the camera only follows it, damped.
(() => {

const section = document.getElementById('intro');
const stage = section.querySelector('.intro-stage');
const canvas = section.querySelector('canvas');
const root = document.documentElement;

const params = new URLSearchParams(location.search);
const DEBUG_P = params.has('p') ? parseFloat(params.get('p')) : null;   // ?p=0.4 freezes the camera
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

// ?scene=ascent: the earlier, raymarched version, kept for comparison
if (params.get('scene') === 'ascent') {
  section.style.height = '820vh';
  const s = document.createElement('script');
  s.src = (document.body.dataset.root || '') + 'site/assets/js/intro-ascent.js';
  document.head.append(s);
  return;
}
// The opening: the same flight rendered in 3D with light, shadow and air (intro-real.js). With reduced
// motion there is only the title card (below); without WebGL 2, or with ?scene=simple, this file plays.
// (it renders into a half-float buffer: a GPU that cannot gets this version, not a black screen)
const webgl2 = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ok = !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch (e) { return false; }
})();
if (!reduced && webgl2 && params.get('scene') !== 'simple') {
  section.classList.add('intro--real');
  const s = document.createElement('script');
  s.type = 'module';
  s.src = (document.body.dataset.root || '') + 'site/assets/js/intro-real.js?v=' + (document.currentScript?.dataset.realVersion || '');
  document.head.append(s);
  return;
}
section.classList.add('intro--simple');

// A scene that belongs to the page: scrolling down plays it, scrolling back up plays it backwards, as
// often as anyone likes. The first visit in a tab (and every reload) starts at the top of it; coming
// back to Home later in the visit starts on the title card at its end, with the flight above.
const navType = performance.getEntriesByType('navigation')[0]?.type;
const seen = (() => { try { return sessionStorage.getItem('hc-intro') === 'seen'; } catch (e) { return false; } })();
function markDone() {                    // reduced motion: the title card only, no flight
  section.classList.add('is-done');
  root.classList.add('intro-complete');
  stage.style.setProperty('--p', '1');
}
if (reduced && DEBUG_P == null) { markDone(); return; }
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const endY = () => section.offsetTop + (section.offsetHeight - innerHeight) * 0.96;
const startY = (() => {
  if (DEBUG_P != null || params.has('intro') || navType === 'reload' || !seen) return 0;
  if (location.hash && location.hash !== '#top') return null;          // the browser goes to the anchor
  if (navType === 'back_forward') { const y = +sessionStorage.getItem('hc-home-y'); if (y > 0) return y; }
  return 'end';
})();
if (startY !== null) scrollTo({ top: startY === 'end' ? endY() : startY, behavior: 'instant' });
addEventListener('pagehide', () => { try { sessionStorage.setItem('hc-home-y', String(Math.round(scrollY))); } catch (e) { /* private mode */ } });

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a)));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ---------------------------------------------------------------- the land
// Metres: x east from the map's west edge, z south from its north edge, y up (above sea level).
const HMIN = +canvas.dataset.min, HMAX = +canvas.dataset.max;
const [WKM, HKM] = canvas.dataset.km.split(',').map(Number);
const WM = WKM * 1000, HM = HKM * 1000;
const WATER = HMIN + 3;                  // Torneträsk and Abiskojaure
let T = null;                            // { w, h, data } once loaded

// small value noise, for the land beyond the map and for detail finer than its 43 m cells
const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return mix(mix(hash2(i, j), hash2(i + 1, j), u), mix(hash2(i, j + 1), hash2(i + 1, j + 1), u), v);
}
const ridges = (x, z) => 620 + 760 * (noise(x / 3100, z / 3100) * 0.65 + noise(x / 1300 + 7, z / 1300 + 3) * 0.35);

function heightAt(x, z) {
  if (!T) return 400;
  const { w, h, data } = T;
  let gx = x / WM * (w - 1), gz = z / HM * (h - 1);
  const out = Math.max(-gx, gx - (w - 1), -gz, gz - (h - 1), 0) * (WM / (w - 1));   // metres beyond the map
  gx = clamp(gx, 1, w - 3); gz = clamp(gz, 1, h - 3);
  // Catmull-Rom, so the 43 m cells never show as kinks in a near profile
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (jj) => { const k = jj * w + i; return cr(data[k - 1], data[k], data[k + 1], data[k + 2], fx); };
  let hh = HMIN + cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz) * (HMAX - HMIN);
  if (out > 0) hh = mix(hh, ridges(x, z), sstep(0, 2200, out));
  return hh;
}
// what the camera sees near by: the model, and a little ground it cannot hold
const ground = (x, z) => { const h = heightAt(x, z); return h <= WATER ? WATER : h + 2.5 * (noise(x / 38, z / 38) - 0.5) + 6 * (noise(x / 240 + 3, z / 240) - 0.5); };
const treeline = (x, z) => 610 + 60 * (noise(x / 700, z / 700) - 0.5);
const snowline = (x, z) => 960 + 140 * (noise(x / 900 + 5, z / 900) - 0.5);
// how much of the ground here carries forest: none on the water or above the treeline, glades between
const forest = (x, z, h) => h <= WATER + 1 ? 0 : sstep(treeline(x, z) + 20, treeline(x, z) - 60, h) * sstep(0.2, 0.42, noise(x / 160, z / 160 + 9));

// ---------------------------------------------------------------- the flight
// From the birch and spruce by the lake at Abisko, south-west up the valley towards Abiskojaure,
// then up, until the whole valley and its mountains are in view. Map pixels of a 768 px map.
const mp = (px, py) => [px / 768 * WM, py / 768 * HM];
const PATH = [mp(520, 300), mp(478, 342), mp(430, 392), mp(372, 428), mp(318, 462), mp(262, 500)];
const LEGS = PATH.slice(1).map((q, k) => Math.hypot(q[0] - PATH[k][0], q[1] - PATH[k][1]));
const LEN = LEGS.reduce((a, b) => a + b, 0);
const AX = (() => { const a = PATH[0], b = PATH[PATH.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; })();
function along(s) {                       // point on the path, s in metres from its start (past its end: straight on)
  if (s > LEN) { const a = PATH[PATH.length - 2], b = PATH[PATH.length - 1], l = LEGS[LEGS.length - 1]; return [b[0] + (b[0] - a[0]) / l * (s - LEN), b[1] + (b[1] - a[1]) / l * (s - LEN)]; }
  s = Math.max(s, 0);
  for (let k = 0; k < LEGS.length; k++) {
    if (s <= LEGS[k] || k === LEGS.length - 1) { const t = LEGS[k] ? s / LEGS[k] : 0; return [mix(PATH[k][0], PATH[k + 1][0], t), mix(PATH[k][1], PATH[k + 1][1], t)]; }
    s -= LEGS[k];
  }
}
function distToPath(x, z) {
  let d = 1e9;
  for (let k = 0; k < PATH.length - 1; k++) {
    const a = PATH[k], b = PATH[k + 1], vx = b[0] - a[0], vz = b[1] - a[1];
    const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz));
    d = Math.min(d, Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t));
  }
  return d;
}

const S0 = 180, camS = (p) => S0 + (LEN * 1.1 - S0) * smooth(clamp(p / 0.93)) ** 1.05;   // (it starts among the trees)
function camera(p) {
  const s = camS(p);
  const c = along(s), ahead = along(s + 260);
  let hx = ahead[0] - c[0], hz = ahead[1] - c[1];
  const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
  // eye height among the trunks, then over the canopy, then up above the valley
  const lift = 3.2 + 9 * sstep(0.015, 0.08, p) + 18 * sstep(0.08, 0.5, p) + 420 * sstep(0.6, 0.92, p) ** 1.4;   // up over the group, the canopy, the valley
  let g = 0;
  for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) g += ground(c[0] + ox, c[1] + oz);
  const y = g / 5 + lift;
  const pitch = -0.02 - 0.2 * sstep(0.6, 0.78, p) + 0.2 * sstep(0.8, 0.9, p);   // down into the valley, then up to the mountain
  return { x: c[0], z: c[1], y, hx, hz, pitch };
}

// ---------------------------------------------------------------- the look
// Dawn in October: a pale sky, mist lying in the valley, the forest almost black up close.
const PAPER = [244, 242, 238], INK = [29, 29, 27];
const SKY_TOP = [176, 188, 186], SKY_LOW = [229, 225, 214], MIST = [214, 218, 210];
const C_TREE = [11, 29, 23], C_FLOOR = [34, 54, 42], C_FELL = [58, 70, 59], C_SNOW = [238, 238, 232], C_WATER = [176, 189, 186];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const C_LIT = [52, 74, 50], C_BIRCH = [132, 108, 54], C_BIRCH_LIT = [168, 138, 74], C_STEM = [196, 194, 184], C_TRAIL = [96, 90, 70];
const C_ROCK = [96, 104, 104], C_ROCK_DARK = [62, 70, 72], ROPE = [217, 142, 60], C_SUN = [247, 222, 180];

// The mountain at the end of the valley is the club's mark, drawn as a mountain: the small peak, the
// big one, and the snow couloir that is the mark's cleft. Its geometry is the mark's own (the
// logo's path, in its own units), so at the end it can become the logo exactly.
const MARK_L = [[74, 84], [116, 168], [32, 168]];
const MARK_R = [[134, 30], [203, 168], [129, 168], [97, 104]];
const MARK_K = [[115, 98], [137, 98], [163, 150], [141, 150]];
const HERO = { dist: 9200, width: 7400, base: 700, rise: 1500 };   // metres beyond the valley's end
// the edges, finely divided, so the rock can be ragged and still land on the mark's straight lines
function outline(poly, n) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    for (let i = 0; i < n; i++) out.push([mix(a[0], b[0], i / n), mix(a[1], b[1], i / n), k, i / n]);
  }
  return out;
}
const OUT_L = outline(MARK_L, 22), OUT_R = outline(MARK_R, 22), OUT_K = outline(MARK_K, 10);

// the club on the trail: six hikers a little ahead, walking on as the camera lifts over them. Each is
// dressed for a cold October morning; big packs with a sleeping mat, daypacks, poles, hats.
const HIKERS = [
  { jacket: [150, 62, 44], pack: [44, 52, 50], pad: [217, 142, 60], big: true, hat: [214, 204, 184], pom: true, poles: true },
  { jacket: [48, 64, 86], pack: [217, 142, 60], pad: [62, 98, 104], big: true, hat: [52, 56, 58], hair: [58, 40, 30] },
  { jacket: [184, 142, 64], pack: [40, 58, 48], big: false, hair: [150, 116, 70], tail: true, poles: true },
  { jacket: [72, 88, 64], pack: [98, 68, 48], pad: [62, 98, 104], big: true, hat: [150, 62, 44], pom: true },
  { jacket: [116, 44, 50], pack: [217, 142, 60], pad: [44, 52, 50], big: true, hat: [214, 204, 184], poles: true },
  { jacket: [58, 62, 64], pack: [56, 74, 92], big: false, hat: [217, 142, 60], pom: true, hair: [40, 30, 24] },
].map((h, i) => ({ ...h, s: 201 + i * 4.4 + (i % 2) * 0.9, off: [-0.28, 0.38, -0.36, 0.3, -0.22, 0.4][i], step: i * 1.7 }));
const PANTS = [34, 38, 38], BOOT = [40, 32, 26], SOLE = [104, 92, 78], POLE = [150, 150, 146], GLOVE = [36, 38, 38];

// ---------------------------------------------------------------- drawing
const ctx2 = canvas.getContext('2d', { alpha: false });
let W = 0, H = 0, DPR = 1;
function resize() {
  W = stage.clientWidth; H = stage.clientHeight;
  DPR = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3.5e6 / (W * H)));   // up to about 3.5 MP: sharp, and the fills stay cheap
  const w = Math.round(W * DPR), h = Math.round(H * DPR);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

// Layers perpendicular to the flight's axis, anchored in the world so nothing slides: every 15 m
// close by, coarser with distance (60, 240, 960 m), each fading in as it comes into its range.
const LEVELS = [[20, 320], [80, 1300], [320, 4200], [960, 16000]];

// a spruce: a narrow spire of drooping tiers; its left half, towards the low sun, drawn again lighter
function spruce(path, lit, x, y, hPx, seed) {
  const w = hPx * (0.2 + 0.06 * seed), tiers = clamp(Math.round(hPx / 9), 2, 9);
  const tier = (i, k) => { const t = i / tiers; return [y - hPx + t * hPx * 0.9, w * t * (0.85 + 0.3 * ((seed * k * i) % 1))]; };
  path.moveTo(x, y - hPx);
  for (let i = 1; i <= tiers; i++) { const [yy, ww] = tier(i, 7.3); path.lineTo(x + ww, yy + hPx * 0.03); path.lineTo(x + ww * 0.42, yy - hPx * 0.02); }
  const tr = Math.max(0.5, hPx * 0.02);
  path.lineTo(x + tr, y - hPx * 0.08); path.lineTo(x + tr, y + 1); path.lineTo(x - tr, y + 1); path.lineTo(x - tr, y - hPx * 0.08);
  for (let i = tiers; i >= 1; i--) { const [yy, ww] = tier(i, 5.1); path.lineTo(x - ww * 0.42, yy - hPx * 0.02); path.lineTo(x - ww, yy + hPx * 0.03); }
  path.closePath();
  if (lit && hPx > 14) {
    lit.moveTo(x, y - hPx);
    for (let i = 1; i <= tiers; i++) { const [yy, ww] = tier(i, 5.1); lit.lineTo(x - ww * 0.42, yy - hPx * 0.02); lit.lineTo(x - ww, yy + hPx * 0.03); lit.lineTo(x - ww * 0.3, yy + hPx * 0.035); }
    lit.lineTo(x - tr, y - hPx * 0.1); lit.lineTo(x - hPx * 0.015, y - hPx * 0.2); lit.closePath();
  }
}
// a mountain birch in October: a crooked white stem, an open crown of gold
function birch(crown, lit, stems, x, y, hPx, seed) {
  const lean = (seed - 0.5) * hPx * 0.12, sw = Math.max(0.6, hPx * 0.03);
  stems.moveTo(x - sw, y + 1); stems.lineTo(x + lean - sw * 0.6, y - hPx * 0.62); stems.lineTo(x + lean + sw * 0.6, y - hPx * 0.62); stems.lineTo(x + sw, y + 1); stems.closePath();
  // an open crown: small clusters of leaves around the stem's top, sky between them
  const n = hPx > 40 ? 7 : 4;
  for (let i = 0; i < n; i++) {
    const a = seed * 40 + i * 2.39, d = hPx * 0.16 * Math.sqrt((i + 0.5) / n), r = hPx * (0.07 + 0.05 * ((seed * 9 * (i + 1)) % 1));
    const cxp = x + lean + Math.cos(a) * d * 1.2, cyp = y - hPx * 0.7 + Math.sin(a) * d * 0.9;
    crown.moveTo(cxp + r, cyp); crown.ellipse(cxp, cyp, r, r * 0.8, 0, 0, Math.PI * 2);
    if (lit && hPx > 24 && Math.cos(a) < 0.2) { lit.moveTo(cxp - r * 0.2 + r * 0.5, cyp - r * 0.2); lit.ellipse(cxp - r * 0.2, cyp - r * 0.2, r * 0.5, r * 0.4, 0, 0, Math.PI * 2); }
  }
}
// a hiker from behind, backlit by the low sun ahead and to the left: the backs in shade, a warm rim
// along the left edges, a long shadow towards us. `ph` is the phase of their stride.
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const rim = (c) => mix3(c, C_SUN, 0.34);
function hiker(g, x, y, h, who, ph, tone) {
  g.save();
  try { figure(g, x, y, h, who, ph, tone); } finally { g.restore(); }
}
function figure(g, x, y, h, who, ph, tone) {
  const col = (c) => rgb(tone(c));
  const fill = (c, path) => { g.fillStyle = col(c); g.fill(path); };
  if (h < 16) {                                  // far off: a silhouette is all that shows
    g.fillStyle = col(shade(who.jacket, 0.5));
    g.beginPath(); g.roundRect(x - h * 0.13, y - h * 0.84, h * 0.26, h * 0.42, h * 0.08); g.arc(x, y - h * 0.9, h * 0.07, 0, Math.PI * 2);
    g.moveTo(x - h * 0.09, y - h * 0.44); g.lineTo(x - h * 0.08, y); g.lineTo(x + h * 0.08, y); g.lineTo(x + h * 0.09, y - h * 0.44); g.fill();
    g.fillStyle = col(who.pack); g.beginPath(); g.roundRect(x - h * 0.12, y - h * 0.82, h * 0.24, h * 0.3, h * 0.06); g.fill();
    return;
  }
  const sw = Math.sin(ph), bob = -Math.abs(Math.cos(ph)) * h * 0.012;
  y += bob;
  // the shadow, falling back towards the camera and right
  g.fillStyle = `rgba(6, 18, 14, ${0.26 * (1 - (tone.fade || 0))})`;
  g.beginPath(); g.ellipse(x + h * 0.16, y - bob + h * 0.035, h * 0.26, h * 0.04, 0.12, 0, Math.PI * 2); g.fill();
  // poles, planted a little wide
  if (who.poles) {
    g.strokeStyle = col(POLE); g.lineWidth = Math.max(0.8, h * 0.011); g.lineCap = 'round';
    g.beginPath();
    for (const k of [-1, 1]) { const hx = x + k * (h * 0.2 + k * sw * h * 0.02), hy = y - h * 0.47 + k * sw * h * 0.015; g.moveTo(hx, hy); g.lineTo(hx + k * h * 0.06, y - bob - h * 0.01 + k * sw * h * 0.03); }
    g.stroke();
  }
  // legs and boots: the leg swinging back lifts its heel, and the sole shows
  for (const k of [-1, 1]) {
    const lift = Math.max(0, k * sw) * h * 0.06;
    const ax = x + k * h * 0.05, ay = y - h * 0.05 - lift;
    const leg = new Path2D();
    leg.moveTo(x + k * h * 0.012, y - h * 0.5); leg.lineTo(x + k * h * 0.105, y - h * 0.5);
    leg.lineTo(ax + k * h * 0.032, ay); leg.lineTo(ax - k * h * 0.03, ay); leg.closePath();
    fill(k < 0 ? PANTS : shade(PANTS, 0.8), leg);
    const boot = new Path2D(); boot.roundRect(ax - h * 0.042, ay - h * 0.012, h * 0.084, h * 0.058, h * 0.018);
    fill(BOOT, boot);
    if (lift > h * 0.012) { const sole = new Path2D(); sole.roundRect(ax - h * 0.04, ay + h * 0.03, h * 0.08, h * 0.016, h * 0.006); fill(SOLE, sole); }
  }
  // the jacket: shoulders, body, the arms swinging against the legs
  const J = who.jacket;
  const body = new Path2D();
  body.moveTo(x - h * 0.125, y - h * 0.47);
  body.lineTo(x - h * 0.14, y - h * 0.74); body.quadraticCurveTo(x - h * 0.15, y - h * 0.81, x - h * 0.07, y - h * 0.83);
  body.lineTo(x + h * 0.07, y - h * 0.83); body.quadraticCurveTo(x + h * 0.15, y - h * 0.81, x + h * 0.14, y - h * 0.74);
  body.lineTo(x + h * 0.125, y - h * 0.47); body.closePath();
  fill(shade(J, 0.72), body);
  for (const k of [-1, 1]) {
    const hx = x + k * (h * 0.19 + k * sw * h * 0.02), hy = y - h * 0.48 + k * sw * h * 0.015;
    const arm = new Path2D();
    arm.moveTo(x + k * h * 0.1, y - h * 0.8); arm.quadraticCurveTo(x + k * h * 0.17, y - h * 0.79, x + k * h * 0.19, y - h * 0.7);
    arm.lineTo(hx + k * h * 0.028, hy); arm.lineTo(hx - k * h * 0.026, hy + h * 0.004); arm.lineTo(x + k * h * 0.12, y - h * 0.66); arm.closePath();
    fill(k < 0 ? rim(shade(J, 0.8)) : shade(J, 0.62), arm);
    const hand = new Path2D(); hand.arc(hx, hy + h * 0.012, h * 0.026, 0, Math.PI * 2); fill(GLOVE, hand);
  }
  // the head: hair, a hat with a folded brim, sometimes a pompom or a ponytail
  const hy = y - h * 0.915, hr = h * 0.066;
  const head = new Path2D(); head.ellipse(x, hy, hr * 0.95, hr, 0, 0, Math.PI * 2);
  fill(who.hair || [52, 40, 32], head);
  if (who.tail) { const t = new Path2D(); t.ellipse(x + h * 0.012, hy + hr * 1.05, hr * 0.32, hr * 0.62, 0.15, 0, Math.PI * 2); fill(who.hair, t); }
  if (who.hat) {
    const hat = new Path2D(); hat.ellipse(x, hy - hr * 0.1, hr * 1.02, hr * 0.98, 0, Math.PI, Math.PI * 2); hat.lineTo(x + hr * 1.02, hy + hr * 0.2); hat.lineTo(x - hr * 1.02, hy + hr * 0.2); hat.closePath();
    fill(who.hat, hat);
    const brim = new Path2D(); brim.roundRect(x - hr * 1.05, hy - hr * 0.08, hr * 2.1, hr * 0.34, hr * 0.14); fill(shade(who.hat, 0.84), brim);
    if (who.pom) { const pom = new Path2D(); pom.arc(x, hy - hr * 1.12, hr * 0.34, 0, Math.PI * 2); fill(who.hat, pom); }
  }
  const lit = new Path2D(); lit.ellipse(x - hr * 0.55, hy - hr * 0.2, hr * 0.3, hr * 0.72, 0.2, 0, Math.PI * 2);
  g.save(); g.clip(head); fill(rim(who.hat || who.hair || [52, 40, 32]), lit); g.restore();
  // the pack: a lid, a front pocket, a hip belt; a rolled mat strapped under the big ones
  const P = who.pack, top = y - h * (who.big ? 0.865 : 0.8), bot = y - h * (who.big ? 0.53 : 0.58), pw = h * (who.big ? 0.3 : 0.24);
  const belt = new Path2D(); belt.roundRect(x - h * 0.155, y - h * 0.56, h * 0.31, h * 0.034, h * 0.012); if (who.big) fill(shade(P, 0.45), belt);
  const pack = new Path2D(); pack.roundRect(x - pw / 2, top, pw, bot - top, h * 0.05); fill(shade(P, 0.8), pack);
  const edge = new Path2D(); edge.roundRect(x - pw / 2, top, pw * 0.14, bot - top, [h * 0.05, 0, 0, h * 0.05]); fill(rim(shade(P, 0.8)), edge);
  const lid = new Path2D(); lid.roundRect(x - pw / 2 - h * 0.004, top, pw + h * 0.008, (bot - top) * 0.24, [h * 0.05, h * 0.05, h * 0.02, h * 0.02]); fill(shade(P, 0.64), lid);
  const pocket = new Path2D(); pocket.roundRect(x - pw * 0.3, top + (bot - top) * 0.52, pw * 0.6, (bot - top) * 0.38, h * 0.03); fill(shade(P, 0.68), pocket);
  g.strokeStyle = col(shade(P, 0.5)); g.lineWidth = Math.max(0.6, h * 0.008); g.lineCap = 'butt';
  g.beginPath(); for (const k of [-1, 1]) { g.moveTo(x + k * pw * 0.36, top + (bot - top) * 0.3); g.lineTo(x + k * pw * 0.36, bot - h * 0.02); } g.stroke();
  if (who.big && who.pad) {
    const pad = new Path2D(); pad.roundRect(x - pw * 0.55, bot - h * 0.012, pw * 1.1, h * 0.066, h * 0.033); fill(shade(who.pad, 0.86), pad);
    const padLit = new Path2D(); padLit.roundRect(x - pw * 0.55, bot - h * 0.012, pw * 0.3, h * 0.066, [h * 0.033, 0, 0, h * 0.033]); fill(rim(who.pad), padLit);
  }
}

function draw(p) {
  const g = ctx2;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cam = camera(p);
  const fov = (coarse && W < H ? 62 : 52) * Math.PI / 180;
  const f = (H / 2) / Math.tan(fov / 2) * (W < H ? 0.8 : 1);
  const cx = W / 2, horizon = H * 0.5 + f * Math.tan(cam.pitch);
  const rx = -cam.hz, rz = cam.hx;                  // right, on the ground
  const fade = sstep(0.83, 0.96, p);                 // the colour drains to paper
  const lines = sstep(0.8, 0.9, p) * (1 - sstep(0.92, 0.955, p));
  const toPaper = (c) => mix3(c, PAPER, fade);
  const morph = sstep(0.86, 0.96, p);                // the mountain becomes the mark

  // ---- the mountain: a shape facing us, beyond the end of the valley
  const hc = along(LEN * 1.1 + HERO.dist), hvx = hc[0] - cam.x, hvz = hc[1] - cam.z;
  const heroDist = hvx * cam.hx + hvz * cam.hz, heroX = cx + f * (hvx * rx + hvz * rz) / heroDist;
  // where the logo's mark sits on the title card (the lockup's own placement of it)
  const lk = lockupRect();
  const target = (mx, my) => lk ? [lk.left + (89 + (mx - 32) * 0.90058) * lk.width / 332, lk.top + (26 + (my - 30) * 0.90058) * lk.height / 242.9] : [cx, H / 2];
  const rough = f * 55 / heroDist;
  const pt = (mx, my, e = 0, i = 0) => {
    let x = heroX + f * ((mx - 117.5) / 171 * HERO.width) / heroDist;
    let y = horizon - f * (HERO.base + (168 - my) / 138 * HERO.rise - cam.y) / heroDist;
    if (my < 167.5) y += (noise(mx * 0.31 + e * 13.7, my * 0.29 + i * 3.1) - 0.5) * 2 * rough * (1 - morph);
    const t = target(mx, my);
    return [mix(x, t[0], morph), mix(y, t[1], morph)];
  };
  const poly = (list, e) => { const path = new Path2D(); list.forEach((q, i) => { const [x, y] = pt(q[0], q[1], e, i); i ? path.lineTo(x, y) : path.moveTo(x, y); }); path.closePath(); return path; };
  const heroAir = Math.min(0.8, 1 - Math.exp(-heroDist / 9000));
  function drawHero() {
    const inkOf = (c) => mix3(mix3(c, MIST, heroAir * (1 - morph)), INK, morph);
    const L = poly(OUT_L, 1), R = poly(OUT_R, 2);
    g.fillStyle = rgb(inkOf(C_ROCK)); g.fill(L); g.fill(R);
    if (morph < 0.999) {
      const cover = 1 - morph;
      // snow on the tops, down to a ragged line
      const cap = (apex, left, right, yS, e) => {
        const path = new Path2D(), [ax, ay] = apex, n = 9;
        const lx = ax + (left[0] - ax) * (yS - ay) / (left[1] - ay), rxm = ax + (right[0] - ax) * (yS - ay) / (right[1] - ay);
        const a0 = pt(ax, ay, e, 0); path.moveTo(a0[0], a0[1]);
        const l0 = pt(lx, yS, e, 1); path.lineTo(l0[0], l0[1]);
        for (let i = 1; i < n; i++) { const mxv = mix(lx, rxm, i / n), myv = yS + (i % 2 ? -4 : 3) * (0.6 + noise(i * 1.7, e) * 0.8); const q = pt(mxv, myv, e, i + 2); path.lineTo(q[0], q[1]); }
        const r0 = pt(rxm, yS, e, n + 2); path.lineTo(r0[0], r0[1]); path.closePath();
        return path;
      };
      g.fillStyle = rgb(mix3(C_SNOW, MIST, heroAir), cover);
      g.fill(cap(MARK_L[0], MARK_L[2], MARK_L[1], 112, 1)); g.fill(cap(MARK_R[0], MARK_R[3], MARK_R[1], 76, 2));
      // the shaded faces, away from the sun
      g.fillStyle = rgb(mix3(C_ROCK_DARK, MIST, heroAir * 0.7), 0.55 * cover);
      g.fill(poly([MARK_L[0], MARK_L[1], [MARK_L[0][0], 168]], 3)); g.fill(poly([MARK_R[0], MARK_R[1], [MARK_R[0][0], 168]], 4));
    }
    // the couloir: snow in the mountain, the cleft in the mark
    g.fillStyle = rgb(mix3(mix3(C_SNOW, MIST, heroAir), PAPER, morph)); g.fill(poly(OUT_K, 5));
  }
  let heroDrawn = false;

  // ---- the trail: a pale ribbon on the forest floor, as far as it can be seen through the trees
  const trail = [];
  const sNow = (() => { let best = 0, bd = 1e9; for (let q = 0; q <= LEN * 1.1; q += 20) { const c = along(q), d = Math.hypot(c[0] - cam.x, c[1] - cam.z); if (d < bd) { bd = d; best = q; } } return best; })();
  // each station has its own width and side normal, shared by the two segments that meet there, so the edges run clean
  const station = (q) => { const c = along(q), b = along(q - 1.25), a = along(q + 1.25), tx = a[0] - b[0], tz = a[1] - b[1], tl = Math.hypot(tx, tz) || 1; return [c, -tz / tl, tx / tl, 0.75 + 0.2 * noise(q / 9, 3.3)]; };
  for (let q = Math.max(0, sNow - 8); q < sNow + 170; q += 2.5) {
    const s0 = station(q), s1 = station(q + 2.5);
    const corners = [[s0, -1], [s0, 1], [s1, 1], [s1, -1]].map(([[c, px, pz, wd], o]) => {
      const x = c[0] + px * wd * o, z = c[1] + pz * wd * o, vx = x - cam.x, vz = z - cam.z, zc = vx * cam.hx + vz * cam.hz;
      return zc < 0.8 ? null : [cx + f * (vx * rx + vz * rz) / zc, horizon - f * (ground(x, z) + 0.05 - cam.y) / zc, zc];
    });
    if (corners.some((c) => !c)) continue;
    trail.push({ dist: Math.min(...corners.map((c) => c[2])), pts: corners, drawn: false });
  }
  const trailCol = rgb(toPaper(C_TRAIL), 0.9);
  const drawTrail = (list) => { if (!list.length) return; g.fillStyle = trailCol; g.beginPath(); for (const t of list) { t.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); t.drawn = true; } g.fill(); };

  // ---- the group on the trail, walking on
  const hikersAt = [];
  // the group keeps nearly our pace while the title is up, then walks on at its own and we rise over them
  const walked = 0.8 * (camS(Math.min(p, 0.035)) - S0) + 60 * p;
  const tone = Object.assign(toPaper, { fade });
  for (const hk of HIKERS) {
    const sh = hk.s + walked, c = along(sh), c2 = along(sh + 4);
    const dx = c2[0] - c[0], dz = c2[1] - c[1], dl = Math.hypot(dx, dz) || 1;
    const x = c[0] - dz / dl * hk.off, z = c[1] + dx / dl * hk.off;
    const vx = x - cam.x, vz = z - cam.z, zc = vx * cam.hx + vz * cam.hz;
    if (zc < 1.2) continue;
    hikersAt.push({ dist: zc, x: cx + f * (vx * rx + vz * rz) / zc, y: horizon - f * (ground(x, z) - cam.y) / zc, h: f * 1.72 / zc,
      who: hk, ph: sh * (Math.PI * 2 / 1.5) + hk.step, drawn: false });
  }
  hikersAt.sort((a, b) => b.dist - a.dist);   // far to near
  const drawHiker = (hk) => { hiker(g, hk.x, hk.y, hk.h, hk.who, hk.ph, tone); hk.drawn = true; };

  // sky, with the sun just up behind the fells to the left of the valley
  const sky = g.createLinearGradient(0, 0, 0, Math.max(1, horizon));
  sky.addColorStop(0, rgb(toPaper(SKY_TOP))); sky.addColorStop(1, rgb(toPaper(SKY_LOW)));
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const sunX = W * 0.2 - W * 0.12 * p, sunY = horizon - H * 0.06;
  const glow = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, Math.max(W, H) * 0.55);
  glow.addColorStop(0, rgb(C_SUN, 0.55 * (1 - fade))); glow.addColorStop(0.35, rgb(C_SUN, 0.16 * (1 - fade))); glow.addColorStop(1, rgb(C_SUN, 0));
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  // geese going south, across the sky as we climb
  const geese = sstep(0.18, 0.26, p) * (1 - sstep(0.6, 0.68, p)) * (1 - fade);
  if (geese > 0) {
    const gx = W * (1.15 - 1.5 * clamp((p - 0.18) / 0.5)), gy = H * (0.2 + 0.05 * Math.sin(p * 9));
    g.strokeStyle = rgb(mix3(C_TREE, SKY_TOP, 0.35), 0.7 * geese); g.lineWidth = 1.1; g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 11; i++) {
      const k = i === 0 ? 0 : Math.ceil(i / 2) * (i % 2 ? 1 : -1), bx = gx + Math.abs(k) * 15, by = gy + k * 8, s2 = 4 + (i % 3);
      const flap = Math.sin(p * 140 + i * 1.7) * 2;
      g.moveTo(bx - s2, by - flap); g.quadraticCurveTo(bx - s2 * 0.4, by - 1.5, bx, by); g.quadraticCurveTo(bx + s2 * 0.4, by - 1.5, bx + s2, by - flap);
    }
    g.stroke();
  }

  // the columns every layer is sampled at, and their rays on the ground
  const step = 4, N = Math.ceil(W / step) + 1;
  const dirX = new Float32Array(N), dirZ = new Float32Array(N), dotA = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const k = (c * step - cx) / f;
    dirX[c] = cam.hx + rx * k; dirZ[c] = cam.hz + rz * k;
    dotA[c] = Math.max(0.05, dirX[c] * AX[0] + dirZ[c] * AX[1]);
  }
  const sCam = cam.x * AX[0] + cam.z * AX[1];

  // the layers in view, far to near
  const layers = [];
  for (let L = LEVELS.length - 1; L >= 0; L--) {
    const [d, hi] = LEVELS[L], lo = L ? LEVELS[L - 1][1] * 0.8 : 1.5;
    for (let s = Math.ceil((sCam + lo) / d) * d; s <= sCam + hi; s += d) {
      if (L < LEVELS.length - 1 && Math.abs(s / LEVELS[L + 1][0] - Math.round(s / LEVELS[L + 1][0])) < 1e-6) continue;   // a coarser level has it
      const dist = s - sCam;
      layers.push({ s, dist, L, a: L < LEVELS.length - 1 ? 1 - sstep(hi * 0.8, hi, dist) : 1 - sstep(hi * 0.85, hi, dist) });
    }
  }
  layers.sort((a, b) => b.dist - a.dist);

  // profiles
  // each layer's edge, and the colour of the ground along it: forest floor, open fell, snow or water,
  // blended rather than cut, so a change of ground never shows as a step
  const tops = layers.map(() => new Float32Array(N)), cols = layers.map(() => new Float32Array(N * 3));
  layers.forEach((ly, k) => {
    const top = tops[k], col = cols[k];
    const every = ly.dist > 2000 ? 2 : 1;                       // far off, every other column is plenty
    for (let c = 0; c < N; c++) {
      if (every > 1 && c % every && c < N - 1) continue;
      const t = ly.dist / dotA[c], x = cam.x + dirX[c] * t, z = cam.z + dirZ[c] * t;
      const hh = ly.dist < 1500 ? ground(x, z) : heightAt(x, z);
      top[c] = horizon - f * (Math.max(hh, WATER) - cam.y) / t;
      let cc = hh <= WATER + 0.5 ? C_WATER : mix3(C_FELL, C_FLOOR, sstep(0.05, 0.6, forest(x, z, hh)));
      cc = mix3(cc, C_SNOW, sstep(-40, 60, hh - snowline(x, z)));
      col[c * 3] = cc[0]; col[c * 3 + 1] = cc[1]; col[c * 3 + 2] = cc[2];
    }
    if (every > 1) for (let c = 1; c < N - 1; c += 2) {
      top[c] = (top[c - 1] + top[c + 1]) / 2;
      for (let q = 0; q < 3; q++) col[c * 3 + q] = (col[c * 3 - 3 + q] + col[c * 3 + 3 + q]) / 2;
    }
  });

  if (morph <= 0 && (!layers.length || heroDist >= layers[0].dist)) { drawHero(); heroDrawn = true; }

  // fill, far to near: each layer from its own edge down to the edge of the next nearer one
  let behind = null;
  for (let k = 0; k < layers.length; k++) {
    const ly = layers[k], top = tops[k], next = k + 1 < layers.length ? tops[k + 1] : null, col = cols[k];
    const air = Math.min(0.9, 1 - Math.exp(-ly.dist / 3600));             // the air between us and it
    const mist = 0.3 * sstep(150, 900, ly.dist);                            // mist lies in the hollows
    const band = new Path2D();
    band.moveTo(0, top[0]);
    for (let c = 1; c < N; c++) band.lineTo(c * step, top[c]);
    if (next) { for (let c = N - 1; c >= 0; c--) band.lineTo(c * step, Math.max(top[c], next[c])); }
    else { band.lineTo((N - 1) * step, H); band.lineTo(0, H); }
    band.closePath();
    // the ground's colour along the layer, as a horizontal gradient (smoothed over a few columns).
    // Opaque: a layer that is still coming into view takes the colour of the one behind it, and
    // turns into its own as it arrives, so nothing behind ever shows through
    const gr = g.createLinearGradient(0, 0, (N - 1) * step, 0), every = 8, stops = [];
    for (let c = 0, i = 0; c < N; c += every, i++) {
      let r = 0, gg = 0, bb = 0, n = 0;
      for (let d = -every; d <= every; d += 2) { const q = clamp(c + d, 0, N - 1) * 3; r += col[q]; gg += col[q + 1]; bb += col[q + 2]; n++; }
      let cc = toPaper(mix3([r / n, gg / n, bb / n], MIST, air));
      if (ly.a < 1 && behind) cc = mix3(behind[i] || cc, cc, ly.a);
      stops.push(cc);
      gr.addColorStop(c / (N - 1), rgb(cc));
    }
    behind = stops;
    g.fillStyle = gr; g.fill(band);
    if (mist > 0.01 && fade < 0.999) {
      let yMin = 1e9; for (let c = 0; c < N; c++) yMin = Math.min(yMin, top[c]);
      const mg = g.createLinearGradient(0, yMin, 0, yMin + 0.14 * H);
      mg.addColorStop(0, rgb(MIST, 0)); mg.addColorStop(1, rgb(toPaper(MIST), mist * ly.a * (1 - fade)));
      g.fillStyle = mg; g.fill(band);
    }

    // the mountain, in its place among the layers (until it becomes the mark, drawn on top)
    if (!heroDrawn && ly.dist < heroDist && morph <= 0) { drawHero(); heroDrawn = true; }
    // the trail and the group on it, at their depth
    drawTrail(trail.filter((t) => !t.drawn && ly.dist < t.dist));
    for (const hk of hikersAt) if (!hk.drawn && ly.dist < hk.dist) drawHiker(hk);

    // trees on this layer's forest, where they are more than a few pixels tall
    if (ly.dist < 1100) {
      const shades = [new Path2D(), new Path2D(), new Path2D()], lit = new Path2D();
      const crowns = new Path2D(), crownLit = new Path2D(), stems = new Path2D();
      const du = ly.L === 0 ? 7 : ly.dist < 700 ? 14 : 24;               // metres between trees along the layer
      const Bx = -AX[1], Bz = AX[0];                                       // along the layer
      const u0 = (cam.x - AX[0] * sCam) * Bx + (cam.z - AX[1] * sCam) * Bz;
      const half = (ly.dist / dotA[0]) * 1.1 * (W / 2 / f + 0.3);
      for (let j = Math.floor((u0 - half) / du); j <= Math.ceil((u0 + half) / du); j++) {
        const r = hash2(j, Math.round(ly.s));
        const u = (j + 0.8 * (r - 0.5)) * du;
        const x = AX[0] * ly.s + Bx * u, z = AX[1] * ly.s + Bz * u;
        const hh = ground(x, z), fo = forest(x, z, hh);
        if (fo <= 0.1 || hash2(j + 17, Math.round(ly.s) + 3) > fo * 0.92) continue;
        if (ly.dist < 400 && distToPath(x, z) < 4 + 3 * r) continue;       // the trail
        const vx = x - cam.x, vz = z - cam.z, zc = vx * cam.hx + vz * cam.hz;
        if (zc < 1.5) continue;
        const sx = cx + f * (vx * rx + vz * rz) / zc;
        const hPx = f * (11 + 13 * hash2(j + 5, Math.round(ly.s) + 11)) * (0.6 + 0.4 * fo) / zc;
        if (hPx < 2.5 || sx < -hPx || sx > W + hPx) continue;
        const by = horizon - f * (hh - cam.y) / zc;
        if (hash2(j + 29, Math.round(ly.s) + 7) < 0.1 + 0.32 * sstep(450, 600, hh)) birch(crowns, crownLit, stems, sx, by, hPx * 0.7, r);
        else spruce(shades[(r * 3) | 0], lit, sx, by, hPx, r);
      }
      const tint = (c) => rgb(toPaper(mix3(c, MIST, air)), ly.a);
      g.fillStyle = tint(C_STEM); g.fill(stems);
      g.fillStyle = tint(C_BIRCH); g.fill(crowns);
      g.fillStyle = rgb(toPaper(mix3(C_BIRCH_LIT, MIST, air)), 0.6 * ly.a * (1 - 0.7 * air)); g.fill(crownLit);
      shades.forEach((sh, i) => { g.fillStyle = tint(mix3(C_TREE, C_LIT, i * 0.18)); g.fill(sh); });
      g.fillStyle = rgb(toPaper(mix3(C_LIT, MIST, air)), 0.55 * ly.a * (1 - 0.6 * air)); g.fill(lit);
    }

    // the layer's edge: a faint lit line, and at the end the ink of a contour drawing
    const edge = new Path2D();
    edge.moveTo(0, top[0]);
    for (let c = 1; c < N; c++) edge.lineTo(c * step, top[c]);
    if (lines > 0.001) { g.strokeStyle = rgb(INK, 0.5 * lines * ly.a * (1 - 0.6 * air)); g.lineWidth = ly.L < 2 ? 0.9 : 0.6; g.stroke(edge); }
    else if (ly.dist > 60) { g.strokeStyle = rgb(mix3(C_FLOOR, PAPER, 0.35 + 0.4 * air), 0.16 * ly.a); g.lineWidth = 0.6; g.stroke(edge); }
  }
  drawTrail(trail.filter((t) => !t.drawn));
  for (const hk of hikersAt) if (!hk.drawn) drawHiker(hk);

  // morning light falling through the trees, while we are among them
  const beams = (1 - sstep(0.1, 0.28, p)) * 0.09;
  if (beams > 0.002) {
    const dx = W * 0.42, dy = H + 20, dl = Math.hypot(dx, dy), nx = dy / dl, ny = -dx / dl;
    for (let i = 0; i < 4; i++) {
      const x0 = sunX + W * (0.1 + i * 0.17), w = W * (0.035 + 0.025 * (i % 3)), a = beams * (0.5 + 0.5 * ((i * 0.37) % 1));
      const gr = g.createLinearGradient(x0 - nx * w, -10 - ny * w, x0 + nx * w, -10 + ny * w);
      gr.addColorStop(0, rgb(C_SUN, 0)); gr.addColorStop(0.5, rgb(C_SUN, a)); gr.addColorStop(1, rgb(C_SUN, 0));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x0 - nx * w, -10 - ny * w); g.lineTo(x0 + nx * w, -10 + ny * w); g.lineTo(x0 + dx + nx * w, dy - 10 + ny * w); g.lineTo(x0 + dx - nx * w, dy - 10 - ny * w); g.closePath(); g.fill();
    }
  }
  if (morph > 0) drawHero();
}

// ---------------------------------------------------------------- the captions and the page
const lockupEl = section.querySelector('.intro-end-lockup');
// where the title card's lockup is: measured once and on resize, never in the middle of a frame
let lockupBox = null;
const lockupRect = () => (lockupBox ||= lockupEl?.getBoundingClientRect() ?? null);
addEventListener('resize', () => { lockupBox = null; });
const lines = [...section.querySelectorAll('[data-at]')].map((el) => ({ el, a: el.dataset.at.split(' ').map(Number) }));
function overlay(p) {
  stage.style.setProperty('--p', p.toFixed(4));
  for (const l of lines) {
    const [a, b] = l.a, v = sstep(a, a + 0.04, p) * (1 - sstep(b - 0.04, b, p));
    l.el.style.opacity = v.toFixed(3);
    l.el.style.transform = `translate3d(0, ${((1 - v) * (p < a + 0.04 ? 14 : -14)).toFixed(1)}px, 0)`;
  }
  stage.classList.toggle('is-light', p > 0.88);
}

// ---------------------------------------------------------------- loop
let pShown = 0, target = 0, last = performance.now(), raf = 0, running = false, visible = true, drawn = -1;

function scrollProgress() {
  const span = (section.offsetHeight - innerHeight) * 0.96;     // complete while the stage is still pinned
  return span > 0 ? clamp(-section.getBoundingClientRect().top / span) : 0;
}

// Jumps (Skip, Replay, the Home and End keys) cut to the new place instead of flying the whole way there.
function jump(y) { scrollTo({ top: y, behavior: 'instant' }); target = pShown = scrollProgress(); drawn = -1; request(); }
let ended = false;
function state() {
  const end = !visible || target > 0.97;
  if (end !== ended) {
    ended = end;
    root.classList.toggle('intro-complete', end);                   // the site's nav comes back on the title card
    stage.classList.toggle('is-end', end);
    if (end) try { sessionStorage.setItem('hc-intro', 'seen'); } catch (e) { /* private mode */ }
  }
}

function frame(now) {
  running = false;
  if (!visible) return;
  const dt = Math.min(Math.max(now - last, 0) / 1000, 0.1); last = now;
  target = DEBUG_P ?? scrollProgress();
  pShown = DEBUG_P != null || Math.abs(target - pShown) > 0.25 ? target : pShown + (target - pShown) * (1 - Math.exp(-dt * 5));
  if (Math.abs(target - pShown) < 2e-4) pShown = target;
  state();
  if (Math.abs(pShown - drawn) > 1e-5) {
    const t0 = performance.now();
    resize();
    draw(pShown);
    overlay(pShown);
    drawn = pShown;
    window.__intro = { p: pShown, ms: performance.now() - t0, bake: T ? 0 : 'loading' };   // for the tuning scripts
  }
  if (Math.abs(target - pShown) > 1e-5) request();
}
function request() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); } }

root.classList.add('has-webgl');
target = pShown = DEBUG_P ?? scrollProgress();
state();
overlay(pShown);
HC.terrain(canvas.dataset.src).then((t) => { T = t; drawn = -1; request(); });
addEventListener('scroll', request, { passive: true });
addEventListener('resize', () => { drawn = -1; request(); });
new IntersectionObserver(([e]) => {
  visible = e.isIntersecting;
  state();
  if (visible) request();
}).observe(section);
section.querySelector('.intro-skip')?.addEventListener('click', (e) => { e.preventDefault(); jump(endY()); section.querySelector('.intro-end')?.focus?.({ preventScroll: true }); });
section.querySelector('.intro-end-replay')?.addEventListener('click', (e) => { e.preventDefault(); jump(0); });
request();
})();
