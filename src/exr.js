// OpenEXR writer (scanline, NO_COMPRESSION, HALF or FLOAT channels). Isomorphic: browser + Node.
// writeEXR({width, height, channels:{R,G,B,A | Y: Float32Array (row 0 = top)}, type:'half'|'float'}) → Uint8Array.
// Values are linear (scene-referred); EXR readers (Nuke, Blender, Photoshop, Unreal, Substance) expect that.

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** float → IEEE half bits (round-to-nearest, handles inf/NaN/subnormals). */
export function toHalf(v) {
  f32[0] = v; const x = u32[0], sign = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff, m = x & 0x7fffff;
  if (e === 255) return sign | 0x7c00 | (m ? 0x200 : 0);
  let ex = e - 127 + 15;
  if (ex >= 31) return sign | 0x7c00;
  if (ex <= 0) { if (ex < -10) return sign; const mm = (m | 0x800000) >> (1 - ex); return sign | ((mm + 0x1000) >> 13); }
  const h = sign | (ex << 10) | (m >> 13); return (m & 0x1000) ? h + 1 : h;
}
export function writeEXR({ width: W, height: H, channels, type = 'half' }) {
  const names = Object.keys(channels).sort(), bpp = type === 'half' ? 2 : 4, pixelType = type === 'half' ? 1 : 2, enc = new TextEncoder();
  for (const n of names) if (channels[n].length !== W * H) throw new Error(`EXR channel ${n} has ${channels[n].length} values, expected ${W * H}`);
  const parts = [], push = b => parts.push(b), u8 = (...v) => push(Uint8Array.from(v)), i32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); push(b); }, f = v => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); }, str = s => { push(enc.encode(s)); u8(0); };
  const attr = (name, kind, size, write) => { str(name); str(kind); i32(size); write(); };
  push(Uint8Array.of(0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0));
  attr('channels', 'chlist', names.reduce((s, n) => s + n.length + 1 + 16, 1), () => { for (const n of names) { str(n); i32(pixelType); u8(0, 0, 0, 0); i32(1); i32(1); } u8(0); });
  attr('compression', 'compression', 1, () => u8(0));
  attr('dataWindow', 'box2i', 16, () => { i32(0); i32(0); i32(W - 1); i32(H - 1); });
  attr('displayWindow', 'box2i', 16, () => { i32(0); i32(0); i32(W - 1); i32(H - 1); });
  attr('lineOrder', 'lineOrder', 1, () => u8(0));
  attr('pixelAspectRatio', 'float', 4, () => f(1));
  attr('screenWindowCenter', 'v2f', 8, () => { f(0); f(0); });
  attr('screenWindowWidth', 'float', 4, () => f(1));
  { const note = 'Codex Design - non-commercial use without permission (see LICENSE)'; attr('owner', 'string', enc.encode(note).length, () => push(enc.encode(note))); }
  u8(0);
  const headerLen = parts.reduce((s, p) => s + p.length, 0), lineBytes = W * bpp * names.length, blockLen = 8 + lineBytes, tableLen = H * 8;
  const out = new Uint8Array(headerLen + tableLen + H * blockLen), dv = new DataView(out.buffer); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  for (let y = 0; y < H; y++) { const off = headerLen + tableLen + y * blockLen; dv.setUint32(o + y * 8, off >>> 0, true); dv.setUint32(o + y * 8 + 4, Math.floor(off / 4294967296), true); }
  o += tableLen;
  for (let y = 0; y < H; y++) {
    dv.setInt32(o, y, true); dv.setInt32(o + 4, lineBytes, true); o += 8;
    for (const n of names) { const c = channels[n]; for (let x = 0; x < W; x++) { const v = c[y * W + x]; if (bpp === 2) dv.setUint16(o, toHalf(v), true); else dv.setFloat32(o, v, true); o += bpp; } }
  }
  return out;
}
/** Minimal reader for tests: header channel names, size, first pixel values. */
export function readEXR(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); if (dv.getUint32(0, true) !== 20000630) throw new Error('Not an EXR file');
  let o = 8; const td = new TextDecoder(), cstr = () => { let e = o; while (u8[e]) e++; const s = td.decode(u8.subarray(o, e)); o = e + 1; return s; }, attrs = {};
  for (;;) { const name = cstr(); if (!name) break; const kind = cstr(), size = dv.getInt32(o, true); o += 4; attrs[name] = { kind, data: u8.subarray(o, o + size) }; o += size; }
  const ch = []; { const d = attrs.channels.data; let p = 0; while (d[p]) { let e = p; while (d[e]) e++; ch.push({ name: td.decode(d.subarray(p, e)), type: new DataView(d.buffer, d.byteOffset + e + 1).getInt32(0, true) }); p = e + 17; } }
  const box = new DataView(attrs.dataWindow.data.buffer, attrs.dataWindow.data.byteOffset), W = box.getInt32(8, true) + 1, H = box.getInt32(12, true) + 1;
  return { width: W, height: H, channels: ch.map(c => c.name), type: ch[0]?.type === 1 ? 'half' : 'float', compression: attrs.compression.data[0] };
}
