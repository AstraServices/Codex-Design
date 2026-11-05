// VFX Studio CLI (no browser): validate and export Roblox VFX packages from vfx/<id>.vfx.json.
//   npm run vfx -- --list
//   npm run vfx -- <id>[,<id2>|all] [--validate] [--luau-only] [--placeholder] [--upload]
// Writes exports/vfx/<Name>.rbxm, .rbxmx, .luau (CONFIG + builder + runtime), VFXStudio.luau, CodexVFX_Importer.luau, manifest.json.
// --upload sends textures without ids to Roblox (Open Cloud key from Settings) — only run it after the user said yes.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage, validateEffect, textureRefs, textureKey, safeName } from '../src/rbx/vfx-build.js';
import { toRBXM } from '../src/rbx/rbxm.js';
import { toRBXMX } from '../src/rbx/rbxmx.js';
import { generateLuau } from '../src/rbx/vfx-luau.js';
import { uploadAsset } from './roblox-cloud.mjs';
import { loadSettings } from './settings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2), flag = f => { const i = args.indexOf('--' + f); if (i < 0) return false; args.splice(i, 1); return true; };
const list = flag('list'), validateOnly = flag('validate'), luauOnly = flag('luau-only'), placeholder = flag('placeholder'), upload = flag('upload');
const ids = (await readdir(path.join(root, 'vfx'))).filter(f => f.endsWith('.vfx.json')).map(f => f.slice(0, -9));
if (list || !args[0]) { for (const id of ids) { const e = JSON.parse(await readFile(path.join(root, 'vfx', id + '.vfx.json'), 'utf8')); console.log(`${id.padEnd(24)} ${e.name} · ${(e.layers ?? []).length} layers · ${e.description ?? ''}`); } if (!args[0]) console.log('\nUsage: npm run vfx -- <id>|all [--validate] [--luau-only] [--placeholder] [--upload]'); process.exit(0); }
const pick = args[0] === 'all' ? ids : args[0].split(','), effects = [];
for (const id of pick) effects.push(JSON.parse(await readFile(path.join(root, 'vfx', id + '.vfx.json'), 'utf8')));
const idsFile = path.join(root, 'vfx', 'asset-ids.json'); let assets = {}; try { assets = JSON.parse(await readFile(idsFile, 'utf8')); } catch {}
if (upload) {
  const s = await loadSettings(); if (!s.roblox.apiKey) throw new Error('No Roblox API key: Settings → Roblox (or the VFX Studio export dialog)');
  for (const r of new Map(effects.flatMap(textureRefs).filter(r => r.src && !assets[r.key] && !assets['decal:' + r.key]).map(r => [r.key, r])).values()) {
    const res = await uploadAsset({ file: path.join(root, r.src), name: `VFX ${path.basename(r.src, '.png')}` }); if (res.imageId) assets[r.key] = res.imageId; else assets['decal:' + r.key] = res.decalId;
    console.error(`uploaded ${r.src} → ${res.imageId ? 'image ' + res.imageId : 'decal ' + res.decalId}`);
  }
  await writeFile(idsFile, JSON.stringify(assets, null, 1) + '\n');
}
const image = Object.fromEntries(Object.entries(assets).filter(([k]) => !k.startsWith('decal:')));
const issues = effects.flatMap(e => validateEffect(e, { assets: image }).map(i => ({ effect: e.name, ...i })));
const blocking = issues.filter(i => i.level === 'error' && !((placeholder || luauOnly) && i.code === 'missing-asset-id'));
if (validateOnly || blocking.length) { console.log(JSON.stringify({ ok: !blocking.length, issues }, null, 1)); if (blocking.length) process.exitCode = 1; if (validateOnly || blocking.length) process.exit(); }
const controller = await readFile(path.join(root, 'src/rbx/vfx-controller.luau'), 'utf8'), importer = await readFile(path.join(root, 'src/rbx/vfx-importer.luau'), 'utf8');
const tex = effects.flatMap(e => (e.layers ?? []).filter(L => L.enabled !== false && L.texture && !L.texture.assetId).map(L => { const n = safeName(L.name ?? L.type), key = textureKey(L.texture); return { effect: safeName(e.name), layer: n, key, file: L.texture.src, imageId: image[key] ?? null, decalId: assets['decal:' + key] ?? null, path: `Effects/${safeName(e.name)}/` + (L.type === 'emitter' ? `Root/${n}Att/${n}` : L.type === 'mesh' ? `${n}/Mesh` : `Root/${n}`) }; }));
const base = effects.length > 1 ? 'CodexVFX' : safeName(effects[0].name), out = path.join(root, 'exports', 'vfx'), files = [];
await mkdir(out, { recursive: true });
const write = async (name, data) => { await writeFile(path.join(out, name), data); files.push(`exports/vfx/${name}`); };
await write(`${base}.luau`, generateLuau(effects, { controller, textures: tex.map(t => ({ key: `${t.effect}.${t.layer}`, imageId: t.imageId, decalId: t.decalId })) }));
if (!luauOnly) {
  const pkg = buildPackage(effects, { assets: image, controller, manifest: { textures: tex } });
  await write(`${base}.rbxm`, toRBXM(pkg)); await write(`${base}.rbxmx`, toRBXMX(pkg)); await write('VFXStudio.luau', controller); await write('CodexVFX_Importer.luau', importer);
}
await write(`${base}.manifest.json`, JSON.stringify({ effects: effects.map(e => e.name), textures: tex, missing: tex.filter(t => !t.imageId).map(t => t.file) }, null, 1));
console.log(JSON.stringify({ files, missingIds: tex.filter(t => !t.imageId).map(t => t.file), warnings: issues.filter(i => i.level === 'warn').length }, null, 1));
