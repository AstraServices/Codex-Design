// VFX texture generator: the AI's own particle art when the library has nothing that fits (style, license, quality,
// flipbook compatibility). Everything is drawn procedurally on a canvas, deterministic per seed, white or baked color,
// straight alpha, power-of-two sizes and Roblox flipbook grids (2×2 / 4×4 / 8×8 in a 1024 atlas).
// generate({kind, seed, size, grid, color, softness, …}) → HTMLCanvasElement. KINDS lists every kind with its knobs.

const TAU = Math.PI * 2;
const rng = seed => { let s = (seed >>> 0) || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
function vnoise(x, y, s) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
const fbm = (x, y, s, o = 5) => { let t = 0, a = 0.5, n = 0; for (let i = 0; i < o; i++) { t += vnoise(x * 2 ** i, y * 2 ** i, s + i * 17) * a; n += a; a *= 0.5; } return t / n; };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x, smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = c => { const f = String(c ?? '#ffffff').replace('#', ''); return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) || 0); };

/** Pixel shader helper: fn(u,v) → [r,g,b,a] 0–1 (u,v in −1…1, centred). */
/** Pixel shader helper (no DOM): fn(u,v) → [r,g,b,a] 0–1 (u,v in −1…1, centred) → {width,height,data RGBA8}. */
function shade(size, fn) {
  const d = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const p = fn((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1), i = (y * size + x) * 4; d[i] = clamp(p[0]) * 255; d[i + 1] = clamp(p[1]) * 255; d[i + 2] = clamp(p[2]) * 255; d[i + 3] = clamp(p[3]) * 255; }
  return { width: size, height: size, data: d };
}
/** Bilinear blit of img into a cell of dst (straight alpha, edge-clamped). */
function blit(dst, W, img, ox, oy, cell) {
  const S = img.width, k = S / cell, at = (x, y, c) => img.data[((Math.min(S - 1, Math.max(0, y)) * S) + Math.min(S - 1, Math.max(0, x))) * 4 + c];
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) { const sx = (x + 0.5) * k - 0.5, sy = (y + 0.5) * k - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, o = ((oy + y) * W + ox + x) * 4;
    for (let c = 0; c < 4; c++) dst[o + c] = (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy; }
}
const tint = (rgb, a, k = 1) => [rgb[0] / 255 * k, rgb[1] / 255 * k, rgb[2] / 255 * k, a];

// t = 0…1 animation phase (flipbooks); single textures use t = 0.5.
const DRAW = {
  glow: (o, t) => (u, v) => { const r = Math.hypot(u, v); return tint(o.rgb, Math.pow(clamp(1 - r), 1.5 + o.softness * 3) * (o.core ? 1 : 0.95)); },
  ring: (o, t) => { const R = 0.25 + t * 0.6 * (o.expand ? 1 : 0) + (o.expand ? 0 : 0.45), w = 0.04 + o.softness * 0.12; return (u, v) => { const r = Math.hypot(u, v); return tint(o.rgb, Math.exp(-1 * ((r - R) / w) ** 2) * (o.expand ? 1 - t * 0.9 : 1)); }; },
  spark: (o, t) => (u, v) => { const a = Math.exp(-1 * (u * u) / (0.004 + o.softness * 0.02)) * clamp(1 - Math.abs(v)) ** 1.2; return tint(o.rgb, a + Math.exp(-1 * (u * u + v * v) / 0.01) * 0.6); },
  star: (o, t) => { const n = o.points ?? 4; return (u, v) => { const r = Math.hypot(u, v), a = Math.atan2(v, u), arm = Math.pow(Math.abs(Math.cos(a * n / 2)), 40 / (1 + o.softness * 6)); return tint(o.rgb, clamp(arm * clamp(1 - r) ** 2 * 1.4 + Math.exp(-r * r / 0.015))); }; },
  flare: (o, t) => (u, v) => { const r = Math.hypot(u, v); return tint(o.rgb, clamp(Math.exp(-r * r / 0.02) + Math.exp(-u * u / 0.0008) * clamp(1 - Math.abs(v)) * 0.8 + Math.exp(-v * v / 0.0008) * clamp(1 - Math.abs(u)) * 0.8 + clamp(1 - r) ** 4 * 0.3)); },
  smoke: (o, t) => { const s = o.seed; return (u, v) => { const r = Math.hypot(u, v), n = fbm(u * 2.2 + 9 + t * 1.5, v * 2.2 + 3, s, 5), edge = smooth(0.95 - t * 0.2, 0.3, r + (n - 0.5) * 0.7); return tint(o.rgb, clamp(edge * (0.35 + n * 0.9) * (1 - t * 0.85)), 0.85 + n * 0.3); }; },
  dust: (o, t) => { const R = rng(o.seed), pts = Array.from({ length: 40 }, () => [R() * 2 - 1, R() * 2 - 1, 0.01 + R() * 0.04]); return (u, v) => { let a = 0; for (const [x, y, s] of pts) a += Math.exp(-1 * ((u - x) ** 2 + (v - y) ** 2) / (s * s)); return tint(o.rgb, clamp(a) * smooth(1, 0.6, Math.hypot(u, v))); }; },
  slash: (o, t) => (u, v) => { const r = Math.hypot(u, v), k = (Math.atan2(v, u) / Math.PI + 1) / 2, taper = Math.sin(Math.PI * k) ** 1.5, w = 0.02 + 0.12 * taper * (0.5 + o.softness); return tint(o.rgb, clamp(Math.exp(-1 * ((r - 0.68) / w) ** 2) * taper * 1.5 + Math.exp(-1 * ((r - 0.68) / (w * 3)) ** 2) * taper * 0.25)); },
  electric: (o, t) => { const R = rng(o.seed + Math.floor(t * 16) * 31), pts = [[-1, (R() - 0.5) * 0.3]]; for (let i = 1; i <= 10; i++) pts.push([-1 + i / 5, (R() - 0.5) * 0.7]);
    return (u, v) => { let d = 9; for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, k = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy)); d = Math.min(d, Math.hypot(u - ax - dx * k, v - ay - dy * k)); } return tint(o.rgb, clamp(Math.exp(-d * d / 0.0006) + Math.exp(-d * d / 0.012) * 0.45)); }; },
  shockwave: (o, t) => { const R = 0.1 + t * 0.85, w = 0.03 + t * 0.1; return (u, v) => { const r = Math.hypot(u, v), n = fbm(Math.atan2(v, u) * 3 + 20, r * 4, o.seed, 3); return tint(o.rgb, clamp(Math.exp(-1 * ((r - R) / w) ** 2) * (1 - t) ** 1.2 * (0.7 + n * 0.6) * 1.3)); }; },
  explosion: (o, t) => { const s = o.seed, grow = 0.25 + Math.sqrt(t) * 0.7; return (u, v) => { const r = Math.hypot(u, v) / grow, n = fbm(u * 3 + t * 2, v * 3 - t * 1.5, s, 5), body = smooth(1, 0.55, r + (n - 0.5) * 0.8), heat = clamp((1 - r) * 1.6 - t * 1.1 + n * 0.4);
    const col = o.baked ? [1, clamp(0.35 + heat * 0.9), clamp(heat * heat * 0.9)] : [1, 1, 1].map(x => x * (0.55 + heat * 0.6)); const smokeT = smooth(0.35, 1, t); const c = col.map((x, i) => x * (1 - smokeT) + [0.28, 0.25, 0.24][i] * smokeT * (o.baked ? 1 : 2.5)); return [...(o.baked ? c : c.map((x, i) => x * o.rgb[i] / 255)), clamp(body * (1 - smooth(0.6, 1, t)) * 1.15)]; }; },
  fire: (o, t) => { const s = o.seed; return (u, v) => { const y = (v + 1) / 2, n = fbm(u * 2.5, v * 2 + t * 4, s, 5), shape = smooth(0.9, 0.2, Math.abs(u) / (0.15 + y * 0.6) + (n - 0.5) * 0.9) * smooth(0, 0.25, y) * smooth(1.05, 0.7, 1 - y), heat = clamp(shape * (0.4 + y * 0.9));
    return o.baked ? [1, clamp(0.25 + heat * 0.8), clamp(heat * heat * 0.6), clamp(shape * 1.2)] : tint(o.rgb, clamp(shape * 1.2), 0.6 + heat * 0.5); }; },
  magicCircle: (o, t) => { const n = o.points ?? 6; return (u, v) => { const r = Math.hypot(u, v), a = Math.atan2(v, u) + t * TAU / n, ring = (R, w) => Math.exp(-1 * ((r - R) / w) ** 2); const runes = ring(0.7, 0.07) * (0.5 + 0.5 * Math.sign(Math.sin(a * n * 4)) * 0.6), star = Math.exp(-1 * ((Math.abs(Math.cos(a * n / 2)) * r - 0.25) / 0.02) ** 2) * (r < 0.62 ? 1 : 0);
    return tint(o.rgb, clamp(ring(0.9, 0.02) + ring(0.62, 0.015) + runes * 0.5 + star * 0.7)); }; },
  orb: (o, t) => (u, v) => { const r = Math.hypot(u, v), n = fbm(u * 3 + t * 3, v * 3, o.seed, 4); return tint(o.rgb, clamp(smooth(0.75, 0.45, r) * (0.55 + n * 0.6) + Math.exp(-r * r / 0.05) * 0.5)); },
  trail: (o, t) => (u, v) => { const x = (u + 1) / 2; return tint(o.rgb, clamp(Math.exp(-1 * (v * v) / (0.05 + o.softness * 0.2)) * x ** 0.8 * (0.75 + fbm(x * 6, v * 2, o.seed, 3) * 0.5))); },
  beamNoise: (o, t) => (u, v) => { const x = (u + 1) / 2; return tint(o.rgb, clamp(Math.exp(-1 * (v * v) / 0.08) * (0.4 + fbm(x * 8 + t, v * 3, o.seed, 4) * 0.9))); },
};
export const KINDS = {
  glow: { label: 'Soft glow', flipbook: false }, ring: { label: 'Ring / halo', flipbook: true, expand: true }, spark: { label: 'Spark streak', flipbook: false },
  star: { label: 'Star twinkle', flipbook: false }, flare: { label: 'Lens flare', flipbook: false }, smoke: { label: 'Smoke puff', flipbook: true }, dust: { label: 'Dust specks', flipbook: false },
  slash: { label: 'Slash arc', flipbook: false }, electric: { label: 'Lightning', flipbook: true }, shockwave: { label: 'Shockwave', flipbook: true }, explosion: { label: 'Explosion', flipbook: true, baked: true },
  fire: { label: 'Fire', flipbook: true, baked: true }, magicCircle: { label: 'Magic circle', flipbook: true }, orb: { label: 'Energy orb', flipbook: true }, trail: { label: 'Trail strip', flipbook: false }, beamNoise: { label: 'Beam noise', flipbook: true },
};

/** spec: {kind, seed=1, size=256 (single) | grid=4|8 (flipbook atlas 1024), color='#ffffff', softness=0.5, baked, points, expand} */
/** spec → {width,height,data RGBA8}. Works in Node, workers and the page (no canvas needed). */
export function generateImage(spec) {
  const kind = KINDS[spec.kind] ? spec.kind : 'glow', o = { seed: 1, softness: 0.5, ...KINDS[kind], ...spec, rgb: hex(spec.color ?? '#ffffff') };
  const grid = o.grid && KINDS[kind].flipbook ? o.grid : 0;
  if (!grid) return shade(o.size ?? 256, DRAW[kind](o, 0.5));
  const W = 1024, data = new Uint8ClampedArray(W * W * 4), cell = W / grid, frames = grid * grid, res = Math.min(cell, 256); // draw small, scale up: keeps 8×8 fast
  for (let f = 0; f < frames; f++) blit(data, W, shade(res, DRAW[kind](o, f / (frames - 1))), (f % grid) * cell, Math.floor(f / grid) * cell, cell);
  return { width: W, height: W, data };
}
/** Browser convenience: same art as a canvas. */
export function generate(spec) { const img = generateImage(spec), c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); return c; }
export const canvasToBase64 = c => c.toDataURL('image/png').split(',')[1];
export const specName = s => `${s.kind}-${(s.color ?? '#ffffff').replace('#', '')}-${s.grid ? s.grid + 'x' + s.grid : (s.size ?? 256)}-s${s.seed ?? 1}`;
