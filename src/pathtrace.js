// Ray-traced GI render for GFX Studio (page side): gathers the posed model (skinned meshes in their current pose,
// world transforms, materials + base/roughness/metalness/emissive maps), splits the image into row bands across a pool of
// workers (one per CPU core), accumulates progressive samples, denoises (edge-aware, guided by first-hit normal + depth),
// tone maps (ACES) and returns a transparent canvas (model + ground contact shadows) that GFX composes like any render.
//   pathTrace(context, width, height, {angle, fov, lock, spp: 32, bounces: 3, denoise: true, shadow: 0.55, onProgress})
import * as THREE from 'three';
import { cameraFor } from './gfx.js';

function imageData(tex) {
  const img = tex?.image; if (!img) return null; let w = img.width, h = img.height, data;
  if (img.data && img.data.length === w * h * 4 && (img.data instanceof Uint8Array || img.data instanceof Uint8ClampedArray)) data = img.data;
  else { try { const c = document.createElement('canvas'); c.width = w = Math.min(1024, w); c.height = h = Math.min(1024, h); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h); data = g.getImageData(0, 0, w, h).data; } catch { return null; } }
  return { w, h, data: new Uint8ClampedArray(data), flipY: tex.flipY !== false && !img.data, repeat: [tex.repeat.x, tex.repeat.y], offset: [tex.offset.x, tex.offset.y] };
}
const linColor = c => { const k = c.clone(); return [k.r, k.g, k.b]; }; // THREE.Color stores linear values

export function gatherScene(root) {
  root.updateMatrixWorld(true); const pos = [], nor = [], uv = [], col = [], mat = [], materials = [], matIndex = new Map(), v = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.traverse(o => {
    if (!o.isMesh || !o.visible || o.userData.codexHelper || /_Highlight|_Edge/.test(o.name)) return;
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, idx = g.index ? g.index.array : null, n = idx ? idx.length : P.count; nm.getNormalMatrix(o.matrixWorld);
    const mats = [o.material].flat(), groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const grp of groups) {
      const m = mats[grp.materialIndex] ?? mats[0]; if (!m || m.visible === false) continue;
      if (!matIndex.has(m)) { matIndex.set(m, materials.length); materials.push({ color: m.color ? linColor(m.color) : [0.8, 0.8, 0.8], opacity: m.transparent ? m.opacity ?? 1 : 1, roughness: m.roughness ?? 0.6, metalness: m.metalness ?? 0, emissive: m.emissive ? linColor(m.emissive).map(x => x * (m.emissiveIntensity ?? 1)) : [0, 0, 0], map: imageData(m.map), roughnessMap: imageData(m.roughnessMap), metalnessMap: imageData(m.metalnessMap), emissiveMap: imageData(m.emissiveMap), vertexColors: !!m.vertexColors }); }
      const mi = matIndex.get(m), vc = materials[mi].vertexColors && C;
      for (let k = grp.start; k < Math.min(n, grp.start + grp.count); k++) {
        const i = idx ? idx[k] : k; o.getVertexPosition ? o.getVertexPosition(i, v) : v.fromBufferAttribute(P, i); v.applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
        if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); } else nor.push(0, 1, 0);
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0); col.push(vc ? C.getX(i) : 1, vc ? C.getY(i) : 1, vc ? C.getZ(i) : 1); mat.push(mi);
      }
    }
  });
  if (!pos.length) throw new Error('Nothing to ray trace');
  return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uv), color: new Float32Array(col), mat: new Float32Array(mat), materials };
}

const aces = x => { const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e))); };
const srgb = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;

export async function pathTrace(context, width, height, { angle = 'three-quarter', fov = 30, lock, spp = 32, bounces = 3, denoise = true, shadow = 0.55, exposure = 1, maxSize = 1280, onProgress } = {}) {
  const k = Math.min(1, maxSize / Math.max(width, height)), W = Math.round(width * k), H = Math.round(height * k), root = context.root;
  const cam = cameraFor(root, W, H, angle, fov, lock); cam.updateMatrixWorld(true);
  const data = gatherScene(root), box = new THREE.Box3().setFromObject(root, true), radius = box.getSize(new THREE.Vector3()).length() / 2;
  const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), camBack = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2);
  data.key = new THREE.Vector3(0, 1, 0).multiplyScalar(1.1).addScaledVector(camRight, -0.55).addScaledVector(camBack, 0.45).normalize().toArray(); data.keyColor = [3.1, 2.95, 2.8]; data.keySize = 0.12; data.radius = radius;
  data.env = { top: [1.0, 1.04, 1.1], horizon: [0.62, 0.66, 0.72], bottom: [0.18, 0.18, 0.2], intensity: 0.9 * exposure };
  data.ground = { y: box.min.y, albedo: 0.75, shadow, ao: 0.35 };
  const job = { cam: { pos: cam.position.toArray(), invProj: cam.projectionMatrixInverse.elements.slice(), world: cam.matrixWorld.elements.slice() }, W, H, opts: { spp, bounces, seed: 7 } };
  const n = Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1)), band = 8, rows = []; for (let y = 0; y < H; y += band) rows.push([y, Math.min(H, y + band)]);
  const out = new Float32Array(W * H * 4), aux = new Float32Array(W * H * 4); let done = 0;
  const workers = Array.from({ length: n }, () => new Worker(new URL('./pathtrace-worker.js', import.meta.url), { type: 'module' }));
  try {
    await Promise.all(workers.map(w => new Promise((res, rej) => { w.onmessage = e => e.data.error ? rej(new Error(e.data.error)) : res(); w.postMessage({ scene: data, job }); })));
    await Promise.all(workers.map(w => new Promise((res, rej) => {
      const next = () => { const r = rows.shift(); if (!r) return res(); w.postMessage({ y0: r[0], y1: r[1] }); };
      w.onmessage = ({ data: m }) => { if (m.error) return rej(new Error(m.error)); out.set(m.out, m.y0 * W * 4); aux.set(m.aux, m.y0 * W * 4); done += m.y1 - m.y0; onProgress?.(done / H); next(); };
      next();
    })));
  } finally { workers.forEach(w => w.terminate()); }
  // edge-aware denoise (5×5, weights from normal + depth + luminance similarity)
  let img = out;
  if (denoise) { img = new Float32Array(out.length); const zs = radius * 0.05;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k0 = (y * W + x) * 4; let s = [0, 0, 0, 0], ws = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const k = (Y * W + X) * 4, nd = aux[k] * aux[k0] + aux[k + 1] * aux[k0 + 1] + aux[k + 2] * aux[k0 + 2], dz = Math.abs(aux[k + 3] - aux[k0 + 3]) / zs;
        const w = Math.exp(-(dx * dx + dy * dy) / 4.5) * Math.pow(Math.max(0, nd), 16) * Math.exp(-dz * dz) * (Math.abs(out[k + 3] - out[k0 + 3]) < 0.5 ? 1 : 0.05); if (w <= 0) continue; for (let i = 0; i < 4; i++) s[i] += out[k + i] * w; ws += w; }
      for (let i = 0; i < 4; i++) img[k0 + i] = ws ? s[i] / ws : out[k0 + i]; } }
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), id = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { const a = img[i * 4 + 3]; for (let ch = 0; ch < 3; ch++) id.data[i * 4 + ch] = srgb(aces(a > 1e-4 ? img[i * 4 + ch] / Math.max(a, 1e-4) * exposure : 0)) * 255; id.data[i * 4 + 3] = Math.min(1, a) * 255; }
  g.putImageData(id, 0, 0);
  if (k === 1) return c; const big = document.createElement('canvas'); big.width = width; big.height = height; const bg = big.getContext('2d'); bg.imageSmoothingQuality = 'high'; bg.drawImage(c, 0, 0, width, height); return big;
}
