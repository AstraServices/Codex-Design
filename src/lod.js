import * as THREE from 'three';
import { weldExact, auditTopology } from './topology.js';

// Smart LOD optimizer: Garland–Heckbert quadric error metric (QEM) edge collapse with
// - attribute-aware cost (UV, normals, colors) after Hoppe's appearance-preserving metric,
// - skin-weight preservation: weights are blended on collapse and weight differences are penalized,
//   so joint loops (where bone influence changes) survive while rigid spans reduce first,
// - feature preservation: UV/normal seams are locked, hard creases and open borders only slide along themselves,
// - safety checks: link condition (stays manifold), no face flips, no slivers, and an error budget
//   (relative to the mesh size) that stops before the silhouette breaks.
// Works on static and skinned meshes; morph-target meshes are skipped.

class Heap {
  constructor() { this.cost = []; this.key = []; this.ver = []; }
  get size() { return this.cost.length; }
  push(c, k, v) { const { cost, key, ver } = this; let i = cost.length; cost.push(c); key.push(k); ver.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (cost[p] <= c) break; cost[i] = cost[p]; key[i] = key[p]; ver[i] = ver[p]; i = p; } cost[i] = c; key[i] = k; ver[i] = v; }
  pop() { const { cost, key, ver } = this, top = [cost[0], key[0], ver[0]], c = cost.pop(), k = key.pop(), v = ver.pop(), n = cost.length;
    if (n) { let i = 0; for (;;) { let m = 2 * i + 1; if (m >= n) break; if (m + 1 < n && cost[m + 1] < cost[m]) m++; if (cost[m] >= c) break; cost[i] = cost[m]; key[i] = key[m]; ver[i] = ver[m]; i = m; } cost[i] = c; key[i] = k; ver[i] = v; }
    return top; }
}

export const LOD_DEFAULTS = Object.freeze({ maxError: 0.015, creaseAngle: 40, uvWeight: 1, normalWeight: 0.6, colorWeight: 0.5, skinWeight: 1, preserveCreases: true, lockBorder: false });

/** How the authored normals are split. Returns null for smooth normals, else {normalAngle, constraintAngle}:
 *  flat-shaded meshes keep flat normals; otherwise the typical split angle separates hard from smooth edges. */
export function estimateNormalCrease(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal; if (!n) return null;
  const index = geometry.index, count = index ? index.count : p.count, at = i => (index ? index.getX(i) : i);
  geometry.computeBoundingBox(); const eps = (geometry.boundingBox.getSize(new THREE.Vector3()).length() || 1) * 1e-6, pid = new Map(), id = v => { const k = `${Math.round(p.getX(v) / eps)},${Math.round(p.getY(v) / eps)},${Math.round(p.getZ(v) / eps)}`; if (!pid.has(k)) pid.set(k, pid.size); return pid.get(k); };
  const edges = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f + 2 < count; f += 3) {
    const v = [at(f), at(f + 1), at(f + 2)], ids = v.map(id);
    a.fromBufferAttribute(p, v[0]); b.fromBufferAttribute(p, v[1]); c.fromBufferAttribute(p, v[2]); const fn = b.sub(a).cross(c.sub(a)); if (fn.lengthSq() < 1e-30) continue; fn.normalize();
    for (let j = 0; j < 3; j++) { const i0 = ids[j], i1 = ids[(j + 1) % 3], k = i0 < i1 ? `${i0},${i1}` : `${i1},${i0}`; const e = edges.get(k) ?? []; e.push({ fn: fn.clone(), corners: { [i0]: v[j], [i1]: v[(j + 1) % 3] } }); edges.set(k, e); }
  }
  let min = Infinity, split = 0, total = 0; const angles = [];
  for (const [k, list] of edges) {
    if (list.length !== 2) continue; total++; const [i0, i1] = k.split(',').map(Number);
    const differs = [i0, i1].some(pv => { const x = list[0].corners[pv], y = list[1].corners[pv]; return x !== y && (n.getX(x) * n.getX(y) + n.getY(x) * n.getY(y) + n.getZ(x) * n.getZ(y)) < 0.999; });
    if (differs) { split++; const ang = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(list[0].fn.dot(list[1].fn), -1, 1))); angles.push(ang); min = Math.min(min, ang); }
  }
  if (!split) return null;
  if (split / total > 0.6) return { normalAngle: Math.max(0.5, min * 0.9), constraintAngle: null, flat: true };
  angles.sort((x, y) => x - y); const angle = THREE.MathUtils.clamp(angles[angles.length >> 1] * 0.8, 10, 89);
  return { normalAngle: angle, constraintAngle: angle, flat: false };
}
/** Rebuilds normals on an indexed geometry: smooth inside regions, split across edges sharper than `angle` (degrees). */
export function creasedNormals(g, angle) {
  const p = g.attributes.position, idx = g.index.array, F = idx.length / 3, cos = Math.cos(THREE.MathUtils.degToRad(angle));
  const fnArr = new Float64Array(F * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < F; f++) { a.fromBufferAttribute(p, idx[f * 3]); b.fromBufferAttribute(p, idx[f * 3 + 1]); c.fromBufferAttribute(p, idx[f * 3 + 2]); const n = b.sub(a).cross(c.sub(a)); fnArr.set([n.x, n.y, n.z], f * 3); } // area-weighted
  const vf = Array.from({ length: p.count }, () => []); for (let f = 0; f < F; f++) for (let j = 0; j < 3; j++) vf[idx[f * 3 + j]].push(f);
  const unit = f => { const l = Math.hypot(fnArr[f * 3], fnArr[f * 3 + 1], fnArr[f * 3 + 2]) || 1; return [fnArr[f * 3] / l, fnArr[f * 3 + 1] / l, fnArr[f * 3 + 2] / l]; };
  const attrs = Object.entries(g.attributes).filter(([nm]) => nm !== 'normal'), extra = [], normals = [], newIndex = Uint32Array.from(idx);
  let next = p.count;
  for (let v = 0; v < p.count; v++) {
    const clusters = [];
    for (const f of vf[v]) { const u = unit(f); const cl = clusters.find(k => k.seed[0] * u[0] + k.seed[1] * u[1] + k.seed[2] * u[2] > cos); if (cl) cl.faces.push(f); else clusters.push({ seed: u, faces: [f] }); }
    clusters.forEach((cl, i) => {
      const n = [0, 0, 0]; for (const f of cl.faces) for (let j = 0; j < 3; j++) n[j] += fnArr[f * 3 + j]; const l = Math.hypot(...n) || 1;
      const target = i === 0 ? v : next++; normals[target] = n.map(x => x / l); if (i > 0) extra.push(v);
      for (const f of cl.faces) for (let j = 0; j < 3; j++) if (idx[f * 3 + j] === v) newIndex[f * 3 + j] = target;
    });
    if (!clusters.length) normals[v] = [0, 1, 0];
  }
  for (const [name, at] of attrs) {
    const data = new at.array.constructor(next * at.itemSize); data.set(at.array.subarray(0, p.count * at.itemSize));
    extra.forEach((src, i) => data.set(at.array.subarray(src * at.itemSize, (src + 1) * at.itemSize), (p.count + i) * at.itemSize));
    g.setAttribute(name, new THREE.BufferAttribute(data, at.itemSize, at.normalized));
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals.flat(), 3)); g.setIndex(new THREE.BufferAttribute(newIndex, 1));
  return g;
}

/** Simplifies one indexed BufferGeometry. ratio = triangles to keep (0–1). Returns {skipped} if unsupported.
 *  normals: 'auto' rebuilds split (hard) normals after reduction, keeping those edges as creases; 'keep' treats them as seams. */
export function simplifyGeometry(source, options = {}) {
  const o = { ...LOD_DEFAULTS, ratio: 0.5, normals: 'auto', ...options };
  if (Object.keys(source.morphAttributes).length) return { skipped: 'morph targets' };
  // Hard-surface meshes split normals at every hard edge; as attributes those would lock all vertices.
  // Like Blender's decimate + auto smooth: drop them, keep the edges as creases, rebuild afterwards.
  let normalCrease = null, work = source;
  if (o.normals === 'auto' && source.attributes.normal) { normalCrease = estimateNormalCrease(source); if (normalCrease !== null) { work = source.clone(); work.deleteAttribute('normal'); work.deleteAttribute('tangent'); if (normalCrease.constraintAngle !== null) o.creaseAngle = Math.min(o.creaseAngle, normalCrease.constraintAngle); o.preserveCreases = true; } }
  const g = weldExact(work); if (work !== source) work.dispose(); if (!g) return { skipped: 'interleaved attributes' };
  const pos = g.attributes.position, N = pos.count, idx = Uint32Array.from(g.index.array), F = idx.length / 3;
  const P = Float64Array.from(pos.array);
  g.computeBoundingBox(); const D = g.boundingBox.getSize(new THREE.Vector3()).length() || 1;
  const faceGroup = new Int32Array(F); for (const gr of g.groups) for (let i = gr.start / 3; i < Math.min(F, (gr.start + gr.count) / 3); i++) faceGroup[i] = gr.materialIndex;
  // Copy attributes so collapses can interpolate them.
  const attrs = Object.entries(g.attributes).filter(([n]) => n !== 'position').map(([name, a]) => ({ name, size: a.itemSize, normalized: a.normalized, Type: a.array.constructor, data: Float64Array.from(a.array) }));
  const A = Object.fromEntries(attrs.map(a => [a.name, a]));
  const skinI = A.skinIndex, skinW = A.skinWeight;

  // Position welding (topology) → seams: GPU vertices sharing a position with different attributes.
  const eps = D * 1e-6, pidOf = new Int32Array(N), bucket = new Map(), pidCount = [];
  for (let i = 0; i < N; i++) { const k = `${Math.round(P[i * 3] / eps)},${Math.round(P[i * 3 + 1] / eps)},${Math.round(P[i * 3 + 2] / eps)}`; let id = bucket.get(k); if (id === undefined) { id = pidCount.length; bucket.set(k, id); pidCount.push(0); } pidOf[i] = id; pidCount[id]++; }
  const fixed = new Uint8Array(N); for (let i = 0; i < N; i++) if (pidCount[pidOf[i]] > 1) fixed[i] = 1;
  const twins = new Map(); for (let i = 0; i < N; i++) if (fixed[i]) { const l = twins.get(pidOf[i]); if (l) l.push(i); else twins.set(pidOf[i], [i]); }

  const alive = new Uint8Array(N).fill(1), dead = new Uint8Array(F), vf = Array.from({ length: N }, () => []);
  const key = (a, b) => (a < b ? a * N + b : b * N + a);
  const fn = new Float64Array(F * 3), tmp = new THREE.Vector3();
  const faceNormal = (f, out, sub = -1, subP = null) => {
    const v = [idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]], p = v.map(x => (x === sub ? subP : [P[x * 3], P[x * 3 + 1], P[x * 3 + 2]]));
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2], wx = p[2][0] - p[0][0], wy = p[2][1] - p[0][1], wz = p[2][2] - p[0][2];
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx; return Math.hypot(out[0], out[1], out[2]);
  };
  const n3 = [0, 0, 0];
  let faceCount = 0;
  for (let f = 0; f < F; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2], len = faceNormal(f, n3);
    if (a === b || b === c || a === c || len < eps * eps) { dead[f] = 1; continue; }
    fn[f * 3] = n3[0] / len; fn[f * 3 + 1] = n3[1] / len; fn[f * 3 + 2] = n3[2] / len; vf[a].push(f); vf[b].push(f); vf[c].push(f); faceCount++;
  }
  const before = faceCount;

  // Quadrics: 10 coefficients + accumulated area per vertex.
  const Q = new Float64Array(N * 10), W = new Float64Array(N);
  const addPlane = (v, nx, ny, nz, d, w) => { const q = v * 10; Q[q] += w * nx * nx; Q[q + 1] += w * nx * ny; Q[q + 2] += w * nx * nz; Q[q + 3] += w * nx * d; Q[q + 4] += w * ny * ny; Q[q + 5] += w * ny * nz; Q[q + 6] += w * ny * d; Q[q + 7] += w * nz * nz; Q[q + 8] += w * nz * d; Q[q + 9] += w * d * d; };
  for (let f = 0; f < F; f++) {
    if (dead[f]) continue; const nx = fn[f * 3], ny = fn[f * 3 + 1], nz = fn[f * 3 + 2], a = idx[f * 3], area = faceNormal(f, n3) / 2;
    const d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    for (let j = 0; j < 3; j++) { const v = idx[f * 3 + j]; addPlane(v, nx, ny, nz, d, area); W[v] += area; }
  }
  // Edge classification: border (1 face), crease (dihedral above threshold), non-manifold (>2 faces → lock).
  const edgeFaces = new Map();
  for (let f = 0; f < F; f++) if (!dead[f]) for (let j = 0; j < 3; j++) { const k = key(idx[f * 3 + j], idx[f * 3 + (j + 1) % 3]); const l = edgeFaces.get(k); if (l) l.push(f); else edgeFaces.set(k, [f]); }
  const special = new Map(), creaseCos = Math.cos(THREE.MathUtils.degToRad(o.creaseAngle));
  const constrain = (a, b, f, weight) => { // plane through edge, perpendicular to face
    const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2], len2 = ex * ex + ey * ey + ez * ez;
    tmp.set(ey * fn[f * 3 + 2] - ez * fn[f * 3 + 1], ez * fn[f * 3] - ex * fn[f * 3 + 2], ex * fn[f * 3 + 1] - ey * fn[f * 3]); if (tmp.lengthSq() < 1e-30) return; tmp.normalize();
    const d = -(tmp.x * P[a * 3] + tmp.y * P[a * 3 + 1] + tmp.z * P[a * 3 + 2]); addPlane(a, tmp.x, tmp.y, tmp.z, d, weight * len2); addPlane(b, tmp.x, tmp.y, tmp.z, d, weight * len2);
  };
  for (const [k, faces] of edgeFaces) {
    const a = Math.floor(k / N), b = k % N;
    if (faces.length === 1) { special.set(k, 2); constrain(a, b, faces[0], 20); if (o.lockBorder) fixed[a] = fixed[b] = 1; }
    else if (faces.length > 2) { fixed[a] = fixed[b] = 1; }
    else if (o.preserveCreases) { const [f1, f2] = faces, dot = fn[f1 * 3] * fn[f2 * 3] + fn[f1 * 3 + 1] * fn[f2 * 3 + 1] + fn[f1 * 3 + 2] * fn[f2 * 3 + 2]; if (dot < creaseCos) { special.set(k, 1); constrain(a, b, f1, 10); constrain(a, b, f2, 10); } }
  }
  const neighbors = v => { const s = new Set(); for (const f of vf[v]) for (let j = 0; j < 3; j++) { const x = idx[f * 3 + j]; if (x !== v) s.add(x); } return s; };
  const specialCount = new Uint8Array(N);
  const recount = v => { let c = 0; for (const x of neighbors(v)) if (special.has(key(v, x))) c++; specialCount[v] = Math.min(255, c); };
  for (let v = 0; v < N; v++) if (vf[v].length) recount(v);
  // A vertex may move freely, or slide along exactly one crease/border line, never off it.
  const movable = (v, other) => { if (fixed[v]) return false; const c = specialCount[v]; return c === 0 || (c === 2 && special.has(key(v, other))); };

  const quadric = (v, x, y, z) => { const q = v * 10; return Q[q] * x * x + 2 * Q[q + 1] * x * y + 2 * Q[q + 2] * x * z + 2 * Q[q + 3] * x + Q[q + 4] * y * y + 2 * Q[q + 5] * y * z + 2 * Q[q + 6] * y + Q[q + 7] * z * z + 2 * Q[q + 8] * z + Q[q + 9]; };
  const skinDistance = (a, b) => {
    if (!skinI) return 0; const m = new Map();
    for (let j = 0; j < 4; j++) { m.set(skinI.data[a * 4 + j], (m.get(skinI.data[a * 4 + j]) ?? 0) + skinW.data[a * 4 + j]); m.set(skinI.data[b * 4 + j], (m.get(skinI.data[b * 4 + j]) ?? 0) - skinW.data[b * 4 + j]); }
    let s = 0; for (const v of m.values()) s += Math.abs(v); return s / 2;
  };
  const uvAttrs = attrs.filter(a => a.name.startsWith('uv') && a.size === 2);
  // UV error after Hoppe: the collapsed vertex gets lerp(uv); compare with what each surrounding face's
  // own affine (barycentric) UV map says at the new position. Evenly mapped regions therefore cost nothing.
  const uvError = (a, b, t, x, y, z) => {
    if (!uvAttrs.length) return 0; let worst = 0;
    for (const list of [vf[a], vf[b]]) for (const f of list) {
      const i0 = idx[f * 3], i1 = idx[f * 3 + 1], i2 = idx[f * 3 + 2];
      const v0x = P[i1 * 3] - P[i0 * 3], v0y = P[i1 * 3 + 1] - P[i0 * 3 + 1], v0z = P[i1 * 3 + 2] - P[i0 * 3 + 2];
      const v1x = P[i2 * 3] - P[i0 * 3], v1y = P[i2 * 3 + 1] - P[i0 * 3 + 1], v1z = P[i2 * 3 + 2] - P[i0 * 3 + 2];
      const v2x = x - P[i0 * 3], v2y = y - P[i0 * 3 + 1], v2z = z - P[i0 * 3 + 2];
      const d00 = v0x * v0x + v0y * v0y + v0z * v0z, d01 = v0x * v1x + v0y * v1y + v0z * v1z, d11 = v1x * v1x + v1y * v1y + v1z * v1z;
      const d20 = v2x * v0x + v2y * v0y + v2z * v0z, d21 = v2x * v1x + v2y * v1y + v2z * v1z, den = d00 * d11 - d01 * d01; if (Math.abs(den) < 1e-30) continue;
      const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bu = 1 - bv - bw;
      for (const at of uvAttrs) {
        const s = at.data, pu = bu * s[i0 * 2] + bv * s[i1 * 2] + bw * s[i2 * 2], pv = bu * s[i0 * 2 + 1] + bv * s[i1 * 2 + 1] + bw * s[i2 * 2 + 1];
        const lu = s[a * 2] + (s[b * 2] - s[a * 2]) * t, lv = s[a * 2 + 1] + (s[b * 2 + 1] - s[a * 2 + 1]) * t;
        worst = Math.max(worst, (pu - lu) ** 2 + (pv - lv) ** 2);
      }
    }
    return o.uvWeight * worst * D * D;
  };
  const attrPenalty = (a, b, L2) => {
    let pen = 0;
    for (const at of attrs) {
      if (at === skinI || at === skinW || at.name === 'tangent' || uvAttrs.includes(at)) continue;
      let d2 = 0; for (let j = 0; j < at.size; j++) { const d = at.data[a * at.size + j] - at.data[b * at.size + j]; d2 += d * d; }
      if (at.name === 'normal') pen += o.normalWeight * (d2 / 2) * L2;
      else if (at.name === 'color') pen += o.colorWeight * d2 * L2;
    }
    // Skin: differing bone influence marks a deformation zone (joint loop). Penalize so rigid spans go first.
    if (skinI) pen += o.skinWeight * skinDistance(a, b) * L2 * 6;
    return pen;
  };
  const evaluate = (a, b) => {
    if (!alive[a] || !alive[b]) return null;
    const ma = movable(a, b), mb = movable(b, a); if (!ma && !mb) return null;
    const L2 = (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
    const area = Math.max(W[a] + W[b], 1e-30), pen = attrPenalty(a, b, L2); let best = null;
    for (const t of [0, 0.5, 1]) {
      if ((t > 0 && !ma) || (t < 1 && !mb)) continue;
      const x = P[a * 3] + (P[b * 3] - P[a * 3]) * t, y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t, z = P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t;
      const cost = Math.max(0, quadric(a, x, y, z) + quadric(b, x, y, z)) / area + pen * (t === 0.5 ? 0.5 : 1) + uvError(a, b, t, x, y, z);
      if (!best || cost < best.cost) best = { cost, t };
    }
    return best;
  };
  const heap = new Heap(), version = new Map();
  const schedule = (a, b) => { if (a > b) [a, b] = [b, a]; const k = key(a, b), r = evaluate(a, b), v = (version.get(k) ?? 0) + 1; version.set(k, v); if (r) heap.push(r.cost, k, v * 4 + r.t * 2); };
  for (const k of edgeFaces.keys()) schedule(Math.floor(k / N), k % N);

  const target = Math.max(4, Math.floor(before * Math.min(1, Math.max(0, o.ratio)))), limit = (o.maxError * D) ** 2;
  let collapses = 0, maxCost = 0, rejected = 0;
  const nOld = [0, 0, 0], nNew = [0, 0, 0];
  while (faceCount > target && heap.size) {
    const [cost, k, packed] = heap.pop(), v = Math.floor(packed / 4), t = (packed % 4) / 2;
    if (version.get(k) !== v) continue;
    if (cost > limit) break;
    let a = Math.floor(k / N), b = k % N; if (!alive[a] || !alive[b]) continue;
    // Survivor s keeps its index; r is removed. tt is the interpolation from s toward r.
    const s = t <= 0.5 ? a : b, r = s === a ? b : a, tt = s === a ? t : 1 - t;
    const px = P[s * 3] + (P[r * 3] - P[s * 3]) * tt, py = P[s * 3 + 1] + (P[r * 3 + 1] - P[s * 3 + 1]) * tt, pz = P[s * 3 + 2] + (P[r * 3 + 2] - P[s * 3 + 2]) * tt, np = [px, py, pz];
    const shared = vf[s].filter(f => idx[f * 3] === r || idx[f * 3 + 1] === r || idx[f * 3 + 2] === r);
    const ns = neighbors(s), nr = neighbors(r); let common = 0; for (const x of ns) if (nr.has(x)) common++;
    let ok = shared.length > 0 && common === shared.length;
    if (ok && fixed[s]) { // seam survivor: the link condition must hold across all its UV/normal twins too
      const pn = new Set(), shares = new Set(), rp = pidOf[r];
      for (const tw of twins.get(pidOf[s])) for (const f of vf[tw]) { const ids = [0, 1, 2].map(j => pidOf[idx[f * 3 + j]]); for (const x of ids) if (x !== pidOf[s]) pn.add(x); if (ids.includes(rp)) shares.add(ids.slice().sort((x, y) => x - y).join(',')); }
      const rn = new Set(); for (const x of nr) rn.add(pidOf[x]); let pc = 0; for (const x of pn) if (rn.has(x)) pc++;
      ok = pc === shares.size;
    }
    if (ok) for (const [vert, list] of [[s, vf[s]], [r, vf[r]]]) {
      for (const f of list) {
        if (shared.includes(f)) continue;
        const l0 = faceNormal(f, nOld), l1 = faceNormal(f, nNew, vert, np);
        if (l1 < l0 * 0.02 || (nOld[0] * nNew[0] + nOld[1] * nNew[1] + nOld[2] * nNew[2]) < 0.3 * l0 * l1) { ok = false; break; }
        // Avoid slivers: new triangle quality must stay reasonable.
        const f3 = [0, 1, 2].map(j => { const x = idx[f * 3 + j]; return x === vert ? np : [P[x * 3], P[x * 3 + 1], P[x * 3 + 2]]; });
        const e2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2, qual = 2 * Math.sqrt(3) * l1 / (e2(f3[0], f3[1]) + e2(f3[1], f3[2]) + e2(f3[2], f3[0]));
        if (qual < 0.02) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) { rejected++; continue; }
    // Apply collapse.
    for (const f of shared) { dead[f] = 1; faceCount--; for (let j = 0; j < 3; j++) { const x = idx[f * 3 + j]; if (x !== s && x !== r) vf[x] = vf[x].filter(y => y !== f); } }
    vf[s] = vf[s].filter(f => !dead[f]);
    for (const f of vf[r]) { if (dead[f]) continue; for (let j = 0; j < 3; j++) if (idx[f * 3 + j] === r) idx[f * 3 + j] = s; vf[s].push(f); }
    vf[r] = []; alive[r] = 0;
    for (const x of nr) { if (x === s) continue; const ko = key(r, x), sp = special.get(ko); if (sp !== undefined) { special.delete(ko); const kn = key(s, x); special.set(kn, Math.max(sp, special.get(kn) ?? 0)); } }
    special.delete(key(s, r));
    P[s * 3] = px; P[s * 3 + 1] = py; P[s * 3 + 2] = pz;
    for (const at of attrs) {
      if (at === skinI || at === skinW) continue;
      for (let j = 0; j < at.size; j++) at.data[s * at.size + j] += (at.data[r * at.size + j] - at.data[s * at.size + j]) * tt;
      if (at.name === 'normal') { const o3 = s * 3, l = Math.hypot(at.data[o3], at.data[o3 + 1], at.data[o3 + 2]) || 1; for (let j = 0; j < 3; j++) at.data[o3 + j] /= l; }
    }
    if (skinI) { // blend influences, keep the 4 strongest, renormalize
      const m = new Map(); for (let j = 0; j < 4; j++) { m.set(skinI.data[s * 4 + j], (m.get(skinI.data[s * 4 + j]) ?? 0) + skinW.data[s * 4 + j] * (1 - tt)); m.set(skinI.data[r * 4 + j], (m.get(skinI.data[r * 4 + j]) ?? 0) + skinW.data[r * 4 + j] * tt); }
      const top = [...m].filter(([, w]) => w > 0).sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((acc, [, w]) => acc + w, 0) || 1;
      for (let j = 0; j < 4; j++) { skinI.data[s * 4 + j] = top[j]?.[0] ?? 0; skinW.data[s * 4 + j] = (top[j]?.[1] ?? 0) / sum; }
    }
    for (let j = 0; j < 10; j++) Q[s * 10 + j] += Q[r * 10 + j]; W[s] += W[r];
    const around = neighbors(s); recount(s); for (const x of around) recount(x);
    for (const x of around) schedule(s, x);
    collapses++; maxCost = Math.max(maxCost, cost); o.debug?.({ s, r, tt, idx, P, dead, fixed, specialCount, shared });
  }

  // Rebuild: compact vertices, keep material groups in order.
  const order = []; for (let f = 0; f < F; f++) if (!dead[f]) order.push(f); order.sort((x, y) => faceGroup[x] - faceGroup[y] || x - y);
  const remap = new Int32Array(N).fill(-1); let count = 0; const index = new Uint32Array(order.length * 3);
  order.forEach((f, i) => { for (let j = 0; j < 3; j++) { const v = idx[f * 3 + j]; if (remap[v] < 0) remap[v] = count++; index[i * 3 + j] = remap[v]; } });
  const out = new THREE.BufferGeometry(), back = new Int32Array(count); for (let v = 0; v < N; v++) if (remap[v] >= 0) back[remap[v]] = v;
  const outPos = new (pos.array.constructor)(count * 3); for (let i = 0; i < count; i++) for (let j = 0; j < 3; j++) outPos[i * 3 + j] = P[back[i] * 3 + j];
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3, pos.normalized));
  for (const at of attrs) {
    const data = new at.Type(count * at.size), integer = !(data instanceof Float32Array || data instanceof Float64Array);
    for (let i = 0; i < count; i++) for (let j = 0; j < at.size; j++) { const v = at.data[back[i] * at.size + j]; data[i * at.size + j] = integer ? Math.round(v) : v; }
    out.setAttribute(at.name, new THREE.BufferAttribute(data, at.size, at.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  let start = 0; for (let i = 0; i <= order.length; i++) if (i === order.length || (i > 0 && faceGroup[order[i]] !== faceGroup[order[i - 1]])) { if (i > start) out.addGroup(start * 3, (i - start) * 3, faceGroup[order[start]]); start = i; }
  if (g.groups.length <= 1 && out.groups.length === 1 && faceGroup[order[0]] === 0) out.clearGroups();
  if (normalCrease !== null) creasedNormals(out, normalCrease.normalAngle);
  out.computeBoundingBox(); out.computeBoundingSphere(); out.userData = { ...source.userData }; if (collapses) delete out.userData.sourceQuads;
  g.dispose();
  return { geometry: out, trianglesBefore: before, trianglesAfter: order.length, collapses, rejected, relativeError: Math.sqrt(maxCost) / D, hitErrorLimit: faceCount > target, lockedVertices: fixed.reduce((s, x) => s + x, 0) };
}

/** Detail culling for far LODs: removes the smallest connected parts (bolts, plates, studs) until `removeTriangles`
 *  is met. Parts larger than maxPart (fraction of the mesh diagonal) are never removed. Returns removed triangle count. */
export function cullSmallParts(geometry, removeTriangles, { maxPart = 0.08 } = {}) {
  const p = geometry.attributes.position, idx = geometry.index.array, F = idx.length / 3; if (removeTriangles <= 0 || F < 8) return 0;
  geometry.computeBoundingBox(); const D = geometry.boundingBox.getSize(new THREE.Vector3()).length() || 1, eps = D * 1e-6;
  const pid = new Map(), id = v => { const k = `${Math.round(p.getX(v) / eps)},${Math.round(p.getY(v) / eps)},${Math.round(p.getZ(v) / eps)}`; let x = pid.get(k); if (x === undefined) { x = pid.size; pid.set(k, x); } return x; };
  const parent = []; const find = x => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const fp = new Int32Array(F * 3); for (let i = 0; i < F * 3; i++) { fp[i] = id(idx[i]); parent[fp[i]] ??= fp[i]; }
  for (let f = 0; f < F; f++) { const a = find(fp[f * 3]); for (let j = 1; j < 3; j++) { const b = find(fp[f * 3 + j]); if (a !== b) parent[b] = a; } }
  const comps = new Map(), v = new THREE.Vector3();
  for (let f = 0; f < F; f++) { const c = find(fp[f * 3]); let e = comps.get(c); if (!e) { e = { faces: [], box: new THREE.Box3() }; comps.set(c, e); } e.faces.push(f); for (let j = 0; j < 3; j++) e.box.expandByPoint(v.fromBufferAttribute(p, idx[f * 3 + j])); }
  const list = [...comps.values()].map(c => ({ ...c, size: c.box.getSize(new THREE.Vector3()).length() / D })).filter(c => c.size <= maxPart && comps.size > 1).sort((a, b) => a.size - b.size);
  const drop = new Uint8Array(F); let removed = 0;
  for (const c of list) { if (removed >= removeTriangles) break; for (const f of c.faces) drop[f] = 1; removed += c.faces.length; }
  if (!removed) return 0;
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: idx.length, materialIndex: 0 }], keep = [], newGroups = [];
  for (const g of groups) { const start = keep.length; for (let f = g.start / 3; f < (g.start + g.count) / 3; f++) if (!drop[f]) keep.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]); if (keep.length > start) newGroups.push({ start, count: keep.length - start, materialIndex: g.materialIndex }); }
  const used = [...new Set(keep)].sort((a, b) => a - b), map = new Map(used.map((x, i) => [x, i]));
  for (const [name, a] of Object.entries(geometry.attributes)) { const data = new a.array.constructor(used.length * a.itemSize); used.forEach((old, i) => data.set(a.array.subarray(old * a.itemSize, (old + 1) * a.itemSize), i * a.itemSize)); geometry.setAttribute(name, new THREE.BufferAttribute(data, a.itemSize, a.normalized)); }
  geometry.setIndex(keep.map(x => map.get(x))); geometry.clearGroups(); if (geometry.groups !== groups && newGroups.length > 1 || groups.length > 1) for (const g of newGroups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return removed;
}

/** Applies the smart LOD optimizer to every mesh under root. reduction = share of triangles to remove (0–0.95). */
export function optimizeLOD(root, { reduction = 0.5, keepUndo = false, cullDetails = false, ...options } = {}) {
  const before = startLOD(root, reduction), results = lodMeshes(root).map(mesh => [mesh, simplifyGeometry(mesh.geometry, { ...options, ratio: 1 - reduction })]);
  return finishLOD(results, { reduction, keepUndo, cullDetails, before, root });
}
/** Same result as optimizeLOD, but each mesh goes through `simplify(geometry, options)` → Promise (a worker pool), so the
 *  CPU work runs in parallel threads while the GPU keeps rendering the page. */
export async function optimizeLODAsync(root, { reduction = 0.5, keepUndo = false, cullDetails = false, ...options } = {}, simplify) {
  const before = startLOD(root, reduction), meshes = lodMeshes(root);
  const results = await Promise.all(meshes.map(async mesh => [mesh, await simplify(mesh.geometry, { ...options, ratio: 1 - reduction, cullDetails })]));
  return finishLOD(results, { reduction, keepUndo, cullDetails, before, root });
}
function startLOD(root, reduction) {
  if (!Number.isFinite(reduction) || reduction < 0 || reduction > 0.97) throw new Error('reduction must be 0–0.97');
  return auditTopology(root).total;
}
function lodMeshes(root) { const list = []; root.traverse(m => { if (m.isMesh && !m.userData.codexHighlightShell) list.push(m); }); return list; }
function finishLOD(results, { reduction, keepUndo, cullDetails, before, root }) {
  const staged = [], changes = [];
  try {
    for (const [mesh, r] of results) {
      if (!r || r.skipped) { changes.push({ name: mesh.name, skipped: r?.skipped ?? 'unsupported' }); continue; }
      // Far LODs: when edge collapse alone cannot reach the budget, drop the smallest detached parts.
      const target = Math.floor(r.trianglesBefore * (1 - reduction)), culled = r.culledTriangles ?? (cullDetails ? cullSmallParts(r.geometry, r.trianglesAfter - target) : 0);
      staged.push({ mesh, old: mesh.geometry, g: r.geometry });
      changes.push({ name: mesh.name, skinned: !!mesh.isSkinnedMesh, trianglesBefore: r.trianglesBefore, trianglesAfter: r.geometry.index.count / 3, culledTriangles: culled, relativeError: +r.relativeError.toFixed(5), hitErrorLimit: r.hitErrorLimit, lockedVertices: r.lockedVertices });
    }
    for (const s of staged) s.mesh.geometry = s.g;
    const after = auditTopology(root).total, maxError = Math.max(0, ...changes.map(c => c.relativeError ?? 0));
    const result = { reduction, cullDetails, before, after, maxError, achieved: before.triangles ? 1 - after.triangles / before.triangles : 0, changes,
      breakingPoint: reduction >= 0.75 || changes.some(c => c.hitErrorLimit && !c.culledTriangles) };
    let active = true;
    Object.defineProperties(result, {
      undo: { value: () => { if (!active) return; for (const s of staged) { s.mesh.geometry = s.old; s.g.dispose(); } active = false; } },
      commit: { value: () => { if (!active) return; new Set(staged.map(s => s.old)).forEach(g => g.dispose()); active = false; } },
    });
    if (!keepUndo) result.commit();
    return result;
  } catch (e) { staged.forEach(s => { if (s.mesh.geometry === s.g) s.mesh.geometry = s.old; s.g.dispose(); }); throw e; }
}

/** Plain-data form of a BufferGeometry for postMessage (arrays are copied; the source stays intact for undo). */
export function packGeometry(g) {
  const attributes = {}; for (const [name, a] of Object.entries(g.attributes)) attributes[name] = { array: a.array.slice(), itemSize: a.itemSize, normalized: a.normalized };
  return { attributes, index: g.index ? g.index.array.slice() : null, groups: g.groups.map(x => ({ ...x })), name: g.name };
}
export function unpackGeometry(d) {
  const g = new THREE.BufferGeometry(); g.name = d.name ?? '';
  for (const [name, a] of Object.entries(d.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
  if (d.index) g.setIndex(new THREE.BufferAttribute(d.index, 1)); for (const x of d.groups) g.addGroup(x.start, x.count, x.materialIndex);
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
export const transferables = d => [...Object.values(d.attributes).map(a => a.array.buffer), ...(d.index ? [d.index.buffer] : [])];

/** Standard LOD ladder (share of triangles kept). */
export const LOD_LEVELS = [{ name: 'LOD0', keep: 1, maxError: 0 }, { name: 'LOD1', keep: 0.5, maxError: 0.01 }, { name: 'LOD2', keep: 0.25, maxError: 0.025, cullDetails: true }, { name: 'LOD3', keep: 0.12, maxError: 0.05, cullDetails: true }];
