// High → low-poly baking (isomorphic: page, worker, Node). For every texel of the low-poly UV layout the low surface
// point is found, a ray is cast along the (cage-offset) normal into the high-poly mesh (three-mesh-bvh), and the hit
// gives: tangent-space normal (OpenGL), height/displacement (signed distance / cage), ambient occlusion (hemisphere rays
// on the high mesh), curvature (from the baked normals) and object-space position. Padding dilates islands so mips and
// bilinear filtering never pull in background. Output buffers use the Texture Studio format ({c, d}, row 0 = top).
//   bakeHighToLow({ high, low, size: 1024, cage: 0.02 (× low bbox diagonal), ao: 16, maps: [...], padding: 4, onProgress })
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const BAKE_MAPS = ['normal', 'ao', 'height', 'curvature', 'position'];

export function bakeHighToLow({ high, low, size = 512, cage = 0.02, ao = 16, aoDistance = 0.15, maps = BAKE_MAPS, padding = 4, onProgress } = {}) {
  if (!low.attributes.uv) throw new Error('Low-poly mesh needs UVs (run Auto UV first)');
  const lo = low.index ? low.clone() : low.clone(); if (!lo.attributes.normal) lo.computeVertexNormals(); if (!lo.attributes.tangent && lo.index) lo.computeTangents();
  const hi = high.index ? high : high.clone(); if (!hi.attributes.normal) hi.computeVertexNormals();
  const bvh = new MeshBVH(hi), diag = new THREE.Box3().setFromBufferAttribute(lo.attributes.position).getSize(new THREE.Vector3()).length(), cageD = cage * diag, aoD = aoDistance * diag;
  const S = size, N = S * S, filled = new Uint8Array(N), nrm = new Float32Array(N * 3), hgt = new Float32Array(N).fill(0.5), occ = new Float32Array(N).fill(1), posMap = new Float32Array(N * 3);
  const P = lo.attributes.position, NN = lo.attributes.normal, UV = lo.attributes.uv, TG = lo.attributes.tangent, idx = lo.index ? lo.index.array : Array.from({ length: P.count }, (_, i) => i);
  const box = new THREE.Box3().setFromBufferAttribute(P), bsize = box.getSize(new THREE.Vector3());
  const ray = new THREE.Ray(), tri = new THREE.Triangle(), bary = new THREE.Vector3(), hn = new THREE.Vector3(), tmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const hiN = hi.attributes.normal, hiP = hi.attributes.position, hiIdx = hi.index ? hi.index.array : null;
  const dirs = Array.from({ length: ao }, (_, i) => { const a = i * 2.399963, z = (i + 0.5) / ao, r = Math.sqrt(1 - z * z); return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z); });
  const hitNormal = hit => { const f = hit.faceIndex, a = hiIdx ? hiIdx[f * 3] : f * 3, b = hiIdx ? hiIdx[f * 3 + 1] : f * 3 + 1, c = hiIdx ? hiIdx[f * 3 + 2] : f * 3 + 2; tri.set(tmp[0].fromBufferAttribute(hiP, a), tmp[1].fromBufferAttribute(hiP, b), tmp[2].fromBufferAttribute(hiP, c)); tri.getBarycoord(hit.point, bary); return hn.set(0, 0, 0).addScaledVector(new THREE.Vector3().fromBufferAttribute(hiN, a), bary.x).addScaledVector(new THREE.Vector3().fromBufferAttribute(hiN, b), bary.y).addScaledVector(new THREE.Vector3().fromBufferAttribute(hiN, c), bary.z).normalize(); };
  const V = (attr, i, n = 3) => n === 3 ? new THREE.Vector3().fromBufferAttribute(attr, i) : new THREE.Vector4().fromBufferAttribute(attr, i);
  const T = idx.length / 3;
  for (let t = 0; t < T; t++) {
    const ii = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]], px = ii.map(i => [UV.getX(i) * S, (1 - UV.getY(i)) * S]), pp = ii.map(i => V(P, i)), nn = ii.map(i => V(NN, i)), tg = TG ? ii.map(i => V(TG, i, 4)) : null;
    const [a, b, c] = px, den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(S - 1, Math.ceil(Math.max(a[0], b[0], c[0]))), y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(S - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l1 = ((b[1] - c[1]) * (x + 0.5 - c[0]) + (c[0] - b[0]) * (y + 0.5 - c[1])) / den, l2 = ((c[1] - a[1]) * (x + 0.5 - c[0]) + (a[0] - c[0]) * (y + 0.5 - c[1])) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue; const k = y * S + x;
      const p = new THREE.Vector3().addScaledVector(pp[0], l1).addScaledVector(pp[1], l2).addScaledVector(pp[2], l3), n = new THREE.Vector3().addScaledVector(nn[0], l1).addScaledVector(nn[1], l2).addScaledVector(nn[2], l3).normalize();
      // cage: start outside the low surface, shoot inward; fall back to the outward direction
      ray.origin.copy(p).addScaledVector(n, cageD); ray.direction.copy(n).negate(); let hit = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (!hit || hit.distance > cageD * 2.5) { ray.origin.copy(p); ray.direction.copy(n); const h2 = bvh.raycastFirst(ray, THREE.DoubleSide); hit = h2 && h2.distance <= cageD * 1.5 ? h2 : hit && hit.distance <= cageD * 2.5 ? hit : null; }
      filled[k] = 1; posMap.set([(p.x - box.min.x) / (bsize.x || 1), (p.y - box.min.y) / (bsize.y || 1), (p.z - box.min.z) / (bsize.z || 1)], k * 3);
      if (!hit) { nrm.set([0.5, 0.5, 1], k * 3); continue; }
      const H = hitNormal(hit);
      let tv, bv; if (tg) { const t4 = new THREE.Vector4().addScaledVector(tg[0], l1).addScaledVector(tg[1], l2).addScaledVector(tg[2], l3); tv = new THREE.Vector3(t4.x, t4.y, t4.z); tv.addScaledVector(n, -tv.dot(n)).normalize(); bv = n.clone().cross(tv).multiplyScalar(t4.w < 0 ? -1 : 1); }
      else { tv = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0); bv = n.clone().cross(tv); }
      nrm.set([H.dot(tv) * 0.5 + 0.5, H.dot(bv) * 0.5 + 0.5, Math.max(0, H.dot(n)) * 0.5 + 0.5], k * 3);
      const signed = ray.direction.dot(n) < 0 ? cageD - hit.distance : hit.distance; hgt[k] = THREE.MathUtils.clamp(0.5 + signed / (cageD * 2), 0, 1);
      if (maps.includes('ao') && ao > 0) { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), H), o = hit.point.clone().addScaledVector(H, diag * 1e-4); let blocked = 0; for (const d of dirs) { ray.origin.copy(o); ray.direction.copy(d).applyQuaternion(q); const h = bvh.raycastFirst(ray, THREE.DoubleSide); if (h && h.distance < aoD) blocked += 1 - h.distance / aoD; } occ[k] = 1 - blocked / dirs.length; }
    }
    if (onProgress && t % 64 === 0) onProgress(t / T);
  }
  // curvature from the baked normal field (divergence of the tangent-space xy)
  const curv = new Float32Array(N).fill(0.5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x; if (!filled[k]) continue; const r = filled[y * S + Math.min(S - 1, x + 1)] ? y * S + Math.min(S - 1, x + 1) : k, l = filled[y * S + Math.max(0, x - 1)] ? y * S + Math.max(0, x - 1) : k, u = filled[Math.max(0, y - 1) * S + x] ? Math.max(0, y - 1) * S + x : k, d = filled[Math.min(S - 1, y + 1) * S + x] ? Math.min(S - 1, y + 1) * S + x : k;
    curv[k] = THREE.MathUtils.clamp(0.5 + ((nrm[r * 3] - nrm[l * 3]) + (nrm[u * 3 + 1] - nrm[d * 3 + 1])) * 2, 0, 1); }
  // padding / dilation
  const dilate = (arr, c) => { let mask = filled.slice(); for (let pass = 0; pass < padding; pass++) { const next = mask.slice(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x; if (mask[k]) continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= S || Y >= S) continue; const j = Y * S + X; if (mask[j]) { for (let ch = 0; ch < c; ch++) arr[k * c + ch] = arr[j * c + ch]; next[k] = 1; break; } } } mask = next; } for (let k = 0; k < N; k++) if (!mask[k] && c === 3 && arr === nrm) arr.set([0.5, 0.5, 1], k * 3); return arr; };
  const out = {};
  if (maps.includes('normal')) out.normal = { c: 3, d: dilate(nrm, 3) };
  if (maps.includes('ao')) out.ao = { c: 1, d: dilate(occ, 1) };
  if (maps.includes('height')) out.height = { c: 1, d: dilate(hgt, 1) };
  if (maps.includes('curvature')) out.curvature = { c: 1, d: dilate(curv, 1) };
  if (maps.includes('position')) out.position = { c: 3, d: dilate(posMap, 3) };
  let coverage = 0; for (const f of filled) coverage += f; out.stats = { size: S, coverage: +(coverage / N).toFixed(3), cage: +cageD.toFixed(4), highTriangles: (hi.index ? hi.index.count : hiP.count) / 3, lowTriangles: T };
  return out;
}
