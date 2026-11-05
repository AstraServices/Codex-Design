// VFX Studio preview: a Roblox-behaviour simulator in Three.js (design + preview only; export is Roblox-native).
// Units are studs. Reproduces ParticleEmitter (Speed/Spread/Drag/Acceleration/Rotation/Size·Transparency·Color
// sequences with envelopes, Squash, Orientation modes, LightEmission blending, Brightness, flipbooks Loop/OneShot/
// PingPong/Random), Beam (Bezier curve, widths, TextureMode/Length/Speed, FaceCamera), Trail, lights, Part meshes
// (Neon / ForceField look) and screen effects (approximated with CSS filters). Deterministic: scrubbing re-simulates.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULTS } from '../rbx/vfx-build.js';

const DT = 1 / 60, MAX = 3000;
const rng = seed => { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const toRGB = c => { if (Array.isArray(c)) return c; const f = String(c).replace('#', ''); return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255); };
function seq(v) { const s = typeof v === 'number' ? [[0, v, 0], [1, v, 0]] : v.map(k => [k[0], +k[1], +(k[2] ?? 0)]); return s.sort((a, b) => a[0] - b[0]); }
function cseq(v) { const s = typeof v === 'string' || (Array.isArray(v) && typeof v[0] === 'number') ? [[0, v], [1, v]] : v; return s.map(([t, c]) => [t, toRGB(c)]).sort((a, b) => a[0] - b[0]); }
function at(s, t) { if (t <= s[0][0]) return s[0]; for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const a = s[i - 1], b = s[i], k = (t - a[0]) / ((b[0] - a[0]) || 1); return a.map((x, j) => j === 0 ? t : Array.isArray(x) ? x.map((y, n) => y + (b[j][n] - y) * k) : x + (b[j] - x) * k); } return s.at(-1); }
const range = v => Array.isArray(v) ? [v[0], v[1] ?? v[0]] : [v, v];
const DIR = { Top: [0, 1, 0], Bottom: [0, -1, 0], Front: [0, 0, -1], Back: [0, 0, 1], Right: [1, 0, 0], Left: [-1, 0, 0] };
// Roblox easing styles (EasingDirection In/Out/InOut).
const EASE = { Linear: t => t, Sine: t => 1 - Math.cos(t * Math.PI / 2), Quad: t => t * t, Cubic: t => t ** 3, Quart: t => t ** 4, Quint: t => t ** 5, Exponential: t => t === 0 ? 0 : 2 ** (10 * t - 10), Circular: t => 1 - Math.sqrt(1 - t * t),
  Back: t => 2.70158 * t ** 3 - 1.70158 * t * t, Elastic: t => t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3), Bounce: t => 1 - bounceOut(1 - t) };
function bounceOut(x) { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; }
export function ease(t, style = 'Quad', dir = 'Out') { const f = EASE[style] ?? EASE.Quad; return dir === 'In' ? f(t) : dir === 'InOut' ? (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2) : 1 - f(1 - t); }

const VS = `
attribute vec3 iPos; attribute vec4 iColor; attribute vec4 iData; attribute vec3 iVel;
uniform float uMode; uniform vec2 uGrid; varying vec2 vUv; varying vec4 vColor;
void main(){
  vec2 q = position.xy; vec2 size = iData.xy; float rot = iData.z; float frame = iData.w;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 offs;
  if (uMode > 1.5 && uMode < 2.5) { // VelocityParallel: long axis along screen-space velocity
    vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz; vec2 d = length(v.xy) > 1e-4 ? normalize(v.xy) : vec2(0.0, 1.0);
    vec2 n = vec2(-d.y, d.x); offs = vec3(n * q.x * size.x + d * q.y * size.y, 0.0);
  } else if (uMode > 2.5) { // VelocityPerpendicular: quad in the plane perpendicular to velocity
    vec3 v = normalize(length(iVel) > 1e-4 ? iVel : vec3(0.0, 1.0, 0.0)); vec3 a = normalize(abs(v.y) < 0.99 ? cross(v, vec3(0.0, 1.0, 0.0)) : cross(v, vec3(1.0, 0.0, 0.0))); vec3 b = cross(v, a);
    float c = cos(rot), s = sin(rot); vec3 w = (a * (c * q.x - s * q.y) * size.x + b * (s * q.x + c * q.y) * size.y);
    mv = modelViewMatrix * vec4(iPos + w, 1.0); offs = vec3(0.0);
  } else { float c = cos(rot), s = sin(rot); offs = vec3((c * q.x - s * q.y) * size.x, (s * q.x + c * q.y) * size.y, 0.0); }
  gl_Position = projectionMatrix * (mv + vec4(offs, 0.0));
  vec2 uv = position.xy + 0.5; float f = floor(frame + 0.5); vec2 cell = vec2(mod(f, uGrid.x), floor(f / uGrid.x));
  vUv = vec2((cell.x + uv.x) / uGrid.x, 1.0 - (cell.y + 1.0 - uv.y) / uGrid.y); vColor = iColor;
}`;
const FS = `
uniform sampler2D uMap; uniform float uLE; uniform float uBright; varying vec2 vUv; varying vec4 vColor;
void main(){ vec4 t = texture2D(uMap, vUv); float a = t.a * vColor.a; vec3 c = t.rgb * vColor.rgb * uBright;
  gl_FragColor = vec4(c * a, a * (1.0 - uLE)); }`; // premultiplied: LightEmission 1 = additive, 0 = normal blending

const whiteTex = (() => { const d = new Uint8Array([255, 255, 255, 255]); const t = new THREE.DataTexture(d, 1, 1); t.needsUpdate = true; return t; })();
function softDot() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(0.4, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const DEFAULT_TEX = softDot();

class Emitter {
  constructor(layer, tex, seed) {
    this.layer = layer; this.p = { ...DEFAULTS.ParticleEmitter, ...layer.props }; this.rand = rng(seed); this.parts = []; this.enabled = false; this.acc = 0;
    const P = this.p, grid = { Grid2x2: 2, Grid4x4: 4, Grid8x8: 8 }[P.FlipbookLayout] ?? (P.FlipbookLayout === 'Custom' ? 0 : 1);
    this.grid = P.FlipbookLayout === 'Custom' ? [P.FlipbookSizeX ?? 4, P.FlipbookSizeY ?? 4] : [grid, grid]; this.frames = this.grid[0] * this.grid[1];
    this.size = seq(P.Size); this.transp = seq(P.Transparency); this.color = cseq(P.Color); this.squash = seq(P.Squash ?? 0);
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry(); g.index = quad.index; g.setAttribute('position', quad.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.aDat = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    for (const [n, a] of [['iPos', this.aPos], ['iColor', this.aCol], ['iData', this.aDat], ['iVel', this.aVel]]) { a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); }
    g.instanceCount = 0; this.geo = g;
    const mode = { FacingCamera: 0, FacingCameraWorldUp: 1, VelocityParallel: 2, VelocityPerpendicular: 3 }[P.Orientation] ?? 0;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uMap: { value: tex ?? DEFAULT_TEX }, uLE: { value: THREE.MathUtils.clamp(P.LightEmission, 0, 1) }, uBright: { value: P.Brightness }, uMode: { value: mode }, uGrid: { value: new THREE.Vector2(...this.grid) } }, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10 + (P.ZOffset ?? 0);
    this.origin = new THREE.Vector3(...(layer.offset ?? [0, 0, 0]));
  }
  setTexture(t) { this.mat.uniforms.uMap.value = t ?? DEFAULT_TEX; }
  spawn(n, scale, rootPos) {
    const P = this.p, R = this.rand, [l0, l1] = range(P.Lifetime), [s0, s1] = range(P.Speed), [r0, r1] = range(P.Rotation), [w0, w1] = range(P.RotSpeed), spread = P.SpreadAngle ?? [0, 0];
    const dir = new THREE.Vector3(...(DIR[P.EmissionDirection] ?? DIR.Top));
    for (let i = 0; i < n && this.parts.length < MAX; i++) {
      // Spread: random rotation around the two axes perpendicular to the emission direction (degrees, ±).
      const ax = THREE.MathUtils.degToRad((R() * 2 - 1) * spread[0]), az = THREE.MathUtils.degToRad((R() * 2 - 1) * spread[1]);
      const v = dir.clone().applyEuler(new THREE.Euler(ax, 0, az)).multiplyScalar((s0 + (s1 - s0) * R()) * scale);
      const pos = rootPos.clone().add(this.origin.clone().multiplyScalar(scale));
      this.parts.push({ age: 0, life: l0 + (l1 - l0) * R(), pos, vel: v, rot: THREE.MathUtils.degToRad(r0 + (r1 - r0) * R()), spin: THREE.MathUtils.degToRad(w0 + (w1 - w0) * R()), env: R() * 2 - 1, envT: R() * 2 - 1, frame0: P.FlipbookStartRandom ? Math.floor(R() * this.frames) : 0, rnd: R() });
    }
  }
  step(dt, scale, rootPos, timeScale) {
    const P = this.p; dt *= timeScale;
    if (this.enabled && P.Rate > 0) { this.acc += P.Rate * dt; const n = Math.floor(this.acc); this.acc -= n; if (n) this.spawn(n, scale, rootPos); }
    const drag = P.Drag ? Math.pow(0.5, P.Drag * dt) : 1, acc = new THREE.Vector3(...(P.Acceleration ?? [0, 0, 0])).multiplyScalar(scale);
    this.parts = this.parts.filter(p => { p.age += dt; if (p.age >= p.life) return false; p.vel.addScaledVector(acc, dt).multiplyScalar(drag); p.pos.addScaledVector(p.vel, dt); p.rot += p.spin * dt; return true; });
  }
  upload(scale) {
    const P = this.p, n = this.parts.length;
    for (let i = 0; i < n; i++) {
      const p = this.parts[i], t = p.age / p.life, sz = at(this.size, t), tr = at(this.transp, t), c = at(this.color, t)[1], sq = at(this.squash, t)[1];
      const size = Math.max(0, (sz[1] + sz[2] * p.env) * scale), alpha = 1 - THREE.MathUtils.clamp(tr[1] + tr[2] * p.envT, 0, 1);
      const sx = size * (sq >= 0 ? 1 / (1 + sq) : 1 - sq), sy = size * (sq >= 0 ? 1 + sq : 1 / (1 - sq));
      let frame = 0; const F = this.frames, fr = range(P.FlipbookFramerate)[0];
      if (F > 1) { if (P.FlipbookMode === 'OneShot') frame = Math.min(F - 1, Math.floor(t * F)); else if (P.FlipbookMode === 'PingPong') { const k = Math.floor(p.age * fr) % (2 * F - 2 || 1); frame = k < F ? k : 2 * F - 2 - k; } else if (P.FlipbookMode === 'Random') frame = Math.floor((Math.sin((Math.floor(p.age * fr) + 1) * 91.7 + p.rnd * 1000) * 0.5 + 0.5) * F) % F; else frame = (p.frame0 + Math.floor(p.age * fr)) % F; }
      this.aPos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z); this.aVel.setXYZ(i, p.vel.x, p.vel.y, p.vel.z); this.aCol.setXYZW(i, c[0], c[1], c[2], alpha); this.aDat.setXYZW(i, sx, sy, p.rot, frame);
    }
    this.geo.instanceCount = n; for (const a of [this.aPos, this.aCol, this.aDat, this.aVel]) a.needsUpdate = true;
  }
  clear() { this.parts = []; this.acc = 0; }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/** Beam/Trail ribbon (Beam: cubic Bezier between attachments; Trail: history of the attachment pair). */
class Ribbon {
  constructor(layer, tex, kind) {
    this.layer = layer; this.kind = kind; this.p = { ...(kind === 'beam' ? DEFAULTS.Beam : DEFAULTS.Trail), ...layer.props }; this.enabled = false; this.history = []; this.time = 0;
    this.color = cseq(this.p.Color); this.transp = seq(this.p.Transparency); this.width = seq(this.p.WidthScale ?? 1);
    this.tex = (tex ?? DEFAULT_TEX).clone(); this.tex.wrapS = THREE.RepeatWrapping; this.tex.needsUpdate = true;
    this.geo = new THREE.BufferGeometry(); this.mat = new THREE.MeshBasicMaterial({ map: this.tex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: this.p.LightEmission > 0.5 ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }
  build(points, widths, camera, alongTexture) {
    const n = points.length; if (n < 2 || !this.enabled) { this.mesh.visible = false; return; } this.mesh.visible = true;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), col = new Float32Array(n * 8), idx = [], camPos = camera.position;
    let len = 0; const lens = [0]; for (let i = 1; i < n; i++) { len += points[i].distanceTo(points[i - 1]); lens.push(len); }
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), p = points[i], tan = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
      const side = this.p.FaceCamera || this.kind === 'trail' ? tan.clone().cross(camPos.clone().sub(p)).normalize() : tan.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
      const w = widths[i] / 2, a = p.clone().addScaledVector(side, w), b = p.clone().addScaledVector(side, -w);
      pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      const L = this.p.TextureLength || 1, u = this.p.TextureMode === 'Stretch' ? t * (this.kind === 'beam' ? 1 : 1) : lens[i] / L;
      const scroll = this.kind === 'beam' ? -this.time * (this.p.TextureSpeed ?? 0) : 0; uv.set([u + scroll, 1, u + scroll, 0], i * 4);
      const c = at(this.color, t)[1], al = 1 - at(this.transp, t)[1], k = this.p.Brightness ?? 1; col.set([c[0] * k, c[1] * k, c[2] * k, al, c[0] * k, c[1] * k, c[2] * k, al], i * 8);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); this.geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); this.geo.setIndex(idx); this.geo.computeBoundingSphere();
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); this.tex.dispose(); }
}

const forceField = color => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 }, uTime: { value: 0 } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2); float bands = 0.6 + 0.4 * sin(vP.y * 18.0 + uTime * 6.0); gl_FragColor = vec4(uColor * (f * 0.9 + 0.02) * bands * uAlpha, 1.0); }' });

export class VFXPreview {
  constructor(host) {
    this.host = host; this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }); this.renderer.setPixelRatio(Math.min(2, devicePixelRatio)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#141814');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000); this.camera.position.set(14, 10, 18);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.target.set(0, 3, 0); this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight('#cfe0ff', '#2a2a22', 1.1)); const sun = new THREE.DirectionalLight('#fff4e0', 1.4); sun.position.set(20, 40, 10); this.scene.add(sun);
    const grid = new THREE.GridHelper(64, 64, '#46543b', '#262d25'); this.scene.add(grid); this.grid = grid;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: '#1b201b', roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; this.scene.add(ground); this.ground = ground;
    this.dummy = this.makeDummy(); this.scene.add(this.dummy);
    this.root = new THREE.Group(); this.scene.add(this.root); this.textures = new Map(); this.loader = new THREE.TextureLoader();
    this.effect = null; this.items = []; this.anims = []; this.events = []; this.cursor = 0; this.time = 0; this.playing = true; this.loop = true; this.speed = 1; this.scale = 1; this.motion = false; this.quality = 1; this.seed = 7;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); this.resize();
    this.last = performance.now(); this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
  }
  makeDummy() { // 5.2-stud R15-sized block figure for scale
    const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: '#8a9480', roughness: 0.8, transparent: true, opacity: 0.55 }), box = (w, h, d, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); };
    box(2, 2, 1, 0, 3, 0); box(1.2, 1.2, 1.2, 0, 4.6, 0); box(1, 2, 1, -1.5, 3, 0); box(1, 2, 1, 1.5, 3, 0); box(1, 2, 1, -0.5, 1, 0); box(1, 2, 1, 0.5, 1, 0); g.position.set(-6, 0, 0); return g;
  }
  resize() { const w = this.host.clientWidth || 300, h = this.host.clientHeight || 300; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  async texture(key, url) {
    if (!url) return null; if (this.textures.has(key)) return this.textures.get(key);
    const p = new Promise(res => this.loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, () => res(null))); this.textures.set(key, p); return p;
  }
  /** effect: VFX JSON; events: timeline from buildEffect(); urlOf(texture) → URL for the preview. */
  async load(effect, events, urlOf) {
    for (const it of this.items) { this.root.remove(it.obj); it.dispose?.(); } this.items = [];
    this.effect = null; this.anims = []; this.events = events; this.cursor = 0; this.duration = Math.max(0.1, events.reduce((m, e) => Math.max(m, e.t + (e.dur ?? 0)), 0), effect.duration ?? 0);
    const byPath = {}; let seed = this.seed;
    for (const L of effect.layers ?? []) {
      if (L.enabled === false) continue;
      const name = String(L.name ?? L.type).replace(/[^A-Za-z0-9_ -]/g, '').trim().replace(/\s+/g, '') || 'Layer', tex = L.texture ? await this.texture(JSON.stringify(L.texture), urlOf(L.texture)) : null;
      let it = null;
      if (L.type === 'emitter') { const e = new Emitter(L, tex, seed += 101); it = { kind: 'emitter', seed, layer: L, sim: e, obj: e.mesh, dispose: () => e.dispose() }; byPath[`Root/${name}Att/${name}`] = it; }
      else if (L.type === 'beam' || L.type === 'trail') { const r = new Ribbon(L, tex, L.type); it = { kind: L.type, layer: L, sim: r, obj: r.mesh, a0: new THREE.Vector3(...(L.a0 ?? [0, 0, 0])), a1: new THREE.Vector3(...(L.a1 ?? [0, 4, 0])), dispose: () => r.dispose() }; it.base0 = it.a0.clone(); it.base1 = it.a1.clone(); byPath[`Root/${name}`] = it; byPath[`Root/${name}A0`] = { attach: it, which: 'a0' }; byPath[`Root/${name}A1`] = { attach: it, which: 'a1' }; }
      else if (L.type === 'light') { const p = { ...DEFAULTS[L.class ?? 'PointLight'], ...L.props }, light = L.class === 'SpotLight' ? new THREE.SpotLight(p.Color, 0, p.Range * 1.2, THREE.MathUtils.degToRad(p.Angle / 2)) : new THREE.PointLight(p.Color, 0, p.Range * 1.2, 1.2); light.position.set(...(L.offset ?? [0, 1, 0]));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: DEFAULT_TEX, color: p.Color, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })); halo.scale.setScalar(p.Range * 0.25); light.add(halo);
        it = { kind: 'light', layer: L, obj: light, light, halo, props: { Brightness: p.Brightness, Range: p.Range }, base: { Brightness: p.Brightness, Range: p.Range }, enabled: false }; byPath[`Root/${name}`] = it; }
      else if (L.type === 'mesh') { const geo = L.shape === 'Cylinder' ? new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1, true).rotateZ(Math.PI / 2) : L.shape === 'Block' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(0.5, 48, 24);
        const mat = L.material === 'ForceField' ? forceField(L.color ?? '#ffffff') : new THREE.MeshBasicMaterial({ color: new THREE.Color(L.color ?? '#ffffff').multiplyScalar(L.material === 'Neon' || !L.material ? 1.6 : 1), transparent: true, depthWrite: false, blending: L.material === 'Neon' || !L.material ? THREE.AdditiveBlending : THREE.NormalBlending });
        const mesh = new THREE.Mesh(geo, mat); mesh.position.set(...(L.offset ?? [0, 0, 0])); if (L.rotation) mesh.rotation.set(...['rx', 'ry', 'rz'].map(k => THREE.MathUtils.degToRad(L.rotation[k] ?? 0)));
        it = { kind: 'mesh', layer: L, obj: mesh, props: { Size: [...(L.size ?? [1, 1, 1])], Transparency: L.transparency ?? 1, Color: toRGB(L.color ?? '#ffffff') }, base: { Size: [...(L.size ?? [1, 1, 1])], Transparency: L.transparency ?? 1, Color: toRGB(L.color ?? '#ffffff') } }; byPath[name] = it; }
      else if (L.type === 'post' || L.type === 'highlight') { it = { kind: L.type, layer: L, obj: new THREE.Group(), props: { ...DEFAULTS[L.class ?? (L.type === 'highlight' ? 'Highlight' : 'BloomEffect')], ...L.props }, enabled: false }; it.base = { ...it.props }; byPath[name] = it; }
      if (it) { this.items.push(it); this.root.add(it.obj); }
    }
    this.byPath = byPath; this.effect = effect; this.restart();
  }
  restart() { this.time = 0; this.cursor = 0; this.anims = []; for (const it of this.items) { it.sim?.clear?.(); if (it.seed) it.sim.rand = rng(it.seed); if (it.sim) { it.sim.enabled = false; it.sim.history = []; } it.enabled = false; if (it.a0) { it.a0.copy(it.base0); it.a1.copy(it.base1); } if (it.base) it.props = structuredClone(it.base); } this.apply(); }
  /** Re-simulate deterministically up to time t (scrubbing). */
  seek(t) { const keep = this.playing; this.restart(); while (this.time + DT <= t) this.advance(DT); this.playing = keep; this.apply(); }
  rootPos() { if (!this.motion) return new THREE.Vector3(0, 3, 0); const a = this.time * 2.2; return new THREE.Vector3(Math.cos(a) * 6, 3 + Math.sin(a * 2) * 0.6, Math.sin(a) * 6); }
  advance(dt) {
    this.time += dt; const rp = this.rootPos(); this.root.userData.pos = rp;
    while (this.cursor < this.events.length && this.events[this.cursor].t <= this.time) this.run(this.events[this.cursor++], rp);
    for (const a of this.anims ?? []) { const k = THREE.MathUtils.clamp((this.time - a.t) / Math.max(1e-3, a.dur), 0, 1), e = ease(k, a.style, a.dir), v = Array.isArray(a.from) ? a.from.map((x, i) => x + (a.to[i] - x) * e) : a.from + (a.to - a.from) * e; a.set(v); }
    this.anims = this.anims.filter(a => this.time - a.t < a.dur + DT);
    for (const it of this.items) if (it.kind === 'emitter') it.sim.step(dt, this.scale, rp, it.sim.p.TimeScale ?? 1);
    for (const it of this.items) if (it.kind === 'trail' && it.sim.enabled) { const p0 = it.a0.clone().multiplyScalar(this.scale).add(rp), p1 = it.a1.clone().multiplyScalar(this.scale).add(rp); it.sim.history.unshift({ t: this.time, p: p0.add(p1).multiplyScalar(0.5), w: p1.distanceTo(it.a0.clone().multiplyScalar(this.scale).add(rp)) }); it.sim.history = it.sim.history.filter(h => this.time - h.t <= (it.sim.p.Lifetime ?? 0.5)); }
    for (const it of this.items) if (it.sim instanceof Ribbon) it.sim.time = this.time;
  }
  run(e, rp) {
    const it = this.byPath[e.target]; if (!it) return;
    if (e.kind === 'emit') it.sim.spawn(Math.max(1, Math.round(e.count * this.quality)), this.scale, rp);
    else if (e.kind === 'enable') { if (it.sim) it.sim.enabled = e.on; else it.enabled = e.on; }
    else if (e.kind === 'anim') {
      const target = it.attach ? it.attach : it, conv = v => (e.type === 'color3' && typeof v === 'string') ? toRGB(v) : v;
      const set = it.attach ? v => it.attach[it.which].set(...v) : v => { target.props ??= {}; target.props[e.prop] = v; };
      this.anims.push({ t: e.t, dur: e.dur, style: e.style, dir: e.dir, from: conv(e.from), to: conv(e.to), set });
    }
  }
  apply() {
    const rp = this.root.userData.pos ?? this.rootPos(); let filter = '';
    for (const it of this.items) {
      if (it.kind === 'emitter') it.sim.upload(this.scale);
      else if (it.kind === 'beam') { const a = it.a0.clone().multiplyScalar(this.scale).add(rp), d = it.a1.clone().multiplyScalar(this.scale).add(rp), P = it.sim.p, c1 = a.clone().add(new THREE.Vector3((P.CurveSize0 ?? 0) * this.scale, 0, 0)), c2 = d.clone().sub(new THREE.Vector3((P.CurveSize1 ?? 0) * this.scale, 0, 0));
        const n = Math.max(2, P.Segments ?? 10) + 1, curve = new THREE.CubicBezierCurve3(a, c1, c2, d), pts = curve.getPoints(n - 1), widths = pts.map((_, i) => ((P.Width0 ?? 1) + ((P.Width1 ?? 1) - (P.Width0 ?? 1)) * i / (n - 1)) * this.scale * (it.props?.WidthK ?? 1)); it.sim.build(pts, widths, this.camera); }
      else if (it.kind === 'trail') { const h = it.sim.history, pts = h.map(x => x.p), widths = h.map((x, i) => x.w * at(it.sim.width, i / Math.max(1, h.length - 1))[1]); it.sim.build(pts, widths, this.camera); }
      else if (it.kind === 'light') { const on = it.enabled, b = it.props.Brightness ?? 0; it.light.intensity = on ? b * 6 : 0; it.light.distance = (it.props.Range ?? 12) * this.scale * 1.2; it.light.position.copy(rp); it.halo.material.opacity = on ? Math.min(1, b / 6) * 0.6 : 0; }
      else if (it.kind === 'mesh') { const m = it.obj, s = it.props.Size; m.scale.set(s[0] * this.scale, s[1] * this.scale, s[2] * this.scale); m.position.copy(rp).add(new THREE.Vector3(...(it.layer.offset ?? [0, 0, 0])).multiplyScalar(this.scale)); const a = 1 - THREE.MathUtils.clamp(it.props.Transparency, 0, 1); m.visible = a > 0.003;
        if (m.material.uniforms) { m.material.uniforms.uAlpha.value = a; m.material.uniforms.uTime.value = this.time; m.material.uniforms.uColor.value.setRGB(...it.props.Color); } else { m.material.opacity = a; m.material.color.setRGB(...it.props.Color.map(x => x * (it.layer.material === 'Neon' || !it.layer.material ? 1.6 : 1))); } }
      else if (it.kind === 'post' && it.enabled) { const p = it.props, c = it.layer.class ?? 'BloomEffect';
        if (c === 'BloomEffect') filter += ` brightness(${1 + (p.Intensity ?? 1) * 0.12}) saturate(1.1)`; else if (c === 'BlurEffect') filter += ` blur(${(p.Size ?? 24) / 8}px)`; else if (c === 'ColorCorrectionEffect') filter += ` brightness(${1 + (p.Brightness ?? 0)}) contrast(${1 + (p.Contrast ?? 0)}) saturate(${1 + (p.Saturation ?? 0)})`; }
    }
    this.renderer.domElement.style.filter = filter.trim();
  }
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.playing && this.effect) { let left = dt * this.speed; while (left > 1e-6) { const s = Math.min(DT, left); this.advance(s); left -= s; } if (this.time >= this.duration + 0.4) { if (this.loop) this.restart(); else this.playing = false; } this.apply(); }
    this.controls.update(); this.renderer.render(this.scene, this.camera); this.onFrame?.(this);
    requestAnimationFrame(this.frame);
  }
  stats() { let particles = 0; for (const it of this.items) if (it.kind === 'emitter') particles += it.sim.parts.length; return { particles, layers: this.items.length, time: this.time, duration: this.duration }; }
  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}
