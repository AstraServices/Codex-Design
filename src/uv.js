// Automatic UV unwrapping ("smart UV project") + UV quality stats. Isomorphic (Three.js BufferGeometry, no DOM).
//   smartUV(geometry, {angle: 66, margin: 0.004, rotate: true}) → new geometry (vertices split at chart seams, every
//   original attribute kept: position, normal, skinIndex/skinWeight, color…) with uv (and uv1 copy) in 0–1.
//   Charts grow across edges while the face normal stays within `angle` of the chart normal, each chart is projected on
//   its average plane, aligned by PCA, then shelf-packed with ONE scale for all charts → uniform texel density.
//   uvStats(geometry) → {islands, overlap, stretch, utilization, texelDensity, flipped}.
import * as THREE from 'three';

export function smartUV(input, { angle = 66, margin = 0.004, rotate = true } = {}) {
  const src = input.index ? input.toNonIndexed() : input.clone(), pos = src.attributes.position, T = pos.count / 3;
  const P = i => new THREE.Vector3().fromBufferAttribute(pos, i), normals = [], areas = new Float32Array(T);
  for (let t = 0; t < T; t++) { const a = P(t * 3), b = P(t * 3 + 1), c = P(t * 3 + 2), n = b.clone().sub(a).cross(c.clone().sub(a)); areas[t] = n.length() / 2; normals.push(areas[t] > 1e-12 ? n.normalize() : new THREE.Vector3(0, 1, 0)); }
  // edge adjacency through welded positions
  const key = i => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`, vid = new Map(), corner = new Int32Array(T * 3);
  for (let i = 0; i < T * 3; i++) { const k = key(i); if (!vid.has(k)) vid.set(k, vid.size); corner[i] = vid.get(k); }
  const edges = new Map(), adj = Array.from({ length: T }, () => []);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) { const a = corner[t * 3 + e], b = corner[t * 3 + (e + 1) % 3], k = a < b ? `${a}_${b}` : `${b}_${a}`; const o = edges.get(k); if (o !== undefined) { adj[t].push(o); adj[o].push(t); } else edges.set(k, t); }
  // chart growing (largest faces seed first) inside a face subset
  const chart = new Int32Array(T).fill(-1), order = [...areas.keys()].sort((a, b) => areas[b] - areas[a]);
  const grow = (subset, cosLimit, charts) => {
    const allowed = subset ? new Set(subset) : null;
    for (const seed of order) {
      if ((allowed && !allowed.has(seed)) || chart[seed] >= 0) continue; const id = charts.length, faces = [seed], nrm = normals[seed].clone().multiplyScalar(areas[seed] + 1e-9); chart[seed] = id;
      for (let q = 0; q < faces.length; q++) for (const nb of adj[faces[q]]) { if (chart[nb] >= 0 || (allowed && !allowed.has(nb))) continue; if (normals[nb].dot(nrm.clone().normalize()) >= cosLimit) { chart[nb] = id; faces.push(nb); nrm.addScaledVector(normals[nb], areas[nb] + 1e-9); } }
      charts.push({ faces, normal: nrm.normalize(), angle: Math.acos(cosLimit) });
    }
  };
  const project = c => {
    const n = c.normal, t0 = Math.abs(n.y) < 0.99 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize(), b0 = n.clone().cross(t0);
    const pts = []; for (const f of c.faces) for (let k = 0; k < 3; k++) { const p = P(f * 3 + k); pts.push([p.dot(t0), p.dot(b0)]); }
    let ang = 0; if (rotate && pts.length > 3) { let mx = 0, my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= pts.length; my /= pts.length; let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); } ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); }
    const ca = Math.cos(-ang), sa = Math.sin(-ang); let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rot = pts.map(([x, y]) => { const X = x * ca - y * sa, Y = x * sa + y * ca; minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y); return [X, Y]; });
    c.w = Math.max(1e-6, maxX - minX); c.h = Math.max(1e-6, maxY - minY);
    if (c.w < c.h) { for (const p of rot) { const x = p[0]; p[0] = maxY - p[1]; p[1] = x - minX; } [c.w, c.h] = [c.h, c.w]; } else for (const p of rot) { p[0] -= minX; p[1] -= minY; }
    let flipped = 0; for (let i = 0; i < c.faces.length; i++) { const [a, b, d] = [rot[i * 3], rot[i * 3 + 1], rot[i * 3 + 2]]; if ((b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1]) < 0) flipped++; }
    if (flipped > c.faces.length / 2) for (const p of rot) p[0] = c.w - p[0];
    c.pts = rot; c.flipped = Math.min(flipped, c.faces.length - flipped);
  };
  // a chart overlaps itself when its projection folds: flipped faces or texels covered twice
  const folds = c => { if (c.flipped) return true; const R = 96, g = new Uint8Array(R * R), k = R / Math.max(c.w, c.h);
    for (let i = 0; i < c.faces.length; i++) { const xs = [0, 1, 2].map(j => c.pts[i * 3 + j][0] * k), ys = [0, 1, 2].map(j => c.pts[i * 3 + j][1] * k), den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]); if (Math.abs(den) < 1e-9) continue;
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(R - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(R - 1, Math.ceil(Math.max(...xs))); x++) { const l1 = ((ys[1] - ys[2]) * (x + 0.5 - xs[2]) + (xs[2] - xs[1]) * (y + 0.5 - ys[2])) / den, l2 = ((ys[2] - ys[0]) * (x + 0.5 - xs[2]) + (xs[0] - xs[2]) * (y + 0.5 - ys[2])) / den; if (l1 > 0.05 && l2 > 0.05 && 1 - l1 - l2 > 0.05 && g[y * R + x]++) return true; } }
    return false; };
  let charts = []; grow(null, Math.cos(THREE.MathUtils.degToRad(angle)), charts); charts.forEach(project);
  for (let pass = 0; pass < 5; pass++) { // split folding charts with a tighter angle until they lie flat
    const bad = charts.filter(c => c.faces.length > 1 && folds(c)); if (!bad.length) break;
    const keep = charts.filter(c => !bad.includes(c)); for (const c of bad) for (const f of c.faces) chart[f] = -1;
    const fresh = []; for (const c of bad) grow(c.faces, Math.cos(Math.max(THREE.MathUtils.degToRad(8), c.angle * 0.55)), fresh); fresh.forEach(project);
    charts = [...keep, ...fresh]; charts.forEach((c, i) => { for (const f of c.faces) chart[f] = i; });
  }
  const uv2 = new Float32Array(T * 6);
  // shelf packing with one global scale (uniform texel density); several shelf widths, keep the tightest square
  const total = charts.reduce((s, c) => s + c.w * c.h, 0), sorted = [...charts].sort((a, b) => b.h - a.h); let best = null;
  for (const f of [0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.5]) {
    const side = Math.sqrt(total) * f, gap = margin * Math.sqrt(total / 0.72), place = []; let x = gap, y = gap, shelf = 0, width = 0;
    for (const c of sorted) { if (x + c.w + gap > side && x > gap) { x = gap; y += shelf + gap; shelf = 0; } place.push([c, x, y]); x += c.w + gap; shelf = Math.max(shelf, c.h); width = Math.max(width, x); }
    const extent = Math.max(width, y + shelf + gap); if (!best || extent < best.extent) best = { extent, place };
  }
  for (const [c, x, y] of best.place) { c.ox = x; c.oy = y; }
  const scale = 1 / best.extent;
  for (const c of charts) c.faces.forEach((f, i) => { for (let k = 0; k < 3; k++) { const p = c.pts[i * 3 + k]; uv2[(f * 3 + k) * 2] = (p[0] + c.ox) * scale; uv2[(f * 3 + k) * 2 + 1] = (p[1] + c.oy) * scale; } });
  // rebuild indexed geometry: corners weld only inside the same chart (seams split)
  const out = new THREE.BufferGeometry(), names = Object.keys(src.attributes).filter(n => n !== 'uv' && n !== 'uv1'), map = new Map(), idx = [], data = Object.fromEntries(names.map(n => [n, []])), uvs = [];
  for (let i = 0; i < T * 3; i++) { const t = Math.floor(i / 3), k = `${chart[t]}|${corner[i]}`; let v = map.get(k); if (v === undefined) { v = map.size; map.set(k, v); for (const n of names) { const a = src.attributes[n]; for (let c = 0; c < a.itemSize; c++) data[n].push(a.array[i * a.itemSize + c]); } uvs.push(uv2[i * 2], uv2[i * 2 + 1]); } idx.push(v); }
  for (const n of names) { const a = src.attributes[n]; out.setAttribute(n, new THREE.BufferAttribute(new a.array.constructor(data[n]), a.itemSize, a.normalized)); }
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); out.setAttribute('uv1', new THREE.Float32BufferAttribute(uvs, 2)); out.setIndex(idx);
  for (const g of src.groups) out.addGroup(g.start, g.count, g.materialIndex);
  out.userData.uvCharts = charts.length; src.dispose(); return out;
}

/** UV quality: islands (by uv connectivity), overlap (fraction of covered texels hit twice), stretch (area-ratio spread),
 *  utilization (0–1 square coverage), texelDensity (uv area / world area), flipped triangles. */
export function uvStats(geo, { res = 256 } = {}) {
  const uv = geo.attributes.uv, pos = geo.attributes.position; if (!uv) return { error: 'no uv' };
  const index = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i), T = index.length / 3, grid = new Uint8Array(res * res), ratios = [];
  let flipped = 0, uvArea = 0, worldArea = 0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < T; t++) {
    const [a, b, c] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]], ua = [uv.getX(a), uv.getY(a)], ub = [uv.getX(b), uv.getY(b)], uc = [uv.getX(c), uv.getY(c)];
    const cross = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1]), ar = Math.abs(cross) / 2; if (cross < 0) flipped++;
    A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b); C.fromBufferAttribute(pos, c); const wa = B.clone().sub(A).cross(C.clone().sub(A)).length() / 2;
    uvArea += ar; worldArea += wa; if (wa > 1e-12) ratios.push(ar / wa);
    const xs = [ua[0], ub[0], uc[0]].map(v => v * res), ys = [ua[1], ub[1], uc[1]].map(v => v * res), den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(res - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(res - 1, Math.ceil(Math.max(...xs))); x++) {
      const l1 = ((ys[1] - ys[2]) * (x + 0.5 - xs[2]) + (xs[2] - xs[1]) * (y + 0.5 - ys[2])) / den, l2 = ((ys[2] - ys[0]) * (x + 0.5 - xs[2]) + (xs[0] - xs[2]) * (y + 0.5 - ys[2])) / den;
      if (l1 > 0.02 && l2 > 0.02 && 1 - l1 - l2 > 0.02) grid[y * res + x] = Math.min(255, grid[y * res + x] + 1);
    }
  }
  let used = 0, over = 0; for (const g of grid) { if (g) used++; if (g > 1) over++; }
  const mean = ratios.reduce((s, r) => s + r, 0) / (ratios.length || 1), sd = Math.sqrt(ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / (ratios.length || 1));
  // islands: union-find over shared uv-vertex indices
  const parent = new Int32Array(uv.count).map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let t = 0; t < T; t++) { const r = find(index[t * 3]); parent[find(index[t * 3 + 1])] = r; parent[find(index[t * 3 + 2])] = r; }
  const islands = new Set(); for (let t = 0; t < T; t++) islands.add(find(index[t * 3]));
  return { islands: islands.size, triangles: T, overlap: +(over / (used || 1)).toFixed(4), stretch: +(sd / (mean || 1)).toFixed(3), utilization: +(used / (res * res)).toFixed(3), texelDensity: +(uvArea / (worldArea || 1)).toFixed(4), flipped };
}
