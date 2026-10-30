// Structural topology optimization (SIMP, Sigmund's 88-line method) for lightweight engineering parts.
// 2D plane-stress bilinear quads, banded Cholesky direct solve (nodes ordered along the short side), density filter,
// optimality-criteria update. Deterministic; runs in Node and the browser. The result is a 0–1 density field
// that k.topologyPart() extrudes into a solid (marching squares → shapes with holes → ExtrudeGeometry).
// CNN accelerators (TopologyNet, TOuNN, etc.) learn to predict this field; see docs/TRAINING.md §Topology.

/** Element stiffness of a unit square, E=1, nu=0.3 (8×8, dofs [u1,v1,…,u4,v4], counter-clockwise from bottom-left). */
function elementStiffness(nu = 0.3) {
  const k = [1 / 2 - nu / 6, 1 / 8 + nu / 8, -1 / 4 - nu / 12, -1 / 8 + 3 * nu / 8, -1 / 4 + nu / 12, -1 / 8 - nu / 8, nu / 6, 1 / 8 - 3 * nu / 8];
  const m = [[0, 1, 2, 3, 4, 5, 6, 7], [1, 0, 7, 6, 5, 4, 3, 2], [2, 7, 0, 5, 6, 3, 4, 1], [3, 6, 5, 0, 7, 2, 1, 4], [4, 5, 6, 7, 0, 1, 2, 3], [5, 4, 3, 2, 1, 0, 7, 6], [6, 3, 4, 1, 2, 7, 0, 5], [7, 2, 1, 4, 3, 6, 5, 0]];
  const KE = new Float64Array(64), s = 1 / (1 - nu * nu); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) KE[i * 8 + j] = s * k[m[i][j]]; return KE;
}

/** Named load cases (grid coordinates: x right 0…nelx, y up 0…nely). */
export const TOPOLOGY_CASES = {
  cantilever: (nx, ny) => ({ supports: [{ edge: 'left', dir: 'xy' }], loads: [{ x: nx, y: Math.round(ny / 2), fy: -1 }] }),
  mbb: (nx, ny) => ({ supports: [{ edge: 'left', dir: 'x' }, { x: nx, y: 0, dir: 'y' }], loads: [{ x: 0, y: ny, fy: -1 }] }),
  bridge: (nx, ny) => ({ supports: [{ x: 0, y: 0, dir: 'xy' }, { x: nx, y: 0, dir: 'xy' }], loads: Array.from({ length: 5 }, (_, i) => ({ x: Math.round(nx * (i + 1) / 6), y: ny, fy: -0.2 })) }),
  bracket: (nx, ny) => ({ supports: [{ edge: 'top', dir: 'xy' }], loads: [{ x: nx, y: 0, fy: -1 }] }),
  arch: (nx, ny) => ({ supports: [{ x: 0, y: 0, dir: 'xy' }, { x: nx, y: 0, dir: 'xy' }], loads: [{ x: Math.round(nx / 2), y: ny, fy: -1 }] }),
};

/**
 * topologyOptimize({nelx, nely, volfrac, penal, rmin, iterations, case|loads+supports, passive})
 * loads: [{x,y,fx,fy}] at grid nodes; supports: [{x,y,dir:'x'|'y'|'xy'}] or [{edge:'left'|'right'|'top'|'bottom',dir}];
 * passive(x,y) → 0 (forced void), 1 (forced solid) or undefined for each element.
 * Returns {density (rows top→bottom), nelx, nely, compliance, volume, iterations, history}.
 */
export function topologyOptimize(options = {}) {
  const { nelx = 60, nely = 30, volfrac = 0.4, penal = 3, rmin = 1.5, iterations = 60, tolerance = 0.01, nu = 0.3, Emin = 1e-9 } = options;
  const spec = options.case ? TOPOLOGY_CASES[options.case]?.(nelx, nely) : null;
  if (options.case && !spec) throw new Error(`Unknown case ${options.case}; choose ${Object.keys(TOPOLOGY_CASES).join(', ')}`);
  const loads = options.loads ?? spec?.loads, supports = options.supports ?? spec?.supports;
  if (!loads?.length || !supports?.length) throw new Error('topologyOptimize needs loads and supports (or case)');
  const KE = elementStiffness(nu), ne = nelx * nely, ndof = 2 * (nelx + 1) * (nely + 1);
  // Number nodes along the shorter side first so the stiffness bandwidth stays ~2·(short side).
  const node = nely <= nelx ? (x, y) => x * (nely + 1) + y : (x, y) => y * (nelx + 1) + x; // y up
  const edofs = new Int32Array(ne * 8);
  for (let ey = 0; ey < nely; ey++) for (let ex = 0; ex < nelx; ex++) {
    const e = ey * nelx + ex, n = [node(ex, ey), node(ex + 1, ey), node(ex + 1, ey + 1), node(ex, ey + 1)];
    n.forEach((nd, i) => { edofs[e * 8 + i * 2] = nd * 2; edofs[e * 8 + i * 2 + 1] = nd * 2 + 1; });
  }
  const F = new Float64Array(ndof), fixed = new Uint8Array(ndof);
  for (const l of loads) { const nd = node(Math.round(l.x), Math.round(l.y)); F[nd * 2] += l.fx ?? 0; F[nd * 2 + 1] += l.fy ?? 0; }
  for (const s of supports) {
    const pts = s.edge ? Array.from({ length: (s.edge === 'left' || s.edge === 'right' ? nely : nelx) + 1 }, (_, i) => s.edge === 'left' ? [0, i] : s.edge === 'right' ? [nelx, i] : s.edge === 'top' ? [i, nely] : [i, 0]) : [[Math.round(s.x), Math.round(s.y)]];
    for (const [x, y] of pts) { const nd = node(x, y); if (s.dir.includes('x')) fixed[nd * 2] = 1; if (s.dir.includes('y')) fixed[nd * 2 + 1] = 1; }
  }
  // Density filter weights (cone of radius rmin).
  const R = Math.ceil(rmin) - 1, Hs = new Float64Array(ne), nbr = [];
  for (let ey = 0; ey < nely; ey++) for (let ex = 0; ex < nelx; ex++) {
    const list = [];
    for (let j = Math.max(0, ey - R); j <= Math.min(nely - 1, ey + R); j++) for (let i = Math.max(0, ex - R); i <= Math.min(nelx - 1, ex + R); i++) { const w = rmin - Math.hypot(i - ex, j - ey); if (w > 0) list.push(j * nelx + i, w); }
    nbr.push(list); Hs[ey * nelx + ex] = list.reduce((s, v, k) => k % 2 ? s + v : s, 0);
  }
  const filter = (src, out) => { for (let e = 0; e < ne; e++) { let s = 0; const l = nbr[e]; for (let k = 0; k < l.length; k += 2) s += l[k + 1] * src[l[k]]; out[e] = s / Hs[e]; } };
  const filterT = (src, out) => { out.fill(0); for (let e = 0; e < ne; e++) { const l = nbr[e]; for (let k = 0; k < l.length; k += 2) out[l[k]] += l[k + 1] * src[e] / Hs[e]; } };
  const passive = new Int8Array(ne).fill(-1);
  if (options.passive) for (let ey = 0; ey < nely; ey++) for (let ex = 0; ex < nelx; ex++) { const p = options.passive(ex + 0.5, ey + 0.5); if (p === 0 || p === 1) passive[ey * nelx + ex] = p; }
  const x = new Float64Array(ne).fill(volfrac), phys = new Float64Array(ne), E = new Float64Array(ne);
  const applyPassive = a => { for (let e = 0; e < ne; e++) if (passive[e] >= 0) a[e] = passive[e]; };
  applyPassive(x); filter(x, phys); applyPassive(phys);
  let bw = 0; for (let e = 0; e < ne; e++) { let lo = Infinity, hi = 0; for (let i = 0; i < 8; i++) { lo = Math.min(lo, edofs[e * 8 + i]); hi = Math.max(hi, edofs[e * 8 + i]); } bw = Math.max(bw, hi - lo); }
  const B = bw + 1, band = new Float64Array(ndof * B), U = new Float64Array(ndof);
  function solve() { // Assemble K (upper band), clamp fixed dofs, Cholesky K = UᵀU in place, two triangular solves.
    band.fill(0);
    for (let e = 0; e < ne; e++) { const s = E[e], o = e * 8; for (let i = 0; i < 8; i++) { const gi = edofs[o + i]; if (fixed[gi]) continue; for (let j = 0; j < 8; j++) { const gj = edofs[o + j]; if (gj < gi || fixed[gj]) continue; band[gi * B + gj - gi] += s * KE[i * 8 + j]; } } }
    for (let d = 0; d < ndof; d++) if (fixed[d]) band[d * B] = 1;
    for (let i = 0; i < ndof; i++) {
      const jmax = Math.min(ndof - 1, i + bw);
      for (let j = i; j <= jmax; j++) {
        let sum = band[i * B + j - i];
        for (let k = Math.max(0, j - bw); k < i; k++) sum -= band[k * B + i - k] * band[k * B + j - k];
        band[i * B + j - i] = i === j ? Math.sqrt(Math.max(sum, 1e-30)) : sum / band[i * B];
      }
    }
    for (let i = 0; i < ndof; i++) { let sum = fixed[i] ? 0 : F[i]; for (let k = Math.max(0, i - bw); k < i; k++) sum -= band[k * B + i - k] * U[k]; U[i] = sum / band[i * B]; }
    for (let i = ndof - 1; i >= 0; i--) { let sum = U[i]; for (let j = i + 1; j <= Math.min(ndof - 1, i + bw); j++) sum -= band[i * B + j - i] * U[j]; U[i] = sum / band[i * B]; }
  }
  const dc = new Float64Array(ne), dv = new Float64Array(ne), tmp = new Float64Array(ne), xnew = new Float64Array(ne), history = [];
  let compliance = 0, iter = 0;
  for (iter = 1; iter <= iterations; iter++) {
    for (let e = 0; e < ne; e++) E[e] = Emin + Math.pow(phys[e], penal) * (1 - Emin);
    solve(); compliance = 0;
    for (let e = 0; e < ne; e++) { const o = e * 8; let ce = 0; for (let i = 0; i < 8; i++) { let s = 0; for (let j = 0; j < 8; j++) s += KE[i * 8 + j] * U[edofs[o + j]]; ce += U[edofs[o + i]] * s; } compliance += E[e] * ce; dc[e] = -penal * (1 - Emin) * Math.pow(phys[e], penal - 1) * ce; }
    filterT(dc, tmp); dc.set(tmp); dv.fill(1); filterT(dv, tmp); dv.set(tmp);
    // Optimality criteria with bisection on the volume Lagrange multiplier.
    let l1 = 0, l2 = 1e9; const move = 0.2;
    while ((l2 - l1) / (l1 + l2) > 1e-3) {
      const lm = (l1 + l2) / 2; for (let e = 0; e < ne; e++) xnew[e] = Math.max(0, Math.max(x[e] - move, Math.min(1, Math.min(x[e] + move, x[e] * Math.sqrt(Math.max(0, -dc[e]) / dv[e] / lm)))));
      applyPassive(xnew); filter(xnew, tmp); applyPassive(tmp); let vol = 0; for (let e = 0; e < ne; e++) vol += tmp[e]; if (vol > volfrac * ne) l1 = lm; else l2 = lm;
    }
    let change = 0; for (let e = 0; e < ne; e++) change = Math.max(change, Math.abs(xnew[e] - x[e])); x.set(xnew); filter(x, phys); applyPassive(phys);
    history.push(+compliance.toFixed(4)); if (change < tolerance) break;
  }
  // Output rows top→bottom (image order) for fieldShapes.
  const density = new Float32Array(ne); let volume = 0;
  for (let ey = 0; ey < nely; ey++) for (let ex = 0; ex < nelx; ex++) { const v = phys[ey * nelx + ex]; density[(nely - 1 - ey) * nelx + ex] = v; volume += v; }
  return { density, nelx, nely, compliance, volume: volume / ne, iterations: Math.min(iter, iterations), history, loads, supports };
}

/**
 * Quad-dominant solid from a density field (rows top→bottom): marching-squares cells on an upsampled grid.
 * Fully-inside cells become quads, boundary cells small convex polygons, contour segments become side walls.
 * Watertight (crossing points are shared between cells). Returns a BufferGeometry centered on the origin.
 */
export function densityMesh(density, w, h, { size = 2, thickness = 0.2, threshold = 0.5, upsample = 2, THREE } = {}) {
  const W = w * upsample, H = h * upsample, at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : density[y * w + x]);
  // Bilinear upsample (cell centers), then node values = average of the 4 surrounding cells (outside = 0 so borders close).
  const cell = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = (x + 0.5) / upsample - 0.5, fy = (y + 0.5) / upsample - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0; cell[y * W + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty; }
  const C = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : cell[y * W + x]);
  const node = new Float32Array((W + 1) * (H + 1)); // node (i,j), j counts rows top→bottom
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) node[j * (W + 1) + i] = (C(i - 1, j - 1) + C(i, j - 1) + C(i - 1, j) + C(i, j)) / 4;
  const scale = size / Math.max(W, H), X = i => (i - W / 2) * scale, Y = j => (H / 2 - j) * scale, z = thickness / 2;
  const pos = [], idx = [], ids = new Map();
  const vert = (key, x, y, zz) => { const k = key + (zz > 0 ? 'f' : 'b'); if (!ids.has(k)) { ids.set(k, pos.length / 3); pos.push(x, y, zz); } return ids.get(k); };
  const N = (i, j) => (i < 0 || j < 0 || i > W || j > H ? 0 : node[j * (W + 1) + i]);
  const cornerP = (i, j) => ({ key: `n${i},${j}`, x: X(i), y: Y(j) });
  const edgeP = (i1, j1, i2, j2) => { const a = N(i1, j1), b = N(i2, j2), t = Math.min(0.85, Math.max(0.15, (threshold - a) / ((b - a) || 1e-9))), k = i1 < i2 || j1 < j2 ? `e${i1},${j1},${i2},${j2}` : `e${i2},${j2},${i1},${j1}`; return { key: k, x: X(i1 + (i2 - i1) * t), y: Y(j1 + (j2 - j1) * t), edge: true }; };
  const walls = [];
  for (let j = -1; j <= H; j++) for (let i = -1; i <= W; i++) { // one cell past the border closes parts touching it
    // Corners counter-clockwise in world space (y up): bottom-left, bottom-right, top-right, top-left.
    const cs = [[i, j + 1], [i + 1, j + 1], [i + 1, j], [i, j]], ins = cs.map(([a, b]) => N(a, b) >= threshold);
    if (!ins.some(Boolean)) continue;
    const poly = [];
    for (let k = 0; k < 4; k++) { const [a, b] = cs[k], [c, d] = cs[(k + 1) % 4]; if (ins[k]) poly.push(cornerP(a, b)); if (ins[k] !== ins[(k + 1) % 4]) poly.push(edgeP(a, b, c, d)); }
    if (poly.length < 3) continue;
    for (const zz of [z, -z]) { const v = poly.map(p => vert(p.key, p.x, p.y, zz)); for (let t = 1; t < v.length - 1; t++) idx.push(...(zz > 0 ? [v[0], v[t], v[t + 1]] : [v[0], v[t + 1], v[t]])); }
    for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; if (p.edge && q.edge) walls.push([p, q]); }
  }
  for (const [p, q] of walls) { // inside is to the left of p→q, so the wall faces right
    const a = vert('w' + p.key, p.x, p.y, z), b = vert('w' + q.key, q.x, q.y, z), c = vert('w' + q.key, q.x, q.y, -z), d = vert('w' + p.key, p.x, p.y, -z);
    idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  // Planar UVs (front view) so the part can be painted/textured.
  const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / size + 0.5, pos[i + 1] / size + 0.5); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals(); return g;
}
