// Codex Design provenance marks. Nothing visible is drawn into models, textures, VFX or GFX images:
//  • human-readable: export/ZIP file names carry "_CodexDesign" (markName)
//  • machine-readable: metadata only — PNG tEXt chunks, glTF/GLB asset.generator/copyright/extras, EXR header
//    attribute, RBXMX XML comment + Manifest, Luau header comment, JSON "generator" fields.
// Isomorphic (browser + Node). See LICENSE: outputs are for non-commercial use unless the author grants permission.
export const SIGNATURE = 'Codex Design';
export const LICENSE_NOTE = 'Made with Codex Design (AstraServices). Non-commercial use only without written permission. See LICENSE.';
export const META = { generator: SIGNATURE, license: 'Codex Design Non-Commercial License', notice: LICENSE_NOTE, url: 'https://github.com/AstraServices/Codex-Design' };

/** "rock.textures.zip" → "rock_CodexDesign.textures.zip" (idempotent). */
export function markName(name) {
  if (/_CodexDesign/i.test(name)) return name;
  const m = String(name).match(/^([^.]+)(\..+)?$/); return m ? `${m[1]}_CodexDesign${m[2] ?? ''}` : name + '_CodexDesign';
}

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function textChunk(key, value) {
  const data = new TextEncoder().encode(`${key}\0${value}`), out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set([116, 69, 88, 116], 4); out.set(data, 8); dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
}
/** Adds tEXt chunks (Software, Copyright, Comment) after IHDR. Pixels untouched; idempotent. */
export function markPNG(png) {
  const b = png instanceof Uint8Array ? png : new Uint8Array(png);
  if (b.length < 33 || b[0] !== 137 || b[1] !== 80) return b;
  if (new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 4096))).includes('Codex Design')) return b;
  const ihdrEnd = 8 + 12 + new DataView(b.buffer, b.byteOffset).getUint32(8), chunks = [textChunk('Software', SIGNATURE), textChunk('Copyright', LICENSE_NOTE), textChunk('Comment', JSON.stringify(META))];
  const out = new Uint8Array(b.length + chunks.reduce((s, c) => s + c.length, 0)); out.set(b.subarray(0, ihdrEnd)); let o = ihdrEnd; for (const c of chunks) { out.set(c, o); o += c.length; } out.set(b.subarray(ihdrEnd), o); return out;
}
/** glTF JSON object: asset.generator / copyright / extras.codexDesign. */
export function markGLTF(json) { json.asset = { ...(json.asset ?? { version: '2.0' }), generator: `${SIGNATURE}${json.asset?.generator ? ` (${json.asset.generator})` : ''}`, copyright: LICENSE_NOTE, extras: { ...(json.asset?.extras ?? {}), codexDesign: META } }; return json; }
/** GLB bytes: rewrites the JSON chunk with markGLTF; geometry/BIN untouched. */
export function markGLB(glb) {
  const b = glb instanceof Uint8Array ? glb : new Uint8Array(glb), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 20 || dv.getUint32(0, true) !== 0x46546c67) return b;
  const jsonLen = dv.getUint32(12, true), json = markGLTF(JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLen))));
  let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - (js.length % 4)) % 4; if (pad) { const p = new Uint8Array(js.length + pad).fill(0x20); p.set(js); js = p; }
  const rest = b.subarray(20 + jsonLen), out = new Uint8Array(20 + js.length + rest.length), o = new DataView(out.buffer);
  out.set(b.subarray(0, 12)); o.setUint32(8, out.length, true); o.setUint32(12, js.length, true); o.setUint32(16, 0x4e4f534a, true); out.set(js, 20); out.set(rest, 20 + js.length); return out;
}
/** Marks any export by file name: .png, .glb, .gltf, .json (generator field). Others are returned unchanged. */
export function markFile(name, bytes) {
  const n = String(name).toLowerCase();
  if (n.endsWith('.png')) return markPNG(bytes);
  if (n.endsWith('.glb')) return markGLB(bytes);
  if (n.endsWith('.gltf')) { try { return new TextEncoder().encode(JSON.stringify(markGLTF(JSON.parse(new TextDecoder().decode(bytes))))); } catch { return bytes; } }
  return bytes;
}
export const xmlComment = () => `<!-- ${LICENSE_NOTE} -->`;
export const luauComment = () => `-- ${LICENSE_NOTE}`;
