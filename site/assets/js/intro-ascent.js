// The ascent: a scroll-driven camera through fog, towards one climber on a north face.
// Raw WebGL2, no library. A raymarched pass (terrain, rock, snow, climber, fog, clouds) at a fraction
// of the screen's resolution, jittered a little differently every frame; a temporal resolve that
// reprojects the previous frames and rebuilds full device resolution from them; a finishing pass;
// and an instanced pass for falling snow. Scroll never gets hijacked: the camera only follows it, damped.
(() => {

const section = document.getElementById('intro');
const stage = section.querySelector('.intro-stage');
const canvas = section.querySelector('canvas');
const root = document.documentElement;

const params = new URLSearchParams(location.search);
const DEBUG_P = params.has('p') ? parseFloat(params.get('p')) : null;   // ?p=0.6 freezes the camera
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

// An opening title, not a section: it plays on load (and on every reload), runs once, then it is over.
// Coming back to Home from another page in the same visit goes straight to the title card.
const navType = performance.getEntriesByType('navigation')[0]?.type;
const play = DEBUG_P != null || params.has('intro') || navType === 'reload' || sessionStorage.getItem('hc-intro') !== 'seen';
let done = false;
function markDone() {
  section.classList.add('is-done');
  root.classList.add('intro-complete');
  stage.style.setProperty('--p', '1');
  try { sessionStorage.setItem('hc-intro', 'seen'); } catch (e) { /* private mode: replays, harmless */ }
}
// reduced motion: the title card, and no GPU work at all
if (!play || (reduced && DEBUG_P == null)) { markDone(); return; }
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);

// ---------------------------------------------------------------- math
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => V.mul(a, 1 / Math.hypot(...a)),
  mix: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t),
};
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- the world (metres, y up)
// The face is a plane through the summit, 66° steep, facing the camera; a snow couloir cuts it at
// the 2:1 slope of the club's mark — the cleft — and the climber stands in it.
const SUMMIT = [80, 1150, -320];
const NF = V.norm([0, 0.45, 1]);          // face normal
const TX = [1, 0, 0];                     // across the face
const TY = V.cross(NF, TX);               // up the face
const DEPTH = 8;                          // the couloir's snow, on its axis, below the face plane
const CU = -20, CV = -640;                // climber, in face coordinates
const CLIMBER = V.add(V.add(SUMMIT, V.add(V.mul(TX, CU), V.mul(TY, CV))), V.mul(NF, -DEPTH));
const at = (n, x, y, up = 0) => V.add(V.add(V.add(CLIMBER, V.mul(NF, n)), V.add(V.mul(TX, x), V.mul(TY, y))), [0, up, 0]);
const LOOK = V.add(CLIMBER, [0, 1.1, 0]);
// bedding planes: nearly level, dipping a little east and into the mountain
const SDIR = V.norm([0.16, 1, -0.1]);

// Atmosphere keys: progress, fog colour (linear; the horizon), fog density, cloud bank, sun colour,
// exposure, sun direction, and optionally the zenith, mist on the water, and the sun's disk.
// It opens at dawn in the forest by the lake: a peach horizon, lilac overhead, the sun low ahead
// through the trees and mist on the water. Climbing out of the valley it goes into a cloud bank and
// comes out in the cold light of the wall. At the end a second cloud bank rolls over the wall:
// contrast goes, luminance rises, and the fog itself becomes the paper of the page.
const DAWN = [0.30, 0.07, -1.0];
const LOOKS = [
  [0.00, [0.30, 0.20, 0.17], 0.00007, 0.00, [1.70, 1.00, 0.58], 1.0, DAWN, [0.085, 0.095, 0.16], 1.0, 1.0, -520],
  [0.16, [0.36, 0.25, 0.20], 0.00006, 0.00, [2.10, 1.28, 0.74], 1.0, [0.31, 0.08, -1.0], [0.11, 0.12, 0.19], 1.0, 1.0, -520],
  [0.28, [0.38, 0.28, 0.23], 0.00006, 0.00, [2.30, 1.45, 0.86], 1.0, [0.33, 0.10, -1.0], [0.13, 0.14, 0.21], 0.8, 1.0, -480],
  [0.38, [0.30, 0.26, 0.25], 0.00008, 0.00, [2.10, 1.55, 1.05], 1.0, [0.45, 0.14, -0.9], [0.13, 0.15, 0.21], 0.35, 0.8, -300],
  [0.46, [0.20, 0.21, 0.24], 0.00050, 1.20, [0.90, 0.85, 0.80], 1.0, [0.60, 0.22, -0.7], [0.21, 0.22, 0.26], 0.0, 0.0, 200],
  [0.53, [0.070, 0.082, 0.100], 0.00024, 0.25, [1.20, 1.10, 1.00], 1.0, [0.78, 0.30, -0.45]],
  [0.623, [0.110, 0.125, 0.145], 0.00013, 0.06, [2.20, 2.05, 1.85], 1.0, [0.82, 0.40, -0.05]],
  [0.774, [0.150, 0.165, 0.185], 0.00012, 0.10, [2.40, 2.25, 2.05], 1.0, [0.80, 0.42, 0.05]],
  [0.902, [0.230, 0.245, 0.262], 0.00026, 0.55, [2.50, 2.35, 2.15], 1.0, [0.80, 0.42, 0.05]],
  [0.928, [0.400, 0.415, 0.430], 0.00110, 1.40, [2.60, 2.45, 2.30], 1.0, [0.80, 0.42, 0.05]],
  [0.955, [0.660, 0.668, 0.668], 0.00500, 2.40, [2.80, 2.70, 2.55], 1.04, [0.80, 0.42, 0.05]],
  [0.977, [0.960, 0.950, 0.915], 0.02500, 3.20, [3.00, 2.90, 2.75], 1.08, [0.80, 0.42, 0.05]],
  [1.00, [1.160, 1.135, 1.080], 0.09000, 3.60, [3.00, 2.90, 2.75], 1.10, [0.80, 0.42, 0.05]],
];

// The trail the opening follows through the forest to the lake (kept clear of trees in the shader)
const valleyX = (z) => 60 + 260 * (Math.sin(z / 2600 + 0.9) - Math.sin(0.9)) + 120 * Math.sin(z / 950 + 2) * smooth(clamp((z - 3500) / 3000));
const trailX = (z) => valleyX(z) - 180 + 45 * Math.sin(z / 210);

// The camera. The opening walks the trail through the forest, 2.6 m off the ground (read from the
// baked land); from the shore it is keyed: low over the lake, up the valley, into the cloud, and on
// to the wall, where the climber is there for scale: we find them, travel along the wall beside
// them, and never close in. Keys: progress, position, target, vertical fov (deg).
const WATER = -642;
const TRAIL_END = 0.165, TRAIL_Z0 = 11350, TRAIL_Z1 = 10330;
let groundAt = () => -612;                          // until the land is baked and read back
const groundSmooth = (x, z) => (groundAt(x, z) * 2 + groundAt(x + 9, z) + groundAt(x - 9, z) + groundAt(x, z + 9) + groundAt(x, z - 9)) / 6;
function trailPose(p) {
  const s = clamp(p / TRAIL_END), z = TRAIL_Z0 + (TRAIL_Z1 - TRAIL_Z0) * s, x = trailX(z);
  const lift = smooth(clamp((s - 0.55) / 0.45));                  // near the shore the gaze rises to the lake and the mountains
  const z2 = z - 80, x2 = trailX(z2);
  return { pos: [x, Math.max(groundSmooth(x, z), WATER) + 1.9, z], tgt: [x2, Math.max(groundSmooth(x2, z2), WATER) + 2.6 + lift * 22, z2], fov: 55 - 5 * lift };
}
let KEYS = [];
function buildKeys() {
  const e0 = trailPose(0.10), e1 = trailPose(TRAIL_END);
  KEYS = [
    [0.10, e0.pos, e0.tgt, e0.fov],
    [TRAIL_END, e1.pos, e1.tgt, e1.fov],
    [0.22, [-600, WATER + 5, 9900], [-470, -570, 7000], 50],
    [0.29, [-540, WATER + 9, 8900], [-300, -430, 5000], 48],
    [0.35, [-430, -560, 7900], [-120, -220, 3000], 46],
    [0.41, [-300, -300, 6800], [0, 100, 1500], 44],
    [0.47, [-200, 100, 5500], [20, 500, 500], 42],
    [0.53, [-120, 440, 4200], [40, 650, 0], 40],
    [0.57, [-70, 455, 3100], [40, 630, 0], 38],
    [0.60, [0, 480, 1800], [45, 610, -60], 36],
    [0.713, at(620, -10, -120), LOOK, 30],
    [0.789, at(300, 30, -70), LOOK, 28],
    [0.842, at(140, 45, -30), at(0, 0, 2, 1.2), 26],
    [0.887, at(128, -10, -8), at(0, -8, 4, 1), 26],
    [0.925, at(122, -62, 14), at(0, -16, 12, 1), 27],
    [0.962, at(150, -100, 50), at(40, -140, 220), 31],
    [1.00, at(175, -125, 95), at(60, -170, 330), 33],
  ];
}
buildKeys();

function sampleKeys(keys, p) {
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  return { i, t: clamp((p - a[0]) / (b[0] - a[0])) };
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

const DEBUG_CAM = params.get('cam')?.split(',').map(Number);   // ?cam=n,x,y,up, tn,tx,ty,tup, fov (face-relative)
const WORLD_CAM = params.get('wcam')?.split(',').map(Number);  // ?wcam=x,y,z, tx,ty,tz, fov (world)
function camera(p, time) {
  if (DEBUG_CAM) { const c = DEBUG_CAM; return { pos: at(c[0], c[1], c[2], c[3]), tgt: at(c[4], c[5], c[6], c[7]), fov: c[8] }; }
  if (WORLD_CAM) { const c = WORLD_CAM; return { pos: c.slice(0, 3), tgt: c.slice(3, 6), fov: c[6] }; }
  let pos, tgt, fov;
  if (p <= TRAIL_END) ({ pos, tgt, fov } = trailPose(p));
  else {
    const { i, t } = sampleKeys(KEYS, p);
    const k = (j) => KEYS[clamp(j, 0, KEYS.length - 1)];
    pos = catmull(k(i - 1)[1], k(i)[1], k(i + 1)[1], k(i + 2)[1], t);
    tgt = catmull(k(i - 1)[2], k(i)[2], k(i + 1)[2], k(i + 2)[2], t);
    fov = k(i)[3] + (k(i + 1)[3] - k(i)[3]) * smooth(t);
    if (p < 0.5) pos[1] = Math.max(pos[1], Math.max(groundAt(pos[0], pos[2]), WATER) + 3);   // never into a hill
    const out = V.dot(V.sub(pos, CLIMBER), NF);
    if (out < 2.5 && p > 0.7) pos.splice(0, 3, ...V.add(pos, V.mul(NF, 2.5 - out)));
  }
  // handheld drift: a sway among the trees, larger in the open, steady again up close to the climber
  const dist = Math.hypot(...V.sub(pos, CLIMBER));
  const a = 0.12 + (Math.min(dist * 0.004, 6) - 0.1) * smooth(clamp((p - 0.3) / 0.25));
  const drift = [Math.sin(time * 0.31) + 0.5 * Math.sin(time * 0.73), Math.sin(time * 0.27 + 1) * 0.6, Math.sin(time * 0.19 + 2) * 0.4];
  return { pos: V.add(pos, V.mul(drift, a)), tgt, fov };
}

function look(p) {
  const { i, t } = sampleKeys(LOOKS, p);
  const a = LOOKS[i], b = LOOKS[i + 1], s = smooth(t);
  // density interpolates in log space: it spans two orders of magnitude
  const zen = (k) => k[7] ?? V.mul(k[1], 1.25), mist = (k) => k[8] ?? 0, disk = (k) => k[9] ?? 0, fbase = (k) => k[10] ?? 380;
  return {
    fog: V.mix(a[1], b[1], s), den: Math.exp(Math.log(a[2]) + (Math.log(b[2]) - Math.log(a[2])) * s),
    cloud: a[3] + (b[3] - a[3]) * s, sun: V.mix(a[4], b[4], s), exposure: a[5] + (b[5] - a[5]) * s,
    sunDir: V.norm(V.mix(V.norm(a[6]), V.norm(b[6]), s)),
    zenith: V.mix(zen(a), zen(b), s), mist: mist(a) + (mist(b) - mist(a)) * s, disk: disk(a) + (disk(b) - disk(a)) * s,
    fogBase: fbase(a) + (fbase(b) - fbase(a)) * s,
  };
}

// ---------------------------------------------------------------- shaders
const FULLSCREEN_VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// Tileable gradient noise baked into a 128³ texture: 16 lattice cells, 8 texels per cell.
const NOISE_FS = `#version 300 es
precision highp float; precision highp int;
uniform float uZ; out vec4 o;
uvec3 pcg3d(uvec3 v){ v = v * 1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }
vec3 g(ivec3 c){ uvec3 h = pcg3d(uvec3((c % 16 + 16) % 16)); return normalize(vec3(h & 0xffffu) / 32767.5 - 1.0 + 1e-4); }
void main(){
  vec3 p = vec3(gl_FragCoord.xy, uZ + 0.5) / 8.0;
  ivec3 i = ivec3(floor(p)); vec3 f = fract(p); vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float n = mix(mix(mix(dot(g(i), f), dot(g(i+ivec3(1,0,0)), f-vec3(1,0,0)), u.x),
                    mix(dot(g(i+ivec3(0,1,0)), f-vec3(0,1,0)), dot(g(i+ivec3(1,1,0)), f-vec3(1,1,0)), u.x), u.y),
                mix(mix(dot(g(i+ivec3(0,0,1)), f-vec3(0,0,1)), dot(g(i+ivec3(1,0,1)), f-vec3(1,0,1)), u.x),
                    mix(dot(g(i+ivec3(0,1,1)), f-vec3(0,1,1)), dot(g(i+ivec3(1,1,1)), f-vec3(1,1,1)), u.x), u.y), u.z);
  o = vec4(clamp(0.5 + 0.8 * n, 0.0, 1.0));
}`;

const f3 = (v) => `vec3(${v.map((x) => x.toFixed(5)).join(',')})`;

// Everything the scene, the bake and its derivation share: the world, as distance functions.
const COMMON = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uHF0, uHF1, uHF2, uLand, uLandMax, uCeil;
uniform int uLandOn; uniform vec3 uZenith; uniform float uMist, uDisk, uFogBase;
uniform vec2 uRes, uJitter, uHFN; uniform float uTime, uFocal, uPix, uSunMix;
uniform vec3 uCam, uCamR, uCamU, uCamF;
uniform vec3 uSunDir, uSunCol, uFogCol;
uniform float uFogDen, uCloud, uTMax, uExposure;
uniform int uSteps, uCloudSteps, uQuality, uHF, uBake;

const vec3 S1 = ${f3(SUMMIT)};
const vec3 NF = ${f3(NF)};
const vec3 TY = ${f3(TY)};
const vec3 CLIMB = ${f3(CLIMBER)};
const vec2 CUV = vec2(${CU.toFixed(1)}, ${CV.toFixed(1)});
const vec2 CDIR = vec2(-0.4472136, 0.8944272);   // up the couloir: 2:1, the slope of the mark
const float DEPTH = ${DEPTH.toFixed(1)};
const vec3 SF = ${f3([SDIR[0], V.dot(TY, SDIR), V.dot(NF, SDIR)])};   // the bedding direction, in face coordinates
const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

float n3(vec3 p){ return textureLod(uNoise, p * 0.0625, 0.0).r; }
// analytic value noise, quintic: C2 everywhere, so large rock octaves shade without texel facets
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 x){
  vec3 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h*h*k*0.25; }

// ---- the face, in its own coordinates: u across, v up the face, w out of it (metres)
vec3 faceUVW(vec3 p){ vec3 q = p - S1; return vec3(q.x, dot(q, TY), dot(q, NF)); }

// ---- the face, baked. Seen from the front, the whole north side of the massif is a height above
// the face plane, so at load it is baked into a heightfield (and, from that, its normals, snow,
// occlusion and sun shadows): a texture whose texels are ~0.4 m around the climber and grow to
// ~2.6 m at the edges, via a blend of linear and asinh spacing. Marching it costs one lookup a step.
const vec2 HFC = CUV, HFR = vec2(1450.0, 760.0), HFA = vec2(0.325, 0.0), HFL = vec2(100.0, 130.0);
const float WTOP = 280.0, WBOT = -820.0, HFK = 0.32;          // the heights it spans; its slope bound
vec2 hfS(vec2 x){ return HFA * x / HFR + (1.0 - HFA) * asinh(x / HFL) / asinh(HFR / HFL); }        // metres → [-1, 1]
vec2 hfDS(vec2 x){ return HFA / HFR + (1.0 - HFA) / (asinh(HFR / HFL) * sqrt(HFL * HFL + x * x)); }
vec2 hfX(vec2 s){ vec2 x = s * HFR; for (int i = 0; i < 10; i++) x -= (hfS(x) - s) / hfDS(x); return x; }
vec2 hfST(vec2 uv){ return hfS(uv - HFC) * 0.5 + 0.5; }
float hfEdge(vec2 uv){ vec2 e = HFR - abs(uv - HFC); return min(e.x, e.y); }                       // metres inside it

// ---- the couloir: position along it, signed distance across it, and its half-width there.
// It keeps the 2:1 line of the mark overall, but wanders, pinches and opens like a real gully.
// Every variation is measured from the climber's position, so they always stand on its axis.
float wander(float a){ return 22.0 * sin(a / 95.0 + 0.6) + 13.0 * sin(a / 57.0 + 2.1) + 5.0 * sin(a / 23.0 + 4.0); }
float girth(float a){ return 5.0 * sin(a / 41.0 + 1.0) + 3.5 * sin(a / 17.0 + 2.6); }
vec3 gully(vec2 uv){
  vec2 d = uv - CUV;
  float along = dot(d, CDIR);
  float across = d.x * CDIR.y - d.y * CDIR.x;
  across += wander(along) - wander(0.0)
          + 16.0 * smoothstep(130.0, 230.0, along) - 14.0 * (1.0 - smoothstep(-260.0, -170.0, along));   // two doglegs
  float hw = (7.5 + girth(along) - girth(0.0)) * mix(1.35, 0.7, smoothstep(-250.0, 450.0, along));   // fanning out below, narrowing to the top
  hw = max(hw, 3.2 + 0.8 * sin(along / 6.3));                          // it pinches to a runnel, never closes
  float ends = smoothstep(-350.0, -250.0, along) * (1.0 - smoothstep(380.0, 520.0, along));
  return vec3(along, across, mix(-6.0, hw, ends));
}

// the couloir's snow, as a height above the face plane: a trough, lowest on the axis and rising
// towards the walls, with drifts and avalanche debris, and runnels combed down it by spindrift
float snowTop(vec3 g, float px){
  float x = clamp(g.y / max(g.z, 0.5), -1.0, 1.0);
  float s = -DEPTH + 3.6 * x * x;
  float stance = smoothstep(1.5, 5.0, length(g.xy));                  // the climber's stance, stamped flat
  s += stance * (1.1 * (n3(vec3(g.y / 11.0, g.x / 26.0, 2.1)) - 0.5) + 0.5 * (n3(vec3(g.y / 4.0, g.x / 9.0, 4.3)) - 0.5));
  float comb = (1.0 - smoothstep(0.15, 0.6, px)) * stance;             // sub-pixel beyond that: it would only sparkle
  if (comb > 0.0){
    float r = n3(vec3(g.y / 3.1, g.x / 42.0, 7.7));
    s += comb * (0.5 * abs(2.0 * r - 1.0) + 0.22 * n3(vec3(g.y / 1.6, g.x / 2.4, 5.1)) + 0.05 * n3(vec3(g.y / 0.5, g.x / 0.8, 1.3)));
  }
  return s;
}

// ---- rock: buttresses and grooves down the fall line, cracks, and bedding ledges across it.
// It is sampled at the point projected onto the nearest face of the mountain ('o', in face
// coordinates), so it is constant through the rock's thickness and no detail can float free of a
// crest. Ridged multifractal, each octave weighted by the one above so crests stay sharp.
const float FINE_MAX = 16.0;                                     // the most the fine detail can add, metres
float rockCoarse(vec3 o, float px, out vec3 q, out vec3 r, out float wgt){
  q = o + (vec3(n3(o / 330.0), n3(o / 330.0 + 5.2), n3(o / 330.0 + 9.1)) - 0.5) * 60.0;
  float h = 80.0 * smoothstep(0.3, 0.85, n3(q * vec3(1.0 / 420.0, 1.0 / 1000.0, 1.0 / 420.0) + 1.3));
  float oct = clamp(log2(150.0 / (3.0 * max(px, 0.01))), 1.0, 9.0), amp = 46.0;
  r = vec3(q.x, q.y * 0.4, q.z) / 150.0 * 1.7;                  // features 2.5x taller than wide
  wgt = 1.0;
  for (int i = 0; i < 3; i++){
    float fw = clamp(oct - float(i), 0.0, 1.0);
    if (fw <= 0.0) break;
    float n = 1.0 - abs(2.0 * (i == 0 ? vn3(r) : n3(r)) - 1.0);
    n = n * n * mix(wgt, 1.0, 0.35);                            // hollows stay quieter, never glassy
    wgt = clamp(n * 1.6, 0.0, 1.0);
    h += amp * n * fw;
    amp *= 0.5;
    r = (i < 2 ? vec3(r.x * 0.8 - r.z * 0.6, r.y, r.x * 0.6 + r.z * 0.8) : ROT * r) * 2.03 + vec3(1.7, 3.1, 0.4);
  }
  return h;
}
float rockFine(vec3 o, vec3 q, vec3 r, float wgt, float px){
  float oct = clamp(log2(150.0 / (3.0 * max(px, 0.01))), 1.0, 9.0), amp = 5.75, h = 0.0;
  r /= 1.7;
  for (int i = 3; i < 9; i++){
    float fw = clamp(oct - float(i), 0.0, 1.0);
    if (fw <= 0.0) break;
    float n = 1.0 - abs(2.0 * n3(r) - 1.0);
    n = n * n * mix(wgt, 1.0, 0.35);
    wgt = clamp(n * 1.6, 0.0, 1.0);
    h += amp * n * fw;
    amp *= 0.57;                                                // rock is rougher at small scales than a plain fractal
    r = ROT * r * 2.03 + vec3(1.7, 3.1, 0.4);
  }
  // joints: cracks and chimneys down the fall line
  float fine = 1.0 - smoothstep(1.0, 4.0, px);
  if (fine > 0.0){
    float j = 1.0 - abs(2.0 * n3(vec3(q.x / 9.0, q.y / 46.0, q.z / 9.0 + 4.4)) - 1.0);
    h -= fine * 2.2 * j * j * j * j;
  }
  // bedding: each stratum leans out a little and steps back at its top, a ledge that holds snow.
  // Uneven layers, broken off in places, and warped, so the ledges never line up like ruled lines.
  float strat = (1.0 - smoothstep(3.0, 10.0, px)) * smoothstep(0.3, 0.55, n3(q / 45.0 + 3.3));
  if (strat > 0.0) strat *= smoothstep(0.22, 0.45, n3(q / 13.0 + 8.1));
  if (strat > 0.0){
    float sx = dot(o, SF) / 10.5 + 1.6 * n3(q / 140.0 + 7.1) + 0.5 * n3(q / 31.0 + 2.9);
    float s = fract(sx), thick = 0.35 + 1.1 * hash12(vec2(floor(sx), 3.7));
    h += strat * 2.8 * thick * (s - smoothstep(0.7, 1.0, s));
  }
  return h;
}

// A pyramid: the distance to it, and in 'onto' the point projected onto its nearest face — blended
// across the arêtes — which is where the rock's relief is sampled.
float pyramid(vec3 p, vec3 s, vec3 n0, vec3 n1, vec3 n2, vec3 n3_, out vec3 onto){
  vec3 q = p - s;
  float a = dot(q, n0), b = -1e9, d; vec3 na = n0, nb = n0;
  d = dot(q, n1); if (d > a){ b = a; nb = na; a = d; na = n1; } else if (d > b){ b = d; nb = n1; }
  d = dot(q, n2); if (d > a){ b = a; nb = na; a = d; na = n2; } else if (d > b){ b = d; nb = n2; }
  d = dot(q, n3_); if (d > a){ b = a; nb = na; a = d; na = n3_; } else if (d > b){ b = d; nb = n3_; }
  float k = 0.5 + 0.5 * smoothstep(0.0, 40.0, a - b);
  onto = p - na * (a * k) - nb * (b * (1.0 - k));
  return a;
}

// Detail finer than the bake, added where the view is closer than its texels: ridged crags a few
// metres across, drawn out down the fall line, each octave faded before it would shimmer. A height
// over the face (so it stays on the wall), and zero wherever the bake is fine enough by itself.
float crags(vec3 f, float px){
  vec2 tm = 2.0 / (uHFN * hfDS(f.xy - HFC));
  float need = smoothstep(1.2, 3.0, max(tm.x, tm.y) / max(px, 1e-3));
  if (need <= 0.0) return 0.0;
  vec2 q = vec2(f.x, f.y * 0.45);
  float d = 0.0, a = 1.3, w = 4.5;
  for (int i = 0; i < 4; i++){
    float k = 1.0 - smoothstep(0.25, 0.6, px / w);                       // this octave is at least ~3 px
    if (k <= 0.0) break;
    float n = 1.0 - abs(2.0 * n3(vec3(q / w, 3.7 + float(i) * 1.9)) - 1.0);
    d += a * k * (n * n - 0.35);
    a *= 0.52; w *= 0.5;
  }
  return d * need;
}

float matOut;   // set by massif(): 0 rock, 6 the couloir's snow
bool massifTrue = true;   // false when massif() gave the bake's scaled-down (safe but not true) distance
bool exact = false;   // occlusion needs true distances near the surface, not the marcher's cheap bounds
float massif(vec3 p, float lod){
  matOut = 0.0; massifTrue = true;
  if (p.z > 1500.0) return p.z - 1400.0;                   // everything of it lies north of here
  vec3 f = faceUVW(p);
  if (uHF == 1){
    float edge = hfEdge(f.xy);
    if (edge > 30.0 && f.z > WBOT + 30.0){
      vec3 h = textureLod(uHF0, hfST(f.xy), 0.0).xyz;
      // a column with surface all round: the heightfield. Anywhere else (ridges against the sky,
      // the last 30 m before its edge, outside it): the full function. A step may take a ray into
      // that margin but never across it, so the edge itself can never read as a surface.
      if (h.y > 0.999){
        matOut = h.z > 0.5 ? 6.0 : 0.0;
        float det = h.z > 0.5 ? 0.0 : crags(f, lod * uPix);              // closer than the bake can hold: crags on it
        massifTrue = false;
        return min((f.z - h.x - det) * (det != 0.0 ? 0.26 : HFK), max(edge - 25.0, 1.2 * uPix * lod));   // (never so small near the edge that the edge itself reads as a hit)
      }
    }
  }
  float px = lod * uPix;                                                   // metres per pixel at this distance
  vec3 g = gully(f.xy);
  float calm = smoothstep(10.0, 280.0, abs(g.y) - g.z);                      // the base shape stays true near the couloir
  vec3 wp = p + (vec3(n3(p / 700.0 + 2.0), 0.0, n3(p / 700.0 + 6.0)) - 0.5) * 110.0 * mix(0.1, 1.0, calm);  // no straight edges
  vec3 oa, ob, oc;
  float a = pyramid(wp, S1, NF, normalize(vec3(-0.72, 0.58, 0.3)), normalize(vec3(0.96, 0.3, 0.2)), normalize(vec3(0.05, 0.5, -1.0)), oa);
  float b = pyramid(wp, vec3(-860.0, 720.0, -380.0), normalize(vec3(0.12, 0.85, 1.0)), normalize(vec3(-0.6, 0.95, 0.15)), normalize(vec3(0.75, 0.7, 0.25)), normalize(vec3(0.0, 0.7, -1.0)), ob);
  float c = pyramid(wp, vec3(960.0, 640.0, -820.0), normalize(vec3(-0.15, 0.75, 1.0)), normalize(vec3(-0.8, 0.8, 0.1)), normalize(vec3(0.9, 0.75, 0.2)), normalize(vec3(0.0, 0.6, -1.0)), oc);
  float d = smin(smin(a, b, 140.0), c, 160.0);
  matOut = 0.0;
  if (d > 200.0) return (d - 185.0) * 0.8;                                 // far from rock: cheap bound
  float wab = smoothstep(-90.0, 90.0, a - b), wc = smoothstep(-100.0, 100.0, min(a, b) - c);
  vec3 o = faceUVW(mix(mix(oa, ob, wab), oc, wc));
  // near a summit the mountain is thin: relief can only be as thick as the peak is wide there,
  // or it would build towers out of air above it
  float lim = 12.0 + 0.5 * max(mix(mix(S1.y, 720.0, wab), 640.0, wc) - wp.y, 0.0);
  float relief = mix(0.72, 1.0, calm);
  vec3 q, r; float wgt;
  float rk = d - smin(rockCoarse(o, px, q, r, wgt) * relief, lim, 16.0);
  // the fine detail, the couloir's cut and its snow all sit within FINE_MAX of the large forms, and
  // the cut only ever removes rock: until then, this is a safe (and cheap) bound
  if (rk > FINE_MAX + 3.0 && !exact) return (rk - FINE_MAX) * 0.8;
  rk -= rockFine(o, q, r, wgt, px) * relief;
  // the couloir: the rock is cut away above its snow. Its walls flare back as they rise, so it reads
  // as a gully and not a slot, and they are crags, not planes; their relief is a function of the
  // position along the couloir and the height only, so it always stays attached to the wall.
  float open = smoothstep(-2.0, 3.0, g.z);                                 // past its ends, nothing is cut
  if (abs(g.y) - (g.z + 8.0 + 0.42 * max(f.z + DEPTH + 1.0, 0.0) * open) > 0.0 && rk > 0.0) return rk * 0.8;   // nowhere near it
  float top = snowTop(g, px);
  float side = smoothstep(-2.0, 2.0, g.y) * 17.0;
  float rough = 4.5 * (1.0 - abs(2.0 * n3(vec3(g.x / 16.0, f.z / 12.0, side + 0.5)) - 1.0));
  float k1 = 1.0 - smoothstep(0.5, 2.0, px), k2 = 1.0 - smoothstep(0.2, 0.8, px);
  if (k1 > 0.0){ float cf = 1.0 - abs(2.0 * n3(vec3(g.x / 5.5, f.z / 4.5, side + 9.5)) - 1.0); rough += 1.8 * cf * cf * k1; }
  if (k2 > 0.0) rough += 0.7 * n3(vec3(g.x / 1.7, f.z / 1.7, side + 3.3)) * k2;
  rough *= open;
  float flare = max(f.z - top, 0.0) * 0.42 * open;
  float wall = abs(g.y) - (g.z + 0.6 + flare + rough);
  float steps = smoothstep(0.68, 0.82, n3(vec3(g.x / 30.0, g.y / 8.0, 5.5))) * smoothstep(40.0, 90.0, abs(g.x));
  rk = max(rk, -max(wall, top - 1.6 + 3.0 * steps - f.z));
  float sn = max(max(f.z - top, abs(g.y) - (g.z + 0.9 + 0.75 * rough)), -f.z - 60.0);   // the snow, banked against the walls
  if (sn < rk){ matOut = 6.0; return sn * 0.8; }
  return rk * 0.8;
}

// ---- the land. A glacial valley runs south from the north face: a cirque at its foot, then a floor
// ~640 m below the face, and a lake among forest 6.5 to 10 km out; rounded fells either side, and
// behind the massif, the ranges it belongs to. Metres, y up (the altitude shown is 1,320 m + y).
const float WATER = -642.0;
float valleyX(float z){ return 60.0 + 260.0 * (sin(z / 2600.0 + 0.9) - sin(0.9)) + 120.0 * sin(z / 950.0 + 2.0) * smoothstep(3500.0, 6500.0, z); }
float land(vec2 xz, float lod){
  float x = xz.x, z = xz.y, px = lod * uPix;
  float d = abs(x - valleyX(z));
  // the floor: down from the face's foot through the cirque, level along the valley, a basin for the lake
  float fy = mix(-20.0, -610.0, smoothstep(300.0, 4000.0, z));
  float W = mix(380.0, 900.0, smoothstep(600.0, 5600.0, z)) * (0.85 + 0.3 * n3(vec3(z / 1900.0, 1.3, 0.7)));
  // the lake: a basin in the middle of the floor, forested flats between it and the walls
  float lw = mix(260.0, 520.0, n3(vec3(z / 1300.0, 6.1, 2.3)));
  fy -= 48.0 * smoothstep(5800.0, 7400.0, z) * (1.0 - smoothstep(9800.0, 11300.0, z)) * (1.0 - smoothstep(lw * 0.6, lw, d));
  // the walls: a U-shaped trough, then rounded fells, lower near the face where the massif's own
  // shoulders take over; behind the face the ground climbs into the ranges
  float s = max(d - W, 0.0);
  vec3 q = vec3(x, 0.0, z) / 2400.0;
  float big = n3(q + vec3(0.0, 2.1, 0.0)) + 0.5 * n3(q * 2.13 + vec3(0.0, 5.3, 0.0));
  float fell = mix(420.0, 1150.0, smoothstep(300.0, 3800.0, z)) * (0.55 + 0.6 * big);
  float h = fy + fell * (1.0 - exp(-pow(s / 1500.0, 2.1)));      // gentle at the foot, where the forest climbs
  h = mix(h, 150.0 + 900.0 * big + 0.25 * s, smoothstep(-100.0, -1700.0, z));
  // the fells are old, glacier-worn mountains: broad rounded backs, cut by stream gullies that run
  // down the slope. The gullies are ridged noise stretched across the slope's fall line, so they
  // come down the walls instead of pocking them.
  float up = smoothstep(60.0, 600.0, h - fy);
  if (up > 0.0 && px < 60.0){
    // the gullies meander and branch (a warped domain, two scales at different angles), and are
    // shallow where the fell is broad: most of its surface is rounded back, not channel
    vec2 w = (vec2(n3(vec3(x, 1.0, z) / 700.0), n3(vec3(x, 9.0, z) / 700.0)) - 0.5) * 520.0;
    vec2 a = vec2(x, z) + w;
    float g = 1.0 - abs(2.0 * n3(vec3(a.x / 240.0, 7.3, a.y / 900.0)) - 1.0);
    float g2 = 1.0 - abs(2.0 * n3(vec3((a.x + 0.4 * a.y) / 95.0, 2.9, (a.y - 0.3 * a.x) / 330.0)) - 1.0);
    float deep = smoothstep(0.35, 0.75, n3(vec3(x, 4.0, z) / 1100.0));
    h -= up * (38.0 * g * g * g * g * (0.4 + 0.6 * deep) + 11.0 * g2 * g2 * g2 * (1.0 - smoothstep(8.0, 30.0, px)));
    // boulder fields and rock steps on the upper slopes
    h += up * 9.0 * smoothstep(0.55, 0.8, n3(vec3(x, 6.0, z) / 160.0)) * (1.0 - smoothstep(12.0, 40.0, px));
  }
  // moraine hummocks on the floor, rock steps and outcrops on the slopes, band-limited
  float floorish = 1.0 - smoothstep(40.0, 200.0, h - fy);
  h += 14.0 * (n3(vec3(x, 5.0, z) / 190.0) - 0.5) * floorish + 3.5 * (n3(vec3(x, 3.0, z) / 41.0) - 0.5) * (1.0 - smoothstep(4.0, 16.0, px))
     + 1.2 * (n3(vec3(x, 9.0, z) / 9.0) - 0.5) * (1.0 - smoothstep(1.0, 4.0, px));
  return h;
}
float ground(vec2 xz, float lod){ return land(xz, lod); }
// where the lake is (and not a puddle in a hollow of the forest floor)
float lakeMask(vec2 xz){
  float d = abs(xz.x - valleyX(xz.y)), lw = mix(260.0, 520.0, n3(vec3(xz.y / 1300.0, 6.1, 2.3)));
  return (1.0 - smoothstep(lw * 0.75, lw * 0.95, d)) * smoothstep(5800.0, 7200.0, xz.y) * (1.0 - smoothstep(10300.0, 11300.0, xz.y));
}

// The land is baked at load into a world texture (~5.7 m texels): its height, how dense the forest
// is, and how much of it is birch. Finer detail is added live, where a pixel is small enough to see it.
const vec2 LAND0 = vec2(-2800.0, -700.0), LANDS = vec2(5800.0, 13300.0);
const float FAR0 = 560.0, FAR1 = 680.0;                           // trees one by one up to here; a canopy beyond
float landH(vec2 xz, float px){
  vec2 st = (xz - LAND0) / LANDS;
  if (uLandOn == 1 && all(greaterThan(st, vec2(0.002))) && all(lessThan(st, vec2(0.998)))){
    float h = textureLod(uLand, st, 0.0).x, k = 1.0 - smoothstep(1.0, 4.0, px);
    if (k > 0.0) h += k * (1.2 * (n3(vec3(xz.x, 9.0, xz.y) / 9.0) - 0.5) + 0.35 * (n3(vec3(xz.x, 4.0, xz.y) / 2.7) - 0.5));
    return h;
  }
  return land(xz, px / uPix);
}
// the forest: below a ragged treeline, above the water, off the steepest ground, in stands and
// glades; mountain birch takes over in the last hundred metres below the treeline
float treeline(vec2 xz){ return -330.0 + 70.0 * (n3(vec3(xz.x / 400.0, 2.0, xz.y / 400.0)) - 0.5); }
float trailX(float z){ return valleyX(z) - 180.0 + 45.0 * sin(z / 210.0); }
float trailDist(vec2 xz){ return xz.y > 9900.0 && xz.y < 11800.0 ? abs(xz.x - trailX(xz.y)) : 1e5; }
vec2 forestAt(vec2 xz, float h, float slope){
  float tl = treeline(xz);
  float d = smoothstep(tl + 30.0, tl - 50.0, h) * mix(1.0, smoothstep(WATER + 0.6, WATER + 3.5, h), lakeMask(xz)) * (1.0 - smoothstep(0.55, 0.9, slope));
  d *= 0.3 + 0.7 * smoothstep(0.32, 0.58, n3(vec3(xz.x, 7.0, xz.y) / 240.0));
  d *= smoothstep(0.18, 0.42, n3(vec3(xz.x, 3.0, xz.y) / 90.0) + 0.22);
  d *= smoothstep(2.6, 6.0, trailDist(xz));                            // the trail to the lake
  return vec2(d, 0.06 + 0.8 * smoothstep(tl - 150.0, tl - 10.0, h));
}

// ---- the climber, in local coordinates: x across, y up, z into the wall. Metres.
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }
float sdBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }

vec2 climber(vec3 q){
  vec3 b = vec3(q.x, q.y, -q.z);
  float t = uTime;
  float swing = fract(t / 7.0); swing = swing > 0.78 ? sin(3.14159 * (swing - 0.78) / 0.22) : 0.0;
  float kick = fract(t / 7.0 + 0.45); kick = kick > 0.8 ? sin(3.14159 * (kick - 0.8) / 0.2) : 0.0;
  float breath = 0.006 * sin(t * 1.4);
  vec3 eR = vec3(0.31, 1.62, 0.25) + vec3(0.0, 0.05, -0.1) * swing;
  vec3 hR = vec3(0.24, 1.92, 0.55) + vec3(0.0, 0.10, -0.24) * swing;
  vec3 tR = hR + mix(vec3(0.0, 0.42, 0.26), vec3(0.0, 0.32, -0.06), swing);
  vec3 hL = vec3(-0.27, 1.60, 0.47), tL = hL + vec3(0.0, 0.40, 0.25);
  vec3 sR = vec3(0.18, 1.44 + breath, 0.06), sL = vec3(-0.18, 1.44 + breath, 0.06);
  vec3 kL = vec3(-0.16, 0.72, -0.03) + vec3(0.0, 0.04, -0.08) * kick, fL = vec3(-0.14, 0.40, 0.12) + vec3(0.0, 0.05, -0.12) * kick;
  // jacket: torso, hood, arms; a few millimetres of flutter
  float flutter = 0.005 * sin(38.0 * b.y + 9.0 * t) * sin(27.0 * b.x + 7.0 * t);
  float jk = sdCap(b, vec3(0.0, 1.0, -0.03), vec3(0.0, 1.37 + breath, 0.05), 0.16) + flutter;
  jk = smin(jk, sdCap(b, sR, eR, 0.058), 0.04);
  jk = min(jk, sdCap(b, eR, hR, 0.05));
  jk = smin(jk, sdCap(b, sL, vec3(-0.33, 1.35, 0.23), 0.058), 0.04);
  jk = min(jk, sdCap(b, vec3(-0.33, 1.35, 0.23), hL, 0.05));
  jk = smin(jk, sdCap(b, vec3(0.0, 1.48, 0.05), vec3(0.0, 1.56, 0.09), 0.085), 0.05);
  // dark: trousers, boots, a slim pack, harness, gloves
  float dk = sdBox(b - vec3(0.0, 1.25, -0.18), vec3(0.085, 0.14, 0.035), 0.05);
  dk = min(dk, sdCap(b, vec3(0.09, 0.96, -0.07), vec3(0.14, 0.52, -0.07), 0.075));
  dk = min(dk, sdCap(b, vec3(0.14, 0.52, -0.07), vec3(0.13, 0.13, -0.01), 0.062));
  dk = min(dk, sdCap(b, vec3(-0.09, 0.96, -0.07), kL, 0.075));
  dk = min(dk, sdCap(b, kL, fL, 0.062));
  dk = min(dk, sdBox(b - vec3(0.13, 0.07, 0.03), vec3(0.042, 0.045, 0.1), 0.02));
  dk = min(dk, sdBox(b - fL - vec3(0.0, -0.05, 0.05), vec3(0.042, 0.045, 0.1), 0.02));
  dk = min(dk, sdCap(b, vec3(-0.15, 0.93, -0.02), vec3(0.15, 0.93, -0.02), 0.035));
  dk = min(dk, length(b - hR) - 0.048); dk = min(dk, length(b - hL) - 0.048);
  float hd = length(b - vec3(0.0, 1.66 + breath, 0.11)) - 0.112;             // helmet
  float tl = min(sdCap(b, hR, tR, 0.013), sdCap(b, tR, tR + vec3(0.0, -0.05, 0.25), 0.009));
  tl = min(tl, min(sdCap(b, hL, tL, 0.013), sdCap(b, tL, tL + vec3(0.0, -0.05, 0.25), 0.009)));
  vec2 r = vec2(jk, 1.0);
  if (dk < r.x) r = vec2(dk, 2.0);
  if (hd < r.x) r = vec2(hd, 3.0);
  if (tl < r.x) r = vec2(tl, 5.0);
  return r;
}

// the rope, from the harness down the couloir to an anchor out of sight
const vec3 DOWN = normalize(vec3(0.4472136, 0.0, 0.0) - 0.8944272 * TY);
float rope(vec3 p, float lod){
  vec3 h = CLIMB + vec3(0.0, 0.95, 0.16);
  vec3 a = CLIMB + DOWN * 1.1 + NF * 0.42, b = CLIMB + DOWN * 5.0 + NF * 0.07, c = CLIMB + DOWN * 48.0 + NF * 0.07;
  float r = max(0.011, 0.6 * uPix * lod);
  return min(min(sdCap(p, h, a, r), sdCap(p, a, b, r)), sdCap(p, b, c, r));
}

// While a ray is being marched (not for normals or occlusion), the land's term can use the ray: a
// coarse grid holds the highest point of each 64 m block, and a ray above that can go straight to
// the block's edge, or down to that height, instead of creeping over flat ground in small steps.
const vec2 LMN = vec2(91.0, 208.0);
bool marching = false, cheap = false; vec3 marchDir;   // cheap: shading a reflection
// the highest the land (and the massif) stands anywhere ahead of a ray going north or south from
// here: a ray rising above it has nothing left to hit. Outside the baked land, a coarse bound.
float ceilingAhead(vec3 p, vec3 rd){
  vec2 st = (p.xz - LAND0) / LANDS;
  if (uLandOn == 0 || st.x < 0.0 || st.x > 1.0 || abs(rd.x) > 0.8) return 1750.0;
  float row = clamp(floor(st.y * LMN.y), 0.0, LMN.y - 1.0);
  float c = rd.z < 0.0 ? texelFetch(uCeil, ivec2(row, 0), 0).x : texelFetch(uCeil, ivec2(row, 0), 0).y;
  c = max(c, 900.0 * step(0.35, abs(rd.x)));                         // the fells beyond the baked land's sides
  if (rd.z < 0.0){
    // north: the massif and the ranges behind it, unless the ray will already be above them there
    float k = rd.y / max(-rd.z, 1e-3);
    if (p.y + k * max(p.z - 950.0, 0.0) < 1270.0) c = max(c, 1270.0);
    if (p.y + k * max(p.z + 700.0, 0.0) < 1750.0) c = max(c, 1750.0);
  } else c = max(c, 820.0);                                          // south, beyond the baked land
  return c;
}
float landAlong(vec3 p, float lod){
  vec2 st = (p.xz - LAND0) / LANDS;
  if (!marching || uLandOn == 0 || any(lessThan(st, vec2(0.0))) || any(greaterThan(st, vec2(1.0)))) return -1.0;
  // above the highest point of a block of land (1 km down to 64 m, coarsest first): out of the block
  // along the ray, or down to that height, whichever comes first
  vec4 B = texelFetch(uLandMax, ivec2(floor(st * LMN)), 0);
  if (p.y < (lod < FAR0 ? B.w : B.x)) return -1.0;               // (up close there is no canopy shell, only trees)
  vec2 dd = vec2(abs(marchDir.x) < 1e-5 ? 1e-5 : marchDir.x, abs(marchDir.z) < 1e-5 ? 1e-5 : marchDir.z);
  for (int L = 4; L >= 0; L--){
    vec2 N = vec2(textureSize(uLandMax, L));
    vec2 c = min(floor(st * LMN / exp2(float(L))), N - 1.0);     // (a level's last cell takes the odd one left over)
    vec4 M = texelFetch(uLandMax, ivec2(c), L);
    float mx = L == 0 && lod < FAR0 ? M.w : M.x;
    if (p.y < mx) continue;
    vec2 lo = LAND0 + c * exp2(float(L)) * LANDS / LMN;
    vec2 hi = c == N - 1.0 ? LAND0 + LANDS : lo + exp2(float(L)) * LANDS / LMN;
    vec2 tt = (mix(lo, hi, step(0.0, marchDir.xz)) - p.xz) / dd;
    float go = min(tt.x, tt.y) + 0.5;
    if (marchDir.y < 0.0) go = min(go, (p.y - mx) / -marchDir.y);
    // Only what the block itself guarantees (a sphere above its highest point would reach into its
    // neighbours, which may stand higher). And a guarantee too small to tell from a hit is none: at
    // a block's wall or its top, the true distance decides, or the wall would read as a surface.
    if (go <= 2.0 * max(0.5 * uPix * lod, min(0.0025 * lod, 1.5))) return -1.0;
    return go;
  }
  return -1.0;
  return -1.0;
}
vec2 map(vec3 p, float lod){
  float m = massif(p, lod), mat = matOut;
  float gd = (p.y - 1750.0) * 0.55;                        // nothing on the land stands higher
  bool skip = false;
  if (gd < m + 45.0){
    float a = landAlong(p, lod);
    if (a > 0.0){ gd = a; skip = true; }
    else {
      float h = landH(p.xz, lod * uPix), far = smoothstep(FAR0, FAR1, lod) * float(uLandOn);
      if (far > 0.0){                                                 // the far forest: a canopy, crowns and gaps
        vec4 L = textureLod(uLand, (p.xz - LAND0) / LANDS, 0.0);
        h += far * L.y * (11.0 + 7.0 * n3(vec3(p.x, 1.0, p.z) / 14.0) + 4.0 * n3(vec3(p.x, 5.0, p.z) / 4.5));
      }
      gd = (p.y - h) * 0.55;
    }
  }
  // the massif's foot is filleted into the land, but only with true distances: a skip along the ray
  // is not one, and blended it would raise the mountain's surface in the pattern of the blocks
  vec2 r = vec2(skip || !massifTrue ? min(m, gd) : smin(m, gd, 45.0), m < gd ? mat : 11.0);
  if (uBake == 1 || lod > 1500.0) return r;              // the bake is of the mountain alone; from afar, so is the view
  vec3 q = p - CLIMB;
  float inflate = 0.75 * uPix * lod;                    // never thinner than a pixel: no shimmering speck
  float bound = length(q - vec3(0.0, 1.0, 0.0)) - 1.6;
  if (bound < r.x + inflate){ vec2 c = climber(q); c.x -= inflate; if (c.x < r.x) r = c; }
  if (dot(q, q) < 3000.0){ float rp = rope(p, lod); if (rp < r.x) r = vec2(rp, 4.0); }
  return r;
}

vec3 normal(vec3 p, float t){
  float e = max(0.5 * uPix * t, 0.004); const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy*e, t).x + k.yyx * map(p + k.yyx*e, t).x + k.yxy * map(p + k.yxy*e, t).x + k.xxx * map(p + k.xxx*e, t).x);
}

// the sun's shadow only needs the large forms: detail finer than 4 m is left to the occlusion
float shadow(vec3 ro, vec3 rd, float lod){
  float res = 1.0, t = max(0.05 + lod * 0.002, 2.0), floorLod = 4.0 / uPix;
  for (int i = 0; i < 18; i++){
    float h = map(ro + rd*t, max(lod * 4.0 + t * 3.0, floorLod)).x;
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.03 + t * 0.03, 120.0);
    if (res < 0.01 || t > 500.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n, float t){
  float s = clamp(t * 0.01, 0.08, 7.0), o = 0.0, w = 1.0;
  int cnt = uQuality > 0 ? 4 : 2;
  exact = true;
  float lod = max(t, 1.2 / uPix);                                       // nothing under a metre matters at this reach
  for (int i = 1; i <= 4; i++){ if (i > cnt) break; float h = s * float(i); o += w * (h - map(p + n*h, lod).x); w *= 0.62; }
  exact = false;
  return clamp(1.0 - o / (s * 2.2), 0.0, 1.0);
}

vec3 fogColor(vec3 rd){
  float s = max(dot(rd, uSunDir), 0.0);
  vec3 sky = mix(uFogCol * (1.0 + 0.25 * rd.y), uZenith, smoothstep(0.0, 0.6, rd.y));
  return sky + uSunCol * (0.05 * pow(s, 5.0) + 0.06 * pow(s, 40.0) + uDisk * (0.35 * pow(s, 300.0) + 6.0 * smoothstep(0.99985, 0.99992, s)));
}

// fog: uniform haze + an exponential layer that thins with altitude
float fogAmount(vec3 ro, vec3 rd, float t){
  float b = 1.0 / 420.0, base = uFogBase;                       // the haze's floor: the valley at dawn, the cloud sea on the wall
  float k = abs(rd.y) < 1e-4 ? t : (1.0 - exp(-t * rd.y * b)) / (rd.y * b);
  return 1.0 - exp(-uFogDen * (0.55 * t + 1.6 * exp(-(ro.y - base) * b) * k));
}

`;

const SCENE_FS = COMMON + `
out vec4 outColor;

// sub-metre rock: fractures and grain. Shading only (as geometry it would need tiny steps), and
// faded with distance before it can sparkle
float grain(vec3 q){
  float a = 1.0 - abs(2.0 * n3(q) - 1.0), b = 1.0 - abs(2.0 * n3(q * 2.1 + 3.7) - 1.0);
  return a * a * 0.6 + b * b * 0.3 + n3(q * 4.3 + 1.9) * 0.1;
}


// ---- the forest. One tree at most in each 8 m cell, and never reaching out of it, so a ray can walk
// the grid cell by cell (a 2D DDA), test each tree's bounding cylinder, and march only the tree it
// meets. Norway spruce mostly, Scots pine, and mountain birch gone gold near the treeline.
const float TC = 6.0;
vec4 hash44(vec2 p){ vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); q += dot(q, q.wzxy + 33.33); return fract((q.xxyz + q.yzzw) * q.zywx); }
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
struct Tree { vec3 base; float H, R, kind, seed; };
Tree treeHit; float treePart, forestReach = 1e9;   // how far the last tree walk actually looked
bool treeIn(vec2 cell, out Tree tr){
  vec4 h = hash44(cell);
  vec2 xz = (cell + 0.5 + (h.xy - 0.5) * 0.3) * TC;
  vec4 L = textureLod(uLand, (xz - LAND0) / LANDS, 0.0);
  tr.base = vec3(xz.x, L.x, xz.y); tr.seed = h.z;
  // a granite boulder, moss on its back, in one cell in fourteen of the forest and its edges
  if (fract(h.w * 31.7) < 0.07 && L.x > WATER + 0.5 && L.y > 0.04){
    tr.kind = 3.0; tr.H = mix(0.8, 2.4, fract(h.x * 5.3)); tr.R = tr.H * mix(1.0, 1.6, h.z); return true;
  }
  if (h.z > L.y * 1.25) return false;
  float r = fract(h.w * 7.13);
  tr.kind = h.w < L.z ? 2.0 : (r < 0.16 ? 1.0 : 0.0);
  float young = step(0.82, fract(h.y * 11.3));                     // saplings among the grown trees
  tr.H = mix(9.0, 24.0, fract(h.x * 13.7 + h.y)) * (0.72 + 0.28 * L.y) * (tr.kind > 1.5 ? 0.55 : 1.0) * mix(1.0, 0.22, young);
  tr.R = min(tr.kind < 0.5 ? 0.12 * tr.H : tr.kind < 1.5 ? 0.15 * tr.H : 0.24 * tr.H, 2.05);   // northern spruce is slender
  return true;
}
float treeSDF(vec3 q, Tree tr, float px, out float part){
  float r = length(q.xz), y = q.y, H = tr.H, R = tr.R, s = tr.seed, a = atan(q.z, q.x);
  float trunk, crown;
  if (tr.kind > 2.5){
    // a boulder: a flattened, lumpy block half sunk into the moss
    vec3 b = (q - vec3(0.0, -0.35 * H, 0.0)) / vec3(R, H, R * 0.8);
    float d = (length(b) - 1.0) * min(H, R * 0.8) + 0.25 * H * (n3(q * 0.9 + s * 13.0) - 0.5);
    part = 2.0;
    return d;
  }
  if (tr.kind < 0.5){
    // spruce: a narrow cone with a sharp tip. Its whorls tilt and break around the trunk; each has
    // seven to ten branches of their own lengths, drooping at the tips, the needles in clumps
    trunk = max(r - 0.07 - 0.011 * H * (1.0 - y / H), max(y - H, -y - 5.0));
    float k = y / H, c0 = 0.03 + 0.15 * fract(s * 7.3);
    float prof = pow(clamp((1.0 - k) / (1.0 - c0), 0.0, 1.0), 0.85) * smoothstep(c0 - 0.05, c0 + 0.03, k);
    float sp = 0.6 + 0.3 * s, yy = y / sp + 0.35 * sin(a * 2.0 + s * 9.0) + 0.15 * sin(a * 5.0 + y);
    float wi = floor(yy), tier = fract(yy);
    float nb = 7.0 + floor(4.0 * hash11(wi * 1.3 + s));
    float br = hash11(floor(a / 6.2832 * nb + 0.5) + wi * 17.0 + s * 3.0);
    float lobe = 0.5 + 0.5 * pow(abs(cos(a * nb * 0.5 + hash11(wi + 3.1) * 6.3)), 0.4) * (0.65 + 0.35 * br);
    float rr = R * prof * (0.72 + 0.35 * hash11(wi + s * 91.0)) * lobe * (0.72 + 0.28 * (1.0 - tier));
    rr = max(rr, 0.09 * smoothstep(1.0, 0.93, k));
    crown = max((r - rr) * 0.4, y - H - 0.15);
  } else if (tr.kind < 1.5){
    // Scots pine: a long clear trunk and a crown of branch clumps on staggered whorls, flat and uneven
    vec3 b = q - vec3(sin(s * 23.0) * 0.02 * y, 0.0, cos(s * 23.0) * 0.02 * y);
    trunk = max(length(b.xz) - 0.1 - 0.009 * H * (1.0 - y / H), max(y - H * 0.92, -y - 5.0));
    crown = 1e5;
    for (int i = 0; i < 6; i++){
      float fi = float(i), an = s * 20.0 + fi * 2.4 + hash11(fi + s) * 1.5, dd = R * (0.2 + 0.6 * hash11(fi * 1.7 + s * 13.0));
      vec3 o = vec3(cos(an) * dd, H * (0.64 + 0.055 * fi) + 0.6 * hash11(fi * 3.0 + s), sin(an) * dd);
      vec3 e = vec3(R * (0.34 + 0.2 * hash11(fi + s * 5.0)), 0.32 + 0.25 * hash11(fi + s * 7.0), R * (0.3 + 0.2 * hash11(fi + s * 9.0)));
      crown = smin(crown, (length((b - o) / e) - 1.0) * min(min(e.x, e.y), e.z), 0.7);
    }
    crown += 0.5 * (n3(q * 0.9 + s * 17.0) - 0.5) + 0.2 * (n3(q * 2.7 + s * 5.0) - 0.5);
  } else {
    // mountain birch: a white, slightly bent stem, an airy gold crown with the sky through it
    vec3 b = q - vec3(sin(s * 40.0) * 0.05 * y, 0.0, cos(s * 40.0) * 0.05 * y);
    trunk = max(length(b.xz) - 0.06, max(y - H * 0.8, -y - 5.0));
    vec3 e = vec3(R, H * 0.36, R);
    crown = (length((q - vec3(0.0, H * 0.63, 0.0)) / e) - 1.0) * min(e.x, e.y);
    crown += 0.7 * (n3(q * 0.8 + s * 29.0) - 0.45);
  }
  if (px < 0.35) crown += (tr.kind > 1.5 ? 0.3 : 0.22) * (n3(q * 2.3 + s * 31.0) - 0.5) * (1.0 - smoothstep(0.1, 0.35, px));   // needle clumps, leaf gaps
  part = trunk < crown ? 1.0 : 0.0;
  return min(trunk, crown);
}
// A far tree (a few pixels tall) is not marched: it is a cone (spruce) or a flattened ellipsoid
// (pine, birch crowns), intersected exactly. Its normal comes with it.
vec3 treeFarN;
float treeFar(vec3 ro, vec3 rd, Tree tr, float ta, float tb){
  float t = 1e9;
  if (tr.kind < 0.5){
    vec3 o = ro - (tr.base + vec3(0.0, tr.H, 0.0));                   // apex at the origin, the cone opening down
    float k = tr.R / (tr.H * 0.92), k2 = k * k;
    float a = rd.x * rd.x + rd.z * rd.z - k2 * rd.y * rd.y, b = o.x * rd.x + o.z * rd.z - k2 * o.y * rd.y, c = o.x * o.x + o.z * o.z - k2 * o.y * o.y;
    float disc = b * b - a * c;
    if (disc < 0.0 || abs(a) < 1e-6) return 1e9;
    float sq = sqrt(disc);
    for (int i = 0; i < 2; i++){
      float tt = (-b + (i == 0 ? -sq : sq)) / a;
      float y = o.y + rd.y * tt;
      if (tt > ta && tt < tb && y < 0.0 && y > -tr.H * 0.92){ t = tt; vec3 q = o + rd * tt; treeFarN = normalize(vec3(q.x, -k2 * q.y, q.z)); break; }
    }
  } else {
    vec3 c = tr.base + vec3(0.0, tr.kind > 2.5 ? -0.35 * tr.H : tr.kind < 1.5 ? tr.H * 0.8 : tr.H * 0.63, 0.0);
    vec3 e = tr.kind > 2.5 ? vec3(tr.R, tr.H, tr.R * 0.8) : tr.kind < 1.5 ? vec3(tr.R * 0.85, tr.H * 0.13, tr.R * 0.85) : vec3(tr.R, tr.H * 0.36, tr.R);
    vec3 o = (ro - c) / e, d = rd / e;
    float a = dot(d, d), b = dot(o, d), cc = dot(o, o) - 1.0, disc = b * b - a * cc;
    if (disc < 0.0) return 1e9;
    float tt = (-b - sqrt(disc)) / a;
    if (tt > ta && tt < tb){ t = tt; treeFarN = normalize((o + d * tt) / e); }
  }
  return t;
}
// walk the ray through the forest's slab; the first tree it meets is the nearest
float traceForest(vec3 ro, vec3 rd, float tmax, int maxCells){
  forestReach = 0.0;
  if (uLandOn == 0) return 1e9;
  const float TOP = -270.0, BOT = WATER - 2.0;
  float t0 = 0.0, t1 = min(tmax, FAR1);                           // beyond, the forest is a canopy over the land
  if (abs(rd.y) > 1e-5){ float ta = (TOP - ro.y) / rd.y, tb = (BOT - ro.y) / rd.y; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (ro.y > TOP || ro.y < BOT) return 1e9;
  forestReach = 1e9;                                               // (a ray that misses the slab misses no trees)
  if (t0 >= t1) return 1e9;
  forestReach = t0;
  vec3 p0 = ro + rd * t0;
  vec2 cell = floor(p0.xz / TC), dir = rd.xz, sgn = vec2(dir.x >= 0.0 ? 1.0 : -1.0, dir.y >= 0.0 ? 1.0 : -1.0);
  vec2 inv = 1.0 / max(abs(dir), vec2(1e-6));
  vec2 tm = t0 + ((cell + max(sgn, 0.0)) * TC - p0.xz) * sgn * inv, td = TC * inv;
  vec2 blk = vec2(-1e5);
  for (int i = 0; i < 220; i++){
    if (i >= maxCells) break;
    float tNext = min(tm.x, tm.y);
    // entering a new 64 m block: if it has no trees, or the ray passes above its canopy, jump it
    vec2 st = ((cell + 0.5) * TC - LAND0) / LANDS, b = floor(st * LMN);
    if (b != blk && all(greaterThanEqual(st, vec2(0.0))) && all(lessThan(st, vec2(1.0)))){
      blk = b;
      vec4 M = texelFetch(uLandMax, ivec2(b), 0);
      vec2 wall = LAND0 + (b + max(sgn, 0.0)) * LANDS / LMN;
      vec2 tw = (wall - ro.xz) * sgn * inv;
      float tExit = min(tw.x, tw.y), tIn = min(tm.x, tm.y) - min(td.x, td.y);
      float yLow = min(ro.y + rd.y * max(tIn, t0), ro.y + rd.y * tExit);
      if (M.y < 0.01 || yLow > M.w + 25.0){                           // no trees, or above the tallest of them
        forestReach = tExit;
        if (tExit > t1){ forestReach = 1e9; break; }
        vec3 pe = ro + rd * (tExit + 0.05);
        cell = floor(pe.xz / TC);
        tm = tExit + 0.05 + ((cell + max(sgn, 0.0)) * TC - pe.xz) * sgn * inv;
        continue;
      }
    }
    Tree tr;
    bool has = treeIn(cell, tr);
    // gone underground (the ground here is known now): the land will be met before any tree beyond
    if (rd.y < 0.0 && ro.y + rd.y * max(tNext - min(td.x, td.y), t0) < tr.base.y - 1.5) break;
    if (has){
      vec2 oc = ro.xz - tr.base.xz; float a = dot(dir, dir), b = dot(oc, dir), c = dot(oc, oc) - (tr.R + 0.4) * (tr.R + 0.4);
      float disc = b * b - a * c;
      if (disc > 0.0){
        float sq = sqrt(disc), ta = (-b - sq) / a, tb = (-b + sq) / a;
        if (abs(rd.y) > 1e-5){ float ya = (tr.base.y - 1.0 - ro.y) / rd.y, yb = (tr.base.y + tr.H + 0.5 - ro.y) / rd.y; ta = max(ta, min(ya, yb)); tb = min(tb, max(ya, yb)); }
        ta = max(ta, t0);
        if (ta < tb && uPix * ta > 0.5){                            // far: exact and cheap
          float tf = treeFar(ro, rd, tr, ta, tb);
          if (tf < 1e8){ treeHit = tr; treePart = -1.0; return tf; }
        } else if (ta < tb){
          float tt = ta, px = uPix * ta, part;
          for (int k = 0; k < 28; k++){
            float d = treeSDF(ro + rd * tt - tr.base, tr, uPix * tt, part);
            if (d < 0.5 * uPix * tt + 0.002){ treeHit = tr; treePart = part; return tt; }
            tt += max(d, 0.01);
            if (tt > tb) break;
          }
        }
      }
    }
    forestReach = tNext;
    if (tNext > t1){ forestReach = t1 >= min(tmax, 2600.0) - 1.0 ? tNext : 1e9; break; }
    if (rd.y > 0.0 && (i & 7) == 0){ vec3 pc = ro + rd * tNext; if (pc.y > ceilingAhead(pc, rd) + 26.0) break; }
    if (tm.x < tm.y){ tm.x += td.x; cell.x += sgn.x; } else { tm.y += td.y; cell.y += sgn.y; }
  }
  return 1e9;
}

vec3 shadeTree(vec3 p, vec3 rd, float t){
  Tree tr = treeHit;
  vec3 q = p - tr.base; float px = uPix * t, pt;
  const vec2 e = vec2(0.02, 0.0);
  float ee = max(0.02, 0.5 * px);
  vec3 n = treePart < -0.5 ? treeFarN : normalize(vec3(treeSDF(q + vec3(ee, 0, 0), tr, px, pt) - treeSDF(q - vec3(ee, 0, 0), tr, px, pt),
                          treeSDF(q + vec3(0, ee, 0), tr, px, pt) - treeSDF(q - vec3(0, ee, 0), tr, px, pt),
                          treeSDF(q + vec3(0, 0, ee), tr, px, pt) - treeSDF(q - vec3(0, 0, ee), tr, px, pt)));
  float k = clamp(q.y / tr.H, 0.0, 1.0), v = n3(q * 0.9 + tr.seed * 17.0);
  // a crown is not a surface: light scatters through needle clumps every way. Its normal is mostly
  // the direction out from the trunk (and up, near the top), jittered clump by clump
  if (treePart < 0.5 && tr.kind < 2.5){
    vec3 away = normalize(vec3(q.x, (q.y - tr.H * (tr.kind < 0.5 ? 0.35 : 0.72)) * 0.6, q.z) + vec3(0.0, 0.001, 0.0));
    vec3 jit = vec3(n3(q * 1.9 + 3.0), n3(q * 1.9 + 7.0), n3(q * 1.9 + 11.0)) - 0.5;
    n = normalize(mix(n, away, 0.6) + jit * 0.8);
  }
  vec3 alb;
  bool stem = treePart > 0.5;   // (-1: a far tree, crown only)
  bool rock = tr.kind > 2.5;
  if (rock){
    // granite, grey with a little pink, moss and lichen on its back
    alb = mix(vec3(0.11, 0.11, 0.105), vec3(0.14, 0.125, 0.115), n3(q * 1.7 + 3.0)) * (0.75 + 0.5 * v);
    alb = mix(alb, vec3(0.04, 0.065, 0.022), smoothstep(0.2, 0.6, n.y + 0.4 * (n3(q * 2.1) - 0.5)));
    alb = mix(alb, vec3(0.28, 0.3, 0.24), smoothstep(0.7, 0.85, n3(q * 3.3 + 1.0)) * 0.5);
  }
  else if (stem) alb = tr.kind > 1.5 ? mix(vec3(0.55, 0.54, 0.5), vec3(0.04), step(0.72, n3(q * vec3(3.0, 9.0, 3.0))))
                : tr.kind > 0.5 ? mix(vec3(0.085, 0.07, 0.06), vec3(0.24, 0.13, 0.07), smoothstep(0.35, 0.75, k)) : vec3(0.06, 0.05, 0.042);
  else alb = (tr.kind > 1.5 ? vec3(0.26, 0.16, 0.045) : tr.kind > 0.5 ? vec3(0.028, 0.045, 0.024) : vec3(0.018, 0.036, 0.022)) * (0.65 + 0.7 * v);
  // light: the inside and the underside of a crown are dark; needles glow a little with the sun behind
  float occ = rock ? 0.8 : stem ? 0.55 : mix(0.3, 1.0, k) * (0.65 + 0.35 * v);
  float ndl = treePart < 0.5 && !rock ? (dot(n, uSunDir) + 0.35) / 1.35 : dot(n, uSunDir);
  float back = stem || rock ? 0.0 : pow(max(dot(rd, uSunDir), 0.0), 4.0) * (tr.kind > 1.5 ? 1.2 : 0.55);
  float sunVis = rock ? 0.4 : mix(0.35, 1.0, smoothstep(0.2, 0.9, k));   // low in the forest the sun rarely gets through
  vec3 sky = mix(uFogCol, uZenith, 0.6) * 2.0;
  vec3 lin = uSunCol * (max(ndl, 0.0) * 0.9 + back) * sunVis + sky * (0.45 + 0.55 * n.y) * occ + uFogCol * 0.8 * occ;
  return alb * lin;
}

// ---- the lake: a mirror that the breeze keeps breaking up
float waterH(vec2 xz){ vec2 w = vec2(uTime * 0.6, uTime * 0.35); return n3(vec3((xz + w) / 5.0, 1.3)) * 0.6 + n3(vec3((xz - w * 0.7) / 1.7, 4.1)) * 0.3 + n3(vec3(xz / 21.0 + w * 0.02, 7.7)) * 0.9; }

vec3 shade(vec3 p, vec3 rd, float t, float mat){
  float px = t * uPix;
  bool terrain = mat < 0.5 || (mat > 5.5 && mat < 6.5), isLand = mat > 10.5 && mat < 11.5;
  vec3 n, alb; float spec = 0.0, snow = 0.0, occ = 1.0, sh = -1.0, hollowL = 0.0;
  // on the baked face the normal, the snow, the occlusion and the sun's shadow are already known
  vec3 f = faceUVW(p);
  bool baked = false; vec4 b1 = vec4(0.0); vec2 b2 = vec2(1.0);
  if (terrain && uHF == 1 && hfEdge(f.xy) > 0.0){
    vec2 st = hfST(f.xy), b0 = textureLod(uHF0, st, 0.0).xy;
    if (b0.y > 0.999 && abs(f.z - b0.x) < 3.0){ baked = true; b1 = textureLod(uHF1, st, 0.0); b2 = textureLod(uHF2, st, 0.0).xy; }
  }
  if (baked){
    vec2 nxy = b1.xy * 2.0 - 1.0;
    n = normalize(vec3(nxy.x, 0.0, 0.0) + nxy.y * TY + sqrt(max(1.0 - dot(nxy, nxy), 0.0)) * NF);
    if (mat < 5.5 && crags(f, px) != 0.0) n = normal(p, t);              // the crags have their own light
    occ = b1.w; sh = mix(b2.x, b2.y, uSunMix);
  } else if (isLand && p.z > 900.0){
    // the land is a heightfield: its normal from the heights, its occlusion from how hollow it is,
    // and the forest's own shade on the floor beneath it
    float e = max(0.6, px * 1.5), h0 = landH(p.xz, px);
    float hx = landH(p.xz + vec2(e, 0.0), px), hz = landH(p.xz + vec2(0.0, e), px);
    n = normalize(vec3(h0 - hx, e, h0 - hz));
    float E = max(12.0, px * 8.0), hollow = cheap ? 0.0 : (landH(p.xz + vec2(E, 0.0), px) + landH(p.xz - vec2(E, 0.0), px) + landH(p.xz + vec2(0.0, E), px) + landH(p.xz - vec2(0.0, E), px)) * 0.25 - h0;
    float fd = textureLod(uLand, (p.xz - LAND0) / LANDS, 0.0).y * float(uLandOn) * (1.0 - max(smoothstep(FAR0, FAR1, t), smoothstep(forestReach - 40.0, forestReach + 10.0, t)));
    occ = clamp(1.0 - hollow / (E * 1.5), 0.45, 1.0) * mix(1.0, 0.45, fd);
    hollowL = hollow / E;
    sh = occ * mix(1.0, 0.3, fd);
  } else {
    n = normal(p, t);
    occ = t < 3500.0 && !cheap ? ao(p, n, t) : 1.0;
  }
  if (isLand){
    // autumn in the valley: a dark mossy forest floor, reindeer lichen on the dry ground, rust and
    // olive heath above the treeline, bare rock where it steepens, the first snow on the heights,
    // and the cirque under the face still in winter
    float lo = 1.0 - smoothstep(3.0, 12.0, px);
    float v = n3(p / 31.0), w = mix(0.5, n3(p / 5.3), lo), slope = 1.0 - n.y;
    float tl = -330.0 + 70.0 * (v - 0.5);
    // the forest floor: moss and blueberry, needle litter, a little pale reindeer lichen; the path
    vec3 moss = mix(vec3(0.024, 0.050, 0.018), vec3(0.034, 0.040, 0.018), smoothstep(0.35, 0.65, n3(p / 1.9))) * (0.8 + 0.4 * v);
    moss = mix(moss, vec3(0.055, 0.042, 0.026), smoothstep(0.6, 0.75, n3(p / 7.0 + 5.0)) * 0.5);
    moss = mix(moss, vec3(0.13, 0.145, 0.105), smoothstep(0.7, 0.84, n3(p / 3.1 + 9.0)) * 0.55 * lo);
    float path = 1.0 - smoothstep(0.35, 0.8, trailDist(p.xz) + 0.25 * (n3(p / 1.3) - 0.5));
    moss = mix(moss, vec3(0.075, 0.058, 0.042) * (0.7 + 0.6 * n3(p / 0.4)), path);
    vec3 heath = mix(vec3(0.10, 0.052, 0.030), vec3(0.070, 0.062, 0.034), w);
    alb = mix(moss, heath, smoothstep(tl - 40.0, tl + 70.0, p.y));
    // beyond the trees drawn one by one (2.6 km), the forest is the colour of its canopy
    vec4 Ld = textureLod(uLand, (p.xz - LAND0) / LANDS, 0.0);
    float canopy = Ld.y * max(smoothstep(FAR0, FAR1, t), smoothstep(forestReach - 40.0, forestReach + 10.0, t)) * float(uLandOn);
    float crowns = n3(vec3(p.x, 1.0, p.z) / 14.0) * 0.6 + n3(vec3(p.x, 5.0, p.z) / 4.5) * 0.4;
    alb = mix(alb, mix(vec3(0.016, 0.03, 0.02), vec3(0.28, 0.18, 0.045), Ld.z * 0.6 * step(0.62, n3(p / 23.0))) * (0.45 + 1.1 * crowns), canopy);
    occ *= mix(1.0, 0.55 + 0.5 * crowns, canopy);
    alb = mix(alb, vec3(0.12, 0.12, 0.115) * (0.8 + 0.4 * v), smoothstep(0.32, 0.52, slope + 0.2 * (w - 0.5)));
    alb = mix(alb, vec3(0.16, 0.155, 0.145) * (0.7 + 0.6 * w), smoothstep(0.62, 0.8, n3(vec3(p.x, 6.0, p.z) / 160.0)) * smoothstep(tl, tl + 200.0, p.y) * lo);   // boulder fields
    // autumn's first snow: patchy, blown off the backs and the rocky steps of the fells and packed
    // into the gullies and hollows; heavier with height, but never a sheet
    float sl = -60.0 + 160.0 * (v - 0.5);
    float drift = n3(vec3(p.x / 70.0, p.y / 30.0, p.z / 70.0) + 2.0) * 0.65 + n3(vec3(p.x, 3.0, p.z) / 260.0) * 0.35;
    float lee = smoothstep(-0.2, 0.3, hollowL);                       // hollows hold it, crests lose it
    snow = smoothstep(sl, sl + 420.0, p.y) * smoothstep(0.55, 0.75, n.y + 0.15 * (w - 0.5))
         * smoothstep(0.34, 0.6, drift + 0.3 * lee + 0.18 * smoothstep(sl + 300.0, sl + 800.0, p.y) - 0.1);
    snow = max(snow, (1.0 - smoothstep(900.0, 2800.0, p.z)) * smoothstep(-100.0, 400.0, p.z) * (1.0 - smoothstep(60.0, 260.0, p.y)) * smoothstep(0.45, 0.65, n.y + 0.2 * (w - 0.5)));   // the cirque floor under the face
    alb = mix(alb, vec3(0.78, 0.81, 0.86) * (0.94 + 0.06 * w), snow);
    spec = mix(0.01, 0.03, snow);
  } else if (terrain){
    float lo = 1.0 - smoothstep(3.0, 12.0, px);                          // metre-scale colour, faded before it sparkles
    float v = n3(p / 23.0), w = mix(0.5, n3(p / 4.7), lo);
    // dark cold rock, a little warmer where iron stains the bedding
    vec3 rk = vec3(0.050, 0.052, 0.057) * (0.72 + 0.56 * v) * mix(vec3(1.0), vec3(1.1, 1.0, 0.9), n3(p / 170.0));
    float band = n3(vec3((dot(f, SF) + 7.0 * n3(f / 80.0 + 7.1)) / 21.0, f.x / 400.0, 0.7));
    rk *= mix(vec3(1.0), vec3(1.3, 1.1, 0.92), smoothstep(0.56, 0.76, band));
    // on the baked face, where a texel is wider than a pixel, the crags it cannot hold come back as
    // shading: a ridged relief of a few metres, faded in only where it is finer than the bake
    if (baked && mat < 5.5){
      vec2 tm = 2.0 / (uHFN * hfDS(f.xy - HFC));                          // the texel here, in metres
      float gap = smoothstep(1.5, 4.0, max(tm.x, tm.y) / max(px, 0.02)) * (1.0 - smoothstep(1.5, 6.0, px));
      if (gap > 0.0){
        vec3 q = p / 5.5; const float e = 0.1;
        float c1 = grain(q);
        vec3 gr = (vec3(grain(q + vec3(e, 0.0, 0.0)), grain(q + vec3(0.0, e, 0.0)), grain(q + vec3(0.0, 0.0, e))) - c1) / e;
        n = normalize(n - (gr - n * dot(gr, n)) * 0.3 * gap);
        occ *= mix(1.0, 0.75 + 0.35 * c1, gap);
      }
    }
    // the rock's grain: fractures under a metre, as a tilt of the normal
    vec3 nb = n; float c0 = 0.5, bump = mat < 5.5 ? 1.0 - smoothstep(0.08, 0.4, px) : 0.0;
    if (bump > 0.0){
      vec3 q = p / 1.7; const float e = 0.12;
      c0 = grain(q);
      vec3 gr = (vec3(grain(q + vec3(e, 0.0, 0.0)), grain(q + vec3(0.0, e, 0.0)), grain(q + vec3(0.0, 0.0, e))) - c0) / e;
      nb = normalize(n - (gr - n * dot(gr, n)) * 0.25 * bump);
    }
    if (mat > 5.5) snow = 1.0;
    else if (baked){
      float lie = 0.3 + 0.5 * b1.z + 0.05 * (w - 0.5);                   // the baked lie of the land, thresholded here
      snow = smoothstep(0.55, 0.61, lie) * smoothstep(0.36, 0.46, nb.y + 0.06 * (w - 0.5) * lo);
    }
    else {
      // snow lies wherever the rock's larger form lies back: ledges, ramps, the tops of blocks.
      // The wind scours it off the ribs and packs it into the grooves (cv: convex > 0, concave < 0),
      // and the rock's grain decides its edge, so the edge is ragged and never a smooth brushstroke.
      // One six-tap stencil on the larger form gives both its normal and its curvature.
      float e = clamp(t * 0.012, 0.6, 12.0), lm = max(t * 5.0 + 40.0, 5.0 / uPix);
      exact = true;
      float c = map(p, lm).x, xp = map(p + vec3(e, 0.0, 0.0), lm).x, xm = map(p - vec3(e, 0.0, 0.0), lm).x;
      float yp = map(p + vec3(0.0, e, 0.0), lm).x, ym = map(p - vec3(0.0, e, 0.0), lm).x;
      float zp = map(p + vec3(0.0, 0.0, e), lm).x, zm = map(p - vec3(0.0, 0.0, e), lm).x;
      exact = false;
      vec3 nM = normalize(vec3(xp - xm, yp - ym, zp - zm));
      float cv = (xp + xm + yp + ym + zp + zm - 6.0 * c) / (6.0 * e);
      float lie = mix(nM.y, n.y, 0.35) - 1.35 * cv + 0.16 * (n3(vec3(p.x / 26.0, p.y / 11.0, p.z / 26.0) + 4.0) - 0.5) + 0.05 * (w - 0.5);
      snow = smoothstep(0.55, 0.61, lie) * smoothstep(0.36, 0.46, nb.y + 0.06 * (w - 0.5) * lo);
      snow = max(snow, (1.0 - smoothstep(0.0, 60.0, p.y - ground(p.xz, t))) * smoothstep(0.2, 0.5, n.y) * (1.0 - smoothstep(120.0, 260.0, p.y)));
    }
    n = normalize(mix(nb, n, snow));                                     // snow is smooth, rock is not
    rk *= mix(1.0, 0.7 + 0.5 * c0, bump);                                // cracks hold shadow and lichen
    alb = mix(rk, vec3(0.78, 0.81, 0.86) * (0.94 + 0.06 * w), snow);
    spec = mix(0.015, 0.03, snow);
  } else if (mat < 1.5) alb = vec3(0.52, 0.2, 0.04);       // jacket, the club's rope colour
  else if (mat < 2.5) alb = vec3(0.035, 0.04, 0.05);
  else if (mat < 3.5) alb = vec3(0.62, 0.62, 0.60);
  else if (mat < 4.5){                                    // rope: fade to snow when sub-pixel
    float cover = 0.011 / max(0.011, 0.6 * uPix * t);
    alb = mix(vec3(0.8, 0.84, 0.9), vec3(0.60, 0.28, 0.06), cover);
  } else { alb = vec3(0.3, 0.31, 0.33); spec = 0.5; }
  float ndl = dot(n, uSunDir);
  float dif = mix(max(ndl, 0.0), max((ndl + 0.3) / 1.3, 0.0), snow);   // snow scatters light round its edges
  if (sh < 0.0) sh = dif > 0.001 ? (uQuality > 1 && t < 2600.0 && !cheap ? shadow(p + n * max(0.02, t * 0.002), uSunDir, t) : occ) : 0.0;
  vec3 sky = uFogCol * 2.2 + vec3(0.02, 0.03, 0.05);
  occ = mix(occ, 1.0, 0.45 * snow);                                     // snow lights itself: what it loses to the walls comes back off them
  vec3 lin = uSunCol * dif * sh
           + sky * (0.55 + 0.45 * n.y) * occ
           + uFogCol * 1.4 * (0.5 - 0.5 * n.y) * occ;           // bounce from the snow below
  vec3 col = alb * lin;
  col += spec * uSunCol * pow(max(dot(reflect(rd, n), uSunDir), 0.0), 8.0) * sh;
  if (mat > 0.5 && mat < 5.5 && !isLand) col += alb * uSunCol * 0.35 * pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 3.0) * max(dot(rd, uSunDir) * 0.5 + 0.5, 0.0);  // rim
  return col;
}

// drifting cloud, sampled across the first few hundred metres in front of the camera
vec4 clouds(vec3 ro, vec3 rd, float tHit, vec2 fc){
  if (uCloud < 0.01 && uMist < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  // drifting cloud in the first few hundred metres; at dawn, mist lying on the lake and the valley floor
  float range = min(tHit, uMist > 0.01 ? 1400.0 : 420.0), dt = range / float(uCloudSteps);
  float t = dt * hash12(fc + fract(uTime * 7.31) * 97.0), T = 1.0; vec3 L = vec3(0.0);   // white noise: the resolve averages it away
  vec3 wind = vec3(uTime * 3.0, 0.0, uTime * 1.2);
  vec3 lit = fogColor(rd) * 1.25 + uSunCol * 0.05;
  vec3 mistLit = fogColor(rd) * 0.95 + uSunCol * (0.02 + 0.3 * pow(max(dot(rd, uSunDir), 0.0), 6.0));
  for (int i = 0; i < 16; i++){
    if (i >= uCloudSteps) break;
    vec3 p = ro + rd * t - wind;
    float m = 0.0;
    if (uMist > 0.01 && p.y - WATER < 50.0){ float hm = p.y - WATER; m = uMist * exp(-max(hm, 0.0) / 9.0) * smoothstep(0.35, 0.8, n3(p / vec3(110.0, 12.0, 110.0)) * 0.7 + n3(p / 27.0) * 0.3 + 0.05); }
    if (uCloud < 0.01){ float a = 1.0 - exp(-m * dt * 0.006); L += T * a * mistLit; T *= 1.0 - a; t += dt; continue; }
    float d = n3(p / 110.0) * 0.55 + n3(p / 36.0) * 0.3 + n3(p / 11.0) * 0.15;
    d = (smoothstep(0.46, 0.72, d) + 0.16 * max(uCloud - 1.0, 0.0)) * uCloud * step(t, 420.0);   // thickens, keeps its wisps
    if (m > 0.0){ float am = 1.0 - exp(-m * dt * 0.006); L += T * am * mistLit; T *= 1.0 - am; }
    float a = 1.0 - exp(-d * dt * 0.035);
    L += T * a * lit; T *= 1.0 - a;
    t += dt;
  }
  return vec4(L, T);
}

vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (2.0 * (fc + uJitter) - uRes) / uRes.y;
  vec3 rd = normalize(uCamF * uFocal + uCamR * uv.x + uCamU * uv.y);
  vec3 ro = uCam;
  // beyond this the fog is opaque (optical depth 6.5), so there is nothing to find: along the ray,
  // the height layer is at least 0.63 of its value at the camera for as long as the ray stays low
  float E = 1.6 * exp(-(ro.y - uFogBase) / 420.0), tFog = 6.5 / (uFogDen * (0.55 + 0.63 * E));
  float tEnd = min(uTMax, rd.y * tFog / 420.0 <= 1.0 ? tFog : uTMax);
  // the forest first (its own walk), then the lake's surface, then everything else up to either
  float tTree = traceForest(ro, rd, tEnd, 180);
  float reach0 = forestReach;
  float tWater = rd.y < 0.0 && ro.y > WATER ? (WATER - ro.y) / rd.y : 1e9;
  tEnd = min(tEnd, min(tTree, tWater));
  float t = 1.0, tPrev = 1.0, mat = -1.0; vec2 hLast = vec2(1e9, -1.0);
  marching = true; marchDir = rd;
  for (int i = 0; i < 220; i++){
    if (i >= uSteps) break;
    vec3 p = ro + rd * t;
    if (rd.y > 0.0 && (i & 3) == 0 && p.y > ceilingAhead(p, rd)) { t = tEnd + 1.0; break; }   // nothing ahead stands higher
    vec2 h = map(p, t);
    hLast = h;
    // the land is a heightfield seen at a grazing angle: a looser tolerance there (still well under a
    // pixel of its relief) lets rays skimming the forest floor land instead of creeping to a stop
    if (h.x < (h.y > 10.5 ? max(0.5 * uPix * t, min(0.0025 * t, 1.5)) : 0.5 * uPix * t)){
      mat = h.y;
      if (h.x < 0.0){                                     // overshot a thin crest: bisect back to it
        float a = tPrev, b = t;
        for (int k = 0; k < 5; k++){ float m = 0.5 * (a + b); vec2 hm = map(ro + rd * m, m); if (hm.x < 0.0) { b = m; mat = hm.y; } else a = m; }
        t = b;
      }
      break;
    }
    tPrev = t;
    t += h.y > 10.5 ? max(h.x, 0.003 * t) : h.x * 0.72;
    if (t > tEnd) break;
  }
  marching = false;
  if (mat < -0.5 && t < tEnd && hLast.x < 3.0 * max(0.5 * uPix * t, min(0.0025 * t, 1.5))) mat = hLast.y;   // out of steps, but already at the surface
  vec3 col;
  forestReach = reach0;
  if (t < tEnd && mat > -0.5) col = shade(ro + rd * t, rd, t, mat);
  else if (tTree < 1e8 && tTree <= tWater) { t = tTree; col = shadeTree(ro + rd * t, rd, t); }
  else if (tWater < 1e8 && landH((ro + rd * tWater).xz, uPix * tWater) < WATER + 0.3 && textureLod(uLand, ((ro + rd * tWater).xz - LAND0) / LANDS, 0.0).w > 0.5){
    // the lake: what it mirrors (the far shore, the forest, the sky), broken up by ripples, over dark water
    t = tWater; vec3 p = ro + rd * t;
    float e = 0.4, amp = 0.05 * (1.0 - smoothstep(60.0, 900.0, t));
    float h0 = waterH(p.xz);
    vec3 n = normalize(vec3(-(waterH(p.xz + vec2(e, 0.0)) - h0) * amp / e, 1.0, -(waterH(p.xz + vec2(0.0, e)) - h0) * amp / e));
    vec3 r = reflect(rd, n); r.y = max(r.y, 0.01);
    vec3 q = p + vec3(0.0, 0.05, 0.0);
    float tr = traceForest(q, r, 2500.0, 70), ts = 1.0, ms = -1.0;
    marching = true; marchDir = r;
    for (int k = 0; k < 40; k++){
      vec3 pr = q + r * ts;
      if ((k & 3) == 0 && pr.y > ceilingAhead(pr, r)) break;
      vec2 h = map(pr, ts * 3.0); if (h.x < uPix * ts * 2.0){ ms = h.y; break; } ts += h.x * 0.8; if (ts > min(tr, 6000.0)) break;
    }
    marching = false;
    vec3 refl;
    cheap = true;
    if (ms > -0.5 && ts < tr) refl = shade(q + r * ts, r, ts * 3.0, ms);
    else if (tr < 1e8){ ts = tr; refl = shadeTree(q + r * ts, r, ts); }
    else { ts = uTMax; refl = fogColor(r); }
    cheap = false;
    refl = mix(refl, fogColor(r), fogAmount(q, r, ts));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
    col = mix(vec3(0.004, 0.008, 0.007) * uFogCol * 20.0, refl, fres);
  }
  else { t = uTMax; col = fogColor(rd); }
  col = mix(col, fogColor(rd), fogAmount(ro, rd, t));
  vec4 cl = clouds(ro, rd, t, fc);
  col = col * cl.a + cl.rgb;
  col = aces(col * uExposure * 1.6);
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, col * vec3(0.95, 0.985, 1.04), 1.0 - col.g);           // cold shadows
  outColor = vec4(col, t);                                               // the distance, for reprojection
}`;

// The bake, pass 1: for each texel, march the mountain's full distance function straight into
// the face and keep the height where it meets it (and whether that is the couloir's snow). The
// detail goes down to the texel's own size. Rendered a band of rows per frame.
const BAKE_FS = COMMON + `
out vec4 o0;
void main(){
  vec2 x = hfX(gl_FragCoord.xy / uHFN * 2.0 - 1.0), uv = x + HFC;
  vec2 tex = 2.0 / (uHFN * hfDS(x));                              // this texel, in metres
  float lod = 0.5 * max(tex.x, tex.y);                            // (uPix is 1 here)
  vec3 P0 = S1 + vec3(uv.x, 0.0, 0.0) + TY * uv.y;
  float w = WTOP, d = 1e9, hit = 0.0, mat = 0.0;
  for (int k = 0; k < 200; k++){
    d = massif(P0 + NF * w, lod);
    if (d < 0.015){ hit = 1.0; mat = matOut > 5.5 ? 1.0 : 0.0; break; }
    w -= d;
    if (w < WBOT) break;
  }
  if (hit < 0.5 && w > WBOT && d < 0.6){ hit = 1.0; mat = matOut > 5.5 ? 1.0 : 0.0; }   // ran out of steps on a steep wall
  o0 = vec4(hit > 0.5 ? w : WBOT, hit, mat, 0.0);
}`;

// The bake, pass 2: from the heights, everything shading needs. The normal (face space); snow cover,
// by the same rules the live shader uses (the larger form's normal and curvature, a stencil at ~6 m);
// occlusion at five reaches, near and far; and the sun's shadow at two moments of the morning,
// marched through the heightfield itself.
const DERIVE_FS = COMMON + `
layout(location = 0) out vec4 o1;
layout(location = 1) out vec4 o2;
uniform vec3 uSunA, uSunB;
float hAt(vec2 uv, float fallback){ vec2 h = textureLod(uHF0, hfST(uv), 0.0).xy; return h.y > 0.999 ? h.x : fallback; }
float hfShadow(vec3 f0, vec3 L){
  vec3 lf = vec3(L.x, dot(L, TY), dot(L, NF));
  float res = 1.0, t = 1.5;
  for (int i = 0; i < 44; i++){
    vec3 q = f0 + lf * t;
    if (hfEdge(q.xy) < 0.0 || q.z > WTOP) break;
    vec2 h = textureLod(uHF0, hfST(q.xy), 0.0).xy;
    if (h.y > 0.5) res = min(res, 4.0 * (q.z - h.x + 0.2) / t);
    if (res < 0.001) break;
    t += max(0.8, t * 0.18);
  }
  return clamp(res, 0.0, 1.0);
}
void main(){
  ivec2 ij = ivec2(gl_FragCoord.xy), N = ivec2(uHFN) - 1;
  vec4 c = texelFetch(uHF0, ij, 0);
  if (c.y < 0.5){ o1 = vec4(0.5, 0.5, 0.0, 1.0); o2 = vec4(1.0); return; }
  vec2 x = hfX((vec2(ij) + 0.5) / uHFN * 2.0 - 1.0), uv = x + HFC;
  vec2 tex = 2.0 / (uHFN * hfDS(x));
  vec4 l = texelFetch(uHF0, clamp(ij - ivec2(1, 0), ivec2(0), N), 0), r = texelFetch(uHF0, clamp(ij + ivec2(1, 0), ivec2(0), N), 0);
  vec4 dn = texelFetch(uHF0, clamp(ij - ivec2(0, 1), ivec2(0), N), 0), up = texelFetch(uHF0, clamp(ij + ivec2(0, 1), ivec2(0), N), 0);
  float hl = l.y > 0.5 ? l.x : c.x, hr = r.y > 0.5 ? r.x : c.x, hd = dn.y > 0.5 ? dn.x : c.x, hu = up.y > 0.5 ? up.x : c.x;
  vec3 nf = normalize(vec3(-(hr - hl) / (2.0 * tex.x), -(hu - hd) / (2.0 * tex.y), 1.0));
  vec3 n = normalize(vec3(nf.x, 0.0, 0.0) + nf.y * TY + nf.z * NF);
  vec3 p = S1 + vec3(uv.x, 0.0, 0.0) + TY * uv.y + NF * c.x;
  // snow
  float e = max(6.0, 3.0 * max(tex.x, tex.y));
  float xp = hAt(uv + vec2(e, 0.0), c.x), xm = hAt(uv - vec2(e, 0.0), c.x), yp = hAt(uv + vec2(0.0, e), c.x), ym = hAt(uv - vec2(0.0, e), c.x);
  vec3 mf = normalize(vec3(-(xp - xm) / (2.0 * e), -(yp - ym) / (2.0 * e), 1.0));
  vec3 nM = normalize(vec3(mf.x, 0.0, 0.0) + mf.y * TY + mf.z * NF);
  float cv = -(xp + xm + yp + ym - 4.0 * c.x) / (6.0 * e);
  // stored before any threshold (the live shader thresholds it against its own finer normal), so a
  // snow edge is a smooth contour through the texels and never their staircase. 0..1 spans 0.3..0.8.
  float lie = mix(nM.y, n.y, 0.35) - 1.35 * cv + 0.16 * (n3(vec3(p.x / 26.0, p.y / 11.0, p.z / 26.0) + 4.0) - 0.5);
  lie = max(lie, 0.62 * (1.0 - smoothstep(0.0, 60.0, p.y - ground(p.xz, 1.0))) * (1.0 - smoothstep(120.0, 260.0, p.y)));
  float snow = clamp((lie - 0.3) / 0.5, 0.0, 1.0);
  // occlusion, as the live shader measures it, at a near reach (the creases) and a far one (the
  // gullies), but read from the heights themselves: the distance from a point out along the normal
  // back to the surface is about its clearance above it, times the cosine of the slope
  vec3 f0 = vec3(uv, c.x);
  float oa = 0.0, ob = 0.0, wa = 1.0;
  for (int k = 1; k <= 4; k++){
    float h = 1.5 * float(k), H = 6.0 * float(k);
    vec3 qa = f0 + nf * h, qb = f0 + nf * H;
    oa += wa * (h - 0.8 * max(qa.z - hAt(qa.xy, qa.z - h), 0.0) * nf.z);
    ob += wa * (H - 0.8 * max(qb.z - hAt(qb.xy, qb.z - H), 0.0) * nf.z);
    wa *= 0.62;
  }
  float occ = clamp(1.0 - oa / (1.5 * 2.2), 0.0, 1.0) * mix(1.0, clamp(1.0 - ob / (6.0 * 2.2), 0.0, 1.0), 0.7);
  o1 = vec4(nf.xy * 0.5 + 0.5, snow, occ);
  o2 = vec4(hfShadow(f0 + nf * 0.3, uSunA), hfShadow(f0 + nf * 0.3, uSunB), 0.0, 1.0);
}`;

// The land, baked once at load: height, forest density and birch share, ~5.7 m a texel.
const LAND_FS = COMMON + `
out vec4 o;
uniform vec2 uLandN;
void main(){
  vec2 xz = LAND0 + gl_FragCoord.xy / uLandN * LANDS;
  float h = land(xz, 4.0), e = 6.0;                               // (uPix is 1 here: detail down to 4 m)
  float slope = length(vec2(land(xz + vec2(e, 0.0), 4.0) - h, land(xz + vec2(0.0, e), 4.0) - h)) / e;
  o = vec4(h, forestAt(xz, h, slope), lakeMask(xz));
}`;

// The land's highest point in each 64 m block (plus the detail added live, and a margin).
const LANDMAX_FS = COMMON + `
out vec4 o;
void main(){
  vec2 N = vec2(textureSize(uLand, 0)), c = floor(gl_FragCoord.xy);
  ivec2 a = ivec2(floor(c / LMN * N)) - 1, b = ivec2(ceil((c + 1.0) / LMN * N)) + 1;
  float m = -1e4, f = 0.0, k = 0.0;
  vec2 tx = LANDS / N;                                             // a texel, in metres
  for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++){
    ivec2 q = a + ivec2(i, j);
    if (q.x > b.x || q.y > b.y) continue;
    ivec2 qc = clamp(q, ivec2(0), ivec2(N) - 1);
    vec4 L = texelFetch(uLand, qc, 0);
    float hx = texelFetch(uLand, clamp(qc + ivec2(1, 0), ivec2(0), ivec2(N) - 1), 0).x, hz = texelFetch(uLand, clamp(qc + ivec2(0, 1), ivec2(0), ivec2(N) - 1), 0).x;
    m = max(m, L.x); f = max(f, L.y); k = max(k, max(abs(hx - L.x) / tx.x, abs(hz - L.x) / tx.y));
  }
  o = vec4(m + 3.0 + 22.0 * step(0.01, f), f, k * 1.42, m + 3.0);  // (with the far canopy, up to 22 m on it; the slope, any direction; bare)
}`;

// A coarser level of the max grid: the max of the 2x2 (or 3x3, at an odd edge) cells below it.
const MAXMIP_FS = COMMON + `
out vec4 o;
uniform int uLevel;
void main(){
  // (the base level is set to the one below this, and texelFetch's level counts from the base)
  ivec2 c = ivec2(gl_FragCoord.xy) * 2, N = textureSize(uLandMax, 0) - 1;
  vec4 m = vec4(-1e4, 0.0, 0.0, -1e4);
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) if ((i < 2 && j < 2) || c.x + i == N.x || c.y + j == N.y) m = max(m, texelFetch(uLandMax, min(c + ivec2(i, j), N), 0));
  o = m;
}`;

// For each 64 m row of land: the highest point north of it (x) and south of it (y), massif included.
const CEIL_FS = COMMON + `
out vec4 o;
void main(){
  int row = int(gl_FragCoord.x);
  float n = -1e4, sth = -1e4;
  for (int j = 0; j < 208; j++){
    float m = -1e4;
    for (int i = 0; i < 91; i++) m = max(m, texelFetch(uLandMax, ivec2(i, j), 0).x);
    float z = LAND0.y + (float(j) + 0.5) / LMN.y * LANDS.y;
    if (j <= row) n = max(n, m);
    if (j >= row) sth = max(sth, m);
  }
  o = vec4(n, sth, 0.0, 1.0);
}`;

// The temporal resolve, at device resolution. Each output pixel gathers the current frame's samples
// near it (they land somewhere new every frame), finds where it was a frame ago from the camera and
// the depth, and accumulates. History that no longer fits the neighbourhood's colours is clipped to
// them and trusted less, so fog changes, the climber and the drifting cloud do not ghost.
const RESOLVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uCur, uHist;
uniform vec2 uCurRes, uOutRes, uJitter;
uniform vec3 uCam, uCamR, uCamU, uCamF;
uniform float uFocal, uReset;
uniform mat4 uPrevVP;
out vec4 o;

vec3 ycc(vec3 c){ return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 rgb(vec3 c){ return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

// Catmull-Rom history fetch: nine taps folded into five bilinear ones, so it stays sharp in motion
vec4 history(vec2 uv){
  vec2 sp = uv * uOutRes, tp = floor(sp - 0.5) + 0.5, f = sp - tp;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t12 = (tp + w2 / w12) / uOutRes, t0 = (tp - 1.0) / uOutRes, t3 = (tp + 2.0) / uOutRes;
  float a = w12.x * w0.y, b = w0.x * w12.y, c = w12.x * w12.y, d = w3.x * w12.y, e = w12.x * w3.y;
  vec4 s = texture(uHist, vec2(t12.x, t0.y)) * a + texture(uHist, vec2(t0.x, t12.y)) * b + texture(uHist, t12) * c
         + texture(uHist, vec2(t3.x, t12.y)) * d + texture(uHist, vec2(t12.x, t3.y)) * e;
  return max(s / (a + b + c + d + e), 0.0);
}

void main(){
  vec2 fo = gl_FragCoord.xy;
  vec2 xi = fo / uOutRes * uCurRes;                 // this pixel, in the current frame's pixels
  vec2 k = floor(xi - uJitter);
  float up = uOutRes.y / uCurRes.y, up2 = up * up;
  vec3 near = vec3(0.0), wide = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0);
  float wn = 0.0, ww = 0.0, tNear = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    ivec2 ij = clamp(ivec2(k) + ivec2(i, j), ivec2(0), ivec2(uCurRes) - 1);
    vec4 s = texelFetch(uCur, ij, 0);
    vec2 d = xi - (vec2(ij) + 0.5 + uJitter);
    float dd = dot(d, d), a = exp(-0.75 * dd * up2), b = exp(-2.0 * dd);   // a sample covers about one output pixel
    vec3 y = ycc(s.rgb);
    near += y * a; wn += a; wide += y * b; ww += b;
    m1 += y; m2 += y * y;
    tNear = min(tNear, s.a);                        // the nearest surface wins at edges
  }
  m1 /= 9.0; m2 /= 9.0; wide /= ww;
  vec3 sd = sqrt(max(m2 - m1 * m1, 0.0));
  float cap = 18.0 / up2;                           // about a dozen frames of memory at any upscale
  vec3 h = vec3(0.0); float hw = 0.0;
  vec2 ndc = (2.0 * fo - uOutRes) / uOutRes.y;
  vec3 rd = normalize(uCamF * uFocal + uCamR * ndc.x + uCamU * ndc.y);
  vec4 pc = uPrevVP * vec4(uCam + rd * tNear, 1.0);
  vec2 uv = pc.xy / pc.w * 0.5 + 0.5;
  if (uReset < 0.5 && pc.w > 0.0 && all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))){
    vec4 hs = history(uv);
    h = ycc(hs.rgb); hw = min(hs.a, cap);
    vec3 e = 1.25 * sd + vec3(0.004, 0.002, 0.002), dv = h - m1, u = abs(dv) / e;
    float m = max(u.x, max(u.y, u.z));
    if (m > 1.0){ vec3 c = m1 + dv / m; hw *= exp(-24.0 * length(c - h)); h = c; }
    float vel = length(uv * uOutRes - fo);
    hw *= mix(1.0, 0.72, clamp(vel / 32.0, 0.0, 1.0));   // resampling softens: keep less of it in fast motion
  }
  // what this pixel knows at full resolution: its history and the samples that fell inside it. Where
  // that is little (a fast pan, something just uncovered), a smooth upscale of this frame stands in,
  // instead of whichever single sample happens to be nearest
  float acc = hw + wn;
  vec3 sharp = (h * hw + near) / max(acc, 1e-4);
  vec3 c = mix(wide, sharp, smoothstep(0.05, 0.8, acc));
  o = vec4(rgb(c), min(acc, cap));
}`;

// The finish, at device resolution: a light contrast-adaptive sharpen (after AMD's CAS) to undo what
// resampling softened, the vignette, the paper the cloud turns into, and a dither for the fog.
const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc, uShafts;
uniform vec2 uOutRes;
uniform float uSharp, uVig, uWhite, uTime, uUpscale, uShaft;
uniform vec3 uPaper;
out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 px(ivec2 p){ return texelFetch(uSrc, clamp(p, ivec2(0), ivec2(uOutRes) - 1), 0).rgb; }
void main(){
  vec2 fc = gl_FragCoord.xy, uv = fc / uOutRes;
  vec3 c;
  if (uUpscale > 0.5) c = texture(uSrc, uv).rgb;          // no float targets: a plain upscale
  else {
    ivec2 ip = ivec2(fc);
    vec3 m = px(ip), a = px(ip + ivec2(0, 1)), b = px(ip - ivec2(0, 1)), l = px(ip - ivec2(1, 0)), r = px(ip + ivec2(1, 0));
    vec3 lo = min(m, min(min(a, b), min(l, r))), hi = max(m, max(max(a, b), max(l, r)));
    vec3 amp = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0));
    vec3 w = -amp / mix(8.0, 5.0, uSharp);
    c = (m + (a + b + l + r) * w) / (1.0 + 4.0 * w);
  }
  if (uShaft > 0.001) c += texture(uShafts, uv).rgb * uShaft;          // sun shafts (their own pass)
  vec2 q = uv - 0.5;
  c *= 1.0 - 0.32 * uVig * dot(q, q) * 1.6;
  c = mix(c, uPaper, uWhite);
  c += (hash12(fc + fract(uTime) * 419.0) - 0.5) / 255.0;     // dither the fog gradients
  o = vec4(c, 1.0);
}`;

// Sun shafts, at the scene's resolution: the bright sky between the trunks, drawn out from the sun
// towards the camera. A soft light, so it needs no more resolution than that.
const SHAFT_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uRes, uSun; uniform float uTime;
out vec4 o;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes, dl = (uSun - uv) / 24.0;
  vec2 su = uv + dl * hash12(gl_FragCoord.xy + fract(uTime) * 71.0);
  vec3 sh = vec3(0.0); float w = 1.0;
  for (int i = 0; i < 24; i++){ sh += w * max(texture(uSrc, su).rgb - 0.72, 0.0); w *= 0.93; su += dl; }
  float near = 1.0 - smoothstep(0.1, 0.9, length((uv - uSun) * vec2(uRes.x / uRes.y, 1.0)));
  o = vec4(sh * 0.09 * near * vec3(1.0, 0.86, 0.7), 1.0);
}`;

// Snow: instanced streaks living in a box that travels with the camera, drawn at full resolution
// over the finished frame (moving flakes do not belong in the history).
const SNOW_VS = `#version 300 es
layout(location=0) in vec4 aSeed;
uniform mat4 uVP; uniform vec3 uCam, uVel; uniform float uTime, uScale, uFocalPx, uDen;
uniform vec2 uRes;
out vec2 vQ; out float vA;
const vec3 BOX = vec3(70.0, 44.0, 70.0);
void main(){
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  vec3 wind = vec3(4.5, -1.6, 1.2) * (0.6 + 0.8 * aSeed.w);
  vec3 sway = vec3(sin(uTime * 1.3 + aSeed.x * 40.0), 0.0, cos(uTime * 1.1 + aSeed.z * 40.0)) * 0.6;
  vec3 rel = mod(aSeed.xyz * BOX + wind * uTime + sway - uCam, BOX) - BOX * 0.5;
  vec3 wp = uCam + rel;
  vec4 c0 = uVP * vec4(wp, 1.0);
  vec4 c1 = uVP * vec4(wp - (wind - uVel) * 0.03, 1.0);   // where it was a frame ago, relative to us
  if (c0.w < 0.3 || c1.w < 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5;
  float size = max((0.006 + 0.01 * aSeed.w) * uFocalPx / c0.w, 0.9 * uScale);
  float blur = 1.0 - smoothstep(0.6, 4.0, c0.w);                         // close flakes defocus
  size *= 1.0 + blur * 3.0;
  vec2 v = s0 - s1; float len = length(v); vec2 dir = len > 1e-3 ? v / len : vec2(0.0, 1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 off = dir * corner.y * (size + len * 0.5) + perp * corner.x * size;
  vec2 s = (s0 + s1) * 0.5 + off;
  gl_Position = vec4(s / (uRes * 0.5) * c0.w, 0.0, c0.w);
  vQ = corner;
  vA = (0.5 + 0.5 * aSeed.w) * (1.0 - blur * 0.75) * exp(-c0.w * uDen * 18.0) * smoothstep(0.3, 1.2, c0.w) / (1.0 + len / (size * 2.0) * 0.5);
}`;

const SNOW_FS = `#version 300 es
precision mediump float;
in vec2 vQ; in float vA; uniform vec3 uColor; uniform float uFade; out vec4 o;
void main(){ float d = dot(vQ, vQ); if (d > 1.0) discard; float a = vA * (1.0 - d) * (1.0 - d) * uFade; o = vec4(uColor * a, a); }`;

// ---------------------------------------------------------------- setup
function fail() { root.classList.add('no-webgl'); return null; }

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });

function program(vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

// a colour target; half float when the GPU can render to it (the resolve needs the range and the
// depth in alpha), otherwise plain 8-bit and no temporal resolve
function target(w, h, float, levels = 1) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, w, h);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, w, h, ok };
}
function drop(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

function makeHF(w, h, from) {
  if (from.t0) { for (const t of [from.t0, from.t1, from.t2, from.dummy]) gl.deleteTexture(t); gl.deleteFramebuffer(from.fb0); gl.deleteFramebuffer(from.fb12); }
  const mk = (fmt) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const t0 = mk(gl.RGBA16F), t1 = mk(gl.RGBA8), t2 = mk(gl.RGBA8);
  const fb0 = gl.createFramebuffer(), fb12 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
  const ok0 = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb12);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t2, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  const ok12 = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // a texture for the samplers the bake passes declare but must not read (no feedback loops)
  const dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return ok0 && ok12 ? { w, h, t0, t1, t2, fb0, fb12, dummy, bakeProg: from.bakeProg, deriveProg: from.deriveProg, stage: 0, row: 0 } : null;
}

function init() {
  if (!gl) return fail();
  const noiseProg = program(FULLSCREEN_VS, NOISE_FS);
  const scene = program(FULLSCREEN_VS, SCENE_FS);
  const resolve = program(FULLSCREEN_VS, RESOLVE_FS);
  const post = program(FULLSCREEN_VS, POST_FS);
  const shafts = program(FULLSCREEN_VS, SHAFT_FS);
  const snow = program(SNOW_VS, SNOW_FS);
  if (!noiseProg || !scene || !resolve || !post || !snow) return fail();
  const bakeProg = program(FULLSCREEN_VS, BAKE_FS), deriveProg = program(FULLSCREEN_VS, DERIVE_FS), landProg = program(FULLSCREEN_VS, LAND_FS), landMaxProg = program(FULLSCREEN_VS, LANDMAX_FS);

  // bake the noise volume, one slice per draw
  const N = 128, tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, k, gl.LINEAR);
  for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.REPEAT);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, N, N);
  gl.useProgram(noiseProg.p);
  for (let z = 0; z < N; z++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
    gl.uniform1f(noiseProg.u.uZ, z);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);

  // snow seeds
  const COUNT = coarse ? 900 : 2600;
  const seeds = new Float32Array(COUNT * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.bindVertexArray(null);

  // can we render to half float? (the resolve depends on it)
  let float = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  if (float) { const t = target(4, 4, true); float = t.ok; drop(t); }
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  // the face bake: heights (half float), then normal + snow + occlusion and the two sun shadows
  const hf = float && bakeProg && deriveProg ? makeHF(coarse ? 1024 : 2048, coarse ? 768 : 1536, { bakeProg, deriveProg }) : null;

  // the land, baked now (a few milliseconds): the world the forest opening flies through
  let land = null;
  if (float && landProg) {
    const LW = 1024, LH = 2368;
    const t = target(LW, LH, true);
    if (t.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, LW, LH);
      gl.useProgram(landProg.p);
      const U = landProg.u;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex); gl.uniform1i(U.uNoise, 0);
      const dummy = hf?.dummy ?? null;
      for (const [k, name] of [[1, 'uHF0'], [2, 'uHF1'], [3, 'uHF2'], [4, 'uLand'], [5, 'uLandMax'], [6, 'uCeil']]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, dummy); if (U[name]) gl.uniform1i(U[name], k); }
      gl.uniform2f(U.uLandN, LW, LH); gl.uniform1f(U.uPix, 1); gl.uniform1i(U.uHF, 0); gl.uniform1i(U.uLandOn, 0); gl.uniform1i(U.uBake, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      land = t;
      // the trail and the shore, back to the CPU: the camera walks 2.6 m above the ground
      {
        const x0 = Math.floor((-950 - (-2800)) / 5800 * LW), z0 = Math.floor((9500 - (-700)) / 13300 * LH);
        const w = 150, h = 400, buf = new Float32Array(w * h * 4);
        gl.readPixels(x0, z0, w, h, gl.RGBA, gl.FLOAT, buf);
        groundAt = (x, z) => {
          const fx = (x + 2800) / 5800 * LW - 0.5 - x0, fz = (z + 700) / 13300 * LH - 0.5 - z0;
          if (fx < 0 || fz < 0 || fx > w - 2 || fz > h - 2) return -612;
          const ix = fx | 0, iz = fz | 0, ax = fx - ix, az = fz - iz, g = (i, j) => buf[((iz + j) * w + ix + i) * 4];
          return (g(0, 0) * (1 - ax) + g(1, 0) * ax) * (1 - az) + (g(0, 1) * (1 - ax) + g(1, 1) * ax) * az;
        };
        buildKeys();
      }
      // and the highest point of each 64 m block of it, for marching
      const mt = landMaxProg && target(91, 208, true, 5);
      if (mt?.ok) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, mt.fb);
        gl.viewport(0, 0, 91, 208);
        gl.useProgram(landMaxProg.p);
        const M = landMaxProg.u;
        for (const [k, name] of [[1, 'uHF0'], [2, 'uHF1'], [3, 'uHF2'], [5, 'uLandMax'], [6, 'uCeil']]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, dummy); if (M[name]) gl.uniform1i(M[name], k); }
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(M.uLand, 4);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // its coarser levels: blocks of 128, 256, 512 and 1024 m
        gl.bindTexture(gl.TEXTURE_2D, mt.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const mipProg = program(FULLSCREEN_VS, MAXMIP_FS);
        if (mipProg) {
          gl.useProgram(mipProg.p);
          const Q = mipProg.u;
          // every sampler on a unit of its own: a 2D and a 3D sampler sharing one fails the draw
          for (const [k, name] of [[1, 'uHF0'], [2, 'uHF1'], [3, 'uHF2'], [4, 'uLand'], [6, 'uCeil']]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, dummy); if (Q[name]) gl.uniform1i(Q[name], k); }
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex); if (Q.uNoise) gl.uniform1i(Q.uNoise, 0);
          gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, mt.tex); gl.uniform1i(Q.uLandMax, 5);
          for (let L = 1; L < 5; L++) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, L - 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, L - 1);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mt.tex, L);
            gl.viewport(0, 0, Math.max(1, Math.floor(91 / (1 << L))), Math.max(1, Math.floor(208 / (1 << L))));
            gl.uniform1i(Q.uLevel, L);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mt.tex, 0);
        }
        land.max = mt;
        const ceilProg = program(FULLSCREEN_VS, CEIL_FS), ct = ceilProg && target(208, 1, true);
        if (ct?.ok) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, ct.fb);
          gl.viewport(0, 0, 208, 1);
          gl.useProgram(ceilProg.p);
          const C = ceilProg.u;
          for (const [k, name] of [[1, 'uHF0'], [2, 'uHF1'], [3, 'uHF2'], [4, 'uLand'], [6, 'uCeil']]) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, dummy); if (C[name]) gl.uniform1i(C[name], k); }
          gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, mt.tex); gl.uniform1i(C.uLandMax, 5);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindTexture(gl.TEXTURE_2D, ct.tex);
          for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
          land.ceil = ct;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  return { scene, resolve, post, shafts, snow, tex, vao, COUNT, float, timer, hf, land };
}

// Bake a band of the face per frame, never the whole of it at once (a long GPU command can stall a
// whole desktop). The first band of each pass is timed once, synchronously; after that each band is
// sized to a few milliseconds of this GPU's time, so it takes about a second on a fast machine and
// longer, but smoothly, on a slow one. The forest at the start of the ascent gives it that time.
// Until it is done the face is drawn from its full function.
function bakeStep(hurry) {
  const H = ctx.hf;
  if (!H || H.stage > 1) return;
  const prog = H.stage === 0 ? H.bakeProg : H.deriveProg;
  gl.disable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, H.w, H.h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, H.stage === 0 ? H.fb0 : H.fb12);
  gl.useProgram(prog.p);
  const U = prog.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, ctx.tex); gl.uniform1i(U.uNoise, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, H.stage === 0 ? H.dummy : H.t0); gl.uniform1i(U.uHF0, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, H.dummy); gl.uniform1i(U.uHF1, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, H.dummy); gl.uniform1i(U.uHF2, 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ctx.land?.tex ?? H.dummy); gl.uniform1i(U.uLand, 4); gl.uniform1i(U.uLandOn, ctx.land ? 1 : 0);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, H.dummy); gl.uniform1i(U.uLandMax, 5);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, H.dummy); gl.uniform1i(U.uCeil, 6);
  gl.uniform2f(U.uHFN, H.w, H.h);
  gl.uniform1f(U.uPix, 1); gl.uniform1i(U.uHF, 0); gl.uniform1i(U.uBake, 1); gl.uniform1i(U.uQuality, 2);
  if (U.uSunA) { gl.uniform3fv(U.uSunA, look(0.58).sunDir); gl.uniform3fv(U.uSunB, look(0.78).sunDir); }
  const perRow = H.perRow?.[H.stage];
  const budget = DEBUG_P != null ? 40 : hurry ? 10 : 5;                  // ms of GPU a frame
  const rows = Math.min(H.h - H.row, perRow ? Math.max(2, Math.floor(budget / perRow)) : 8);
  gl.scissor(0, H.row, H.w, rows);
  const px = H.stage === 0 ? new Float32Array(4) : new Uint8Array(4);
  const sync = () => gl.readPixels(0, H.row, 1, 1, gl.RGBA, H.stage === 0 ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
  // calibration: the second band of a pass (the first pays for compiling it), from an idle GPU
  const calib = !perRow && (H.warm ??= [])[H.stage];
  if (calib) sync();
  const a = performance.now();
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (!perRow) H.warm[H.stage] = true;
  if (calib) {
    sync(); (H.perRow ??= [])[H.stage] = Math.max(0.01, (performance.now() - a) / rows);
    // a slower GPU bakes fewer texels (the cost of a row is measured at this width)
    const tier = H.stage === 0 && H.w === 2048 ? (H.perRow[0] > 3.2 ? [1024, 768] : H.perRow[0] > 1.3 ? [1536, 1152] : null) : null;
    if (tier) { ctx.hf = makeHF(tier[0], tier[1], H); gl.disable(gl.SCISSOR_TEST); return; }
  }
  H.row += rows;
  if (H.row >= H.h) { H.row = 0; H.stage++; if (H.stage === 2) H.readyAt = performance.now(); }
  gl.disable(gl.SCISSOR_TEST);
  gl.activeTexture(gl.TEXTURE0);
}

const ctx = init();

// ---------------------------------------------------------------- overlay
const chapters = [...section.querySelectorAll('[data-chapter]')];
const fig = section.querySelector('.intro-fig');
const readAlt = section.querySelector('[data-read="alt"]');
const readTemp = section.querySelector('[data-read="temp"]');
const readWind = section.querySelector('[data-read="wind"]');
const altMark = section.querySelector('.intro-alt i');
let lastChapter = -1, lastRead = '';

function overlay(p, cam, vp, w, h) {
  stage.style.setProperty('--p', p.toFixed(4));
  let ch = 0;
  chapters.forEach((el, i) => { if (p >= parseFloat(el.dataset.chapter)) ch = i; });
  if (ch !== lastChapter) {
    chapters.forEach((el, i) => el.classList.toggle('is-on', i === ch));
    lastChapter = ch;
  }
  const alt = Math.round(1320 + cam.pos[1]);
  const temp = Math.round(-7 - (alt - 1700) / 70);
  const wind = Math.round(p > 0.95 ? 22 * (1 - smooth(clamp((p - 0.95) / 0.035))) : 4 + 18 * smooth(clamp((p - 0.2) / 0.62)));
  const txt = alt + '|' + temp + '|' + wind;
  if (txt !== lastRead && readAlt) {
    readAlt.textContent = alt.toLocaleString('en-US') + ' m';
    readTemp.textContent = (temp < 0 ? '−' : '') + Math.abs(temp) + ' °C';
    readWind.textContent = 'NW ' + wind + ' km/h';
    // the tick climbs the gauge with the camera: the lake (600 m) at its foot, 2,200 m at its head
    if (altMark) altMark.style.setProperty('--alt', clamp((alt - 600) / 1600).toFixed(3));
    lastRead = txt;
  }
  // FIG. 01 — pinned to the climber while they are still a speck
  if (fig) {
    const on = p > 0.70 && p < 0.81;
    fig.classList.toggle('is-on', on);
    if (on && vp) {
      const c = project(vp, V.add(CLIMBER, [0, 1.0, 0]));
      if (c) fig.style.transform = `translate3d(${(c[0] * 0.5 + 0.5) * w}px, ${(0.5 - c[1] * 0.5) * h}px, 0)`;
    }
  }
}

function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return w > 0 ? [x / w, y / w] : null;
}

function viewProj(pos, r, u, f, fov, aspect) {
  const n = 0.1, fa = 20000, t = 1 / Math.tan(fov / 2);
  const P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0];
  const Vw = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -V.dot(r, pos), -V.dot(u, pos), V.dot(f, pos), 1];
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += P[k * 4 + j] * Vw[i * 4 + k]; out[i * 4 + j] = s;
  }
  return out;
}

// ---------------------------------------------------------------- sound: wind, then silence
const soundBtn = section.querySelector('.intro-sound');
let audio = null;
function startAudio() {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const len = ac.sampleRate * 4, buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {                 // brown noise, one per channel for width
    const d = buf.getChannelData(c); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
  }
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  const low = ac.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 420; low.Q.value = 0.6;
  const band = ac.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 900; band.Q.value = 3.5;
  const bandGain = ac.createGain(); bandGain.gain.value = 0.0;
  const master = ac.createGain(); master.gain.value = 0;
  src.connect(low).connect(master); src.connect(band).connect(bandGain).connect(master);
  master.connect(ac.destination); src.start();
  audio = { ac, low, band, bandGain, master };
}
function updateAudio(p, time) {
  if (!audio) return;
  const gust = 0.5 + 0.5 * Math.sin(time * 0.37) * Math.sin(time * 0.13 + 1);
  const toWall = smooth(clamp((p - 0.3) / 0.55));
  const silence = 1 - smooth(clamp((p - 0.925) / 0.06));
  const now = audio.ac.currentTime;
  const on = soundBtn.getAttribute('aria-pressed') === 'true' && p < 1.2;
  audio.master.gain.setTargetAtTime(on ? (0.25 + 0.55 * toWall) * silence * (0.7 + 0.3 * gust) : 0, now, 0.25);
  audio.low.frequency.setTargetAtTime(260 + 520 * gust * (0.4 + toWall), now, 0.3);
  audio.band.frequency.setTargetAtTime(700 + 900 * gust, now, 0.4);
  audio.bandGain.gain.setTargetAtTime(0.18 * toWall * gust, now, 0.4);
}
soundBtn?.addEventListener('click', () => {
  const on = soundBtn.getAttribute('aria-pressed') !== 'true';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('span').textContent = on ? 'On' : 'Off';
  if (on && !audio) startAudio();
  audio?.ac.resume();
});

// ---------------------------------------------------------------- resolution
// The canvas is at device resolution (up to 2x, capped near 3.7 MP: 2560 x 1440). The scene is raymarched
// at a fraction of it and rebuilt to full resolution by the resolve, so the fraction can follow the
// GPU's own timings — a fixed budget per frame on any machine — without the image going blocky.
const OUT_DPR = Math.min(devicePixelRatio || 1, 2);
const OUT_MAX = 3.7e6;
const FIXED = params.has('scale');                         // ?scale=0.5 pins the fraction (for comparisons)
const BUDGET = coarse ? 11 : 12;                           // ms of GPU a frame (the other passes take about 2)
const RMIN = 0.28, RMAX = 1;
let ratio = FIXED ? clamp(+params.get('scale'), 0.1, 2) : ctx?.timer ? 0.6 : coarse ? 0.45 : 0.55;
const MAXQ = coarse ? 1 : 2;
let quality = MAXQ;
const taa = !!ctx?.float;
let cur = null, shaftT = null, hist = [null, null], flip = 0, reset = true, prevVP = null, jitterIndex = 0;

function sizes() {
  let w = stage.clientWidth * OUT_DPR, h = stage.clientHeight * OUT_DPR;
  const over = Math.sqrt((w * h) / OUT_MAX);
  if (over > 1) { w /= over; h /= over; }
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    if (taa) { drop(hist[0]); drop(hist[1]); hist = [target(w, h, true), target(w, h, true)]; }
    reset = true;
  }
  const wi = Math.max(1, Math.round(w * ratio)), hi = Math.max(1, Math.round(h * ratio));
  if (!cur || cur.w !== wi || cur.h !== hi) { drop(cur); cur = target(wi, hi, taa); drop(shaftT); shaftT = target(wi, hi, false); }
}

// Halton (2, 3): sixteen sub-pixel offsets that cover the pixel evenly in any window of frames
const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); } return r; };
const JITTER = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

// GPU time per frame, from timer queries when the browser has them (read back a few frames later,
// never stalling); otherwise the time between frames, which only says whether a frame was missed
const pending = [], gpuMs = [];
let lastGpu = 0;
function timerBegin() {
  const T = ctx.timer;
  if (!T || pending.length > 4) return null;
  const q = gl.createQuery(); gl.beginQuery(T.TIME_ELAPSED_EXT, q); return q;
}
function timerEnd(q) { if (q) { gl.endQuery(ctx.timer.TIME_ELAPSED_EXT); pending.push(q); } }
function timerPoll() {
  const T = ctx.timer;
  while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = pending.shift(), ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    gl.deleteQuery(q);
    if (!gl.getParameter(T.GPU_DISJOINT_EXT)) { gpuMs.push(ns / 1e6); lastGpu = ns / 1e6; }
  }
}

let frames = 0, acc = 0, cooldown = 20;
function adapt(dt) {
  if (FIXED) return;
  cooldown = Math.max(0, cooldown - 1);
  if (ctx.timer) {
    if (gpuMs.length < 6 || cooldown) return;
    const ms = gpuMs.sort((a, b) => a - b)[gpuMs.length >> 1];
    gpuMs.length = 0;
    // cost follows the pixel count, the square of the ratio
    const k = Math.sqrt(BUDGET / Math.max(ms, 0.5));
    // with room to spare, the shadows and occlusion come back before the resolution goes up;
    // short of time, the resolution goes down first, and the quality only once it is at its floor
    if (k > 1.25 && quality < MAXQ) { quality++; cooldown = 20; }
    else if (k < 0.93 || (k > 1.08 && ratio < RMAX)) {
      ratio = clamp(ratio * clamp(k, 0.75, 1.12), RMIN, RMAX);
      if (ratio === RMIN && k < 0.8 && quality > 0) quality--;
      cooldown = 12;
    }
    return;
  }
  frames++; acc += dt;
  if (frames < 30) return;
  const ms = (acc / frames) * 1000;
  frames = 0; acc = 0;
  if (ms > 21) {
    if (ratio > RMIN) ratio = Math.max(RMIN, ratio * 0.88);
    else if (quality > 0 && ms > 26) quality--;
    cooldown = 90;
  } else if (ms < 17.6 && !cooldown && ratio < RMAX) { ratio = Math.min(RMAX, ratio * 1.05); cooldown = 45; }
}

// ---------------------------------------------------------------- loop
let pShown = DEBUG_P ?? 0, target0 = 0, running = false, visible = true, raf = 0;
let t0 = performance.now(), last = t0, prevCam = null;

function scrollProgress() {
  const span = (section.offsetHeight - innerHeight) * 0.96;     // complete while the stage is still pinned
  return span > 0 ? clamp(-section.getBoundingClientRect().top / span) : 0;
}

// The end: the stage stays exactly where it is on screen and becomes the first screen of the page,
// the scroll length it used is removed, and the GPU is released. Scrolling up later is just the page.
function finish(toTop) {
  if (done || DEBUG_P != null) return;
  done = true;
  const extra = section.offsetHeight - stage.offsetHeight;
  const y = toTop ? 0 : Math.max(0, scrollY - extra);
  markDone();
  scrollTo(0, y);
  cancelAnimationFrame(raf);
  if (audio) { audio.master.gain.setTargetAtTime(0, audio.ac.currentTime, 0.2); setTimeout(() => audio.ac.close(), 1500); }
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  canvas.remove();
}

function frame(now) {
  running = false;
  if (!visible || !ctx || done) return;
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  const time = (now - t0) / 1000;
  target0 = DEBUG_P ?? scrollProgress();
  pShown = DEBUG_P != null ? target0 : pShown + (target0 - pShown) * (1 - Math.exp(-dt * 2.6));
  if (target0 >= 1 && pShown > 0.994) { finish(false); return; }
  const p = pShown;

  if (ctx.timer) timerPoll();
  sizes();
  const Wo = canvas.width, Ho = canvas.height, Wi = cur.w, Hi = cur.h;
  const cam = camera(p, time);
  const f = V.norm(V.sub(cam.tgt, cam.pos));
  const r = V.norm(V.cross(f, [0, 1, 0]));
  const u = V.cross(r, f);
  const fov = (cam.fov * (Wo < Ho ? 1.3 : 1) * Math.PI) / 180;   // portrait: open up so the peak is not cropped
  const focal = 1 / Math.tan(fov / 2);
  const L = look(p);
  const tmax = Math.min(9000, 7.0 / (L.den * 0.55 + 1e-6));
  const vel = prevCam && dt > 0 ? V.mul(V.sub(cam.pos, prevCam), 1 / dt) : [0, 0, 0];
  prevCam = cam.pos;
  const white = smooth(clamp((p - 0.975) / 0.02));   // the fog is already white by then: this only settles the last bit
  const vp = viewProj(cam.pos, r, u, f, fov, Wo / Ho);
  const J = taa ? JITTER[jitterIndex++ % JITTER.length] : [0, 0];
  const query = timerBegin();

  bakeStep(p > 0.35);

  // 1. the scene, at a fraction of the resolution, jittered
  const { scene, resolve, post, snow } = ctx;
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
  gl.viewport(0, 0, Wi, Hi);
  gl.useProgram(scene.p);
  let U = scene.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, ctx.tex); gl.uniform1i(U.uNoise, 0);
  const H = ctx.hf, hfOn = !!H && H.stage > 1;
  [H?.t0, H?.t1, H?.t2].forEach((t, k) => { gl.activeTexture(gl.TEXTURE1 + k); gl.bindTexture(gl.TEXTURE_2D, hfOn ? t : H?.dummy ?? null); });
  gl.uniform1i(U.uHF0, 1); gl.uniform1i(U.uHF1, 2); gl.uniform1i(U.uHF2, 3);
  gl.uniform1i(U.uHF, hfOn ? 1 : 0); gl.uniform1i(U.uBake, 0);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ctx.land?.tex ?? H?.dummy ?? null); gl.uniform1i(U.uLand, 4); gl.uniform1i(U.uLandOn, ctx.land ? 1 : 0);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, ctx.land?.max?.tex ?? H?.dummy ?? null); gl.uniform1i(U.uLandMax, 5);
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, ctx.land?.ceil?.tex ?? H?.dummy ?? null); gl.uniform1i(U.uCeil, 6);
  gl.uniform3fv(U.uZenith, L.zenith); gl.uniform1f(U.uMist, L.mist); gl.uniform1f(U.uDisk, L.disk); gl.uniform1f(U.uFogBase, L.fogBase);
  if (H) gl.uniform2f(U.uHFN, H.w, H.h);
  gl.uniform1f(U.uSunMix, clamp((p - 0.58) / 0.2));
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform2f(U.uRes, Wi, Hi); gl.uniform2f(U.uJitter, J[0], J[1]);
  gl.uniform1f(U.uTime, time);
  gl.uniform1f(U.uFocal, focal);
  gl.uniform1f(U.uPix, 2 / (focal * Hi));
  gl.uniform3fv(U.uCam, cam.pos); gl.uniform3fv(U.uCamR, r); gl.uniform3fv(U.uCamU, u); gl.uniform3fv(U.uCamF, f);
  gl.uniform3fv(U.uSunDir, L.sunDir);
  gl.uniform3fv(U.uSunCol, L.sun); gl.uniform3fv(U.uFogCol, L.fog);
  gl.uniform1f(U.uFogDen, L.den); gl.uniform1f(U.uCloud, L.cloud);
  gl.uniform1f(U.uTMax, tmax); gl.uniform1f(U.uExposure, L.exposure);
  gl.uniform1i(U.uSteps, coarse ? 120 : 180);
  gl.uniform1i(U.uCloudSteps, coarse ? 7 : 12);
  gl.uniform1i(U.uQuality, quality);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 2. the resolve, at full resolution, into the history
  let src = cur;
  if (taa) {
    const rd = hist[flip], wr = hist[1 - flip];
    gl.bindFramebuffer(gl.FRAMEBUFFER, wr.fb);
    gl.viewport(0, 0, Wo, Ho);
    gl.useProgram(resolve.p);
    U = resolve.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cur.tex); gl.uniform1i(U.uCur, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rd.tex); gl.uniform1i(U.uHist, 1);
    gl.uniform2f(U.uCurRes, Wi, Hi); gl.uniform2f(U.uOutRes, Wo, Ho); gl.uniform2f(U.uJitter, J[0], J[1]);
    gl.uniform3fv(U.uCam, cam.pos); gl.uniform3fv(U.uCamR, r); gl.uniform3fv(U.uCamU, u); gl.uniform3fv(U.uCamF, f);
    gl.uniform1f(U.uFocal, focal);
    gl.uniform1f(U.uReset, reset || !prevVP ? 1 : 0);
    gl.uniformMatrix4fv(U.uPrevVP, false, prevVP || vp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    src = wr; flip = 1 - flip;
  }

  // 3. sun shafts, while the sun is low over the forest and the lake
  const sp = project(vp, V.add(cam.pos, V.mul(L.sunDir, 1000)));
  const shaft = sp && ctx.shafts ? 1 - smooth(clamp((p - 0.3) / 0.12)) : 0;
  if (shaft > 0.001) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shaftT.fb);
    gl.viewport(0, 0, Wi, Hi);
    gl.useProgram(ctx.shafts.p);
    const Sh = ctx.shafts.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(Sh.uSrc, 0);
    gl.uniform2f(Sh.uRes, Wi, Hi); gl.uniform2f(Sh.uSun, sp[0] * 0.5 + 0.5, sp[1] * 0.5 + 0.5); gl.uniform1f(Sh.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // 4. the finish, onto the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, Wo, Ho);
  gl.useProgram(post.p);
  U = post.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(U.uSrc, 0);
  gl.uniform2f(U.uOutRes, Wo, Ho);
  gl.uniform1f(U.uUpscale, taa ? 0 : 1);
  gl.uniform1f(U.uSharp, 0.35);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, shaftT.tex); gl.uniform1i(U.uShafts, 1);
  gl.uniform1f(U.uShaft, shaft);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1f(U.uVig, 1 - smooth(clamp((p - 0.9) / 0.075)));
  gl.uniform1f(U.uWhite, white);
  gl.uniform1f(U.uTime, time);
  gl.uniform3f(U.uPaper, 0.957, 0.949, 0.933);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 5. falling snow, over the top
  if (white < 0.999 && p > 0.44) {
    gl.useProgram(snow.p);
    const S = snow.u;
    gl.uniformMatrix4fv(S.uVP, false, vp);
    gl.uniform3fv(S.uCam, cam.pos); gl.uniform3fv(S.uVel, vel);
    gl.uniform1f(S.uTime, time);
    gl.uniform1f(S.uScale, Wo / Math.max(1, stage.clientWidth));
    gl.uniform1f(S.uFocalPx, focal * Ho * 0.5);
    gl.uniform1f(S.uDen, L.den);
    gl.uniform2f(S.uRes, Wo, Ho);
    const fade = smooth(clamp((p - 0.44) / 0.08)) * (1 - smooth(clamp((p - 0.92) / 0.055)));   // snow above the forest, gone into the last cloud
    gl.uniform3f(S.uColor, 0.8, 0.84, 0.9); gl.uniform1f(S.uFade, fade);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(ctx.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, ctx.COUNT);
    gl.bindVertexArray(null);
  }
  timerEnd(query);
  prevVP = vp; reset = false;

  overlay(p, cam, vp, stage.clientWidth, stage.clientHeight);
  stage.classList.toggle('is-light', p > 0.91);
  updateAudio(p, time);
  adapt(dt);
  window.__intro = { p, ratio, quality, taa, W: Wi, H: Hi, Wo, Ho, ms: dt * 1000, gpu: lastGpu, bake: ctx.hf ? (ctx.hf.readyAt ? Math.round(ctx.hf.readyAt - t0) : ctx.hf.stage + ':' + ctx.hf.row) : 'none' };
  if (params.has('bench')) { if (jitterIndex > 3 && (!ctx.hf || ctx.hf.stage > 1)) { bench(Wi, Hi); return; } }   // a few warm-up frames, then the bench alone
  request();
}

// ?bench with ?p=…: the scene pass alone, timed. Additive blending keeps a tile GPU from skipping
// the repeated draws, a readback makes it finish, and the best of five rounds ignores other load.
function bench(W, H) {
  const px = taa ? new Float32Array(4) : new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, taa ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb); gl.viewport(0, 0, W, H); gl.useProgram(ctx.scene.p);
  const hf = ctx.hf;
  if (hf) [hf.t0, hf.t1, hf.t2].forEach((t, k) => { gl.activeTexture(gl.TEXTURE1 + k); gl.bindTexture(gl.TEXTURE_2D, hf.stage > 1 ? t : hf.dummy); });
  if (ctx.land) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ctx.land.tex); gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, ctx.land.max?.tex ?? null); gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, ctx.land.ceil?.tex ?? null); }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, ctx.tex);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  sync();
  let best = 1e9;
  for (let round = 0; round < 5; round++) {
    const a = performance.now();
    for (let k = 0; k < 4; k++) gl.drawArrays(gl.TRIANGLES, 0, 3);
    sync();
    best = Math.min(best, (performance.now() - a) / 4);
  }
  gl.disable(gl.BLEND);
  window.__bench = { ms: best, W, H };
}

function request() { if (!running && !done) { running = true; raf = requestAnimationFrame(frame); } }

if (ctx) {
  root.classList.add('has-webgl');
  // scrolled away before the camera caught up (a fast flick, a #hash): the intro is over all the same
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) request(); else if (target0 >= 1 || scrollProgress() >= 1) finish(false);
  }).observe(section);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); reset = true; request(); } });
  section.querySelector('.intro-skip')?.addEventListener('click', (e) => { e.preventDefault(); finish(true); section.querySelector('.intro-end h2, .intro-end')?.focus?.(); });
  request();
} else markDone();
})();
