// The opening: the flight up the Abisko valley rendered in 3D, with light, shadow and air. intro.js loads
// it; the cut-paper version there (same path, captions and ending, a longer scroll) plays with
// ?scene=simple and wherever WebGL 2 is missing.
//
// The land is the Abisko elevation model (43 m cells), interpolated bicubically on the GPU and given
// detail below its cells by value noise, with analytic normals so the light is exact at every level
// of detail. It is drawn as a CDLOD quadtree: square patches, finer near the camera, morphing into
// the coarser level at their edges so nothing pops or cracks. The forest is placed by one rule, the
// same in JavaScript and on the GPU: near the camera each tree is geometry (spruce: whorls of drooping
// branch sprays; mountain birch: crooked white stems, an open crown of October leaves), further off
// the same trees are pictures of themselves, scattered by the GPU. A low October sun from the south
// casts the mountains' shadows (traced once over the elevation model) and the trees' (a shadow map),
// and shines through the needles and leaves it is behind. The picture is rendered in linear light
// into a multisampled buffer with a second target that says how much paper shows through, so the
// ending (the colour draining into a contour drawing) is exact; then tone-mapped and graded.
import * as THREE from './vendor/three.min.js';

const section = document.getElementById('intro');
const stage = section.querySelector('.intro-stage');
const canvas = section.querySelector('canvas');
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const DEBUG_P = params.has('p') ? parseFloat(params.get('p')) : null;
const HIDE = (params.get('hide') || '').split(',');   // for the tuning scripts
const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a)));
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- where the page starts (as intro.js)
const navType = performance.getEntriesByType('navigation')[0]?.type;
const seen = (() => { try { return sessionStorage.getItem('hc-intro') === 'seen'; } catch (e) { return false; } })();
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const endY = () => section.offsetTop + (section.offsetHeight - innerHeight) * 0.96;
{
  let y = 'end';
  if (DEBUG_P != null || params.has('intro') || navType === 'reload' || !seen) y = 0;
  else if (location.hash && location.hash !== '#top') y = null;
  else if (navType === 'back_forward') { const s = +sessionStorage.getItem('hc-home-y'); if (s > 0) y = s; }
  if (y !== null) scrollTo({ top: y === 'end' ? endY() : y, behavior: 'instant' });
}
addEventListener('pagehide', () => { try { sessionStorage.setItem('hc-home-y', String(Math.round(scrollY))); } catch (e) { /* private mode */ } });

// ---------------------------------------------------------------- the land (metres; x east, z south, y up)
const HMIN = +canvas.dataset.min, HMAX = +canvas.dataset.max;
const [WKM, HKM] = canvas.dataset.km.split(',').map(Number);
const WM = WKM * 1000, HM = HKM * 1000;
const WATER = HMIN + 3;
let T = null;

// value noise; the same integer hash as the shaders', so trees and people stand where the GPU draws
const hash2 = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return mix(mix(hash2(i, j), hash2(i + 1, j), u), mix(hash2(i, j + 1), hash2(i + 1, j + 1), u), v);
}
// beyond the model: fells and ridged mountains (to ~1,800 m, snow on the tops), and a valley floor at 600 m
// that leads from the end of the flight to the mountain that is the mark
const ridges = (x, z) => {
  const r = 1 - Math.abs(2 * noise(x / 5200, z / 5200) - 1);
  const h = 560 + 1250 * (r ** 1.6 * 0.6 + noise(x / 1900 + 7, z / 1900 + 3) * 0.3 + noise(x / 700 + 2, z / 700 + 9) * 0.1);
  return mix(600, h, corridor(x, z));
};
const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
function mapHeight(x, z) {
  if (!T) return 400;
  const { w, h, data } = T;
  let gx = x / WM * (w - 1), gz = z / HM * (h - 1);
  const out = Math.max(-gx, gx - (w - 1), -gz, gz - (h - 1), 0) * (WM / (w - 1));
  gx = clamp(gx, 1, w - 3); gz = clamp(gz, 1, h - 3);
  const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j;
  const row = (jj) => { const k = jj * w + i; return cr(data[k - 1], data[k], data[k + 1], data[k + 2], fx); };
  let hh = HMIN + cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz) * (HMAX - HMIN);
  if (out > 0) hh = mix(hh, ridges(x, z), sstep(0, 2200, out));
  return hh;
}
// the model and the ground it cannot hold: hummocks, boulders' worth of bumps, the lake flat
function groundFrom(x, z, h) {
  const d = 6 * (noise(x / 240 + 3, z / 240) - 0.5) + 2.5 * (noise(x / 38, z / 38) - 0.5) + 0.6 * (noise(x / 7, z / 7 + 11) - 0.5) + 0.18 * (noise(x / 1.9 + 5, z / 1.9) - 0.5);
  return Math.max(WATER, h + d * sstep(WATER, WATER + 10, h));
}
const ground = (x, z) => groundFrom(x, z, mapHeight(x, z));

// ---------------------------------------------------------------- the flight (as intro.js)
const mp = (px, py) => [px / 768 * WM, py / 768 * HM];
const PATH = [mp(520, 300), mp(478, 342), mp(430, 392), mp(372, 428), mp(318, 462), mp(262, 500)];
const LEGS = PATH.slice(1).map((q, k) => Math.hypot(q[0] - PATH[k][0], q[1] - PATH[k][1]));
const LEN = LEGS.reduce((a, b) => a + b, 0);
function along(s) {
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
const CORR = [...along(LEN), ...along(LEN * 1.1 + 9200 + 2500)];
const corridor = (x, z) => {
  const vx = CORR[2] - CORR[0], vz = CORR[3] - CORR[1], t = clamp(((x - CORR[0]) * vx + (z - CORR[1]) * vz) / (vx * vx + vz * vz));
  return sstep(1800, 4600, Math.hypot(x - CORR[0] - vx * t, z - CORR[1] - vz * t));
};
const S0 = 180, camS = (p) => S0 + (LEN * 1.1 - S0) * smooth(clamp(p / 0.93)) ** 1.05;
function flight(p) {
  const s = camS(p), c = along(s), ahead = along(s + 260);
  let hx = ahead[0] - c[0], hz = ahead[1] - c[1];
  const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
  const lift = 3.2 + 9 * sstep(0.015, 0.08, p) + 18 * sstep(0.08, 0.5, p) + 420 * sstep(0.6, 0.92, p) ** 1.4;
  let g = 0;
  for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) g += ground(c[0] + ox, c[1] + oz);
  const pitch = -0.02 - 0.2 * sstep(0.6, 0.78, p) + 0.2 * sstep(0.8, 0.9, p);
  return { x: c[0], z: c[1], y: Math.max(g / 5, ground(c[0], c[1]) + 1.7) + lift, hx, hz, pitch, s };
}

// ---------------------------------------------------------------- the forest: one rule, here and on the GPU
const CELL = 5;                                   // metres: one tree at most per cell
// The measured valley keeps its treeline; the fictional continuation rises into birch woodland
// at the foot of the final mountain instead of putting a 600 m floor right above the forest.
const treeline = (x, z) => 610 + 170 * sstep(0, 2200, Math.max(-x, x - WM, -z, z - HM, 0)) + 60 * (noise(x / 700, z / 700) - 0.5);
function forestAt(x, z, mh) {
  if (mh <= WATER + 1.5) return 0;
  const tl = treeline(x, z);
  let d = sstep(tl + 20, tl - 60, mh) * sstep(0.2, 0.42, noise(x / 160, z / 160 + 9));
  d *= sstep(2.4, 5, distToPath(x, z) + 1.5 * (noise(x / 9, z / 9) - 0.5));   // the trail keeps its clearing
  return d;
}
const birchShare = (mh) => 0.14 + 0.36 * sstep(430, 590, mh) + 0.3 * sstep(14, 3, mh - WATER);
function treeAt(i, j, cs = CELL, salt = 0) {
  const a = salt * 7717, b = salt * 3571;
  const x = (i + 0.1 + 0.8 * hash2(i * 3 + 1 + a, j * 7 + 2 + b)) * cs, z = (j + 0.1 + 0.8 * hash2(i * 5 + 3 + a, j * 11 + 4 + b)) * cs;
  const mh = mapHeight(x, z);
  if (!(hash2(i + 7919 + a, j + 104729 + b) < forestAt(x, z, mh) * 0.9)) return null;
  const tl = treeline(x, z), birch = hash2(i + 31 + a, j + 57 + b) < birchShare(mh);
  const vr = hash2(i + 97 + a, j + 13 + b), sr = hash2(i + 211 + a, j + 89 + b), rr = hash2(i + 401 + a, j + 17 + b);
  const up = sstep(tl + 10, tl - 170, mh);
  return {
    x, z, y: groundFrom(x, z, mh) - 0.15, rot: rr * Math.PI * 2,
    v: birch ? 3 + Math.min(1, (vr * 2) | 0) : Math.min(2, (vr * 3) | 0),
    s: birch ? (3.2 + 3.4 * sr) * (0.7 + 0.3 * up) : (9 + 7 * sr) * (0.5 + 0.5 * up),
  };
}

// ---------------------------------------------------------------- light
// Mid-October at 68°N: at noon the sun stands about 9–12° over the southern horizon, ahead and to the
// left as the valley is entered, so the forest is backlit and the shadows come towards us.
const SUN = new THREE.Vector3(-0.34, 0.165, 0.94).normalize();
const lin = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
const glsl = (c) => `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
const INK = lin(29, 29, 27);

// ---------------------------------------------------------------- shared GLSL
const NOISE = /* glsl */`
float hash2(ivec2 p) { uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u; h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u; return float(h) / 4294967296.0; }
vec3 vnoised(vec2 x) {
  vec2 i = floor(x), f = x - i, u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  ivec2 q = ivec2(i);
  float a = hash2(q), b = hash2(q + ivec2(1, 0)), c = hash2(q + ivec2(0, 1)), d = hash2(q + ivec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du.x * ((b - a) + (a - b - c + d) * u.y), du.y * ((c - a) + (a - b - c + d) * u.x));
}
float vnoise(vec2 x) { return vnoised(x).x; }
float sst(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
`;
const LAND = /* glsl */`
uniform highp sampler2D uHeight;
uniform sampler2D uSunVis;
uniform vec2 uMapSize, uRes;
uniform float uHMin, uHMax, uWater;
float cr(float p0, float p1, float p2, float p3, float t) { return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0))); }
float crd(float p0, float p1, float p2, float p3, float t) { return 0.5 * (p2 - p0 + 2.0 * t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) + 3.0 * t * t * (3.0 * (p1 - p2) + p3 - p0)); }
float H(int x, int y) { return texelFetch(uHeight, ivec2(x, y), 0).r; }
uniform vec4 uCorr;
vec3 ridgesD(vec2 xz) {
  vec3 a = vnoised(xz / 5200.0);
  float s2 = 2.0 * a.x - 1.0, r = max(1.0 - abs(s2), 1e-5);
  vec2 dr = -sign(s2) * 2.0 * a.yz / 5200.0;
  float rp = pow(r, 1.6); vec2 drp = 1.6 * pow(r, 0.6) * dr;
  vec3 b = vnoised(xz / 1900.0 + vec2(7.0, 3.0)), c = vnoised(xz / 700.0 + vec2(2.0, 9.0));
  float h = 560.0 + 1250.0 * (rp * 0.6 + b.x * 0.3 + c.x * 0.1);
  vec2 g = 1250.0 * (drp * 0.6 + b.yz * (0.3 / 1900.0) + c.yz * (0.1 / 700.0));
  vec2 A = uCorr.xy, V = uCorr.zw - uCorr.xy; float q = clamp(dot(xz - A, V) / dot(V, V), 0.0, 1.0);
  float v = sst(1800.0, 4600.0, length(xz - A - V * q));
  return vec3(mix(600.0, h, v), g * v);
}
// the model, bicubic, with its gradient (per metre)
vec3 mapHeight(vec2 xz) {
  vec2 g = xz / uMapSize * (uRes - 1.0);
  float out_ = max(max(max(-g.x, g.x - (uRes.x - 1.0)), max(-g.y, g.y - (uRes.y - 1.0))), 0.0) * (uMapSize.x / (uRes.x - 1.0));
  g = clamp(g, vec2(1.0), uRes - 3.0);
  ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  float r[4], rd[4];
  for (int k = 0; k < 4; k++) {
    int y = i.y - 1 + k;
    float p0 = H(i.x - 1, y), p1 = H(i.x, y), p2 = H(i.x + 1, y), p3 = H(i.x + 2, y);
    r[k] = cr(p0, p1, p2, p3, f.x); rd[k] = crd(p0, p1, p2, p3, f.x);
  }
  float span = uHMax - uHMin;
  vec2 cell = uMapSize / (uRes - 1.0);
  vec3 m = vec3(uHMin + cr(r[0], r[1], r[2], r[3], f.y) * span,
                cr(rd[0], rd[1], rd[2], rd[3], f.y) * span / cell.x,
                crd(r[0], r[1], r[2], r[3], f.y) * span / cell.y);
  if (out_ > 0.0) {
    float t = sst(0.0, 2200.0, out_);
    m = mix(m, ridgesD(xz), t);
  }
  return m;
}
// the ground: the model and the detail below its cells, the lake flat (height, d/dx, d/dz)
vec3 groundFrom(vec2 xz, vec3 m) {
  vec3 n1 = vnoised(xz / 240.0 + vec2(3.0, 0.0)), n2 = vnoised(xz / 38.0), n3 = vnoised(xz / 7.0 + vec2(0.0, 11.0)), n4 = vnoised(xz / 1.9 + vec2(5.0, 0.0));
  vec3 d = vec3(6.0 * (n1.x - 0.5) + 2.5 * (n2.x - 0.5) + 0.6 * (n3.x - 0.5) + 0.18 * (n4.x - 0.5),
                6.0 * n1.yz / 240.0 + 2.5 * n2.yz / 38.0 + 0.6 * n3.yz / 7.0 + 0.18 * n4.yz / 1.9);
  float s = sst(uWater, uWater + 10.0, m.x);
  vec3 h = vec3(m.x + d.x * s, m.yz + d.yz * s);
  return h.x <= uWater ? vec3(uWater, 0.0, 0.0) : h;
}
vec3 groundH(vec2 xz) { return groundFrom(xz, mapHeight(xz)); }
vec3 groundLod(vec2 xz, float sp) {
  vec3 m = mapHeight(xz);
  vec3 n1 = vnoised(xz / 240.0 + vec2(3.0, 0.0)), n2 = vnoised(xz / 38.0), n3 = vnoised(xz / 7.0 + vec2(0.0, 11.0)), n4 = vnoised(xz / 1.9 + vec2(5.0, 0.0));
  float a1 = 1.0 - smoothstep(90.0, 260.0, sp), a2 = 1.0 - smoothstep(15.0, 45.0, sp), a3 = 1.0 - smoothstep(3.0, 9.0, sp), a4 = 1.0 - smoothstep(0.8, 2.5, sp);
  vec3 d = vec3(6.0 * (n1.x - 0.5) * a1 + 2.5 * (n2.x - 0.5) * a2 + 0.6 * (n3.x - 0.5) * a3 + 0.18 * (n4.x - 0.5) * a4,
                6.0 * n1.yz / 240.0 * a1 + 2.5 * n2.yz / 38.0 * a2 + 0.6 * n3.yz / 7.0 * a3 + 0.18 * n4.yz / 1.9 * a4);
  float s = sst(uWater, uWater + 10.0, m.x);
  vec3 h = vec3(m.x + d.x * s, m.yz + d.yz * s);
  return h.x <= uWater ? vec3(uWater, 0.0, 0.0) : h;
}
// the mountains' shadows, traced once over the model (1 = in the sun)
float sunVis(vec2 xz) { vec2 uv = xz / uMapSize; return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 1.0 : texture(uSunVis, uv).r; }
`;
const FOREST = /* glsl */`
uniform vec2 uPath[${PATH.length}];
float pathDist(vec2 p) {
  float d = 1e9;
  for (int k = 0; k < ${PATH.length - 1}; k++) { vec2 a = uPath[k], v = uPath[k + 1] - a; float t = clamp(dot(p - a, v) / dot(v, v), 0.0, 1.0); d = min(d, length(p - a - v * t)); }
  return d;
}
float treeline(vec2 p) {
  float outside = max(max(max(-p.x, p.x - uMapSize.x), max(-p.y, p.y - uMapSize.y)), 0.0);
  return 610.0 + 170.0 * sst(0.0, 2200.0, outside) + 60.0 * (vnoise(p / 700.0) - 0.5);
}
float forestAt(vec2 p, float mh) {
  if (mh <= uWater + 1.5) return 0.0;
  float tl = treeline(p);
  float d = sst(tl + 20.0, tl - 60.0, mh) * sst(0.2, 0.42, vnoise(p / 160.0 + vec2(0.0, 9.0)));
  return d * sst(2.4, 5.0, pathDist(p) + 1.5 * (vnoise(p / 9.0) - 0.5));
}
// the tree in cell c, if there is one: its foot, size, picture and turn
bool treeAt(ivec2 c, float cs, int salt, out vec3 foot, out float size, out int variant, out float rot) {
  foot = vec3(0.0); size = 0.0; variant = 0; rot = 0.0;
  ivec2 s = ivec2(salt * 7717, salt * 3571);
  vec2 p = (vec2(c) + 0.1 + 0.8 * vec2(hash2(c * ivec2(3, 7) + ivec2(1, 2) + s), hash2(c * ivec2(5, 11) + ivec2(3, 4) + s))) * cs;
  vec3 m = mapHeight(p);
  if (!(hash2(c + ivec2(7919, 104729) + s) < forestAt(p, m.x) * 0.9)) return false;
  float tl = treeline(p);
  bool birch = hash2(c + ivec2(31, 57) + s) < 0.14 + 0.36 * sst(430.0, 590.0, m.x) + 0.3 * sst(14.0, 3.0, m.x - uWater);
  float vr = hash2(c + ivec2(97, 13) + s), sr = hash2(c + ivec2(211, 89) + s), rr = hash2(c + ivec2(401, 17) + s);
  float up = sst(tl + 10.0, tl - 170.0, m.x);
  variant = birch ? 3 + min(1, int(vr * 2.0)) : min(2, int(vr * 3.0));
  size = birch ? (3.2 + 3.4 * sr) * (0.7 + 0.3 * up) : (9.0 + 7.0 * sr) * (0.5 + 0.5 * up);
  foot = vec3(p.x, groundFrom(p, m).x - 0.15, p.y);
  rot = rr * 6.2831853;
  return true;
}
`;
// the air: haze growing with distance, mist lying low in the valley, both lit by the sun behind them
const AIR = /* glsl */`
uniform vec3 uSunDir, uCamPos;
uniform float uMist;
vec3 skyColor(vec3 d);
vec3 hazeTowards(vec3 wp) { vec3 dir = normalize(wp - uCamPos); float s = pow(max(dot(dir, uSunDir), 0.0), 6.0); return mix(skyColor(normalize(vec3(dir.x, 0.02, dir.z))) * 0.92, vec3(1.9, 1.55, 1.05), s * 0.5); }
vec3 air(vec3 col, vec3 wp) {
  vec3 v = wp - uCamPos; float dist = length(v); vec3 dir = v / max(dist, 1e-3);
  float b = 1.0 / 90.0, base = ${WATER.toFixed(1)};
  float dy = abs(dir.y) < 1e-4 ? 1e-4 : dir.y;
  float mist = uMist * 0.0014 * exp(-(uCamPos.y - base) * b) * (1.0 - exp(-dist * dy * b)) / (dy * b);
  float haze = dist / 26000.0;
  float ext = 1.0 - exp(-(mist + haze));
  float s = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 fogCol = mix(skyColor(normalize(vec3(dir.x, 0.02, dir.z))) * 0.92, vec3(1.9, 1.55, 1.05), s * 0.5);
  return mix(col, fogCol, ext);
}
`;
const SKY = /* glsl */`
vec3 skyColor(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 zen = ${glsl(lin(146, 168, 180))}, hor = ${glsl(lin(228, 223, 208))};
  vec3 c = mix(hor, zen, pow(y, 0.5));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.8, 0.55) * (pow(s, 10.0) * 0.5 + pow(s, 80.0) * 0.9) + vec3(9.0, 7.5, 5.5) * smoothstep(0.99955, 0.99975, s);
  return c;
}
`;
// the picture's alpha says how much of it (not paper) is here: 1 until the ending. Where the trees'
// alpha is their coverage (alpha to coverage) it is also scaled by what is left of them, so they dissolve.
const MASK = '';

// ---------------------------------------------------------------- renderer, camera, targets
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(52, 1, 0.25, 90000);
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: +(params.get('msaa') ?? 4) });

const uniforms = {
  uHeight: { value: null }, uSunVis: { value: null }, uMapSize: { value: new THREE.Vector2(WM, HM) }, uRes: { value: new THREE.Vector2(384, 384) },
  uHMin: { value: HMIN }, uHMax: { value: HMAX }, uWater: { value: WATER },
  uSunDir: { value: SUN }, uCamPos: { value: new THREE.Vector3() }, uMist: { value: 1 },
  uFade: { value: 0 }, uLines: { value: 0 }, uTime: { value: 0 },
  uPath: { value: PATH.map(([x, z]) => new THREE.Vector2(x, z)) },
  uCorr: { value: new THREE.Vector4(...CORR) },
  uNearR: { value: coarse ? 110 : 150 },
  uForest: { value: Object.assign(new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat), { needsUpdate: true }) }, uForestBox: { value: new THREE.Vector4(0, 0, 1, 1) },
};

// ---------------------------------------------------------------- the sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(80000, 48, 24), new THREE.ShaderMaterial({
  uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.999999; }',
  fragmentShader: `${MASK} uniform vec3 uSunDir; uniform float uFade; varying vec3 vDir; ${SKY}
    void main() { gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0 - uFade); }`,
}));
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

// ---------------------------------------------------------------- lights
const sunLight = new THREE.DirectionalLight(new THREE.Color(1.0, 0.84, 0.64), 3.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.35;
const SH = 120;   // metres of shadow map around the camera
Object.assign(sunLight.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 3200 });
scene.add(sunLight, sunLight.target);
const hemi = new THREE.HemisphereLight(lin(165, 185, 205), lin(56, 62, 44), 1.1);
scene.add(hemi);

// four octaves of tiling value noise in one texture (8, 16, 32 and 64 cells across): one fetch, four scales
function noiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  [8, 16, 32, 64].forEach((L, ch) => {
    const v = (i, j) => hash2(((i % L) + L) % L + ch * 1013, ((j % L) + L) % L + ch * 3079);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = x / N * L, fy = y / N * L, i = Math.floor(fx), j = Math.floor(fy), u = smooth(fx - i), w = smooth(fy - j);
      data[(y * N + x) * 4 + ch] = Math.round(255 * mix(mix(v(i, j), v(i + 1, j), u), mix(v(i, j + 1), v(i + 1, j + 1), u), w));
    }
  });
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
uniforms.uNoise = { value: noiseTexture() };
// The photographic maps are loaded only for this renderer. Neutral placeholders keep the
// procedural floor usable if an asset fails; normal/ARM data never passes through an sRGB decode.
uniforms.uFloorColor = { value: uniforms.uNoise.value };
uniforms.uFloorNormal = { value: uniforms.uNoise.value };
uniforms.uFloorARM = { value: uniforms.uNoise.value };
uniforms.uFloorReady = { value: 0 };

// the same additions to every lit material: mountain shadows, light through leaves, the air, the mask
const LIT_FRAG_HEAD = `${MASK}uniform float uFade, uLines, uTime, uTrans, uNearR;\nuniform sampler2D uNoise;\nvarying vec3 vW;\n${NOISE}${LAND}${AIR}${SKY}`;
const LIT_AFTER_LIGHTS = /* glsl */`#include <lights_fragment_begin>
  {
    float tv = sunVis(vW.xz);
    reflectedLight.directDiffuse *= tv; reflectedLight.directSpecular *= tv;
    float back = pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 3.0);
    reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * tv * back * uTrans;
  }`;
const LIT_END = /* glsl */`
  gl_FragColor.rgb = air(gl_FragColor.rgb, vW);`;
// a screen-space dither for the hand-over between trees and their pictures
const DITHER = 'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';

// ---------------------------------------------------------------- the terrain (CDLOD)
const GRID = coarse ? 28 : 40;          // quads per patch side
const LEAF = 16;                        // metres, the finest patch
const LEVELS = 12;                      // up to 16 × 2^12 = 65.5 km
const RANGE = Array.from({ length: LEVELS + 1 }, (_, l) => LEAF * 2 ** l * 2.2);
const ROOT = { x: WM / 2 - LEAF * 2 ** LEVELS / 2, z: HM / 2 - LEAF * 2 ** LEVELS / 2, size: LEAF * 2 ** LEVELS };
const MAXN = 900;
const tGeo = new THREE.InstancedBufferGeometry();
{
  const pos = [], idx = [];
  for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) pos.push(i / GRID, 0, j / GRID);
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) { const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  // A narrow wall below each patch edge closes the sub-pixel gaps between fine and coarse
  // triangles during a morph. The top stays on the surface; only the hidden copy drops down.
  const edge = [];
  for (let i = 0; i < GRID; i++) edge.push([i / GRID, 0]);
  for (let j = 0; j < GRID; j++) edge.push([1, j / GRID]);
  for (let i = GRID; i > 0; i--) edge.push([i / GRID, 1]);
  for (let j = GRID; j > 0; j--) edge.push([0, j / GRID]);
  edge.push(edge[0]);
  const start = pos.length / 3;
  for (const [x, z] of edge) pos.push(x, 0, z, x, -1, z);
  for (let i = 0; i < edge.length - 1; i++) { const a = start + i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  tGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tGeo.setIndex(idx);
  tGeo.setAttribute('aNode', new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4).setUsage(THREE.DynamicDrawUsage));
  tGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
}
const morphU = { value: RANGE.map((r, l) => new THREE.Vector2(l ? mix(RANGE[l - 1], r, 0.62) : r * 0.62, r)) };

const terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
terrainMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, uniforms, { uMorph: morphU, uGrid: { value: GRID }, uTrans: { value: 0 } });
  sh.vertexShader = `attribute vec4 aNode;\nuniform vec2 uMorph[${LEVELS + 1}];\nuniform float uGrid;\nuniform vec3 uCamPos;\nvarying vec3 vW;\nvarying vec2 vGrad;\n${NOISE}${LAND}` + sh.vertexShader
    .replace('#include <beginnormal_vertex>', /* glsl */`
  vec2 gp = position.xz;
  vec2 wxz = aNode.xy + gp * aNode.z;
  int lvl = int(aNode.w + 0.5);
  vec2 mr = uMorph[lvl];
  float mk = clamp((distance(vec3(wxz.x, groundH(wxz).x, wxz.y), uCamPos) - mr.x) / (mr.y - mr.x), 0.0, 1.0);
  wxz -= fract(gp * uGrid * 0.5) * 2.0 / uGrid * aNode.z * mk;
  // Filter detail by world distance, shared across patches. Patch-local spacing made even
  // coincident edge vertices disagree as their individual morph amounts changed.
  float detail = max(${(LEAF / GRID).toFixed(6)}, length(wxz - uCamPos.xz) / (2.2 * uGrid));
  vec3 gh = groundLod(wxz, detail);
  gh.x += min(position.y, 0.0) * max(3.0, aNode.z / uGrid * 2.0);
  vec3 objectNormal = normalize(vec3(-gh.y, 1.0, -gh.z));`)
    .replace('#include <begin_vertex>', 'vec3 transformed = vec3(wxz.x, gh.x, wxz.y); vW = transformed; vGrad = gh.yz;');
  sh.fragmentShader = LIT_FRAG_HEAD + FOREST + `varying vec2 vGrad;
uniform sampler2D uForest, uFloorColor, uFloorNormal, uFloorARM;
uniform vec4 uForestBox;
uniform float uFloorReady;
` + sh.fragmentShader
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
  // what grows here: forest floor below the treeline, autumn heath above, rock where it is steep, snow high up
  float hgt = vW.y, dist = distance(vW, uCamPos);
  vec3 nW = normalize(vec3(-vGrad.x, 1.0, -vGrad.y));
  float slope = 1.0 - nW.y;
  vec4 nA = texture(uNoise, vW.xz / 480.0), nB = texture(uNoise, vW.xz / 56.0), nC = texture(uNoise, vW.xz / 7200.0);
  float n1 = nA.r * 0.6 + nA.g * 0.4;                       // 60 m and 30 m
  float n2 = nB.r * 0.6 + nB.b * 0.4;                       // 7 m and 1.8 m
  float n3 = mix(texture(uNoise, vW.xz / 7.2).b, 0.5, smoothstep(30.0, 120.0, dist));   // 0.9 m, near only
  float mh = hgt;
  float tl = treeline(vW.xz);
  float sl = 960.0 + 140.0 * (nC.r - 0.5);
  vec4 hA = texture(uNoise, vW.xz / 320.0), hB = texture(uNoise, vW.xz / 40.0);   // 40, 20, 10, 5 m and 5 … 0.6 m
  // the forest floor: moss and needles, blueberry turned red, pale reindeer lichen
  vec3 floorC = mix(${glsl(lin(40, 54, 32))}, ${glsl(lin(76, 66, 42))}, smoothstep(0.35, 0.75, n2));
  floorC = mix(floorC, ${glsl(lin(112, 48, 32))}, smoothstep(0.6, 0.8, n1) * 0.55);
  floorC = mix(floorC, ${glsl(lin(150, 150, 128))}, smoothstep(0.72, 0.9, n2) * 0.45);
  // the heath: dwarf birch gone red, crowberry, yellow grass, pale lichen, in patches of every size
  vec3 heath = mix(${glsl(lin(156, 132, 74))}, ${glsl(lin(64, 58, 40))}, smoothstep(0.38, 0.66, hA.g * 0.7 + hB.r * 0.3));
  heath = mix(heath, ${glsl(lin(150, 68, 36))}, smoothstep(0.55, 0.74, hA.b * 0.6 + hB.g * 0.4) * 0.85);
  heath = mix(heath, ${glsl(lin(180, 176, 150))}, smoothstep(0.66, 0.84, hB.b * 0.5 + hA.a * 0.5) * 0.7);
  // bogs in the flat hollows: sedge gone orange, black water between the tussocks
  float flatG = 1.0 - smoothstep(0.015, 0.06, slope);
  float bog = flatG * smoothstep(0.56, 0.7, hA.r) * (1.0 - smoothstep(tl + 80.0, tl + 200.0, hgt));
  heath = mix(heath, mix(${glsl(lin(164, 118, 62))}, ${glsl(lin(34, 40, 38))}, smoothstep(0.6, 0.7, hB.a)), bog);
  float fo = texture(uForest, (vW.xz - uForestBox.xy) / uForestBox.zw).r;
  float woodland = smoothstep(0.02, 0.3, fo + (n1 - 0.5) * 0.12) * (1.0 - smoothstep(tl + 30.0, tl + 90.0, hgt));
  vec3 c = mix(heath, floorC, woodland);
  // under and beyond the trees: the canopy, where the pictures of the trees give out
  c = mix(c, c * 0.55, fo * (1.0 - smoothstep(60.0, 20.0, dist)) * 0.6);
  c = mix(c, ${glsl(lin(20, 34, 26))}, fo * smoothstep(2600.0, 3600.0, dist) * 0.85);
  // rock: steep ground, and outcrops and boulders on the gentle ground too
  float outcrop = smoothstep(0.76, 0.86, hA.a * 0.55 + hA.b * 0.45) * (1.0 - bog);
  vec3 rock = mix(${glsl(lin(104, 104, 98))}, ${glsl(lin(58, 62, 64))}, hB.g) * (0.8 + 0.4 * n3);
  rock = mix(rock, ${glsl(lin(160, 158, 136))}, smoothstep(0.6, 0.8, hB.r) * 0.4);       // lichen on the stone
  c = mix(c, rock, outcrop * 0.85);
  c = mix(c, rock, smoothstep(0.34, 0.52, slope + (n2 - 0.5) * 0.2));
  float snow = smoothstep(sl - 30.0, sl + 50.0, hgt + (n1 - 0.5) * 160.0) * (1.0 - smoothstep(0.45, 0.65, slope));
  c = mix(c, ${glsl(lin(236, 238, 240))}, snow);
  c *= (0.8 + 0.4 * n3) * (0.8 + 0.4 * hB.r);        // small-scale light and dark
  c *= 0.86 + 0.28 * smoothstep(0.2, 0.8, hA.r);       // and in broad patches
  // the trail: packed earth and stones, worn into the floor
  float pd = pathDist(vW.xz) + 0.35 * (nB.g - 0.5);
  float trail = (1.0 - smoothstep(0.55, 0.95, pd)) * (1.0 - smoothstep(4000.0, 6000.0, dist));
  c = mix(c, ${glsl(lin(104, 92, 72))} * (0.75 + 0.5 * n3), trail);
  float wet = step(hgt, uWater + 0.02);
  c = mix(c, ${glsl(lin(34, 46, 50))}, wet);
  // Two differently oriented views of the seamless 2 m litter tile break up its repetition.
  // Modulate the existing biome colour so the near detail fades into the same distant terrain.
  float litter = uFloorReady * (1.0 - smoothstep(24.0, 95.0, dist)) * max(woodland, trail) * (1.0 - wet) * (1.0 - snow) * (1.0 - smoothstep(0.25, 0.45, slope));
  vec3 litterARM = vec3(1.0), litterNormal = vec3(0.0, 0.0, 1.0);
  if (litter > 0.001) {
    vec2 uvA = vW.xz * 0.5, uvB = vec2(-uvA.y, uvA.x) + vec2(0.37, 0.61);
    float tileMix = smoothstep(0.25, 0.75, nB.b);
    vec3 litterColor = mix(texture(uFloorColor, uvA).rgb, texture(uFloorColor, uvB).rgb, tileMix);
    vec3 ratio = clamp(litterColor / vec3(0.339, 0.218, 0.132), vec3(0.35), vec3(2.4));
    c *= mix(vec3(1.0), ratio, litter * 0.75);
    litterARM = mix(texture(uFloorARM, uvA).rgb, texture(uFloorARM, uvB).rgb, tileMix);
    vec3 na = texture(uFloorNormal, uvA).rgb * 2.0 - 1.0;
    vec3 nb = texture(uFloorNormal, uvB).rgb * 2.0 - 1.0;
    // Bring the rotated sample's tangent directions back into world X/Z before blending.
    nb.xy = vec2(nb.y, -nb.x);
    litterNormal = normalize(mix(na, nb, tileMix));
  }
  diffuseColor.rgb = c;`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(mix(1.0, 0.6, snow), 0.06, wet);
  roughnessFactor = mix(roughnessFactor, clamp(litterARM.g, 0.65, 1.0), litter);`)
    .replace('#include <normal_fragment_begin>', /* glsl */`#include <normal_fragment_begin>
  vec3 nWorld = vec3(0.0, 1.0, 0.0);
  if (dist >= 170.0 && wet < 0.5) {
    vec2 u1 = vW.xz / 320.0; float e = 1.0 / 256.0;
    float h0 = texture(uNoise, u1).r, hx = texture(uNoise, u1 + vec2(e, 0.0)).r, hz = texture(uNoise, u1 + vec2(0.0, e)).r;
    vec2 g = vGrad + vec2(hx - h0, hz - h0) / (e * 320.0) * 14.0 * (1.0 - smoothstep(4000.0, 9000.0, dist));
    nWorld = normalize(vec3(-g.x, 1.0, -g.y));
    normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
  }
  if (dist < 170.0 || wet > 0.5) {
    // detail the model cannot hold: small bumps in the light, fading with distance
    vec3 a = vnoised(vW.xz / 2.3), b = vnoised(vW.xz / 0.6 + 7.0);
    vec2 g = vGrad + (a.yz / 2.3 * 0.55 + b.yz / 0.6 * 0.07) * (1.0 - smoothstep(20.0, 160.0, dist)) * (1.0 - wet);
    g += wet * vnoised(vW.xz / 3.0 + uTime * 0.2).yz * 0.03;
    g -= litterNormal.xy / max(litterNormal.z, 0.3) * litter * 0.28;
    nWorld = normalize(vec3(-g.x, 1.0, -g.y));
    normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
  }`)
    .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mix(1.0, 0.55 + 0.45 * litterARM.r, litter);`)
    .replace('#include <fog_fragment>', /* glsl */`
  if (wet > 0.5) {
    vec3 vd = normalize(vW - uCamPos), rd = reflect(vd, nWorld); rd.y = abs(rd.y);
    float fr = 0.02 + 0.98 * pow(1.0 - max(dot(-vd, nWorld), 0.0), 5.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, skyColor(rd) * sunVis(vW.xz * 0.999), fr);
  }
  gl_FragColor.rgb = air(gl_FragColor.rgb, vW);
  {
    // the ending: the colour drains to paper and the land is drawn by its contours every 20 m
    float lv = vW.y / 20.0; float w = fwidth(lv);
    float line = 1.0 - smoothstep(0.0, w * 1.2, min(fract(lv), 1.0 - fract(lv)));
    line *= uLines * (1.0 - smoothstep(12000.0, 20000.0, dist));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, ${glsl(INK)} * 2.0, uFade);
    gl_FragColor.a = mix(1.0, line * 0.5, uFade);
  }`);
};
const terrain = new THREE.Mesh(tGeo, terrainMat);
terrain.frustumCulled = false; terrain.receiveShadow = true;
scene.add(terrain);

// patch selection: bounds sampled once per node and kept (generous: too fine is safe, too coarse cracks)
const nodeArr = tGeo.getAttribute('aNode').array;
let nodeCount = 0;
const bounds = new Map();
function nodeBounds(x, z, size) {
  const k = `${x},${z},${size}`;
  let b = bounds.get(k);
  if (!b) {
    let lo = 1e9, hi = -1e9;
    for (let j = 0; j <= 6; j++) for (let i = 0; i <= 6; i++) { const h = ground(x + size * i / 6, z + size * j / 6); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const m = 6 + Math.min(450, size * 0.06);
    b = [lo - m, hi + m]; bounds.set(k, b);
  }
  return b;
}
function boxDist(x, z, size, c) {
  const [lo, hi] = nodeBounds(x, z, size);
  return Math.hypot(Math.max(x - c.x, 0, c.x - (x + size)), Math.max(lo - c.y, 0, c.y - hi), Math.max(z - c.z, 0, c.z - (z + size)));
}
function selectNode(x, z, size, lvl, c) {
  if (boxDist(x, z, size, c) > RANGE[lvl]) return false;
  const add = (ax, az, s, l) => { if (nodeCount < MAXN) { nodeArr.set([ax, az, s, l], nodeCount * 4); nodeCount++; } };
  if (lvl === 0 || boxDist(x, z, size, c) > RANGE[lvl - 1]) { add(x, z, size, lvl); return true; }
  const hs = size / 2;
  // A child outside the finer range still has a child's physical size. Labelling it with its
  // parent's level gave equal-sized neighbours different morphs and different ground heights.
  for (const [ox, oz] of [[0, 0], [hs, 0], [0, hs], [hs, hs]]) if (!selectNode(x + ox, z + oz, hs, lvl - 1, c)) add(x + ox, z + oz, hs, lvl - 1);
  return true;
}
function updateTerrain(c) {
  nodeCount = 0;
  selectNode(ROOT.x, ROOT.z, ROOT.size, LEVELS, c);
  tGeo.instanceCount = nodeCount;
  tGeo.getAttribute('aNode').needsUpdate = true;
}

// ---------------------------------------------------------------- textures, drawn once
const rng = (seed) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}
// spruce: a branch spray (drooping twigs of short dark needles, paler new growth at the tips) in the
// left 7/8, bark in the right 1/8
function spruceTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#3b332c'; g.fillRect(896, 0, 128, 512);
  for (let i = 0; i < 320; i++) { const k = r(); g.fillStyle = `rgba(${18 + k * 40 | 0},${16 + k * 30 | 0},${14 + k * 24 | 0},${0.35 + r() * 0.45})`; g.fillRect(896 + r() * 128, r() * 512, 1 + r() * 3, 12 + r() * 60); }
  const DARK = ['#16261c', '#1b2e22', '#20352a', '#24392b', '#2a402e'], TIP = ['#3d5a34', '#48663a', '#557340'];
  g.lineCap = 'round';
  const twig = (x, y, a, len, w, depth) => {
    const n = Math.max(6, len / 4 | 0);
    for (let k = 0; k < n; k++) {
      const t = k / n, st = len / n;
      const nx = x + Math.cos(a) * st, ny = y + Math.sin(a) * st;
      g.strokeStyle = '#2a261e'; g.lineWidth = w * (1 - t * 0.6); g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      const nl = (depth ? 10 : 13) * (1 - t * 0.35) * (0.8 + r() * 0.4);
      for (const side of [-1, 1]) for (const off of [0.75, 1.15]) {
        const aa = a + side * (off + r() * 0.25);
        g.strokeStyle = t > 0.74 && r() < 0.8 ? TIP[r() * TIP.length | 0] : DARK[r() * DARK.length | 0];
        g.lineWidth = 1.6 + r() * 0.8;
        g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(aa) * nl, ny + Math.sin(aa) * nl); g.stroke();
      }
      if (!depth && k % 5 === 2 && t > 0.04 && t < 0.93) {
        const sl = 150 * (1 - t * 0.62) * (0.75 + r() * 0.35);
        for (const side of [-1, 1]) twig(nx, ny, a + side * (0.95 + r() * 0.35), sl, 1.6, 1);
      }
      x = nx; y = ny; a += (depth ? 0.018 : 0.004) * (r() - 0.3);
    }
  };
  twig(6, 256, 0, 880, 5, 0);
  return canvasTex(c);
}
// mountain birch: a twig's worth of October leaves (yellow, some orange, a few still green) in the left
// 3/4, white bark with dark lenticels in the right 1/4
function birchTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d'), r = rng(23);
  const bx = 768, bw = 256;
  const bark = g.createLinearGradient(0, 0, 0, 512); bark.addColorStop(0, '#e9e6dc'); bark.addColorStop(0.75, '#ddd8cb'); bark.addColorStop(1, '#8c877c');
  g.fillStyle = bark; g.fillRect(bx, 0, bw, 512);
  for (let i = 0; i < 420; i++) { const y = r() * 512; g.fillStyle = `rgba(30,28,26,${0.35 + r() * 0.5})`; g.fillRect(bx + r() * bw, y, 4 + r() * 22, 1 + r() * 2.2); }
  for (let i = 0; i < 26; i++) { const y = 380 + r() * 132; g.fillStyle = `rgba(20,18,16,${0.4 + r() * 0.4})`; g.fillRect(bx + r() * bw, y, 10 + r() * 40, 6 + r() * 20); }
  const LEAF = ['#c9a23a', '#d6ae45', '#dcb84e', '#b8862e', '#c07a2c', '#a39a3c', '#8d6a2c', '#e0c060'];
  g.lineCap = 'round';
  const stem = (x, y, a, len, depth) => {
    const n = 8, st = len / n;
    for (let k = 0; k < n; k++) {
      const nx = x + Math.cos(a) * st, ny = y + Math.sin(a) * st;
      g.strokeStyle = '#4a3a2c'; g.lineWidth = depth ? 1.4 : 2.6; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      if (depth < 2 && r() < 0.5) stem(nx, ny, a + (r() - 0.5) * 1.6, len * 0.5, depth + 1);
      const cnt = depth ? 2 : 1;
      for (let q = 0; q < cnt; q++) {
        const la = a + (r() - 0.5) * 2.6, ll = 16 + r() * 12, lw = ll * (0.55 + r() * 0.2);
        const cx = nx + Math.cos(la) * ll * 0.6, cy = ny + Math.sin(la) * ll * 0.6;
        g.save(); g.translate(cx, cy); g.rotate(la);
        g.fillStyle = LEAF[r() * LEAF.length | 0];
        g.beginPath(); g.moveTo(-ll / 2, 0); g.quadraticCurveTo(0, -lw / 2, ll / 2, 0); g.quadraticCurveTo(0, lw / 2, -ll / 2, 0); g.fill();
        g.fillStyle = 'rgba(255,240,190,0.18)'; g.beginPath(); g.moveTo(-ll / 2, 0); g.quadraticCurveTo(0, -lw / 2, ll / 2, 0); g.lineTo(-ll / 2, 0); g.fill();
        g.restore();
      }
      x = nx; y = ny; a += (r() - 0.5) * 0.4;
    }
  };
  for (let i = 0; i < 7; i++) stem(384 + (r() - 0.5) * 60, 500, -Math.PI / 2 + (r() - 0.5) * 1.6, 230 + r() * 140, 0);
  return canvasTex(c);
}
const spruceTex = spruceTexture(), birchTex = birchTexture();

const realTextureNames = ['floor-color', 'floor-normal', 'floor-arm'];
const realTextureLoader = new THREE.TextureLoader();
const realTexturesReady = Promise.allSettled(realTextureNames.map((name) =>
  realTextureLoader.loadAsync(new URL(`../textures/real/${name}.webp`, import.meta.url).href)
)).then((results) => {
  const maps = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`Intro texture ${realTextureNames[i]} unavailable; using the procedural fallback.`);
    return null;
  });
  if (maps.slice(0, 3).every(Boolean)) {
    maps.slice(0, 3).forEach((tex, i) => {
      tex.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      tex.needsUpdate = true;
    });
    [uniforms.uFloorColor.value, uniforms.uFloorNormal.value, uniforms.uFloorARM.value] = maps;
    uniforms.uFloorReady.value = 1;
  } else maps.slice(0, 3).forEach((tex) => tex?.dispose());
});

// ---------------------------------------------------------------- the trees' geometry (height 1)
function builder() {
  const P = [], N = [], U = [], C = [], I = [];
  return {
    quad(a, b, c2, d, n, uv, col) {
      const o = P.length / 3;
      for (const [p, nn, t] of [[a, n[0], uv[0]], [b, n[1], uv[1]], [c2, n[2], uv[2]], [d, n[3], uv[3]]]) { P.push(...p); N.push(...nn); U.push(...t); C.push(col, col, col); }
      I.push(o, o + 1, o + 2, o, o + 2, o + 3);
    },
    tube(pts, r0, r1, u0, u1, sides, col) {
      const o = P.length / 3;
      for (let k = 0; k < pts.length; k++) {
        const t = k / (pts.length - 1), rad = mix(r0, r1, t);
        for (let s = 0; s <= sides; s++) {
          const a = s / sides * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
          P.push(pts[k][0] + cx * rad, pts[k][1], pts[k][2] + sz * rad); N.push(cx, 0.15, sz); U.push(mix(u0, u1, s / sides), t); C.push(col, col, col);
        }
      }
      for (let k = 0; k < pts.length - 1; k++) for (let s = 0; s < sides; s++) {
        const a = o + k * (sides + 1) + s, b = a + sides + 1;
        I.push(a, b, a + 1, a + 1, b, b + 1);
      }
    },
    done() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.setIndex(I); g.computeBoundingSphere();
      return g;
    },
  };
}
// a northern spruce: a narrow spire; whorls of branches that droop and shorten towards the top, each
// branch two crossed sprays; normals point out of the crown so it is lit as a volume, not as cards
function spruceGeometry(seed, whorls, widen = 1) {
  const r = rng(seed), b = builder(), R0 = 0.19 + 0.04 * r();
  const leanX = (r() - 0.5) * 0.025, leanZ = (r() - 0.5) * 0.025;
  b.tube([[0, -0.05, 0], [leanX * 0.35, 0.5, leanZ * 0.35], [leanX, 1, leanZ]], 0.014, 0.0007, 0.875, 1, 5, 0.85);
  for (let i = 0; i < whorls; i++) {
    const t = (i + 0.4) / whorls, y = 0.1 + 0.885 * t ** 0.94;
    const R = R0 * (1 - t) ** 0.95 + 0.003;
    const n = 4 + (r() * 2 | 0), a0 = r() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = a0 + k / n * 6.28 + (r() - 0.5) * 0.5, L = R * (0.8 + 0.4 * r());
      const dir = [Math.cos(a), 0, Math.sin(a)], side = [-Math.sin(a), 0, Math.cos(a)];
      const droop = mix(0.4 + 0.25 * r(), -0.35, sstep(0.7, 1, t));
      const cx = leanX * y, cz = leanZ * y, by = y + (r() - 0.5) * Math.min(0.018, R * 0.3);
      const s0 = [cx + dir[0] * 0.008, by, cz + dir[2] * 0.008], s1 = [cx + dir[0] * L, by - L * droop, cz + dir[2] * L];
      const w = L * 0.55 * widen, ao = 0.55 + 0.45 * t ** 0.6 * (0.8 + 0.2 * r());
      for (const tilt of [-0.62, 0.62]) {
        // the spray's plane: turned about the branch by ±35°
        const up = [side[0] * Math.sin(tilt), Math.cos(tilt), side[2] * Math.sin(tilt)];
        const across = [side[0] * Math.cos(tilt) - 0 * up[0], -Math.sin(tilt), side[2] * Math.cos(tilt)];
        const e = (p, s) => [p[0] + across[0] * s, p[1] + across[1] * s, p[2] + across[2] * s];
        const nOut = (p) => { const l = Math.hypot(p[0], p[2]) || 1; const v = [p[0] / l, 0.55, p[2] / l]; const m = Math.hypot(...v); return v.map((q) => q / m); };
        const q0 = e(s0, -w * 0.45), q1 = e(s0, w * 0.45), q2 = e(s1, w * 0.16), q3 = e(s1, -w * 0.16);
        b.quad(q0, q1, q2, q3, [nOut(q0), nOut(q1), nOut(q2), nOut(q3)], [[0, 0], [0, 1], [0.86, 1], [0.86, 0]], ao);
      }
    }
  }
  // The upper whorls converge on the thin leader. Upright rectangles cropped from the branch
  // texture used to leave three bright prongs above every crown, especially in the baked trees.
  return b.done();
}
// a mountain birch: two or three crooked stems from one foot, a few branches, an open crown of leaf sprays
function birchGeometry(seed, cards = 46, grow = 1) {
  const r = rng(seed), b = builder();
  const stems = 2 + (r() * 2 | 0), tops = [];
  for (let k = 0; k < stems; k++) {
    const a = r() * 6.28, lean = 0.08 + r() * 0.12, h = 0.62 + r() * 0.3, pts = [];
    let x = Math.cos(a) * 0.01, z = Math.sin(a) * 0.01;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      pts.push([x, t * h, z]);
      x += Math.cos(a) * lean * 0.2 + (r() - 0.5) * 0.05; z += Math.sin(a) * lean * 0.2 + (r() - 0.5) * 0.05;
    }
    b.tube(pts, 0.026, 0.006, 0.75, 1, 6, 1);
    tops.push(...pts.slice(2));
  }
  const cy = 0.62;
  for (let i = 0; i < cards; i++) {
    const p = tops[r() * tops.length | 0];
    const a = r() * 6.28, rr = 0.05 + r() * 0.24, cx = p[0] + Math.cos(a) * rr, cz = p[2] + Math.sin(a) * rr, y = p[1] + (r() - 0.3) * 0.2;
    const s = (0.12 + r() * 0.09) * grow, fa = r() * 6.28, ux = Math.cos(fa) * s, uz = Math.sin(fa) * s, tilt = (r() - 0.5) * 0.6;
    const o = [cx - cx * 0, y, cz];
    const n = (q) => { const v = [q[0], (q[1] - cy) * 0.8 + 0.25, q[2]]; const m = Math.hypot(...v) || 1; return v.map((w) => w / m); };
    const q0 = [o[0] - ux, o[1] - s + tilt * s, o[2] - uz], q1 = [o[0] + ux, o[1] - s - tilt * s, o[2] + uz], q2 = [o[0] + ux, o[1] + s - tilt * s, o[2] + uz], q3 = [o[0] - ux, o[1] + s + tilt * s, o[2] - uz];
    b.quad(q0, q1, q2, q3, [n(q0), n(q1), n(q2), n(q3)], [[0, 0], [0.74, 0], [0.74, 1], [0, 1]], 0.7 + 0.3 * r());
  }
  return b.done();
}
const WHORLS = coarse ? 18 : 24;
const VARIANTS = [spruceGeometry(3, WHORLS), spruceGeometry(8, WHORLS), spruceGeometry(17, WHORLS), birchGeometry(5), birchGeometry(29)];
// beyond LOD_R the same trees with half the whorls and wider sprays: as full at that distance, half the work
const VARIANTS_LO = [spruceGeometry(3, WHORLS >> 1, 1.4), spruceGeometry(8, WHORLS >> 1, 1.4), spruceGeometry(17, WHORLS >> 1, 1.4), birchGeometry(5, 28, 1.25), birchGeometry(29, 28, 1.25)];
const LOD_R = coarse ? 40 : 55;
const IMP_W = VARIANTS.map((g, v) => { g.computeBoundingBox(); const bb = g.boundingBox; return 2 * Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * 1.04; });

// ---------------------------------------------------------------- near trees: geometry, placed on the CPU
// the alpha every tree pass agrees on: the texture's, with the needles' coverage kept in the smaller
// mipmaps (Golus), and gone beyond the hand-over to the pictures
const TREE_ALPHA = /* glsl */`
  {
    vec2 tx = vMapUv * vec2(1024.0, 512.0); float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
    diffuseColor.a *= (1.0 + mip * 0.28) * (1.0 - uFade);
  }
  { float dd = distance(vW, uCamPos), n = ign(gl_FragCoord.xy); if (dd > uDMax + uWMax * n || dd < uDMin + uWMin * n) discard; }
#include <alphatest_fragment>`;
const TINT = 'vec3 tintAt(vec2 p) { float a = fract(sin(dot(floor(p * 4.0), vec2(12.9898, 78.233))) * 43758.5453), b = fract(a * 7.31); return vec3(0.8 + 0.4 * a) * vec3(1.0 + 0.06 * b, 1.0, 0.94 - 0.04 * b); }\n';
const TREE_VW = (sh) => { sh.vertexShader = TINT + 'varying vec3 vW; varying vec3 vTint;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vTint = tintAt(vec2(instanceMatrix[3][0], instanceMatrix[3][2]));'); };
function band(dMin, wMin, dMax, wMax) { return { uDMin: { value: dMin }, uWMin: { value: wMin }, uDMax: { value: dMax }, uWMax: { value: wMax } }; }
const BAND_HEAD = 'uniform float uDMin, uWMin, uDMax, uWMax;\n';
function treeMaterial(tex, b) {
  const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, b, { uTrans: { value: 0.55 } });
    TREE_VW(sh);
    sh.fragmentShader = 'varying vec3 vTint;\n' + LIT_FRAG_HEAD + DITHER + BAND_HEAD + sh.fragmentShader
      .replace('#include <alphatest_fragment>', 'diffuseColor.rgb *= vTint;\n' + TREE_ALPHA)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
      .replace('#include <fog_fragment>', LIT_END);
  };
  return m;
}
function treeDepthPass(tex, b) {
  const m = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, colorWrite: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, b);
    TREE_VW(sh);
    sh.fragmentShader = `uniform vec3 uCamPos; uniform float uNearR, uFade; varying vec3 vW; varying vec3 vTint;\n${DITHER}${BAND_HEAD}` + sh.fragmentShader.replace('#include <alphatest_fragment>', TREE_ALPHA);
  };
  return m;
}
const NEAR_MAX = coarse ? 1400 : 3200;
// per variant: the close trees (full detail) and the rest of the near ones (half), each with its depth pass
function nearSet(geos, b) {
  const lit = [treeMaterial(spruceTex, b), treeMaterial(birchTex, b)], pre = [treeDepthPass(spruceTex, b), treeDepthPass(birchTex, b)];
  return geos.map((g, v) => {
    const tex = v < 3 ? spruceTex : birchTex;
    const m = new THREE.InstancedMesh(g, lit[v < 3 ? 0 : 1], NEAR_MAX);
    m.customDepthMaterial = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const p = new THREE.InstancedMesh(g, pre[v < 3 ? 0 : 1], NEAR_MAX);
    p.instanceMatrix = m.instanceMatrix; p.frustumCulled = false; p.count = 0; p.renderOrder = -5;
    m.userData.pre = p;
    scene.add(p, m);
    return m;
  });
}
const nearHi = nearSet(VARIANTS, band(-1, 0, LOD_R, 12));
const nearLo = nearSet(VARIANTS_LO, band(LOD_R, 12, uniforms.uNearR.value, 25));
const near = [...nearHi, ...nearLo];
// the trees of a 40 m tile, kept once computed
const TILE = 8, tiles = new Map();
function tileTrees(ti, tj) {
  const k = ti * 100003 + tj;
  let list = tiles.get(k);
  if (!list) {
    list = [];
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) { const t = treeAt(ti * TILE + i, tj * TILE + j); if (t) list.push(t); }
    tiles.set(k, list);
  }
  return list;
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const FR = new THREE.Frustum(), PV = new THREE.Matrix4(), SPH = new THREE.Sphere();
let nearKey = '', nearList = [];
// every frame: of the trees near enough, those in view (with a margin, for shadows cast into it)
function updateNear(c) {
  const R = uniforms.uNearR.value + 30, ts = TILE * CELL;
  const t0 = Math.floor((c.x - R) / ts), t1 = Math.floor((c.x + R) / ts), u0 = Math.floor((c.z - R) / ts), u1 = Math.floor((c.z + R) / ts);
  const key = `${t0},${t1},${u0},${u1}`;
  if (key !== nearKey) {
    nearKey = key; nearList = [];
    for (let tj = u0; tj <= u1; tj++) for (let ti = t0; ti <= t1; ti++) for (const t of tileTrees(ti, tj)) {
      if (!t.m) { M4.compose(V.set(t.x, t.y, t.z), Q.setFromAxisAngle(UP, t.rot), SC.set(t.s, t.s, t.s)); t.m = M4.toArray(new Float32Array(16)); }
      nearList.push(t);
    }
  }
  FR.setFromProjectionMatrix(PV.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const hi = nearHi.map(() => 0), lo = nearLo.map(() => 0);
  for (const t of nearList) {
    const d = Math.hypot(t.x - c.x, t.y + t.s * 0.4 - c.y, t.z - c.z);
    if (d > R) continue;
    SPH.center.set(t.x, t.y + t.s * 0.5, t.z); SPH.radius = t.s * 0.6 + 14;
    if (!FR.intersectsSphere(SPH)) continue;
    if (d < LOD_R + 16 && hi[t.v] < NEAR_MAX) nearHi[t.v].instanceMatrix.array.set(t.m, 16 * hi[t.v]++);   // both in the hand-over band
    if (d > LOD_R - 6 && lo[t.v] < NEAR_MAX) nearLo[t.v].instanceMatrix.array.set(t.m, 16 * lo[t.v]++);
  }
  nearHi.forEach((m, v) => { m.count = m.userData.pre.count = hi[v]; m.instanceMatrix.needsUpdate = true; });
  nearLo.forEach((m, v) => { m.count = m.userData.pre.count = lo[v]; m.instanceMatrix.needsUpdate = true; });
}

// ---------------------------------------------------------------- far trees: their pictures, scattered by the GPU
// Each variant is photographed once from the side (colour and normals) into an atlas; the pictures are
// lit like the trees themselves, so the hand-over at uNearR does not show.
const ATLAS_W = 256, ATLAS_H = 512;
const bakeRT = new THREE.WebGLRenderTarget(ATLAS_W * VARIANTS.length, ATLAS_H, { count: 2, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
function bake() {
  const s = new THREE.Scene(), c = new THREE.OrthographicCamera(-0.5, 0.5, 1.02, 0, -2, 2);
  const mats = [spruceTex, birchTex].map((tex) => new THREE.ShaderMaterial({
    uniforms: { map: { value: tex } }, side: THREE.DoubleSide,
    vertexShader: 'attribute vec3 color; varying vec2 vUv; varying vec3 vN; varying vec3 vC; void main() { vUv = uv; vN = normal; vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `layout(location = 1) out highp vec4 gNormal; uniform sampler2D map; varying vec2 vUv; varying vec3 vN; varying vec3 vC;
      void main() { vec4 t = texture(map, vUv); if (t.a < 0.5) discard; gl_FragColor = vec4(pow(t.rgb * vC, vec3(1.0 / 2.2)), 1.0); gNormal = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }`,
  }));
  // the textures are sRGB: sample them as linear here, then store gamma-encoded for 8 bits
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(bakeRT);
  renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.autoClear = false;
  VARIANTS.forEach((g, v) => {
    const mesh = new THREE.Mesh(g, mats[v < 3 ? 0 : 1]);
    s.add(mesh);
    const w = IMP_W[v] / 2;
    c.left = -w; c.right = w; c.updateProjectionMatrix();
    bakeRT.viewport.set(v * ATLAS_W, 0, ATLAS_W, ATLAS_H);
    renderer.setRenderTarget(bakeRT);
    renderer.render(s, c);
    s.remove(mesh);
  });
  bakeRT.viewport.set(0, 0, bakeRT.width, bakeRT.height);
  renderer.autoClear = true;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(0x000000, 1);
}
// the worker: the placement rule's own source, sent over as text, run over every cell near the flight
function placeFar(t) {
  const fns = [['clamp', clamp], ['smooth', smooth], ['sstep', sstep], ['mix', mix], ['hash2', hash2], ['ridges', ridges], ['cr', cr],
    ['treeline', treeline], ['birchShare', birchShare], ['corridor', corridor]].map(([n, f]) => `const ${n} = ${f};`).join('\n');
  const decl = [noise, mapHeight, groundFrom, distToPath, forestAt, treeAt].map(String).join('\n');
  const src = `const WM = ${WM}, HM = ${HM}, HMIN = ${HMIN}, HMAX = ${HMAX}, WATER = ${WATER}, CELL = ${CELL};
const PATH = ${JSON.stringify(PATH)};
const CORR = ${JSON.stringify(CORR)};
let T = null;
${fns}
${decl}
onmessage = ({ data }) => {
  T = data.T;
  const tr = data.track;
  {
    const F = data.forest, out = new Uint8Array(F.n * F.m);
    for (let j = 0; j < F.m; j++) for (let i = 0; i < F.n; i++) {
      const x = F.x0 + (i + 0.5) * F.cell, z = F.z0 + (j + 0.5) * F.cell;
      out[j * F.n + i] = Math.round(255 * forestAt(x, z, mapHeight(x, z)));
    }
    postMessage({ forest: out }, [out.buffer]);
  }
  const dTrack = (x, z) => { let d = 1e9; for (let k = 0; k < tr.length - 1; k++) { const a = tr[k], b = tr[k + 1], vx = b[0] - a[0], vz = b[1] - a[1]; const q = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / (vx * vx + vz * vz)); d = Math.min(d, Math.hypot(x - a[0] - vx * q, z - a[1] - vz * q)); } return d; };
  const xs = tr.map((p) => p[0]), zs = tr.map((p) => p[1]);
  const out = data.rings.map(({ cell, salt, reach, scale, tile }) => {
    const tiles = new Map();
    const i0 = Math.floor((Math.min(...xs) - reach) / cell), i1 = Math.ceil((Math.max(...xs) + reach) / cell);
    const j0 = Math.floor((Math.min(...zs) - reach) / cell), j1 = Math.ceil((Math.max(...zs) + reach) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (dTrack((i + 0.5) * cell, (j + 0.5) * cell) > reach) continue;
      const t = treeAt(i, j, cell, salt);
      if (!t) continue;
      const k = Math.floor(t.x / tile) + ',' + Math.floor(t.z / tile);
      let b = tiles.get(k); if (!b) tiles.set(k, b = []);
      b.push(t.x, t.y, t.z, t.s * scale, t.v);
    }
    return [...tiles].map(([k, b]) => { const [i, j] = k.split(',').map(Number); return { x: (i + 0.5) * tile, z: (j + 0.5) * tile, data: new Float32Array(b) }; });
  });
  postMessage({ far: out }, out.flat().map((q) => q.data.buffer));
};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  // where the camera goes, from the start of the flight to its end
  const track = [along(S0)];
  for (let s = S0 + 200; s < LEN * 1.1; s += 200) track.push(along(s));
  track.push(along(LEN * 1.1));
  // The density texture covers the whole view to the mountain, even beyond the last tree ring.
  // Fine tree placement stays around the actual flight; the distant ring fills the approach.
  const forestTrack = [...track, along(LEN * 1.1 + HERO.dist)];
  const xs = forestTrack.map((q) => q[0]), zs = forestTrack.map((q) => q[1]), cell = 20;
  const F = { cell, x0: Math.min(...xs) - 5000, z0: Math.min(...zs) - 5000 };
  F.n = Math.ceil((Math.max(...xs) + 5000 - F.x0) / cell); F.m = Math.ceil((Math.max(...zs) + 5000 - F.z0) / cell);
  return new Promise((res) => {
    w.onmessage = ({ data }) => {
      if (data.forest) {
        const tex = new THREE.DataTexture(data.forest, F.n, F.m, THREE.RedFormat, THREE.UnsignedByteType);
        tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
        uniforms.uForest.value = tex; uniforms.uForestBox.value.set(F.x0, F.z0, F.n * cell, F.m * cell);
        drawn = -1; request();
        return;
      }
      res(data.far); w.terminate(); URL.revokeObjectURL(url);
    };
    w.postMessage({ T: { w: t.w, h: t.h, data: t.data }, track, forest: F, rings: RINGS.map(({ cell, salt, reach, scale, tile }) => ({ cell, salt, reach, scale, tile })) });
  });
}
const R0 = coarse ? 520 : 780;
const RINGS = [
  { cell: CELL, salt: 0, scale: 1.0, reach: R0 + 120, tile: 1000, rIn: uniforms.uNearR.value, wIn: 25, rOut: R0, wOut: 100 },
  { cell: CELL * 2, salt: 1, scale: 1.15, reach: coarse ? 1900 : 3700, tile: 2000, rIn: R0, wIn: 100, rOut: coarse ? 1600 : 3300, wOut: 400 },
  { cell: CELL * 5, salt: 2, scale: 1.25, reach: 10900, tile: 2000, rIn: coarse ? 1600 : 3300, wIn: 400, rOut: 9500, wOut: 1200 },
];
function ringMesh(data, ring, tx, tz, tile) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const ib = new THREE.InstancedInterleavedBuffer(data, 5);
  g.setAttribute('aFoot', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  g.setAttribute('aSize', new THREE.InterleavedBufferAttribute(ib, 1, 3));
  g.setAttribute('aVariant', new THREE.InterleavedBufferAttribute(ib, 1, 4));
  g.instanceCount = data.length / 5;
  let y = 0; for (let i = 1; i < data.length; i += 5) y += data[i];
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(tx, y / (data.length / 5), tz), tile * 0.72 + 60);
  const u = { uRIn: { value: ring.rIn }, uWIn: { value: ring.wIn }, uROut: { value: ring.rOut }, uWOut: { value: ring.wOut } };
  const m = new THREE.MeshLambertMaterial({ map: bakeRT.textures[0], alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, u, { uTrans: { value: 0.55 }, uNormals: { value: bakeRT.textures[1] }, uImpW: { value: IMP_W } });
    sh.vertexShader = `attribute vec3 aFoot; attribute float aSize, aVariant;
uniform vec3 uCamPos; uniform float uRIn, uROut, uWOut; uniform float uImpW[${VARIANTS.length}];
varying vec3 vW; varying vec3 vRight; varying vec3 vFwd; varying vec3 vTint;\n${TINT}` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', /* glsl */`
  int variant = int(aVariant + 0.5);
  float dcam = distance(aFoot + vec3(0.0, aSize * 0.4, 0.0), uCamPos);
  bool reject = dcam < uRIn - 30.0 || dcam > uROut + uWOut + 30.0;
  vec3 toCam = uCamPos - aFoot; vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + 1e-5); vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  vRight = right; vFwd = fwd; vTint = tintAt(aFoot.xz);
  vec3 objectNormal = fwd;`)
      .replace('#include <begin_vertex>', /* glsl */`
  vec3 transformed = aFoot + right * position.x * uImpW[variant] * aSize + vec3(0.0, position.y * 1.02 * aSize, 0.0);
  vW = transformed;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  vMapUv = vec2((float(variant) + uv.x) / ${VARIANTS.length}.0, uv.y);
  if (reject) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    sh.fragmentShader = `uniform sampler2D uNormals; uniform float uRIn, uWIn, uROut, uWOut; varying vec3 vRight; varying vec3 vFwd; varying vec3 vTint;\n` + LIT_FRAG_HEAD + DITHER + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`
  vec4 tc = texture(map, vMapUv);
  diffuseColor.rgb *= pow(tc.rgb, vec3(2.2)) * vTint; diffuseColor.a = tc.a;`)
      .replace('#include <alphatest_fragment>', /* glsl */`
  {
    vec2 tx = vMapUv * vec2(${ATLAS_W * VARIANTS.length}.0, ${ATLAS_H}.0); float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
    diffuseColor.a *= (1.0 + mip * 0.3) * (1.0 - uFade);
    float dd = distance(vW, uCamPos), n = ign(gl_FragCoord.xy);
    if (dd < uRIn + uWIn * n || dd > uROut + uWOut * n) discard;
  }
#include <alphatest_fragment>`)
      .replace('#include <normal_fragment_begin>', /* glsl */`
  float faceDirection = 1.0;
  vec3 bn = texture(uNormals, vMapUv).xyz * 2.0 - 1.0;
  vec3 nW = normalize(vRight * bn.x + vec3(0.0, bn.y, 0.0) + vFwd * bn.z);
  vec3 normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); vec3 nonPerturbedNormal = normal;`)
      .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
      .replace('#include <fog_fragment>', LIT_END);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.userData = { x: tx, z: tz, r: tile * 0.72 + 30, ring };
  return mesh;
}
const rings = [];
// a tile is drawn only if some of it lies within its ring's distances
function updateRings(c) {
  for (const m of rings) {
    const { x, z, r, ring } = m.userData, d = Math.hypot(x - c.x, z - c.z);
    m.visible = !HIDE.includes('rings') && d + r > ring.rIn - 40 && d - r < ring.rOut + ring.wOut + 40 + Math.max(0, c.y - 1500);
  }
}


// ---------------------------------------------------------------- the group on the trail
// Six members walking in, dressed as in intro.js: big packs with a mat strapped under, daypacks, poles,
// hats. Built from simple solids (a rounded box is a squashed superellipsoid), one mesh each; the legs
// and arms swing about their hips and shoulders in the vertex shader, so the shadows walk too.
const HK = [
  { jacket: [150, 62, 44], pack: [44, 52, 50], pad: [217, 142, 60], big: true, hat: [214, 204, 184], pom: true, poles: true },
  { jacket: [48, 64, 86], pack: [217, 142, 60], pad: [62, 98, 104], big: true, hat: [52, 56, 58] },
  { jacket: [184, 142, 64], pack: [40, 58, 48], big: false, hair: [150, 116, 70], tail: true, poles: true },
  { jacket: [72, 88, 64], pack: [98, 68, 48], pad: [62, 98, 104], big: true, hat: [150, 62, 44], pom: true },
  { jacket: [116, 44, 50], pack: [217, 142, 60], pad: [44, 52, 50], big: true, hat: [214, 204, 184], poles: true },
  { jacket: [58, 62, 64], pack: [56, 74, 92], big: false, hat: [217, 142, 60], pom: true },
].map((h, i) => ({ ...h, s: 201 + i * 4.4 + (i % 2) * 0.9, off: [-0.28, 0.38, -0.36, 0.3, -0.22, 0.4][i], step: i * 1.7 }));
const cLin = (a) => lin(a[0], a[1], a[2]);
function roundBox(w, h, d, e = 0.28) {
  const g = new THREE.SphereGeometry(1, 16, 12), a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const f = (v) => Math.sign(v) * Math.abs(v) ** e;
    a.setXYZ(i, f(a.getX(i)) * w / 2, f(a.getY(i)) * h / 2, f(a.getZ(i)) * d / 2);
  }
  g.computeVertexNormals();
  return g;
}
function hikerGeometry(h) {
  const P = [], N = [], C = [], A = [], V3 = [];
  const add = (geo, m, col, part = 0, pivot = [0, 0, 0]) => {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
    const pa = g.attributes.position, na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) { P.push(pa.getX(i), pa.getY(i), pa.getZ(i)); N.push(na.getX(i), na.getY(i), na.getZ(i)); C.push(col.r, col.g, col.b); A.push(part); V3.push(...pivot); }
  };
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const S = (x, y, z) => new THREE.Matrix4().makeScale(x, y, z);
  const R = (x, y, z) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z));
  const cyl = (rb, rt, len, seg = 8) => new THREE.CylinderGeometry(rt, rb, len, seg, 1);
  const jacket = cLin(h.jacket), jShade = cLin(h.jacket.map((v) => v * 0.8)), pants = lin(34, 38, 38), boot = lin(40, 32, 26), glove = lin(36, 38, 38);
  const pack = cLin(h.pack), packD = cLin(h.pack.map((v) => v * 0.72)), hair = cLin(h.hair || [52, 40, 32]), skin = lin(196, 150, 120);
  for (const side of [-1, 1]) {
    const leg = side < 0 ? 1 : 2, hip = [side * 0.1, 0.9, 0];
    add(cyl(0.058, 0.078, 0.84), T(side * 0.1, 0.48, 0), pants, leg, hip);
    add(roundBox(0.12, 0.12, 0.27), T(side * 0.1, 0.06, 0.035), boot, leg, hip);
    const arm = side < 0 ? 3 : 4, sh = [side * 0.235, 1.42, 0];
    add(cyl(0.048, 0.064, 0.56), T(side * 0.235, 1.14, 0).multiply(R(0, 0, side * -0.06)), jShade, arm, sh);
    add(new THREE.SphereGeometry(0.047, 8, 6), T(side * 0.25, 0.84, 0.01), glove, arm, sh);
    if (h.poles) add(cyl(0.01, 0.012, 1.2), T(side * 0.27, 0.3, -0.05).multiply(R(-0.2, 0, side * -0.06)), lin(150, 150, 146), arm, sh);
  }
  add(cyl(0.17, 0.205, 0.58, 12), T(0, 1.19, 0).multiply(S(1, 1, 0.7)), jacket);
  add(new THREE.SphereGeometry(0.205, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), T(0, 1.47, 0).multiply(S(1, 0.42, 0.7)), jacket);
  add(cyl(0.05, 0.05, 0.1), T(0, 1.52, 0), skin);
  add(new THREE.SphereGeometry(0.108, 14, 10), T(0, 1.64, 0).multiply(S(0.95, 1.05, 1)), hair);
  if (h.tail) add(new THREE.SphereGeometry(0.05, 8, 6), T(0, 1.56, -0.11).multiply(S(0.8, 1.6, 0.8)), hair);
  if (h.hat) {
    const hat = cLin(h.hat);
    add(new THREE.SphereGeometry(0.116, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), T(0, 1.655, 0).multiply(S(1, 1.08, 1.02)), hat);
    add(cyl(0.118, 0.118, 0.045, 14), T(0, 1.625, 0), cLin(h.hat.map((v) => v * 0.85)));
    if (h.pom) add(new THREE.SphereGeometry(0.045, 8, 6), T(0, 1.8, 0), hat);
  }
  // the pack, on the back (the camera sees it: −z, the hiker walks towards +z)
  const pw = h.big ? 0.4 : 0.32, ph = h.big ? 0.66 : 0.44, pd = h.big ? 0.26 : 0.18, py = h.big ? 1.2 : 1.24;
  add(roundBox(pw, ph, pd), T(0, py, -0.2 - pd / 2 + 0.06), pack);
  add(roundBox(pw * 1.04, ph * 0.26, pd * 1.08), T(0, py + ph * 0.42, -0.2 - pd / 2 + 0.06), packD);             // the lid
  add(roundBox(pw * 0.62, ph * 0.36, pd * 0.4), T(0, py - ph * 0.2, -0.2 - pd + 0.04), packD);                 // front pocket
  if (h.big) {
    add(roundBox(0.42, 0.07, 0.3), T(0, 0.93, -0.06), packD);                                                   // hip belt
    if (h.pad) add(cyl(0.075, 0.075, 0.6, 12), T(0, py - ph / 2 - 0.06, -0.2 - pd / 2 + 0.06).multiply(R(0, 0, Math.PI / 2)), cLin(h.pad));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 1));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(V3, 3));
  g.computeBoundingSphere();
  return g;
}
// the stride: legs and arms swing about their pivots, opposite each other; the body rises a little
const WALK = /* glsl */`
attribute float aPart; attribute vec3 aPivot;
uniform float uPhase;
mat3 swingOf() {
  float sw = sin(uPhase);
  float a = aPart < 0.5 ? 0.0 : aPart < 1.5 ? 0.42 * sw : aPart < 2.5 ? -0.42 * sw : aPart < 3.5 ? -0.3 * sw : 0.3 * sw;
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}
`;
const WALK_POS = 'vec3 transformed = swingOf() * (position - aPivot) + aPivot; transformed.y += 0.03 * abs(cos(uPhase));';
function hikerMesh(h) {
  const u = { uPhase: { value: 0 } };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, u, { uTrans: { value: 0.0 } });
    sh.vertexShader = WALK + 'varying vec3 vW;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = swingOf() * normal;')
      .replace('#include <begin_vertex>', WALK_POS)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = LIT_FRAG_HEAD + sh.fragmentShader
      .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS + `
  { // the low sun ahead lights their edges
    float rim = pow(1.0 - max(dot(normal, geometryViewDir), 0.0), 3.0) * max(dot(-geometryViewDir, directLight.direction), 0.0);
    reflectedLight.directDiffuse += directLight.color * rim * 0.35 * sunVis(vW.xz);
  }`)
      .replace('#include <fog_fragment>', LIT_END + '\n  gl_FragColor.a = 1.0 - uFade;');
  };
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = WALK + sh.vertexShader.replace('#include <begin_vertex>', WALK_POS);
  };
  const mesh = new THREE.Mesh(hikerGeometry(h), m);
  mesh.customDepthMaterial = d; mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { h, u };
  scene.add(mesh);
  return mesh;
}
const hikers = HK.map(hikerMesh);
function updateHikers(p) {
  const show = p < 0.14;
  const walked = 0.8 * (camS(Math.min(p, 0.035)) - S0) + 60 * p;
  for (const mesh of hikers) {
    mesh.visible = show;
    if (!show) continue;
    const { h, u } = mesh.userData;
    const sh = h.s + walked, c = along(sh), c2 = along(sh + 2);
    const dx = c2[0] - c[0], dz = c2[1] - c[1], dl = Math.hypot(dx, dz) || 1;
    const x = c[0] - dz / dl * h.off, z = c[1] + dx / dl * h.off;
    mesh.position.set(x, ground(x, z), z);
    mesh.rotation.y = Math.atan2(dx, dz);
    u.uPhase.value = sh * (Math.PI * 2 / 1.5) + h.step;
  }
}

// ---------------------------------------------------------------- the mountain that is the mark
// At the end of the valley, beyond it, a twin peak whose outline from the flight's end is the club's
// mark exactly: the small peak, the big one, the slanted ravine between them and the snow couloir
// that is the mark's cleft. Each of the mark's shapes is filled with a grid; the outline stays in the
// plane that faces the camera, and the inside comes forward by its distance from the outline, so the
// faces meet in ridges like a roof's (a straight skeleton), lit by the low sun, snow on the tops.
const MARK_L = [[74, 84], [116, 168], [32, 168]];
const MARK_R = [[134, 30], [203, 168], [129, 168], [97, 104]];
const MARK_K = [[115, 98], [137, 98], [163, 150], [141, 150]];
const BACK = [[62, 168], [92, 110], [108, 100], [126, 112], [156, 168]];   // not part of the mark: gone before it forms
const HERO = { dist: 9200, width: 7400, base: 700, rise: 1500 };
const HERO_AT = (() => {
  const c = along(LEN * 1.1 + HERO.dist), a = PATH[PATH.length - 2], b = PATH[PATH.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const f = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  return { c, f, r: [-f[1], f[0]] };
})();
// the rock is ragged along the outline, and straightens as it becomes the mark
const rough = (mx, my) => (my < 167 ? (noise(mx * 0.31, my * 0.29) - 0.5) * 2 * 3.2 : 0);
function markToWorld(mx, my, w, out = new THREE.Vector3()) {
  const u = (mx - 117.5) / 171 * HERO.width, y = HERO.base + (168 - my) / 138 * HERO.rise;
  return out.set(HERO_AT.c[0] + HERO_AT.r[0] * u + HERO_AT.f[0] * w, y, HERO_AT.c[1] + HERO_AT.r[1] * u + HERO_AT.f[1] * w);
}
const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
function edgeDist(x, y, poly, skipBase) {
  let d = 1e9, q = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (skipBase && a[1] === 168 && b[1] === 168) continue;
    const vx = b[0] - a[0], vy = b[1] - a[1], t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy));
    const px = a[0] + vx * t, py = a[1] + vy * t, dd = Math.hypot(x - px, y - py);
    if (dd < d) { d = dd; q = [px, py]; }
  }
  return [d, q];
}
function heroGeometry() {
  const P = [], C = [], rock = lin(88, 94, 100), rockD = lin(60, 66, 72), snow = lin(236, 238, 240), W = new THREE.Vector3();
  const step = coarse ? 2.4 : 1.4;
  for (const poly of [MARK_L, MARK_R, BACK]) {
    const back = poly === BACK;
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const x0 = Math.min(...xs) - step, x1 = Math.max(...xs) + step, y0 = Math.min(...ys) - step, y1 = 168 + 24;
    const nx = Math.ceil((x1 - x0) / step), ny = Math.ceil((y1 - y0) / step);
    const vert = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      let x = x0 + i * step, y = y0 + j * step;
      const below = y > 168;                                    // the skirt that sinks into the land
      const yy = Math.min(y, 168);
      const inside = inPoly(x, yy, poly) || (below && inPoly(x, 167.9, poly));
      let d = 0;
      if (!inside) { const [, q] = edgeDist(x, yy, poly, false); x = q[0]; y = below ? y : q[1]; }
      else d = edgeDist(x, yy, poly, true)[0];
      const edge = !inside;
      const ry = edge ? rough(x, y) : 0;
      const n = noise(x * 0.35 + 7, y * 0.35) - 0.5, n2 = noise(x * 1.3, y * 1.3 + 3) - 0.5;
      let w = -Math.min(d, 60) * (back ? 14 : 24) - (edge ? 0 : n * 90 + n2 * 30) + (back ? 1500 : 0);
      const couloir = poly === MARK_R && inPoly(x, y, MARK_K);
      if (couloir) w += 70;
      markToWorld(x, y + ry + (edge ? 0 : n2 * 1.2), w, W);
      const top = 1 - (y - 30) / 138;
      const snowy = couloir || top + n * 0.35 + n2 * 0.1 > (back ? 0.5 : 0.62);
      const c = snowy ? snow : (n2 > 0.12 ? rockD : rock);
      vert.push({ p: W.toArray(), c, ok: inside || edge });
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      const q = [vert[a], vert[b], vert[c], vert[d]];
      if (!q.some((v, k) => { const x = x0 + ((k & 1) ? i + 1 : i) * step, y = y0 + (k > 1 ? j + 1 : j) * step; return inPoly(x, Math.min(y, 167.9), poly); })) continue;
      for (const k of [a, c, b, b, c, d]) { P.push(...vert[k].p); C.push(vert[k].c.r, vert[k].c.g, vert[k].c.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
const heroMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
heroMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, uniforms, { uTrans: { value: 0 } });
  sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = LIT_FRAG_HEAD + sh.fragmentShader
    .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
    .replace('#include <fog_fragment>', LIT_END + '\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeTowards(vW), uHeroOut); gl_FragColor.a = 1.0 - uFade;');
  sh.fragmentShader = 'uniform float uHeroOut;\n' + sh.fragmentShader;
};
uniforms.uHeroOut = { value: 0 };
let hero = null;

// ---------------------------------------------------------------- the mark, drawn over the picture at the end
// When the colour drains, a flat copy of the mountain's outline takes over at the same pixels (the
// outline lies in the plane that faces the camera, projected through the same camera), then moves and
// straightens onto the mark of the title card beneath, where the page's own logo appears over it.
const ov = document.createElement('canvas');
ov.className = 'intro-overlay'; ov.setAttribute('aria-hidden', 'true');
Object.assign(ov.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
canvas.after(ov);
const og = ov.getContext('2d');
const lockupEl = section.querySelector('.intro-end-lockup');
const lockupRect = () => lockupEl?.getBoundingClientRect() ?? null;
document.fonts?.ready.then(() => { drawn = -1; request(); });
function outline(poly, n) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    for (let i = 0; i < n; i++) out.push([mix(a[0], b[0], i / n), mix(a[1], b[1], i / n)]);
  }
  return out;
}
const OUT_L = outline(MARK_L, 24), OUT_R = outline(MARK_R, 24), OUT_K = outline(MARK_K, 10);
const PV3 = new THREE.Vector3(), FWD = new THREE.Vector3();
let ovDrawn = false;
function drawMark(p) {
  // gone once the page's logo (which fades in over 0.955–0.99) is there
  const show = sstep(0.835, 0.875, p) * (1 - sstep(0.96, 0.985, p)), morph = sstep(0.86, 0.96, p);
  const w = Math.round(W * DPR), h = Math.round(H * DPR);
  if (ov.width !== w || ov.height !== h) { ov.width = w; ov.height = h; ovDrawn = true; }
  if (show <= 0) { if (ovDrawn) { og.clearRect(0, 0, ov.width, ov.height); ovDrawn = false; } return; }
  ovDrawn = true;
  og.setTransform(DPR, 0, 0, DPR, 0, 0);
  og.clearRect(0, 0, W, H);
  const lk = lockupRect(), sr = stage.getBoundingClientRect();
  const target = (mx, my) => lk ? [lk.left - sr.left + (89 + (mx - 32) * 0.90058) * lk.width / 332, lk.top - sr.top + (26 + (my - 30) * 0.90058) * lk.height / 242.9] : [W / 2, H / 2];
  const pt = (mx, my) => {
    markToWorld(mx, my + rough(mx, my) * (1 - morph), 0, PV3).project(cam);
    const t = target(mx, my);
    return [mix((PV3.x + 1) / 2 * W, t[0], morph), mix((1 - PV3.y) / 2 * H, t[1], morph)];
  };
  const path = (list) => { const q = new Path2D(); list.forEach(([mx, my], i) => { const [x, y] = pt(mx, my); i ? q.lineTo(x, y) : q.moveTo(x, y); }); q.closePath(); return q; };
  const hz = [176, 180, 178], ink = [29, 29, 27], pap = [244, 242, 238], sn = [208, 211, 209];
  const col = (a, b, t, al = 1) => `rgba(${mix(a[0], b[0], t) | 0},${mix(a[1], b[1], t) | 0},${mix(a[2], b[2], t) | 0},${al})`;
  const [, yTop] = pt(134, 30), [, yBase] = pt(134, 168);
  const gr = og.createLinearGradient(0, yTop, 0, yBase);
  gr.addColorStop(0, col(sn, ink, morph, show)); gr.addColorStop(0.36, col(sn, ink, morph, show));
  gr.addColorStop(0.44, col(hz, ink, morph, show)); gr.addColorStop(1, col(hz, ink, morph, show));
  og.fillStyle = gr;
  og.fill(path(OUT_L)); og.fill(path(OUT_R));
  og.fillStyle = col(sn, pap, morph, show);
  og.fill(path(OUT_K));
}


// ---------------------------------------------------------------- the forest floor near the camera
// Tufts of autumn grass, blueberry and lingonberry turned red, heather, brown bracken: crossed cards
// scattered by the GPU in a window around the camera (the same hash, so they stay put), off the trail
// and out of the water, lit through from behind by the low sun. Only while the camera is low.
function coverTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'), r = rng(41);
  g.lineCap = 'round';
  // 0: grass
  for (let i = 0; i < 90; i++) {
    const x0 = 128 + (r() - 0.5) * 70, len = 90 + r() * 140, lean = (r() - 0.5) * 1.4;
    g.strokeStyle = ['#8a7a4a', '#7a6a3e', '#9a8a54', '#6a6a44', '#a08a50', '#5a5a3a', '#74704a'][r() * 7 | 0]; g.lineWidth = 1.4 + r() * 1.8;
    g.beginPath(); g.moveTo(x0, 256); g.quadraticCurveTo(x0 + lean * len * 0.3, 256 - len * 0.6, x0 + lean * len * 0.7, 256 - len); g.stroke();
  }
  // 1: blueberry and lingonberry
  const leaf = (x, y, a, l, col) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, l, l * 0.55, 0, 0, 7); g.fill(); g.restore(); };
  for (let i = 0; i < 14; i++) {
    let x = 384 + (r() - 0.5) * 120, y = 256, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    for (let k = 0; k < 8; k++) {
      const nx = x + Math.cos(a) * 16, ny = y + Math.sin(a) * 16;
      g.strokeStyle = '#4a3326'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      for (const sd of [-1, 1]) leaf(nx, ny, a + sd * 1.1, 7 + r() * 4, ['#a8402a', '#c05a2c', '#8a3024', '#b87a30', '#6a7a36', '#d06a34'][r() * 6 | 0]);
      x = nx; y = ny; a += (r() - 0.5) * 0.6;
    }
  }
  // 2: heather
  for (let i = 0; i < 40; i++) {
    let x = 640 + (r() - 0.5) * 110, y = 256, a = -Math.PI / 2 + (r() - 0.5) * 1.0;
    for (let k = 0; k < 9; k++) {
      const nx = x + Math.cos(a) * 12, ny = y + Math.sin(a) * 12;
      g.strokeStyle = ['#5a3a36', '#6a4640', '#7a5048', '#4a4034'][r() * 4 | 0]; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      g.fillStyle = ['#8a5a66', '#7a4a52', '#9a6a60', '#6a5a44'][r() * 4 | 0]; g.fillRect(nx - 2, ny - 2, 4, 4);
      x = nx; y = ny; a += (r() - 0.5) * 0.5;
    }
  }
  // 3: bracken, gone brown
  for (let i = 0; i < 7; i++) {
    let x = 896 + (r() - 0.5) * 60, y = 256, a = -Math.PI / 2 + (r() - 0.5) * 1.3;
    const col = ['#9a6a34', '#b07a3a', '#8a5a2c', '#c08a44'][r() * 4 | 0];
    for (let k = 0; k < 12; k++) {
      const nx = x + Math.cos(a) * 15, ny = y + Math.sin(a) * 15, t = k / 12;
      g.strokeStyle = col; g.lineWidth = 2.4; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      if (k > 2) for (const sd of [-1, 1]) { const pa = a + sd * 1.3, pl = 34 * (1 - t) + 6; g.lineWidth = 3; g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(pa) * pl, ny + Math.sin(pa) * pl + 6); g.stroke(); }
      x = nx; y = ny; a += 0.09 * Math.sign(Math.cos(a) + 0.001);
    }
  }
  return canvasTex(c);
}
const COVER_N = coarse ? 100 : 160, COVER_CELL = 0.55, COVER_R = COVER_N * COVER_CELL / 2 - 2;
const coverU = { uOrigin: { value: new THREE.Vector2() } };
const coverGeo = new THREE.InstancedBufferGeometry();
{
  const P = [], U = [], N = [], I = [];
  for (const a of [0, Math.PI / 2]) {
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5, o = P.length / 3;
    P.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz); U.push(0, 0, 1, 0, 1, 1, 0, 1); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  coverGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  coverGeo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  coverGeo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  coverGeo.setIndex(I);
  coverGeo.instanceCount = COVER_N * COVER_N;
  coverGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
}
const coverMat = new THREE.MeshLambertMaterial({ map: coverTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
coverMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, uniforms, coverU, { uTrans: { value: 0.4 } });
  sh.vertexShader = `uniform vec3 uCamPos; uniform vec2 uOrigin; uniform sampler2D uForest; uniform vec4 uForestBox; varying vec3 vW; varying float vKeep;\n${NOISE}${LAND}${FOREST}` + sh.vertexShader
    .replace('#include <beginnormal_vertex>', /* glsl */`
  ivec2 cid = ivec2(floor(uOrigin / ${COVER_CELL.toFixed(2)})) + ivec2(gl_InstanceID % ${COVER_N}, gl_InstanceID / ${COVER_N});
  vec2 pc = (vec2(cid) + vec2(hash2(cid * 3 + ivec2(11, 5)), hash2(cid * 7 + ivec2(2, 19)))) * ${COVER_CELL.toFixed(2)};
  vec3 m = mapHeight(pc);
  float fo = texture(uForest, (pc - uForestBox.xy) / uForestBox.zw).r, pd = pathDist(pc);
  float kindR = hash2(cid + ivec2(71, 3));
  float kind = fo > 0.3 ? (kindR < 0.55 ? 1.0 : kindR < 0.8 ? 3.0 : 0.0) : (kindR < 0.5 ? 0.0 : kindR < 0.8 ? 2.0 : 1.0);
  float d = distance(vec3(pc.x, m.x, pc.y), uCamPos);
  float chance = hash2(cid + ivec2(5, 311));
  float clump = smoothstep(0.28, 0.72, vnoise(pc / 3.2 + vec2(4.0, 1.0))) * 0.85 + 0.15;
  vKeep = (m.x > uWater + 1.0 && pd > 0.7 + 0.4 * chance && chance < 0.85 * clump * (1.0 - smoothstep(${(COVER_R * 0.5).toFixed(1)}, ${COVER_R.toFixed(1)}, d))) ? 1.0 : 0.0;
  float sz = (kind == 0.0 ? 0.42 : kind == 1.0 ? 0.3 : kind == 2.0 ? 0.28 : 0.66) * (0.5 + 0.9 * hash2(cid + ivec2(13, 97))) * (0.55 + 0.45 * clump);
  float ang = hash2(cid + ivec2(301, 7)) * 6.2831853;
  vec3 objectNormal = vec3(0.0, 1.0, 0.0);`)
    .replace('#include <begin_vertex>', /* glsl */`
  float ca = cos(ang), sa = sin(ang);
  vec3 lp = vec3(ca * position.x - sa * position.z, position.y, sa * position.x + ca * position.z) * vec3(sz * 1.3, sz, sz * 1.3);
  vec3 transformed = vec3(pc.x, groundFrom(pc, m).x - 0.03, pc.y) + lp;
  vW = transformed;`)
    .replace('#include <fog_vertex>', `#include <fog_vertex>
  vMapUv = vec2((kind + uv.x) * 0.25, uv.y);
  if (vKeep < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
  sh.fragmentShader = LIT_FRAG_HEAD + sh.fragmentShader
    .replace('#include <alphatest_fragment>', 'diffuseColor.a *= 1.0 - uFade;\n  diffuseColor.rgb *= mix(0.42, 1.0, smoothstep(0.0, 0.65, vMapUv.y));\n#include <alphatest_fragment>')
    .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
    .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
    .replace('#include <fog_fragment>', LIT_END);
};
const cover = new THREE.Mesh(coverGeo, coverMat);
cover.frustumCulled = false; cover.receiveShadow = true;
scene.add(cover);
function updateCover(c, f) {
  cover.visible = f.y - ground(f.x, f.z) < 40 && !HIDE.includes('cover');
  const half = COVER_N * COVER_CELL / 2;
  coverU.uOrigin.value.set(Math.floor((c.x - half) / COVER_CELL) * COVER_CELL, Math.floor((c.z - half) / COVER_CELL) * COVER_CELL);
}


// ---------------------------------------------------------------- geese
// Nine of them in a skein, crossing ahead of the camera from right to left while it rises over the
// forest; each a body and two wings that beat (in the vertex shader), dark against the bright sky.
const goose = new THREE.BufferGeometry();
goose.setAttribute('position', new THREE.Float32BufferAttribute([
  0, 0, 0.7, -0.12, 0, -0.5, 0.12, 0, -0.5,            // the body
  -0.1, 0, 0.25, -1.6, 0, -0.1, -0.1, 0, -0.25,         // the wings
  0.1, 0, 0.25, 0.1, 0, -0.25, 1.6, 0, -0.1,
], 3));
goose.computeVertexNormals();
const geeseMat = new THREE.MeshLambertMaterial({ color: lin(40, 40, 38), side: THREE.DoubleSide });
const flapU = { uFlap: { value: 0 } };
geeseMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, uniforms, flapU, { uTrans: { value: 0 } });
  sh.vertexShader = 'uniform float uFlap; varying vec3 vW;\n' + sh.vertexShader
    .replace('#include <begin_vertex>', 'vec3 transformed = position; transformed.y += sin(uFlap + float(gl_InstanceID) * 0.9) * 0.55 * max(abs(position.x) - 0.1, 0.0);')
    .replace('#include <project_vertex>', '#include <project_vertex>\n  vW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = LIT_FRAG_HEAD + sh.fragmentShader.replace('#include <fog_fragment>', LIT_END + '\n  gl_FragColor.a = 1.0 - uFade;');
};
const geese = new THREE.InstancedMesh(goose, geeseMat, 9);
geese.frustumCulled = false;
scene.add(geese);
function updateGeese(p, f) {
  const t = sstep(0.1, 0.52, p);
  geese.visible = t > 0 && t < 1;
  if (!geese.visible) return;
  const rx = -f.hz, rz = f.hx;                          // the camera's right, on the ground
  const c = along(camS(p) + 320), side = mix(260, -300, t);
  const cx = c[0] + rx * side, cz = c[1] + rz * side, cy = f.y + 70 + 20 * t;
  const yaw = Math.atan2(-rx, -rz);                     // flying to the left
  for (let i = 0; i < 9; i++) {
    const k = Math.ceil(i / 2), sgn = i % 2 ? 1 : -1;   // the V: one at the front, the others behind on either side
    const bx = cx - (-rx) * k * 6 + (-rz) * sgn * k * 5, bz = cz - (-rz) * k * 6 - (-rx) * sgn * k * 5;
    M4.compose(V.set(bx, cy - k * 0.8, bz), Q.setFromAxisAngle(UP, yaw), SC.set(2.2, 2.2, 2.2));
    geese.setMatrixAt(i, M4);
  }
  geese.instanceMatrix.needsUpdate = true;
  flapU.uFlap.value = p * 900;
}

// ---------------------------------------------------------------- the mountains' shadows
function traceSunVis(t) {
  const n = 192, out = new Uint8Array(n * n), s = t.w / n;
  const dx = SUN.x, dz = SUN.z, l = Math.hypot(dx, dz), tanE = SUN.y / l;
  const hAt = (gx, gz) => { gx = clamp(gx, 0, t.w - 1.001); gz = clamp(gz, 0, t.h - 1.001); const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * t.w + i; return mix(mix(t.data[k], t.data[k + 1], fx), mix(t.data[k + t.w], t.data[k + t.w + 1], fx), fz); };
  const span = HMAX - HMIN, cell = WM / (t.w - 1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const gx = (i + 0.5) * s, gz = (j + 0.5) * s, h0 = hAt(gx, gz) * span;
    let best = -1;
    for (let k = 1; k < 170; k++) {
      const st = k * 1.3, x = gx + dx / l * st, z = gz + dz / l * st;
      if (x < 0 || z < 0 || x > t.w - 1 || z > t.h - 1) break;
      best = Math.max(best, (hAt(x, z) * span - h0) / (st * cell));
    }
    out[j * n + i] = Math.round(255 * (1 - sstep(tanE - 0.045, tanE + 0.02, best)));
  }
  const tex = new THREE.DataTexture(out, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- the final picture
// tone mapping (ACES), a quiet grade (cool shadows, a matte floor like the photographs), grain,
// and the paper coming through where the mask says so
const post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tScene: { value: rt.texture }, uFade: uniforms.uFade, uTime: uniforms.uTime, uExposure: { value: 1.0 }, uShaft: { value: 0 }, tShaft: { value: null } },
  depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tScene, tShaft; uniform float uTime, uExposure, uFade, uShaft; varying vec2 vUv;
    vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec4 sc = texture2D(tScene, vUv); vec3 s = sc.rgb; float m = uFade > 0.0 ? sc.a : 1.0;
      if (uShaft > 0.001) s += texture2D(tShaft, vUv).rgb * uShaft;
      vec3 c = aces(s * uExposure);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 0.92);
      c += vec3(-0.006, 0.0, 0.012) * (1.0 - l) * (1.0 - l);
      c = 0.02 + c * 0.97;
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.3;
      vec3 srgb = toSRGB(c) + (h12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.012;
      gl_FragColor = vec4(mix(vec3(0.9569, 0.949, 0.9333), srgb, clamp(m, 0.0, 1.0)), 1.0);
    }`,
}));
const postScene = new THREE.Scene(); postScene.add(post);
// light shafts: the brightest sky (around the sun), smeared towards the sun, at a quarter of the size
const shaftRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
post.material.uniforms.tShaft.value = shaftRT.texture;
const shaftQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tScene: { value: rt.texture }, uSunUV: { value: new THREE.Vector2() } },
  depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tScene; uniform vec2 uSunUV; varying vec2 vUv;
    float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec2 d = (uSunUV - vUv) / 28.0, uv = vUv + d * h12(gl_FragCoord.xy); float w = 1.0, acc = 0.0;
      for (int i = 0; i < 28; i++) {
        uv += d;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        acc += max(dot(texture2D(tScene, uv).rgb, vec3(0.3, 0.5, 0.2)) - 1.6, 0.0) * w * inside; w *= 0.93;
      }
      gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * acc / 28.0, 1.0);
    }`,
}));
const shaftScene = new THREE.Scene(); shaftScene.add(shaftQuad);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---------------------------------------------------------------- size
let W = 0, H = 0, DPR = 1, quality = +(params.get('q') || 1);
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.1 : 1.3, Math.sqrt(2.4e6 / (w * h))) * quality;
  if (w === W && h === H && dpr === DPR) return false;
  W = w; H = h; DPR = dpr;
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
  rt.setSize(Math.round(W * DPR), Math.round(H * DPR));
  shaftRT.setSize(Math.max(1, Math.round(W * DPR / 4)), Math.max(1, Math.round(H * DPR / 4)));
  const base = (coarse && W < H ? 62 : 52) * Math.PI / 180;
  const t = Math.tan(base / 2) / (W < H ? 0.8 : 1);
  cam.fov = 2 * Math.atan(t) * 180 / Math.PI; cam.aspect = W / H; cam.updateProjectionMatrix();
  return true;
}

// ---------------------------------------------------------------- the frame
const gpuT = params.has('gputime') ? (() => {
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pending = [], done = (window.__gpu = []);
  return {
    begin() { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); pending.push(q); },
    end() {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) done.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    },
  };
})() : null;
function render(p) {
  gpuT?.begin();
  try { renderFrame(p); } finally { gpuT?.end(); }
}
function renderFrame(p) {
  const f = flight(p);
  cam.position.set(f.x, f.y, f.z);
  cam.near = clamp((f.y - ground(f.x, f.z)) * 0.02 + 0.2, 0.2, 12); cam.far = 90000; cam.updateProjectionMatrix();
  const cp = Math.cos(f.pitch);
  cam.lookAt(f.x + f.hx * cp * 100, f.y + Math.sin(f.pitch) * 100, f.z + f.hz * cp * 100);
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  uniforms.uCamPos.value.copy(cam.position);
  sky.position.copy(cam.position);
  // the shadow box: around the camera and ahead of it, snapped to its texels so the shadows do not crawl
  const texel = (SH * 2) / sunLight.shadow.mapSize.x;
  const ax = Math.round((f.x + f.hx * SH * 0.5) / texel) * texel, az = Math.round((f.z + f.hz * SH * 0.5) / texel) * texel;
  sunLight.target.position.set(ax, ground(ax, az), az);
  sunLight.position.copy(sunLight.target.position).addScaledVector(SUN, 1600);
  sunLight.target.updateMatrixWorld();
  uniforms.uFade.value = sstep(0.83, 0.96, p);
  uniforms.uLines.value = sstep(0.8, 0.9, p) * (1 - sstep(0.92, 0.955, p));
  uniforms.uMist.value = 1 - 0.6 * sstep(0.7, 0.9, p);
  updateTerrain(cam.position);
  updateHikers(p);
  updateCover(cam.position, f);
  updateGeese(p, f);
  if (hero) hero.visible = p > 0.3;
  uniforms.uHeroOut.value = sstep(0.835, 0.875, p);
  post.material.uniforms.uExposure.value = 1.0 + 0.4 * (1 - sstep(0.04, 0.3, p));
  {
    PV3.copy(cam.position).addScaledVector(SUN, 20000).project(cam);
    const facing = cam.getWorldDirection(FWD).dot(SUN) > 0.05;
    shaftQuad.material.uniforms.uSunUV.value.set((PV3.x + 1) / 2, (PV3.y + 1) / 2);
    const off = Math.max(Math.abs(PV3.x), Math.abs(PV3.y));
    post.material.uniforms.uShaft.value = facing && !HIDE.includes('shafts') ? 0.22 * (1 - sstep(0.16, 0.4, p)) * (1 - sstep(1.1, 1.6, off)) : 0;
  }
  updateNear(cam.position);
  updateRings(cam.position);
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  if (post.material.uniforms.uShaft.value > 0.001) { renderer.setRenderTarget(shaftRT); renderer.render(shaftScene, postCam); }
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
  drawMark(p);
}

// ---------------------------------------------------------------- captions and the title (as intro.js)
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

// ---------------------------------------------------------------- the loop (as intro.js)
let pShown = 0, target = 0, last = performance.now(), running = false, visible = true, drawn = -1, ready = false, lastRender = 0, slow = 0, fast = 0;
function scrollProgress() {
  const span = (section.offsetHeight - innerHeight) * 0.96;
  return span > 0 ? clamp(-section.getBoundingClientRect().top / span) : 0;
}
function jump(y) { scrollTo({ top: y, behavior: 'instant' }); target = pShown = scrollProgress(); drawn = -1; request(); }
let ended = false;
function state() {
  const end = !visible || target > 0.97;
  if (end !== ended) {
    ended = end;
    root.classList.toggle('intro-complete', end);
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
  const resized = resize();
  if (ready && (resized || Math.abs(pShown - drawn) > 1e-5)) {
    const t0 = performance.now();
    if (DEBUG_P == null && !params.has('q')) {
      const iv = now - lastRender; lastRender = now;
      if (iv < 120) {
        if (iv > 22) { slow++; fast = 0; } else if (iv < 15.5) { fast++; slow = Math.max(0, slow - 1); }
        if (slow > 6 && quality > 0.6) { quality = Math.max(0.6, quality * 0.88); slow = 0; }
        if (fast > 120 && quality < 1) { quality = Math.min(1, quality * 1.06); fast = 0; }
      }
    }
    uniforms.uTime.value = now / 1000;
    render(pShown);
    overlay(pShown);
    drawn = pShown;
    window.__intro = { p: pShown, ms: performance.now() - t0, bake: 0, nodes: nodeCount, near: near.map((m) => m.count) };
  }
  if (Math.abs(target - pShown) > 1e-5) request();
}
function request() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }

// for the tuning scripts: render p and wait for the GPU; ?hide=terrain,near,rings,sky leaves parts out
window.__introBench = (p) => {
  terrain.visible = !HIDE.includes('terrain'); sky.visible = !HIDE.includes('sky');
  near.forEach((m) => { m.visible = m.userData.pre.visible = !HIDE.includes('near'); }); 
  sunLight.castShadow = !HIDE.includes('shadow');
  const t0 = performance.now(); render(p); const t1 = performance.now();
  const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return { cpu: t1 - t0, total: performance.now() - t0 };
};
window.__introBench.raw = (p) => render(p);
window.__introBench.sync = () => { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
root.classList.add('has-webgl');
target = pShown = DEBUG_P ?? scrollProgress();
state();
overlay(pShown);
window.__intro = { p: pShown, ms: 0, bake: 'loading' };
Promise.all([HC.terrain(canvas.dataset.src), realTexturesReady]).then(([t]) => {
  T = t;
  const tex = new THREE.DataTexture(t.data, t.w, t.h, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  uniforms.uHeight.value = tex; uniforms.uRes.value.set(t.w, t.h);
  uniforms.uSunVis.value = traceSunVis(t);
  hero = new THREE.Mesh(heroGeometry(), heroMat); hero.frustumCulled = false; scene.add(hero);
  const t0 = performance.now();
  placeFar(t).then((bufs) => {
    bufs.forEach((tiles, i) => tiles.forEach(({ x, z, data }) => { const m = ringMesh(data, RINGS[i], x, z, RINGS[i].tile); rings.push(m); scene.add(m); }));
    window.__introFar = { ms: Math.round(performance.now() - t0), n: bufs.map((t) => t.reduce((a, q) => a + q.data.length / 5, 0)), tiles: rings.length };
    drawn = -1; request();
  });
  resize();
  bake();
  ready = true; drawn = -1; request();
});
addEventListener('scroll', request, { passive: true });
addEventListener('resize', () => { drawn = -1; request(); });
new IntersectionObserver(([e]) => { visible = e.isIntersecting; state(); if (visible) request(); }).observe(section);
section.querySelector('.intro-skip')?.addEventListener('click', (e) => { e.preventDefault(); jump(endY()); section.querySelector('.intro-end')?.focus?.({ preventScroll: true }); });
section.querySelector('.intro-end-replay')?.addEventListener('click', (e) => { e.preventDefault(); jump(0); });
request();
