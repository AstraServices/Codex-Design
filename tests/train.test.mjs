import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync, deflateSync } from 'node:zlib';
import { createKit } from '../src/kit.js';
import { LIBRARY_STUDS } from '../src/textures.js';
import { bakeQuads, boxQuads, voxelQuads } from '../src/bake.js';
import { topologyOptimize } from '../src/topopt.js';
import { generatePBR, PBR_EXAMPLE_NAMES } from '../src/pbr.js';
import { encodePNG, decodePNG } from '../src/png.js';

const lum = (d, i) => 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];

test('StudTrain studs are registered and are the default part top', async () => {
  assert.ok(LIBRARY_STUDS.train?.overlay && LIBRARY_STUDS['train-mixed']?.overlay);
  const k = createKit({}), part = await k.part('P', [4 * k.STUD, k.STUD, 4 * k.STUD], '#ff0000');
  assert.equal(part.userData.robloxPart.top, 'train');
});

test('baked faces: bright rim on borders, darker vignette inside, one atlas texture', async () => {
  const { material, geometry, atlas } = await bakeQuads(boxQuads([4 * 0.28, 4 * 0.28, 4 * 0.28], '#3a8f3a'), { studs: 'none', faceGradient: 0, pxPerStud: 16 });
  assert.equal(geometry.index.count, 36); assert.ok(atlas.width >= 64);
  const img = material.map.image, d = img.data, w = img.width, uv = geometry.attributes.uv;
  // Top-face quad (index 2): sample its border texel vs. a texel a quarter stud inside the rim.
  const u0 = uv.getX(8) * w, v0 = uv.getY(8) * img.height, at = (x, y) => Math.floor(y) * w + Math.floor(x);
  const edge = lum(d, at(u0 + 0.5, v0 + 20)), inner = lum(d, at(u0 + 2.5, v0 + 20));
  assert.ok(edge > inner + 8, `rim ${edge} should be brighter than vignette ${inner}`);
});

test('voxels: greedy merge, hidden faces culled, AO darkens concave corners', () => {
  const merged = voxelQuads({ size: [4, 1, 4], fill: () => '#888' }), single = voxelQuads({ size: [4, 1, 4], fill: () => '#888', merge: false });
  assert.equal(merged.quads.length, 6); assert.equal(single.quads.length, 16 * 2 + 4 * 4);
  // An L-shape: the floor face next to the wall gets occlusion, the far corner does not.
  const L = voxelQuads({ cells: [[0, 0, 0, '#888'], [1, 0, 0, '#888'], [0, 1, 0, '#888']], merge: false, center: false });
  // Top face of cell (1,0,0): u runs along z, v along x, so t=0 touches the wall cell (0,1,0).
  const floor = L.quads.find(q => q.u[1] === 0 && q.v[1] === 0 && Math.abs(q.o[1] - 0.28) < 1e-6 && Math.abs(q.o[0] - 0.28) < 1e-6);
  assert.ok(floor.shade(0.5, 0.02) < floor.shade(0.5, 0.98) - 0.2);
});

test('gradient re-bakes voxel atlases darker at the bottom than the top', async () => {
  const k = createKit({}), v = await k.voxels('Col', { size: [1, 12, 1], fill: () => '#7fbf7f', studs: 'none', rim: 0, vignette: 0, faceGradient: 0, tessellate: false });
  const before = v.material.map.image.data.slice();
  await k.gradient('Asset', { bottom: 0.5, top: 1.2 });
  const d = v.material.map.image.data; let changed = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== before[i]) changed++;
  assert.ok(changed > 100);
  const side = v.userData.codexSurface.quads.findIndex(q => q.v[1] > 1), uv = v.geometry.attributes.uv, w = v.material.map.image.width, h = v.material.map.image.height;
  const x = Math.round((uv.getX(side * 4) + uv.getX(side * 4 + 1)) / 2 * w), yLo = Math.round(uv.getY(side * 4) * h) + 4, yHi = Math.round(uv.getY(side * 4 + 2) * h) - 4;
  assert.ok(lum(d, yHi * w + x) > lum(d, yLo * w + x) + 30);
});

test('SIMP: compliance falls, volume constraint holds, solid connects load to support', () => {
  const r = topologyOptimize({ case: 'cantilever', nelx: 40, nely: 20, volfrac: 0.4, iterations: 30 });
  assert.ok(r.history.at(-1) < r.history[0] * 0.5, `compliance ${r.history[0]} → ${r.history.at(-1)}`);
  assert.ok(Math.abs(r.volume - 0.4) < 0.02);
  const solid = (x, y) => r.density[(r.nely - 1 - y) * r.nelx + x] > 0.5;
  assert.ok(solid(r.nelx - 1, r.nely / 2) || solid(r.nelx - 1, r.nely / 2 - 1), 'material at the load point');
  const k = createKit({}), part = k.topologyPart('Beam', { case: 'mbb', nelx: 30, nely: 10, iterations: 20 });
  assert.ok(part.geometry.attributes.position.count > 50);
});

test('PBR presets tile seamlessly and produce unit normals', () => {
  for (const name of PBR_EXAMPLE_NAMES) {
    const s = generatePBR(name, { size: 64 }), N = 64;
    let seam = 0, interior = 0;
    for (let y = 0; y < N; y++) { seam += Math.abs(s.height[(y * N) * 4] - s.height[(y * N + N - 1) * 4]); interior += Math.abs(s.height[(y * N + 31) * 4] - s.height[(y * N + 32) * 4]); }
    assert.ok(seam <= interior * 3 + N * 12, `${name} seam ${seam} vs interior ${interior}`);
    const nx = s.normal[0] / 127.5 - 1, ny = s.normal[1] / 127.5 - 1, nz = s.normal[2] / 127.5 - 1;
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 0.05, `${name} normal not unit`);
  }
});

test('PNG encoder round-trips through the decoder', () => {
  const w = 5, h = 3, data = new Uint8Array(w * h * 4).map((_, i) => (i * 37) & 255);
  const back = decodePNG(encodePNG(data, w, h, b => deflateSync(b)), b => inflateSync(b));
  assert.deepEqual([...back.data], [...data]);
});

test('distance transform is exact Euclidean', async () => {
  const { distanceTransform } = await import('../src/paint.js');
  const w = 9, h = 7, seeds = new Uint8Array(w * h); seeds[3 * w + 4] = 1;
  const d = distanceTransform(seeds, w, h); assert.equal(d[3 * w + 4], 0); assert.ok(Math.abs(d[0] - Math.hypot(4, 3)) < 1e-6);
});

test('k.paint: any mesh gets charts, rims only on hard edges, skin attributes kept', async () => {
  const k = createKit({}), cyl = k.mesh('Post', 'cylinder', [0.3, 0.3, 1, 16], k.material('#3366cc'));
  await k.paint(cyl, { look: 'default' });
  assert.equal(cyl.userData.codexSurface.atlas.charts, 6); // 4 side charts (by axis) + 2 caps
  assert.ok(cyl.material.map && cyl.geometry.attributes.uv);
});

test('designed color gradient: radial from a corner (no presets)', async () => {
  const k = createKit({}), b = await k.block('Sign', [12 * 0.28, 6 * 0.28, 0.2], '#2060d0', { studs: 'none', look: 'flat', gradient: { type: 'radial', center: 'bottom-left', axis: 'z', radius: 1.2, stops: [[0, '#33c3c9'], [1, '#3b1a72']] } });
  const img = b.material.map.image, d = img.data, uv = b.geometry.attributes.uv, f = 4 * 4; // front quad
  const px = (s, t) => { const u = uv.getX(f) + (uv.getX(f + 1) - uv.getX(f)) * s, v = uv.getY(f) + (uv.getY(f + 2) - uv.getY(f)) * t, o = (Math.floor(v * img.height) * img.width + Math.floor(u * img.width)) * 4; return [d[o], d[o + 1], d[o + 2]]; };
  const near = px(0.03, 0.05), far = px(0.97, 0.95);
  assert.ok(near[1] > 150 && near[2] > 150, `corner should be teal: ${near}`); assert.ok(far[2] > far[1] + 50 && far[1] < 100, `far corner should be deep purple-blue: ${far}`);
  await assert.rejects(() => k.gradient('Sign', 'ocean'), /design the gradient/i);
});

test('quadify turns fan caps into quads (quad share up, n-gons gone)', () => {
  const k = createKit({}); k.mesh('Can', 'cylinder', [0.5, 0.5, 1, 16, 4], k.material('#888'));
  const q = c => c.quads.score ?? c.quads, before = k.quality(), r = k.quadify();
  assert.ok(q(r.after.criteria) >= 0.95 && q(r.after.criteria) > q(before.criteria)); assert.equal(r.after.totals.ngons, 0);
});

test('smart topology is context-aware: hard-surface keeps triangles, subdivision gets 100% quads, shape unchanged', async () => {
  const { quadFaces, classifyGeometry } = await import('../src/topology-quality.js');
  const k = createKit({}), box = k.mesh('Crate', 'box', [1, 1, 1], k.material('#888'));
  assert.equal(classifyGeometry(box.geometry).kind, 'hard-surface');
  const tris = box.geometry.index.count / 3, auto = k.smartTopology('auto');
  assert.equal(auto.meshes[0].kind, 'hard-surface'); assert.equal(box.geometry.index.count / 3, tris, 'no geometry added to a static hard-surface prop');
  const k2 = createKit({}), sph = k2.mesh('Ball', 'sphere', [0.5, 12, 8], k2.material('#888')), bb = new (await import('three')).Box3().setFromObject(sph);
  const sub = k2.smartTopology('subdivision'); assert.equal(quadFaces(sph.geometry).triangles, 0, 'every face is a quad');
  const bb2 = new (await import('three')).Box3().setFromObject(sph); assert.ok(bb.min.distanceTo(bb2.min) < 1e-6 && bb.max.distanceTo(bb2.max) < 1e-6, 'shape unchanged'); assert.ok(sub.meshes[0].actions.allQuads);
});

test('SIMP quad mesher is watertight and quad-dominant', () => {
  const k = createKit({}), part = k.topologyPart('B', { case: 'cantilever', nelx: 40, nely: 20, volfrac: 0.4, iterations: 25 }), a = k.audit(), q = k.quality();
  assert.equal(a.total.nonManifoldEdges, 0); assert.ok((q.criteria.quads.score ?? q.criteria.quads) > 0.95); assert.ok(part.geometry.index.count > 0);
});

test('custom PBR definitions (AI-authored) generate full map sets', async () => {
  const lab = await import('../src/texlab.js');
  const def = { height: (u, v, s) => { const b = lab.bricks(u, v, { rows: 4, cols: 2, seed: s }); return { h: b.mask * (0.5 + b.bevel * 0.5), id: b.id }; }, albedo: c => lab.ramp([[0, '#552211'], [1, '#cc7755']], c.id), roughness: c => 0.7 + c.cavity };
  const s = generatePBR(def, { size: 128 }); assert.equal(s.albedo.length, 128 * 128 * 4); assert.ok(s.normal.some((v, i) => i % 4 === 0 && Math.abs(v - 128) > 5));
  const h = lab.hexagons(0.31, 0.77, 6); assert.ok(h.edge >= 0 && h.edge <= 1);
});

test('looks are fully custom: no named presets, the v0.6 glow edge is reproducible with parameters', async () => {
  const k = createKit({});
  await assert.rejects(() => k.block('A', [0.56, 0.56, 0.56], '#2a8e28', { look: 'glossy' }), /no longer a preset/);
  const glow = await k.block('B', [0.56, 0.56, 0.56], '#2a8e28', { studs: 'none', look: { rimMode: 'gain', rimGain: 1.75, rimLift: 0.16, rim: 0.82, rimWidth: 0.085, glow: 0.32, glowWidth: 0.2 } });
  const soft = await k.block('C', [0.56, 0.56, 0.56], '#2a8e28', { studs: 'none', look: 'default' });
  const edgeLum = m => { const d = m.material.map.image.data, uv = m.geometry.attributes.uv, w = m.material.map.image.width, h = m.material.map.image.height, o = (Math.floor(uv.getY(16) * h + 1) * w + Math.floor(uv.getX(16) * w + 1)) * 4; return d[o] + d[o + 1] + d[o + 2]; };
  assert.ok(edgeLum(glow) > edgeLum(soft), 'gain rim is brighter than the soft default');
});
