import * as THREE from 'three';
import { STUD } from './textures.js';
import { quadCharts, quadGeometry, renderAtlas, distanceTransform } from './paint.js';

// Voxel and block sources for the surface renderer (src/paint.js, src/look.js). Learned from Train/GradientTrain,
// Train/StudTrain and the Stud Nature Pack video: every face gets studs, a bright tinted rim, glow falloff, a darker
// center, voxel AO and the model gradients, all in one atlas texture (GLB- and Roblox-MeshPart-safe).

export { rgb01 } from './look.js';

/** Bakes quads (voxels, blocks) into {geometry, material, atlas} through the shared surface renderer (src/paint.js).
 *  options: look, studs ('train' default), pxPerStud, maxAtlas, gradients, painter, roughness, metalness, bounds, matrixWorld. */
export async function bakeQuads(quads, options = {}) {
  const charts = quadCharts(quads), r = await renderAtlas(charts, { studs: 'train', ...options });
  return { geometry: quadGeometry(charts, r, { tessellate: options.tessellate !== false }), material: r.material, atlas: r.atlas };
}

/** The 6 faces of a [w,h,d] box centered at the origin as outward quads. */
export function boxQuads([w, h, d], color, colors = {}) {
  const x = w / 2, y = h / 2, z = d / 2, c = side => colors[side] ?? color;
  return [
    { side: 'right', o: [x, -y, z], u: [0, 0, -d], v: [0, h, 0] }, { side: 'left', o: [-x, -y, -z], u: [0, 0, d], v: [0, h, 0] },
    { side: 'top', o: [-x, y, z], u: [w, 0, 0], v: [0, 0, -d] }, { side: 'bottom', o: [-x, -y, -z], u: [w, 0, 0], v: [0, 0, d] },
    { side: 'front', o: [-x, -y, z], u: [w, 0, 0], v: [0, h, 0] }, { side: 'back', o: [x, -y, -z], u: [-w, 0, 0], v: [0, h, 0] },
  ].map(q => ({ ...q, color: c(q.side) }));
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Voxel grid → greedy-merged exposed quads with per-texel ambient occlusion.
 *  cells: Map/array of [x,y,z,color] or fill(x,y,z)→color|null over size [nx,ny,nz]. voxel = edge length (m). */
export function voxelQuads({ cells, fill, size, voxel = STUD, center = true, merge = true, colorEdges = true, concaveRims = false, edgeResolution = 8 } = {}) {
  const grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  if (fill) { const [nx, ny, nz] = size; for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { const c = fill(x, y, z); if (c != null && c !== false) grid.set(key(x, y, z), c); } }
  for (const cell of cells ?? []) grid.set(key(cell[0], cell[1], cell[2]), cell[3]);
  if (!grid.size) throw new Error('voxels: no filled cells');
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const k of grid.keys()) { const p = k.split(',').map(Number); min = min.map((m, i) => Math.min(m, p[i])); max = max.map((m, i) => Math.max(m, p[i])); }
  const solid = (x, y, z) => grid.has(key(x, y, z)), colorKey = c => typeof c === 'string' ? c.toLowerCase() : JSON.stringify(c);
  const off = center ? [-(min[0] + max[0] + 1) / 2, -min[1], -(min[2] + max[2] + 1) / 2] : [0, 0, 0];
  const quads = [];
  for (let d = 0; d < 6; d++) {
    const n = DIRS[d], axis = n.findIndex(v => v !== 0), sign = n[axis], ua = (axis + 1) % 3, va = (axis + 2) % 3;
    // u/v axes chosen so u × v points along the face normal.
    const [A, B] = sign > 0 ? [ua, va] : [va, ua];
    for (let layer = min[axis]; layer <= max[axis]; layer++) {
      const faces = new Map(); // "a,b" → color of exposed faces in this slice
      for (const [k, c] of grid) { const p = k.split(',').map(Number); if (p[axis] !== layer) continue; const q = p.slice(); q[axis] += sign; if (solid(...q)) continue; faces.set(`${p[A]},${p[B]}`, c); }
      if (!faces.size) continue;
      // Edge field for this slice: rims belong to the REGION, not to the greedy rectangles. Seeds are convex region
      // borders (the in-plane neighbour cell is empty) and, with colorEdges, borders to a different color. Concave
      // borders (neighbour solid but covered: a wall rises there) get no rim; AO darkens them instead.
      const R = edgeResolution, keys = [...faces.keys()].map(k => k.split(',').map(Number));
      const amin = Math.min(...keys.map(k => k[0])) - 1, bmin = Math.min(...keys.map(k => k[1])) - 1, fw = (Math.max(...keys.map(k => k[0])) - amin + 2) * R, fh = (Math.max(...keys.map(k => k[1])) - bmin + 2) * R;
      const seeds = new Uint8Array(fw * fh), cellAt = (a, b) => { const q = [0, 0, 0]; q[axis] = layer; q[A] = a; q[B] = b; return q; };
      for (const [a, b] of keys) {
        const ck0 = colorKey(faces.get(`${a},${b}`));
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const na = a + da, nb = b + db, convex = !solid(...cellAt(na, nb)), colorEdge = colorEdges && faces.has(`${na},${nb}`) && colorKey(faces.get(`${na},${nb}`)) !== ck0;
          if (!convex && !colorEdge && !(concaveRims && !faces.has(`${na},${nb}`))) continue;
          const x0 = (a - amin) * R, y0 = (b - bmin) * R;
          for (let i = 0; i < R; i++) { const sx = da === 1 ? x0 + R - 1 : da === -1 ? x0 : x0 + i, sy = db === 1 ? y0 + R - 1 : db === -1 ? y0 : y0 + i; seeds[sy * fw + sx] = 1; }
        }
      }
      const field = distanceTransform(seeds, fw, fh);
      // Regions (same color, 4-connected) → max edge distance for the relative vignette.
      const label = new Map(), regionMax = []; let nLabels = 0;
      for (const [a, b] of keys) {
        const k0 = `${a},${b}`; if (label.has(k0)) continue; const id = nLabels++, ck = colorKey(faces.get(k0)), stack = [[a, b]]; label.set(k0, id); let m = 0;
        while (stack.length) {
          const [x, y] = stack.pop();
          for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const d = field[((y - bmin) * R + j) * fw + (x - amin) * R + i]; if (d !== Infinity) m = Math.max(m, d); }
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const kk = `${x + dx},${y + dy}`; if (!label.has(kk) && faces.has(kk) && colorKey(faces.get(kk)) === ck) { label.set(kk, id); stack.push([x + dx, y + dy]); } }
        }
        regionMax.push(m);
      }
      const toStuds = voxel / STUD / R, sampleField = (pa, pb) => {
        const fx = Math.min(fw - 1.001, Math.max(0, (pa - amin) * R - 0.5)), fy = Math.min(fh - 1.001, Math.max(0, (pb - bmin) * R - 0.5)), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const g = (x, y) => { const d = field[y * fw + x]; return d === Infinity ? 1e4 : d; };
        return ((g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty + 0.5) * toStuds;
      };
      const used = new Set();
      const sorted = [...faces.keys()].map(k => k.split(',').map(Number)).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      for (const [a0, b0] of sorted) {
        if (used.has(`${a0},${b0}`)) continue; const c = faces.get(`${a0},${b0}`), ck = colorKey(c), same = (a, b) => !used.has(`${a},${b}`) && faces.has(`${a},${b}`) && colorKey(faces.get(`${a},${b}`)) === ck;
        let wa = 1, wb = 1;
        if (merge) { while (same(a0 + wa, b0)) wa++; grow: while (true) { for (let i = 0; i < wa; i++) if (!same(a0 + i, b0 + wb)) break grow; wb++; } }
        for (let i = 0; i < wa; i++) for (let j = 0; j < wb; j++) used.add(`${a0 + i},${b0 + j}`);
        const o = [0, 0, 0], u = [0, 0, 0], v = [0, 0, 0];
        o[axis] = layer + (sign > 0 ? 1 : 0); o[A] = a0; o[B] = b0; u[A] = wa; v[B] = wb;
        // Classic voxel AO: for a point on the face, look at the 8 cells around it in the slab in front of the face.
        const front = layer + sign, aoCache = new Map();
        const cornerAO = (ca, cb) => { const k = ca + ',' + cb; if (!aoCache.has(k)) { const q = [0, 0, 0]; q[axis] = front; let occ = 0; for (const [da, db] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { q[A] = ca + da; q[B] = cb + db; occ += solid(...q) ? 1 : 0; } aoCache.set(k, 1 - occ / 4); } return aoCache.get(k); };
        const shade = (s, t) => { const pa = a0 + s * wa, pb = b0 + t * wb, ia = Math.floor(pa), ib = Math.floor(pb), fa = pa - ia, fb = pb - ib;
          const c00 = cornerAO(ia, ib), c10 = cornerAO(ia + 1, ib), c01 = cornerAO(ia, ib + 1), c11 = cornerAO(ia + 1, ib + 1);
          const sm = x => x * x * (3 - 2 * x); return THREE.MathUtils.lerp(THREE.MathUtils.lerp(c00, c10, sm(fa)), THREE.MathUtils.lerp(c01, c11, sm(fa)), sm(fb)); };
        const reg = label.get(`${a0},${b0}`), edgeAt = (s, t) => sampleField(a0 + s * wa, b0 + t * wb);
        quads.push({ o: o.map((x, i) => (x + off[i]) * voxel), u: u.map(x => x * voxel), v: v.map(x => x * voxel), color: c, shade, grid: [wa, wb], edgeAt, inradius: (regionMax[reg] + 0.5) * toStuds });
      }
    }
  }
  return { quads, cells: grid.size, size: max.map((m, i) => (m - min[i] + 1) * voxel) };
}

