import * as THREE from 'three';
import { smoothstep, fbm, noise } from './textures.js';

// Shared surface look + gradient engine for baked atlases (k.voxels, k.block, k.paint).
// Measured on Train/StudveGradientVideo (sharp frames in frames/ and frames_hd/): faces read as bevelled plastic:
// a thin rim lighter than the face (HSL lightness +, saturation slightly down — never "neon"), a short soft falloff,
// a face center a little darker, AO in concave corners, rims ONLY on convex edges, and a model-wide light gradient
// (Train/GradientTrain: top/bottom luminance ≈ 2.5×). No outlines.
//
// Nothing here is a preset to pick: the AI sets every parameter per model (or writes its own shade function).
// LOOKS has only the measured default and 'flat'. Worked example objects live in Train/StudveGradientVideo/TRAIN.md.

/** Every look parameter, with the measured default. Units: studs for widths, 0–1 for strengths unless noted. */
export const LOOK_DEFAULTS = {
  // Rim (bright line on convex edges)
  rim: 0.7, rimWidth: 0.07, rimSoftness: 0.5, rimLighten: 0.32, rimSaturate: 1, rimHue: 0, rimColor: null,
  // rimMode 'hsl' (soft, measured) or 'gain' (rim = color·rimGain + rimLift: the bright glowing v0.6 edge look)
  rimMode: 'hsl', rimGain: 1.75, rimLift: 0.16,
  // Glow (soft falloff after the rim)
  glow: 0.12, glowWidth: 0.12, glowColor: null,
  // Vignette (face center darker; start/end are fractions of the way from edge to center)
  vignette: 0.16, vignetteStart: 0.15, vignetteEnd: 1, vignettePower: 1, vignetteColor: null,
  // Per-face gradient (lighter toward faceGradientDir: 'up' | 'down' | [x,y,z] world direction)
  faceGradient: 0.08, faceGradientDir: 'up',
  // Ambient occlusion (voxel AO or occlusion:true), tinted toward aoColor
  ao: 0.5, aoColor: null,
  // Global grade
  brightness: 1, contrast: 1, saturation: 1, gamma: 1, hueShift: 0, lift: 0, posterize: 0,
  // Plank grooves (video: wood beams/trunks): dark seam + light lip every grooveEvery studs, along 'long' | 'short' | 'u' | 'v'
  grooves: 0, grooveEvery: 1, grooveWidth: 0.05, grooveLip: 0.5, grooveDir: 'long', grooveOffset: 0,
  // Optional effects (0 = off)
  sheen: 0, sheenDir: [1, 1, 0], sheenOffset: 0.35, sheenWidth: 0.06,
  edgeNoise: 0, edgeNoiseScale: 2.3, grime: 0, grimeHeight: 0.35, speckle: 0, emissiveRim: 0,
  // Full control: shade(ctx, color, look) → color replaces the built-in shading; post(ctx, color) runs last.
  shade: null, post: null,
};
export const LOOKS = { default: {}, flat: { rim: 0, glow: 0, vignette: 0, faceGradient: 0, ao: 0 } };
export const LOOK_NAMES = Object.keys(LOOKS);
const LEGACY = ['stud-nature', 'soft-bevel', 'gradient-pack', 'toon', 'glossy', 'pastel', 'neon-edge', 'worn', 'clean'];
/** look: 'default' | 'flat' | your object (merged over the measured default). overrides: any LOOK_DEFAULTS key. */
export function resolveLook(look = 'default', overrides = {}) {
  if (typeof look === 'string' && !LOOKS[look]) throw new Error(LEGACY.includes(look) ? `Look '${look}' is no longer a preset: write the look object yourself (examples in Train/StudveGradientVideo/TRAIN.md)` : `Unknown look ${look}; use 'default', 'flat' or your own object`);
  const out = { ...LOOK_DEFAULTS, ...(typeof look === 'string' ? LOOKS[look] : look) };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined && k in LOOK_DEFAULTS) out[k] = v;
  return out;
}

// ---------- Colors ----------
/** CSS/hex/Color/[r,g,b] → sRGB 0–1 triple. */
export function rgb01(c) {
  if (Array.isArray(c)) return c.slice(0, 3).map(v => v > 1 ? v / 255 : v);
  if (typeof c === 'number' && c <= 1) return [c, c, c];
  const col = new THREE.Color(c), out = {}; col.getRGB(out, THREE.SRGBColorSpace); return [out.r, out.g, out.b];
}
const lum = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const _c = new THREE.Color();
export function hsl(c) { const h = {}; _c.setRGB(clamp01(c[0]), clamp01(c[1]), clamp01(c[2]), THREE.SRGBColorSpace).getHSL(h, THREE.SRGBColorSpace); return h; }
export function fromHsl(h, s, l) { const o = {}; _c.setHSL(((h % 1) + 1) % 1, clamp01(s), clamp01(l), THREE.SRGBColorSpace).getRGB(o, THREE.SRGBColorSpace); return [o.r, o.g, o.b]; }

// ---------- Gradients ----------
// No gradient presets: the AI designs every gradient for its model (stops, type, direction, blend mode).
// Only the model-wide light gradient has measured defaults (Train/GradientTrain: bottom 0.5 → top 1.12).
export const LIGHT_DEFAULTS = { mode: 'light', bottom: 0.5, top: 1.12 };
const easing = { linear: t => t, smooth: t => t * t * (3 - 2 * t), 'ease-in': t => t * t, 'ease-out': t => 1 - (1 - t) * (1 - t), steps: t => t };

/**
 * Compile a gradient spec into fn(ctx) → {mode, color|mult, amount}.
 * spec (designed per model, no presets): 'light' | {type:'linear'|'radial'|'spherical'|'angular'|'normal'|'noise'|'edge'|'face',
 *   stops:[[t,color]…] | colors:[…], direction:[x,y,z] | axis:'x'|'y'|'z' | from:[x,y,z], to:[x,y,z], center, radius,
 *   space:'model'|'part'|'world', mode:'replace'|'tint'|'multiply'|'overlay'|'screen'|'soft-light'|'light',
 *   amount, curve, ease, repeat:'clamp'|'repeat'|'mirror', steps, scale (noise), offset, bottom/top (light), tint, tintBottom, tintTop}
 * ctx needs {world, local, part, normal, edgeRel, faceUp} where world/local/part are THREE.Vector3 normalized helpers.
 */
export function compileGradient(input, bounds) {
  if (input === 'light') input = LIGHT_DEFAULTS;
  if (typeof input !== 'object') throw new Error("Gradient spec must be an object you design: {stops:[[0,'#..'],[1,'#..']], type, from/to | direction | center, mode} (or 'light')");
  const raw = { ...input }, g = { type: 'linear', space: 'model', ease: 'linear', curve: 1, amount: 1, repeat: 'clamp', ...raw };
  if (!g.stops && !g.colors && (g.bottom !== undefined || g.top !== undefined) && !raw.mode) g.mode = 'light';
  g.mode ??= 'replace';
  const stops = g.stops ? g.stops.map(([t, c]) => [t, rgb01(c)]) : g.colors ? g.colors.map((c, i, a) => [i / Math.max(1, a.length - 1), rgb01(c)]) : null;
  const box = (g.space === 'world' ? bounds.world : g.space === 'part' ? bounds.part : bounds.model) ?? bounds.model;
  const size = box.getSize(new THREE.Vector3()), at = a => anchor(a, box), center = g.center ? at(g.center) : box.getCenter(new THREE.Vector3());
  let dir, origin, len;
  if (g.from && g.to) { origin = at(g.from); dir = at(g.to).sub(origin); len = Math.max(1e-6, dir.length()); dir.normalize(); }
  else {
    dir = g.direction ? new THREE.Vector3(...g.direction).normalize() : new THREE.Vector3(...({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[g.axis ?? 'y']));
    // Project the box onto dir: t = 0 at the lowest corner, 1 at the highest.
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < 8; i++) { const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z), d = p.dot(dir); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    origin = dir.clone().multiplyScalar(lo); len = Math.max(1e-6, hi - lo);
  }
  // radius: multiple of the bounds diagonal in the gradient plane (0.5 = center to corner); radiusMeters for absolute.
  const planeDiag = g.axis === 'z' ? Math.hypot(size.x, size.y) : g.axis === 'x' ? Math.hypot(size.y, size.z) : Math.hypot(size.x, size.z);
  const radius = Math.max(1e-6, g.radiusMeters ?? (g.radius ?? 0.5) * (g.type === 'spherical' ? size.length() : planeDiag));
  const axisV = new THREE.Vector3(...({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[g.axis ?? 'y'])), tmp = new THREE.Vector3();
  const ease = easing[g.ease] ?? easing.linear, tb = rgb01(g.tintBottom ?? '#20194a'), tt = rgb01(g.tintTop ?? '#fff4c8');
  function param(x) {
    const p = g.space === 'world' ? x.world : g.space === 'part' ? x.part : x.model;
    switch (g.type) {
      case 'radial': { tmp.copy(p).sub(center); if (g.axis !== 'none') tmp.addScaledVector(axisV, -tmp.dot(axisV)); return tmp.length() / radius; }
      case 'spherical': return tmp.copy(p).sub(center).length() / radius;
      case 'angular': { tmp.copy(p).sub(center); const a = g.axis === 'x' ? Math.atan2(tmp.z, tmp.y) : g.axis === 'z' ? Math.atan2(tmp.y, tmp.x) : Math.atan2(tmp.x, tmp.z); return (a / (Math.PI * 2) + 0.5 + (g.offset ?? 0)) % 1; }
      case 'normal': return x.normal.dot(dir) * 0.5 + 0.5;
      case 'noise': { const s = g.scale ?? 1.5; return fbm(p.x * s * 0.37 + p.z * s * 0.21, p.y * s * 0.37 + p.x * s * 0.11, 8, 4, g.seed ?? 3); }
      case 'edge': return 1 - x.edgeRel;
      case 'face': return x.faceUp * 0.5 + 0.5;
      default: return (p.dot(dir) - origin.dot(dir)) / len;
    }
  }
  return x => {
    let t = param(x) + (g.type === 'linear' || g.type === 'radial' ? g.offset ?? 0 : 0);
    if (g.repeat === 'repeat') t = ((t % 1) + 1) % 1; else if (g.repeat === 'mirror') { t = Math.abs(t) % 2; if (t > 1) t = 2 - t; } else t = clamp01(t);
    t = Math.pow(ease(t), g.curve); if (g.steps) t = Math.min(1, Math.floor(t * g.steps) / Math.max(1, g.steps - 1));
    if (g.dither !== false) t = clamp01(t + (noise(x.world.x * 9.1 + x.world.z * 3.3, x.world.y * 9.1, 64, 7) - 0.5) * 0.012);
    if (g.mode === 'light') { const m = (g.bottom ?? 0.5) + ((g.top ?? 1.12) - (g.bottom ?? 0.5)) * t, tint = g.tint ?? 0; return { mode: 'light', mult: [0, 1, 2].map(ch => m * (1 + (mix(tb, tt, t)[ch] * 1.6 - 1) * tint)), amount: g.amount }; }
    let color = stops[0][1];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0] || i === stops.length - 1) { const [t0, c0] = stops[i - 1], [t1, c1] = stops[i]; color = mix(c0, c1, clamp01((t - t0) / ((t1 - t0) || 1))); break; }
    return { mode: g.mode, color, amount: g.amount };
  };
}
/** Anchor: [x,y,z] in meters, or words over the bounds: 'bottom-left', 'top-right-front', 'center', 'top'… */
export function anchor(a, box) {
  if (Array.isArray(a)) return new THREE.Vector3(...a);
  const c = box.getCenter(new THREE.Vector3()), w = String(a).toLowerCase().split(/[-_ ]+/);
  if (w.includes('left')) c.x = box.min.x; if (w.includes('right')) c.x = box.max.x;
  if (w.includes('bottom')) c.y = box.min.y; if (w.includes('top')) c.y = box.max.y;
  if (w.includes('back')) c.z = box.min.z; if (w.includes('front')) c.z = box.max.z;
  return c;
}
/** Apply a compiled gradient sample to color c (in place semantics, returns new array). */
export function blend(c, s) {
  if (s.mode === 'light' || s.mode === 'multiply') { const m = s.mult ?? s.color; return mix(c, [c[0] * m[0], c[1] * m[1], c[2] * m[2]], s.amount); }
  const g = s.color; let out;
  switch (s.mode) {
    case 'tint': { const h = hsl(g), l = lum(c); out = fromHsl(h.h, h.s, l * 0.9 + h.l * 0.1); break; }
    case 'overlay': out = c.map((v, i) => v < 0.5 ? 2 * v * g[i] : 1 - 2 * (1 - v) * (1 - g[i])); break;
    case 'screen': out = c.map((v, i) => 1 - (1 - v) * (1 - g[i])); break;
    case 'soft-light': out = c.map((v, i) => (1 - 2 * g[i]) * v * v + 2 * g[i] * v); break;
    default: out = g;
  }
  return mix(c, out, s.amount);
}

// ---------- Texel shading ----------
/** Rim color: HSL lightening with a little desaturation (measured: crate rim is lighter, warmer, not neon). */
export function rimColor(c, L, x) {
  if (typeof L.rimColor === 'function') return rgb01(L.rimColor(x, c));
  if (L.rimColor) return rgb01(L.rimColor);
  if (L.rimMode === 'gain') return c.map(v => Math.min(1, v * L.rimGain + L.rimLift));
  const h = hsl(c); return fromHsl(h.h + L.rimHue / 360, h.s * L.rimSaturate, h.l + (1 - h.l) * L.rimLighten);
}
const DIRS = { up: [0, 1, 0], down: [0, -1, 0] };
/**
 * Shade one texel. x = {edge (studs to the nearest CONVEX edge), inradius (studs), faceUp, ao (0..1), s, t,
 * world, worldNormal, norm ([0..1]³ position in the model bounds), modelY}. Returns {color, emissive?}.
 */
export function shadeTexel(c, x, L) {
  if (L.shade) { const r = L.shade(x, c, L); return { color: rgb01(r).map(clamp01), emissive: null }; }
  let col = c.slice();
  if (L.brightness !== 1) col = col.map(v => v * L.brightness);
  const rel = Math.min(1, x.edge / Math.max(1e-3, x.inradius));
  if (L.vignette) {
    const k = L.vignette * Math.pow(smoothstep(L.vignetteStart, L.vignetteEnd, rel), L.vignettePower);
    col = L.vignetteColor ? mix(col, rgb01(L.vignetteColor), k) : col.map(v => v * (1 - k));
  }
  if (L.faceGradient) {
    let fu = x.faceUp;
    if (Array.isArray(L.faceGradientDir) || L.faceGradientDir === 'down') { const d = DIRS[L.faceGradientDir] ?? L.faceGradientDir; fu = L.faceGradientDir === 'down' ? -x.faceUp : x.faceUpAlong ? x.faceUpAlong(d) : x.faceUp; }
    const k = 1 + L.faceGradient * fu; col = col.map(v => v * k);
  }
  if (L.grooves && x.lu !== undefined) {
    const long = x.lu >= x.lv, along = L.grooveDir === 'u' ? 'u' : L.grooveDir === 'v' ? 'v' : (L.grooveDir === 'short') !== long ? 'u' : 'v';
    // Lines run along `along`, so the coordinate across them is the other axis.
    const across = (along === 'u' ? x.sv : x.su) / L.grooveEvery + L.grooveOffset, f = across - Math.floor(across), d = Math.min(f, 1 - f) * L.grooveEvery;
    if (d < L.grooveWidth) col = col.map(v => v * (1 - L.grooves));
    else if (d < L.grooveWidth * 2.2 && f < 0.5) { const h = hsl(col); col = fromHsl(h.h, h.s, h.l + (1 - h.l) * L.grooves * L.grooveLip * 0.5); }
  }
  if (L.grime) { const k = L.grime * Math.max(1 - x.ao, clamp01((L.grimeHeight - x.modelY) / Math.max(1e-3, L.grimeHeight)) * 0.6); col = col.map(v => v * (1 - k)); }
  if (L.ao && x.ao < 1) { const k = L.ao * (1 - x.ao); col = L.aoColor ? mix(col, rgb01(L.aoColor), k) : col.map(v => v * (1 - k)); }
  if (L.speckle) { const n = noise(x.world.x * 23 + x.world.z * 7, x.world.y * 23 + x.world.x * 5, 256, 11); col = col.map(v => v * (1 + (n - 0.5) * L.speckle * 2)); }
  let e = x.edge;
  if (L.edgeNoise) e += (fbm(x.world.x * L.edgeNoiseScale + x.world.z * 1.7, x.world.y * L.edgeNoiseScale + x.world.z * 0.9, 16, 3, 5) - 0.45) * L.edgeNoise * L.rimWidth * 2.2;
  const hard = L.rimWidth * (1 - L.rimSoftness), r = L.rim * (1 - smoothstep(hard, L.rimWidth, e));
  const g = L.glow * Math.exp(-Math.max(0, e - L.rimWidth) / Math.max(1e-3, L.glowWidth)) * (e > L.rimWidth ? 1 : 0);
  let emissive = null;
  if (r > 0 || g > 0) {
    const rc = rimColor(c, L, x), gc = L.glowColor ? rgb01(L.glowColor) : rc;
    if (r > 0) col = mix(col, rc, Math.min(1, r)); if (g > 0) col = mix(col, gc, Math.min(1, g));
    if (L.emissiveRim) emissive = rc.map(v => v * Math.max(r, g) * L.emissiveRim);
  }
  if (L.sheen && x.norm) { // one highlight band across the whole object (model space), not per face
    const d = L.sheenDir, len = Math.hypot(d[0], d[1], d[2]) || 1, t = (x.norm[0] * d[0] + x.norm[1] * d[1] + x.norm[2] * d[2]) / (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) || 1);
    void len; const band = Math.exp(-((t - L.sheenOffset) ** 2) / (L.sheenWidth ** 2)); col = col.map(v => v + (1 - v) * band * L.sheen);
  }
  if (L.lift) col = col.map(v => v + (1 - v) * L.lift);
  if (L.contrast !== 1) col = col.map(v => (v - 0.5) * L.contrast + 0.5);
  if (L.saturation !== 1) { const l = lum(col); col = col.map(v => l + (v - l) * L.saturation); }
  if (L.hueShift) { const h = hsl(col); col = fromHsl(h.h + L.hueShift / 360, h.s, h.l); }
  if (L.gamma !== 1) col = col.map(v => Math.pow(clamp01(v), 1 / L.gamma));
  if (L.posterize) { const n = L.posterize, l = lum(col) || 1e-6, q = Math.round(l * n) / n; col = col.map(v => v * q / l); }
  if (L.post) col = rgb01(L.post(x, col));
  return { color: col.map(clamp01), emissive };
}
