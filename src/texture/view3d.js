// Texture Studio 3D: real-time PBR preview (MeshPhysicalMaterial, PMREM room environment), preview meshes or an
// imported GLB, Roblox-like / studio / dramatic lighting, channel inspection, UV checker, wireframe, tiling, A/B compare,
// 3D painting on the model (UV-space layers with brush/eraser/fill, pressure, X symmetry, undo) and geometry masks
// (curvature, convex, concave, slope, up, height, AO) baked from the mesh into UV space for the meshMask node.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toRGBA } from './graph.js';
import { smartUV, uvStats } from '../uv.js';
import { bakeHighToLow } from '../bake-hilo.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const canvasFrom = (rgba, S) => { const c = document.createElement('canvas'); c.width = c.height = S; c.getContext('2d').putImageData(new ImageData(rgba, S, S), 0, 0); return c; };
function checker(S = 512) { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), n = 16; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#d9e4cf' : '#3a4a36'; g.fillRect(x * S / n, y * S / n, S / n, S / n); } g.fillStyle = '#c0392b'; g.font = `${S / 20}px sans-serif`; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.fillText(`${'ABCD'[y]}${x + 1}`, x * S / 4 + 6, y * S / 4 + S / 16); return c; }

export class TextureView {
  constructor(host) {
    this.host = host; this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); this.renderer.setPixelRatio(Math.min(2, devicePixelRatio)); this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.append(this.renderer.domElement); this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#141814');
    const pm = new THREE.PMREMGenerator(this.renderer); this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environment = this.env;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100); this.camera.position.set(2.2, 1.5, 2.6); this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.key = new THREE.DirectionalLight('#ffffff', 2.2); this.key.position.set(3, 4, 2); this.fill = new THREE.DirectionalLight('#9fb8ff', 0.6); this.fill.position.set(-3, 1, -2); this.amb = new THREE.HemisphereLight('#ffffff', '#30302a', 0.25); this.scene.add(this.key, this.fill, this.amb);
    this.mat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 1, metalness: 1 }); this.wire = new THREE.LineSegments(undefined, new THREE.LineBasicMaterial({ color: '#d2e8a8', transparent: true, opacity: 0.35 })); this.wire.visible = false;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.8, 128, 64), this.mat); this.scene.add(this.mesh, this.wire); this.setShape('sphere');
    this.repeat = 1; this.channel = 'lit'; this.textures = {}; this.B = null; this.showB = false; this.size = 256; this.paint = { on: false, layers: {}, tool: 'brush', channel: 'baseColor', color: '#ff8a2a', value: 1, radius: 0.03, opacity: 0.8, hardness: 0.6, symmetry: false, history: [] };
    new ResizeObserver(() => this.resize()).observe(host); this.resize(); this.loop = this.loop.bind(this); requestAnimationFrame(this.loop); this.bindPaint();
  }
  resize() { const w = this.host.clientWidth || 300, h = this.host.clientHeight || 300; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  loop() { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(this.loop); }
  setShape(kind) {
    const G = { sphere: () => new THREE.SphereGeometry(0.8, 128, 64), cube: () => new THREE.BoxGeometry(1.2, 1.2, 1.2, 1, 1, 1), plane: () => new THREE.PlaneGeometry(2, 2, 1, 1).rotateX(-Math.PI / 2), cylinder: () => new THREE.CylinderGeometry(0.6, 0.6, 1.4, 96, 1), torus: () => new THREE.TorusKnotGeometry(0.5, 0.18, 300, 48), rock: () => { const g = new THREE.IcosahedronGeometry(0.8, 5), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i), n = Math.sin(v.x * 4.1) * Math.sin(v.y * 3.7) * Math.cos(v.z * 4.3); v.multiplyScalar(1 + n * 0.12 + Math.sin(v.y * 9) * 0.03); p.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; } }[kind];
    if (G) this.setGeometry(G(), kind);
  }
  setGeometry(geo, name = 'custom') {
    if (!geo.attributes.uv) throw new Error('This mesh has no UVs; textures and painting need UV coordinates');
    if (!geo.attributes.normal) geo.computeVertexNormals(); geo.computeTangents?.();
    this.mesh.geometry.dispose(); this.mesh.geometry = geo; this.wire.geometry?.dispose(); this.wire.geometry = new THREE.WireframeGeometry(geo); this.meshName = name; this.masks = null;
    geo.computeBoundingSphere(); const r = geo.boundingSphere.radius; this.controls.target.copy(geo.boundingSphere.center); this.camera.position.copy(geo.boundingSphere.center).add(new THREE.Vector3(1.4, 0.9, 1.6).multiplyScalar(r * 1.6));
  }
  async loadGLB(file) {
    const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), ''); let geo = null;
    gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (!geo && o.isMesh && o.geometry.attributes.uv) { geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); } });
    if (!geo) throw new Error('No mesh with UVs in this file'); geo.center(); const s = 1.6 / (new THREE.Box3().setFromBufferAttribute(geo.attributes.position).getSize(new THREE.Vector3()).length() || 1); geo.scale(s, s, s); this.setGeometry(geo, file.name);
  }
  lighting(preset) {
    const P = { studio: [2.2, 0.6, 0.25, 1], roblox: [1.6, 0.0, 0.55, 0.35], dramatic: [3.2, 0.15, 0.05, 0.4], flat: [0, 0, 1.2, 1] }[preset] ?? [2.2, 0.6, 0.25, 1];
    [this.key.intensity, this.fill.intensity, this.amb.intensity] = P; this.scene.environmentIntensity = P[3]; if (preset === 'roblox') this.key.position.set(1, 5, 1.5); else this.key.position.set(3, 4, 2);
  }
  /** maps (evaluated, image row order) → textures. Keeps the previous set as "B" for A/B compare. */
  setMaps(maps, S, { keepB = true } = {}) {
    if (keepB && this.textures.map) this.B = { ...this.textures };
    this.size = S; this.maps = maps; const tex = (b, srgb, opts) => { const t = new THREE.CanvasTexture(canvasFrom(toRGBA(b, S, opts), S)); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(this.repeat, this.repeat); return t; };
    this.base = maps.baseColor; this.textures = { map: tex(this.painted('baseColor'), true), normalMap: tex(maps.normal, false), roughnessMap: tex(this.painted('roughness'), false), metalnessMap: tex(this.painted('metalness'), false), aoMap: tex(maps.ao, false), emissiveMap: maps.emissive ? tex(maps.emissive, true) : null, alphaMap: maps.opacity ? tex(maps.opacity, false) : null };
    this.channelMaps = Object.fromEntries(Object.entries(maps).map(([k, b]) => [k, b]));
    this.apply();
  }
  painted(ch) { const L = this.paint.layers[ch], b = this.maps[ch]; if (!L || !b) return b; return compositePaint(b, L, this.size); }
  apply() {
    const T = this.showB && this.B ? this.B : this.textures, m = this.mat; for (const t of Object.values(T)) t?.repeat.set(this.repeat, this.repeat);
    if (this.channel === 'lit') { Object.assign(m, { map: T.map, normalMap: T.normalMap, roughnessMap: T.roughnessMap, metalnessMap: T.metalnessMap, aoMap: T.aoMap, emissiveMap: T.emissiveMap, alphaMap: T.alphaMap, transparent: !!T.alphaMap, roughness: 1, metalness: 1 }); m.emissive.set(T.emissiveMap ? '#ffffff' : '#000000'); m.emissiveIntensity = 2; this.mesh.material = m; }
    else { const src = this.channel === 'uv' ? new THREE.CanvasTexture(checker()) : this.channel === 'baseColor' ? T.map : this.channel === 'normal' ? T.normalMap : { roughness: T.roughnessMap, metalness: T.metalnessMap, ao: T.aoMap, emissive: T.emissiveMap, opacity: T.alphaMap }[this.channel] ?? this.flatTex(this.channel);
      if (src) { src.wrapS = src.wrapT = THREE.RepeatWrapping; src.repeat.set(this.repeat, this.repeat); src.colorSpace = this.channel === 'baseColor' || this.channel === 'uv' ? THREE.SRGBColorSpace : THREE.NoColorSpace; }
      this.mesh.material = new THREE.MeshBasicMaterial({ map: src ?? null, color: src ? '#ffffff' : '#000000' }); }
    m.needsUpdate = true; if (!this.mesh.geometry.attributes.uv1 && this.mesh.geometry.attributes.uv) this.mesh.geometry.setAttribute('uv1', this.mesh.geometry.attributes.uv);
  }
  flatTex(ch) { const b = this.maps?.[ch]; if (!b) return null; const t = new THREE.CanvasTexture(canvasFrom(toRGBA(b, this.size), this.size)); return t; }
  setRepeat(r) { this.repeat = r; this.apply(); }
  setWire(on) { this.wire.visible = on; }
  setChannel(ch) { this.channel = ch; this.apply(); }
  toggleB() { this.showB = !this.showB && !!this.B; this.apply(); return this.showB; }

  // ---------- 3D painting ----------
  layer(ch) { const S = this.size; let L = this.paint.layers[ch]; if (!L || L.width !== S) { L = document.createElement('canvas'); L.width = L.height = S; this.paint.layers[ch] = L; } return L; }
  bindPaint() {
    const el = this.renderer.domElement, ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = false;
    const hit = e => { const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, this.camera); return ray.intersectObject(this.mesh)[0]; };
    const stamp = (h, e) => {
      if (!h?.uv) return; const P = this.paint, L = this.layer(P.channel), g = L.getContext('2d'), S = this.size, pr = e.pressure > 0 && e.pointerType === 'pen' ? e.pressure : 1, rad = P.radius * S * (0.4 + 0.6 * pr);
      const draw = uv => { const x = ((uv.x * this.repeat) % 1 + 1) % 1 * S, y = (1 - ((uv.y * this.repeat) % 1 + 1) % 1) * S, col = P.channel === 'baseColor' ? P.color : `rgb(${P.value * 255},${P.value * 255},${P.value * 255})`;
        for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); gr.addColorStop(0, col); gr.addColorStop(P.hardness, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.globalCompositeOperation = P.tool === 'eraser' ? 'destination-out' : 'source-over'; g.globalAlpha = P.opacity * pr; g.fillStyle = P.tool === 'eraser' ? '#000' : gr; if (P.tool === 'eraser') { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill(); } else g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2); } g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; };
      draw(h.uv);
      if (P.symmetry) { const p = h.point.clone(); p.x = -p.x; const o = p.clone().add(h.face.normal.clone().multiply(new THREE.Vector3(-1, 1, 1)).multiplyScalar(0.5)); ray.set(o, p.clone().sub(o).normalize()); const m = ray.intersectObject(this.mesh)[0]; if (m?.uv) draw(m.uv); }
      this.refreshPaint();
    };
    el.addEventListener('pointerdown', e => { if (!this.paint.on || e.button !== 0) return; const h = hit(e); if (!h) return; e.preventDefault(); this.controls.enabled = false; down = true; this.pushHistory(); if (this.paint.tool === 'fill') { const L = this.layer(this.paint.channel), g = L.getContext('2d'); g.globalAlpha = this.paint.opacity; g.fillStyle = this.paint.channel === 'baseColor' ? this.paint.color : `rgb(${this.paint.value * 255},${this.paint.value * 255},${this.paint.value * 255})`; g.fillRect(0, 0, L.width, L.height); g.globalAlpha = 1; this.refreshPaint(); down = false; return; } stamp(h, e); el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (down) stamp(hit(e), e); });
    const up = () => { if (down) { down = false; this.controls.enabled = true; this.onPaint?.(); } }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  pushHistory() { const P = this.paint, L = this.layer(P.channel); P.history.push({ ch: P.channel, data: L.getContext('2d').getImageData(0, 0, L.width, L.height) }); if (P.history.length > 25) P.history.shift(); }
  undo() { const h = this.paint.history.pop(); if (!h) return false; this.layer(h.ch).getContext('2d').putImageData(h.data, 0, 0); this.refreshPaint(); this.onPaint?.(); return true; }
  clearPaint(ch) { if (ch) delete this.paint.layers[ch]; else this.paint.layers = {}; this.refreshPaint(); this.onPaint?.(); }
  refreshPaint() { if (!this.maps) return; const S = this.size; for (const [ch, key, srgb] of [['baseColor', 'map', true], ['roughness', 'roughnessMap', false], ['metalness', 'metalnessMap', false]]) if (this.paint.layers[ch]) { const t = this.textures[key]; const c = canvasFrom(toRGBA(this.painted(ch), S), S); t.image = c; t.needsUpdate = true; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; } }
  /** Paint layers merged into the evaluated maps (for export). */
  paintedMaps(maps) { const out = { ...maps }; for (const ch of Object.keys(this.paint.layers)) if (maps[ch]) out[ch] = compositePaint(maps[ch], this.paint.layers[ch], this.size); return out; }

  // ---------- automatic UVs + high → low baking ----------
  autoUV(opts = {}) { const g = smartUV(this.mesh.geometry, opts); this.setGeometry(g, this.meshName + ' (auto UV)'); return { charts: g.userData.uvCharts, ...uvStats(g) }; }
  uvStats() { return uvStats(this.mesh.geometry); }
  async loadHighPoly(file) { const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), ''); const parts = []; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); parts.push(g.index ? g.toNonIndexed() : g); } });
    if (!parts.length) throw new Error('No mesh in the high-poly file'); const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js'); this.high = mergeVertices(mergeGeometries(parts)); this.high.computeVertexNormals(); return { triangles: this.high.index.count / 3 }; }
  /** High → low bake onto the preview mesh (its UVs). High defaults to a loaded GLB. Baked maps become meshMask/bakedMap inputs. */
  bake({ size = this.size, cage = 0.02, ao = 16, high = this.high, alignHigh = true } = {}) {
    if (!high) throw new Error('Load a high-poly mesh first (↥ High-poly)');
    let hi = high; if (alignHigh) { const lb = new THREE.Box3().setFromBufferAttribute(this.mesh.geometry.attributes.position), hb = new THREE.Box3().setFromBufferAttribute(high.attributes.position), k = lb.getSize(new THREE.Vector3()).length() / (hb.getSize(new THREE.Vector3()).length() || 1); hi = high.clone().translate(...hb.getCenter(new THREE.Vector3()).negate().toArray()).scale(k, k, k).translate(...lb.getCenter(new THREE.Vector3()).toArray()); }
    const r = bakeHighToLow({ high: hi, low: this.mesh.geometry, size, cage, ao }); this.masks ??= {};
    for (const m of ['normal', 'ao', 'height', 'curvature', 'position']) if (r[m]) this.masks['baked:' + m] = { size, c: r[m].c, d: r[m].d };
    this.baked = r; return r.stats;
  }

  // ---------- geometry masks baked into UV space ----------
  bakeMasks(S) {
    const geo = this.mesh.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, n = pos.count, key = i => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const id = new Map(), weld = new Int32Array(n); for (let i = 0; i < n; i++) { const k = key(i); if (!id.has(k)) id.set(k, id.size); weld[i] = id.get(k); }
    const W = id.size, P = new Float32Array(W * 3), N = new Float32Array(W * 3), nb = Array.from({ length: W }, () => new Set());
    for (let i = 0; i < n; i++) { const w = weld[i]; P[w * 3] = pos.getX(i); P[w * 3 + 1] = pos.getY(i); P[w * 3 + 2] = pos.getZ(i); N[w * 3] += nor.getX(i); N[w * 3 + 1] += nor.getY(i); N[w * 3 + 2] += nor.getZ(i); }
    const index = geo.index ? geo.index.array : Array.from({ length: n }, (_, i) => i);
    for (let t = 0; t < index.length; t += 3) { const a = weld[index[t]], b = weld[index[t + 1]], c = weld[index[t + 2]]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
    const curv = new Float32Array(W); let cmax = 1e-6;
    for (let w = 0; w < W; w++) { const nl = Math.hypot(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]) || 1; let s = 0; for (const j of nb[w]) { const dx = P[j * 3] - P[w * 3], dy = P[j * 3 + 1] - P[w * 3 + 1], dz = P[j * 3 + 2] - P[w * 3 + 2], l = Math.hypot(dx, dy, dz) || 1; s += (N[w * 3] * dx + N[w * 3 + 1] * dy + N[w * 3 + 2] * dz) / nl / l; } curv[w] = s / Math.max(1, nb[w].size); cmax = Math.max(cmax, Math.abs(curv[w])); }
    const box = new THREE.Box3().setFromBufferAttribute(pos), ymin = box.min.y, yr = (box.max.y - box.min.y) || 1, ray = new THREE.Raycaster(), ao = new Float32Array(W).fill(1), R = box.getSize(new THREE.Vector3()).length() * 0.35;
    if (W <= 12000) { const dirs = Array.from({ length: 16 }, (_, i) => { const a = i * 2.399963, z = 1 - (i + 0.5) / 16, r = Math.sqrt(1 - z * z); return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z); }), side = this.mesh.material.side; this.mesh.material.side = THREE.DoubleSide;
      for (let w = 0; w < W; w++) { const nn = new THREE.Vector3(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]).normalize(), o = new THREE.Vector3(P[w * 3], P[w * 3 + 1], P[w * 3 + 2]).addScaledVector(nn, 0.002), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nn); let blocked = 0; for (const d of dirs) { ray.set(o, d.clone().applyQuaternion(q)); ray.far = R; if (ray.intersectObject(this.mesh, false).length) blocked++; } ao[w] = 1 - blocked / dirs.length; } this.mesh.material.side = side; }
    const per = { curvature: w => 0.5 - curv[w] / cmax * 0.5, convex: w => Math.max(0, -curv[w] / cmax), concave: w => Math.max(0, curv[w] / cmax), up: w => Math.max(0, N[w * 3 + 1] / (Math.hypot(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]) || 1)), slope: w => 1 - Math.abs(N[w * 3 + 1] / (Math.hypot(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]) || 1)), height: w => (P[w * 3 + 1] - ymin) / yr, ao: w => ao[w] };
    const out = {};
    for (const [kind, f] of Object.entries(per)) {
      const d = new Float32Array(S * S).fill(-1);
      for (let t = 0; t < index.length; t += 3) { const ii = [index[t], index[t + 1], index[t + 2]], px = ii.map(i => [uv.getX(i) * S, (1 - uv.getY(i)) * S]), val = ii.map(i => f(weld[i]));
        const x0 = Math.max(0, Math.floor(Math.min(...px.map(p => p[0])))), x1 = Math.min(S - 1, Math.ceil(Math.max(...px.map(p => p[0])))), y0 = Math.max(0, Math.floor(Math.min(...px.map(p => p[1])))), y1 = Math.min(S - 1, Math.ceil(Math.max(...px.map(p => p[1]))));
        const [a, b, c] = px, den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(den) < 1e-9) continue;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const l1 = ((b[1] - c[1]) * (x + 0.5 - c[0]) + (c[0] - b[0]) * (y + 0.5 - c[1])) / den, l2 = ((c[1] - a[1]) * (x + 0.5 - c[0]) + (a[0] - c[0]) * (y + 0.5 - c[1])) / den, l3 = 1 - l1 - l2; if (l1 >= -0.01 && l2 >= -0.01 && l3 >= -0.01) d[y * S + x] = l1 * val[0] + l2 * val[1] + l3 * val[2]; } }
      for (let pass = 0; pass < 4; pass++) for (let k = 0; k < S * S; k++) if (d[k] < 0) { const x = k % S, y = (k / S) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (((y + dy + S) % S) * S + ((x + dx + S) % S)); if (d[j] >= 0) { d[k] = d[j]; break; } } } // bake padding / dilation
      for (let k = 0; k < S * S; k++) if (d[k] < 0) d[k] = 0.5; out[kind] = { size: S, d };
    }
    this.masks = { ...Object.fromEntries(Object.entries(this.masks ?? {}).filter(([k]) => k.startsWith('baked:'))), ...out }; return out;
  }
  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

function compositePaint(b, L, S) {
  const px = L.getContext('2d').getImageData(0, 0, S, S).data, c = b.c, o = new Float32Array(b.d);
  for (let k = 0; k < S * S; k++) { const a = px[k * 4 + 3] / 255; if (!a) continue; if (c === 3) for (let ch = 0; ch < 3; ch++) o[k * 3 + ch] = o[k * 3 + ch] * (1 - a) + px[k * 4 + ch] / 255 * a; else o[k] = o[k] * (1 - a) + px[k * 4] / 255 * a; }
  return { c, d: o };
}
