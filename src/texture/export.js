import { META } from '../watermark.js';
// Texture Studio export profiles: one evaluated material → ready-to-import map sets per engine (isomorphic).
// Each profile picks the maps, channel packing, normal convention (OpenGL/DirectX), color space notes, resolution cap
// and writes an engine material file where the format is text (Roblox .rbxmx SurfaceAppearance/MaterialVariant,
// Godot .tres, glTF 2.0 .gltf, Unity/Unreal/Blender setup JSON). Compressed GPU formats (BCn/ASTC/ETC2) are chosen by
// the engine on import; the memory table estimates them, the files themselves are PNG.
import { toRGBA, pack, toGray, heightToNormal } from './graph.js';
import { writeEXR } from '../exr.js';
import { encodePNG } from '../png.js';
import { inst, T, ENUM } from '../rbx/instances.js';
import { toRBXMX } from '../rbx/rbxmx.js';

const GL = 'OpenGL (+Y)', DX = 'DirectX (−Y)';
export const PROFILES = {
  'roblox-surfaceappearance': { label: 'Roblox · SurfaceAppearance (MeshPart)', engine: 'Roblox', max: 1024, normal: GL, maps: { ColorMap: 'baseColor+opacity', NormalMap: 'normal', RoughnessMap: 'roughness', MetalnessMap: 'metalness' } },
  'roblox-materialvariant': { label: 'Roblox · MaterialVariant (Parts / terrain)', engine: 'Roblox', max: 1024, normal: GL, maps: { ColorMap: 'baseColor', NormalMap: 'normal', RoughnessMap: 'roughness', MetalnessMap: 'metalness' } },
  'unity-urp': { label: 'Unity · URP / Built-in Lit', engine: 'Unity', max: 4096, normal: GL, maps: { BaseMap: 'baseColor+opacity', NormalMap: 'normal', MetallicSmoothness: 'pack:metal,metal,metal,smooth', Occlusion: 'ao', Emission: 'emissive', Height: 'height' } },
  'unity-hdrp': { label: 'Unity · HDRP Lit', engine: 'Unity', max: 4096, normal: GL, maps: { BaseColor: 'baseColor+opacity', Normal: 'normal', MaskMap: 'pack:metal,ao,1,smooth', Emissive: 'emissive', Height: 'height' } },
  'unreal': { label: 'Unreal Engine 5 · ORM', engine: 'Unreal', max: 4096, normal: DX, maps: { BaseColor: 'baseColor', Normal: 'normal', ORM: 'pack:ao,rough,metal,1', Emissive: 'emissive', Height: 'height', Opacity: 'opacity' } },
  'godot': { label: 'Godot 4 · ORMMaterial3D', engine: 'Godot', max: 4096, normal: GL, maps: { albedo: 'baseColor+opacity', normal: 'normal', orm: 'pack:ao,rough,metal,1', emission: 'emissive', height: 'height' } },
  'blender': { label: 'Blender · Principled BSDF', engine: 'Blender', max: 4096, normal: GL, maps: { BaseColor: 'baseColor', Normal: 'normal', Roughness: 'roughness', Metallic: 'metalness', AO: 'ao', Height: 'height', Emission: 'emissive', Alpha: 'opacity' } },
  'gltf': { label: 'glTF 2.0 / Three.js (MeshStandardMaterial)', engine: 'glTF', max: 4096, normal: GL, maps: { baseColor: 'baseColor+opacity', normal: 'normal', metallicRoughness: 'pack:ao,rough,metal,1', emissive: 'emissive' } },
  'specgloss': { label: 'Specular / Glossiness (legacy engines)', engine: 'Generic', max: 4096, normal: GL, maps: { Diffuse: 'diffuse', Specular: 'specular', Glossiness: 'gloss', Normal: 'normal', AO: 'ao' } },
  'exr-linear': { label: 'OpenEXR · linear maps (32-bit height, half color) for offline / VFX', engine: 'Generic', max: 8192, normal: GL, exr: true, maps: { baseColor: 'baseColor', normal: 'normal', roughness: 'roughness', metalness: 'metalness', height: 'height', ao: 'ao', emissive: 'emissive', opacity: 'opacity', curvature: 'curvature' } },
  'all-maps': { label: 'All maps (separate, analysis)', engine: 'Generic', max: 4096, normal: GL, maps: { baseColor: 'baseColor', normal: 'normal', roughness: 'roughness', metalness: 'metalness', height: 'height', ao: 'ao', emissive: 'emissive', opacity: 'opacity', curvature: 'curvature', thickness: 'thickness' } },
};
export const PLATFORMS = { pc: { label: 'PC', max: 4096, format: 'BC7 / BC5 normals' }, console: { label: 'Console', max: 2048, format: 'BC7' }, mobile: { label: 'Mobile', max: 1024, format: 'ASTC 6×6 / ETC2' }, vr: { label: 'VR', max: 2048, format: 'BC7 / ASTC' }, roblox: { label: 'Roblox', max: 1024, format: 'Roblox re-encodes uploads (≤ 1024²)' } };
const BPP = { rgba8: 32, bc7: 8, bc1: 4, bc5: 8, astc6: 3.56, etc2: 8 };
/** Bytes on the GPU for one square map incl. mips (×4/3). */
export const memory = (size, fmt = 'rgba8') => Math.round(size * size * BPP[fmt] / 8 * 4 / 3);

function channel(maps, S, name) {
  const g = n => toGray(maps[n]);
  switch (name) { case 'rough': return g('roughness'); case 'smooth': { const r = g('roughness'); return { c: 1, d: r.d.map(x => 1 - x) }; } case 'metal': return g('metalness'); case 'ao': return g('ao'); case '1': return 1; case '0': return 0; default: return g(name); }
}
function encodeMap(maps, S, spec, normal) {
  if (spec === 'normal') { const n = normal === DX && maps.height ? heightToNormal(toGray(maps.height), S, maps.normalStrength ?? 4, 'directx') : maps.normal; return toRGBA(n, S, { flipGreen: normal === DX && !maps.height }); }
  if (spec === 'baseColor+opacity') return toRGBA(maps.baseColor, S, { alpha: hasAlpha(maps) ? toGray(maps.opacity) : null });
  if (spec.startsWith('pack:')) { const [r, g, b, a] = spec.slice(5).split(','); return pack(S, { r: channel(maps, S, r), g: channel(maps, S, g), b: channel(maps, S, b), a: channel(maps, S, a) }); }
  if (spec === 'diffuse' || spec === 'specular') { const bc = maps.baseColor, m = toGray(maps.metalness), o = new Uint8ClampedArray(S * S * 4); for (let k = 0; k < S * S; k++) { for (let c = 0; c < 3; c++) { const a = bc.d[k * 3 + c], mm = m.d[k]; o[k * 4 + c] = (spec === 'diffuse' ? a * (1 - mm) : 0.04 + (a - 0.04) * mm) * 255; } o[k * 4 + 3] = 255; } return o; }
  if (spec === 'gloss') return pack(S, { r: channel(maps, S, 'smooth'), g: channel(maps, S, 'smooth'), b: channel(maps, S, 'smooth'), a: 1 });
  return maps[spec] ? toRGBA(maps[spec], S) : null;
}
const hasAlpha = maps => { const o = toGray(maps.opacity); if (!o) return false; for (let i = 0; i < o.d.length; i += 97) if (o.d[i] < 0.995) return true; return false; };
const hasEmissive = maps => { const e = maps.emissive; if (!e) return false; for (let i = 0; i < e.d.length; i += 31) if (e.d[i] > 0.01) return true; return false; };

/** Resample a map buffer to `size` (box/bilinear, wraps). Lets one evaluation feed several profile caps. */
export function resizeMaps(maps, from, size) {
  if (from === size) return maps; const out = {};
  for (const [k, b] of Object.entries(maps)) { if (!b?.d) { out[k] = b; continue; } const c = b.c, o = new Float32Array(size * size * c), f = from / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let ch = 0; ch < c; ch++) { let s = 0, n = 0; const x0 = Math.floor(x * f), y0 = Math.floor(y * f), span = Math.max(1, Math.round(f)); for (let j = 0; j < span; j++) for (let i = 0; i < span; i++) { s += b.d[(((y0 + j) % from) * from + ((x0 + i) % from)) * c + ch]; n++; } o[(y * size + x) * c + ch] = s / n; }
    out[k] = { c, d: o }; }
  return out;
}

/** → {files:{path:Uint8Array}, report:[…]} for the chosen profiles. deflate(bytes) → zlib bytes (fflate.zlibSync / node zlib). */
export function exportMaterial(name, maps, size, profiles, { deflate, platform = 'pc', assetIds = {} } = {}) {
  const files = {}, report = [], enc = new TextEncoder(), cap = PLATFORMS[platform]?.max ?? 4096;
  for (const id of profiles) {
    const P = PROFILES[id]; if (!P) throw new Error(`Unknown export profile ${id}`);
    const S = Math.min(size, P.max, cap), m = resizeMaps(maps, size, S), dir = `${id}/`, written = {};
    if (P.exr) { // linear float/half EXR per map: color maps sRGB → linear, normal/height/masks stay data
      const lin = x => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      for (const [slot, key] of Object.entries(P.maps)) { const b = m[key]; if (!b || (key === 'emissive' && !hasEmissive(m)) || (key === 'opacity' && !hasAlpha(m))) continue;
        const ch = b.c === 3 ? { R: new Float32Array(S * S), G: new Float32Array(S * S), B: new Float32Array(S * S) } : { Y: Float32Array.from(b.d) };
        if (b.c === 3) for (let k = 0; k < S * S; k++) { const f = key === 'normal' ? x => x : lin; ch.R[k] = f(b.d[k * 3]); ch.G[k] = f(b.d[k * 3 + 1]); ch.B[k] = f(b.d[k * 3 + 2]); }
        const file = `${name}_${slot}.exr`; files[dir + file] = writeEXR({ width: S, height: S, channels: ch, type: key === 'height' ? 'float' : 'half' }); written[slot] = file; }
    } else for (const [slot, spec] of Object.entries(P.maps)) {
      if (spec === 'emissive' && !hasEmissive(m)) continue; if (spec === 'opacity' && !hasAlpha(m)) continue; if (spec === 'height' && !m.height) continue;
      const rgba = encodeMap(m, S, spec, P.normal); if (!rgba) continue;
      const file = `${name}_${slot}.png`; files[dir + file] = encodePNG(rgba, S, S, deflate); written[slot] = file;
    }
    const srgb = s => P.exr ? 'Linear (EXR)' : /color|albedo|basemap|diffuse|emiss/i.test(s) ? 'sRGB' : 'Linear (non-color)';
    const notes = { ...META, profile: id, label: P.label, size: S, normal: P.normal, files: Object.fromEntries(Object.entries(written).map(([k, f]) => [k, { file: f, colorSpace: srgb(k), packing: String(P.maps[k]).startsWith('pack:') ? P.maps[k].slice(5) : P.maps[k] }])) };
    if (id.startsWith('roblox')) {
      const cid = slot => assetIds[`${name}.${slot}`] ? `rbxassetid://${assetIds[`${name}.${slot}`]}` : '';
      const props = { ColorMap: T.content(cid('ColorMap')), NormalMap: T.content(cid('NormalMap')), RoughnessMap: T.content(cid('RoughnessMap')), MetalnessMap: T.content(cid('MetalnessMap')) };
      const root = id === 'roblox-surfaceappearance'
        ? inst('SurfaceAppearance', name, { ...props, AlphaMode: T.enum(hasAlpha(m) ? ENUM.AlphaMode.Transparency : ENUM.AlphaMode.Overlay) })
        : inst('MaterialVariant', name, { ...props, BaseMaterial: T.enum(256), StudsPerTile: T.float(4), MaterialPattern: T.enum(0) });
      files[dir + `${name}.rbxmx`] = enc.encode(toRBXMX(root));
      notes.roblox = { instance: root.className, upload: 'Upload each PNG (Codex Design → Upload, or Asset Manager → Bulk Import), then put the IMAGE ids into the instance (the .rbxmx has empty slots until ids exist).', missingIds: Object.keys(props).filter(k => !cid(k)) };
    }
    if (id === 'godot') files[dir + `${name}.tres`] = enc.encode(`[gd_resource type="ORMMaterial3D" load_steps=${Object.keys(written).length + 1} format=3]\n\n${Object.entries(written).map(([k, f], i) => `[ext_resource type="Texture2D" path="res://${f}" id="${i + 1}"]`).join('\n')}\n\n[resource]\n${['albedo', 'normal', 'orm', 'emission', 'height'].map(k => written[k] ? { albedo: 'albedo_texture', normal: 'normal_enabled = true\nnormal_texture', orm: 'orm_texture', emission: 'emission_enabled = true\nemission_texture', height: 'heightmap_enabled = true\nheightmap_texture' }[k] + ` = ExtResource("${Object.keys(written).indexOf(k) + 1}")` : '').filter(Boolean).join('\n')}\n${hasAlpha(m) ? 'transparency = 1\n' : ''}`);
    if (id === 'gltf') files[dir + `${name}.gltf`] = enc.encode(JSON.stringify(gltfPlane(name, written, hasAlpha(m)), null, 1));
    if (id === 'unreal') notes.unreal = { material: 'Texture sample ORM: R → Ambient Occlusion, G → Roughness, B → Metallic (sRGB off, compression Masks). Normal: compression Normalmap (DirectX green already flipped).', nanite: 'Maps are engine-independent; Nanite meshes use them unchanged.' };
    if (id.startsWith('unity')) notes.unity = { import: 'Normal → Texture Type "Normal map". Packed maps → sRGB off. URP: MetallicSmoothness alpha = smoothness (Source: Metallic Alpha). HDRP MaskMap = R metal, G AO, B detail mask, A smoothness.' };
    if (id === 'blender') notes.blender = { nodes: 'Image Texture → Principled BSDF: BaseColor (sRGB), Roughness/Metallic/AO (Non-Color), Normal → Normal Map node (OpenGL), Height → Displacement.' };
    files[dir + `${name}.material.json`] = enc.encode(JSON.stringify(notes, null, 1));
    report.push({ profile: id, size: S, maps: Object.keys(written), gpuMB: +(Object.keys(written).length * memory(S, platform === 'mobile' ? 'astc6' : 'bc7') / 1048576).toFixed(2), rawMB: +(Object.keys(written).length * memory(S) / 1048576).toFixed(2) });
  }
  return { files, report };
}

function gltfPlane(name, written, alpha) {
  // 1×1 m plane, UV 0–1, with the exported material (glTF 2.0, external PNGs).
  const pos = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], uv = [0, 0, 1, 0, 1, 1, 0, 1], tan = [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], idx = [0, 2, 1, 0, 3, 2];
  const f32 = a => new Uint8Array(new Float32Array(a).buffer), u16 = new Uint8Array(new Uint16Array(idx).buffer);
  const parts = [f32(pos), f32(nor), f32(uv), f32(tan), u16], bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; const views = parts.map((p, i) => { bytes.set(p, o); const v = { buffer: 0, byteOffset: o, byteLength: p.length, target: i === 4 ? 34963 : 34962 }; o += p.length; return v; });
  let b64 = ''; for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]); b64 = typeof btoa === 'function' ? btoa(b64) : Buffer.from(bytes).toString('base64');
  const images = Object.values(written).map(uri => ({ uri })), tex = file => { const i = Object.values(written).indexOf(file); return i < 0 ? undefined : { index: i }; };
  const mat = { name, pbrMetallicRoughness: { baseColorTexture: tex(written.baseColor), metallicRoughnessTexture: tex(written.metallicRoughness), metallicFactor: 1, roughnessFactor: 1 }, normalTexture: tex(written.normal), occlusionTexture: tex(written.metallicRoughness), ...(written.emissive ? { emissiveTexture: tex(written.emissive), emissiveFactor: [1, 1, 1] } : {}), ...(alpha ? { alphaMode: 'BLEND' } : {}) };
  return { asset: { version: '2.0', generator: 'Codex Design Texture Studio', copyright: META.notice, extras: { codexDesign: META } }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }], meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3 }, indices: 4, material: 0 }] }], materials: [mat],
    textures: images.map((_, i) => ({ source: i, sampler: 0 })), images, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 0, 0.5] }, { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' }, { bufferView: 3, componentType: 5126, count: 4, type: 'VEC4' }, { bufferView: 4, componentType: 5123, count: 6, type: 'SCALAR' }],
    bufferViews: views, buffers: [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + b64 }] };
}

/** Texture atlas: several evaluated materials (same size) → one grid atlas per map + UV rects. padding in texels (wrap-filled). */
export function atlas(list, size, { padding = 8 } = {}) {
  const n = Math.ceil(Math.sqrt(list.length)), cell = Math.floor(size / n), inner = cell - padding * 2, out = {}, rects = [];
  for (const key of ['baseColor', 'normal', 'roughness', 'metalness', 'height', 'ao', 'emissive', 'opacity']) {
    if (!list.some(m => m.maps[key])) continue; const c = ['baseColor', 'normal', 'emissive'].includes(key) ? 3 : 1, d = new Float32Array(size * size * c);
    list.forEach((m, i) => { const S = m.size, b = m.maps[key] ?? { c, d: new Float32Array(S * S * c).fill(key === 'normal' ? 0.5 : key === 'ao' || key === 'opacity' ? 1 : 0) }, ox = (i % n) * cell, oy = Math.floor(i / n) * cell;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) { const sx = Math.floor(((x - padding) / inner) * S), sy = Math.floor(((y - padding) / inner) * S), k = ((((sy % S) + S) % S) * S + (((sx % S) + S) % S)); for (let ch = 0; ch < c; ch++) d[((oy + y) * size + ox + x) * c + ch] = b.d[k * b.c + Math.min(ch, b.c - 1)] ?? 0; }
      if (key === 'baseColor') rects.push({ name: m.name, uv: [(ox + padding) / size, (oy + padding) / size, (ox + cell - padding) / size, (oy + cell - padding) / size] }); });
    out[key] = { c, d };
  }
  return { maps: out, size, rects };
}
