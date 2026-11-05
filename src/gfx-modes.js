// GFX Studio 2.0 render modes and model-presentation helpers (used by gfx.js):
//   clay · matcap · normal · wireframe · wire-overlay (solid + edges) · density (triangle density heatmap) · uv (checker)
//   · roughness · metalness · depth · emissive-only, exploded views, skeleton overlay, mesh statistics, best-angle search.
// Every override is temporary: materials, geometry and transforms are restored after the render.
import * as THREE from 'three';

const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
let matcapTex, checkerTex;
const matcap = () => matcapTex ??= new THREE.CanvasTexture(canvas(256, 256, (g, w) => { const r = g.createRadialGradient(w * 0.38, w * 0.32, w * 0.02, w / 2, w / 2, w / 2); r.addColorStop(0, '#ffffff'); r.addColorStop(0.35, '#c9d3dc'); r.addColorStop(0.75, '#5d6b78'); r.addColorStop(1, '#1d232a'); g.fillStyle = r; g.beginPath(); g.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); g.fill(); }));
const checker = () => { if (checkerTex) return checkerTex; checkerTex = new THREE.CanvasTexture(canvas(512, 512, (g, w) => { const n = 16, c = w / n; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#e8ecef' : '#3b4b5c'; g.fillRect(x * c, y * c, c, c); } g.fillStyle = '#e05c4b'; g.font = 'bold 18px sans-serif'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.fillText('ABCD'[y] + (x + 1), x * w / 4 + 6, y * w / 4 + 22); })); checkerTex.wrapS = checkerTex.wrapT = THREE.RepeatWrapping; checkerTex.colorSpace = THREE.SRGBColorSpace; return checkerTex; };
const first = m => Array.isArray(m) ? m[0] : m;
export const RENDER_MODES = ['beauty', 'pathtrace', 'clay', 'matcap', 'normal', 'wireframe', 'wire-overlay', 'density', 'uv', 'roughness', 'metalness', 'depth', 'emissive'];

function modeMaterial(mesh, mode, orig) {
  const o = first(orig) ?? {}, skin = !!mesh.isSkinnedMesh;
  switch (mode) {
    case 'clay': return new THREE.MeshStandardMaterial({ color: '#d8d3ca', roughness: 0.82, metalness: 0 });
    case 'matcap': return new THREE.MeshMatcapMaterial({ matcap: matcap(), color: '#ffffff' });
    case 'normal': return new THREE.MeshNormalMaterial();
    case 'wireframe': return new THREE.MeshBasicMaterial({ color: '#8fd3ff', wireframe: true });
    case 'wire-overlay': return new THREE.MeshStandardMaterial({ color: '#cfd5da', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    case 'uv': return mesh.geometry.attributes.uv ? new THREE.MeshBasicMaterial({ map: checker() }) : new THREE.MeshBasicMaterial({ color: '#ff3b6b' });
    case 'roughness': return o.roughnessMap ? new THREE.MeshBasicMaterial({ map: o.roughnessMap }) : new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(o.roughness ?? 1) });
    case 'metalness': return o.metalnessMap ? new THREE.MeshBasicMaterial({ map: o.metalnessMap }) : new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(o.metalness ?? 0) });
    case 'depth': return new THREE.MeshDepthMaterial();
    case 'emissive': return new THREE.MeshBasicMaterial({ color: o.emissive ?? '#000000', map: o.emissiveMap ?? null });
    case 'density': return new THREE.MeshBasicMaterial({ vertexColors: true });
    default: return orig;
  }
}
/** Triangle density heatmap: world-space triangle area → blue (sparse) … red (dense), per face, log scale. */
function densityGeometry(mesh) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(), p = g.attributes.position, n = p.count / 3, areas = new Float32Array(n), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  for (let i = 0; i < n; i++) { a.fromBufferAttribute(p, i * 3).applyMatrix4(mesh.matrixWorld); b.fromBufferAttribute(p, i * 3 + 1).applyMatrix4(mesh.matrixWorld); c.fromBufferAttribute(p, i * 3 + 2).applyMatrix4(mesh.matrixWorld); areas[i] = Math.log10(b.sub(a).cross(c.sub(a)).length() / 2 + 1e-9); }
  return { g, areas };
}
const heat = t => new THREE.Color().setHSL((1 - THREE.MathUtils.clamp(t, 0, 1)) * 0.66, 0.9, 0.5);

/** Applies a render mode / explode / skeleton overlay to root, runs fn(), restores everything. */
export function withPresentation(root, { renderMode, explode = 0, skeleton = false } = {}, fn) {
  const restore = [];
  if (renderMode && renderMode !== 'beauty' && renderMode !== 'pathtrace') {
    const meshes = []; root.traverse(o => { if (o.isMesh && o.visible && !o.userData.codexHelper && !/_Highlight|_Edge/.test(o.name)) meshes.push(o); });
    let dens = null;
    if (renderMode === 'density') { dens = meshes.map(m => ({ m, ...densityGeometry(m) })); /* skinned meshes too: bind-pose areas, skin attributes kept */ const all = dens.flatMap(d => [...d.areas]).sort((x, y) => x - y), lo = all[Math.floor(all.length * 0.05)] ?? 0, hi = all[Math.floor(all.length * 0.95)] ?? 1;
      for (const d of dens) { const col = new Float32Array(d.g.attributes.position.count * 3); d.areas.forEach((ar, i) => { const h = heat(1 - (ar - lo) / ((hi - lo) || 1)); for (let k = 0; k < 3; k++) col.set([h.r, h.g, h.b], (i * 3 + k) * 3); }); d.g.setAttribute('color', new THREE.BufferAttribute(col, 3)); restore.push(() => { d.m.geometry = d.old; d.g.dispose(); }); d.old = d.m.geometry; d.m.geometry = d.g; } }
    for (const m of meshes) { const old = m.material; m.material = Array.isArray(old) ? old.map(x => modeMaterial(m, renderMode, x)) : modeMaterial(m, renderMode, old); restore.push(() => { const made = m.material; m.material = old; for (const x of [made].flat()) if (x !== old && !(Array.isArray(old) && old.includes(x))) x.dispose?.(); }); }
    if (renderMode === 'wire-overlay') for (const m of meshes) {
      if (m.isSkinnedMesh) { // skinned: a second skinned mesh on the same skeleton draws the edges in the current pose
        const w = new THREE.SkinnedMesh(m.geometry, new THREE.MeshBasicMaterial({ color: '#2b3d52', wireframe: true, transparent: true, opacity: 0.8 })); w.bind(m.skeleton, m.bindMatrix); w.position.copy(m.position); w.quaternion.copy(m.quaternion); w.scale.copy(m.scale); w.userData.codexHelper = true; w.frustumCulled = false; m.parent.add(w); restore.push(() => { w.removeFromParent(); w.material.dispose(); }); continue; }
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), new THREE.LineBasicMaterial({ color: '#2b3d52', transparent: true, opacity: 0.85 })); w.userData.codexHelper = true; m.add(w); restore.push(() => { m.remove(w); w.geometry.dispose(); w.material.dispose(); }); }
  }
  if (explode) {
    const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    // explode the top-level parts that contain geometry (or the meshes, if the model is one group)
    let parts = root.children.filter(c => { let has = false; c.traverse(o => { if (o.isMesh) has = true; }); return has; }); if (parts.length < 2) { parts = []; root.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) parts.push(o); }); }
    for (const p of parts) { const pc = new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3()), dir = pc.sub(center); if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0); dir.normalize(); const old = p.position.clone(), worldOff = dir.multiplyScalar(r * explode * 0.6); const parentInv = new THREE.Matrix4().copy(p.parent.matrixWorld).invert(); const local = worldOff.clone().applyMatrix4(new THREE.Matrix4().extractRotation(parentInv)); p.position.add(local); restore.push(() => p.position.copy(old)); }
    root.updateMatrixWorld(true);
  }
  if (skeleton) { const bones = []; root.traverse(o => { if (o.isSkinnedMesh) bones.push(o); }); const rootBone = bones[0]?.skeleton?.bones[0]; if (rootBone) { const h = new THREE.SkeletonHelper(rootBone.parent ?? rootBone); h.userData.codexHelper = true; h.material.depthTest = false; h.material.linewidth = 2; root.add(h); restore.push(() => { root.remove(h); h.dispose?.(); }); } }
  const undo = () => { for (const f of restore.reverse()) f(); root.updateMatrixWorld(true); };
  let r; try { r = fn(); } catch (e) { undo(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(undo); // async renders (path tracer) restore after they finish
  undo(); return r;
}

/** Mesh statistics for inspection overlays and AI critique. */
export function meshStats(root) {
  let tris = 0, verts = 0, meshes = 0, skinned = 0, bones = 0; const mats = new Set(), texs = new Map();
  root.traverse(o => { if (!o.isMesh || o.userData.codexHelper || /_Highlight|_Edge/.test(o.name)) return; meshes++; const g = o.geometry; verts += g.attributes.position.count; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; if (o.isSkinnedMesh) { skinned++; bones = Math.max(bones, o.skeleton.bones.length); }
    for (const m of [o.material].flat()) { mats.add(m); for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) { const t = m[k]; if (t?.image) texs.set(t.uuid, [t.image.width ?? 0, t.image.height ?? 0]); } } });
  const texBytes = [...texs.values()].reduce((s, [w, h]) => s + w * h * 4 * 4 / 3, 0), geoBytes = verts * 48 + tris * 3 * 4;
  return { triangles: Math.round(tris), vertices: verts, meshes, materials: mats.size, textures: texs.size, maxTexture: Math.max(0, ...[...texs.values()].map(([w, h]) => Math.max(w, h))), skinned, bones, drawCalls: [...mats].length ? meshes * 1 : 0, gpuMB: +((texBytes + geoBytes) / 1048576).toFixed(2) };
}

/** Best angle: renders small silhouettes from 16 directions and picks the one that shows the most of the model
 *  (projected area × silhouette spread), preferring a slight top-down elevation. render(angle) → canvas. */
export function bestAngle(render) {
  let best = null;
  for (const el of [12, 24, 38]) for (let az = 0; az < 360; az += 30) {
    const c = render([az, el]), d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0, x0 = c.width, x1 = 0, y0 = c.height, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const fill = n / (c.width * c.height), aspect = (x1 - x0 + 1) / Math.max(1, y1 - y0 + 1), score = fill * (1 - Math.abs(Math.log(Math.max(0.2, aspect))) * 0.15) * (el === 24 ? 1.06 : 1) * (az % 90 === 0 ? 0.93 : 1);
    if (!best || score > best.score) best = { angle: [az, el], score };
  }
  return best.angle;
}
