import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { decodePNG } from './png.js';

// Textures, stud surfaces, Roblox-style material presets and the bundled icon/texture library.
// Generators write plain RGBA arrays (DataTexture), so recipes behave the same in the browser,
// in `npm run inspect` and in GLB/glTF export (GLTFExporter embeds them as PNG).
export const STUD = 0.28; // One Roblox stud in meters.
const browser = typeof document !== 'undefined';
const imageCache = new Map(), canvasCache = new Map();
let indexPromise;

// ---------- Asset paths ----------
export function assetURL(src) {
  if (src instanceof URL) return src.href;
  if (/^(data|blob|https?|file):/.test(src)) return src;
  const clean = String(src).replace(/^\/+/, '').replace(/^library\//, 'assets/library/');
  const path = clean.startsWith('assets/') ? clean : 'assets/library/' + clean;
  return browser ? new URL('/' + path.split('/').map(encodeURIComponent).join('/'), location.origin).href : new URL('../' + path, import.meta.url).href;
}
async function readBytes(url) {
  if (browser || !url.startsWith('file:')) { const r = await fetch(url); if (!r.ok) throw new Error(`Asset not found: ${url}`); return new Uint8Array(await r.arrayBuffer()); }
  const { readFile } = await import('node:fs/promises'); return new Uint8Array(await readFile(new URL(url)));
}
/** Loads an image as {image, pixels()} — image is DOM-native in browsers, RGBA data in Node. */
export function loadImage(src) {
  const url = assetURL(src);
  if (!imageCache.has(url)) imageCache.set(url, (async () => {
    if (browser) {
      // onload rather than img.decode(): decode() can stall in hidden/background tabs.
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`Image failed to load: ${url}`)); img.src = url; });
      let data;
      return { url, image: img, width: img.naturalWidth, height: img.naturalHeight, pixels() {
        if (!data) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0); data = ctx.getImageData(0, 0, c.width, c.height).data; }
        return data;
      } };
    }
    // Node decodes PNG only (sniffed by signature — some library ".png" files are WebP). Others become a grey placeholder.
    const bytes = await readBytes(url);
    if (bytes[0] !== 137 || bytes[1] !== 80) return { url, image: { data: new Uint8ClampedArray([200, 200, 200, 255]), width: 1, height: 1 }, width: 1, height: 1, placeholder: true, pixels() { return this.image.data; } };
    const { inflateSync } = await import('node:zlib');
    const png = decodePNG(bytes, b => new Uint8Array(inflateSync(b)));
    return { url, image: png, width: png.width, height: png.height, pixels: () => png.data };
  })());
  return imageCache.get(url);
}

// ---------- Texture construction ----------
const wraps = { repeat: THREE.RepeatWrapping, clamp: THREE.ClampToEdgeWrapping, mirror: THREE.MirroredRepeatWrapping };
export function configure(texture, options = {}) {
  const { repeat, offset, rotation, srgb = true, nearest = false, wrap = 'repeat', anisotropy = 8, name } = options;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = wraps[wrap] ?? THREE.RepeatWrapping;
  if (repeat !== undefined) texture.repeat.set(...(typeof repeat === 'number' ? [repeat, repeat] : repeat));
  if (offset) texture.offset.set(...offset);
  if (rotation) { texture.rotation = rotation; texture.center.set(0.5, 0.5); }
  if (nearest) { texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestMipmapNearestFilter; }
  texture.anisotropy = anisotropy; if (name) texture.name = name;
  texture.needsUpdate = true; return texture;
}
export async function texture(src, options = {}) {
  const img = await loadImage(src);
  const t = img.image.data ? new THREE.DataTexture(img.image.data, img.width, img.height) : new THREE.Texture(img.image);
  if (img.image.data) { t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; }
  t.userData.source = img.url.replace(/^.*?\/assets\//, 'assets/');
  return configure(t, { name: decodeURIComponent(img.url.split('/').pop().replace(/\.\w+$/, '')), ...options });
}
/** Creates a texture from a per-pixel function (u,v ∈ [0,1)) → [r,g,b,a?] in 0–255. Deterministic and export-safe. */
export function pixelTexture(width, height, fn, options = {}) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = fn((x + 0.5) / width, (y + 0.5) / height, x, y), o = (y * width + x) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = c[3] ?? 255;
  }
  return dataTexture(data, width, height, options);
}
export function dataTexture(data, width, height, options = {}) {
  if (browser) {
    const key = options.cacheKey;
    if (key && canvasCache.has(key)) return configure(new THREE.CanvasTexture(canvasCache.get(key)), options);
    // Canvas-backed in the browser: GLTFExporter redraws some maps (e.g. normal maps) through drawImage,
    // which rejects raw DataTexture images. Rows are stored v-up, canvases are top-down, so flip.
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(width, height), row = width * 4;
    for (let y = 0; y < height; y++) image.data.set(data.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    ctx.putImageData(image, 0, 0); if (key) canvasCache.set(key, canvas);
    const t = new THREE.CanvasTexture(canvas); t.minFilter = THREE.LinearMipmapLinearFilter;
    return configure(t, options);
  }
  const t = new THREE.DataTexture(data, width, height);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return configure(t, options);
}
/** Converts a 0–1 height field into a tangent-space normal map. */
export function normalFromHeight(height, width, h, strength = 2, options = {}) {
  const data = new Uint8Array(width * h * 4), at = (x, y) => height[((y + h) % h) * width + ((x + width) % width)];
  for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    // DataTexture rows run bottom→top (v up), so +y in the array is +v in tangent space.
    const n = new THREE.Vector3(-dx, -dy, 1).normalize(), o = (y * width + x) * 4;
    data[o] = (n.x * 0.5 + 0.5) * 255; data[o + 1] = (n.y * 0.5 + 0.5) * 255; data[o + 2] = (n.z * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  return dataTexture(data, width, h, { srgb: false, ...options });
}

/** GLSL-order smoothstep(edge0, edge1, x); edge0 > edge1 gives a falling ramp. (THREE.MathUtils uses (x, min, max).) */
export function smoothstep(e0, e1, x) { const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
// ---------- Deterministic noise ----------
function hash(x, y, seed) { let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
/** Tileable value noise: period cells across the texture. */
export function noise(u, v, period = 8, seed = 1) {
  const x = u * period, y = v * period, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = t => t * t * (3 - 2 * t), w = i => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed), c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, s(xf)), THREE.MathUtils.lerp(c, d, s(xf)), s(yf));
}
export function fbm(u, v, period = 4, octaves = 4, seed = 1) { let sum = 0, amp = 0.5, norm = 0; for (let i = 0; i < octaves; i++) { sum += noise(u, v, period << i, seed + i) * amp; norm += amp; amp *= 0.5; } return sum / norm; }
function cellular(u, v, period, seed) {
  let best = 9, second = 9, id = 0; const x = u * period, y = v * period, xi = Math.floor(x), yi = Math.floor(y);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = ((xi + i) % period + period) % period, cy = ((yi + j) % period + period) % period;
    const px = xi + i + hash(cx, cy, seed), py = yi + j + hash(cx, cy, seed + 7), d = Math.hypot(px - x, py - y);
    if (d < best) { second = best; best = d; id = hash(cx, cy, seed + 3); } else if (d < second) second = d;
  }
  return { best, second, id };
}

// ---------- Studs ----------
const studCache = new Map();
/** Height field for one tiling stud cell. style: 'studs' | 'inlet' | 'smooth'. */
function studHeight(u, v, style) {
  const r = Math.hypot(u - 0.5, v - 0.5), top = 0.29, bevel = 0.045;
  if (style === 'smooth') return 0.5;
  const disc = smoothstep(top + bevel, top, r);
  return style === 'inlet' ? 0.6 - disc * 0.55 : 0.25 + disc * 0.7 - (r < top * 0.62 ? 0.04 : 0);
}
/** Classic Roblox stud textures, one stud per UV tile: {map, normalMap, roughnessMap}. */
export function studMaps({ style = 'studs', size = 128 } = {}) {
  const key = style + size;
  if (!studCache.has(key)) {
    const heights = new Float32Array(size * size), color = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size, hgt = studHeight(u, v, style), r = Math.hypot(u - 0.5, v - 0.5);
      heights[y * size + x] = hgt;
      // Contact shadow ring and soft top-light give studs readable depth even without normals.
      const ring = style === 'studs' ? Math.exp(-((r - 0.36) ** 2) / 0.0012) * 0.13 : 0, sheen = style === 'studs' && r < 0.29 ? (v - 0.5) * 0.12 : 0;
      const edge = Math.min(u, v, 1 - u, 1 - v), seam = smoothstep(0, 0.018, edge) * 0.06 + 0.94;
      const g = THREE.MathUtils.clamp((0.97 - ring + sheen) * seam, 0, 1) * 255, o = (y * size + x) * 4;
      color[o] = color[o + 1] = color[o + 2] = g; color[o + 3] = 255;
    }
    studCache.set(key, { color, heights });
  }
  const { color, heights } = studCache.get(key);
  return { map: dataTexture(color.slice(), size, size, { name: `stud_${style}_color`, cacheKey: `stud_${style}_${size}_c` }), normalMap: normalFromHeight(heights, size, size, style === 'smooth' ? 0 : 6, { name: `stud_${style}_normal`, cacheKey: `stud_${style}_${size}_n` }) };
}
/** Stud textures shipped in the asset library. `studs` = stud cells across the image, so UV units stay "one stud". */
export const LIBRARY_STUDS = {
  // StudTrain (Train/StudTrain): the user's own square stud tiles. Default for every stud request.
  train: { src: 'studtrain/stud_train.png', overlay: 'studtrain/stud_overlay.png', studs: [4, 4], note: 'StudTrain square studs (default): beveled square stud, tints to any color' },
  'train-mixed': { src: 'studtrain/stud_train_mixed.png', overlay: 'studtrain/stud_overlay_mixed.png', studs: [4, 4], note: 'StudTrain stud + inlet checker (universal stud)' },
  kek: { src: 'kek-ui-essentials/kek_stud.png', studs: [32, 16], note: 'Kek square studs, soft grey (legacy; only when the user names Kek)' },
  square: { src: 'ui-resources/files/Textures/92-download_url-studtexture.png', studs: [4, 4], note: 'Bright rounded square studs on white' },
  'square-mixed': { src: 'ui-resources/files/Textures/91-download_url-studstandalone.png', studs: [2, 2], note: 'Stud + inlet checker' },
  'universal-hd': { src: 'ui-resources/files/Textures/1217-download_url-952d9543-c6e4-4085-a851-4cb72b6b63ab_universal_stud.webp', studs: [4, 4], note: 'WebP stud + inlet on white (browser only)' },
  'stud-3': { src: 'ui-resources/files/Textures/1218-download_url-11fa953c-b17b-42e0-bb05-99afe99fb52c_StudTexture3.webp', studs: [32, 16], note: 'WebP grey square studs, Kek look (browser only)' },
};
export const STUD_STYLES = ['studs', 'inlet', 'smooth', ...Object.keys(LIBRARY_STUDS)];
const libraryStudCache = new Map();
/** Library stud image → tinting map + normal map derived from its baked shading. */
async function libraryStudMaps(style) {
  if (!libraryStudCache.has(style)) libraryStudCache.set(style, (async () => {
    const spec = LIBRARY_STUDS[style], img = await loadImage(spec.src), px = img.pixels(), step = Math.max(1, Math.round(img.width / spec.studs[0] / 24));
    const w = Math.max(1, Math.floor(img.width / step)), h = Math.max(1, Math.floor(img.height / step)), heights = new Float32Array(w * h);
    let sum = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = ((y * step) * img.width + x * step) * 4, a = px[o + 3] / 255, l = (0.3 * px[o] + 0.59 * px[o + 1] + 0.11 * px[o + 2]) / 255 * a + (1 - a);
      // Image rows are top→bottom; normalFromHeight expects v-up rows.
      heights[(h - 1 - y) * w + x] = l; sum += l;
    }
    return { spec, img, heights, w, h, mean: Math.max(0.15, sum / heights.length) };
  })());
  return libraryStudCache.get(style);
}
/** Stud surface material. Pair with worldUV(…, STUD) or studGeometry so one UV unit = one stud.
 *  style: 'studs' | 'inlet' | 'smooth' (procedural) or a LIBRARY_STUDS key ('kek', 'square', 'square-mixed', 'universal-hd', 'stud-3'; StudTrain: 'train' (default), 'train-mixed'). */
export async function studMaterial(color = '#a3a2a5', { style = 'studs', roughness = 0.55, metalness = 0, normalScale = 1, brighten = true, ...rest } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, name: `Stud_${style}`, ...rest });
  if (['studs', 'inlet', 'smooth'].includes(style)) { const maps = studMaps({ style }); mat.map = maps.map; mat.normalMap = maps.normalMap; mat.normalScale.setScalar(normalScale); }
  else {
    if (!LIBRARY_STUDS[style]) throw new Error(`Unknown stud style ${style}; choose ${STUD_STYLES.join(', ')}`);
    const { spec, heights, w, h, mean } = await libraryStudMaps(style), repeat = [1 / spec.studs[0], 1 / spec.studs[1]];
    mat.map = await texture(spec.src, { repeat });
    if (!(await loadImage(spec.src)).placeholder) { mat.normalMap = normalFromHeight(heights, w, h, 4, { name: `stud_${style}_normal`, repeat, cacheKey: `lib_${style}_n` }); mat.normalScale.setScalar(normalScale); }
    // Library textures carry mid-grey baked shading; lift the tint so the requested color stays readable.
    if (brighten) mat.color.multiplyScalar(Math.min(2.4, 1 / THREE.MathUtils.lerp(1, Math.pow(mean, 2.2), 0.85)));
  }
  mat.userData.robloxSurface = style; return mat;
}
/** Box projection UVs in object space: uv = position / tile. Repeating textures keep constant density on any size. */
export function worldUV(geometry, tile = STUD, { offset = [0, 0, 0] } = {}) {
  const p = geometry.attributes.position, n = geometry.attributes.normal ?? (geometry.computeVertexNormals(), geometry.attributes.normal), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + offset[0], y = p.getY(i) + offset[1], z = p.getZ(i) + offset[2], ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [a, b] = ax >= ay && ax >= az ? [z * Math.sign(n.getX(i) || 1), y] : ay >= az ? [x, -z * Math.sign(n.getY(i) || 1)] : [-x * Math.sign(n.getZ(i) || 1), y];
    uv[i * 2] = a / tile; uv[i * 2 + 1] = b / tile;
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return geometry;
}

// ---------- Roblox-like material presets ----------
const presetCache = new Map();
const gray = (v, a = 255) => { const g = THREE.MathUtils.clamp(v, 0, 1) * 255; return [g, g, g, a]; };
/** Each preset: grayscale detail map (tinted by color), height for normals, PBR values. One texture tile spans `tile` studs (UV unit = 1 stud). */
const PRESETS = {
  SmoothPlastic: { roughness: 0.42, size: 4, detail: () => 1, height: () => 0.5 },
  Plastic: { roughness: 0.5, size: 64, detail: (u, v) => 0.93 + fbm(u, v, 8, 3, 2) * 0.07, height: (u, v) => fbm(u, v, 16, 2, 3) * 0.2 },
  Neon: { roughness: 0.3, emissive: 1.15, size: 4, detail: () => 1, height: () => 0.5 },
  Metal: { roughness: 0.32, metalness: 0.9, size: 128, detail: (u, v) => 0.8 + fbm(u * 0.25, v * 4, 4, 4, 5) * 0.2, height: (u, v) => fbm(u, v * 8, 16, 3, 5) * 0.3 },
  DiamondPlate: { roughness: 0.35, metalness: 0.85, size: 128, tile: 4, detail: (u, v) => 0.82 + fbm(u, v, 8, 3, 6) * 0.12, height: (u, v) => { const a = ((u + v) * 4) % 1, b = ((u - v + 1) * 4) % 1, c = (x, y) => Math.max(0, 1 - Math.hypot((x - 0.5) * 6, (y - 0.5) * 1.6)); const i = Math.floor(u * 8) % 2; return 0.2 + 0.8 * (i ? c(a, (v * 8) % 1) : c((v * 8) % 1, b)); } },
  CorrodedMetal: { roughness: 0.75, metalness: 0.55, size: 128, detail: (u, v) => 0.55 + fbm(u, v, 4, 5, 8) * 0.5, height: (u, v) => fbm(u, v, 8, 5, 9) },
  Foil: { roughness: 0.18, metalness: 1, size: 128, detail: (u, v) => 0.8 + noise(u, v, 24, 11) * 0.2, height: (u, v) => cellular(u, v, 12, 12).best },
  Glass: { roughness: 0.05, opacity: 0.4, size: 4, detail: () => 1, height: () => 0.5 },
  Wood: { roughness: 0.7, size: 256, tile: 8, detail: (u, v) => { const ring = Math.sin((u * 40 + fbm(u, v, 4, 4, 14) * 6) * Math.PI) * 0.5 + 0.5; return 0.62 + ring * 0.22 + fbm(u * 8, v, 4, 3, 15) * 0.16; }, height: (u, v) => Math.sin((u * 40 + fbm(u, v, 4, 4, 14) * 6) * Math.PI) * 0.15 + 0.5 },
  WoodPlanks: { roughness: 0.72, size: 256, tile: 8, detail: (u, v) => { const row = Math.floor(v * 4), x = (u + hash(row, 0, 20) * 0.7) % 1, grain = Math.sin((x * 30 + fbm(x, v, 4, 3, 21 + row) * 5) * Math.PI) * 0.5 + 0.5, seam = Math.min((v * 4) % 1, 1 - (v * 4) % 1, ((x * 2) % 1), 1 - ((x * 2) % 1)); return (0.6 + grain * 0.18 + hash(row, Math.floor(x * 2), 22) * 0.2) * smoothstep(0, 0.03, seam) * 0.8 + 0.2 * smoothstep(0, 0.03, seam); }, height: (u, v) => { const x = (u + hash(Math.floor(v * 4), 0, 20) * 0.7) % 1, seam = Math.min((v * 4) % 1, 1 - (v * 4) % 1, (x * 2) % 1, 1 - (x * 2) % 1); return smoothstep(0, 0.04, seam); } },
  Brick: { roughness: 0.85, size: 256, tile: 8, detail: (u, v) => { const row = Math.floor(v * 8), x = (u * 4 + (row % 2) * 0.5) % 1, y = (v * 8) % 1, mortar = Math.min(x, 1 - x, y * 2, (1 - y) * 2); return mortar < 0.05 ? 0.75 : 0.62 + hash(row, Math.floor(u * 4 + (row % 2) * 0.5), 30) * 0.18 + fbm(u, v, 16, 3, 31) * 0.2; }, height: (u, v) => { const row = Math.floor(v * 8), x = (u * 4 + (row % 2) * 0.5) % 1, y = (v * 8) % 1; return smoothstep(0, 0.07, Math.min(x, 1 - x, y * 2, (1 - y) * 2)) * 0.8 + fbm(u, v, 16, 3, 32) * 0.2; }, mortar: true },
  Cobblestone: { roughness: 0.9, size: 256, tile: 8, detail: (u, v) => { const c = cellular(u, v, 6, 40); return c.second - c.best < 0.06 ? 0.45 : 0.6 + c.id * 0.3 + fbm(u, v, 16, 3, 41) * 0.15; }, height: (u, v) => { const c = cellular(u, v, 6, 40); return smoothstep(0, 0.25, c.second - c.best); } },
  Concrete: { roughness: 0.95, size: 128, detail: (u, v) => 0.75 + fbm(u, v, 8, 5, 50) * 0.25 - (hash(Math.floor(u * 128), Math.floor(v * 128), 51) > 0.985 ? 0.25 : 0), height: (u, v) => fbm(u, v, 16, 4, 52) },
  Slate: { roughness: 0.85, size: 256, tile: 8, detail: (u, v) => { const c = cellular(u, v, 3, 60); return 0.55 + c.id * 0.25 + fbm(u, v, 8, 4, 61) * 0.2; }, height: (u, v) => { const c = cellular(u, v, 3, 60); return smoothstep(0, 0.12, c.second - c.best) * 0.6 + fbm(u, v, 16, 3, 62) * 0.4; } },
  Granite: { roughness: 0.7, size: 128, detail: (u, v) => 0.6 + noise(u, v, 64, 70) * 0.25 + (noise(u, v, 32, 71) > 0.75 ? 0.15 : 0), height: (u, v) => noise(u, v, 64, 72) },
  Marble: { roughness: 0.25, size: 256, tile: 8, detail: (u, v) => 0.82 + Math.pow(Math.abs(Math.sin((u * 3 + fbm(u, v, 4, 5, 80) * 4) * Math.PI)), 8) * -0.35 + 0.1, height: () => 0.5 },
  Pebble: { roughness: 0.8, size: 128, detail: (u, v) => { const c = cellular(u, v, 10, 90); return c.best > 0.42 ? 0.45 : 0.6 + c.id * 0.35; }, height: (u, v) => Math.max(0, 1 - cellular(u, v, 10, 90).best * 2.2) },
  Sand: { roughness: 1, size: 128, detail: (u, v) => 0.85 + hash(Math.floor(u * 128), Math.floor(v * 128), 100) * 0.1 + fbm(u, v, 4, 3, 101) * 0.05, height: (u, v) => noise(u, v, 128, 102) * 0.5 + Math.sin((u + fbm(u, v, 2, 2, 103) * 0.5) * 24 * Math.PI) * 0.15 },
  Grass: { roughness: 0.95, size: 128, detail: (u, v) => 0.68 + noise(u, v * 0.25, 64, 110) * 0.3 + fbm(u, v, 4, 3, 111) * 0.1, height: (u, v) => noise(u, v * 0.25, 64, 110) },
  Ice: { roughness: 0.12, opacity: 0.85, size: 128, detail: (u, v) => 0.85 + (cellular(u, v, 5, 120).second - cellular(u, v, 5, 120).best < 0.025 ? 0.15 : 0) + fbm(u, v, 8, 3, 121) * 0.05, height: (u, v) => fbm(u, v, 4, 3, 122) * 0.3 },
  Fabric: { roughness: 1, size: 128, detail: (u, v) => { const a = Math.sin(u * 64 * Math.PI) * Math.sin(v * 64 * Math.PI); return 0.8 + a * 0.12 + noise(u, v, 32, 130) * 0.08; }, height: (u, v) => Math.sin(u * 64 * Math.PI) * Math.sin(v * 64 * Math.PI) * 0.5 + 0.5 },
  ForceField: { roughness: 0.2, emissive: 1.4, opacity: 0.45, size: 128, detail: (u, v) => 0.65 + Math.pow(1 - Math.abs(((u * 16 + v * 8) % 1) - 0.5) * 2, 6) * 0.35, height: () => 0.5 },
};
export const ROBLOX_MATERIALS = Object.keys(PRESETS);
/** Roblox Enum.Material look-alike: robloxMaterial('Brick', {color:'#8a3b2c'}). Use worldUV/studBlock for tiling. */
export function robloxMaterial(name = 'Plastic', { color = '#a3a2a5', tile, ...rest } = {}) {
  const preset = PRESETS[name]; if (!preset) throw new Error(`Unknown Roblox material ${name}; choose ${ROBLOX_MATERIALS.join(', ')}`);
  if (!presetCache.has(name)) {
    const s = preset.size, heights = new Float32Array(s * s), map = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const u = (x + 0.5) / s, v = (y + 0.5) / s; heights[y * s + x] = preset.height(u, v); map.set(gray(preset.detail(u, v)), (y * s + x) * 4); }
    presetCache.set(name, { heights, map });
  }
  const { heights, map } = presetCache.get(name), s = preset.size, scale = 1 / (tile ?? preset.tile ?? 4);
  const mat = new THREE.MeshStandardMaterial({ name: `Roblox_${name}`, color, roughness: preset.roughness, metalness: preset.metalness ?? 0, ...rest });
  if (s > 4) { mat.map = dataTexture(map.slice(), s, s, { name: `${name}_detail`, repeat: scale, cacheKey: `preset_${name}_c` }); mat.normalMap = normalFromHeight(heights, s, s, preset.bump ?? 0.8, { name: `${name}_normal`, repeat: scale, cacheKey: `preset_${name}_n` }); }
  if (preset.emissive) { mat.emissive.set(color); mat.emissiveIntensity = preset.emissive; if (mat.map) mat.emissiveMap = mat.map; }
  if (preset.opacity) { mat.transparent = true; mat.opacity = preset.opacity; mat.depthWrite = preset.opacity > 0.6; }
  mat.userData.robloxMaterial = name; return mat;
}

// ---------- Studded parts ----------
/** Roblox Part look: box sized in meters, stud top / inlet bottom, materials shared by color. */
export async function studGeometry(size, { top = 'studs', bottom = 'inlet', studs = 'texture', studSize = STUD } = {}) {
  const [w, h, d] = size, g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z. Scale each face's 0–1 UVs to its size in studs.
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const idx = f * 4 + i; uv.setXY(idx, uv.getX(idx) * dims[f][0] / studSize, uv.getY(idx) * dims[f][1] / studSize); }
  // Material slots: 0 top surface, 1 sides/plain, 2 bottom surface.
  const faceMaterials = [1, 1, top === 'none' || studs === 'mesh' ? 1 : 0, bottom === 'none' ? 1 : 2, 1, 1];
  g.clearGroups(); faceMaterials.forEach((m, f) => g.addGroup(f * 6, 6, m));
  if (studs !== 'mesh' || top === 'none') return g;
  // Real stud cylinders merged on top (static parts), one per stud cell, using the plain material slot.
  const parts = [g], nx = Math.max(1, Math.round(w / studSize)), nz = Math.max(1, Math.round(d / studSize)), r = studSize * 0.3, sh = studSize * 0.18;
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const c = new THREE.CylinderGeometry(r, r, sh, 16, 1, false); c.translate(-w / 2 + (i + 0.5) * w / nx, h / 2 + sh / 2, -d / 2 + (j + 0.5) * d / nz);
    c.clearGroups(); parts.push(c);
  }
  const merged = mergeGeometries(parts); parts.forEach(p => p.dispose());
  merged.clearGroups(); faceMaterials.forEach((m, f) => merged.addGroup(f * 6, 6, m)); merged.addGroup(36, merged.index.count - 36, 1);
  return merged;
}
/** [top, sides, bottom] materials for a stud part; `cache` (per kit) shares them between parts of the same look. */
export async function studPartMaterials(color, { surface = 'Plastic', top = 'studs', bottom = 'inlet' } = {}, cache = new Map()) {
  const key = [color, surface, top, bottom].join('|');
  if (!cache.has(key)) cache.set(key, (async () => {
    const side = surface === 'Plastic' || surface === 'SmoothPlastic' ? new THREE.MeshStandardMaterial({ name: `Part_${surface}`, color, roughness: surface === 'Plastic' ? 0.5 : 0.42 }) : robloxMaterial(surface, { color });
    return [top === 'none' ? side : await studMaterial(color, { style: top }), side, bottom === 'none' ? side : await studMaterial(color, { style: bottom })];
  })());
  return cache.get(key);
}

// ---------- Asset library index / search ----------
export async function assetIndex() {
  indexPromise ??= (async () => {
    try { return JSON.parse(new TextDecoder().decode(await readBytes(assetURL('assets/index.json')))); }
    catch { indexPromise = undefined; throw new Error('Asset index missing. Run: npm run assets:index'); }
  })();
  return indexPromise;
}
const tokenize = s => s.toLowerCase().replace(/[_\-./()]+/g, ' ').split(/\s+/).filter(Boolean);
/** Ranked search across bundled icons/textures/effects. kind: icon | texture | effect | background | render | brush | face | other. */
export async function findAssets(query, { kind, pack, limit = 12, size } = {}) {
  const { assets } = await assetIndex(), terms = tokenize(query), wantsOutline = terms.includes('outline');
  const results = [];
  for (const a of assets) {
    if (kind && a.kind !== kind) continue; if (pack && a.pack !== pack) continue;
    const hay = a.search; let score = 0;
    for (const t of terms) { if (a.name.toLowerCase() === t) score += 6; else if (hay.includes(' ' + t + ' ')) score += 3; else if (hay.includes(t)) score += 1; else { score = -1; break; } }
    if (score < 0) continue;
    if (size ? a.size === size : a.size >= 256) score += 0.8; if (a.pack === 'gvesster-icon-pack-v6') score += 0.6; else if (a.pack === 'icon-pack') score += 0.4;
    score -= a.path.length * 0.004; // prefer the plain variant ("Coin 256px" over "Blue Coin v2 256px")
    results.push({ ...a, score });
  }
  return results.sort((x, y) => y.score - x.score || x.path.localeCompare(y.path)).slice(0, limit);
}
export async function resolveAsset(query, options = {}) {
  if (/\.(png|webp|jpe?g|svg)$/i.test(query) || query instanceof URL) return query;
  const [hit] = await findAssets(query, { limit: 1, ...options });
  if (!hit) throw new Error(`No bundled asset matches "${query}". Try npm run assets -- "${query}"`);
  return hit.path;
}

// ---------- Icons → 3D ----------
/** Marching squares over an alpha grid; returns closed loops (arrays of [x,y] in grid units, y up). */
export function traceAlpha(alpha, w, h, threshold = 0.5) {
  const W = w + 2, H = h + 2, A = (x, y) => x < 1 || y < 1 || x > w || y > h ? 0 : alpha[(y - 1) * w + (x - 1)];
  const point = (x, y, dir) => { // dir 0: horizontal edge from (x,y) to (x+1,y); 1: vertical edge (x,y)→(x,y+1)
    const a = A(x, y), b = dir ? A(x, y + 1) : A(x + 1, y), t = THREE.MathUtils.clamp((threshold - a) / ((b - a) || 1e-6), 0, 1);
    return dir ? [x, y + t] : [x + t, y];
  };
  const next = new Map(), pts = new Map(), key = (x, y, d) => (y * W + x) * 2 + d;
  const link = (e1, e2) => { next.set(e1, e2); };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const tl = A(x, y) >= threshold, tr = A(x + 1, y) >= threshold, br = A(x + 1, y + 1) >= threshold, bl = A(x, y + 1) >= threshold;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0); if (c === 0 || c === 15) continue;
    const T = key(x, y, 0), R = key(x + 1, y, 1), B = key(x, y + 1, 0), L = key(x, y, 1);
    for (const [e, d, px, py] of [[T, 0, x, y], [R, 1, x + 1, y], [B, 0, x, y + 1], [L, 1, x, y]]) if (!pts.has(e)) pts.set(e, point(px, py, d));
    const center = (A(x, y) + A(x + 1, y) + A(x + 1, y + 1) + A(x, y + 1)) / 4 >= threshold;
    // Directed segments keep filled cells on one side, so loops chain unambiguously.
    switch (c) {
      case 1: link(L, B); break; case 2: link(B, R); break; case 3: link(L, R); break; case 4: link(R, T); break;
      case 5: if (center) { link(L, T); link(R, B); } else { link(L, B); link(R, T); } break;
      case 6: link(B, T); break; case 7: link(L, T); break; case 8: link(T, L); break; case 9: link(T, B); break;
      case 10: if (center) { link(T, R); link(B, L); } else { link(T, L); link(B, R); } break;
      case 11: link(T, R); break; case 12: link(R, L); break; case 13: link(R, B); break; case 14: link(B, L); break;
    }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue; const loop = []; let e = start;
    while (e !== undefined && !seen.has(e)) { seen.add(e); const [px, py] = pts.get(e); loop.push([px - 1, h - (py - 1)]); e = next.get(e); }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
function simplify(loop, tolerance) {
  if (loop.length < 8) return loop;
  const dist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1e-9, t = THREE.MathUtils.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const rdp = pts => { let max = 0, idx = 0; for (let i = 1; i < pts.length - 1; i++) { const d = dist(pts[i], pts[0], pts.at(-1)); if (d > max) { max = d; idx = i; } } return max > tolerance ? [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))] : [pts[0], pts.at(-1)]; };
  let far = 0, fd = 0; for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > fd) { fd = d; far = i; } }
  const out = [...rdp(loop.slice(0, far + 1)).slice(0, -1), ...rdp([...loop.slice(far), loop[0]]).slice(0, -1)];
  return out.length >= 3 ? out : loop;
}
const area = loop => loop.reduce((s, p, i) => { const q = loop[(i + 1) % loop.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function inside(pt, loop) { let c = false; for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) { const [xi, yi] = loop[i], [xj, yj] = loop[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
/** Shapes (with holes) from a 0–1 field (rows top→bottom), scaled so the longer side is `size`, centered. */
export function fieldShapes(alpha, w, h, { size = 1, threshold = 0.5, tolerance = 0.35, minArea = 4 } = {}) {
  const loops = traceAlpha(alpha, w, h, threshold).map(l => simplify(l, tolerance)).filter(l => Math.abs(area(l)) >= minArea);
  const scale = size / Math.max(w, h), cx = w / 2, cy = h / 2, depthOf = l => loops.filter(o => o !== l && inside(l[0], o)).length;
  const toV = l => l.map(([x, y]) => new THREE.Vector2((x - cx) * scale, (y - cy) * scale));
  const shapes = [], info = loops.map(l => ({ l, depth: depthOf(l) }));
  for (const outer of info.filter(i => i.depth % 2 === 0)) {
    const pts = area(outer.l) < 0 ? [...outer.l].reverse() : outer.l, shape = new THREE.Shape(toV(pts));
    for (const hole of info.filter(i => i.depth === outer.depth + 1 && inside(i.l[0], outer.l))) shape.holes.push(new THREE.Path(toV(area(hole.l) > 0 ? [...hole.l].reverse() : hole.l)));
    shapes.push(shape);
  }
  return { shapes, scale };
}
/** Shapes (with holes) from an image's alpha channel, scaled to `size` meters on the longer side, centered. */
export async function iconShapes(src, { size = 1, threshold = 0.5, resolution = 128, tolerance = 0.35, minArea = 4 } = {}) {
  const img = await loadImage(await resolveAsset(src)), px = img.pixels(), step = Math.max(1, Math.ceil(Math.max(img.width, img.height) / resolution));
  const w = Math.ceil(img.width / step), h = Math.ceil(img.height / step), alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let j = 0; j < step; j++) for (let i = 0; i < step; i++) { const sx = x * step + i, sy = y * step + j; if (sx < img.width && sy < img.height) { s += px[(sy * img.width + sx) * 4 + 3]; n++; } } alpha[y * w + x] = s / n / 255; }
  // Edge color: average of opaque pixels touching transparency (icons usually have a dark outline).
  let er = 0, eg = 0, eb = 0, en = 0;
  for (let y = 1; y < img.height - 1; y += 1) for (let x = 1; x < img.width - 1; x += 1) { const o = (y * img.width + x) * 4; if (px[o + 3] < 200) continue; if (px[o + 7] < 40 || px[o - 1] < 40 || px[o + img.width * 4 + 3] < 40 || px[o - img.width * 4 + 3] < 40) { er += px[o]; eg += px[o + 1]; eb += px[o + 2]; en++; } }
  const edgeColor = en ? new THREE.Color().setRGB(er / en / 255, eg / en / 255, eb / en / 255, THREE.SRGBColorSpace) : new THREE.Color('#333333');
  const { shapes, scale } = fieldShapes(alpha, w, h, { size, threshold, tolerance, minArea });
  if (!shapes.length) throw new Error(`Icon has no opaque silhouette: ${img.url}`);
  return { shapes, edgeColor, aspect: [w * scale, h * scale], url: img.url };
}
/** Extruded 3D icon: textured front/back caps, solid side walls. Returns {geometry, materials}. */
export async function iconBadgeGeometry(src, { size = 1, depth = 0.12, bevel = 0.015, sideColor, threshold = 0.5, resolution = 128, roughness = 0.45, metalness = 0, emissive } = {}) {
  const path = await resolveAsset(src, { kind: 'icon' }), { shapes, edgeColor, aspect } = await iconShapes(path, { size, threshold, resolution });
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  // Caps use shape-space XY as UVs; remap to the icon's 0–1 image space.
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / aspect[0] + 0.5, uv.getY(i) / aspect[1] + 0.5);
  const map = await texture(path, { wrap: 'clamp' });
  const face = new THREE.MeshStandardMaterial({ name: 'Icon_Face', map, roughness, metalness, ...(emissive ? { emissive: '#ffffff', emissiveMap: map, emissiveIntensity: emissive } : {}) });
  const side = new THREE.MeshStandardMaterial({ name: 'Icon_Side', color: sideColor ?? edgeColor, roughness, metalness });
  return { geometry: g, materials: [face, side], source: path };
}
/** Flat alpha-cutout plane showing an icon/texture (double-sided). */
export async function iconPlaneMaterial(src, { alphaTest = 0.5, emissive, ...rest } = {}) {
  const path = await resolveAsset(src), map = await texture(path, { wrap: 'clamp' }), img = await loadImage(path);
  const mat = new THREE.MeshStandardMaterial({ name: 'Icon_Cutout', map, alphaTest, side: THREE.DoubleSide, roughness: 0.6, ...(emissive ? { emissive: '#ffffff', emissiveMap: map, emissiveIntensity: emissive } : {}), ...rest });
  return { material: mat, aspect: img.width / img.height, source: path };
}
/** Projected decal geometry on a static mesh; small normal offset avoids z-fighting in engines without polygon offset. */
export function decalGeometry(target, position, orientation, size, offset = 0.002) {
  target.updateMatrixWorld(true);
  const g = new DecalGeometry(target, new THREE.Vector3(...position), new THREE.Euler(...orientation), new THREE.Vector3(...size));
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * offset, p.getY(i) + n.getY(i) * offset, p.getZ(i) + n.getZ(i) * offset);
  return g;
}
