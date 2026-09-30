// An experiment, loaded only with ?scene=real: the opening flight up the Abisko valley rendered in 3D,
// with light, shadow and air instead of cut paper. Same path, timing, captions and ending as intro.js
// (which stays the default and is untouched); delete this file and vendor/three.min.js to remove it.
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
const ridges = (x, z) => 620 + 760 * (noise(x / 3100, z / 3100) * 0.65 + noise(x / 1300 + 7, z / 1300 + 3) * 0.35);
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
const treeline = (x, z) => 610 + 60 * (noise(x / 700, z / 700) - 0.5);
function forestAt(x, z, mh) {
  if (mh <= WATER + 1.5) return 0;
  const tl = treeline(x, z);
  let d = sstep(tl + 20, tl - 60, mh) * sstep(0.2, 0.42, noise(x / 160, z / 160 + 9));
  d *= sstep(2.4, 5, distToPath(x, z) + 1.5 * (noise(x / 9, z / 9) - 0.5));   // the trail keeps its clearing
  return d;
}
const birchShare = (mh) => 0.14 + 0.36 * sstep(430, 590, mh) + 0.3 * sstep(14, 3, mh - WATER);
function treeAt(i, j) {
  const x = (i + 0.1 + 0.8 * hash2(i * 3 + 1, j * 7 + 2)) * CELL, z = (j + 0.1 + 0.8 * hash2(i * 5 + 3, j * 11 + 4)) * CELL;
  const mh = mapHeight(x, z);
  if (!(hash2(i + 7919, j + 104729) < forestAt(x, z, mh) * 0.9)) return null;
  const tl = treeline(x, z), birch = hash2(i + 31, j + 57) < birchShare(mh);
  const vr = hash2(i + 97, j + 13), sr = hash2(i + 211, j + 89), rr = hash2(i + 401, j + 17);
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
    vec3 a = vnoised(xz / 3100.0), b = vnoised(xz / 1300.0 + vec2(7.0, 3.0));
    vec3 rg = vec3(620.0 + 760.0 * (a.x * 0.65 + b.x * 0.35), 760.0 * (a.yz * 0.65 / 3100.0 + b.yz * 0.35 / 1300.0));
    m = mix(m, rg, t);
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
float treeline(vec2 p) { return 610.0 + 60.0 * (vnoise(p / 700.0) - 0.5); }
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
// the second target: how much of the picture (not paper) is here
const MASK = 'layout(location = 1) out highp vec4 gMask;\n';

// ---------------------------------------------------------------- renderer, camera, targets
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(52, 1, 0.25, 90000);
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4, count: 2 });

const uniforms = {
  uHeight: { value: null }, uSunVis: { value: null }, uMapSize: { value: new THREE.Vector2(WM, HM) }, uRes: { value: new THREE.Vector2(384, 384) },
  uHMin: { value: HMIN }, uHMax: { value: HMAX }, uWater: { value: WATER },
  uSunDir: { value: SUN }, uCamPos: { value: new THREE.Vector3() }, uMist: { value: 1 },
  uFade: { value: 0 }, uLines: { value: 0 }, uTime: { value: 0 },
  uPath: { value: PATH.map(([x, z]) => new THREE.Vector2(x, z)) },
  uNearR: { value: coarse ? 110 : 150 },
};

// ---------------------------------------------------------------- the sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(80000, 48, 24), new THREE.ShaderMaterial({
  uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
  vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.999999; }',
  fragmentShader: `${MASK} uniform vec3 uSunDir; uniform float uFade; varying vec3 vDir; ${SKY}
    void main() { gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); gMask = vec4(1.0 - uFade); }`,
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

// the same additions to every lit material: mountain shadows, light through leaves, the air, the mask
const LIT_FRAG_HEAD = `${MASK}uniform float uFade, uLines, uTime, uTrans, uNearR;\nvarying vec3 vW;\n${NOISE}${LAND}${AIR}${SKY}`;
const LIT_AFTER_LIGHTS = /* glsl */`#include <lights_fragment_begin>
  {
    float tv = sunVis(vW.xz);
    reflectedLight.directDiffuse *= tv; reflectedLight.directSpecular *= tv;
    float back = pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 3.0);
    reflectedLight.directDiffuse += diffuseColor.rgb * directLight.color * tv * back * uTrans;
  }`;
const LIT_END = /* glsl */`
  gl_FragColor.rgb = air(gl_FragColor.rgb, vW);
  gMask = vec4(1.0 - uFade);`;
// a screen-space dither for the hand-over between trees and their pictures
const DITHER = 'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }\n';

// ---------------------------------------------------------------- the terrain (CDLOD)
const GRID = coarse ? 32 : 48;          // quads per patch side
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
  vec3 gh = groundH(wxz);
  vec3 objectNormal = normalize(vec3(-gh.y, 1.0, -gh.z));`)
    .replace('#include <begin_vertex>', 'vec3 transformed = vec3(wxz.x, gh.x, wxz.y); vW = transformed; vGrad = gh.yz;');
  sh.fragmentShader = LIT_FRAG_HEAD + FOREST + 'varying vec2 vGrad;\n' + sh.fragmentShader
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
  // what grows here: forest floor below the treeline, autumn heath above, rock where it is steep, snow high up
  float hgt = vW.y, dist = distance(vW, uCamPos);
  vec3 nW = normalize(vec3(-vGrad.x, 1.0, -vGrad.y));
  float slope = 1.0 - nW.y;
  float n1 = vnoise(vW.xz / 60.0) * 0.6 + vnoise(vW.xz / 23.0) * 0.4;
  float n2 = vnoise(vW.xz / 7.0 + 3.1) * 0.6 + vnoise(vW.xz / 2.6) * 0.4;
  float n3 = vnoise(vW.xz / 0.9) * (1.0 - smoothstep(30.0, 120.0, dist)) + 0.5 * smoothstep(30.0, 120.0, dist);
  float mh = mapHeight(vW.xz).x;
  float tl = treeline(vW.xz);
  float sl = 960.0 + 140.0 * (vnoise(vW.xz / 900.0 + vec2(5.0, 0.0)) - 0.5);
  vec3 floorC = mix(${glsl(lin(40, 54, 32))}, ${glsl(lin(74, 70, 40))}, smoothstep(0.35, 0.75, n2));
  floorC = mix(floorC, ${glsl(lin(104, 52, 34))}, smoothstep(0.6, 0.8, n1) * 0.55);          // blueberry turned red
  floorC = mix(floorC, ${glsl(lin(150, 150, 128))}, smoothstep(0.72, 0.9, n2) * 0.45);        // reindeer lichen
  vec3 heath = mix(${glsl(lin(140, 118, 64))}, ${glsl(lin(112, 72, 42))}, smoothstep(0.3, 0.7, n2));
  heath = mix(heath, ${glsl(lin(168, 164, 142))}, smoothstep(0.64, 0.8, n1) * 0.55);         // lichen
  vec3 rock = mix(${glsl(lin(96, 98, 96))}, ${glsl(lin(58, 62, 64))}, n2) * (0.8 + 0.4 * n3);
  vec3 c = mix(floorC, heath, smoothstep(tl - 40.0, tl + 60.0, hgt + (n1 - 0.5) * 80.0));
  // under and beyond the trees: the canopy, where the pictures of the trees give out
  float fo = forestAt(vW.xz, mh);
  c = mix(c, c * 0.55, fo * (1.0 - smoothstep(60.0, 20.0, dist)) * 0.6);
  c = mix(c, ${glsl(lin(20, 34, 26))}, fo * smoothstep(2600.0, 3600.0, dist) * 0.85);
  c = mix(c, rock, smoothstep(0.34, 0.52, slope + (n2 - 0.5) * 0.2));
  float snow = smoothstep(sl - 30.0, sl + 50.0, hgt + (n1 - 0.5) * 160.0) * (1.0 - smoothstep(0.45, 0.65, slope));
  c = mix(c, ${glsl(lin(236, 238, 240))}, snow);
  c *= 0.82 + 0.36 * n3;
  // the trail: packed earth and stones, worn into the floor
  float pd = pathDist(vW.xz) + 0.35 * (vnoise(vW.xz / 4.0) - 0.5);
  float trail = (1.0 - smoothstep(0.55, 0.95, pd)) * (1.0 - smoothstep(4000.0, 6000.0, dist));
  c = mix(c, ${glsl(lin(104, 92, 72))} * (0.75 + 0.5 * n3), trail);
  float wet = step(hgt, uWater + 0.02);
  c = mix(c, ${glsl(lin(34, 46, 50))}, wet);
  diffuseColor.rgb = c;`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(mix(0.95, 0.5, snow), 0.06, wet);`)
    .replace('#include <normal_fragment_begin>', /* glsl */`#include <normal_fragment_begin>
  {
    // detail the model cannot hold: small bumps in the light, fading with distance
    vec3 a = vnoised(vW.xz / 2.3), b = vnoised(vW.xz / 0.6 + 7.0);
    vec2 g = vGrad + (a.yz / 2.3 * 0.55 + b.yz / 0.6 * 0.07) * (1.0 - smoothstep(20.0, 160.0, dist)) * (1.0 - wet);
    g += wet * vnoised(vW.xz / 3.0 + uTime * 0.2).yz * 0.03;
    normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1.0, -g.y)), 0.0)).xyz);
  }`)
    .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
    .replace('#include <fog_fragment>', /* glsl */`
  gl_FragColor.rgb = air(gl_FragColor.rgb, vW);
  {
    // the ending: the colour drains to paper and the land is drawn by its contours every 20 m
    float lv = vW.y / 20.0; float w = fwidth(lv);
    float line = 1.0 - smoothstep(0.0, w * 1.2, min(fract(lv), 1.0 - fract(lv)));
    line *= uLines * (1.0 - smoothstep(12000.0, 20000.0, dist));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, ${glsl(INK)} * 2.0, uFade);
    gMask = vec4(mix(1.0, line * 0.5, uFade));
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
  for (const [ox, oz] of [[0, 0], [hs, 0], [0, hs], [hs, hs]]) if (!selectNode(x + ox, z + oz, hs, lvl - 1, c)) add(x + ox, z + oz, hs, lvl);
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
function spruceGeometry(seed, whorls) {
  const r = rng(seed), b = builder(), R0 = 0.19 + 0.04 * r();
  b.tube([[0, -0.05, 0], [0, 0.5, 0], [0, 0.97, 0]], 0.014, 0.002, 0.875, 1, 5, 0.85);
  for (let i = 0; i < whorls; i++) {
    const t = i / whorls, y = 0.1 + 0.88 * t ** 0.92;
    const R = R0 * (1 - (y - 0.1) / 0.9) ** 0.8 + 0.012;
    const n = 4 + (r() * 2 | 0), a0 = r() * 6.28;
    for (let k = 0; k < n; k++) {
      const a = a0 + k / n * 6.28 + (r() - 0.5) * 0.5, L = R * (0.8 + 0.4 * r());
      const dir = [Math.cos(a), 0, Math.sin(a)], side = [-Math.sin(a), 0, Math.cos(a)];
      const droop = 0.3 + 0.25 * r() + 0.2 * (1 - t);
      const s0 = [dir[0] * 0.01, y, dir[2] * 0.01], s1 = [dir[0] * L, y - L * droop, dir[2] * L];
      const w = L * 0.55, ao = 0.55 + 0.45 * t ** 0.6 * (0.8 + 0.2 * r());
      for (const tilt of [-0.62, 0.62]) {
        // the spray's plane: turned about the branch by ±35°
        const up = [side[0] * Math.sin(tilt), Math.cos(tilt), side[2] * Math.sin(tilt)];
        const across = [side[0] * Math.cos(tilt) - 0 * up[0], -Math.sin(tilt), side[2] * Math.cos(tilt)];
        const e = (p, s) => [p[0] + across[0] * s, p[1] + across[1] * s, p[2] + across[2] * s];
        const nOut = (p) => { const l = Math.hypot(p[0], p[2]) || 1; const v = [p[0] / l, 0.55, p[2] / l]; const m = Math.hypot(...v); return v.map((q) => q / m); };
        const q0 = e(s0, -w * 0.25), q1 = e(s0, w * 0.25), q2 = e(s1, w * 0.5), q3 = e(s1, -w * 0.5);
        b.quad(q0, q1, q2, q3, [nOut(q0), nOut(q1), nOut(q2), nOut(q3)], [[0, 0], [0, 1], [0.86, 1], [0.86, 0]], ao);
      }
    }
  }
  // the leader at the very top
  for (const a of [0, Math.PI / 2]) {
    const d = [Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02];
    b.quad([-d[0], 0.93, -d[2]], [d[0], 0.93, d[2]], [d[0], 1.01, d[2]], [-d[0], 1.01, -d[2]], [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]], [[0, 0.35], [0, 0.65], [0.5, 0.65], [0.5, 0.35]], 1);
  }
  return b.done();
}
// a mountain birch: two or three crooked stems from one foot, a few branches, an open crown of leaf sprays
function birchGeometry(seed) {
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
  for (let i = 0; i < 46; i++) {
    const p = tops[r() * tops.length | 0];
    const a = r() * 6.28, rr = 0.05 + r() * 0.24, cx = p[0] + Math.cos(a) * rr, cz = p[2] + Math.sin(a) * rr, y = p[1] + (r() - 0.3) * 0.2;
    const s = 0.12 + r() * 0.09, fa = r() * 6.28, ux = Math.cos(fa) * s, uz = Math.sin(fa) * s, tilt = (r() - 0.5) * 0.6;
    const o = [cx - cx * 0, y, cz];
    const n = (q) => { const v = [q[0], (q[1] - cy) * 0.8 + 0.25, q[2]]; const m = Math.hypot(...v) || 1; return v.map((w) => w / m); };
    const q0 = [o[0] - ux, o[1] - s + tilt * s, o[2] - uz], q1 = [o[0] + ux, o[1] - s - tilt * s, o[2] + uz], q2 = [o[0] + ux, o[1] + s - tilt * s, o[2] + uz], q3 = [o[0] - ux, o[1] + s + tilt * s, o[2] - uz];
    b.quad(q0, q1, q2, q3, [n(q0), n(q1), n(q2), n(q3)], [[0, 0], [0.74, 0], [0.74, 1], [0, 1]], 0.7 + 0.3 * r());
  }
  return b.done();
}
const WHORLS = coarse ? 20 : 30;
const VARIANTS = [spruceGeometry(3, WHORLS), spruceGeometry(8, WHORLS), spruceGeometry(17, WHORLS), birchGeometry(5), birchGeometry(29)];
const IMP_W = VARIANTS.map((g, v) => { g.computeBoundingBox(); const bb = g.boundingBox; return 2 * Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z) * 1.04; });

// ---------------------------------------------------------------- near trees: geometry, placed on the CPU
function treeMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uTrans: { value: 0.55 } });
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = LIT_FRAG_HEAD + DITHER + sh.fragmentShader
      .replace('#include <alphatest_fragment>', /* glsl */`
  { // keep the needles' coverage in the smaller mipmaps (Golus)
    vec2 tx = vMapUv * vec2(1024.0, 512.0); float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
    diffuseColor.a *= 1.0 + mip * 0.28;
  }
  if (distance(vW, uCamPos) > uNearR + 25.0 * ign(gl_FragCoord.xy)) discard;
#include <alphatest_fragment>`)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <lights_fragment_begin>', LIT_AFTER_LIGHTS)
      .replace('#include <fog_fragment>', LIT_END);
  };
  return m;
}
function treeDepthMaterial(tex) {
  const m = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  return m;
}
const spruceMat = treeMaterial(spruceTex), birchMat = treeMaterial(birchTex);
const NEAR_MAX = coarse ? 1400 : 3200;
const near = VARIANTS.map((g, v) => {
  const tex = v < 3 ? spruceTex : birchTex;
  const m = new THREE.InstancedMesh(g, v < 3 ? spruceMat : birchMat, NEAR_MAX);
  m.customDepthMaterial = treeDepthMaterial(tex);
  m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
  return m;
});
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
let nearKey = '';
function updateNear(c) {
  const R = uniforms.uNearR.value + 30, ts = TILE * CELL;
  const t0 = Math.floor((c.x - R) / ts), t1 = Math.floor((c.x + R) / ts), u0 = Math.floor((c.z - R) / ts), u1 = Math.floor((c.z + R) / ts);
  const key = `${t0},${t1},${u0},${u1},${Math.round(c.y / 20)}`;
  if (key === nearKey) return;
  nearKey = key;
  const counts = near.map(() => 0);
  for (let tj = u0; tj <= u1; tj++) for (let ti = t0; ti <= t1; ti++) {
    for (const t of tileTrees(ti, tj)) {
      const d = Math.hypot(t.x - c.x, t.y + t.s * 0.4 - c.y, t.z - c.z);
      if (d > R) continue;
      const m = near[t.v];
      if (counts[t.v] >= NEAR_MAX) continue;
      M4.compose(V.set(t.x, t.y, t.z), Q.setFromAxisAngle(UP, t.rot), SC.set(t.s, t.s, t.s));
      m.setMatrixAt(counts[t.v]++, M4);
    }
  }
  near.forEach((m, v) => { m.count = counts[v]; m.instanceMatrix.needsUpdate = true; });
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
function ringMesh(cell, n, rIn, wIn, rOut, wOut, salt, scaleMul) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = n * n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const u = { uCell: { value: cell }, uN: { value: n }, uOrigin: { value: new THREE.Vector2() }, uRIn: { value: rIn }, uWIn: { value: wIn }, uROut: { value: rOut }, uWOut: { value: wOut }, uSalt: { value: salt }, uScaleMul: { value: scaleMul } };
  const m = new THREE.MeshStandardMaterial({ map: bakeRT.textures[0], alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, u, { uTrans: { value: 0.55 }, uNormals: { value: bakeRT.textures[1] }, uImpW: { value: IMP_W } });
    sh.vertexShader = `uniform vec3 uCamPos; uniform float uCell, uRIn, uROut, uWOut, uScaleMul; uniform int uN, uSalt; uniform vec2 uOrigin; uniform float uImpW[${VARIANTS.length}];
varying vec3 vW; varying vec3 vRight; varying vec3 vFwd; varying float vReject; varying float vVariant;
${NOISE}${LAND}${FOREST}` + sh.vertexShader
      .replace('#include <beginnormal_vertex>', /* glsl */`
  ivec2 cellId = ivec2(floor(uOrigin / uCell)) + ivec2(gl_InstanceID % uN, gl_InstanceID / uN);
  vec3 foot; float size, rot; int variant;
  bool ok = treeAt(cellId, uCell, uSalt, foot, size, variant, rot);
  size *= uScaleMul;
  float dcam = distance(foot + vec3(0.0, size * 0.4, 0.0), uCamPos);
  vReject = (!ok || dcam < uRIn - 30.0 || dcam > uROut + uWOut + 30.0) ? 1.0 : 0.0;
  vec3 toCam = uCamPos - foot; vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + 1e-5); vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  vRight = right; vFwd = fwd; vVariant = float(variant);
  vec3 objectNormal = fwd;`)
      .replace('#include <begin_vertex>', /* glsl */`
  float iw = uImpW[variant];
  vec3 transformed = foot + right * position.x * iw * size + vec3(0.0, position.y * 1.02 * size, 0.0);
  vW = transformed;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
  vMapUv = vec2((float(variant) + uv.x) / ${VARIANTS.length}.0, uv.y);
  if (vReject > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    sh.fragmentShader = `uniform sampler2D uNormals; uniform float uRIn, uWIn, uROut, uWOut; varying vec3 vRight; varying vec3 vFwd; varying float vReject;\n` + LIT_FRAG_HEAD + DITHER + sh.fragmentShader
      .replace('#include <map_fragment>', /* glsl */`
  vec4 tc = texture(map, vMapUv);
  diffuseColor.rgb *= pow(tc.rgb, vec3(2.2)); diffuseColor.a = tc.a;`)
      .replace('#include <alphatest_fragment>', /* glsl */`
  {
    vec2 tx = vMapUv * vec2(${ATLAS_W * VARIANTS.length}.0, ${ATLAS_H}.0); float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tx), dFdx(tx)), dot(dFdy(tx), dFdy(tx)))));
    diffuseColor.a *= 1.0 + mip * 0.3;
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
  mesh.frustumCulled = false;
  mesh.userData.u = u;
  scene.add(mesh);
  return mesh;
}
const R0 = coarse ? 520 : 780;
const rings = [
  ringMesh(CELL, Math.ceil(2 * (R0 + 110) / CELL), uniforms.uNearR.value, 25, R0, 100, 0, 1.0),
  ringMesh(CELL * 2, Math.ceil(2 * (coarse ? 1900 : 3700) / (CELL * 2)), R0, 100, coarse ? 1600 : 3300, 400, 1, 1.15),
];
function updateRings(c) {
  for (const r of rings) {
    const u = r.userData.u, half = u.uN.value * u.uCell.value / 2;
    u.uOrigin.value.set(Math.floor((c.x - half) / u.uCell.value) * u.uCell.value, Math.floor((c.z - half) / u.uCell.value) * u.uCell.value);
  }
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
  uniforms: { tScene: { value: rt.textures[0] }, tMask: { value: rt.textures[1] }, uTime: uniforms.uTime, uExposure: { value: 1.0 } },
  depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tScene, tMask; uniform float uTime, uExposure; varying vec2 vUv;
    vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec3 s = texture2D(tScene, vUv).rgb; float m = texture2D(tMask, vUv).r;
      vec3 c = aces(s * uExposure);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 0.92);
      c += vec3(-0.006, 0.0, 0.012) * (1.0 - l) * (1.0 - l);
      c = 0.02 + c * 0.97;
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.3;
      vec3 srgb = toSRGB(c) + (h12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.026;
      gl_FragColor = vec4(mix(vec3(0.9569, 0.949, 0.9333), srgb, clamp(m, 0.0, 1.0)), 1.0);
    }`,
}));
const postScene = new THREE.Scene(); postScene.add(post);
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---------------------------------------------------------------- size
let W = 0, H = 0, DPR = 1;
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.5, Math.sqrt(3.2e6 / (w * h)));
  if (w === W && h === H && dpr === DPR) return false;
  W = w; H = h; DPR = dpr;
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
  rt.setSize(Math.round(W * DPR), Math.round(H * DPR));
  const base = (coarse && W < H ? 62 : 52) * Math.PI / 180;
  const t = Math.tan(base / 2) / (W < H ? 0.8 : 1);
  cam.fov = 2 * Math.atan(t) * 180 / Math.PI; cam.aspect = W / H; cam.updateProjectionMatrix();
  return true;
}

// ---------------------------------------------------------------- the frame
function render(p) {
  const f = flight(p);
  cam.position.set(f.x, f.y, f.z);
  const cp = Math.cos(f.pitch);
  cam.lookAt(f.x + f.hx * cp * 100, f.y + Math.sin(f.pitch) * 100, f.z + f.hz * cp * 100);
  cam.updateMatrixWorld();
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
  updateNear(cam.position);
  updateRings(cam.position);
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
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
let pShown = 0, target = 0, last = performance.now(), running = false, visible = true, drawn = -1, ready = false;
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
const HIDE = (params.get('hide') || '').split(',');
window.__introBench = (p) => {
  terrain.visible = !HIDE.includes('terrain'); sky.visible = !HIDE.includes('sky');
  near.forEach((m) => { m.visible = !HIDE.includes('near'); }); rings.forEach((m) => { m.visible = !HIDE.includes('rings'); });
  sunLight.castShadow = !HIDE.includes('shadow');
  const t0 = performance.now(); render(p); const t1 = performance.now();
  const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return { cpu: t1 - t0, total: performance.now() - t0 };
};
root.classList.add('has-webgl');
target = pShown = DEBUG_P ?? scrollProgress();
state();
overlay(pShown);
window.__intro = { p: pShown, ms: 0, bake: 'loading' };
HC.terrain(canvas.dataset.src).then((t) => {
  T = t;
  const tex = new THREE.DataTexture(t.data, t.w, t.h, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  uniforms.uHeight.value = tex; uniforms.uRes.value.set(t.w, t.h);
  uniforms.uSunVis.value = traceSunVis(t);
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
