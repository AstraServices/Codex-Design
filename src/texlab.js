import * as THREE from 'three';
import { noise, fbm } from './textures.js';

// Texture lab: the building blocks texture artists combine in Substance Designer, as small tileable functions.
// The AI composes its OWN material per model from these (k.tex.* in recipes, or a texture recipe file for 4K export):
//   k.pbrSurface({ height:(u,v)=>…, albedo:(c)=>…, roughness:(c)=>…, metalness:(c)=>… }, {size:1024})
//   k.paint(mesh, { painter:{ albedo, roughness, metalness, height, emissive } })   // model-aware: edges, height, AO
// All u,v inputs are 0–1 and every generator is periodic (seamless). Outputs are 0–1 unless noted.

const fract = x => x - Math.floor(x), clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
export const hash = (x, y, s = 0) => { let h = (Math.floor(x) * 374761393 + Math.floor(y) * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
export { noise, fbm };
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
/** Ridged multifractal (cracks, veins, mountain ridges). */
export const ridged = (u, v, period = 4, oct = 5, seed = 1) => { let s = 0, a = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += (1 - Math.abs(noise(u, v, period << i, seed + i) * 2 - 1)) ** 2 * a; n += a; a *= 0.5; } return s / n; };
/** Turbulence (|noise| sum): smoke, marble veins. */
export const turbulence = (u, v, period = 4, oct = 5, seed = 1) => { let s = 0, a = 0.5, n = 0; for (let i = 0; i < oct; i++) { s += Math.abs(noise(u, v, period << i, seed + i) * 2 - 1) * a; n += a; a *= 0.5; } return s / n; };
/** Domain warp: returns warped [u,v]. */
export const warp = (u, v, amount = 0.1, period = 4, seed = 1) => [u + (fbm(u, v, period, 3, seed) - 0.5) * amount, v + (fbm(u, v, period, 3, seed + 17) - 0.5) * amount];
/** Worley / Voronoi cells: {f1, f2, edge (f2−f1), id, cx, cy}. */
export function cells(u, v, period = 8, seed = 1, jitter = 0.9) {
  const x = fract(u) * period, y = fract(v) * period, xi = Math.floor(x), yi = Math.floor(y); let f1 = 9, f2 = 9, id = 0, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = ((xi + i) % period + period) % period, gy = ((yi + j) % period + period) % period, px = xi + i + 0.5 + (hash(gx, gy, seed) - 0.5) * jitter, py = yi + j + 0.5 + (hash(gx, gy, seed + 9) - 0.5) * jitter, d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash(gx, gy, seed + 3); cx = px / period; cy = py / period; } else if (d < f2) f2 = d;
  }
  return { f1, f2, edge: f2 - f1, id, cx, cy };
}
/** Bricks / tiles: {mask (1 inside), bevel (0 edge → 1 center), id, row, col, lu, lv (local 0–1 inside the brick)}. */
export function bricks(u, v, { rows = 8, cols = 4, offset = 0.5, mortar = 0.04, bevel = 0.08, jitter = 0, seed = 1 } = {}) {
  const row = Math.floor(fract(v) * rows), x = fract(u) * cols + (row % 2) * offset + (hash(row, 0, seed) - 0.5) * jitter, col = Math.floor(x), lu = fract(x), lv = fract(fract(v) * rows);
  const ex = Math.min(lu, 1 - lu) / cols * rows, ey = Math.min(lv, 1 - lv), e = Math.min(ex, ey) - mortar / 2;
  return { mask: e > 0 ? 1 : 0, bevel: clamp(e / bevel), id: hash(row, ((col % cols) + cols) % cols, seed), row, col, lu, lv };
}
/** Square tiles (grid). */
export const tiles = (u, v, n = 4, opts = {}) => bricks(u, v, { rows: n, cols: n, offset: 0, ...opts });
/** Hexagon grid (seamless; rows snap to whole periods): {edge (0 at the border → 1 at the center), id}. */
export function hexagons(u, v, n = 6, seed = 1) {
  const SY = Math.sqrt(3), k = Math.max(1, Math.round(n / SY)), x = fract(u) * n, y = fract(v) * k * SY, m = (a, b) => ((a % b) + b) % b;
  const a = [m(x, 1) - 0.5, m(y, SY) - SY / 2], b = [m(x - 0.5, 1) - 0.5, m(y - SY / 2, SY) - SY / 2], g = a[0] ** 2 + a[1] ** 2 < b[0] ** 2 + b[1] ** 2 ? a : b;
  const d = Math.max(Math.abs(g[0]) * 0.5 + Math.abs(g[1]) * SY / 2, Math.abs(g[0]));
  return { edge: clamp((0.5 - d) * 2), id: hash(Math.round((x - g[0]) * 2), Math.round((y - g[1]) * 2), seed) };
}
/** Wood planks: {mask, grain (0–1 rings), id, knot}. */
export function planks(u, v, { rows = 5, seed = 1, gap = 0.012, ringScale = 14 } = {}) {
  const row = Math.floor(fract(v) * rows), x = fract(u + hash(row, 1, seed)), lv = fract(fract(v) * rows), id = hash(row, Math.floor(x * 2), seed);
  const seam = Math.min(lv, 1 - lv) / rows, end = Math.min(fract(x * 2), 1 - fract(x * 2)) / 2;
  const [wu, wv] = warp(x, v, 0.04, 4, seed + row), grain = Math.sin((wv * rows * ringScale + fbm(wu, v, 4, 4, seed + row) * 6) * Math.PI) * 0.5 + 0.5;
  const kc = cells(u, v, 6, seed + 40), knot = kc.f1 < 0.12 && kc.id > 0.8 ? 1 - kc.f1 / 0.12 : 0;
  return { mask: seam > gap && end > gap * 0.5 ? 1 : 0, grain, id, knot };
}
/** Scratches: thin random line segments (0 none → 1 scratch). */
export function scratches(u, v, { count = 24, length = 0.25, width = 0.0025, seed = 1 } = {}) {
  let s = 0;
  for (let i = 0; i < count; i++) {
    const ax = hash(i, 1, seed), ay = hash(i, 2, seed), ang = hash(i, 3, seed) * Math.PI, bx = ax + Math.cos(ang) * length, by = ay + Math.sin(ang) * length;
    for (const ox of [-1, 0, 1]) for (const oy of [-1, 0, 1]) { const px = u + ox - ax, py = v + oy - ay, dx = bx - ax, dy = by - ay, t = clamp((px * dx + py * dy) / (dx * dx + dy * dy)), d = Math.hypot(px - dx * t, py - dy * t); if (d < width) s = Math.max(s, (1 - d / width) * (0.4 + 0.6 * Math.sin(t * Math.PI))); }
  }
  return s;
}
export const stripes = (u, v, n = 8, angle = 0, soft = 0.02) => { const t = fract((u * Math.cos(angle) + v * Math.sin(angle)) * n); return smooth(0.5 - soft, 0.5 + soft, t) - smooth(1 - soft, 1, t); };
export const dots = (u, v, n = 8, r = 0.3, seed = 0) => { const x = fract(u * n) - 0.5, y = fract(v * n) - 0.5, j = seed ? (hash(Math.floor(u * n), Math.floor(v * n), seed) - 0.5) * 0.3 : 0; return 1 - smooth(r - 0.04, r, Math.hypot(x + j, y - j)); };
export const waves = (u, v, n = 6, amp = 0.05, seed = 1) => Math.sin((v + Math.sin(u * Math.PI * 2 * 2) * amp + fbm(u, v, 4, 2, seed) * amp) * n * Math.PI * 2) * 0.5 + 0.5;
/** Weave (fabric): 0–1 thread height. */
export const weave = (u, v, n = 24) => { const a = Math.sin(u * n * 2 * Math.PI) ** 2, b = Math.sin(v * n * 2 * Math.PI) ** 2; return (Math.floor(u * n) + Math.floor(v * n)) % 2 ? a : b; };
/** Color ramp over 0–1: stops [[t,'#hex'|[r,g,b]]…] → [r,g,b] 0–1 (sRGB). */
export function ramp(stops, t) {
  const S = stops.map(([p, c]) => [p, Array.isArray(c) ? c : rgb(c)]); t = clamp(t);
  for (let i = 1; i < S.length; i++) if (t <= S[i][0]) return mix(S[i - 1][1], S[i][1], (t - S[i - 1][0]) / ((S[i][0] - S[i - 1][0]) || 1));
  return S.at(-1)[1];
}
export function rgb(c) { const col = new THREE.Color(c), o = {}; col.getRGB(o, THREE.SRGBColorSpace); return [o.r, o.g, o.b]; }
/** Blend modes on [r,g,b] colors. */
export const blend = {
  multiply: (a, b, t = 1) => mix(a, a.map((v, i) => v * b[i]), t),
  screen: (a, b, t = 1) => mix(a, a.map((v, i) => 1 - (1 - v) * (1 - b[i])), t),
  overlay: (a, b, t = 1) => mix(a, a.map((v, i) => v < 0.5 ? 2 * v * b[i] : 1 - 2 * (1 - v) * (1 - b[i])), t),
  add: (a, b, t = 1) => a.map((v, i) => Math.min(1, v + b[i] * t)),
};
/** Height helpers: smooth-union two heights, terrace a height, invert. */
export const smax = (a, b, k = 0.05) => { const h = clamp(0.5 + 0.5 * (a - b) / k); return lerp(b, a, h) + k * h * (1 - h); };
export const terrace = (h, steps = 5, sharp = 0.7) => { const f = h * steps, i = Math.floor(f), t = f - i; return (i + smooth(0.5 - sharp / 2, 0.5 + sharp / 2, t)) / steps; };
export { clamp, fract };
