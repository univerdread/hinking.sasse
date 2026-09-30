// The relief: a cut block of real terrain, like an architect's site model. Stone top with contour
// lines every 50 m, graphite sides, the route in rope amber drawn along the ground as you scroll.
// WebGL2, rendered only when something changed and only while on screen.
(() => {
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aUvS;
uniform mat4 uVP; out vec3 vN; out vec2 vUv; out float vSide; out float vH; out vec3 vP;
void main(){ vN = aNrm; vUv = aUvS.xy; vSide = aUvS.z; vH = aPos.y; vP = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUv; in float vSide; in float vH; in vec3 vP;
uniform sampler2D uRoute; uniform float uDraw, uHasRoute, uMin, uMax, uYs, uTop;
uniform vec3 uLight; out vec4 o;
float lineAt(float v, float w){ float f = abs(fract(v - 0.5) - 0.5) / fwidth(v); return 1.0 - clamp(f - w, 0.0, 1.0); }
void main(){
  vec3 n = normalize(vN);
  float dif = clamp(dot(n, uLight) * 0.75 + 0.25, 0.0, 1.0);
  float sky = 0.55 + 0.45 * n.y;
  float m = uMin + (vH / uYs) * (uMax - uMin);                       // back to metres
  vec3 stone = vec3(0.84, 0.83, 0.80);
  vec3 col;
  if (vSide > 0.5) {
    col = vec3(0.10, 0.105, 0.115) * (0.8 + 0.35 * dif);                 // graphite sides
    col += 0.03 * lineAt(m / 100.0, 0.2);                                 // strata every 100 m
  } else {
    float cav = (1.0 - smoothstep(0.0, uTop, vH)) * 0.12;          // valleys a shade darker
    col = stone * (0.36 + 0.64 * dif) * (0.85 + 0.15 * sky) - cav;
    col = mix(col, vec3(0.2, 0.21, 0.22), 0.28 * lineAt(m / 50.0, 0.1));
    col = mix(col, vec3(0.14, 0.15, 0.16), 0.42 * lineAt(m / 250.0, 0.35));
    if (uHasRoute > 0.5) {
      vec4 r = texture(uRoute, vUv);
      float on = r.r * step(r.g, uDraw + 0.002);
      col = mix(col, vec3(0.85, 0.52, 0.20), on);
      col = mix(col, vec3(1.0, 0.8, 0.55), on * smoothstep(uDraw - 0.012, uDraw, r.g) * 0.8);   // the head glows a little
    }
  }
  o = vec4(pow(max(col, 0.0), vec3(1.0 / 1.35)), 1.0);
}`;

function mat4(proj, eye, target) {
  const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += proj[k * 4 + j] * V[i * 4 + k]; out[i * 4 + j] = s; }
  return out;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class Relief {
  constructor(c) {
    this.c = c; this.fig = c.parentElement;
    this.mode = c.dataset.mode;
    this.min = +c.dataset.min; this.max = +c.dataset.max;
    const [wk, hk] = c.dataset.km.split(',').map(Number);
    this.ys = ((this.max - this.min) / 1000) / wk * 2 * 1.6;          // vertical scale ×1.6, model is 2 units wide
    this.route = c.dataset.route ? JSON.parse(c.dataset.route) : null;
    this.ll = c.dataset.ll ? JSON.parse(c.dataset.ll) : null;
    this.ts = c.dataset.t ? JSON.parse(c.dataset.t) : null;
    this.routeKm = +(c.dataset.routeKm || 0);
    this.readLL = this.fig.querySelector('[data-relief-ll]'); this.readAlt = this.fig.querySelector('[data-relief-alt]');
    this.pointer = [0, 0]; this.pt = [0, 0];
    this.visible = false; this.dirty = true; this.last = '';
    const gl = this.gl = c.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) { this.fig.classList.add('no-webgl'); return; }
    HC.near(c, () => HC.terrain(c.dataset.src).then((t) => this.build(t)));
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) HC.wake(); }, { rootMargin: '20% 0px' }).observe(c);
    new ResizeObserver(() => { this.dirty = true; HC.wake(); }).observe(c);
    if (!coarse) addEventListener('pointermove', (e) => {
      if (!this.visible) return;
      this.pt = [(e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1]; HC.wake();
    }, { passive: true });
  }

  build(t) {
    const gl = this.gl, N = coarse ? 150 : 220, ys = this.ys;
    const H = (u, v) => {                                                  // bilinear, u,v in 0..1
      const x = Math.min(t.w - 1.001, u * (t.w - 1)), y = Math.min(t.h - 1.001, v * (t.h - 1));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, k = y0 * t.w + x0, d = t.data;
      return ((d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fy) + (d[k + t.w] * (1 - fx) + d[k + t.w + 1] * fx) * fy) * ys;
    };
    const pos = [], nrm = [], uvs = [], idx = [];
    const e = 1 / N;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = i / N, v = j / N, h = H(u, v);
      pos.push(u * 2 - 1, h, v * 2 - 1);
      const nx = (H(u - e, v) - H(u + e, v)) / (4 * e), nz = (H(u, v - e) - H(u, v + e)) / (4 * e);
      const n = norm([nx, 1, nz]); nrm.push(...n); uvs.push(u, v, 0);
    }
    const W = N + 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * W + i; idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
    // the cut: four walls down to a base below the lowest point
    const base = -0.16;
    const wall = (list, n) => {
      const start = pos.length / 3;
      for (const k of list) {
        const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
        pos.push(x, y, z, x, base, z); nrm.push(...n, ...n); uvs.push(0, 0, 1, 0, 0, 1);
      }
      for (let m = 0; m < list.length - 1; m++) { const a = start + m * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    };
    const row = (j) => Array.from({ length: W }, (_, i) => j * W + i), col = (i) => Array.from({ length: W }, (_, j) => j * W + i);
    wall(row(N), [0, 0, 1]); wall(row(0).reverse(), [0, 0, -1]); wall(col(N).reverse(), [1, 0, 0]); wall(col(0), [-1, 0, 0]);
    this.count = idx.length;
    this.top = Math.max(...pos.filter((_, k) => k % 3 === 1));

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return; }
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog); this.prog = prog;
    this.u = Object.fromEntries(['uVP', 'uRoute', 'uDraw', 'uHasRoute', 'uMin', 'uMax', 'uYs', 'uTop', 'uLight'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    const vao = this.vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    [[pos, 3], [nrm, 3], [uvs, 3]].forEach(([arr, n], k) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, n, gl.FLOAT, false, 0, 0);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    // route texture: R = on the route, G = how far along it (so it can be drawn progressively)
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
    if (this.route) {
      const x = cv.getContext('2d'); x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = 5.5;
      const pts = this.route, ts = this.ts;
      for (let k = 0; k < pts.length - 1; k++) {
        const steps = 8;
        for (let s = 0; s < steps; s++) {
          const a = s / steps, b = (s + 1) / steps;
          const p0 = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * a, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * a];
          const p1 = [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * b, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * b];
          const tt = ts[k] + (ts[k + 1] - ts[k]) * a;
          x.strokeStyle = `rgb(255,${Math.round(tt * 255)},0)`;
          x.beginPath(); x.moveTo(p0[0] * S, p0[1] * S); x.lineTo(p1[0] * S, p1[1] * S); x.stroke();
        }
      }
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.ready = true; this.dirty = true; HC.wake();
  }

  frame() {
    if (!this.ready || !this.visible) return false;
    const p = HC.progress(this.c.closest('[data-scene]') || this.fig);
    this.pointer[0] += (this.pt[0] - this.pointer[0]) * 0.06; this.pointer[1] += (this.pt[1] - this.pointer[1]) * 0.06;
    const key = `${p.toFixed(4)}|${this.pointer[0].toFixed(3)}|${this.pointer[1].toFixed(3)}|${this.c.clientWidth}`;
    if (key === this.last && !this.dirty) return false;
    this.last = key; this.dirty = false;
    const gl = this.gl, c = this.c;
    const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    // the camera turns slowly with the scroll, and leans a degree or two towards the pointer
    const statement = this.mode === 'statement';
    const yaw = (statement ? -0.9 + p * 1.5 : -0.55 + p * 0.9) + this.pointer[0] * 0.07;
    const pitch = (statement ? 0.62 - p * 0.18 : 0.72 - p * 0.12) - this.pointer[1] * 0.05;
    const dist = statement ? 3.9 : 4.1;
    const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
    const fov = 0.62, asp = w / h, n = 0.1, f = 30, t = 1 / Math.tan(fov / 2);
    const P = [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.u.uVP, false, mat4(P, eye, [0, 0.02, 0]));
    const draw = this.route ? (reduced ? 1 : Math.min(1, Math.max(0, (p - 0.08) / 0.8))) : 0;
    gl.uniform1f(this.u.uDraw, draw); gl.uniform1f(this.u.uHasRoute, this.route ? 1 : 0);
    gl.uniform1f(this.u.uMin, this.min); gl.uniform1f(this.u.uMax, this.max); gl.uniform1f(this.u.uYs, this.ys); gl.uniform1f(this.u.uTop, this.top);
    gl.uniform3fv(this.u.uLight, norm([-0.55, 0.75, 0.35]));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.u.uRoute, 0);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    // coordinates of the route's head
    if (this.ll && this.readLL) {
      let k = 0; while (k < this.ts.length - 2 && this.ts[k + 1] < draw) k++;
      const a = this.ll[k], b = this.ll[k + 1], s = Math.min(1, Math.max(0, (draw - this.ts[k]) / ((this.ts[k + 1] - this.ts[k]) || 1)));
      const alt = a[2] + (b[2] - a[2]) * s;
      this.readLL.textContent = `${(draw * this.routeKm).toFixed(1)} of ${this.routeKm.toFixed(1)} km`;   // how far along, not where
      this.readAlt.textContent = `${Math.round(alt).toLocaleString('en-US')} m`;
    }
    return Math.abs(this.pt[0] - this.pointer[0]) > 0.002 || Math.abs(this.pt[1] - this.pointer[1]) > 0.002;
  }
}

// ---------------------------------------------------------------- the destinations model (home)
// One block of land that becomes each of the club's destinations in turn, in order of distance from
// the school: it holds each place, then the ground flows into the next. Heights are real; lowland
// is given a minimum relief so it still reads as land, and the sea is drawn as water.
const TVS = `#version 300 es
layout(location=0) in vec3 aP0; layout(location=1) in vec3 aP1; layout(location=2) in vec3 aN0; layout(location=3) in vec3 aN1;
layout(location=4) in vec2 aM; layout(location=5) in vec2 aW; layout(location=6) in float aSide;
uniform mat4 uVP; uniform float uMorph;
out vec3 vN; out float vM0; out float vM1; out float vW; out float vSide; out float vY;
void main(){
  vec3 p = mix(aP0, aP1, uMorph);
  vN = mix(aN0, aN1, uMorph); vM0 = aM.x; vM1 = aM.y; vW = mix(aW.x, aW.y, uMorph); vSide = aSide; vY = p.y;
  gl_Position = uVP * vec4(p, 1.0);
}`;
const TFS = `#version 300 es
precision highp float;
in vec3 vN; in float vM0; in float vM1; in float vW; in float vSide; in float vY;
uniform float uMorph, uI0, uI1; uniform vec3 uLight; out vec4 o;
float lineAt(float v, float w){ float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4); return 1.0 - clamp(f - w, 0.0, 1.0); }
void main(){
  vec3 n = normalize(vN);
  float dif = clamp(dot(n, uLight) * 0.75 + 0.25, 0.0, 1.0);
  vec3 col;
  if (vSide > 0.5) col = vec3(0.10, 0.105, 0.115) * (0.8 + 0.35 * dif);
  else {
    col = vec3(0.84, 0.83, 0.80) * (0.38 + 0.62 * dif);
    // contour lines, each place at its own interval, crossfading with the land
    float l0 = lineAt(vM0 / uI0, 0.1) * (1.0 - uMorph), l1 = lineAt(vM1 / uI1, 0.1) * uMorph;
    col = mix(col, vec3(0.2, 0.21, 0.22), 0.3 * max(l0, l1));
    col = mix(col, vec3(0.66, 0.71, 0.74), smoothstep(0.3, 0.7, vW));        // water
  }
  o = vec4(pow(max(col, 0.0), vec3(1.0 / 1.35)), 1.0);
}`;

class Tour {
  constructor(c) {
    this.c = c; this.fig = c.parentElement;
    this.places = JSON.parse(c.dataset.tour);
    this.caps = [...document.querySelectorAll('[data-tour-cap]')];
    this.visible = false; this.last = ''; this.pair = -1;
    this.pointer = [0, 0]; this.pt = [0, 0];
    const gl = this.gl = c.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) { this.fig.classList.add('no-webgl'); return; }
    HC.near(c, () => Promise.all(this.places.map((pl) => HC.terrain(pl.src))).then((ts) => this.build(ts)));
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) HC.wake(); }, { rootMargin: '20% 0px' }).observe(c);
    new ResizeObserver(() => { this.last = ''; HC.wake(); }).observe(c);
    if (!coarse) addEventListener('pointermove', (e) => { if (this.visible) { this.pt = [(e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1]; HC.wake(); } }, { passive: true });
  }

  build(ts) {
    const gl = this.gl, N = coarse ? 120 : 180, W = N + 1;
    // one mesh per place, all with the same topology: a grid, and four walls down to a base
    this.meshes = ts.map((t, k) => {
      const pl = this.places[k], wk = pl.km[0];
      const real = ((pl.max - pl.min) / 1000) / wk * 2 * 1.6;              // vertical ×1.6, the model 2 units wide
      const ys = Math.max(real, 0.13);
      const H = (u, v) => {
        const x = Math.min(t.w - 1.001, u * (t.w - 1)), y = Math.min(t.h - 1.001, v * (t.h - 1));
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * t.w + x0, d = t.data;
        return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + t.w] * (1 - fx) + d[i + t.w + 1] * fx) * fy;
      };
      const pos = [], nrm = [], met = [], wat = [], side = [], e = 1 / N;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const u = i / N, v = j / N, h = H(u, v), m = pl.min + h * (pl.max - pl.min);
        pos.push(u * 2 - 1, h * ys, v * 2 - 1);
        const n = norm([(H(u - e, v) - H(u + e, v)) * ys / (4 * e), 1, (H(u, v - e) - H(u, v + e)) * ys / (4 * e)]);
        nrm.push(...n); met.push(m); wat.push(pl.water != null && m <= pl.water ? 1 : 0); side.push(0);
      }
      const wall = (list, n) => {
        for (const q of list) {
          pos.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2], pos[q * 3], -0.16, pos[q * 3 + 2]);
          nrm.push(...n, ...n); met.push(0, 0); wat.push(0, 0); side.push(1, 1);
        }
      };
      const row = (j) => Array.from({ length: W }, (_, i) => j * W + i), col = (i) => Array.from({ length: W }, (_, j) => j * W + i);
      wall(row(N), [0, 0, 1]); wall(row(0).reverse(), [0, 0, -1]); wall(col(N).reverse(), [1, 0, 0]); wall(col(0), [-1, 0, 0]);
      return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), met: new Float32Array(met), wat: new Float32Array(wat), side: new Float32Array(side), interval: pl.max - pl.min > 400 ? 50 : 5 };
    });
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * W + i; idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); }
    let start = W * W;
    for (let w = 0; w < 4; w++) { for (let m = 0; m < N; m++) { const a = start + m * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); } start += W * 2; }
    this.count = idx.length;

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, TVS], [gl.FRAGMENT_SHADER, TFS]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(sh)); return; }
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog); this.prog = prog;
    this.u = Object.fromEntries(['uVP', 'uMorph', 'uI0', 'uI1', 'uLight'].map((n) => [n, gl.getUniformLocation(prog, n)]));
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.buf = Array.from({ length: 7 }, () => gl.createBuffer());
    [3, 3, 3, 3, 2, 2, 1].forEach((n, k) => { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[k]); gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, n, gl.FLOAT, false, 0, 0); });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[6]); gl.bufferData(gl.ARRAY_BUFFER, this.meshes[0].side, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    this.ready = true; HC.wake();
  }

  // the two places the model is between: their positions, normals, heights and water, side by side
  setPair(i) {
    if (i === this.pair) return;
    this.pair = i;
    const gl = this.gl, a = this.meshes[i], b = this.meshes[Math.min(i + 1, this.meshes.length - 1)];
    const pairs = (x, y) => { const out = new Float32Array(x.length * 2); for (let k = 0; k < x.length; k++) { out[k * 2] = x[k]; out[k * 2 + 1] = y[k]; } return out; };
    [[0, a.pos], [1, b.pos], [2, a.nrm], [3, b.nrm], [4, pairs(a.met, b.met)], [5, pairs(a.wat, b.wat)]].forEach(([k, data]) => { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[k]); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); });
    this.intervals = [a.interval, b.interval];
  }

  frame() {
    if (!this.ready || !this.visible) return false;
    const p = HC.progress(this.c.closest('[data-scene]'));
    const n = this.places.length, k = clamp01((p - 0.04) / 0.86) * (n - 1);
    const i = Math.min(Math.floor(k), n - 2), f = k - i;
    const morph = reduced ? Math.round(f) : smoothstep(0.5, 0.92, f);                    // hold, then flow
    const shown = morph > 0.5 ? i + 1 : i;
    this.caps.forEach((c, j) => c.classList.toggle('is-on', j === shown));
    this.pointer[0] += (this.pt[0] - this.pointer[0]) * 0.06; this.pointer[1] += (this.pt[1] - this.pointer[1]) * 0.06;
    const key = `${p.toFixed(4)}|${this.pointer[0].toFixed(3)}|${this.pointer[1].toFixed(3)}|${this.c.clientWidth}|${this.c.clientHeight}`;
    if (key === this.last) return false;
    this.last = key;
    this.setPair(i);
    const gl = this.gl, c = this.c, dpr = Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const yaw = -0.8 + p * 1.3 + this.pointer[0] * 0.07, pitch = 0.6 - p * 0.1 - this.pointer[1] * 0.05, dist = 3.9;
    const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
    const fov = 0.62, asp = w / h, nr = 0.1, fr = 30, t = 1 / Math.tan(fov / 2);
    const P = [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (fr + nr) / (nr - fr), -1, 0, 0, (2 * fr * nr) / (nr - fr), 0];
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.u.uVP, false, mat4(P, eye, [0, 0.04, 0]));
    gl.uniform1f(this.u.uMorph, morph); gl.uniform1f(this.u.uI0, this.intervals[0]); gl.uniform1f(this.u.uI1, this.intervals[1]);
    gl.uniform3fv(this.u.uLight, norm([-0.55, 0.75, 0.35]));
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    return Math.abs(this.pt[0] - this.pointer[0]) > 0.002 || Math.abs(this.pt[1] - this.pointer[1]) > 0.002;
  }
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const models = [...document.querySelectorAll('canvas[data-relief]')].map((c) => new Relief(c))
  .concat([...document.querySelectorAll('canvas[data-tour]')].map((c) => new Tour(c)));
HC.onFrame(() => models.reduce((busy, m) => m.frame() || busy, false));
})();
