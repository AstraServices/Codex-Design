import * as THREE from 'three';
import { weldExact, auditGeometry } from './topology.js';

// Topology quality: scores a triangle mesh against production rules (quad dominance, no n-gons, clean poles,
// even density, healthy triangles, ≥3 edge loops across each skinned joint) and fixes what can be fixed
// without changing the shape: cleanup, Delaunay edge flips on flat areas, and tangential relaxation that
// keeps every vertex on the original surface (attributes re-interpolated barycentrically).

function topologyOf(geometry) {
  const p = geometry.attributes.position, index = geometry.index, count = index ? index.count : p.count, at = i => (index ? index.getX(i) : i);
  geometry.computeBoundingBox(); const D = geometry.boundingBox.getSize(new THREE.Vector3()).length() || 1, eps = D * 1e-6;
  const pidMap = new Map(), pidOf = new Int32Array(p.count), pos = [];
  for (let i = 0; i < p.count; i++) { const k = `${Math.round(p.getX(i) / eps)},${Math.round(p.getY(i) / eps)},${Math.round(p.getZ(i) / eps)}`; let id = pidMap.get(k); if (id === undefined) { id = pos.length; pidMap.set(k, id); pos.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i))); } pidOf[i] = id; }
  const faces = [], normals = [], areas = [], gpu = [];
  for (let f = 0; f + 2 < count; f += 3) {
    const g = [at(f), at(f + 1), at(f + 2)], v = g.map(i => pidOf[i]); if (new Set(v).size < 3) continue;
    const n = pos[v[1]].clone().sub(pos[v[0]]).cross(pos[v[2]].clone().sub(pos[v[0]])), a = n.length() / 2; if (a < eps * eps) continue;
    faces.push(v); gpu.push(g); normals.push(n.normalize()); areas.push(a);
  }
  const edges = new Map(), key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  faces.forEach((v, f) => { for (let j = 0; j < 3; j++) { const k = key(v[j], v[(j + 1) % 3]); const e = edges.get(k); if (e) e.push(f); else edges.set(k, [f]); } });
  return { pos, pidOf, faces, gpu, normals, areas, edges, key, D };
}
const angleAt = (a, b, c) => { const u = b.clone().sub(a).normalize(), w = c.clone().sub(a).normalize(); return Math.acos(THREE.MathUtils.clamp(u.dot(w), -1, 1)); };

/** Greedy quad pairing: two triangles form a "virtual quad" when coplanar-ish, convex and near-rectangular. */
function pairQuads(t) {
  const cands = [];
  for (const [k, fs] of t.edges) {
    if (fs.length !== 2) continue; const [f1, f2] = fs; if (t.normals[f1].dot(t.normals[f2]) < Math.cos(THREE.MathUtils.degToRad(25))) continue;
    const [a, b] = k.split(',').map(Number), c = t.faces[f1].find(x => x !== a && x !== b), d = t.faces[f2].find(x => x !== a && x !== b);
    const P = t.pos, loop = [a, c, b, d].map(i => P[i]);
    let worst = 0; for (let i = 0; i < 4; i++) worst = Math.max(worst, Math.abs(angleAt(loop[i], loop[(i + 1) % 4], loop[(i + 3) % 4]) - Math.PI / 2));
    const n = t.normals[f1].clone().add(t.normals[f2]); const s1 = P[c].clone().sub(P[a]).cross(P[d].clone().sub(P[a])).dot(n), s2 = P[d].clone().sub(P[b]).cross(P[c].clone().sub(P[b])).dot(n);
    if (s1 >= 0 || s2 >= 0) { /* reflex quad */ }
    const score = 1 - worst / (Math.PI / 2); if (score > 0.4) cands.push({ score, f1, f2, k });
  }
  cands.sort((x, y) => y.score - x.score);
  const mate = new Int32Array(t.faces.length).fill(-1), edgeOf = new Map(), adj = Array.from({ length: t.faces.length }, () => []);
  for (const c of cands) { adj[c.f1].push(c.f2); adj[c.f2].push(c.f1); edgeOf.set(c.f1 < c.f2 ? c.f1 + ',' + c.f2 : c.f2 + ',' + c.f1, c.k); }
  for (const c of cands) if (mate[c.f1] < 0 && mate[c.f2] < 0) { mate[c.f1] = c.f2; mate[c.f2] = c.f1; }
  // Augmenting swaps: free u – v (matched to w) and w – free x  →  u–v, w–x (one more quad). Repeats until stable.
  for (let pass = 0, changed = 1; changed && pass < 8; pass++) {
    changed = 0;
    for (let u = 0; u < mate.length; u++) {
      if (mate[u] >= 0) continue;
      search: for (const v of adj[u]) { const w = mate[v]; if (w < 0) { mate[u] = v; mate[v] = u; changed++; break; } for (const x of adj[w]) if (x !== v && x !== u && mate[x] < 0) { mate[u] = v; mate[v] = u; mate[w] = x; mate[x] = w; changed++; break search; } }
    }
  }
  const used = new Uint8Array(t.faces.length), diagonals = new Set(); let pairs = 0;
  const matches = [];
  for (let f = 0; f < mate.length; f++) if (mate[f] > f) { used[f] = used[mate[f]] = 1; const k = edgeOf.get(f + ',' + mate[f]); diagonals.add(k); matches.push([f, mate[f], k]); pairs++; }
  return { pairs, used, diagonals, matches };
}

/** Topology report for one geometry. skin: {skinIndex, skinWeight, bones:[{name, position, parent}]} in geometry space. */
export function analyzeGeometryQuality(geometry, { skin = null, kind = null } = {}) {
  const t = topologyOf(geometry), F = t.faces.length; if (!F) return null;
  const audit = auditGeometry(geometry), quad = pairQuads(t), explicitQuads = geometry.userData?.quads?.length * 2 === F ? geometry.userData.quads.length : 0, quadRatio = explicitQuads ? 1 : (2 * quad.pairs) / F;
  // N-gons: flat fans of ≥3 triangles whose outline has ≥5 corners (cylinder caps, flat tops triangulated as stars).
  const seen = new Uint8Array(F); let ngons = 0, ngonFaces = 0;
  for (let f = 0; f < F; f++) {
    if (seen[f]) continue; const region = [f], stack = [f]; seen[f] = 1;
    while (stack.length) { const g = stack.pop(); for (let j = 0; j < 3; j++) for (const h of t.edges.get(t.key(t.faces[g][j], t.faces[g][(j + 1) % 3]))) if (!seen[h] && t.normals[h].dot(t.normals[f]) > 0.9995) { seen[h] = 1; region.push(h); stack.push(h); } }
    if (region.length < 3) continue;
    const count = new Map(); for (const g of region) for (let j = 0; j < 3; j++) { const k = t.key(t.faces[g][j], t.faces[g][(j + 1) % 3]); count.set(k, (count.get(k) ?? 0) + 1); }
    const rim = new Map(); for (const [k, c] of count) if (c === 1) { const [a, b] = k.split(',').map(Number); (rim.get(a) ?? rim.set(a, []).get(a)).push(b); (rim.get(b) ?? rim.set(b, []).get(b)).push(a); }
    // Real polygon corners: rim vertices where the outline turns (collinear points along a side do not count).
    let corners = 0; for (const [v, nb] of rim) { if (nb.length !== 2) { corners++; continue; } const u = t.pos[nb[0]].clone().sub(t.pos[v]).normalize(), w = t.pos[nb[1]].clone().sub(t.pos[v]).normalize(); if (u.dot(w) > -0.996) corners++; }
    const fan = new Map(); for (const g of region) for (const v of t.faces[g]) fan.set(v, (fan.get(v) ?? 0) + 1);
    const interior = [...fan.keys()].filter(v => !rim.has(v));
    // A triangulated polygon (no inner vertex) or a star cap (one hub vertex) with ≥5 real corners.
    // Quad strips/rings (every triangle pairs into a good quad) are clean topology, not n-gons.
    if (corners >= 5 && region.some(g => !quad.used[g]) && (interior.length === 0 || (interior.length === 1 && fan.get(interior[0]) >= 5))) { ngons++; ngonFaces += region.length; }
  }
  // Poles: valence in the virtual-quad graph (diagonals removed) for vertices fully surrounded by quads.
  const vfaces = new Map(); t.faces.forEach((v, f) => v.forEach(x => { const l = vfaces.get(x); if (l) l.push(f); else vfaces.set(x, [f]); }));
  const vedges = new Map(); for (const k of t.edges.keys()) { if (quad.diagonals.has(k)) continue; for (const v of k.split(',').map(Number)) vedges.set(v, (vedges.get(v) ?? 0) + 1); }
  const border = new Set(); for (const [k, fs] of t.edges) if (fs.length === 1) k.split(',').forEach(v => border.add(+v));
  let quadVerts = 0, nPoles = 0, ePoles = 0, highPoles = 0, deformPoles = 0; const poles = [];
  const pidSkin = skin ? new Map() : null; if (skin) for (let i = 0; i < t.pidOf.length; i++) if (!pidSkin.has(t.pidOf[i])) pidSkin.set(t.pidOf[i], i);
  const maxWeight = v => { const i = pidSkin.get(v); return Math.max(skin.skinWeight.getX(i), skin.skinWeight.getY(i), skin.skinWeight.getZ(i), skin.skinWeight.getW(i)); };
  for (const [v, fs] of vfaces) {
    if (border.has(v) || !fs.every(f => quad.used[f])) continue; quadVerts++;
    const val = vedges.get(v) ?? 0; if (val === 4) continue;
    if (val === 3) nPoles++; else if (val === 5) ePoles++; else highPoles++;
    const deform = skin && maxWeight(v) < 0.85; if (deform) deformPoles++; if (poles.length < 400) poles.push({ position: t.pos[v].toArray(), valence: val, deform: !!deform });
  }
  // Density: edge-length jumps at a vertex, and spread of edge lengths (log space).
  const lens = [], vmin = new Map(), vmax = new Map();
  for (const k of t.edges.keys()) { if (quad.diagonals.has(k)) continue; const [a, b] = k.split(',').map(Number), l = t.pos[a].distanceTo(t.pos[b]); lens.push(Math.log(l)); for (const v of [a, b]) { vmin.set(v, Math.min(vmin.get(v) ?? Infinity, l)); vmax.set(v, Math.max(vmax.get(v) ?? 0, l)); } }
  // Only smooth (crease-free) vertices count: long flat panels next to bevels are intended on hard surfaces.
  const creased = new Set(); for (const [k, fs] of t.edges) if (fs.length !== 2 || t.normals[fs[0]].dot(t.normals[fs[1]]) < Math.cos(THREE.MathUtils.degToRad(30))) k.split(',').forEach(v => creased.add(+v));
  let jumps = 0, smoothVerts = 0; for (const [v, mx] of vmax) { if (creased.has(v)) continue; smoothVerts++; if (mx / vmin.get(v) > 6) jumps++; }
  const mean = lens.reduce((s, x) => s + x, 0) / lens.length, spread = Math.sqrt(lens.reduce((s, x) => s + (x - mean) ** 2, 0) / lens.length);
  // Joint loops: rings of vertices in the blend zone between a bone and its parent, counted along the bone axis.
  const joints = [];
  if (skin) {
    const { skinIndex: si, skinWeight: sw, bones } = skin, zone = new Map(), medianEdge = Math.exp(lens.sort((a, b) => a - b)[lens.length >> 1]);
    for (const [v] of vfaces) {
      const i = pidSkin.get(v), inf = [0, 1, 2, 3].map(j => [si.getComponent(i, j), sw.getComponent(i, j)]).filter(([, w]) => w > 0.08).sort((a, b) => b[1] - a[1]);
      if (inf.length < 2) continue; const pair = [inf[0][0], inf[1][0]].sort((a, b) => a - b).join('-'); const l = zone.get(pair); if (l) l.push(v); else zone.set(pair, [v]);
    }
    for (const [pair, verts] of zone) {
      if (verts.length < 6) continue; const [i, j] = pair.split('-').map(Number), A = bones[i], B = bones[j]; if (!A || !B) continue;
      const child = B.parent === i ? B : A.parent === j ? A : null; if (!child) continue;
      const axis = child.position.clone().sub((child === B ? A : B).position); if (axis.lengthSq() < 1e-12) continue; axis.normalize();
      const proj = verts.map(v => t.pos[v].dot(axis)).sort((a, b) => a - b); let rings = 1; for (let k = 1; k < proj.length; k++) if (proj[k] - proj[k - 1] > medianEdge * 0.35) rings++;
      joints.push({ joint: child.name, loops: rings, vertices: verts.length, ok: rings >= 3 });
    }
  }
  // Scores (0–1) per criterion → weighted total.
  const skinny = audit.skinnyTriangles / F, clamp = x => THREE.MathUtils.clamp(x, 0, 1);
  const s = {
    quads: clamp(quadRatio / 0.85),
    ngons: clamp(1 - (ngonFaces / F) * 4),
    poles: quadVerts ? clamp(1 - ((nPoles + ePoles) * 0.5 + highPoles * 2 + deformPoles * 2) / quadVerts * 3) : 0.5,
    density: clamp(1 - (jumps / Math.max(1, smoothVerts)) * 6),
    triangles: clamp(1 - skinny * 5 - (audit.degenerateTriangles + audit.duplicateTriangles) / F * 20),
    manifold: audit.nonManifoldEdges || audit.windingEdges ? 0.3 : 1,
    joints: joints.length ? joints.filter(j => j.ok).length / joints.length : null,
  };
  // Weights depend on what the mesh is: quads dominate the score only where they matter (deforming/organic).
  const meshKind = kind ?? classifyGeometry(geometry, { skinned: !!skin }).kind, weights = SCORE_WEIGHTS[meshKind];
  let total = 0, wsum = 0; for (const [k, w] of Object.entries(weights)) if (s[k] !== null) { total += s[k] * w; wsum += w; }
  const score = Math.round(total / wsum * 100), grade = score >= 90 ? 'A' : score >= 78 ? 'B' : score >= 64 ? 'C' : score >= 50 ? 'D' : 'F';
  const tips = [];
  if (s.quads < 0.8 && meshKind !== 'hard-surface') tips.push(`Quad dominance ${(quadRatio * 100).toFixed(0)}%: author ring/grid flow (k.quadSurface, lathe/tube segments) instead of irregular triangulation.`);
  if (ngons) tips.push(`${ngons} n-gon fan(s) (${ngonFaces} tris): replace star-triangulated caps with ring loops or a quad grid cap.`);
  if (deformPoles) tips.push(`${deformPoles} pole(s) inside deformation zones: move 3/5-edge poles off joints to rigid areas.`);
  if (highPoles) tips.push(`${highPoles} high-valence pole(s) (6+ edges): redistribute edge flow.`);
  if (s.density < 0.8) tips.push(`${jumps} vertices with sudden density jumps (>6× edge length): even out ring spacing; keep dense loops only at joints/curvature.`);
  if (s.triangles < 0.9) tips.push('Thin or degenerate triangles: run Fix topology (flip + relax + cleanup).');
  for (const j of joints) if (!j.ok) tips.push(`Joint ${j.joint}: ${j.loops} edge loop(s) in the bend zone; add rings until ≥3 so it keeps volume when bent.`);
  if (audit.nonManifoldEdges) tips.push('Non-manifold edges: remove overlapping or duplicated faces.');
  return { kind: meshKind, triangles: F, quadRatio: +quadRatio.toFixed(3), quadPairs: quad.pairs, ngons, ngonFaces, poles: { n: nPoles, e: ePoles, high: highPoles, inDeformation: deformPoles, list: poles }, densityJumps: jumps, lengthSpread: +spread.toFixed(3), skinnyTriangles: audit.skinnyTriangles, nonManifoldEdges: audit.nonManifoldEdges, joints, scores: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === null ? null : +v.toFixed(2)])), score, grade, tips, diagonals: quad.diagonals };
}

function skinInfo(mesh) {
  if (!mesh.isSkinnedMesh || !mesh.geometry.attributes.skinIndex) return null;
  mesh.updateMatrixWorld(true); const toMesh = mesh.bindMatrixInverse, bones = mesh.skeleton.bones;
  return { skinIndex: mesh.geometry.attributes.skinIndex, skinWeight: mesh.geometry.attributes.skinWeight, bones: bones.map((b, i) => ({ name: b.name, parent: bones.indexOf(b.parent), position: new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()).applyMatrix4(toMesh) })) };
}
/** Bone data of a skinned mesh as plain arrays (postMessage-safe); skinFromData rebuilds skinInfo next to its geometry. */
export function skinData(mesh) { const s = skinInfo(mesh); return s && { bones: s.bones.map(b => ({ name: b.name, parent: b.parent, position: b.position.toArray() })) }; }
export function skinFromData(geometry, data) { return data && geometry.attributes.skinIndex ? { skinIndex: geometry.attributes.skinIndex, skinWeight: geometry.attributes.skinWeight, bones: data.bones.map(b => ({ ...b, position: new THREE.Vector3().fromArray(b.position) })) } : null; }
const qualityMeshes = root => { const list = []; root.traverse(m => { if (m.isMesh && !m.userData.codexHighlightShell) list.push(m); }); return list; };
/** Quality report for every mesh plus a triangle-weighted overall score. */
export function analyzeQuality(root) {
  return combineQuality(qualityMeshes(root).map(m => [m, analyzeGeometryQuality(m.geometry, { skin: skinInfo(m) })]));
}
/** Same report; `analyze(geometry, skinData)` → Promise runs each mesh elsewhere (worker pool). */
export async function analyzeQualityAsync(root, analyze) {
  const meshes = qualityMeshes(root);
  return combineQuality(await Promise.all(meshes.map(async m => [m, await analyze(m.geometry, skinData(m))])));
}
function combineQuality(results) {
  const meshes = [];
  for (const [m, r] of results) if (r) { delete r.diagonals; meshes.push({ name: m.name, skinned: !!m.isSkinnedMesh, ...r }); }
  const tris = meshes.reduce((s, m) => s + m.triangles, 0) || 1, avg = k => meshes.reduce((s, m) => s + (m.scores[k] ?? 0) * m.triangles, 0) / tris;
  const score = Math.round(meshes.reduce((s, m) => s + m.score * m.triangles, 0) / tris), grade = score >= 90 ? 'A' : score >= 78 ? 'B' : score >= 64 ? 'C' : score >= 50 ? 'D' : 'F';
  const criteria = Object.fromEntries(['quads', 'ngons', 'poles', 'density', 'triangles', 'manifold'].map(k => [k, +avg(k).toFixed(2)]));
  const jointList = meshes.flatMap(m => m.joints.map(j => ({ mesh: m.name, ...j })));
  if (jointList.length) criteria.joints = +(jointList.filter(j => j.ok).length / jointList.length).toFixed(2);
  const tips = [...new Set(meshes.sort((a, b) => b.triangles - a.triangles).flatMap(m => m.tips.map(t => `${m.name}: ${t}`)))].slice(0, 12);
  return { score, grade, criteria, totals: { triangles: tris, quadPairs: meshes.reduce((s, m) => s + m.quadPairs, 0), ngons: meshes.reduce((s, m) => s + m.ngons, 0), poles: meshes.reduce((s, m) => s + m.poles.n + m.poles.e + m.poles.high, 0), deformationPoles: meshes.reduce((s, m) => s + m.poles.inDeformation, 0), densityJumps: meshes.reduce((s, m) => s + m.densityJumps, 0) }, joints: jointList, tips, meshes: meshes.map(({ poles, ...m }) => ({ ...m, poles: { n: poles.n, e: poles.e, high: poles.high, inDeformation: poles.inDeformation } })) };
}

// ---------- Smart fixer ----------
/** Edge flips (Delaunay on near-flat areas) + tangential relaxation on flat regions. Shape-preserving. */
export function fixGeometry(source, { flips = true, relax = true, quadify = true, iterations = 3, strength = 0.5, flatAngle = 5 } = {}) {
  if (Object.keys(source.morphAttributes).length) return { skipped: 'morph targets' };
  const g = weldExact(source); if (!g) return { skipped: 'interleaved attributes' };
  const p = g.attributes.position, N = p.count, idx = Array.from(g.index.array), P = Array.from({ length: N }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
  g.computeBoundingBox(); const D = g.boundingBox.getSize(new THREE.Vector3()).length() || 1, eps = D * 1e-6;
  const pidCount = new Map(), pidKey = i => `${Math.round(P[i].x / eps)},${Math.round(P[i].y / eps)},${Math.round(P[i].z / eps)}`;
  for (let i = 0; i < N; i++) pidCount.set(pidKey(i), (pidCount.get(pidKey(i)) ?? 0) + 1);
  const seam = Uint8Array.from({ length: N }, (_, i) => (pidCount.get(pidKey(i)) > 1 ? 1 : 0));
  const faceGroup = new Int32Array(idx.length / 3); for (const gr of g.groups) for (let f = gr.start / 3; f < (gr.start + gr.count) / 3; f++) faceGroup[f] = gr.materialIndex;
  // Cleanup: degenerate / duplicate faces.
  let removed = 0; const seen = new Set(), keep = [];
  for (let f = 0; f < idx.length / 3; f++) {
    const v = idx.slice(f * 3, f * 3 + 3), n = P[v[1]].clone().sub(P[v[0]]).cross(P[v[2]].clone().sub(P[v[0]]));
    const k = [...v].sort((a, b) => a - b).join(','); if (new Set(v).size < 3 || n.lengthSq() < eps * eps * eps * eps || seen.has(k)) { removed++; continue; } seen.add(k); keep.push(f);
  }
  let faces = keep.map(f => idx.slice(f * 3, f * 3 + 3)), groupOf = keep.map(f => faceGroup[f]);
  const normal = f => P[f[1]].clone().sub(P[f[0]]).cross(P[f[2]].clone().sub(P[f[0]])).normalize();
  // Quad caps: flat triangle fans (cylinder/cone/lathe caps, discs) with 4k rim vertices become an inner k×k grid plus
  // one ring of quads: the n-gon pole disappears and every face pairs into a quad. Shape and rim stay identical.
  const extra = []; let quadCaps = 0;
  if (quadify) {
    // Work on welded positions (UV seams split rim vertices that sit at the same spot).
    const rep = new Map(), pid = new Int32Array(N); for (let i = 0; i < N; i++) { const k = pidKey(i); if (!rep.has(k)) rep.set(k, i); pid[i] = rep.get(k); }
    const vf = Array.from({ length: N }, () => []); faces.forEach((f, i) => f.forEach(v => vf[pid[v]].push(i)));
    const dead = new Uint8Array(faces.length), added = [], addedGroup = [];
    for (let c = 0; c < N; c++) {
      const fs = vf[c]; if (fs.length < 8 || fs.length % 4 || fs.some(i => dead[i])) continue;
      const n0 = normal(faces[fs[0]]); if (fs.some(i => normal(faces[i]).dot(n0) < Math.cos(THREE.MathUtils.degToRad(1)))) continue;
      const next = new Map(); for (const i of fs) { const f = faces[i].map(v => pid[v]), j = f.indexOf(c); next.set(f[(j + 1) % 3], f[(j + 2) % 3]); }
      if (next.size !== fs.length) continue;
      const f0 = faces[fs[0]].map(v => pid[v]), ring = [f0[(f0.indexOf(c) + 1) % 3]]; while (ring.length < fs.length) { const v = next.get(ring.at(-1)); if (v === undefined || v === ring[0]) break; ring.push(v); }
      if (ring.length !== fs.length || next.get(ring.at(-1)) !== ring[0]) continue;
      const n = ring.length, k = n / 4, C = P[c], fan = fs.map(i => faces[i]), group = groupOf[fs[0]];
      const vertexAt = q => { // new vertex at point q: attributes from the containing fan triangle (barycentric)
        let best = null, bd = Infinity; for (const f of fan) { const tri = new THREE.Triangle(P[f[0]], P[f[1]], P[f[2]]), cp = tri.closestPointToPoint(q, new THREE.Vector3()), d = cp.distanceToSquared(q); if (d < bd) { bd = d; best = { f, bc: tri.getBarycoord(cp, new THREE.Vector3()) }; } }
        const id = N + extra.length; extra.push({ q: q.clone(), f: best.f, bc: best.bc }); P.push(q.clone()); return id;
      };
      const Q = [0, k, 2 * k, 3 * k].map(t => C.clone().lerp(P[ring[t]], 0.5));
      const G = []; for (let j = 0; j <= k; j++) { G.push([]); for (let i = 0; i <= k; i++) { const a = Q[0].clone().lerp(Q[1], i / k), b = Q[3].clone().lerp(Q[2], i / k); G[j].push(vertexAt(a.lerp(b, j / k))); } }
      const B = []; for (let i = 0; i < k; i++) B.push(G[0][i]); for (let j = 0; j < k; j++) B.push(G[j][k]); for (let i = k; i > 0; i--) B.push(G[k][i]); for (let j = k; j > 0; j--) B.push(G[j][0]);
      const quad = (a, b, cc, d) => { let t1 = [a, b, cc], t2 = [a, cc, d]; const nn = new THREE.Vector3().subVectors(P[b], P[a]).cross(new THREE.Vector3().subVectors(P[cc], P[a])); if (nn.dot(n0) < 0) { t1 = [a, cc, b]; t2 = [a, d, cc]; } added.push(t1, t2); addedGroup.push(group, group); };
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) quad(G[j][i], G[j][i + 1], G[j + 1][i + 1], G[j + 1][i]);
      for (let t = 0; t < n; t++) quad(B[t], B[(t + 1) % n], ring[(t + 1) % n], ring[t]);
      fs.forEach(i => { dead[i] = 1; }); quadCaps++;
    }
    if (quadCaps) { const keepF = faces.map((_, i) => i).filter(i => !dead[i]); groupOf = [...keepF.map(i => groupOf[i]), ...addedGroup]; faces = [...keepF.map(i => faces[i]), ...added]; }
  }
  if (extra.length) { // grow every attribute by the new cap vertices (barycentric from their fan triangle)
    const total = N + extra.length;
    for (const [name, at] of Object.entries(g.attributes)) {
      const arr = new at.array.constructor(total * at.itemSize); arr.set(at.array);
      for (let e = 0; e < extra.length; e++) { const { f, bc } = extra[e], w = [bc.x, bc.y, bc.z], o = (N + e) * at.itemSize;
        if (name === 'position') { arr[o] = extra[e].q.x; arr[o + 1] = extra[e].q.y; arr[o + 2] = extra[e].q.z; continue; }
        if (name === 'skinIndex') { for (let c = 0; c < at.itemSize; c++) arr[o + c] = at.getComponent(f[w.indexOf(Math.max(...w))], c); continue; }
        if (name === 'skinWeight') { for (let c = 0; c < at.itemSize; c++) arr[o + c] = at.getComponent(f[w.indexOf(Math.max(...w))], c); continue; }
        for (let c = 0; c < at.itemSize; c++) arr[o + c] = at.getComponent(f[0], c) * w[0] + at.getComponent(f[1], c) * w[1] + at.getComponent(f[2], c) * w[2];
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
    }
  }
  const NN = P.length; let flipped = 0;
  if (flips) for (let pass = 0; pass < 6; pass++) {
    const em = new Map(), key = (a, b) => (a < b ? a * NN + b : b * NN + a), val = new Int32Array(NN);
    faces.forEach((f, i) => { for (let j = 0; j < 3; j++) { const k = key(f[j], f[(j + 1) % 3]); const l = em.get(k); if (l) l.push(i); else em.set(k, [i]); } });
    for (const k of em.keys()) { val[Math.floor(k / NN)]++; val[k % NN]++; }
    let changed = 0; const touched = new Uint8Array(faces.length);
    for (const [k, fs] of em) {
      if (fs.length !== 2 || touched[fs[0]] || touched[fs[1]] || groupOf[fs[0]] !== groupOf[fs[1]]) continue;
      const [i1, i2] = fs, f1 = faces[i1], f2 = faces[i2], a = Math.floor(k / NN), b = k % NN;
      if (normal(f1).dot(normal(f2)) < Math.cos(THREE.MathUtils.degToRad(1))) continue; // only flat pairs: flipping cannot change the shape
      const c = f1.find(x => x !== a && x !== b), d = f2.find(x => x !== a && x !== b); if (em.has(key(c, d)) || val[a] <= 3 || val[b] <= 3) continue;
      // Delaunay: flip when the opposite angles sum past 180°, or when valence evens out toward 6.
      const sumOpp = angleAt(P[c], P[a], P[b]) + angleAt(P[d], P[a], P[b]);
      const devBefore = [a, b, c, d].reduce((s, v, i) => s + Math.abs(val[v] - 6), 0), devAfter = Math.abs(val[a] - 1 - 6) + Math.abs(val[b] - 1 - 6) + Math.abs(val[c] + 1 - 6) + Math.abs(val[d] + 1 - 6);
      // Quad-aware: valence-6 balancing is a triangle-mesh goal and destroys quad flow, so only true Delaunay flips
      // (opposite angles > 180°, i.e. sliver pairs) are made, and never on pairs that already form a good quad.
      void devBefore; void devAfter;
      if (!(sumOpp > Math.PI + 0.05)) continue;
      { const loop = [a, c, b, d].map(i => P[i]); let worst = 0; for (let q = 0; q < 4; q++) worst = Math.max(worst, Math.abs(angleAt(loop[q], loop[(q + 1) % 4], loop[(q + 3) % 4]) - Math.PI / 2)); if (worst < Math.PI / 4) continue; }
      // Keep winding: f1 = (a,b,c) order in its loop; rebuild as (c, a, d) and (d, b, c) matching f1 orientation.
      const ia = f1.indexOf(a), ib = f1.indexOf(b), forward = (ia + 1) % 3 === ib;
      const n1 = forward ? [c, a, d] : [c, d, a], n2 = forward ? [d, b, c] : [d, c, b];
      if (normal(n1).dot(normal(f1)) < 0.9 || normal(n2).dot(normal(f1)) < 0.9) continue;
      faces[i1] = n1; faces[i2] = n2; touched[i1] = touched[i2] = 1; val[a]--; val[b]--; val[c]++; val[d]++; changed++;
    }
    flipped += changed; if (!changed) break;
  }
  // Tangential relaxation on flat, interior, seamless vertices; re-project onto the original one-ring.
  let relaxed = 0;
  const attrs = Object.entries(g.attributes).filter(([n]) => n !== 'position');
  if (relax) for (let it = 0; it < iterations; it++) {
    const vf = Array.from({ length: NN }, () => []); faces.forEach((f, i) => f.forEach(v => vf[v].push(i)));
    const em = new Map(), key = (a, b) => (a < b ? a * NN + b : b * NN + a); faces.forEach((f, i) => { for (let j = 0; j < 3; j++) { const k = key(f[j], f[(j + 1) % 3]); em.set(k, (em.get(k) ?? 0) + 1); } });
    const moves = [];
    for (let v = 0; v < NN; v++) {
      const fs = vf[v]; if (seam[v] || fs.length < 3) continue;
      const ring = new Set(); fs.forEach(i => faces[i].forEach(x => x !== v && ring.add(x)));
      if ([...ring].some(x => em.get(key(v, x)) !== 2)) continue; // border / non-manifold
      const ns = fs.map(i => normal(faces[i])), vn = ns.reduce((s, n) => s.add(n), new THREE.Vector3()).normalize();
      if (ns.some(n => n.dot(vn) < Math.cos(THREE.MathUtils.degToRad(flatAngle)))) continue; // only flat regions: curvature and creases stay exact
      const centroid = new THREE.Vector3(); let wsum = 0;
      for (const i of fs) { const f = faces[i], a = P[f[1]].clone().sub(P[f[0]]).cross(P[f[2]].clone().sub(P[f[0]])).length(); centroid.addScaledVector(P[f[0]].clone().add(P[f[1]]).add(P[f[2]]).divideScalar(3), a); wsum += a; }
      centroid.divideScalar(wsum); const delta = centroid.sub(P[v]); delta.addScaledVector(vn, -delta.dot(vn)); if (delta.lengthSq() < eps * eps) continue;
      const target = P[v].clone().addScaledVector(delta, strength);
      for (const i of fs) { // find the one-ring triangle containing the target → barycentric attributes
        const f = faces[i], tri = new THREE.Triangle(P[f[0]], P[f[1]], P[f[2]]), q = tri.closestPointToPoint(target, new THREE.Vector3());
        if (q.distanceToSquared(target) > (D * 1e-4) ** 2) continue; const bc = tri.getBarycoord(q, new THREE.Vector3()); if (!bc || Math.min(bc.x, bc.y, bc.z) < -1e-6) continue;
        moves.push({ v, q, f, bc }); break;
      }
    }
    for (const { v, q, f, bc } of moves) {
      P[v].copy(q);
      for (const [name, at] of attrs) {
        if (name === 'skinIndex') continue;
        if (name === 'skinWeight') { // blend influences of the three corners, keep top 4
          const si = g.attributes.skinIndex, m = new Map(); f.forEach((x, j) => { const w = [bc.x, bc.y, bc.z][j]; for (let c = 0; c < 4; c++) m.set(si.getComponent(x, c), (m.get(si.getComponent(x, c)) ?? 0) + at.getComponent(x, c) * w); });
          const top = [...m].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0) || 1;
          for (let c = 0; c < 4; c++) { si.setComponent(v, c, top[c]?.[0] ?? 0); at.setComponent(v, c, (top[c]?.[1] ?? 0) / sum); } continue;
        }
        for (let c = 0; c < at.itemSize; c++) at.setComponent(v, c, at.getComponent(f[0], c) * bc.x + at.getComponent(f[1], c) * bc.y + at.getComponent(f[2], c) * bc.z);
        if (name === 'normal') { const n = new THREE.Vector3(at.getX(v), at.getY(v), at.getZ(v)).normalize(); at.setXYZ(v, n.x, n.y, n.z); }
      }
      relaxed++;
    }
    if (!moves.length) break;
  }
  for (let i = 0; i < NN; i++) g.attributes.position.setXYZ(i, P[i].x, P[i].y, P[i].z);
  const order = faces.map((f, i) => i).sort((a, b) => groupOf[a] - groupOf[b] || a - b);
  g.setIndex(order.flatMap(i => faces[i])); g.clearGroups();
  if (source.groups.length) { let start = 0; for (let i = 1; i <= order.length; i++) if (i === order.length || groupOf[order[i]] !== groupOf[order[i - 1]]) { g.addGroup(start * 3, (i - start) * 3, groupOf[order[start]]); start = i; } }
  g.computeBoundingBox(); g.computeBoundingSphere(); g.userData = { ...source.userData }; delete g.userData.quads; // indices changed
  return { geometry: g, removed, flipped, relaxed, quadCaps };
}
/** Applies fixGeometry to all meshes with undo/commit like the optimizers. Returns before/after quality. */
export function fixTopology(root, { keepUndo = false, ...options } = {}) {
  const before = analyzeQuality(root), staged = [], changes = [];
  root.traverse(m => { if (!m.isMesh || m.userData.codexHighlightShell) return; const r = fixGeometry(m.geometry, options); if (r.skipped) { changes.push({ name: m.name, skipped: r.skipped }); return; } staged.push({ mesh: m, old: m.geometry, g: r.geometry }); changes.push({ name: m.name, removed: r.removed, flipped: r.flipped, relaxed: r.relaxed }); });
  for (const s of staged) s.mesh.geometry = s.g;
  const result = { before: { score: before.score, grade: before.grade }, after: analyzeQuality(root), changes };
  let active = true;
  Object.defineProperties(result, {
    undo: { value: () => { if (!active) return; for (const s of staged) { s.mesh.geometry = s.old; s.g.dispose(); } active = false; } },
    commit: { value: () => { if (!active) return; new Set(staged.map(s => s.old)).forEach(g => g.dispose()); active = false; } },
  });
  if (!keepUndo) result.commit(); return result;
}

/** Overlay: virtual-quad wireframe (diagonals hidden) + pole markers (blue N-pole, orange E-pole, red 6+, magenta in a joint). */
export function createQuadOverlay(root) {
  const group = new THREE.Group(), items = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.codexHighlightShell) return;
    const g = mesh.geometry, t = topologyOf(g), quad = pairQuads(t), report = analyzeGeometryQuality(g, { skin: skinInfo(mesh) });
    const rep = new Map(); for (let i = 0; i < t.pidOf.length; i++) if (!rep.has(t.pidOf[i])) rep.set(t.pidOf[i], i);
    const lines = []; for (const k of t.edges.keys()) if (!quad.diagonals.has(k)) lines.push(k.split(',').map(v => rep.get(+v)));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(lines.length * 6), 3));
    const seg = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#10261a', transparent: true, opacity: 0.85, depthTest: true })); seg.renderOrder = 9; group.add(seg);
    const pts = report.poles.list, colors = pts.map(p => new THREE.Color(p.deform ? '#ff3df2' : p.valence === 3 ? '#3fa7ff' : p.valence === 5 ? '#ff9a2e' : '#ff3b3b'));
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(Math.max(1, pts.length) * 3), 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute(colors.flatMap(c => c.toArray()).concat(pts.length ? [] : [0, 0, 0]), 3));
    const points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false })); points.renderOrder = 11; points.visible = pts.length > 0; group.add(points);
    const poleVerts = pts.map(p => { let best = 0, bd = Infinity; const v = new THREE.Vector3(...p.position); for (const [, i] of rep) { const d = v.distanceToSquared(new THREE.Vector3().fromBufferAttribute(g.attributes.position, i)); if (d < bd) { bd = d; best = i; } if (bd === 0) break; } return best; });
    items.push({ mesh, geometry: g, lines, lg, poleVerts, pg });
  });
  const v = new THREE.Vector3();
  group.userData.update = () => { for (const { mesh, geometry, lines, lg, poleVerts, pg } of items) { if (mesh.geometry !== geometry) continue; // stale while geometry is swapped (LOD preview/export)
    mesh.skeleton?.update(); const a = lg.attributes.position; lines.forEach((e, i) => e.forEach((x, j) => { mesh.getVertexPosition(x, v).applyMatrix4(mesh.matrixWorld); a.setXYZ(i * 2 + j, v.x, v.y, v.z); })); a.needsUpdate = true; const b = pg.attributes.position; poleVerts.forEach((x, i) => { mesh.getVertexPosition(x, v).applyMatrix4(mesh.matrixWorld); b.setXYZ(i, v.x, v.y, v.z); }); b.needsUpdate = true; } };
  group.userData.dispose = () => group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  group.userData.update(); return group;
}

// ---------- Smart (context-aware) topology ----------
// Quads matter where a mesh deforms, gets subdivided or is handed to a modeler; triangles are fine (and standard) on
// static hard-surface props and in game-final / print meshes. So the smart pass classifies each mesh and acts on that,
// instead of turning every triangle into quads.
/** 'deforming' (skinned/morphs) | 'hard-surface' (many sharp creases) | 'organic' (smooth curved). */
export function classifyGeometry(geometry, { skinned = false } = {}) {
  if (skinned || Object.keys(geometry.morphAttributes ?? {}).length) return { kind: 'deforming', hardEdgeRatio: null };
  const t = topologyOf(geometry); let edges = 0, hard = 0;
  for (const fs of t.edges.values()) if (fs.length === 2) { edges++; if (t.normals[fs[0]].dot(t.normals[fs[1]]) < Math.cos(THREE.MathUtils.degToRad(30))) hard++; }
  const ratio = edges ? hard / edges : 0, flat = edges ? [...t.edges.values()].filter(fs => fs.length === 2 && t.normals[fs[0]].dot(t.normals[fs[1]]) > 0.9999).length / edges : 0;
  return { kind: ratio > 0.18 || flat > 0.55 ? 'hard-surface' : 'organic', hardEdgeRatio: +ratio.toFixed(3), flatRatio: +flat.toFixed(3) };
}
export const SCORE_WEIGHTS = {
  deforming: { quads: 22, ngons: 10, poles: 13, density: 15, triangles: 15, manifold: 10, joints: 15 },
  organic: { quads: 18, ngons: 10, poles: 10, density: 15, triangles: 17, manifold: 10, joints: 15 },
  'hard-surface': { quads: 6, ngons: 6, poles: 4, density: 10, triangles: 30, manifold: 20, joints: 15 },
};
/** Per-intent plan for a mesh kind. */
export function topologyPlan(kind, intent = 'auto') {
  if (intent === 'print' || intent === 'game') return { quadify: false, flips: true, relax: false, allQuads: false, reason: `${intent}: final triangles are standard; only slivers/degenerates are fixed, shape untouched` };
  if (intent === 'subdivision') return { quadify: true, flips: true, relax: true, allQuads: true, reason: 'subdivision: every face must be a quad → pair, quad caps, then one linear quad split of the rest (shape unchanged)' };
  if (intent === 'animation' || kind === 'deforming') return { quadify: true, flips: true, relax: true, allQuads: false, reason: 'deforms: quad flow and clean loops matter → quad caps, quad-aware flips, relax flat areas' };
  if (kind === 'organic') return { quadify: true, flips: true, relax: true, allQuads: false, reason: 'organic static: quad caps and relaxation improve flow at no shape cost' };
  return { quadify: false, flips: true, relax: false, allQuads: false, reason: 'hard-surface static prop: triangles are fine here; no extra geometry, only slivers/degenerates fixed' };
}
/** Linear quad split: each paired quad → 4 quads, each leftover triangle → 3 quads. Shared edge midpoints → no T-junctions;
 *  new points lie on the original faces, so the shape is identical. Skin weights blend (top 4). */
export function linearQuadSplit(geometry) {
  const g = geometry.index ? geometry : weldExact(geometry); if (!g?.index) return null;
  const { faces: F } = quadFaces(g), attrs = Object.entries(g.attributes), N = g.attributes.position.count, extra = [], mids = new Map();
  const add = (corners, weights) => { extra.push({ corners, weights }); return N + extra.length - 1; };
  const mid = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!mids.has(k)) mids.set(k, add([a, b], [0.5, 0.5])); return mids.get(k); };
  const out = [];
  for (const f of F) {
    const n = f.length, c = add(f, f.map(() => 1 / n)), m = f.map((v, i) => mid(v, f[(i + 1) % n]));
    for (let i = 0; i < n; i++) out.push([f[i], m[i], c, m[(i + n - 1) % n]]);
  }
  const total = N + extra.length, res = new THREE.BufferGeometry();
  for (const [name, at] of attrs) {
    const arr = new at.array.constructor(total * at.itemSize); arr.set(at.array);
    extra.forEach((e, j) => { const o = (N + j) * at.itemSize;
      if (name === 'skinIndex' || name === 'skinWeight') { const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, m = new Map(); e.corners.forEach((v, i) => { for (let c = 0; c < 4; c++) m.set(si.getComponent(v, c), (m.get(si.getComponent(v, c)) ?? 0) + sw.getComponent(v, c) * e.weights[i]); }); const top = [...m].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0) || 1; for (let c = 0; c < 4; c++) arr[o + c] = name === 'skinIndex' ? top[c]?.[0] ?? 0 : (top[c]?.[1] ?? 0) / sum; return; }
      for (let c = 0; c < at.itemSize; c++) arr[o + c] = e.corners.reduce((s, v, i) => s + at.getComponent(v, c) * e.weights[i], 0);
    });
    res.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
  }
  res.setIndex(out.flatMap(q => [q[0], q[1], q[2], q[0], q[2], q[3]])); if (res.attributes.normal) { const nn = res.attributes.normal; for (let i = N; i < total; i++) { const v = new THREE.Vector3(nn.getX(i), nn.getY(i), nn.getZ(i)).normalize(); nn.setXYZ(i, v.x, v.y, v.z); } }
  res.userData = { ...geometry.userData, quads: out }; res.computeBoundingBox(); res.computeBoundingSphere(); return res;
}
/** Quads and leftover triangles of a mesh as polygons of GPU vertex indices (winding kept). Used by OBJ export and the split. */
export function quadFaces(geometry) {
  // Explicit quads (from linearQuadSplit or authored) win over geometric pairing.
  const explicit = geometry.userData?.quads, triCount = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  if (explicit?.length && explicit.length * 2 === triCount) return { faces: explicit.map(q => [...q]), quads: explicit.length, triangles: 0 };
  const t = topologyOf(geometry), quad = pairQuads(t), done = new Uint8Array(t.faces.length), faces = [];
  for (const [f1, f2, k] of quad.matches) {
    const [a, b] = k.split(',').map(Number), g1 = t.gpu[f1], p1 = t.faces[f1], i = p1.findIndex((v, j) => (v === a && p1[(j + 1) % 3] === b) || (v === b && p1[(j + 1) % 3] === a));
    const A = g1[i], B = g1[(i + 1) % 3], C = g1[(i + 2) % 3], pd = t.faces[f2].find(v => v !== a && v !== b), D = t.gpu[f2][t.faces[f2].indexOf(pd)];
    faces.push([A, D, B, C]); done[f1] = done[f2] = 1;
  }
  t.faces.forEach((_, f) => { if (!done[f]) faces.push([...t.gpu[f]]); });
  return { faces, quads: quad.matches.length, triangles: t.faces.length - quad.matches.length * 2 };
}
/** Smart topology over a scene: classify each mesh, apply the plan for `intent`, report what was done and why. */
export function smartTopology(root, { intent = 'auto', keepUndo = false } = {}) {
  const before = analyzeQuality(root), staged = [], report = [];
  root.traverse(m => {
    if (!m.isMesh || m.userData.codexHighlightShell) return;
    const { kind } = classifyGeometry(m.geometry, { skinned: m.isSkinnedMesh }), plan = topologyPlan(kind, intent);
    const r = fixGeometry(m.geometry, plan); if (r.skipped) { report.push({ name: m.name, kind, skipped: r.skipped }); return; }
    let g = r.geometry, split = null; if (plan.allQuads) { split = linearQuadSplit(g); if (split) { g.dispose(); g = split; } }
    staged.push({ mesh: m, old: m.geometry, g });
    report.push({ name: m.name, kind, intent, reason: plan.reason, actions: { quadCaps: r.quadCaps ?? 0, flips: r.flipped, relaxed: r.relaxed, removed: r.removed, allQuads: !!split }, triangles: [(m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, g.index.count / 3] });
  });
  for (const s of staged) s.mesh.geometry = s.g;
  const result = { intent, before: { score: before.score, grade: before.grade }, after: analyzeQuality(root), meshes: report };
  let active = true;
  Object.defineProperties(result, {
    undo: { value: () => { if (!active) return; for (const s of staged) { s.mesh.geometry = s.old; s.g.dispose(); } active = false; } },
    commit: { value: () => { if (!active) return; new Set(staged.map(s => s.old)).forEach(g => g.dispose()); active = false; } },
  });
  if (!keepUndo) result.commit(); return result;
}
