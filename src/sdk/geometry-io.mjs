// Geometry I/O for the SDK in Node (no DOM): read .glb / .gltf (positions, normals, UVs, indices, node transforms;
// textures ignored) and .obj into one merged BufferGeometry; write a geometry back as a minimal .glb (used by Auto UV).
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }, SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
export async function loadGeometry(file) {
  const ext = path.extname(file).toLowerCase(), bytes = await readFile(file);
  if (ext === '.obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); const obj = new OBJLoader().parse(bytes.toString('utf8')); const parts = []; obj.updateMatrixWorld(true); obj.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); parts.push(g); } }); return finish(parts); }
  let json, bin = null;
  if (ext === '.glb') { const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB'); let o = 12; while (o < bytes.length) { const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true), chunk = bytes.subarray(o + 8, o + 8 + len); if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)); else if (type === 0x004e4942) bin = chunk; o += 8 + len; } }
  else if (ext === '.gltf') json = JSON.parse(bytes.toString('utf8'));
  else throw new Error(`Unsupported mesh file ${ext} (use .glb, .gltf or .obj)`);
  const buffers = await Promise.all((json.buffers ?? []).map(async (b, i) => !b.uri ? bin : b.uri.startsWith('data:') ? Buffer.from(b.uri.split(',')[1], 'base64') : readFile(path.join(path.dirname(file), decodeURIComponent(b.uri)))));
  const accessor = i => { const a = json.accessors[i], v = json.bufferViews[a.bufferView], buf = buffers[v.buffer], C = COMP[a.componentType], n = SIZE[a.type], stride = v.byteStride ?? 0, off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out = new C(a.count * n);
    if (!stride || stride === n * C.BYTES_PER_ELEMENT) out.set(new C(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + a.count * n * C.BYTES_PER_ELEMENT)));
    else { const dv = new DataView(buf.buffer, buf.byteOffset); for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) { const p = off + k * stride + c * C.BYTES_PER_ELEMENT; out[k * n + c] = C === Float32Array ? dv.getFloat32(p, true) : C === Uint16Array ? dv.getUint16(p, true) : C === Uint32Array ? dv.getUint32(p, true) : dv.getUint8(p); } }
    return { array: out, itemSize: n, normalized: !!a.normalized }; };
  const parts = [], walk = (ni, parent) => { const n = json.nodes[ni], m = new THREE.Matrix4(); if (n.matrix) m.fromArray(n.matrix); else m.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1]))); const w = parent.clone().multiply(m);
    if (n.mesh !== undefined) for (const prim of json.meshes[n.mesh].primitives) { if ((prim.mode ?? 4) !== 4) continue; const g = new THREE.BufferGeometry(); for (const [k, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) if (prim.attributes[k] !== undefined) { const a = accessor(prim.attributes[k]); g.setAttribute(name, new THREE.BufferAttribute(Float32Array.from(a.array, x => a.normalized ? x / 65535 : x), a.itemSize)); } if (prim.indices !== undefined) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(accessor(prim.indices).array), 1)); g.applyMatrix4(w); parts.push(g); }
    for (const c of n.children ?? []) walk(c, w); };
  for (const r of json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i)) walk(r, new THREE.Matrix4());
  return finish(parts);
}
function finish(parts) {
  if (!parts.length) throw new Error('No triangle mesh in the file');
  const keep = ['position', 'normal', 'uv'].filter(k => parts.every(p => p.attributes[k])); for (const p of parts) for (const k of Object.keys(p.attributes)) if (!keep.includes(k)) p.deleteAttribute(k);
  const g = mergeGeometries(parts.map(p => p.index ? p : mergeVertices(p))); if (!g.attributes.normal) g.computeVertexNormals(); return g;
}
/** Minimal GLB writer: one mesh (position, normal, uv, indices). */
export function geometryToGLB(geo, name = 'mesh') {
  const g = geo.index ? geo : mergeVertices(geo), attrs = ['position', 'normal', 'uv'].filter(k => g.attributes[k]), chunks = [], views = [], accessors = []; let off = 0;
  const add = (arr, target) => { const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - (b.length % 4)) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); chunks.push(b, new Uint8Array(pad)); off += b.length + pad; return views.length - 1; };
  const attributes = {}; for (const k of attrs) { const a = g.attributes[k], arr = Float32Array.from(a.array), n = a.itemSize, acc = { bufferView: add(arr, 34962), componentType: 5126, count: a.count, type: ['', 'SCALAR', 'VEC2', 'VEC3', 'VEC4'][n] }; if (k === 'position') { g.computeBoundingBox(); acc.min = g.boundingBox.min.toArray(); acc.max = g.boundingBox.max.toArray(); } accessors.push(acc); attributes[{ position: 'POSITION', normal: 'NORMAL', uv: 'TEXCOORD_0' }[k]] = accessors.length - 1; }
  accessors.push({ bufferView: add(Uint32Array.from(g.index.array), 34963), componentType: 5125, count: g.index.count, type: 'SCALAR' });
  const binLen = off, json = { asset: { version: '2.0', generator: 'Codex Design SDK' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }], meshes: [{ name, primitives: [{ attributes, indices: accessors.length - 1 }] }], accessors, bufferViews: views, buffers: [{ byteLength: binLen }] };
  let js = new TextEncoder().encode(JSON.stringify(json)); const jp = (4 - (js.length % 4)) % 4; js = Uint8Array.from([...js, ...Array(jp).fill(0x20)]);
  const total = 12 + 8 + js.length + 8 + binLen, out = new Uint8Array(total), dv = new DataView(out.buffer); dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20); let o = 20 + js.length; dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
