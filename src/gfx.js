import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { withPresentation, meshStats, bestAngle, RENDER_MODES } from './gfx-modes.js';
import { optimizeLOD, LOD_LEVELS } from './lod.js';
import { writeEXR } from './exr.js';
import { pathTrace } from './pathtrace.js';
export { RENDER_MODES };

// GFX: presentation images of the current model. Model rendered with the workshop lights on transparent background,
// then composed in 2D: background (gradients, rays, bokeh, clouds, grids, halftone, podium, spotlight), shadows,
// optional sticker outline, layout text, optional rarity frame, multi-view sheets, and a fully configurable watermark.
// Layouts are Codex Design's own (Train/GfxTrain was studied for mood only: soft studio light, floating prop, quiet type).

const FONT = '"Inter","Segoe UI","Helvetica Neue",Arial,sans-serif';
export const RARITY = { common: ['#9aa3b5', '#5b6270'], uncommon: ['#7cff6a', '#1f7a2a'], rare: ['#5fc4ff', '#1543a8'], epic: ['#d07bff', '#5a1aa8'], legendary: ['#ffd34d', '#c26a00'], mythic: ['#ff5f8f', '#a8002f'], secret: ['#ffffff', '#ff4fd8'] };
const LIGHT = { bg: { type: 'radial', colors: ['#f6f9fb', '#c3d0da'] }, vignette: 0.22, ink: '#16202b', quiet: 'rgba(30,45,60,0.55)' };
const DARK = { bg: { type: 'radial', colors: ['#2a2f3a', '#0d0f14'] }, vignette: 0.5, ink: '#f3f5f8', quiet: 'rgba(230,235,245,0.55)', dark: true };
/** Presets: canvas size, camera, background recipe, decor and layout. Every field can be overridden per call. */
export const GFX_PRESETS = {
  card: { label: 'Studio card (light)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.6, offsetY: -0.04, ...LIGHT, floatShadow: 0.34, float: 0.06, layout: 'card' },
  'card-dark': { label: 'Studio card (dark)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.6, offsetY: -0.04, ...DARK, floatShadow: 0.6, float: 0.06, glow: { color: '#6f7cff', alpha: 0.18 }, layout: 'card' },
  'card-color': { label: 'Accent card (duotone)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.6, offsetY: -0.04, bg: { type: 'accent' }, vignette: 0.32, ink: '#ffffff', quiet: 'rgba(255,255,255,0.75)', accentInk: '#ffffff', dark: true, floatShadow: 0.35, float: 0.06, dots: 0.08, layout: 'card' },
  social: { label: 'Social portrait 4:5', width: 1080, height: 1350, angle: 'three-quarter', fill: 0.6, offsetY: -0.02, ...LIGHT, floatShadow: 0.3, float: 0.05, layout: 'social' },
  cover: { label: 'Pack cover 16:9', width: 1920, height: 1080, angle: 'iso', fill: 0.78, offsetX: 0.17, offsetY: 0.02, ...LIGHT, floatShadow: 0.3, float: 0.03, layout: 'cover' },
  banner: { label: 'Store banner 4:1', width: 1920, height: 480, angle: 'three-quarter', fill: 0.92, offsetX: 0.24, ...LIGHT, bg: { type: 'linear', colors: ['#eef3f7', '#c7d3dd'] }, floatShadow: 0.25, float: 0.02, layout: 'banner' },
  icon: { label: 'Roblox icon (sky burst)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.74, bg: { type: 'radial', colors: ['#c8f6ff', '#3fb2ff', '#0d4fc2'] }, rays: { count: 20, alpha: 0.22, twist: 0.06 }, bokeh: 18, glow: { color: '#ffffff', alpha: 0.55 }, groundGlow: 0.35, vignette: 0.42, dropShadow: 0.35, layout: 'none' },
  'icon-rarity': { label: 'Rarity icon (framed)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.62, offsetY: -0.02, bg: { type: 'rarity' }, rays: { count: 16, alpha: 0.18 }, bokeh: 14, glow: { color: '#ffffff', alpha: 0.4 }, vignette: 0.4, dropShadow: 0.35, frame: true, rarity: 'legendary', layout: 'rarity' },
  'icon-minimal': { label: 'Minimal icon (pastel disc)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.7, bg: { type: 'solid', colors: ['#f4efe8'] }, disc: { color: 'accent', alpha: 0.9, radius: 0.36 }, dropShadow: 0.18, layout: 'none' },
  thumbnail: { label: 'Roblox thumbnail (sky)', width: 1920, height: 1080, angle: 'three-quarter', fill: 0.62, offsetY: -0.1, bg: { type: 'radial', colors: ['#d4f8ff', '#4cc0ff', '#1260d8'] }, rays: { count: 26, alpha: 0.18, twist: 0.04 }, clouds: 0.85, bokeh: 22, glow: { color: '#ffffff', alpha: 0.5 }, groundGlow: 0.3, vignette: 0.38, dropShadow: 0.32, layout: 'thumbnail' },
  'thumbnail-sunset': { label: 'Roblox thumbnail (sunset)', width: 1920, height: 1080, angle: 'three-quarter', fill: 0.62, offsetY: -0.1, bg: { type: 'radial', colors: ['#fff1b8', '#ff8a4c', '#8a1f5c'] }, rays: { count: 24, alpha: 0.16, color: '#fff2c8' }, bokeh: 18, glow: { color: '#ffe7a8', alpha: 0.5 }, groundGlow: 0.3, vignette: 0.45, dropShadow: 0.35, layout: 'thumbnail', titleInk: '#5a1030', titleFill: '#ffe9c9' },
  'thumbnail-night': { label: 'Roblox thumbnail (neon night)', width: 1920, height: 1080, angle: 'three-quarter', fill: 0.62, offsetY: -0.1, bg: { type: 'radial', colors: ['#6a4cff', '#2a145e', '#0a0620'] }, rays: { count: 18, alpha: 0.1, color: '#b8a8ff' }, bokeh: 30, grid: 'perspective', glow: { color: '#a98cff', alpha: 0.55 }, vignette: 0.55, dropShadow: 0.4, layout: 'thumbnail', titleInk: '#1a0b45', titleFill: '#e6dcff', dark: true },
  showcase: { label: 'Simulator showcase (dark grid)', width: 1920, height: 1080, angle: 'three-quarter', fill: 0.7, offsetX: 0.17, offsetY: 0.02, bg: { type: 'radial', colors: ['#4a3a9a', '#1a1440', '#0b0920'] }, glow: { color: '#a28cff', alpha: 0.45 }, grid: 'perspective', bokeh: 16, vignette: 0.5, floatShadow: 0.55, float: 0.04, layout: 'cover', ink: '#f3efff', quiet: 'rgba(230,225,255,0.6)', dark: true },
  podium: { label: 'Podium + spotlight', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.52, offsetY: -0.08, bg: { type: 'radial', colors: ['#3a4152', '#11141b'] }, spotlight: 0.3, podium: true, vignette: 0.5, layout: 'card', ink: '#f3f5f8', quiet: 'rgba(230,235,245,0.55)', dark: true },
  blueprint: { label: 'Blueprint (engineering)', width: 1600, height: 1200, angle: 'three-quarter', fill: 0.58, offsetY: -0.04, bg: { type: 'solid', colors: ['#123a6b'] }, grid: 'blueprint', vignette: 0.25, dropShadow: 0.25, dimensions: true, layout: 'blueprint', ink: '#e8f2ff', quiet: 'rgba(220,235,255,0.7)', dark: true },
  halftone: { label: 'Pop halftone', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.62, offsetY: -0.08, bg: { type: 'accent' }, halftone: 0.2, rays: { count: 14, alpha: 0.14 }, outline: '#ffffff', outlineWidth: 12, hardShadow: 0.35, layout: 'thumbnail', titleInk: '#111111', titleFill: '#ffffff', vignette: 0.15 },
  turnaround: { label: 'Turnaround sheet (4 views)', width: 1600, height: 1600, views: [['three-quarter', '3/4'], ['front', 'FRONT'], ['side', 'SIDE'], ['back', 'BACK']], ...LIGHT, layout: 'sheet' },
  sticker: { label: 'Sticker (transparent + outline)', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.8, transparent: true, outline: '#ffffff', outlineWidth: 16, dropShadow: 0.25, layout: 'none' },
  // ---- GFX Studio 2.0: model-specific presets ----
  'hero-render': { label: 'Hero render (dramatic, rim glow)', width: 1920, height: 1080, angle: 'auto', fill: 0.78, offsetY: -0.02, ...DARK, bg: { type: 'radial', colors: ['#2c3440', '#10141a', '#05070a'] }, glow: { color: '#7fb4ff', alpha: 0.22 }, floatShadow: 0.55, vignette: 0.6, layout: 'card' },
  'studio-premium': { label: 'Studio premium (soft gradient)', width: 2048, height: 2048, angle: 'auto', fill: 0.62, offsetY: -0.04, ...LIGHT, bg: { type: 'radial', colors: ['#ffffff', '#e6ebf0', '#b9c4cf'] }, floatShadow: 0.32, float: 0.05, vignette: 0.18, layout: 'card' },
  clay: { label: 'Clay render', width: 1600, height: 1600, angle: 'auto', fill: 0.66, ...LIGHT, bg: { type: 'radial', colors: ['#f1efea', '#cfcac1'] }, renderMode: 'clay', floatShadow: 0.35, layout: 'card' },
  'wireframe-pro': { label: 'Wireframe pro (solid + edges)', width: 1600, height: 1600, angle: 'auto', fill: 0.66, bg: { type: 'solid', colors: ['#0f2236'] }, ink: '#e8f3ff', quiet: 'rgba(220,235,255,0.6)', dark: true, grid: 'blueprint', renderMode: 'wire-overlay', layout: 'card', stats: true },
  'topology-inspection': { label: 'Topology inspection (wire + density + stats)', width: 2400, height: 1200, views: [['auto', 'WIREFRAME', { renderMode: 'wireframe' }], ['auto', 'TRIANGLE DENSITY', { renderMode: 'density' }]], bg: { type: 'solid', colors: ['#121820'] }, ink: '#e8f3ff', quiet: 'rgba(220,235,255,0.6)', dark: true, layout: 'sheet', stats: true },
  'uv-inspection': { label: 'UV inspection (checker)', width: 1600, height: 1600, angle: 'auto', fill: 0.66, ...LIGHT, renderMode: 'uv', layout: 'card', stats: true },
  'material-breakdown': { label: 'Material breakdown (beauty, clay, normal, rough, metal, matcap)', width: 2400, height: 1600, views: [['auto', 'BEAUTY'], ['auto', 'CLAY', { renderMode: 'clay' }], ['auto', 'NORMAL', { renderMode: 'normal' }], ['auto', 'ROUGHNESS', { renderMode: 'roughness' }], ['auto', 'METALNESS', { renderMode: 'metalness' }], ['auto', 'MATCAP', { renderMode: 'matcap' }]], ...DARK, layout: 'sheet' },
  'pbr-showcase': { label: 'PBR showcase (lit + channels)', width: 2400, height: 1200, views: [['auto', 'PBR'], ['auto', 'NORMAL', { renderMode: 'normal' }], ['auto', 'ROUGHNESS', { renderMode: 'roughness' }], ['auto', 'EMISSIVE', { renderMode: 'emissive' }]], ...DARK, layout: 'sheet' },
  'exploded-view': { label: 'Exploded view', width: 1920, height: 1080, angle: 'auto', fill: 0.8, ...LIGHT, explode: 1, floatShadow: 0.25, layout: 'card' },
  assembly: { label: 'Assembly / disassembly sequence', width: 2400, height: 900, views: [['auto', 'ASSEMBLED', { explode: 0 }], ['auto', 'HALF', { explode: 0.5 }], ['auto', 'EXPLODED', { explode: 1 }]], ...LIGHT, layout: 'sheet' },
  'rig-showcase': { label: 'Rig showcase (skeleton overlay)', width: 1600, height: 1600, angle: 'auto', fill: 0.7, ...DARK, skeleton: true, renderMode: 'clay', layout: 'card', stats: true },
  'animation-showcase': { label: 'Animation contact sheet (6 poses)', width: 2400, height: 1600, views: [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => ['three-quarter', `T ${Math.round(t * 100)}%`, { time: t }]), ...LIGHT, layout: 'sheet' },
  'cinematic-turntable': { label: 'Cinematic still (letterbox; Video → turntable 360°)', width: 2560, height: 1080, angle: 'hero', fill: 0.82, ...DARK, bg: { type: 'radial', colors: ['#3a2f2a', '#140f0d', '#050404'] }, glow: { color: '#ffb36b', alpha: 0.18 }, letterbox: 0.1, vignette: 0.7, layout: 'cover', video: { turntable: 360, duration: 6 } },
  'lod-comparison': { label: 'LOD comparison (LOD0-LOD3)', width: 2400, height: 900, views: LOD_LEVELS.map(l => ['auto', l.name, { lod: l }]), bg: { type: 'solid', colors: ['#121820'] }, ink: '#e8f3ff', quiet: 'rgba(220,235,255,0.6)', dark: true, renderMode: 'wire-overlay', layout: 'sheet', stats: true },
  'technical-blueprint': { label: 'Technical blueprint (wire + dimensions)', width: 1600, height: 1200, angle: 'three-quarter', fill: 0.58, offsetY: -0.04, bg: { type: 'solid', colors: ['#0f3f73'] }, grid: 'blueprint', renderMode: 'wire-overlay', ink: '#e8f3ff', quiet: 'rgba(220,235,255,0.7)', dark: true, dimensions: true, layout: 'blueprint', stats: true },
  'raytraced-hero': { label: 'Ray-traced hero (path traced GI + reflections)', width: 1600, height: 1600, angle: 'auto', fill: 0.68, offsetY: -0.03, ...LIGHT, bg: { type: 'radial', colors: ['#ffffff', '#e3e8ee', '#b4bfca'] }, renderMode: 'pathtrace', spp: 48, vignette: 0.15, layout: 'card' },
  'raytraced-dark': { label: 'Ray-traced studio (dark, GI)', width: 1600, height: 1600, angle: 'auto', fill: 0.68, offsetY: -0.03, ...DARK, renderMode: 'pathtrace', spp: 48, glow: { color: '#7fb4ff', alpha: 0.12 }, vignette: 0.5, layout: 'card' },
  'multi-angle-grid': { label: 'Multi-angle grid (6 views)', width: 2400, height: 1600, views: [['three-quarter', '3/4'], ['front', 'FRONT'], ['side', 'SIDE'], ['back', 'BACK'], ['top', 'TOP'], ['low', 'LOW']], ...LIGHT, layout: 'sheet' },
  transparent: { label: 'Transparent PNG', width: 1024, height: 1024, angle: 'three-quarter', fill: 0.86, transparent: true, layout: 'none' },
};
export const WATERMARK_DEFAULTS = { text: '', image: null, position: 'bottom-right', opacity: 0.35, size: 0.03, color: '#ffffff', stroke: 'rgba(0,0,0,0.35)', rotation: 0, margin: 0.03, weight: 700, tile: false, spacing: 0.22, imageScale: 0.08 };
export const WATERMARK_POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const ANGLES = { 'three-quarter': [35, 22], iso: [45, 30], front: [0, 6], side: [90, 6], back: [180, 12], top: [30, 58], low: [30, -8], hero: [25, 10] };

export function cameraFor(root, width, height, angle, fov, lock) {
  const sphere = lock ? new THREE.Sphere(new THREE.Vector3(...lock.center), lock.radius) : new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  const [az, el] = (Array.isArray(angle) ? angle : ANGLES[angle] ?? ANGLES['three-quarter']).map(THREE.MathUtils.degToRad);
  const cam = new THREE.PerspectiveCamera(fov, width / height, 0.001, 1000), dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(fov) / 2) * 1.02 / Math.min(1, width / height);
  cam.position.copy(sphere.center).addScaledVector(dir, dist); cam.lookAt(sphere.center);
  cam.near = Math.max(0.001, dist - sphere.radius * 2); cam.far = dist + sphere.radius * 4; cam.updateProjectionMatrix();
  return cam;
}
function alphaBounds(canvas) {
  const { width: w, height: h } = canvas, d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 2, h: y1 - y0 + 2 };
}
const canvas2d = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
const rnd = seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function shade(hex, k) { const c = new THREE.Color(hex); c.lerp(new THREE.Color(k > 0 ? '#ffffff' : '#000000'), Math.abs(k)); return '#' + c.getHexString(); }
function hexA(hex, a) { const c = new THREE.Color(hex); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`; }
function sparkle(ctx, x, y, r, a) { ctx.save(); ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a)})`; ctx.beginPath(); for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4, rr = i % 2 ? r * 0.18 : r; ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); } ctx.closePath(); ctx.fill(); ctx.restore(); }

/** Renders the model alone (transparent) through the workshop renderer and lights. */
export function renderModel({ renderer, scene, root, lighting, hide = [] }, width, height, { angle, fov = 30, supersample = 2, lock } = {}) {
  const ss = Math.max(1, Math.min(supersample, Math.floor(4096 / Math.max(width, height)))), W = width * ss, H = height * ss;
  const cam = cameraFor(root, W, H, angle, fov, lock), size = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio(), clear = renderer.getClearAlpha(), bg = scene.background;
  const hidden = hide.filter(o => o?.visible); hidden.forEach(o => { o.visible = false; });
  try {
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearAlpha(0); scene.background = null;
    lighting?.update(cam); renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, cam);
    const out = canvas2d(W, H); out.getContext('2d').drawImage(renderer.domElement, 0, 0, W, H);
    if (ss === 1) return out;
    const small = canvas2d(width, height), ctx = small.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(out, 0, 0, width, height); return small;
  } finally {
    hidden.forEach(o => { o.visible = true; }); scene.background = bg; renderer.setClearAlpha(clear); renderer.setPixelRatio(ratio); renderer.setSize(size.x, size.y, false);
  }
}

/** HDR beauty pass: float render target, no tone mapping, linear scene-referred RGBA → OpenEXR bytes.
 *  options: {angle, fov, lock, renderMode, explode, skeleton, type:'half'|'float'} */
export function renderEXR(context, width, height, { angle = 'three-quarter', fov = 30, lock, type = 'half', ...presentation } = {}) {
  const { renderer, scene, root, lighting, hide = [] } = context, W = Math.min(8192, width), H = Math.min(8192, height);
  const cam = cameraFor(root, W, H, angle, fov, lock), rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, samples: 4 }), bg = scene.background, clear = renderer.getClearAlpha();
  const hidden = hide.filter(o => o?.visible); hidden.forEach(o => { o.visible = false; });
  try {
    return withPresentation(root, presentation, () => {
      scene.background = null; renderer.setClearAlpha(0); lighting?.update(cam); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
      const px = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
      const ch = { R: new Float32Array(W * H), G: new Float32Array(W * H), B: new Float32Array(W * H), A: new Float32Array(W * H) };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((H - 1 - y) * W + x) * 4, d = y * W + x; ch.R[d] = px[s]; ch.G[d] = px[s + 1]; ch.B[d] = px[s + 2]; ch.A[d] = px[s + 3]; }
      return writeEXR({ width: W, height: H, channels: ch, type });
    });
  } finally { renderer.setRenderTarget(null); rt.dispose(); hidden.forEach(o => { o.visible = true; }); scene.background = bg; renderer.setClearAlpha(clear); }
}

// ---------- Background + decor ----------
function background(ctx, o, W, H, s) {
  const accent = o.accent ?? '#3f8aa6', rar = RARITY[o.rarity] ?? RARITY.legendary, bg = o.bg ?? LIGHT.bg;
  const colors = Array.isArray(bg) ? bg : bg.type === 'accent' ? [shade(accent, 0.35), accent, shade(accent, -0.45)] : bg.type === 'rarity' ? [shade(rar[0], 0.5), rar[0], rar[1]] : bg.colors;
  if (o.bgImage?.image) { // background photo: cover/contain, optional blur, darken and tint
    const b = o.bgImage, img = b.image, k = (b.fit === 'contain' ? Math.min : Math.max)(W / img.width, H / img.height) * (b.zoom ?? 1), iw = img.width * k, ih = img.height * k;
    if (b.fit === 'contain' || (b.opacity ?? 1) < 1) { ctx.fillStyle = colors?.[0] ?? '#000'; ctx.fillRect(0, 0, W, H); }
    ctx.save(); ctx.globalAlpha = b.opacity ?? 1; if (b.blur) ctx.filter = `blur(${b.blur * s}px)`; ctx.drawImage(img, (W - iw) / 2 + (b.x ?? 0) * W, (H - ih) / 2 + (b.y ?? 0) * H, iw, ih); ctx.restore();
    if (b.darken) { ctx.fillStyle = `rgba(0,0,0,${b.darken})`; ctx.fillRect(0, 0, W, H); }
    if (b.tint) { ctx.save(); ctx.globalAlpha = b.tintAmount ?? 0.25; ctx.fillStyle = b.tint; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  } else if (bg.type === 'solid') { ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, W, H); }
  else {
    const g = bg.type === 'linear' ? ctx.createLinearGradient(0, 0, W, H) : ctx.createRadialGradient(W * (0.5 + (o.offsetX ?? 0)), H * 0.42, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.62);
    colors.forEach((c, i) => g.addColorStop(i / Math.max(1, colors.length - 1), c)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const cx = W * (0.5 + (o.offsetX ?? 0)), cy = H * (0.47 + (o.offsetY ?? 0));
  if (o.halftone) { ctx.save(); ctx.fillStyle = `rgba(0,0,0,${o.halftone})`; const step = 22 * s; for (let y = 0; y < H; y += step) for (let x = Math.round(y / step) % 2 ? step / 2 : 0; x < W; x += step) { const r = step * 0.42 * Math.min(1, Math.hypot(x - cx, y - cy) / (Math.min(W, H) * 0.7)); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  if (o.dots) { ctx.save(); ctx.fillStyle = `rgba(255,255,255,${o.dots})`; const step = 28 * s; for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) { ctx.beginPath(); ctx.arc(x, y, 2.2 * s, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  if (o.rays) { // soft rays that fade with distance, slight twist
    const R = o.rays, n = R.count ?? 18, len = Math.hypot(W, H); ctx.save(); ctx.translate(cx, cy); ctx.rotate(R.twist ?? 0);
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, gr = ctx.createLinearGradient(0, 0, Math.cos(a) * len * 0.7, Math.sin(a) * len * 0.7); gr.addColorStop(0, hexA(R.color ?? '#ffffff', 0)); gr.addColorStop(0.12, hexA(R.color ?? '#ffffff', R.alpha)); gr.addColorStop(1, hexA(R.color ?? '#ffffff', 0)); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, len, a - Math.PI / n * 0.45, a + Math.PI / n * 0.45); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  if (o.clouds) { ctx.save(); ctx.fillStyle = `rgba(255,255,255,${o.clouds})`; const R0 = rnd(7); for (let i = 0; i < 9; i++) { const x = R0() * W, y = H * (0.86 + R0() * 0.18), r = (80 + R0() * 120) * s * 1.4; ctx.beginPath(); for (let k = 0; k < 4; k++) { ctx.moveTo(x + (k - 1.5) * r * 0.7 + r, y); ctx.arc(x + (k - 1.5) * r * 0.7, y - Math.sin(k * 1.3) * r * 0.25, r * (0.55 + 0.2 * Math.sin(k * 2.1)), 0, Math.PI * 2); } ctx.fill(); } ctx.restore(); }
  if (o.grid === 'perspective') { ctx.save(); ctx.strokeStyle = 'rgba(170,150,255,0.16)'; ctx.lineWidth = 2 * s; const hy = H * 0.66; for (let i = -16; i <= 16; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.02, hy); ctx.lineTo(W / 2 + i * W * 0.17, H); ctx.stroke(); } for (let j = 0; j < 9; j++) { const y = hy + (H - hy) * Math.pow(j / 9, 1.8); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } ctx.restore(); }
  if (o.grid === 'blueprint') { ctx.save(); for (const [step, a] of [[20 * s, 0.07], [100 * s, 0.16]]) { ctx.strokeStyle = `rgba(200,225,255,${a})`; ctx.lineWidth = 1; for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); } for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); } } ctx.restore(); }
  if (o.spotlight) { ctx.save(); const g = ctx.createLinearGradient(cx, 0, cx, H * 0.85); g.addColorStop(0, `rgba(255,250,235,${o.spotlight})`); g.addColorStop(1, 'rgba(255,250,235,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx - W * 0.08, 0); ctx.lineTo(cx + W * 0.08, 0); ctx.lineTo(cx + W * 0.32, H * 0.85); ctx.lineTo(cx - W * 0.32, H * 0.85); ctx.closePath(); ctx.fill(); ctx.restore(); }
  if (o.disc) { ctx.save(); ctx.globalAlpha = o.disc.alpha ?? 1; ctx.fillStyle = o.disc.color === 'accent' ? shade(accent, 0.55) : o.disc.color; ctx.beginPath(); ctx.arc(cx, cy, Math.min(W, H) * (o.disc.radius ?? 0.36), 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  if (o.glow) { const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.5); gl.addColorStop(0, hexA(o.glow.color, o.glow.alpha)); gl.addColorStop(1, hexA(o.glow.color, 0)); ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H); }
  if (o.bokeh) { ctx.save(); const R0 = rnd(13); for (let i = 0; i < o.bokeh; i++) { const x = R0() * W, y = R0() * H * 0.9, r = (4 + R0() * 18) * s, a = 0.08 + R0() * 0.25, g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); if (R0() > 0.75) sparkle(ctx, x, y, r * 1.4, a * 2.5); } ctx.restore(); }
  if (o.vignette) { const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(${o.dark ? '0,0,10' : '20,40,60'},${o.vignette})`); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); }
}

/** Draw the trimmed model (shadows, podium, outline) into the frame or a box; returns the placed rect. */
function placeModel(ctx, model, o, W, H, s, box) {
  const b = o.cropRect ?? alphaBounds(model), area = box ?? { x: 0, y: 0, w: W, h: H }, maxW = area.w * o.fill * (area.w > area.h * 1.3 && !box ? 0.8 : 1), maxH = area.h * o.fill, k = Math.min(maxW / b.w, maxH / b.h);
  const mw = b.w * k, mh = b.h * k, mx = area.x + (area.w - mw) / 2 + (box ? 0 : (o.offsetX ?? 0) * W), my = area.y + (area.h - mh) / 2 + (box ? 0 : (o.offsetY ?? 0) * H) - (o.float ?? 0) * area.h * 0.5, cx = mx + mw / 2;
  if (o.podium) { const py = my + mh, pw = mw * 0.72, ph = pw * 0.16; ctx.save(); const g = ctx.createLinearGradient(cx - pw, 0, cx + pw, 0); g.addColorStop(0, '#2b303b'); g.addColorStop(0.5, '#4a5263'); g.addColorStop(1, '#22262f'); ctx.fillStyle = g; ctx.fillRect(cx - pw, py - ph * 0.15, pw * 2, ph * 1.4); ctx.beginPath(); ctx.ellipse(cx, py + ph * 1.25, pw, ph * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5b6578'; ctx.beginPath(); ctx.ellipse(cx, py - ph * 0.15, pw, ph * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  if (o.groundGlow) { const gy = my + mh * 0.98, g = ctx.createRadialGradient(cx, gy, 0, cx, gy, mw * 0.7); g.addColorStop(0, `rgba(255,255,255,${o.groundGlow})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.save(); ctx.translate(cx, gy); ctx.scale(1, 0.25); ctx.translate(-cx, -gy); ctx.fillStyle = g; ctx.fillRect(cx - mw, gy - mw, mw * 2, mw * 2); ctx.restore(); }
  if (o.floatShadow) { const sy = my + mh + (o.float ?? 0) * area.h, sw = mw * 0.42, sh = Math.max(8 * s, mw * 0.06); ctx.save(); ctx.filter = `blur(${Math.round(18 * s)}px)`; ctx.fillStyle = `rgba(${o.dark ? '0,0,0' : '30,50,70'},${o.floatShadow})`; ctx.beginPath(); ctx.ellipse(cx, sy, sw, sh, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  const tinted = color => { const t = canvas2d(model.width, model.height), tc = t.getContext('2d'); tc.drawImage(model, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = color; tc.fillRect(0, 0, t.width, t.height); return t; };
  if (o.hardShadow) { ctx.save(); ctx.globalAlpha = o.hardShadow; ctx.drawImage(tinted('#000000'), b.x, b.y, b.w, b.h, mx + 18 * s, my + 18 * s, mw, mh); ctx.restore(); }
  if (o.dropShadow) { ctx.save(); ctx.filter = `blur(${Math.round(14 * s)}px) brightness(0)`; ctx.globalAlpha = o.dropShadow; ctx.drawImage(model, b.x, b.y, b.w, b.h, mx + 10 * s, my + 18 * s, mw, mh); ctx.restore(); }
  if (o.outline) { const px = (o.outlineWidth ?? 10) * s, t = tinted(o.outline); for (let a = 0; a < 24; a++) ctx.drawImage(t, b.x, b.y, b.w, b.h, mx + Math.cos(a / 24 * Math.PI * 2) * px, my + Math.sin(a / 24 * Math.PI * 2) * px, mw, mh); }
  ctx.drawImage(model, b.x, b.y, b.w, b.h, mx, my, mw, mh);
  return { x: mx, y: my, w: mw, h: mh };
}

// ---------- Title fitting (long names never get cut) ----------
/** Fits text into maxW: o.titleScale scales the base size; o.titleFit 'auto' (shrink, then wrap to 2 lines), 'shrink',
 *  'wrap' or 'off'. Returns {size (px), lines}. Explicit line breaks (\n or a typed "\n") are kept. */
export function fitTitle(ctx, text, maxW, basePx, weight, o = {}, spacing = 0) {
  const mode = o.titleFit ?? 'auto', scale = o.titleScale ?? 1, given = String(text).split(/\\n|\n/);
  const width = (lines, px) => { ctx.font = `${weight} ${Math.round(px)}px ${FONT}`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`; const w = Math.max(...lines.map(l => ctx.measureText(l).width)); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; return w; };
  let px = basePx * scale, lines = given;
  if (mode === 'off') return { size: px, lines };
  const shrinkTo = ls => Math.min(px, px * maxW / Math.max(1, width(ls, px)));
  if (mode !== 'wrap') { const f = shrinkTo(lines); if (f >= px * 0.62 || mode === 'shrink' || lines.length > 1) return { size: Math.max(8, f), lines }; }
  // wrap: best split into two balanced lines at a space (or a separator such as · – -)
  const words = given.join(' ').split(/\s+/); if (words.length < 2) return { size: Math.max(8, shrinkTo(lines)), lines };
  let best = null; for (let i = 1; i < words.length; i++) { const ls = [words.slice(0, i).join(' '), words.slice(i).join(' ')].map(l => l.replace(/^[·•|–-]\s*|\s*[·•|–-]$/g, '')); const w = width(ls, px); if (!best || w < best.w) best = { ls, w }; }
  return { size: Math.max(8, Math.min(px, px * maxW / best.w)), lines: best.ls };
}

// ---------- Text layouts ----------
function layout(ctx, o, W, H, s, placed) {
  const text = (str, x, y, size, weight, color, align = 'left', base = 'top', spacing = 0) => { ctx.font = `${weight} ${Math.round(size * s)}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillStyle = color; if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * s}px`; ctx.fillText(str, x, y); const w = ctx.measureText(str).width; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; return w; };
  const ink = o.ink ?? '#16202b', quiet = o.quiet ?? 'rgba(30,45,60,0.55)', accent = o.accentInk ?? o.accent ?? (o.dark ? '#8b7bff' : '#2f7d9a');
  const chip = (label, x, y, right = false) => { ctx.font = `800 ${Math.round(19 * s)}px ${FONT}`; const tw = ctx.measureText(label).width + 34 * s, h = 36 * s, x0 = right ? x - tw : x; ctx.save(); ctx.lineWidth = 2 * s; ctx.strokeStyle = accent; ctx.fillStyle = o.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)'; roundRect(ctx, x0, y, tw, h, 7 * s); ctx.fill(); ctx.stroke(); ctx.restore(); text(label, x0 + 16 * s, y + 9 * s, 19, 800, accent, 'left', 'top', 1.5); return tw; };
  const pad = 56 * s, lines = t => String(t).split(/\\n|\n/);
  if (o.layout === 'card' || o.layout === 'social') {
    // Codex layout: small eyebrow (subtitle) + outlined tag on the top row; title bottom-left with an accent bar; footer under it.
    if (o.subtitle) text(o.subtitle.toUpperCase(), pad, pad + 6 * s, 19, 700, quiet, 'left', 'top', 3);
    if (o.tag) chip(o.tag.toUpperCase(), W - pad, pad - 2 * s, true);
    const size = o.layout === 'social' ? 76 : 62, by = H - pad - (o.footer ? 34 * s : 0);
    if (o.title) { const f = fitTitle(ctx, o.title, W - pad * 2 - 24 * s, size * s, 850, o, -0.5 * s), lh = f.size * 1.02;
      f.lines.forEach((l, i) => text(l, pad + 24 * s, by - (f.lines.length - 1 - i) * lh, f.size / s, 850, ink, 'left', 'alphabetic', -0.5));
      ctx.fillStyle = accent; ctx.fillRect(pad, by - f.size * 0.92 - (f.lines.length - 1) * lh, 8 * s, f.size * 0.92 + (f.lines.length - 1) * lh); }
    if (o.footer) text(o.footer, pad + (o.title ? 24 * s : 0), H - pad + 2 * s, 16, 500, quiet, 'left', 'alphabetic', 0.5);
  } else if (o.layout === 'cover' || o.layout === 'banner') {
    const left = (o.layout === 'banner' ? 80 : 110) * s, area = (o.modelArea ?? (o.layout === 'cover' ? [0.42] : [0.46]))[0] * W, fitted = o.title ? fitTitle(ctx, o.title, Math.max(120 * s, area - left - 30 * s), (o.layout === 'banner' ? 84 : 118) * s, 900, o, -1 * s) : { size: 118 * s, lines: [] }, size = fitted.size / s, mid = H / 2, L = fitted.lines;
    const top = mid - (L.length - 1) * size * s * 0.49;
    if (o.tag) chip(o.tag.toUpperCase(), left, top - size * s * 1.05);
    L.forEach((l, i) => text(l, left, top + i * size * s * 0.98, size, 900, ink, 'left', 'middle', -1));
    const below = top + (L.length - 1) * size * s * 0.98 + size * s * 0.62;
    ctx.fillStyle = accent; ctx.fillRect(left, below, 90 * s, 6 * s);
    if (o.subtitle) text(o.subtitle, left, below + 26 * s, 30, 500, quiet);
    if (o.footer) text(o.footer, left, H - 60 * s, 18, 600, quiet, 'left', 'alphabetic', 2);
  } else if (o.layout === 'thumbnail' && o.title) {
    const f = fitTitle(ctx, o.title, W * 0.9, 118 * s * 1.4, 900, o), size = Math.round(f.size), x = W / 2, y0 = H - 70 * s * 1.4, dark = o.titleInk ?? '#0d2a55';
    f.lines.forEach((line, i) => { const y = y0 - (f.lines.length - 1 - i) * size * 1.02;
      ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
      for (let d = 7; d > 0; d--) { ctx.fillStyle = dark; ctx.fillText(line, x, y + d * 2 * s * size / (118 * s * 1.4)); }
      ctx.lineWidth = 16 * s * size / (118 * s * 1.4); ctx.strokeStyle = dark; ctx.strokeText(line, x, y);
      const g = ctx.createLinearGradient(0, y - size * 0.8, 0, y); g.addColorStop(0, '#ffffff'); g.addColorStop(1, o.titleFill ?? '#dff3ff'); ctx.fillStyle = g; ctx.fillText(line, x, y); });
    if (o.tag) { ctx.save(); ctx.translate(W - 190 * s, 120 * s); ctx.rotate(0.18); ctx.font = `900 ${Math.round(54 * s)}px ${FONT}`; ctx.lineWidth = 10 * s; ctx.strokeStyle = dark; ctx.strokeText(o.tag.toUpperCase(), 0, 0); ctx.fillStyle = '#ffe14a'; ctx.fillText(o.tag.toUpperCase(), 0, 0); ctx.restore(); }
  } else if (o.layout === 'rarity') {
    const rar = RARITY[o.rarity] ?? RARITY.legendary, label = (o.tag ?? o.rarity ?? 'legendary').toUpperCase(), y = H - 96 * s;
    ctx.font = `900 ${Math.round(56 * s)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 10 * s; ctx.strokeStyle = shade(rar[1], -0.5); ctx.strokeText(label, W / 2, y); ctx.fillStyle = '#ffffff'; ctx.fillText(label, W / 2, y);
    if (o.title) { const f = fitTitle(ctx, o.title, W * 0.84, 44 * s, 900, o); ctx.font = `900 ${Math.round(f.size)}px ${FONT}`; ctx.lineWidth = 8 * s; f.lines.forEach((l, i) => { const y = 96 * s + i * f.size * 1.05; ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y); }); }
  } else if (o.layout === 'blueprint') {
    const bw = 520 * s, bh = 150 * s, bx = W - bw - 40 * s, by = H - bh - 40 * s; ctx.save(); ctx.strokeStyle = 'rgba(220,235,255,0.85)'; ctx.lineWidth = 2 * s; ctx.strokeRect(bx, by, bw, bh); ctx.beginPath(); ctx.moveTo(bx, by + bh * 0.55); ctx.lineTo(bx + bw, by + bh * 0.55); ctx.moveTo(bx + bw * 0.6, by + bh * 0.55); ctx.lineTo(bx + bw * 0.6, by + bh); ctx.stroke(); ctx.restore();
    { const f = fitTitle(ctx, (o.title ?? 'PART').toUpperCase(), bw - 36 * s, 40 * s, 800, { ...o, titleFit: o.titleFit === 'off' ? 'off' : 'shrink' }, 2 * s); text(f.lines.join(' '), bx + 18 * s, by + bh * 0.28, f.size / s, 800, ink, 'left', 'middle', 2); }
    text((o.subtitle ?? 'CODEX DESIGN').toUpperCase(), bx + 18 * s, by + bh * 0.78, 17, 600, quiet, 'left', 'middle', 2); text((o.tag ?? 'SCALE 1:1').toUpperCase(), bx + bw * 0.6 + 16 * s, by + bh * 0.78, 17, 600, quiet, 'left', 'middle', 2);
  }
  if (o.dimensions && placed) {
    ctx.save(); ctx.strokeStyle = 'rgba(220,235,255,0.8)'; ctx.fillStyle = 'rgba(220,235,255,0.9)'; ctx.lineWidth = 1.5 * s; const p = placed, off = 30 * s;
    const arrow = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); for (const [x, y, dx, dy] of [[x1, y1, x2 - x1, y2 - y1], [x2, y2, x1 - x2, y1 - y2]]) { const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * 12 * s - uy * 5 * s, y + uy * 12 * s + ux * 5 * s); ctx.lineTo(x + ux * 12 * s + uy * 5 * s, y + uy * 12 * s - ux * 5 * s); ctx.fill(); } };
    arrow(p.x, p.y + p.h + off, p.x + p.w, p.y + p.h + off); arrow(p.x - off, p.y, p.x - off, p.y + p.h);
    if (o.size3) { text(o.size3[0], p.x + p.w / 2, p.y + p.h + off + 10 * s, 18, 600, 'rgba(220,235,255,0.9)', 'center'); ctx.save(); ctx.translate(p.x - off - 12 * s, p.y + p.h / 2); ctx.rotate(-Math.PI / 2); text(o.size3[1], 0, 0, 18, 600, 'rgba(220,235,255,0.9)', 'center', 'bottom'); ctx.restore(); }
    ctx.restore();
  }
  if (o.frame) { const rar = RARITY[o.rarity] ?? RARITY.legendary, m = 26 * s, g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, shade(rar[0], 0.4)); g.addColorStop(0.5, rar[0]); g.addColorStop(1, rar[1]); ctx.save(); ctx.lineWidth = 22 * s; ctx.strokeStyle = g; roundRect(ctx, m, m, W - m * 2, H - m * 2, 60 * s); ctx.stroke(); ctx.lineWidth = 4 * s; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; roundRect(ctx, m + 14 * s, m + 14 * s, W - m * 2 - 28 * s, H - m * 2 - 28 * s, 48 * s); ctx.stroke(); ctx.restore(); }
}

// ---------- Watermark ----------
/** Draw a watermark. wm = {text, image (HTMLImageElement|canvas), position (WATERMARK_POSITIONS), opacity, size (× short side),
 *  color, stroke (or null), rotation (deg), margin (× short side), weight, tile (repeat diagonally), spacing, imageScale}. */
export function drawWatermark(ctx, W, H, wm) {
  const w = { ...WATERMARK_DEFAULTS, ...wm }; if (!w.text && !w.image) return;
  const m = Math.min(W, H), size = w.size * m, margin = w.margin * m;
  ctx.save(); ctx.font = `${w.weight} ${Math.round(size)}px ${FONT}`; const tw = w.text ? ctx.measureText(w.text).width : 0; ctx.restore();
  const ih = w.image ? w.imageScale * m : 0, iw = w.image ? ih * (w.image.width / w.image.height) : 0, gap = w.image && w.text ? size * 0.4 : 0, total = iw + gap + tw, hgt = Math.max(ih, size);
  // Stamp centered on (0,0) after translate/rotate: image left of text, both vertically centered.
  const stamp = () => {
    let x = -total / 2;
    if (w.image) { ctx.drawImage(w.image, x, -ih / 2, iw, ih); x += iw + gap; }
    if (w.text) { ctx.font = `${w.weight} ${Math.round(size)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; if (w.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.12); ctx.strokeStyle = w.stroke; ctx.strokeText(w.text, x, 0); } ctx.fillStyle = w.color; ctx.fillText(w.text, x, 0); }
  };
  ctx.save(); ctx.globalAlpha = w.opacity;
  if (w.tile) {
    const step = Math.max(total, hgt) + w.spacing * m; ctx.translate(W / 2, H / 2); ctx.rotate(THREE.MathUtils.degToRad(w.rotation || -30));
    const R = Math.hypot(W, H); for (let y = -R, row = 0; y < R; y += hgt + w.spacing * m * 0.6, row++) for (let x = -R + (row % 2 ? step / 2 : 0); x < R; x += step) { ctx.save(); ctx.translate(x, y); stamp(); ctx.restore(); }
  } else {
    const p = String(w.position).toLowerCase(), cx = p.includes('left') ? margin + total / 2 : p.includes('right') ? W - margin - total / 2 : W / 2, cy = p.includes('top') ? margin + hgt / 2 : p.includes('bottom') ? H - margin - hgt / 2 : H / 2;
    ctx.translate(cx, cy); ctx.rotate(THREE.MathUtils.degToRad(w.rotation)); stamp();
  }
  ctx.restore();
}

/** Composes a GFX image from model renders [{canvas,label}]. */
export function composeGFX(models, options = {}) {
  options = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const o = { ...GFX_PRESETS[options.preset ?? 'card'], ...options }, { width: W, height: H } = o, out = canvas2d(W, H), ctx = out.getContext('2d'), s = Math.max(Math.min(W, H) / 1024, W / 2200);
  if (!o.transparent) background(ctx, o, W, H, s);
  let placed = null;
  if (o.layout === 'sheet') {
    const n = models.length, cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n * W / H) - 0.05))), rows = Math.ceil(n / cols), pad = 40 * s, top = o.title || o.stats ? 100 * s : 0, cw = (W - pad * (cols + 1)) / cols, chh = (H - top - pad * (rows + 1)) / rows;
    models.forEach((m, i) => { const x = pad + (i % cols) * (cw + pad), y = top + pad + Math.floor(i / cols) * (chh + pad); ctx.save(); ctx.fillStyle = o.dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.45)'; roundRect(ctx, x, y, cw, chh, 18 * s); ctx.fill(); ctx.restore(); placeModel(ctx, m.canvas, { ...o, fill: 0.78, float: 0, floatShadow: 0.18, offsetX: 0, offsetY: 0 }, W, H, s, { x, y, w: cw, h: chh }); ctx.font = `800 ${Math.round(18 * s)}px ${FONT}`; ctx.fillStyle = o.quiet ?? '#555'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(m.label ?? '', x + 18 * s, y + 16 * s); });
    if (o.title) { const f = fitTitle(ctx, o.title, W - pad * 2, 52 * s, 850, { ...o, titleFit: o.titleFit === 'off' ? 'off' : 'shrink' }); ctx.font = `850 ${Math.round(f.size)}px ${FONT}`; ctx.fillStyle = o.ink ?? '#16202b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(f.lines.join(' '), pad, 66 * s); }
  } else {
    // Text-left layouts reserve the right side for the model so wide models never run into the title.
    const area = o.modelArea ?? (o.layout === 'cover' ? [0.42, 0.04, 0.56, 0.92] : o.layout === 'banner' ? [0.46, 0.04, 0.52, 0.92] : null);
    placed = area ? placeModel(ctx, models[0].canvas, { ...o, fill: o.areaFill ?? 0.92 }, W, H, s, { x: area[0] * W, y: area[1] * H, w: area[2] * W, h: area[3] * H }) : placeModel(ctx, models[0].canvas, o, W, H, s);
  }
  if (o.letterbox) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * o.letterbox); ctx.fillRect(0, H * (1 - o.letterbox), W, H * o.letterbox); }
  layout(ctx, o, W, H, s, placed);
  if (o.stats && o.statsData) drawStats(ctx, o, W, H, s);
  if (o.watermark) drawWatermark(ctx, W, H, o.watermark);
  return out;
}

/** Inspection panel: triangles, vertices, meshes, materials, textures, bones, draw calls, GPU memory. */
function drawStats(ctx, o, W, H, s) {
  const d = o.statsData, rows = [['TRIANGLES', d.triangles.toLocaleString('en-US')], ['VERTICES', d.vertices.toLocaleString('en-US')], ['MESHES', d.meshes], ['MATERIALS', d.materials], ['TEXTURES', `${d.textures}${d.maxTexture ? ` · ${d.maxTexture}px` : ''}`], ...(d.bones ? [['BONES', d.bones]] : []), ['DRAW CALLS ≈', d.drawCalls], ['GPU MEMORY ≈', `${d.gpuMB} MB`]];
  if (o.layout === 'sheet') { // sheets: one compact line in the header row, never over a panel
    ctx.save(); ctx.font = `700 ${Math.round(16 * s)}px ${FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = o.quiet ?? 'rgba(30,45,60,0.6)'; if ('letterSpacing' in ctx) ctx.letterSpacing = `${1.5 * s}px`;
    ctx.fillText(rows.map(([k, v]) => `${k.replace(' ≈', '')} ${v}`).join('   ·   '), W - 40 * s, (o.title ? 66 : 30) * s); ctx.restore(); return; }
  const fs = Math.round(15 * s), lh = fs * 1.6, w = 300 * s, h = rows.length * lh + 26 * s, x = W - w - 36 * s, y = H - h - 36 * s;
  ctx.save(); ctx.fillStyle = o.dark ? 'rgba(10,16,24,0.72)' : 'rgba(255,255,255,0.78)'; roundRect(ctx, x, y, w, h, 12 * s); ctx.fill(); ctx.strokeStyle = o.dark ? 'rgba(200,225,255,0.25)' : 'rgba(30,45,60,0.18)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
  rows.forEach(([k, v], i) => { ctx.font = `700 ${fs}px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = o.quiet ?? 'rgba(30,45,60,0.6)'; ctx.fillText(k, x + 16 * s, y + 13 * s + lh * (i + 0.5)); ctx.textAlign = 'right'; ctx.fillStyle = o.ink ?? '#16202b'; ctx.font = `800 ${fs}px ${FONT}`; ctx.fillText(String(v), x + w - 16 * s, y + 13 * s + lh * (i + 0.5)); });
  ctx.restore();
}

/** Loads a watermark image from a URL/path (browser). */
export function loadWatermarkImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Watermark image failed to load: ${src}`)); img.src = src; }); }

/** One call: render + compose. context = {renderer, scene, root, lighting, hide}. Returns the canvas. */
export async function gfx(context, options = {}) {
  options = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const o = { ...GFX_PRESETS[options.preset ?? 'card'], ...options };
  if (!context.root) throw new Error('No model loaded');
  if (o.watermark?.imageSrc && !o.watermark.image) o.watermark = { ...o.watermark, image: await loadWatermarkImage(o.watermark.imageSrc) };
  if (o.bgImage?.src && !o.bgImage.image) o.bgImage = { ...o.bgImage, image: await loadWatermarkImage(o.bgImage.src) };
  const views = o.views ?? [[o.angle, '', {}]], size = o.views ? Math.round(Math.max(o.width, o.height) / Math.ceil(Math.sqrt(views.length)) / 1.1) : null;
  // 'auto' angle: best silhouette from 36 small renders (computed once per call)
  let auto = null; const angleOf = a => a !== 'auto' ? a : auto ??= bestAngle(ang => renderModel(context, 96, 96, { angle: ang, fov: 30, supersample: 1 }));
  const plan = views.some(v => v[2]?.time !== undefined) && context.choreography ? context.choreography({}) : null;
  const models = [];
  try {
    for (const [angle, label, extra = {}] of views) {
      const opts = { renderMode: extra.renderMode ?? o.renderMode, explode: extra.explode ?? o.explode ?? 0, skeleton: extra.skeleton ?? o.skeleton }, ang = angleOf(angle), fov = o.fov ?? (ang === 'iso' ? 22 : 30), w = size ?? o.width, h = size ?? o.height;
      if (plan && extra.time !== undefined) { plan.apply(extra.time * plan.duration); context.root.updateMatrixWorld(true); }
      let target = context.root, clone = null;
      if (extra.lod) { clone = SkeletonUtils.clone(context.root); context.root.parent.add(clone); if (extra.lod.keep < 1) optimizeLOD(clone, { reduction: 1 - extra.lod.keep, maxError: extra.lod.maxError, cullDetails: extra.lod.cullDetails }); context.root.visible = false; target = clone; }
      try {
        const sphere = o.frameLock?.sphere ?? (extra.lod ? (() => { const sp = new THREE.Box3().setFromObject(clone, true).getBoundingSphere(new THREE.Sphere()); return { center: sp.center.toArray(), radius: sp.radius }; })() : undefined);
        const hide = (context.hide ?? []).filter(x => x !== target);
        const canvas = await withPresentation(target, opts, () => opts.renderMode === 'pathtrace' ? pathTrace({ ...context, root: target }, w, h, { angle: ang, fov, lock: sphere, spp: o.spp ?? 32, bounces: o.bounces ?? 3, shadow: o.rtShadow ?? 0.55, maxSize: o.rtMaxSize ?? 1280, onProgress: o.onProgress }) : renderModel({ ...context, root: target, hide }, w, h, { angle: ang, fov, lock: sphere }));
        const st = extra.lod ? meshStats(target) : null;
        models.push({ label: st ? `${label} · ${st.triangles.toLocaleString('en-US')} TRIS` : label, canvas });
      } finally { if (clone) { clone.removeFromParent(); context.root.visible = true; } }
    }
  } finally { plan?.restore(); }
  if (o.stats) o.statsData = meshStats(context.root);
  if (o.frameLock?.crop && !o.views) o.cropRect = o.frameLock.crop;
  if (o.dimensions && !o.size3) { const b = new THREE.Box3().setFromObject(context.root).getSize(new THREE.Vector3()); o.size3 = [`${b.x.toFixed(2)} m`, `${b.y.toFixed(2)} m`]; }
  return composeGFX(models, o);
}

/** Anchor for animated GFX: one camera sphere and one crop rectangle that contain the model in every sampled pose/angle,
 *  so the framing never slides between frames. samples: [{pose(), angle}] (pose may be null). */
export function measureFrameLock(context, o, samples) {
  const box = new THREE.Box3(), tmp = new THREE.Box3();
  for (const sm of samples) { sm.pose?.(); context.root.updateMatrixWorld(true); box.union(tmp.setFromObject(context.root, true)); }
  const sph = box.getBoundingSphere(new THREE.Sphere()), sphere = { center: sph.center.toArray(), radius: sph.radius * 1.02 };
  let crop = null;
  for (const sm of samples) {
    sm.pose?.(); const c = renderModel(context, o.width, o.height, { angle: sm.angle, fov: o.fov ?? (sm.angle === 'iso' ? 22 : 30), lock: sphere, supersample: 1 }), b = alphaBounds(c);
    crop = crop ? { x: Math.min(crop.x, b.x), y: Math.min(crop.y, b.y), x2: Math.max(crop.x2, b.x + b.w), y2: Math.max(crop.y2, b.y + b.h) } : { x: b.x, y: b.y, x2: b.x + b.w, y2: b.y + b.h };
  }
  // Crop was measured at supersample 1; renderModel output size is o.width × o.height either way.
  return { sphere, crop: { x: crop.x, y: crop.y, w: crop.x2 - crop.x, h: crop.y2 - crop.y } };
}
