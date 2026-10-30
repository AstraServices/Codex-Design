import * as THREE from 'three';
import { noise, fbm, smoothstep, dataTexture } from './textures.js';

// Procedural PBR texture sets (albedo, normal, roughness, AO, height, metalness) up to 4096².
// The AI writes its OWN material definition per model (see docs/train/textures.md and src/texlab.js):
//   { height:(u,v,seed)=>number|{h,id,mask}, albedo:(ctx)=>[r,g,b], roughness:(ctx)=>0–1, metalness?:(ctx)=>0–1, normal?:strength, metal?:bool }
// The entries in PBR_EXAMPLES are worked examples of that format to learn from, not a catalog to pick from.
// Built the way texture artists build them in Substance Designer (see docs/TRAINING.md §Textures):
// 1) a height field from shape primitives + domain-warped fbm, 2) normal from height (Sobel),
// 3) cavity/AO from height minus its blur, 4) curvature (edges) from the height Laplacian,
// 5) albedo = color ramp over height + per-cell variation + cavity darkening + edge wear,
// 6) roughness varies with wear and cavity, 7) everything tiles seamlessly (all noise is periodic).

const TAU = Math.PI * 2;
const hash2 = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
const warp = (u, v, amt, period, seed) => [u + (fbm(u, v, period, 3, seed) - 0.5) * amt, v + (fbm(u, v, period, 3, seed + 17) - 0.5) * amt];
const wrap = x => x - Math.floor(x);
/** Tileable Worley cells: {f1, f2, id}. */
function cells(u, v, period, seed, jitter = 0.85) {
  const x = wrap(u) * period, y = wrap(v) * period, xi = Math.floor(x), yi = Math.floor(y); let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ((xi + i) % period + period) % period, cy = ((yi + j) % period + period) % period;
    const d = Math.hypot(xi + i + 0.5 + (hash2(cx, cy, seed) - 0.5) * jitter - x, yi + j + 0.5 + (hash2(cx, cy, seed + 9) - 0.5) * jitter - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(cx, cy, seed + 3); } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}
const ramp = (stops, t) => { t = THREE.MathUtils.clamp(t, 0, 1); for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (t - t0) / ((t1 - t0) || 1); return c0.map((c, j) => c + (c1[j] - c) * k); } return stops.at(-1)[1]; };
const hex = h => { const c = new THREE.Color(h), o = {}; c.getRGB(o, THREE.SRGBColorSpace); return [o.r, o.g, o.b]; };

/**
 * Each preset: height(u,v) → {h, id?, mask?} in 0–1, albedo(ctx) → [r,g,b] 0–1, rough(ctx), metal(ctx).
 * ctx = {u,v,h,id,mask,cavity,edge,n} where cavity<0 means a crevice and edge>0 a convex edge.
 */
export const PBR_EXAMPLES = {
  'stone-wall': { note: 'Irregular stacked stone blocks with mortar', normal: 6,
    height: (u, v, s) => { const row = Math.floor(v * 6), uu = u + (hash2(row, 0, s) * 0.5), c = cells(uu * 1.5, v, 6, s + 1, 0.6), g = smoothstep(0.02, 0.12, c.f2 - c.f1); return { h: g * (0.65 + fbm(u, v, 8, 5, s + 2) * 0.35), id: c.id, mask: g }; },
    albedo: c => { const base = ramp([[0, hex('#4a4640')], [0.5, hex('#7d776c')], [1, hex('#a49d8e')]], 0.3 + c.id * 0.5 + c.n * 0.25); const mortar = hex('#3a362f'); return base.map((b, i) => (c.mask < 0.5 ? mortar[i] : b) * (1 + c.cavity * 1.5) * (1 + c.edge * 0.6)); },
    rough: c => 0.78 + (1 - c.mask) * 0.15 - c.edge * 0.2 },
  cobblestone: { note: 'Rounded cobbles in dirt', normal: 7,
    height: (u, v, s) => { const [wu, wv] = warp(u, v, 0.05, 4, s), c = cells(wu, wv, 8, s, 0.9), d = THREE.MathUtils.clamp((c.f2 - c.f1) * 3.2, 0, 1); return { h: Math.sqrt(d) * (0.8 + fbm(u, v, 16, 4, s + 3) * 0.2), id: c.id, mask: d > 0.08 ? 1 : 0 }; },
    albedo: c => { const stone = ramp([[0, hex('#5b5650')], [1, hex('#9b958a')]], c.id * 0.7 + c.n * 0.3), dirt = hex('#3d3022'); return stone.map((x, i) => THREE.MathUtils.lerp(dirt[i], x, smoothstep(0.03, 0.2, c.h)) * (1 + c.cavity * 1.2)); },
    rough: c => 0.7 + (1 - c.h) * 0.25 },
  bark: { note: 'Deep vertical tree bark ridges', normal: 8,
    height: (u, v, s) => { const [wu, wv] = warp(u, v * 0.25, 0.25, 4, s), ridges = 1 - Math.abs(Math.sin((wu * 10 + fbm(u, v, 4, 4, s) * 2) * Math.PI)); return { h: Math.pow(ridges, 0.6) * 0.75 + fbm(u, v, 32, 4, s + 1) * 0.25, id: noise(u, v, 4, s) }; },
    albedo: c => ramp([[0, hex('#21160e')], [0.45, hex('#4b3626')], [0.8, hex('#6e5640')], [1, hex('#8f7a62')]], c.h * 0.9 + c.n * 0.15).map(x => x * (1 + c.cavity * 1.4)),
    rough: c => 0.85 + (1 - c.h) * 0.1 },
  'wood-planks': { note: 'Planks with grain, knots and seams', normal: 3,
    height: (u, v, s) => { const row = Math.floor(v * 5), off = hash2(row, 1, s), x = wrap(u + off), seam = Math.min((v * 5) % 1, 1 - (v * 5) % 1), end = Math.min(wrap(x * 2), 1 - wrap(x * 2)); const g = smoothstep(0, 0.04, seam) * smoothstep(0, 0.01, end); const grain = Math.sin((v * 5 * 14 + fbm(x, v, 4, 4, s + row) * 6) * Math.PI) * 0.5 + 0.5; return { h: g * (0.85 + grain * 0.15), id: hash2(row, Math.floor(x * 2), s), mask: grain }; },
    albedo: c => ramp([[0, hex('#5a3a20')], [0.5, hex('#8b5e36')], [1, hex('#b5865a')]], 0.25 + c.id * 0.45 + c.mask * 0.3).map(x => x * (1 + c.cavity * 2)),
    rough: c => 0.62 + (1 - c.mask) * 0.15 },
  brick: { note: 'Running-bond brick with chipped edges', normal: 6,
    height: (u, v, s) => { const rows = 8, row = Math.floor(v * rows), x = wrap(u * 4 + (row % 2) * 0.5), y = (v * rows) % 1, chip = fbm(u, v, 32, 3, s) * 0.06; const m = smoothstep(0.03, 0.07 + chip, Math.min(x / 2, (1 - x) / 2, y, 1 - y) * 1); return { h: m * (0.85 + fbm(u, v, 16, 4, s + 1) * 0.15), id: hash2(row, Math.floor(u * 4 + (row % 2) * 0.5), s), mask: m }; },
    albedo: c => { const b = ramp([[0, hex('#6d2c1d')], [0.5, hex('#9a4430')], [1, hex('#b86a4e')]], c.id * 0.8 + c.n * 0.2), mortar = hex('#b4aa98'); return b.map((x, i) => (c.mask < 0.4 ? mortar[i] * (0.8 + c.n * 0.2) : x) * (1 + c.cavity) * (1 + c.edge * 0.4)); },
    rough: c => 0.85 },
  'painted-metal': { note: 'Painted steel with worn edges, scratches and rust', normal: 2, metal: true,
    height: (u, v, s) => { const plate = Math.min(wrap(u * 2), 1 - wrap(u * 2), wrap(v * 2), 1 - wrap(v * 2)), rivet = Math.max(0, 1 - Math.hypot(wrap(u * 16) - 0.5, wrap(v * 2) * 8 - 0.4) * 4) * (plate < 0.06 ? 1 : 0); const scratch = Math.pow(Math.abs(Math.sin((u * 40 + v * 7 + fbm(u, v, 8, 2, s) * 3) * TAU)), 120); return { h: smoothstep(0, 0.01, plate) * 0.9 + rivet * 0.3 - scratch * 0.05, id: fbm(u, v, 4, 5, s + 2), mask: scratch }; },
    albedo: c => { const wear = THREE.MathUtils.clamp(c.edge * 5 + c.mask * 0.8 + (c.id > 0.62 ? 0.6 : 0), 0, 1), paint = hex('#3d6f8c').map(x => x * (0.9 + c.n * 0.15)), steel = hex('#8c8f93'), rust = hex('#6b3a1f'); const base = paint.map((p, i) => THREE.MathUtils.lerp(p, steel[i], wear)); return base.map((x, i) => THREE.MathUtils.lerp(x, rust[i], smoothstep(0.1, 0.4, -c.cavity * 6) * 0.7)); },
    rough: c => THREE.MathUtils.lerp(0.45, 0.3, THREE.MathUtils.clamp(c.edge * 5 + c.mask, 0, 1)), metalness: c => THREE.MathUtils.clamp(c.edge * 5 + c.mask * 0.8 + (c.id > 0.62 ? 0.6 : 0), 0, 1) },
  'rusty-metal': { note: 'Corroded steel with pitting', normal: 4, metal: true,
    height: (u, v, s) => { const pit = cells(u, v, 24, s, 1); return { h: 0.7 + fbm(u, v, 8, 6, s) * 0.3 - Math.max(0, 0.25 - pit.f1) * 1.2, id: fbm(u, v, 4, 5, s + 4) }; },
    albedo: c => ramp([[0, hex('#3a1d0e')], [0.4, hex('#7a3b17')], [0.65, hex('#a6582a')], [0.8, hex('#6b6560')], [1, hex('#8e8a86')]], c.id * 1.1 + c.edge * 2).map(x => x * (1 + c.cavity * 1.5)),
    rough: c => c.id > 0.72 ? 0.4 : 0.88, metalness: c => c.id > 0.72 ? 0.9 : 0.15 },
  gold: { note: 'Polished gold with micro scratches', normal: 1, metal: true,
    height: (u, v, s) => ({ h: 0.5 + fbm(u, v, 64, 2, s) * 0.04 - Math.pow(Math.abs(Math.sin((u * 30 - v * 11 + fbm(u, v, 8, 2, s) * 2) * TAU)), 200) * 0.04, id: fbm(u, v, 4, 3, s) }),
    albedo: c => ramp([[0, hex('#c7962f')], [1, hex('#ffd76a')]], 0.55 + c.n * 0.4), rough: c => 0.18 + c.id * 0.12, metalness: () => 1 },
  fabric: { note: 'Woven cloth with weave and fuzz', normal: 3,
    height: (u, v, s) => { const a = Math.sin(u * 48 * Math.PI), b = Math.sin(v * 48 * Math.PI), weave = (Math.floor(u * 24) + Math.floor(v * 24)) % 2 ? a * a : b * b; return { h: weave * 0.7 + noise(u, v, 256, s) * 0.3, id: fbm(u, v, 8, 3, s) }; },
    albedo: c => ramp([[0, hex('#7d2433')], [1, hex('#c24a5c')]], c.h * 0.6 + c.id * 0.4), rough: () => 0.95 },
  'forest-ground': { note: 'Soil with pebbles, leaves and twigs', normal: 5,
    height: (u, v, s) => { const p = cells(u, v, 20, s, 1), peb = Math.max(0, 0.35 - p.f1) * 2.5 * (p.id > 0.55 ? 1 : 0); return { h: fbm(u, v, 8, 6, s + 1) * 0.55 + peb, id: p.id, mask: peb > 0.05 ? 1 : 0 }; },
    albedo: c => { const soil = ramp([[0, hex('#2b2016')], [1, hex('#5e4930')]], c.n), leaf = hex(c.id > 0.8 ? '#7a6a2a' : '#4d5a24'), peb = hex('#8a857c'); return (c.mask ? peb : c.id > 0.75 && c.n > 0.5 ? leaf : soil).map(x => x * (1 + c.cavity * 1.5)); },
    rough: c => c.mask ? 0.7 : 0.95 },
  sand: { note: 'Wind-rippled sand', normal: 3,
    height: (u, v, s) => { const [wu, wv] = warp(u, v, 0.15, 3, s); return { h: (Math.sin((wv * 18 + fbm(wu, wv, 4, 3, s) * 3) * TAU) * 0.5 + 0.5) * 0.6 + noise(u, v, 256, s + 1) * 0.4, id: fbm(u, v, 4, 3, s + 2) }; },
    albedo: c => ramp([[0, hex('#b89466')], [1, hex('#e6cf9e')]], c.h * 0.5 + c.id * 0.5), rough: () => 0.97 },
  ice: { note: 'Cracked translucent ice', normal: 3,
    height: (u, v, s) => { const c = cells(u, v, 6, s, 1), crack = 1 - smoothstep(0, 0.035, c.f2 - c.f1); return { h: 0.6 + fbm(u, v, 8, 4, s) * 0.3 - crack * 0.35, id: c.id, mask: crack }; },
    albedo: c => ramp([[0, hex('#6fa8d6')], [1, hex('#e3f4ff')]], 0.5 + c.id * 0.3 + c.mask * 0.4), rough: c => 0.08 + c.mask * 0.4 },
  lava: { note: 'Cooled basalt crust over glowing lava (use emissive = albedo × mask)', normal: 6,
    height: (u, v, s) => { const [wu, wv] = warp(u, v, 0.1, 4, s), c = cells(wu, wv, 7, s, 0.9), crust = smoothstep(0.04, 0.16, c.f2 - c.f1); return { h: crust * (0.7 + fbm(u, v, 16, 4, s) * 0.3), id: c.id, mask: 1 - crust }; },
    albedo: c => c.mask > 0.3 ? ramp([[0, hex('#ff3b00')], [1, hex('#ffd25a')]], c.mask) : ramp([[0, hex('#121011')], [1, hex('#3a3434')]], c.n).map(x => x * (1 + c.edge)),
    rough: c => c.mask > 0.3 ? 0.4 : 0.9 },
};
export const PBR_EXAMPLE_NAMES = Object.keys(PBR_EXAMPLES);
/** Normalizes a material definition (yours) or an example name. */
export function materialDef(def) {
  const P = typeof def === 'string' ? PBR_EXAMPLES[def] : def;
  if (!P) throw new Error(`Unknown example ${def}; write your own definition {height, albedo, roughness, metalness} (examples: ${PBR_EXAMPLE_NAMES.join(', ')})`);
  if (typeof P.height !== 'function' || typeof P.albedo !== 'function') throw new Error('Material definition needs height(u,v,seed) and albedo(ctx) functions');
  return { ...P, rough: P.roughness ?? P.rough ?? (() => 0.6), metalness: P.metalness ?? null, height: (u, v, s) => { const r = P.height(u, v, s); return typeof r === 'number' ? { h: r } : r; } };
}

/** Generates all maps as RGBA Uint8 arrays (rows bottom→top, v-up, like DataTexture). Large sizes are slow in JS: 4096² ≈ 30–90 s. */
export function generatePBR(def, { size = 1024, seed = 1, color, tint = 0.6, onProgress } = {}) {
  const P = materialDef(def), name = typeof def === 'string' ? def : def.name ?? 'custom';
  const N = size * size, H = new Float32Array(N), ID = new Float32Array(N), M = new Float32Array(N);
  for (let y = 0; y < size; y++) { for (let x = 0; x < size; x++) { const r = P.height((x + 0.5) / size, (y + 0.5) / size, seed), i = y * size + x; H[i] = r.h; ID[i] = r.id ?? 0; M[i] = r.mask ?? 0; } if (onProgress && y % 64 === 0) onProgress(y / size * 0.6); }
  // Cavity = height − box-blurred height (separable, wrap-around), radius scales with resolution.
  const blur = (src, rad) => { const a = new Float32Array(N), b = new Float32Array(N), w = 2 * rad + 1;
    for (let y = 0; y < size; y++) { let s = 0; for (let k = -rad; k <= rad; k++) s += src[y * size + ((k + size) % size)]; for (let x = 0; x < size; x++) { a[y * size + x] = s / w; s += src[y * size + (x + rad + 1) % size] - src[y * size + (x - rad + size) % size]; } }
    for (let x = 0; x < size; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += a[((k + size) % size) * size + x]; for (let y = 0; y < size; y++) { b[y * size + x] = s / w; s += a[((y + rad + 1) % size) * size + x] - a[((y - rad + size) % size) * size + x]; } }
    return b; };
  const wide = blur(H, Math.max(2, Math.round(size / 64))), tight = blur(H, Math.max(1, Math.round(size / 512)));
  const emissive = P.emissive ? new Uint8Array(N * 4) : null, albedo = new Uint8Array(N * 4), normal = new Uint8Array(N * 4), rough = new Uint8Array(N * 4), ao = new Uint8Array(N * 4), height = new Uint8Array(N * 4), metal = new Uint8Array(N * 4);
  const tintRGB = color ? hex(color) : null, strength = (P.normal ?? 4) * size / 1024, at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  const put = (arr, i, r, g, b) => { arr[i * 4] = THREE.MathUtils.clamp(r, 0, 1) * 255; arr[i * 4 + 1] = THREE.MathUtils.clamp(g, 0, 1) * 255; arr[i * 4 + 2] = THREE.MathUtils.clamp(b, 0, 1) * 255; arr[i * 4 + 3] = 255; };
  for (let y = 0; y < size; y++) { for (let x = 0; x < size; x++) {
    const i = y * size + x, h = H[i], cavity = THREE.MathUtils.clamp((h - wide[i]) * 2.2, -0.6, 0.4), edge = THREE.MathUtils.clamp((tight[i] - wide[i]) * 3 + (h - tight[i]) * 4, 0, 0.5);
    const ctx = { u: (x + 0.5) / size, v: (y + 0.5) / size, h, id: ID[i], mask: M[i], cavity: Math.min(0, cavity), edge, n: noise((x + 0.5) / size, (y + 0.5) / size, 32, seed + 99) };
    let c = P.albedo(ctx); if (tintRGB) { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; c = c.map((v, k) => THREE.MathUtils.lerp(v, l * tintRGB[k] * 1.9, tint)); }
    put(albedo, i, ...c);
    // Sobel normal (OpenGL convention, +Y up = glTF).
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * strength / 8;
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * strength / 8;
    const l = Math.hypot(dx, dy, 1); put(normal, i, (-dx / l) * 0.5 + 0.5, (-dy / l) * 0.5 + 0.5, (1 / l) * 0.5 + 0.5);
    const r = P.rough(ctx), m = P.metalness ? P.metalness(ctx) : 0, em = P.emissive ? P.emissive(ctx) : null; if (em) put(emissive, i, ...em); const o = THREE.MathUtils.clamp(1 + Math.min(0, cavity) * 1.6, 0, 1);
    put(rough, i, r, r, r); put(metal, i, m, m, m); put(ao, i, o, o, o); put(height, i, h, h, h);
  } if (onProgress && y % 64 === 0) onProgress(0.6 + y / size * 0.4); }
  return { name, size, seed, albedo, normal, roughness: rough, ao, height, metalness: metal, emissive, metal: !!P.metal, note: P.note };
}

/** glTF packs occlusion/roughness/metalness into one ORM texture (R=AO, G=roughness, B=metalness). */
export function packORM(set) { const n = set.size * set.size, out = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { out[i * 4] = set.ao[i * 4]; out[i * 4 + 1] = set.roughness[i * 4]; out[i * 4 + 2] = set.metalness[i * 4]; out[i * 4 + 3] = 255; } return out; }

let customId = 0; const customKeys = new WeakMap();
/** MeshStandardMaterial from YOUR material definition (or an example name). size ≤ 2048 inside recipes; repeat tiles it. */
export function pbrSurface(def, { size = 512, seed = 1, color, tint, repeat = 1, ...rest } = {}) {
  const name = typeof def === 'string' ? def : def.name ?? 'custom';
  if (typeof def === 'object' && !customKeys.has(def)) customKeys.set(def, ++customId);
  const set = generatePBR(def, { size, seed, color, tint }), orm = packORM(set), key = `pbr_${name}_${typeof def === 'object' ? customKeys.get(def) : 0}_${size}_${seed}_${color ?? ''}_${tint ?? ''}`;
  const opts = { repeat, anisotropy: 8 };
  const map = dataTexture(set.albedo, size, size, { ...opts, name: `${name}_albedo`, cacheKey: key + '_a' });
  const normalMap = dataTexture(set.normal, size, size, { ...opts, srgb: false, name: `${name}_normal`, cacheKey: key + '_n' });
  const ormMap = dataTexture(orm, size, size, { ...opts, srgb: false, name: `${name}_orm`, cacheKey: key + '_o' });
  const mat = new THREE.MeshStandardMaterial({ name: `PBR_${name}`, map, normalMap, roughnessMap: ormMap, metalnessMap: ormMap, aoMap: ormMap, roughness: 1, metalness: set.metal ? 1 : 0, ...rest });
  if (set.emissive) { mat.emissiveMap = dataTexture(set.emissive, size, size, { ...opts, name: `${name}_emissive`, cacheKey: key + '_e' }); mat.emissive.set('#ffffff'); }
  mat.userData.pbrPreset = name; return mat;
}
