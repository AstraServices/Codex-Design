import * as THREE from 'three';
import { STUD, LIBRARY_STUDS, loadImage, dataTexture, noise, fbm } from './textures.js';
import { resolveLook, compileGradient, blend, shadeTexel, rgb01 } from './look.js';

// Surface painter: bakes the look (studs, rim/glow/vignette, AO, color + light gradients, custom PBR channels)
// into one atlas per mesh. Two chart sources share one renderer:
//   quadCharts  – exact quads from k.voxels / k.block (edges analytic, voxel AO);
//   meshCharts  – any BufferGeometry: triangles grouped into charts by face direction, projected to the chart's
//                 axis plane; "hard" edges (open borders or creases ≥ hardAngle) seed a distance transform, so rims
//                 appear on real edges (box edges, cylinder caps, sign borders) and never on smooth seams.
// Outputs: map (sRGB albedo), optional normalMap (from painter height), ORM (roughness/metalness) and emissiveMap.

// ---------- Stud overlay ----------
export async function studOverlay(style) {
  if (!style || style === 'none') return null;
  const spec = LIBRARY_STUDS[style]; if (!spec?.overlay) throw new Error(`Painted studs use StudTrain overlays: 'train' | 'train-mixed' | 'none' (got ${style})`);
  const img = await loadImage(spec.overlay); if (img.placeholder) return null;
  return { px: img.pixels(), w: img.width, h: img.height, studs: spec.studs };
}
function overlayAt(o, su, sv) {
  const ox = Math.floor((((su / o.studs[0]) % 1) + 1) % 1 * o.w) % o.w, oy = Math.floor((1 - ((((sv / o.studs[1]) % 1) + 1) % 1)) * o.h) % o.h, k = (oy * o.w + ox) * 4;
  return [o.px[k] / 255, o.px[k + 1] / 255, o.px[k + 2] / 255, o.px[k + 3] / 255];
}

// ---------- Packing ----------
function pack(charts, texelsPerMeter, pad, maxAtlas) {
  for (let tpm = texelsPerMeter; tpm >= 4; tpm *= 0.8) {
    const rects = charts.map((c, i) => ({ i, tw: Math.max(2, Math.ceil(c.lu * tpm)), th: Math.max(2, Math.ceil(c.lv * tpm)) }));
    for (const r of rects) { r.w = r.tw + pad * 2; r.h = r.th + pad * 2; }
    const total = rects.reduce((s, r) => s + r.w * r.h, 0); let W = 64; while (W * W < total * 1.3 && W < maxAtlas) W *= 2;
    const order = [...rects].sort((a, b) => b.h - a.h); let x = 0, y = 0, row = 0, ok = true;
    for (const r of order) { if (r.w > W) { ok = false; break; } if (x + r.w > W) { x = 0; y += row; row = 0; } r.x = x; r.y = y; x += r.w; row = Math.max(row, r.h); }
    const H = 2 ** Math.ceil(Math.log2(Math.max(64, y + row)));
    if (ok && H <= maxAtlas) return { rects: rects.sort((a, b) => a.i - b.i), W, H, tpm };
  }
  throw new Error('Paint atlas too large: lower pxPerStud, raise maxAtlas or split the mesh');
}

// ---------- Exact Euclidean distance transform (Felzenszwalb) ----------
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s; do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
}
/** seeds: Uint8Array w*h (1 = seed). Returns Float32Array of distances in texels (Infinity if no seeds). */
export function distanceTransform(seeds, w, h) {
  const INF = 1e20, g = new Float64Array(w * h), n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = seeds[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) out[y * w + x] = d[x] >= INF / 2 ? Infinity : Math.sqrt(d[x]); }
  return out;
}

// ---------- Quad charts (voxels, blocks) ----------
/** quads: {o,u,v (full edge vectors, local space), color, shade?(s,t)→AO}. */
export function quadCharts(quads) {
  return quads.map(q => {
    const lu = Math.hypot(...q.u), lv = Math.hypot(...q.v), U = q.u.map(x => x / lu), V = q.v.map(x => x / lv), nu = U[1], nv = V[1];
    const inradius = Math.min(lu, lv) / 2 / STUD, base = rgb01(q.color);
    return { lu, lv, U, V, quad: q, setup() {}, texel(s, t, x) {
      for (let a = 0; a < 3; a++) x.local[a] = q.o[a] + q.u[a] * s + q.v[a] * t;
      x.normal.set(U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]);
      if (q.edgeAt) { x.edge = q.edgeAt(s, t); x.inradius = q.inradius ?? inradius; } else { x.edge = Math.min(s * lu, (1 - s) * lu, t * lv, (1 - t) * lv) / STUD; x.inradius = inradius; }
      x.faceUp = Math.abs(nu) + Math.abs(nv) > 0.2 ? (s - 0.5) * 2 * nu + (t - 0.5) * 2 * nv : 0;
      x.ao = q.shade ? q.shade(s, t) : 1; x.su = s * lu / STUD; x.sv = t * lv / STUD; x.lu = lu / STUD; x.lv = lv / STUD; x.base = base; return true;
    } };
  });
}

// ---------- Mesh charts (any geometry) ----------
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Splits a geometry into planar-projectable charts. Returns {charts, faces} (faces carry vertex indices + group). */
export function meshCharts(geometry, { crease = 44, hardAngle = 35, colors = [[1, 1, 1]], ao = null, concaveRims = false } = {}) {
  const pos = geometry.attributes.position, idx = geometry.index, triCount = (idx ? idx.count : pos.count) / 3;
  const vi = (f, k) => idx ? idx.getX(f * 3 + k) : f * 3 + k, P = i => new THREE.Vector3().fromBufferAttribute(pos, i);
  const groupOf = new Int32Array(triCount); for (const g of geometry.groups ?? []) for (let i = g.start / 3; i < (g.start + g.count) / 3; i++) groupOf[i] = g.materialIndex ?? 0;
  // Weld positions for adjacency.
  const box = new THREE.Box3().setFromBufferAttribute(pos), eps = Math.max(1e-6, box.getSize(new THREE.Vector3()).length() * 1e-6), weldMap = new Map(), weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) / eps)},${Math.round(pos.getY(i) / eps)},${Math.round(pos.getZ(i) / eps)}`; if (!weldMap.has(k)) weldMap.set(k, weldMap.size); weld[i] = weldMap.get(k); }
  const faces = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < triCount; f++) {
    const v = [vi(f, 0), vi(f, 1), vi(f, 2)]; a.copy(P(v[0])); b.copy(P(v[1])); c.copy(P(v[2]));
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)), area = n.length(); if (area < 1e-14) { faces.push(null); continue; }
    n.divideScalar(area); let ax = 0, best = -2; AXES.forEach((d, i) => { const s = n.x * d[0] + n.y * d[1] + n.z * d[2]; if (s > best) { best = s; ax = i; } });
    faces.push({ f, v, n, ax, group: groupOf[f] });
  }
  const edges = new Map(), ekey = (p, q) => p < q ? p * 4294967296 + q : q * 4294967296 + p;
  faces.forEach(F => { if (!F) return; for (let k = 0; k < 3; k++) { const key = ekey(weld[F.v[k]], weld[F.v[(k + 1) % 3]]); if (!edges.has(key)) edges.set(key, []); edges.get(key).push(F.f); } });
  const parent = faces.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const cosCrease = Math.cos(THREE.MathUtils.degToRad(crease)), cosHard = Math.cos(THREE.MathUtils.degToRad(hardAngle));
  for (const list of edges.values()) if (list.length === 2) { const [p, q] = list.map(i => faces[i]); if (p.ax === q.ax && p.n.dot(q.n) > cosCrease) parent[find(p.f)] = find(q.f); }
  // Rim seeds: open borders and CONVEX creases only (the other face bends away behind this face).
  const centroid = F => P(F.v[0]).add(P(F.v[1])).add(P(F.v[2])).divideScalar(3);
  const hard = (F, k) => { const list = edges.get(ekey(weld[F.v[k]], weld[F.v[(k + 1) % 3]])); if (list.length !== 2) return true; const o = faces[list[0] === F.f ? list[1] : list[0]]; if (F.n.dot(o.n) >= cosHard) return false;
    if (concaveRims) return true; const mid = P(F.v[k]).add(P(F.v[(k + 1) % 3])).multiplyScalar(0.5); return F.n.dot(centroid(o).sub(mid)) < 0; };
  const groups = new Map(); faces.forEach(F => { if (!F) return; const r = find(F.f); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(F); });
  const normals = geometry.attributes.normal;
  const charts = [];
  for (const list of groups.values()) {
    const axIdx = list[0].ax, axis = axIdx >> 1, sign = axIdx & 1 ? -1 : 1, ua = (axis + 1) % 3, va = (axis + 2) % 3, [A, B] = sign > 0 ? [ua, va] : [va, ua];
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const F of list) for (const i of F.v) { const u = pos.getComponent(i, A), v = pos.getComponent(i, B), y = pos.getY(i); umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    const lu = Math.max(1e-4, umax - umin), lv = Math.max(1e-4, vmax - vmin), U = [0, 0, 0], V = [0, 0, 0]; U[A] = 1; V[B] = 1;
    const ny = Math.abs(list.reduce((s, F) => s + F.n.y, 0) / list.length), vertical = ny < 0.7 && ymax - ymin > 1e-4;
    let tw = 0, th = 0, faceIdx, bary, dist, maxDist = 0;
    const toTex = i => [(pos.getComponent(i, A) - umin) / lu * tw, (pos.getComponent(i, B) - vmin) / lv * th];
    charts.push({ lu, lv, U, V, faces: list, A, B, umin, vmin,
      setup(w, h) {
        tw = w; th = h; faceIdx = new Int32Array(w * h).fill(-1); bary = new Float32Array(w * h * 2); const seeds = new Uint8Array(w * h);
        list.forEach((F, li) => {
          const t = F.v.map(toTex), x0 = Math.max(0, Math.floor(Math.min(t[0][0], t[1][0], t[2][0]) - 1)), x1 = Math.min(w - 1, Math.ceil(Math.max(t[0][0], t[1][0], t[2][0]) + 1)), y0 = Math.max(0, Math.floor(Math.min(t[0][1], t[1][1], t[2][1]) - 1)), y1 = Math.min(h - 1, Math.ceil(Math.max(t[0][1], t[1][1], t[2][1]) + 1));
          const d = (t[1][1] - t[2][1]) * (t[0][0] - t[2][0]) + (t[2][0] - t[1][0]) * (t[0][1] - t[2][1]); if (Math.abs(d) < 1e-12) return;
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const px = x + 0.5, py = y + 0.5, l0 = ((t[1][1] - t[2][1]) * (px - t[2][0]) + (t[2][0] - t[1][0]) * (py - t[2][1])) / d, l1 = ((t[2][1] - t[0][1]) * (px - t[2][0]) + (t[0][0] - t[2][0]) * (py - t[2][1])) / d, l2 = 1 - l0 - l1;
            const e = -0.02; if (l0 < e || l1 < e || l2 < e) continue;
            const o = y * w + x; if (faceIdx[o] >= 0) continue; faceIdx[o] = li; bary[o * 2] = l0; bary[o * 2 + 1] = l1;
          }
          for (let k = 0; k < 3; k++) if (hard(F, k)) { const p = t[k], q = t[(k + 1) % 3], n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 2) + 1; for (let s = 0; s <= n; s++) { const x = Math.floor(p[0] + (q[0] - p[0]) * s / n), y = Math.floor(p[1] + (q[1] - p[1]) * s / n); if (x >= 0 && y >= 0 && x < w && y < h) seeds[y * w + x] = 1; } }
        });
        dist = distanceTransform(seeds, w, h); maxDist = 0; for (let i = 0; i < w * h; i++) if (faceIdx[i] >= 0 && dist[i] !== Infinity) maxDist = Math.max(maxDist, dist[i]);
      },
      texel(s, t, x) {
        const ix = Math.min(tw - 1, Math.max(0, Math.floor(s * tw))), iy = Math.min(th - 1, Math.max(0, Math.floor(t * th))), o = iy * tw + ix, li = faceIdx[o]; if (li < 0) return false;
        const F = list[li], l0 = bary[o * 2], l1 = bary[o * 2 + 1], l2 = 1 - l0 - l1, w3 = [l0, l1, l2];
        x.local[0] = x.local[1] = x.local[2] = 0; x.normal.set(0, 0, 0); x.ao = 0;
        for (let k = 0; k < 3; k++) { const i = F.v[k]; x.local[0] += pos.getX(i) * w3[k]; x.local[1] += pos.getY(i) * w3[k]; x.local[2] += pos.getZ(i) * w3[k]; if (normals) x.normal.x += normals.getX(i) * w3[k], x.normal.y += normals.getY(i) * w3[k], x.normal.z += normals.getZ(i) * w3[k]; x.ao += (ao ? ao[i] : 1) * w3[k]; }
        if (!normals) x.normal.copy(F.n); x.normal.normalize();
        const tpm = tw / lu; x.edge = dist[o] === Infinity ? 1e6 : dist[o] / tpm / STUD; x.inradius = maxDist > 0 ? maxDist / tpm / STUD : 1e6;
        x.faceUp = vertical ? ((x.local[1] - ymin) / (ymax - ymin)) * 2 - 1 : 0;
        x.su = (x.local[A] - umin) / STUD; x.sv = (x.local[B] - vmin) / STUD; x.lu = lu / STUD; x.lv = lv / STUD; x.base = colors[F.group] ?? colors[0]; return true;
      },
      uvOf(i) { return [(pos.getComponent(i, A) - umin) / lu, (pos.getComponent(i, B) - vmin) / lv]; },
    });
  }
  return { charts, faces };
}

/** Per-vertex ambient occlusion with a BVH over `world`-space triangles (other parts of the model occlude too). */
export async function vertexAO(geometry, matrixWorld, occluderGeometry, { rays = 24, distance = 0.6 } = {}) {
  const { MeshBVH } = await import('three-mesh-bvh');
  const bvh = new MeshBVH(occluderGeometry), pos = geometry.attributes.position, nrm = geometry.attributes.normal, out = new Float32Array(pos.count);
  const ray = new THREE.Ray(), p = new THREE.Vector3(), n = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(matrixWorld);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(matrixWorld); if (nrm) n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
    t1.set(Math.abs(n.x) > 0.9 ? 0 : 1, Math.abs(n.x) > 0.9 ? 1 : 0, 0).cross(n).normalize(); t2.crossVectors(n, t1);
    let hit = 0;
    for (let r = 0; r < rays; r++) { // cosine-weighted, golden-angle spiral (deterministic)
      const u = (r + 0.5) / rays, phi = r * 2.399963, sr = Math.sqrt(u), dx = Math.cos(phi) * sr, dy = Math.sin(phi) * sr, dz = Math.sqrt(1 - u);
      ray.direction.set(0, 0, 0).addScaledVector(t1, dx).addScaledVector(t2, dy).addScaledVector(n, dz).normalize(); ray.origin.copy(p).addScaledVector(n, distance * 0.004);
      const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (h && h.distance < distance) hit += 1 - h.distance / distance;
    }
    out[i] = 1 - hit / rays;
  }
  return out;
}

// ---------- Renderer ----------
const helpers = { noise, fbm, smooth: (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix: (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), rgb: rgb01 };
/**
 * Render charts into an atlas. options: look, studs, pxPerStud, maxAtlas, gradients:[spec…], bounds:{model,part,world},
 * matrixWorld, painter:{albedo(ctx,color)→color, roughness(ctx)→0–1, metalness(ctx), emissive(ctx)→color, height(ctx)→0–1, bump}, roughness, metalness, name.
 */
export async function renderAtlas(charts, options = {}) {
  // Awaiting resolved paint promises alone never lets the browser render or handle input.
  // Give long bakes a frame/input opportunity without changing the deterministic texels.
  const interactive = typeof window !== 'undefined' && typeof document !== 'undefined';
  let sliceStart = performance.now();
  const yieldToUI = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    sliceStart = performance.now();
  };
  const look = resolveLook(options.look ?? 'default', options), overlay = await studOverlay(options.studs ?? 'none'), pad = 3;
  const { rects, W, H, tpm } = pack(charts, (options.pxPerStud ?? 32) / STUD, pad, options.maxAtlas ?? 2048);
  const P = options.painter ?? {}, grads = (options.gradients ?? []).map(g => ({ fn: compileGradient(g, options.bounds), only: g.only ? [g.only].flat().map(rgb01) : null, where: typeof g.where === 'function' ? g.where : null, light: g === 'light' || g.mode === 'light' || g.mode === 'multiply' || (!g.stops && !g.colors && !g.mode && (g.bottom !== undefined || g.top !== undefined)) }));
  const albedo = new Uint8Array(W * H * 4), covered = new Uint8Array(W * H), hasRM = !!(P.roughness || P.metalness), hasE = !!(P.emissive || look.emissiveRim), hasH = !!P.height;
  const orm = hasRM ? new Uint8Array(W * H * 4) : null, emis = hasE ? new Uint8Array(W * H * 4) : null, height = hasH ? new Float32Array(W * H) : null;
  const mw = options.matrixWorld ?? new THREE.Matrix4(), x = { local: [0, 0, 0], normal: new THREE.Vector3(), world: new THREE.Vector3(), model: null, part: new THREE.Vector3(), worldNormal: new THREE.Vector3(), ...helpers };
  x.model = x.world; const nm = new THREE.Matrix3().getNormalMatrix(mw), mb = options.bounds?.model, mSize = mb ? mb.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
  for (const [ci, ch] of charts.entries()) {
    const r = rects[ci]; ch.setup(r.tw, r.th);
    for (let y = 0; y < r.th; y++) {
      if (interactive && performance.now() - sliceStart >= 16) await yieldToUI();
      for (let xx = 0; xx < r.tw; xx++) {
        const s = (xx + 0.5) / r.tw, t = (y + 0.5) / r.th; if (!ch.texel(s, t, x)) continue;
        x.s = s; x.t = t; x.part.set(...x.local); x.world.set(...x.local).applyMatrix4(mw); x.worldNormal.copy(x.normal).applyMatrix3(nm).normalize();
        x.modelY = mb ? (x.world.y - mb.min.y) / Math.max(1e-6, mSize.y) : 0.5; x.edgeRel = Math.min(1, x.edge / Math.max(1e-3, x.inradius));
        x.norm = mb ? [(x.world.x - mb.min.x) / Math.max(1e-6, mSize.x), x.modelY, (x.world.z - mb.min.z) / Math.max(1e-6, mSize.z)] : [0.5, 0.5, 0.5];
        let c = x.base;
        const applies = g => (!g.only || g.only.some(o => Math.abs(o[0] - x.base[0]) + Math.abs(o[1] - x.base[1]) + Math.abs(o[2] - x.base[2]) < 0.02)) && (!g.where || g.where(x));
        for (const g of grads) if (!g.light && applies(g)) c = blend(c, g.fn(x));
        if (P.albedo) c = rgb01(P.albedo(x, c));
        if (overlay) { const sc = options.studScale ?? 1, o = overlayAt(overlay, x.su * sc, x.sv * sc), a = o[3] * (options.studStrength ?? 0.9); c = c.map((v, i) => v * (1 - a) + o[i] * a); }
        const sh = shadeTexel(c, x, look); c = sh.color;
        for (const g of grads) if (g.light && applies(g)) c = blend(c, g.fn(x));
        const k = ((r.y + pad + y) * W + r.x + pad + xx);
        albedo[k * 4] = Math.min(1, Math.max(0, c[0])) * 255; albedo[k * 4 + 1] = Math.min(1, Math.max(0, c[1])) * 255; albedo[k * 4 + 2] = Math.min(1, Math.max(0, c[2])) * 255; albedo[k * 4 + 3] = 255; covered[k] = 1;
        if (orm) { orm[k * 4] = 255; orm[k * 4 + 1] = Math.min(1, Math.max(0, P.roughness ? P.roughness(x) : options.roughness ?? 0.6)) * 255; orm[k * 4 + 2] = Math.min(1, Math.max(0, P.metalness ? P.metalness(x) : options.metalness ?? 0)) * 255; orm[k * 4 + 3] = 255; }
        if (emis) { let e = P.emissive ? rgb01(P.emissive(x)) : [0, 0, 0]; if (sh.emissive) e = e.map((v, i) => Math.max(v, sh.emissive[i])); emis[k * 4] = Math.min(1, e[0]) * 255; emis[k * 4 + 1] = Math.min(1, e[1]) * 255; emis[k * 4 + 2] = Math.min(1, e[2]) * 255; emis[k * 4 + 3] = 255; }
        if (height) height[k] = P.height(x);
      }
    }
  }
  // Dilate into padding / uncovered texels so mip levels and seams never show the background.
  const maps = [albedo, orm, emis].filter(Boolean);
  for (let pass = 0; pass < pad + 2; pass++) {
    const next = covered.slice();
    for (let y = 0; y < H; y++) {
      if (interactive && performance.now() - sliceStart >= 16) await yieldToUI();
      for (let xx = 0; xx < W; xx++) {
        const k = y * W + xx; if (covered[k]) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = xx + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || !covered[ny * W + nx]) continue; const j = ny * W + nx; for (const m of maps) m.set(m.subarray(j * 4, j * 4 + 4), k * 4); if (height) height[k] = height[j]; next[k] = 1; break; }
      }
    }
    covered.set(next);
  }
  const name = options.name ?? 'painted', mat = new THREE.MeshStandardMaterial({ name: `Painted_${name}`, roughness: hasRM ? 1 : options.roughness ?? 0.6, metalness: hasRM ? 1 : options.metalness ?? 0 });
  mat.map = dataTexture(albedo, W, H, { name: `${name}_albedo`, wrap: 'clamp', anisotropy: 4 });
  if (orm) { const t = dataTexture(orm, W, H, { name: `${name}_orm`, srgb: false, wrap: 'clamp' }); mat.roughnessMap = mat.metalnessMap = t; }
  if (emis) { mat.emissiveMap = dataTexture(emis, W, H, { name: `${name}_emissive`, wrap: 'clamp' }); mat.emissive.set('#ffffff'); mat.emissiveIntensity = options.emissiveIntensity ?? 1; }
  if (height) { // Tangent-space normal from height, per texel (atlas axes = chart axes = UV tangents).
    const nrm = new Uint8Array(W * H * 4), bump = (P.bump ?? 1) * tpm * STUD * 0.02, at = (xx, y) => height[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, xx))];
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const dx = (at(xx + 1, y) - at(xx - 1, y)) * bump, dy = (at(xx, y + 1) - at(xx, y - 1)) * bump, l = Math.hypot(dx, dy, 1), k = (y * W + xx) * 4; nrm[k] = (-dx / l * 0.5 + 0.5) * 255; nrm[k + 1] = (-dy / l * 0.5 + 0.5) * 255; nrm[k + 2] = (1 / l * 0.5 + 0.5) * 255; nrm[k + 3] = 255; }
    mat.normalMap = dataTexture(nrm, W, H, { name: `${name}_normal`, srgb: false, wrap: 'clamp' });
  }
  return { material: mat, rects, W, H, pad, tpm, atlas: { width: W, height: H, pxPerStud: +(tpm * STUD).toFixed(1), charts: charts.length } };
}

/** Geometry for quad charts. Merged voxel faces keep one atlas rectangle (rims follow the whole block) but are
 *  tessellated on the voxel grid (q.grid) so neighbouring faces share every edge: watertight, no T-junctions, all quads.
 *  tessellate:false gives one quad per face (fewest triangles, T-junctions possible). */
export function quadGeometry(charts, { rects, W, H, pad }, { tessellate = true } = {}) {
  const position = [], normal = [], uv = [], index = [];
  charts.forEach((ch, i) => {
    const q = ch.quad, r = rects[i], N = [ch.U[1] * ch.V[2] - ch.U[2] * ch.V[1], ch.U[2] * ch.V[0] - ch.U[0] * ch.V[2], ch.U[0] * ch.V[1] - ch.U[1] * ch.V[0]];
    const [ga, gb] = tessellate && q.grid ? q.grid : [1, 1], base = position.length / 3;
    for (let j = 0; j <= gb; j++) for (let k = 0; k <= ga; k++) { const s = k / ga, t = j / gb; for (let a = 0; a < 3; a++) { position.push(q.o[a] + q.u[a] * s + q.v[a] * t); normal.push(N[a]); } uv.push((r.x + pad + s * r.tw) / W, (r.y + pad + t * r.th) / H); }
    for (let j = 0; j < gb; j++) for (let k = 0; k < ga; k++) { const v00 = base + j * (ga + 1) + k, v10 = v00 + 1, v01 = v00 + ga + 1, v11 = v01 + 1; index.push(v00, v10, v01, v01, v10, v11); }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
/** Geometry for mesh charts: vertices duplicated per chart, every original attribute (incl. skin) kept, atlas UVs. */
export function chartGeometry(source, charts, { rects, W, H, pad }) {
  const attrs = Object.entries(source.attributes).filter(([k]) => k !== 'uv' && k !== 'uv1' && k !== 'color'), out = Object.fromEntries(attrs.map(([k, a]) => [k, []])), uv = [], index = [];
  charts.forEach((ch, ci) => {
    const r = rects[ci], remap = new Map();
    for (const F of ch.faces) for (const i of F.v) {
      if (!remap.has(i)) { remap.set(i, uv.length / 2); for (const [k, a] of attrs) for (let c = 0; c < a.itemSize; c++) out[k].push(a.getComponent(i, c)); const [s, t] = ch.uvOf(i); uv.push((r.x + pad + s * r.tw) / W, (r.y + pad + t * r.th) / H); }
      index.push(remap.get(i));
    }
  });
  const g = new THREE.BufferGeometry();
  for (const [k, a] of attrs) { const Arr = a.array.constructor; g.setAttribute(k, new THREE.BufferAttribute(new Arr(out[k]), a.itemSize, a.normalized)); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(index); if (!g.attributes.normal) g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
