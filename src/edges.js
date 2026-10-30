import * as THREE from 'three';
import { shellGeometry } from './highlight.js';

// Edge Outline: thin lines on the silhouette AND on hard (crease) edges, like Roblox's classic part outlines.
// Separate from Highlight: no fill by default (fill is optional), no glow. Settings in object.userData.codexEdges.
// Viewer: screen-space edge detection on the adornee's normals/depth (HighlightRenderer.render, kind 'edges').
// Export: real geometry that every engine (and Roblox) renders: square line strips along crease edges plus an
// inverted-hull silhouette, both following skinning.
export const EDGE_DEFAULTS = Object.freeze({
  enabled: true, color: '#000000', transparency: 0, thickness: 2, creaseAngle: 30, silhouette: true, creases: true,
  depthMode: 'Occluded', fill: false, fillColor: '#ffffff', fillTransparency: 0.6, worldThickness: null,
});
export const GLTF_EDGE_EXTENSION = 'CODEX_edges';
const ALIASES = { Color: 'color', Transparency: 'transparency', Thickness: 'thickness', DepthMode: 'depthMode', Enabled: 'enabled', FillColor: 'fillColor', FillTransparency: 'fillTransparency', OutlineColor: 'color', OutlineTransparency: 'transparency', Name: 'name' };
const hex = c => c === null || c === undefined ? c : Array.isArray(c) ? '#' + new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace) : '#' + new THREE.Color(c).getHexString();
export function normalizeEdges(input = {}, base = EDGE_DEFAULTS) {
  const out = { ...base };
  for (const [key, value] of Object.entries(input)) out[ALIASES[key] ?? key] = value;
  out.color = hex(out.color); out.fillColor = hex(out.fillColor);
  out.transparency = THREE.MathUtils.clamp(Number(out.transparency), 0, 1); out.fillTransparency = THREE.MathUtils.clamp(Number(out.fillTransparency), 0, 1);
  out.thickness = THREE.MathUtils.clamp(Number(out.thickness), 0.5, 12); out.creaseAngle = THREE.MathUtils.clamp(Number(out.creaseAngle), 1, 179);
  out.depthMode = /top/i.test(String(out.depthMode)) ? 'AlwaysOnTop' : 'Occluded';
  for (const key of ['enabled', 'silhouette', 'creases', 'fill']) out[key] = !!out[key];
  if (out.worldThickness !== null) out.worldThickness = Math.max(0.0005, Number(out.worldThickness));
  for (const key of ['transparency', 'thickness', 'creaseAngle']) if (!Number.isFinite(out[key])) throw new Error(`Invalid edge ${key}`);
  return out;
}
export function setEdges(object, settings) {
  if (!object?.isObject3D) throw new Error('Edge outline target must be an Object3D');
  if (settings === null) { delete object.userData.codexEdges; return null; }
  const value = normalizeEdges(settings, object.userData.codexEdges ?? EDGE_DEFAULTS);
  value.name ??= `${object.name || 'Asset'}Edges`;
  object.userData.codexEdges = value; return value;
}
export function collectEdges(root) { const list = []; root?.traverse(o => { if (o.userData?.codexEdges && !o.userData.codexHighlightShell) list.push({ object: o, settings: o.userData.codexEdges, kind: 'edges' }); }); return list; }
export const edgeMeshes = object => { const out = []; object.traverse(o => { if (o.isMesh && o.visible && !o.userData.codexHighlightShell) out.push(o); }); return out; };

// ---------- Viewer shaders (used by HighlightRenderer) ----------
export const edgePrepShader = {
  uniforms: { tMask: { value: null }, tMaskDepth: { value: null }, tSceneDepth: { value: null }, texel: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 100 }, ortho: { value: false }, creaseCos: { value: 0.86 }, silhouette: { value: true }, creases: { value: true } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `#include <packing>
    uniform sampler2D tMask, tMaskDepth, tSceneDepth; uniform vec2 texel; uniform float near, far, creaseCos; uniform bool ortho, silhouette, creases; varying vec2 vUv;
    float viewZ(float d){ return ortho ? orthographicDepthToViewZ(d, near, far) : perspectiveDepthToViewZ(d, near, far); }
    void main(){
      vec4 m = texture2D(tMask, vUv);
      if (m.a < 0.001) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec3 n = normalize(m.rgb * 2.0 - 1.0); float z = viewZ(texture2D(tMaskDepth, vUv).x), edge = 0.0;
      vec2 offs[4]; offs[0] = vec2(texel.x, 0.0); offs[1] = vec2(-texel.x, 0.0); offs[2] = vec2(0.0, texel.y); offs[3] = vec2(0.0, -texel.y);
      for (int i = 0; i < 4; i++) {
        vec4 o = texture2D(tMask, vUv + offs[i]);
        if (o.a < 0.001) { if (silhouette) edge = 1.0; continue; }
        if (!creases) continue;
        if (dot(n, normalize(o.rgb * 2.0 - 1.0)) < creaseCos) edge = 1.0;
        float zo = viewZ(texture2D(tMaskDepth, vUv + offs[i]).x);
        if (abs(zo - z) > max(0.02, abs(z) * 0.012)) edge = 1.0; // overlapping parts of the same model
      }
      float sz = viewZ(texture2D(tSceneDepth, vUv).x), occluded = step(abs(z) * 0.003 + 0.0008, sz - z);
      gl_FragColor = vec4(edge, edge * (1.0 - occluded), 0.0, 1.0);
    }`,
};
export const edgeCompositeShader = {
  uniforms: { tMask: { value: null }, tDist: { value: null }, tMaskDepth: { value: null }, tSceneDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 }, ortho: { value: false }, color: { value: new THREE.Color() }, alpha: { value: 1 }, thickness: { value: 2 }, fillColor: { value: new THREE.Color() }, fillAlpha: { value: 0 }, occludedMode: { value: true } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `#include <packing>
    uniform sampler2D tMask, tDist, tMaskDepth, tSceneDepth; uniform float near, far, alpha, thickness, fillAlpha; uniform vec3 color, fillColor; uniform bool ortho, occludedMode; varying vec2 vUv;
    float viewZ(float d){ return ortho ? orthographicDepthToViewZ(d, near, far) : perspectiveDepthToViewZ(d, near, far); }
    void main(){
      vec2 d2 = texture2D(tDist, vUv).rg; float dist = occludedMode ? d2.y : d2.x, halfWidth = thickness * 0.5;
      float la = alpha * (1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, dist));
      float fa = 0.0;
      if (fillAlpha > 0.0 && texture2D(tMask, vUv).a > 0.001) {
        float z = viewZ(texture2D(tMaskDepth, vUv).x), sz = viewZ(texture2D(tSceneDepth, vUv).x);
        fa = fillAlpha * (occludedMode ? 1.0 - step(abs(z) * 0.003 + 0.0008, sz - z) : 1.0);
      }
      vec4 c = vec4(fillColor * fa, fa);
      gl_FragColor = vec4(color * la, la) + c * (1.0 - la);
    }`,
};

// ---------- Export geometry ----------
/** Square line strips along crease edges (EdgesGeometry), carrying skin weights from the source vertices. */
export function edgeLineGeometry(source, creaseAngle, width) {
  const edges = new THREE.EdgesGeometry(source, creaseAngle), ep = edges.attributes.position, sp = source.attributes.position;
  const skinIndex = source.attributes.skinIndex, skinWeight = source.attributes.skinWeight, key = (x, y, z) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
  const lookup = new Map(); if (skinIndex) for (let i = 0; i < sp.count; i++) lookup.set(key(sp.getX(i), sp.getY(i), sp.getZ(i)), i);
  const pos = [], idx = [], si = [], sw = [], a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), h = width / 2;
  for (let e = 0; e < ep.count; e += 2) {
    a.fromBufferAttribute(ep, e); b.fromBufferAttribute(ep, e + 1); dir.subVectors(b, a); const len = dir.length(); if (len < 1e-7) continue; dir.divideScalar(len);
    // Extend slightly so strips meet cleanly at corners.
    const a2 = a.clone().addScaledVector(dir, -h), b2 = b.clone().addScaledVector(dir, h);
    u.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? 1 : 0, 0).cross(dir).normalize(); v.crossVectors(dir, u).normalize();
    const base = pos.length / 3, corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (const p of [a2, b2]) for (const [cu, cv] of corners) pos.push(p.x + (u.x * cu + v.x * cv) * h, p.y + (u.y * cu + v.y * cv) * h, p.z + (u.z * cu + v.z * cv) * h);
    for (let s = 0; s < 4; s++) { const s2 = (s + 1) % 4; idx.push(base + s, base + s2, base + 4 + s2, base + s, base + 4 + s2, base + 4 + s); }
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2, base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
    if (skinIndex) for (const p of [a, b]) {
      const src = lookup.get(key(p.x, p.y, p.z)) ?? 0;
      for (let c = 0; c < 4; c++) { si.push(skinIndex.getX(src), skinIndex.getY(src), skinIndex.getZ(src), skinIndex.getW(src)); sw.push(skinWeight.getX(src), skinWeight.getY(src), skinWeight.getZ(src), skinWeight.getW(src)); }
    }
  }
  edges.dispose();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  if (skinIndex) { g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4)); }
  g.computeVertexNormals(); return g;
}
/** Adds `<mesh>_EdgeLines`, `<mesh>_EdgeSilhouette` (and optional `_EdgeFill`) next to outlined meshes. Call on an export copy. */
export function bakeEdgeGeometry(root) {
  root.updateMatrixWorld(true); let count = 0;
  for (const { object, settings: s } of collectEdges(root)) {
    if (!s.enabled) continue;
    const diag = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).length() || 1;
    const world = s.worldThickness ?? THREE.MathUtils.clamp(diag * 0.0025 * s.thickness, 0.002, 0.05);
    for (const mesh of edgeMeshes(object)) {
      const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1, parts = [];
      if (s.creases) parts.push(['Lines', edgeLineGeometry(mesh.geometry, s.creaseAngle, world / scale), s.color, 1 - s.transparency]);
      if (s.silhouette) parts.push(['Silhouette', shellGeometry(mesh.geometry, world * 0.5 / scale, true), s.color, 1 - s.transparency]);
      if (s.fill && s.fillTransparency < 0.99) parts.push(['Fill', shellGeometry(mesh.geometry, world * 0.05 / scale, false), s.fillColor, 1 - s.fillTransparency]);
      for (const [kind, geo, color, opacity] of parts) {
        if (!geo.attributes.position.count) { geo.dispose(); continue; }
        const mat = new THREE.MeshBasicMaterial({ name: `Edge_${kind}`, color, transparent: opacity < 1, opacity, depthWrite: kind !== 'Fill' });
        let out;
        if (mesh.isSkinnedMesh) { out = new THREE.SkinnedMesh(geo, mat); out.bind(mesh.skeleton, mesh.bindMatrix); }
        else if (mesh.isInstancedMesh) { out = new THREE.InstancedMesh(geo, mat, mesh.count); out.instanceMatrix.copy(mesh.instanceMatrix); }
        else out = new THREE.Mesh(geo, mat);
        out.name = `${mesh.name || 'Mesh'}_Edge${kind}`; out.userData = { codexHighlightShell: `edge-${kind.toLowerCase()}`, edges: s.name };
        out.position.copy(mesh.position); out.quaternion.copy(mesh.quaternion); out.scale.copy(mesh.scale); out.castShadow = out.receiveShadow = false;
        mesh.parent.add(out); count++;
      }
    }
  }
  return count;
}
export function tagEdgeExtensions(root) {
  let n = 0; for (const { object, settings } of collectEdges(root)) { object.userData.gltfExtensions = { ...object.userData.gltfExtensions, [GLTF_EDGE_EXTENSION]: { ...settings } }; n++; } return n;
}
export function restoreImportedEdges(root) {
  let n = 0;
  root.traverse(o => { const ext = o.userData?.gltfExtensions?.[GLTF_EDGE_EXTENSION]; if (ext || (o.userData?.codexEdges && !o.userData.codexHighlightShell)) { o.userData.codexEdges = normalizeEdges(ext ?? o.userData.codexEdges); n++; } if (ext) delete o.userData.gltfExtensions[GLTF_EDGE_EXTENSION]; });
  return n;
}
/** CodexOutline definitions (Luau) for edge outlines; lines + silhouette are styled as the "outline" group. */
export function edgeLuauDefinitions(root, modelName, rgb, lua) {
  const n = v => +Number(v).toFixed(3);
  return collectEdges(root).map(({ object, settings: s }) => {
    const meshes = edgeMeshes(object).map(m => m.name || 'Mesh'), list = suffixes => `{${meshes.flatMap(m => suffixes.map(x => lua(`${m}_Edge${x}`))).join(', ')}}`;
    return [`\t{`, `\t\tName = ${lua(s.name)}, Kind = "Edges", Adornee = ${lua(object === root ? modelName : object.name)}, Enabled = ${s.enabled},`,
      `\t\tOutlineColor = Color3.fromRGB(${rgb(s.color)}), OutlineTransparency = ${n(s.transparency)},`,
      `\t\tFillColor = Color3.fromRGB(${rgb(s.fillColor)}), FillTransparency = ${n(s.fill ? s.fillTransparency : 1)},`,
      `\t\tGlowColor = Color3.new(0, 0, 0), GlowTransparency = 1, DepthMode = ${lua(s.depthMode)}, Pulse = nil,`,
      `\t\tOutline = ${list(['Lines', 'Silhouette'])}, Fill = ${list(['Fill'])}, Glow = {},`, `\t},`].join('\n');
  });
}
