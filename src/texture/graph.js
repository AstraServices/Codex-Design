// Texture Studio graph engine (isomorphic: browser page, Web Worker and Node CLI).
// A material is a JSON node graph: {name, seed, nodes:[{id,type,params,inputs:{name:nodeId}}], outputs:{baseColor,normal,
// roughness,metalness,height,ao,emissive,opacity,curvature,thickness}} → PBR maps. Generators are periodic in u,v, so every
// graph is seamless and resolution-independent; filters wrap at the borders. Deterministic per seed.
import { noise, fbm, ridged, turbulence, warp, cells, bricks, hexagons, planks, scratches, stripes, dots, weave, ramp, rgb, hash, smooth, clamp, fract } from '../texlab.js';

export const MAPS = ['baseColor', 'normal', 'roughness', 'metalness', 'height', 'ao', 'emissive', 'opacity', 'curvature', 'thickness'];
const COLOR_MAPS = new Set(['baseColor', 'emissive', 'normal']);

// ---------- buffers ----------
const gray = (N, v = 0) => ({ c: 1, d: new Float32Array(N).fill(v) });
const color = N => ({ c: 3, d: new Float32Array(N * 3) });
export function toGray(b) { if (!b) return null; if (b.c === 1) return b; const N = b.d.length / 3, o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = b.d[i * 3] * 0.2126 + b.d[i * 3 + 1] * 0.7152 + b.d[i * 3 + 2] * 0.0722; return { c: 1, d: o }; }
export function toColor(b) { if (!b) return null; if (b.c === 3) return b; const N = b.d.length, o = new Float32Array(N * 3); for (let i = 0; i < N; i++) o[i * 3] = o[i * 3 + 1] = o[i * 3 + 2] = b.d[i]; return { c: 3, d: o }; }
const field = (S, fn) => { const N = S * S, o = new Float32Array(N); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) o[y * S + x] = fn((x + 0.5) / S, (y + 0.5) / S); return { c: 1, d: o }; };
const cfield = (S, fn) => { const N = S * S, o = new Float32Array(N * 3); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = fn((x + 0.5) / S, (y + 0.5) / S), i = (y * S + x) * 3; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; } return { c: 3, d: o }; };
const map1 = (b, fn) => { const o = new Float32Array(b.d.length); for (let i = 0; i < o.length; i++) o[i] = fn(b.d[i], i); return { c: b.c, d: o }; };
/** Sample a buffer at u,v with wrap + bilinear filtering (used by warp/transform). */
function sample(b, S, u, v, ch = 0) {
  const x = fract(u) * S - 0.5, y = fract(v) * S - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, c = b.c;
  const at = (xx, yy) => b.d[((((yy % S) + S) % S) * S + (((xx % S) + S) % S)) * c + ch];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}
function blur(b, S, rad) {
  if (rad < 1) return b; const c = b.c, w = 2 * rad + 1, a = new Float32Array(b.d.length), o = new Float32Array(b.d.length);
  for (let ch = 0; ch < c; ch++) {
    for (let y = 0; y < S; y++) { let s = 0; for (let k = -rad; k <= rad; k++) s += b.d[(y * S + ((k + S) % S)) * c + ch]; for (let x = 0; x < S; x++) { a[(y * S + x) * c + ch] = s / w; s += b.d[(y * S + (x + rad + 1) % S) * c + ch] - b.d[(y * S + (x - rad + S) % S) * c + ch]; } }
    for (let x = 0; x < S; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += a[(((k + S) % S) * S + x) * c + ch]; for (let y = 0; y < S; y++) { o[(y * S + x) * c + ch] = s / w; s += a[(((y + rad + 1) % S) * S + x) * c + ch] - a[(((y - rad + S) % S) * S + x) * c + ch]; } }
  }
  return { c, d: o };
}
/** Sobel normal from height. Buffers are in image order (row 0 = top, like PNG/glTF), so OpenGL +Y (up) = −row.
 *  OpenGL (Roblox, glTF, Unity, Godot, Blender) by default; DirectX (Unreal) flips green. strength scales with resolution so looks match across sizes. */
export function heightToNormal(h, S, strength = 4, format = 'opengl') {
  const o = new Float32Array(S * S * 3), k = strength * S / 1024, at = (x, y) => h.d[(((y + S) % S) * S + ((x + S) % S))];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * k / 8;
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * k / 8;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 3; o[i] = -dx / l * 0.5 + 0.5; o[i + 1] = (format === 'directx' ? -dy : dy) / l * 0.5 + 0.5; o[i + 2] = 1 / l * 0.5 + 0.5;
  }
  return { c: 3, d: o };
}
const curvatureOf = (h, S, r = 2) => { const b = blur(h, S, Math.max(1, Math.round(r * S / 256))); return map1(h, (v, i) => clamp(0.5 + (v - b.d[i]) * 6)); };
const aoOf = (h, S, strength = 1) => { const wide = blur(h, S, Math.max(2, Math.round(S / 48))); return map1(h, (v, i) => clamp(1 + Math.min(0, v - wide.d[i]) * 3.5 * strength)); };
const hex2 = c => typeof c === 'string' ? rgb(c) : c;
const hsv2rgb = (h, s, v) => { const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
const rgb2hsv = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [((h / 6) + 1) % 1, mx ? d / mx : 0, mx]; };

// ---------- node library ----------
// p(type, label, default, extra) → param schema used by the editor and by graph validation.
const P = (key, type, def, extra = {}) => ({ key, type, default: def, ...extra });
const NUM = (key, def, min, max, step = 0.01) => P(key, 'number', def, { min, max, step });
const INT = (key, def, min, max) => P(key, 'int', def, { min, max, step: 1 });
const warpUV = (u, v, p, seed) => p.warp ? warp(u, v, p.warp, p.warpScale ?? 4, seed + 77) : [u, v];
const per = p => Math.max(1, Math.round(p.scale ?? 4));

export const NODES = {
  // Generators (seamless, seed-based)
  perlin: { cat: 'Noise', label: 'Perlin / value noise', out: 'gray', params: [INT('scale', 4, 1, 64), INT('seed', 0, 0, 999), NUM('warp', 0, 0, 1)], eval: ({ S, p, seed }) => field(S, (u, v) => { [u, v] = warpUV(u, v, p, seed); return noise(u, v, per(p), seed + p.seed); }) },
  fbm: { cat: 'Noise', label: 'FBM (multi-octave)', out: 'gray', params: [INT('scale', 4, 1, 64), INT('octaves', 5, 1, 8), INT('seed', 0, 0, 999), NUM('warp', 0, 0, 1), INT('warpScale', 4, 1, 32)], eval: ({ S, p, seed }) => field(S, (u, v) => { [u, v] = warpUV(u, v, p, seed); return fbm(u, v, per(p), p.octaves, seed + p.seed); }) },
  simplex: { cat: 'Noise', label: 'Simplex-style (rotated octaves)', out: 'gray', params: [INT('scale', 4, 1, 64), INT('octaves', 4, 1, 8), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => { let s = 0, a = 0.5, n = 0; for (let i = 0; i < p.octaves; i++) { s += noise(u + i * 0.37, v + i * 0.61, per(p) << i, seed + p.seed + i * 5) * a; n += a; a *= 0.5; } return s / n; }) },
  ridged: { cat: 'Noise', label: 'Ridged multifractal', out: 'gray', params: [INT('scale', 4, 1, 64), INT('octaves', 5, 1, 8), INT('seed', 0, 0, 999), NUM('warp', 0, 0, 1)], eval: ({ S, p, seed }) => field(S, (u, v) => { [u, v] = warpUV(u, v, p, seed); return ridged(u, v, per(p), p.octaves, seed + p.seed); }) },
  turbulence: { cat: 'Noise', label: 'Turbulence', out: 'gray', params: [INT('scale', 4, 1, 64), INT('octaves', 5, 1, 8), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => turbulence(u, v, per(p), p.octaves, seed + p.seed)) },
  worley: { cat: 'Noise', label: 'Worley / Voronoi', out: 'gray', params: [INT('scale', 8, 1, 64), P('mode', 'select', 'f1', { options: ['f1', 'f2', 'edge', 'id'] }), NUM('jitter', 0.9, 0, 1), INT('seed', 0, 0, 999), NUM('warp', 0, 0, 1)], eval: ({ S, p, seed }) => field(S, (u, v) => { [u, v] = warpUV(u, v, p, seed); const c = cells(u, v, per(p), seed + p.seed, p.jitter); return p.mode === 'id' ? c.id : p.mode === 'f2' ? clamp(c.f2) : p.mode === 'edge' ? clamp(c.edge * 2) : clamp(c.f1); }) },
  cracks: { cat: 'Patterns', label: 'Cracks / fracture', out: 'gray', params: [INT('scale', 6, 1, 32), NUM('width', 0.06, 0.005, 0.3), NUM('warp', 0.25, 0, 1), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => { [u, v] = warpUV(u, v, p, seed); const c = cells(u, v, per(p), seed + p.seed, 1); return 1 - smooth(0, p.width, c.edge); }) },
  scratches: { cat: 'Patterns', label: 'Scratches', out: 'gray', params: [INT('count', 30, 1, 200), NUM('length', 0.25, 0.02, 1), NUM('width', 0.0025, 0.0005, 0.02, 0.0005), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => clamp(scratches(u, v, { count: p.count, length: p.length, width: p.width, seed: seed + p.seed }))) },
  erosion: { cat: 'Patterns', label: 'Erosion (ridged + gullies)', out: 'gray', params: [INT('scale', 3, 1, 32), NUM('gully', 0.6, 0, 1), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => { const base = fbm(u, v, per(p), 6, seed + p.seed), r = ridged(u + base * 0.1, v, per(p) * 2, 4, seed + p.seed + 3); return clamp(base * 0.7 + r * 0.3 - (1 - r) ** 3 * p.gully * 0.4); }) },
  gradient: { cat: 'Patterns', label: 'Gradient', out: 'gray', params: [P('mode', 'select', 'linear', { options: ['linear', 'radial', 'diamond', 'angular'] }), NUM('angle', 90, 0, 360, 1), INT('repeat', 1, 1, 16)], eval: ({ S, p }) => field(S, (u, v) => { const r = p.repeat, a = p.angle * Math.PI / 180; if (p.mode === 'radial') return clamp(1 - Math.hypot(fract(u * r) - 0.5, fract(v * r) - 0.5) * 2); if (p.mode === 'diamond') return clamp(1 - (Math.abs(fract(u * r) - 0.5) + Math.abs(fract(v * r) - 0.5)) * 2); if (p.mode === 'angular') return (Math.atan2(fract(v * r) - 0.5, fract(u * r) - 0.5) / (2 * Math.PI) + 1) % 1; const t = fract((u * Math.cos(a) + v * Math.sin(a)) * r); return 1 - Math.abs(t * 2 - 1); }) },
  shape: { cat: 'Patterns', label: 'Shape / distance field', out: 'gray', params: [P('shape', 'select', 'circle', { options: ['circle', 'square', 'star', 'ring', 'cross'] }), INT('tiles', 1, 1, 32), NUM('size', 0.35, 0.02, 0.5), NUM('softness', 0.05, 0, 0.5), P('sdf', 'bool', false)], eval: ({ S, p }) => field(S, (u, v) => { const x = fract(u * p.tiles) - 0.5, y = fract(v * p.tiles) - 0.5, r = Math.hypot(x, y); let d;
    if (p.shape === 'square') d = Math.max(Math.abs(x), Math.abs(y)) - p.size; else if (p.shape === 'ring') d = Math.abs(r - p.size) - p.size * 0.2; else if (p.shape === 'cross') d = Math.min(Math.max(Math.abs(x) - p.size * 0.3, Math.abs(y) - p.size), Math.max(Math.abs(y) - p.size * 0.3, Math.abs(x) - p.size)); else if (p.shape === 'star') { const a = Math.atan2(y, x); d = r - p.size * (0.6 + 0.4 * Math.cos(a * 5)); } else d = r - p.size;
    return p.sdf ? clamp(0.5 - d * 2) : 1 - smooth(-p.softness / 2, p.softness / 2 + 1e-4, d); }) },
  bricks: { cat: 'Patterns', label: 'Bricks / tiles', out: 'gray', params: [INT('rows', 8, 1, 64), INT('cols', 4, 1, 64), NUM('offset', 0.5, 0, 1), NUM('mortar', 0.04, 0, 0.3), NUM('bevel', 0.08, 0.001, 0.5), NUM('jitter', 0, 0, 1), P('output', 'select', 'height', { options: ['height', 'mask', 'id'] }), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => { const b = bricks(u, v, { ...p, seed: seed + p.seed }); return p.output === 'id' ? b.id : p.output === 'mask' ? b.mask : b.mask * (0.5 + b.bevel * 0.5); }) },
  stones: { cat: 'Patterns', label: 'Stones / cobble', out: 'gray', params: [INT('scale', 6, 1, 32), NUM('gap', 0.08, 0, 0.4), NUM('round', 0.5, 0, 1), INT('seed', 0, 0, 999), P('output', 'select', 'height', { options: ['height', 'id'] })], eval: ({ S, p, seed }) => field(S, (u, v) => { const [wu, wv] = warp(u, v, 0.04, 6, seed + p.seed); const c = cells(wu, wv, per(p), seed + p.seed, 0.95); if (p.output === 'id') return c.id; const e = smooth(p.gap * 0.5, p.gap + 0.2 * p.round, c.edge); return e * (0.75 + c.id * 0.25) + fbm(u, v, 16, 3, seed + 9) * 0.08; }) },
  hexagons: { cat: 'Patterns', label: 'Hexagons', out: 'gray', params: [INT('scale', 6, 1, 64), NUM('bevel', 0.25, 0.01, 1), INT('seed', 0, 0, 999), P('output', 'select', 'height', { options: ['height', 'id'] })], eval: ({ S, p, seed }) => field(S, (u, v) => { const h = hexagons(u, v, per(p), seed + p.seed); return p.output === 'id' ? h.id : smooth(0, p.bevel, h.edge); }) },
  wood: { cat: 'Patterns', label: 'Wood grain / planks', out: 'gray', params: [INT('rows', 5, 1, 32), NUM('rings', 14, 1, 60, 0.5), NUM('gap', 0.012, 0, 0.1, 0.001), P('output', 'select', 'grain', { options: ['grain', 'mask', 'id', 'knot'] }), INT('seed', 0, 0, 999)], eval: ({ S, p, seed }) => field(S, (u, v) => { const w = planks(u, v, { rows: p.rows, ringScale: p.rings, gap: p.gap, seed: seed + p.seed }); return p.output === 'mask' ? w.mask : p.output === 'id' ? w.id : p.output === 'knot' ? w.knot : w.grain * w.mask; }) },
  fabric: { cat: 'Patterns', label: 'Fabric weave', out: 'gray', params: [INT('threads', 24, 2, 128)], eval: ({ S, p }) => field(S, (u, v) => weave(u, v, p.threads)) },
  stripes: { cat: 'Patterns', label: 'Stripes', out: 'gray', params: [INT('count', 8, 1, 64), NUM('angle', 0, 0, 180, 1), NUM('soft', 0.02, 0, 0.5)], eval: ({ S, p }) => field(S, (u, v) => { const a = p.angle * Math.PI / 180, n = p.count, t = fract((u * Math.round(Math.cos(a) * n) + v * Math.round(Math.sin(a) * n))); return smooth(0.5 - p.soft, 0.5 + p.soft, t) - smooth(1 - p.soft, 1, t); }) },
  dots: { cat: 'Patterns', label: 'Dots', out: 'gray', params: [INT('count', 8, 1, 64), NUM('radius', 0.3, 0.02, 0.5), INT('seed', 0, 0, 999)], eval: ({ S, p }) => field(S, (u, v) => dots(u, v, p.count, p.radius, p.seed)) },
  studs: { cat: 'Roblox', label: 'Roblox studs', out: 'gray', params: [INT('density', 4, 1, 32), NUM('size', 0.3, 0.05, 0.48), NUM('height', 0.6, 0, 1), NUM('bevel', 0.06, 0.005, 0.3), P('style', 'select', 'stud', { options: ['stud', 'inlet', 'tube'] }), NUM('stagger', 0, 0, 0.5)], eval: ({ S, p }) => field(S, (u, v) => { const n = p.density, row = Math.floor(v * n), x = fract(u * n + (row % 2) * p.stagger) - 0.5, y = fract(v * n) - 0.5, r = Math.hypot(x, y), body = 1 - smooth(p.size - p.bevel, p.size, r);
    if (p.style === 'inlet') return 0.5 - body * p.height * 0.5; if (p.style === 'tube') return 0.4 + (body - (1 - smooth(p.size * 0.55 - p.bevel, p.size * 0.55, r))) * p.height * 0.6; return 0.4 + body * p.height * 0.6 * (1 - r * 0.6); }) },
  value: { cat: 'Input', label: 'Value', out: 'gray', params: [NUM('value', 0.5, 0, 1)], eval: ({ S, p }) => gray(S * S, p.value) },
  color: { cat: 'Input', label: 'Color', out: 'color', params: [P('color', 'color', '#8a7a66')], eval: ({ S, p }) => { const c = hex2(p.color); return cfield(S, () => c); } },
  bakedMap: { cat: 'Geometry', label: 'Baked map (high → low)', out: 'auto', params: [P('map', 'select', 'normal', { options: ['normal', 'ao', 'height', 'curvature', 'position'] })], eval: ({ S, p, mesh }) => { const m = mesh?.('baked:' + p.map, S); if (m) return m; return p.map === 'normal' || p.map === 'position' ? { c: 3, d: new Float32Array(S * S * 3).map((_, k) => k % 3 === 2 ? 1 : 0.5) } : gray(S * S, p.map === 'ao' ? 1 : 0.5); } },
  meshMask: { cat: 'Geometry', label: 'Mesh mask (needs a mesh)', out: 'gray', params: [P('kind', 'select', 'curvature', { options: ['curvature', 'convex', 'concave', 'slope', 'up', 'height', 'ao'] }), NUM('contrast', 1, 0.1, 4)], eval: ({ S, p, mesh }) => { const m = mesh?.(p.kind, S); if (!m) return gray(S * S, 0.5); return map1(m, v => clamp((v - 0.5) * p.contrast + 0.5)); } },
  // Filters
  levels: { cat: 'Filter', label: 'Levels', in: ['in'], out: 'same', params: [NUM('inLow', 0, 0, 1), NUM('inHigh', 1, 0, 1), NUM('gamma', 1, 0.1, 5), NUM('outLow', 0, 0, 1), NUM('outHigh', 1, 0, 1)], eval: ({ i, p }) => map1(i.in, x => p.outLow + (p.outHigh - p.outLow) * Math.pow(clamp((x - p.inLow) / ((p.inHigh - p.inLow) || 1e-4)), 1 / p.gamma)) },
  invert: { cat: 'Filter', label: 'Invert', in: ['in'], out: 'same', params: [], eval: ({ i }) => map1(i.in, x => 1 - x) },
  threshold: { cat: 'Filter', label: 'Threshold', in: ['in'], out: 'gray', params: [NUM('level', 0.5, 0, 1), NUM('soft', 0.02, 0, 0.5)], eval: ({ i, p }) => map1(toGray(i.in), x => smooth(p.level - p.soft, p.level + p.soft + 1e-4, x)) },
  blur: { cat: 'Filter', label: 'Blur', in: ['in'], out: 'same', params: [NUM('radius', 2, 0, 64, 0.5)], eval: ({ i, p, S }) => { let b = i.in; const r = Math.round(p.radius * S / 256); for (let k = 0; k < 2; k++) b = blur(b, S, r); return b; } },
  sharpen: { cat: 'Filter', label: 'Sharpen', in: ['in'], out: 'same', params: [NUM('amount', 1, 0, 4)], eval: ({ i, p, S }) => { const b = blur(i.in, S, Math.max(1, Math.round(S / 256))); return map1(i.in, (x, k) => clamp(x + (x - b.d[k]) * p.amount)); } },
  warp: { cat: 'Filter', label: 'Warp (by input)', in: ['in', 'by'], out: 'same', params: [NUM('amount', 0.05, 0, 0.5)], eval: ({ i, p, S }) => { const by = toGray(i.by) ?? gray(S * S, 0.5), src = i.in, o = new Float32Array(src.d.length); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x, w = (by.d[k] - 0.5) * p.amount; for (let c = 0; c < src.c; c++) o[k * src.c + c] = sample(src, S, (x + 0.5) / S + w, (y + 0.5) / S + w * 0.7, c); } return { c: src.c, d: o }; } },
  transform: { cat: 'Filter', label: 'Transform (tile / rotate / offset)', in: ['in'], out: 'same', params: [INT('tile', 1, 1, 16), P('rotate', 'select', '0', { options: ['0', '90', '180', '270'] }), NUM('offsetX', 0, 0, 1), NUM('offsetY', 0, 0, 1)], eval: ({ i, p, S }) => { const src = i.in, o = new Float32Array(src.d.length), r = +p.rotate; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let u = (x + 0.5) / S * p.tile + p.offsetX, v = (y + 0.5) / S * p.tile + p.offsetY; if (r === 90) [u, v] = [v, 1 - u]; else if (r === 180) [u, v] = [1 - u, 1 - v]; else if (r === 270) [u, v] = [1 - v, u]; for (let c = 0; c < src.c; c++) o[(y * S + x) * src.c + c] = sample(src, S, u, v, c); } return { c: src.c, d: o }; } },
  pixelate: { cat: 'Stylized', label: 'Pixelate (pixel art)', in: ['in'], out: 'same', params: [INT('pixels', 32, 2, 256)], eval: ({ i, p, S }) => { const src = i.in, n = p.pixels, o = new Float32Array(src.d.length); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = (Math.floor((x + 0.5) / S * n) + 0.5) / n, v = (Math.floor((y + 0.5) / S * n) + 0.5) / n; const sx = Math.min(S - 1, Math.floor(u * S)), sy = Math.min(S - 1, Math.floor(v * S)); for (let c = 0; c < src.c; c++) o[(y * S + x) * src.c + c] = src.d[(sy * S + sx) * src.c + c]; } return { c: src.c, d: o }; } },
  posterize: { cat: 'Stylized', label: 'Posterize / toon steps', in: ['in'], out: 'same', params: [INT('steps', 4, 2, 32)], eval: ({ i, p }) => map1(i.in, x => Math.round(x * (p.steps - 1)) / (p.steps - 1)) },
  edgeDetect: { cat: 'Filter', label: 'Edge detect / outline', in: ['in'], out: 'gray', params: [NUM('width', 1, 0.5, 8, 0.5), NUM('strength', 4, 0.5, 20)], eval: ({ i, p, S }) => { const g = toGray(i.in), r = Math.max(1, Math.round(p.width * S / 256)), at = (x, y) => g.d[(((y + S) % S) * S + ((x + S) % S))]; return field(S, (u, v) => { const x = Math.floor(u * S), y = Math.floor(v * S); return clamp((Math.abs(at(x + r, y) - at(x - r, y)) + Math.abs(at(x, y + r) - at(x, y - r))) * p.strength); }); } },
  curvature: { cat: 'Geometry', label: 'Curvature (from height)', in: ['height'], out: 'gray', params: [NUM('radius', 2, 0.5, 16, 0.5)], eval: ({ i, p, S }) => curvatureOf(toGray(i.height), S, p.radius) },
  ambientOcclusion: { cat: 'Geometry', label: 'Ambient occlusion (from height)', in: ['height'], out: 'gray', params: [NUM('strength', 1, 0, 4)], eval: ({ i, p, S }) => aoOf(toGray(i.height), S, p.strength) },
  slope: { cat: 'Geometry', label: 'Slope mask (from height)', in: ['height'], out: 'gray', params: [NUM('strength', 8, 0.5, 40), NUM('low', 0.2, 0, 1), NUM('high', 0.7, 0, 1)], eval: ({ i, p, S }) => { const n = heightToNormal(toGray(i.height), S, p.strength); const o = new Float32Array(S * S); for (let k = 0; k < S * S; k++) o[k] = smooth(p.low, p.high, 1 - (n.d[k * 3 + 2] * 2 - 1)); return { c: 1, d: o }; } },
  heightMask: { cat: 'Geometry', label: 'Height range mask', in: ['height'], out: 'gray', params: [NUM('low', 0.6, 0, 1), NUM('high', 0.8, 0, 1)], eval: ({ i, p }) => map1(toGray(i.height), x => smooth(p.low, p.high, x)) },
  normalFromHeight: { cat: 'Normal', label: 'Height → normal', in: ['height'], out: 'color', params: [NUM('strength', 4, 0, 40, 0.5), P('format', 'select', 'opengl', { options: ['opengl', 'directx'] })], eval: ({ i, p, S }) => heightToNormal(toGray(i.height), S, p.strength, p.format) },
  normalBlend: { cat: 'Normal', label: 'Normal blend (whiteout)', in: ['base', 'detail'], out: 'color', params: [NUM('detail', 1, 0, 2)], eval: ({ i, p, S }) => { const a = toColor(i.base), b = toColor(i.detail), o = new Float32Array(S * S * 3); for (let k = 0; k < S * S; k++) { const ax = a.d[k * 3] * 2 - 1, ay = a.d[k * 3 + 1] * 2 - 1, az = a.d[k * 3 + 2] * 2 - 1, bx = (b.d[k * 3] * 2 - 1) * p.detail, by = (b.d[k * 3 + 1] * 2 - 1) * p.detail, bz = b.d[k * 3 + 2] * 2 - 1; const x = ax + bx, y = ay + by, z = az * bz, l = Math.hypot(x, y, z) || 1; o[k * 3] = x / l * 0.5 + 0.5; o[k * 3 + 1] = y / l * 0.5 + 0.5; o[k * 3 + 2] = z / l * 0.5 + 0.5; } return { c: 3, d: o }; } },
  // Color
  colorRamp: { cat: 'Color', label: 'Color ramp / gradient map', in: ['in'], out: 'color', params: [P('stops', 'ramp', [[0, '#2b2420'], [0.5, '#6b5a48'], [1, '#c9b79c']])], eval: ({ i, p, S }) => { const g = toGray(i.in), stops = p.stops.map(([t, c]) => [t, hex2(c)]), o = new Float32Array(S * S * 3); for (let k = 0; k < S * S; k++) { const c = ramp(stops, g.d[k]); o[k * 3] = c[0]; o[k * 3 + 1] = c[1]; o[k * 3 + 2] = c[2]; } return { c: 3, d: o }; } },
  hsv: { cat: 'Color', label: 'Hue / saturation / value', in: ['in'], out: 'color', params: [NUM('hue', 0, -0.5, 0.5), NUM('saturation', 1, 0, 3), NUM('value', 1, 0, 3)], eval: ({ i, p, S }) => { const c = toColor(i.in), o = new Float32Array(S * S * 3); for (let k = 0; k < S * S; k++) { const [h, s, v] = rgb2hsv([c.d[k * 3], c.d[k * 3 + 1], c.d[k * 3 + 2]]), r = hsv2rgb((h + p.hue + 1) % 1, clamp(s * p.saturation), clamp(v * p.value)); o.set(r, k * 3); } return { c: 3, d: o }; } },
  paletteLock: { cat: 'Stylized', label: 'Palette lock', in: ['in'], out: 'color', params: [P('palette', 'text', '#2e2a26,#5c4d3c,#8f7a5a,#c8b48a,#e9dcc0'), P('dither', 'bool', false)], eval: ({ i, p, S }) => { const pal = String(p.palette).split(',').map(s => s.trim()).filter(s => /^#[0-9a-f]{6}$/i.test(s)).map(rgb), c = toColor(i.in), o = new Float32Array(S * S * 3); for (let k = 0; k < S * S; k++) { const x = k % S, y = (k / S) | 0, d = p.dither ? ((((x & 1) ^ (y & 1)) * 2 + (y & 1)) / 4 - 0.375) * 0.12 : 0; let best = pal[0], bd = 9; for (const q of pal) { const e = (q[0] - c.d[k * 3] - d) ** 2 + (q[1] - c.d[k * 3 + 1] - d) ** 2 + (q[2] - c.d[k * 3 + 2] - d) ** 2; if (e < bd) { bd = e; best = q; } } o.set(best, k * 3); } return { c: 3, d: o }; } },
  // Blend / math
  blend: { cat: 'Blend', label: 'Blend (with mask)', in: ['a', 'b', 'mask'], out: 'auto', params: [P('mode', 'select', 'mix', { options: ['mix', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'max', 'min', 'height'] }), NUM('opacity', 1, 0, 1), NUM('heightContrast', 0.1, 0.01, 1)], eval: ({ i, p, S }) => { const col = i.a?.c === 3 || i.b?.c === 3, A = col ? toColor(i.a ?? gray(S * S)) : (i.a ?? gray(S * S)), B = col ? toColor(i.b ?? gray(S * S)) : (i.b ?? gray(S * S)), M = toGray(i.mask), c = A.c, o = new Float32Array(A.d.length);
    for (let k = 0; k < S * S; k++) { let m = (M ? M.d[k] : 1) * p.opacity; if (p.mode === 'height') { const ha = toGray(A) === A ? A.d[k] : 0, hb = col ? 0 : B.d[k]; m = smooth(-p.heightContrast, p.heightContrast, (M ? M.d[k] : 0.5) - 0.5 + hb - ha) * p.opacity; } for (let ch = 0; ch < c; ch++) { const a = A.d[k * c + ch], b = B.d[k * c + ch]; const r = { mix: b, add: a + b, subtract: a - b, multiply: a * b, screen: 1 - (1 - a) * (1 - b), overlay: a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b), max: Math.max(a, b), min: Math.min(a, b), height: b }[p.mode]; o[k * c + ch] = clamp(a + (r - a) * m); } }
    return { c, d: o }; } },
  math: { cat: 'Blend', label: 'Math', in: ['a', 'b'], out: 'same', params: [P('op', 'select', 'multiply', { options: ['add', 'subtract', 'multiply', 'divide', 'power', 'min', 'max', 'abs', 'remap', 'smoothstep'] }), NUM('b', 1, -4, 4), NUM('b2', 1, -4, 4)], eval: ({ i, p, S }) => { const A = i.a ?? gray(S * S), B = i.b ? (A.c === 3 ? toColor(i.b) : toGray(i.b)) : null; return map1(A, (x, k) => { const b = B ? B.d[k] : p.b; switch (p.op) { case 'add': return x + b; case 'subtract': return x - b; case 'divide': return x / (b || 1e-4); case 'power': return Math.pow(Math.max(0, x), b); case 'min': return Math.min(x, b); case 'max': return Math.max(x, b); case 'abs': return Math.abs(x - 0.5) * 2; case 'remap': return clamp((x - p.b) / ((p.b2 - p.b) || 1e-4)); case 'smoothstep': return smooth(p.b, p.b2, x); default: return x * b; } }); } },
  // Weathering (masks from height + noise; blend them with colors / roughness)
  weathering: { cat: 'Weathering', label: 'Weathering mask', in: ['height'], out: 'gray', params: [P('kind', 'select', 'edgeWear', { options: ['edgeWear', 'dirt', 'dust', 'rust', 'moss', 'snow', 'ice', 'sand'] }), NUM('amount', 0.5, 0, 1), NUM('breakup', 0.5, 0, 1), INT('seed', 0, 0, 999)], eval: ({ i, p, S, seed }) => { const h = toGray(i.height) ?? gray(S * S, 0.5), cv = curvatureOf(h, S, 2), ao = aoOf(h, S, 1), n = heightToNormal(h, S, 8), nz = field(S, (u, v) => fbm(u, v, 8, 5, seed + p.seed + 11));
    const o = new Float32Array(S * S); for (let k = 0; k < S * S; k++) { const curv = cv.d[k], cav = 1 - ao.d[k], up = n.d[k * 3 + 1] * 2 - 1, flat = n.d[k * 3 + 2] * 2 - 1, br = nz.d[k], A = p.amount, mix = x => clamp(x * (1 - p.breakup) + x * br * 2 * p.breakup);
      o[k] = clamp({ edgeWear: mix(smooth(0.55 - A * 0.2, 0.75 - A * 0.2, curv)), dirt: mix(smooth(0.05, 0.4 - A * 0.3, cav)), dust: mix(flat * smooth(0.3, 1, h.d[k]) * A * 1.4), rust: mix(smooth(0.6 - A * 0.5, 0.9 - A * 0.5, cav * 0.6 + br * 0.6)), moss: mix(smooth(0.5, 1, (cav * 0.7 + (1 - h.d[k]) * 0.5 + up * 0.2) * (0.5 + A))), snow: mix(smooth(0.2, 0.6, (up * 0.4 + 0.5 + h.d[k] * 0.4 - 0.5) * (0.6 + A * 0.8) + flat * 0.3 - 0.3)), ice: mix(smooth(0.4, 0.9, (1 - h.d[k]) * (0.5 + A))), sand: mix(smooth(0.3, 0.8, (1 - h.d[k]) * (0.6 + A * 0.6) + flat * 0.2)) }[p.kind]); }
    return { c: 1, d: o }; } },
  // GPU
  glsl: { cat: 'Custom', label: 'Custom GLSL (GPU)', in: ['a', 'b'], out: 'color', params: [P('code', 'code', 'vec4 node(vec2 uv, vec4 a, vec4 b) {\n  float n = sin(uv.x * 40.0) * 0.5 + 0.5;\n  return vec4(vec3(n) * a.rgb, 1.0);\n}')], eval: ({ i, p, S, gpu }) => { if (!gpu) throw new Error('Custom GLSL nodes need the GPU (they run in the Texture Studio page, not in the CLI)'); return gpu(p.code, toColor(i.a) ?? gray(S * S, 1), toColor(i.b) ?? gray(S * S, 1), S); } },
  subgraph: { cat: 'Custom', label: 'Material function (subgraph)', out: 'auto', params: [P('graph', 'text', ''), P('output', 'select', 'baseColor', { options: MAPS })], eval: async ({ p, S, seed, loadGraph, ctx }) => { if (!p.graph || !loadGraph) return gray(S * S, 0.5); const g = await loadGraph(p.graph); if ((ctx.depth ?? 0) > 6) throw new Error('Subgraph nesting too deep'); const r = await evaluate(g, { ...ctx, size: S, seed, depth: (ctx.depth ?? 0) + 1, only: [p.output] }); return r.maps[p.output]; } },
};
export const CATEGORIES = [...new Set(Object.values(NODES).map(n => n.cat))];
export const defaults = type => Object.fromEntries((NODES[type]?.params ?? []).map(x => [x.key, structuredClone(x.default)]));

/** Graph sanity (missing nodes, cycles, unknown types, unconnected outputs). Returns issues []. */
export function checkGraph(g) {
  const issues = [], ids = new Set(g.nodes.map(n => n.id));
  for (const n of g.nodes) { if (!NODES[n.type]) issues.push({ level: 'error', message: `Unknown node type ${n.type} (${n.id})` }); for (const [k, src] of Object.entries(n.inputs ?? {})) if (src && !ids.has(src)) issues.push({ level: 'error', message: `${n.id}.${k} connects to missing node ${src}` }); }
  const seen = new Map(), cyc = id => { if (seen.get(id) === 1) return true; if (seen.get(id) === 2) return false; seen.set(id, 1); const n = g.nodes.find(x => x.id === id); for (const s of Object.values(n?.inputs ?? {})) if (s && cyc(s)) return true; seen.set(id, 2); return false; };
  for (const n of g.nodes) if (cyc(n.id)) { issues.push({ level: 'error', message: `Cycle through ${n.id}` }); break; }
  if (!g.outputs?.baseColor) issues.push({ level: 'warn', message: 'No baseColor output connected' });
  for (const [k, v] of Object.entries(g.outputs ?? {})) if (v && !ids.has(v)) issues.push({ level: 'error', message: `Output ${k} points to missing node ${v}` });
  return issues;
}
/** Removes nodes that no output depends on (graph optimisation). */
export function pruneGraph(g) {
  const keep = new Set(), walk = id => { if (!id || keep.has(id)) return; keep.add(id); const n = g.nodes.find(x => x.id === id); for (const s of Object.values(n?.inputs ?? {})) walk(s); };
  for (const id of Object.values(g.outputs ?? {})) walk(id);
  const removed = g.nodes.filter(n => !keep.has(n.id)).map(n => n.id); return { graph: { ...g, nodes: g.nodes.filter(n => keep.has(n.id)) }, removed };
}

/** Evaluate → {maps:{name:{c,d}}, size, ms, derived:[…]}. ctx: {size, seed, gpu, mesh, loadGraph, only, onProgress}. */
export async function evaluate(g, ctx = {}) {
  const S = ctx.size ?? 256, seed = ctx.seed ?? g.seed ?? 1, t0 = Date.now(), cache = new Map(), byId = new Map(g.nodes.map(n => [n.id, n]));
  const run = async id => {
    if (cache.has(id)) return cache.get(id); const n = byId.get(id); if (!n) return null; const def = NODES[n.type]; if (!def) throw new Error(`Unknown node ${n.type}`);
    const inputs = {}; for (const k of def.in ?? []) inputs[k] = n.inputs?.[k] ? await run(n.inputs[k]) : null;
    if ((def.in ?? []).length && def.in[0] !== 'a' && def.in[0] !== 'base' && !inputs[def.in[0]]) inputs[def.in[0]] = gray(S * S, 0.5);
    const p = { ...defaults(n.type), ...n.params }; const out = await def.eval({ i: inputs, p, S, seed, gpu: ctx.gpu, mesh: ctx.mesh, loadGraph: ctx.loadGraph, ctx });
    cache.set(id, out); ctx.onProgress?.(cache.size / g.nodes.length); return out;
  };
  const maps = {}, derived = [], want = ctx.only ?? MAPS;
  for (const m of MAPS) if (g.outputs?.[m] && (want.includes(m) || ['height'].includes(m))) { const b = await run(g.outputs[m]); maps[m] = COLOR_MAPS.has(m) ? toColor(b) : toGray(b); }
  if (!maps.baseColor && want.includes('baseColor')) { maps.baseColor = toColor(gray(S * S, 0.5)); derived.push('baseColor (flat grey)'); }
  const h = maps.height;
  if (want.includes('normal') && !maps.normal) { maps.normal = h ? heightToNormal(h, S, g.normalStrength ?? 4, 'opengl') : toColor(gray(S * S, 0.5)).d && { c: 3, d: new Float32Array(S * S * 3).map((_, k) => k % 3 === 2 ? 1 : 0.5) }; derived.push('normal ← height'); }
  if (want.includes('ao') && !maps.ao) { maps.ao = h ? aoOf(h, S) : gray(S * S, 1); derived.push('ao ← height'); }
  if (want.includes('curvature') && !maps.curvature) { maps.curvature = h ? curvatureOf(h, S) : gray(S * S, 0.5); derived.push('curvature ← height'); }
  if (want.includes('thickness') && !maps.thickness) { maps.thickness = h ? map1(blur(h, S, Math.max(2, Math.round(S / 32))), x => clamp(1 - x * 0.8)) : gray(S * S, 0.5); derived.push('thickness ≈ inverted blurred height'); }
  if (want.includes('roughness') && !maps.roughness) { maps.roughness = gray(S * S, g.roughness ?? 0.6); derived.push(`roughness = ${g.roughness ?? 0.6}`); }
  if (want.includes('metalness') && !maps.metalness) { maps.metalness = gray(S * S, g.metalness ?? 0); derived.push(`metalness = ${g.metalness ?? 0}`); }
  if (want.includes('height') && !maps.height) { maps.height = gray(S * S, 0.5); derived.push('height = flat'); }
  if (ctx.capture) { for (const n of g.nodes) await run(n.id).catch(() => null); return { maps, size: S, ms: Date.now() - t0, derived, nodes: Object.fromEntries(cache) }; }
  return { maps, size: S, ms: Date.now() - t0, derived };
}

// ---------- encoding + validation ----------
const lin2srgb = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
/** Map buffer → RGBA8 (row 0 = top). opts: {flipGreen, alpha:{c,d}} */
export function toRGBA(b, S, { flipGreen = false, alpha = null } = {}) {
  const o = new Uint8ClampedArray(S * S * 4);
  for (let k = 0; k < S * S; k++) { if (b.c === 3) { o[k * 4] = b.d[k * 3] * 255; o[k * 4 + 1] = (flipGreen ? 1 - b.d[k * 3 + 1] : b.d[k * 3 + 1]) * 255; o[k * 4 + 2] = b.d[k * 3 + 2] * 255; } else o[k * 4] = o[k * 4 + 1] = o[k * 4 + 2] = b.d[k] * 255; o[k * 4 + 3] = alpha ? alpha.d[k] * 255 : 255; }
  return o;
}
/** Packs grey maps into channels: pack({r,g,b,a}) each {c:1,d} or a constant 0–1. */
export function pack(S, ch) { const o = new Uint8ClampedArray(S * S * 4), get = (x, k) => typeof x === 'number' ? x : x.d[k]; for (let k = 0; k < S * S; k++) { o[k * 4] = get(ch.r ?? 0, k) * 255; o[k * 4 + 1] = get(ch.g ?? 0, k) * 255; o[k * 4 + 2] = get(ch.b ?? 0, k) * 255; o[k * 4 + 3] = get(ch.a ?? 1, k) * 255; } return o; }
/** Seamless check: compares the wrap seam with the image's own neighbour differences. score 1 = perfect tiling. */
export function seamScore(b, S) {
  const c = b.c, px = (x, y, ch) => b.d[(y * S + x) * c + ch]; let seam = 0, inner = 0;
  for (let y = 0; y < S; y++) for (let ch = 0; ch < c; ch++) { seam += Math.abs(px(S - 1, y, ch) - px(0, y, ch)); inner += Math.abs(px(S >> 1, y, ch) - px((S >> 1) - 1, y, ch)); }
  for (let x = 0; x < S; x++) for (let ch = 0; ch < c; ch++) { seam += Math.abs(px(x, S - 1, ch) - px(x, 0, ch)); inner += Math.abs(px(x, S >> 1, ch) - px(x, (S >> 1) - 1, ch)); }
  return { score: clamp(1 - Math.max(0, seam - inner * 1.15) / (inner + 1e-3)), seam: seam / (4 * S * c), inner: inner / (4 * S * c) };
}
/** PBR sanity checks (energy-conserving albedo, binary metalness, roughness range, normal validity, seams). */
export function validatePBR(maps, S, { seamless = true } = {}) {
  const issues = [], N = S * S, bc = maps.baseColor, me = maps.metalness, ro = maps.roughness, step = Math.max(1, Math.floor(N / 20000));
  let dark = 0, bright = 0, mid = 0, metalDark = 0, smoothCount = 0, n = 0, nonMetal = 0, metal = 0;
  for (let k = 0; k < N; k += step) { n++; const m = me ? me.d[k] : 0, l = lin2srgb ? (bc.d[k * 3] * 0.2126 + bc.d[k * 3 + 1] * 0.7152 + bc.d[k * 3 + 2] * 0.0722) : 0;
    if (m < 0.5) { nonMetal++; if (l < 30 / 255) dark++; if (l > 243 / 255) bright++; } else { metal++; if (l < 0.45) metalDark++; } if (m > 0.15 && m < 0.85) mid++; if (ro && ro.d[k] < 0.04) smoothCount++; }
  if (nonMetal && dark / nonMetal > 0.05) issues.push({ level: 'warn', message: `${Math.round(dark / nonMetal * 100)}% of non-metal albedo is darker than sRGB 30 (charcoal ≈ 50); light energy is lost` });
  if (nonMetal && bright / nonMetal > 0.05) issues.push({ level: 'warn', message: `${Math.round(bright / nonMetal * 100)}% of albedo is brighter than sRGB 243 (fresh snow ≈ 240)` });
  if (metal && metalDark / metal > 0.2) issues.push({ level: 'warn', message: 'Metal areas have dark base color; raw metals reflect 50–100% (base color ≥ ~180 sRGB)' });
  if (mid / n > 0.15) issues.push({ level: 'warn', message: `${Math.round(mid / n * 100)}% of metalness is between 0.15 and 0.85; real surfaces are metal or not (use it only for transitions/dirt)` });
  if (smoothCount / n > 0.5) issues.push({ level: 'info', message: 'Roughness below 0.04 on most of the surface reads as a mirror in every engine' });
  if (maps.normal) { let bad = 0; for (let k = 0; k < N; k += step) if (maps.normal.d[k * 3 + 2] < 0.5) bad++; if (bad) issues.push({ level: 'error', message: `${bad} normal texels point into the surface (blue < 0.5)` }); }
  if (seamless) for (const m of ['baseColor', 'height', 'roughness']) if (maps[m]) { const s = seamScore(maps[m], S); if (s.score < 0.8) issues.push({ level: 'warn', message: `${m} does not tile cleanly (seam score ${(s.score * 100).toFixed(0)}%). Use periodic generators or the Transform node with whole tiles` }); }
  if (!issues.length) issues.push({ level: 'ok', message: 'PBR checks passed: albedo range, metalness, roughness, normals and tiling' });
  return issues;
}
