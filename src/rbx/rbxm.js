// RBXM writer: Roblox binary model format (version 0). Chunks are stored uncompressed (compressed length 0),
// which the format allows; Studio, Rojo/rbx-dom and Lune read them. Layout:
//   header "<roblox!" 89 FF 0D 0A 1A 0A, u16 version 0, i32 class count, i32 instance count, 8 reserved
//   META, INST (one per class), PROP (one per class × property), PRNT, END ("</roblox>")
// Encodings: integers/referents big-endian zigzag byte-interleaved; floats "Roblox float" (sign rotated to the low bit)
// interleaved; Color3/Vector2/Vector3 = one interleaved float array per component; sequences/ranges little-endian.
import { flatten } from './instances.js';

const TYPE = { string: 0x01, source: 0x01, content: 0x01, bool: 0x02, int: 0x03, float: 0x04, color3: 0x0C, vec2: 0x0D, vec3: 0x0E, cframe: 0x10, enum: 0x12, ref: 0x13, numseq: 0x15, colseq: 0x16, numrange: 0x17, color3u8: 0x1A };
const ZERO = { string: '', source: '', content: '', bool: false, int: 0, float: 0, color3: [1, 1, 1], vec2: [0, 0], vec3: [0, 0, 0], cframe: { p: [0, 0, 0], r: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, enum: 0, ref: null, numseq: [[0, 0, 0], [1, 0, 0]], colseq: [[0, [1, 1, 1]], [1, [1, 1, 1]]], numrange: [0, 0], color3u8: [255, 255, 255] };

class Bytes {
  constructor() { this.parts = []; this.length = 0; }
  push(u8) { this.parts.push(u8); this.length += u8.length; return this; }
  u8(v) { return this.push(Uint8Array.of(v & 255)); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return this.push(b); }
  i32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); return this.push(b); }
  f32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); return this.push(b); }
  str(s) { const u = new TextEncoder().encode(s); this.u32(u.length); return this.push(u); }
  done() { const out = new Uint8Array(this.length); let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; } return out; }
}
const zig = v => ((v << 1) ^ (v >> 31)) >>> 0;
const rbxFloat = v => { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, v); const b = dv.getUint32(0); return ((b << 1) | (b >>> 31)) >>> 0; };
/** Big-endian u32 values, byte-interleaved (all MSBs first). */
function interleave(values) { const n = values.length, out = new Uint8Array(n * 4); values.forEach((v, i) => { out[i] = v >>> 24; out[n + i] = (v >>> 16) & 255; out[2 * n + i] = (v >>> 8) & 255; out[3 * n + i] = v & 255; }); return out; }
const refs = ids => { let prev = 0; return interleave(ids.map(id => { const d = id - prev; prev = id; return zig(d); })); };

function values(type, list, refOf) {
  const b = new Bytes();
  switch (type) {
    case 'string': case 'source': case 'content': list.forEach(v => b.str(v)); break;
    case 'bool': list.forEach(v => b.u8(v ? 1 : 0)); break;
    case 'int': b.push(interleave(list.map(v => zig(v | 0)))); break;
    case 'float': b.push(interleave(list.map(rbxFloat))); break;
    case 'enum': b.push(interleave(list.map(v => v >>> 0))); break;
    case 'color3': case 'vec2': case 'vec3': { const k = type === 'vec2' ? 2 : 3; for (let c = 0; c < k; c++) b.push(interleave(list.map(v => rbxFloat(v[c])))); break; }
    case 'color3u8': for (let c = 0; c < 3; c++) b.push(Uint8Array.from(list.map(v => v[c]))); break;
    case 'cframe': {
      list.forEach(({ r }) => { const id = r.every((x, i) => Math.abs(x - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-7); if (id) b.u8(0x02); else { b.u8(0); r.forEach(x => b.f32(x)); } });
      for (let c = 0; c < 3; c++) b.push(interleave(list.map(v => rbxFloat(v.p[c])))); break;
    }
    case 'ref': b.push(refs(list.map(v => v ? refOf.get(v) ?? -1 : -1))); break;
    case 'numseq': list.forEach(k => { b.u32(k.length); k.forEach(([t, v, e]) => { b.f32(t); b.f32(v); b.f32(e ?? 0); }); }); break;
    case 'colseq': list.forEach(k => { b.u32(k.length); k.forEach(([t, c]) => { b.f32(t); b.f32(c[0]); b.f32(c[1]); b.f32(c[2]); b.f32(0); }); }); break;
    case 'numrange': list.forEach(([a, z]) => { b.f32(a); b.f32(z); }); break;
    default: throw new Error(`RBXM: unsupported type ${type}`);
  }
  return b.done();
}

function chunk(name, data) { const b = new Bytes(); b.push(new TextEncoder().encode(name.padEnd(4, '\0').slice(0, 4))).u32(0).u32(data.length).u32(0).push(data); return b.done(); }

/** roots: one instance or a list → Uint8Array (.rbxm). defaults(className, prop) can supply values for missing props. */
export function toRBXM(roots, { defaults } = {}) {
  const list = Array.isArray(roots) ? roots : [roots], all = flatten(list), refOf = new Map(all.map((n, i) => [n, i]));
  const classes = [...new Set(all.map(n => n.className))].sort();
  const file = new Bytes();
  file.push(new TextEncoder().encode('<roblox!')).push(Uint8Array.of(0x89, 0xFF, 0x0D, 0x0A, 0x1A, 0x0A)).push(Uint8Array.of(0, 0)).i32(classes.length).i32(all.length).push(new Uint8Array(8));
  const meta = new Bytes(); meta.u32(1).str('ExplicitAutoJoints').str('true'); file.push(chunk('META', meta.done()));
  const byClass = classes.map(c => all.filter(n => n.className === c));
  byClass.forEach((members, id) => { const b = new Bytes(); b.u32(id).str(classes[id]).u8(0).u32(members.length).push(refs(members.map(n => refOf.get(n)))); file.push(chunk('INST', b.done())); });
  byClass.forEach((members, id) => {
    const names = [...new Set(members.flatMap(n => Object.keys(n.props)))].sort();
    for (const name of names) {
      const type = members.map(n => n.props[name]?.type).find(Boolean);
      if (members.some(n => n.props[name] && n.props[name].type !== type)) throw new Error(`RBXM: ${classes[id]}.${name} has mixed types`);
      const vals = members.map(n => n.props[name] ? n.props[name].value : defaults?.(classes[id], name) ?? ZERO[type]);
      const b = new Bytes(); b.u32(id).str(name).u8(TYPE[type]).push(values(type, vals, refOf)); file.push(chunk('PROP', b.done()));
    }
  });
  const p = new Bytes(); p.u8(0).u32(all.length).push(refs(all.map(n => refOf.get(n)))).push(refs(all.map(n => n.parent && refOf.has(n.parent) ? refOf.get(n.parent) : -1)));
  file.push(chunk('PRNT', p.done()));
  file.push(chunk('END', new TextEncoder().encode('</roblox>')));
  return file.done();
}

/** Minimal reader for tests and the validator: header, classes, instance count, names. */
export function readRBXM(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), td = new TextDecoder();
  if (td.decode(u8.subarray(0, 8)) !== '<roblox!') throw new Error('Not an RBXM file');
  let o = 32; const classes = {}, chunks = [];
  while (o < u8.length) {
    const name = td.decode(u8.subarray(o, o + 4)).replace(/\0/g, ''), comp = dv.getUint32(o + 4, true), len = dv.getUint32(o + 8, true); o += 16;
    if (comp) throw new Error('Compressed chunks not supported by this reader');
    const data = u8.subarray(o, o + len); o += len; chunks.push(name);
    if (name === 'INST') { const d = new DataView(data.buffer, data.byteOffset), id = d.getUint32(0, true), l = d.getUint32(4, true); classes[id] = { name: td.decode(data.subarray(8, 8 + l)), count: d.getUint32(9 + l, true), props: [] }; }
    if (name === 'PROP') { const d = new DataView(data.buffer, data.byteOffset), id = d.getUint32(0, true), l = d.getUint32(4, true); classes[id].props.push(td.decode(data.subarray(8, 8 + l))); }
    if (name === 'END') break;
  }
  return { classes: Object.values(classes), instances: dv.getInt32(20, true), chunks };
}
