// Codex Design SDK: drive Texture Studio, VFX Studio, GFX Studio and Roblox uploads from code, without the UI.
// The same engines the pages use (graph.js, export.js, vfx-build.js, rbxm/rbxmx, vfx-luau.js, texgen.js, gfx.js).
// Texture + VFX run directly in Node. GFX renders through a headless Chromium on the local workshop (started if needed).
//
//   import { createCodex } from './src/sdk/codex.mjs';
//   const cd = await createCodex();
//   const g = cd.texture.graph('lava-rock'); const n = g.node('fbm', { scale: 6 }); g.output('height', n); …
//   await cd.texture.export(g, { size: 1024, profiles: ['roblox-surfaceappearance', 'unreal'] });
//   const fx = cd.vfx.effect('IceBurst').fromLibrary('vfx-pack2/explosion-01', { Size: [[0, 4], [1, 8]] }).light({ … });
//   await cd.vfx.export(fx, { luauOnly: true });
//   await cd.gfx.render('bamboo-stalk', { preset: 'hero-render', title: 'Bamboo' });
//   await cd.close();
// Scripts: `npm run codex -- run my-script.mjs` calls `export default async (cd) => …`. HTTP: POST /api/sdk/<area>/<op>.
import { markPNG } from '../watermark.js';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODES, CATEGORIES, MAPS, defaults, evaluate, checkGraph, pruneGraph, validatePBR, seamScore, toRGBA } from '../texture/graph.js';
import { PROFILES, PLATFORMS, exportMaterial, atlas } from '../texture/export.js';
import { buildEffect, buildPackage, validateEffect, textureRefs, textureKey, safeName, DEFAULTS as VFX_DEFAULTS, LAYER_TYPES } from '../rbx/vfx-build.js';
import { toRBXM } from '../rbx/rbxm.js';
import { toRBXMX } from '../rbx/rbxmx.js';
import { generateLuau } from '../rbx/vfx-luau.js';
import { generateImage, KINDS as TEX_KINDS, specName } from '../vfx/texgen.js';
import { encodePNG } from '../png.js';
import { smartUV, uvStats } from '../uv.js';
import { bakeHighToLow, BAKE_MAPS } from '../bake-hilo.js';
import { writeEXR } from '../exr.js';
import { loadGeometry, geometryToGLB } from './geometry-io.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const png = (rgba, w, h = w) => encodePNG(rgba, w, h, b => deflateSync(b, { level: 6 }));
const slugOf = s => String(s).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'x-$1').slice(0, 60) || 'item';
const readJSON = async f => JSON.parse(await readFile(f, 'utf8'));
const writeJSON = async (f, v) => { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, JSON.stringify(v, null, 1) + '\n'); };
const plain = x => (x && typeof x.json === 'function' ? x.json() : x);

/** Texture graph builder. node() returns the new node id; chain ids into inputs. */
class GraphBuilder {
  constructor(name, base = {}) { this.g = { name: slugOf(name), description: '', seed: 1, nodes: [], outputs: {}, ...structuredClone(base) }; }
  node(type, params = {}, inputs = {}, id) {
    if (!NODES[type]) throw new Error(`Unknown texture node "${type}". Known: ${Object.keys(NODES).join(', ')}`);
    const nid = id ?? (() => { let i = 1; while (this.g.nodes.some(n => n.id === `${type}${i}`)) i++; return `${type}${i}`; })();
    const k = this.g.nodes.length; this.g.nodes.push({ id: nid, type, params: { ...params }, inputs: { ...inputs }, x: 40 + (k % 5) * 220, y: 40 + Math.floor(k / 5) * 170 }); return nid;
  }
  output(map, id) { if (!MAPS.includes(map)) throw new Error(`Unknown output ${map}. Maps: ${MAPS.join(', ')}`); this.g.outputs[map] = id; return this; }
  set(key, value) { this.g[key] = value; return this; }
  json() { return structuredClone(this.g); }
}

/** VFX effect builder: every method adds a Roblox layer and returns the builder. */
class EffectBuilder {
  constructor(cd, name, base = {}) { this.cd = cd; this.e = { name: safeName(name), description: '', duration: 1, loop: false, layers: [], ...structuredClone(base) }; }
  #add(L) { L.name = safeName(L.name ?? L.type); let n = L.name, i = 2; while (this.e.layers.some(x => x.name === n)) n = L.name + i++; L.name = n; this.e.layers.push(L); return this; }
  emitter({ name = 'Emitter', texture, props = {}, burst, continuous, delay, offset } = {}) { return this.#add({ type: 'emitter', name, texture: texRef(texture), props, emit: continuous ? { mode: 'continuous', duration: continuous } : { mode: 'burst', bursts: [burst ?? { t: 0, count: 20 }].flat() }, delay, offset }); }
  beam({ name = 'Beam', texture, props = {}, a0 = [0, 0, 0], a1 = [0, 6, 0], duration = this.e.duration, delay, anim } = {}) { return this.#add({ type: 'beam', name, texture: texRef(texture), props, a0, a1, duration, delay, anim }); }
  trail({ name = 'Trail', texture, props = {}, a0 = [0, -0.5, 0], a1 = [0, 0.5, 0], duration = this.e.duration, delay } = {}) { return this.#add({ type: 'trail', name, texture: texRef(texture), props, a0, a1, duration, delay }); }
  light({ name = 'Light', cls = 'PointLight', props = {}, duration = this.e.duration, delay, anim, offset } = {}) { return this.#add({ type: 'light', name, class: cls, props, duration, delay, anim, offset }); }
  mesh({ name = 'Mesh', shape = 'Ball', material = 'Neon', color = '#ffffff', size = [1, 1, 1], transparency = 0, anim = [], delay, offset, meshId } = {}) { return this.#add({ type: 'mesh', name, shape, material, color, size, transparency, anim, delay, offset, meshId }); }
  highlight({ name = 'Highlight', props = {}, duration = 0.2, delay } = {}) { return this.#add({ type: 'highlight', name, props, duration, delay }); }
  post({ name = 'Post', cls = 'BloomEffect', props = {}, duration = 0.3, delay } = {}) { return this.#add({ type: 'post', name, class: cls, props, duration, delay }); }
  /** Adds a library flipbook/particle as an emitter with its suggested Roblox settings; props override them. */
  fromLibrary(id, props = {}, opts = {}) {
    const e = this.cd.vfx._libraryIndex().get(id); if (!e) throw new Error(`No library item ${id} (see cd.vfx.library())`);
    const s = e.suggest ?? {}, life = s.lifetime ?? 1;
    const base = e.kind === 'flipbook' ? { Lifetime: [life, life], Speed: [0, 0], Size: 6, Transparency: 0, LightEmission: s.lightEmission ?? 1, LightInfluence: s.lightInfluence ?? 0, FlipbookLayout: e.layout, FlipbookMode: s.mode ?? 'OneShot', FlipbookFramerate: [s.flipbookFramerate ?? 16, s.flipbookFramerate ?? 16], ZOffset: 0.5 }
      : { Lifetime: [0.4, 0.9], Speed: [6, 14], SpreadAngle: [180, 180], Size: [[0, 1.2], [1, 0]], Transparency: [[0, 0], [1, 1]], LightEmission: 1, LightInfluence: 0, Drag: 2, Rotation: [0, 360] };
    return this.emitter({ name: opts.name ?? e.name, texture: { src: e.texture, ...(e.grid ? { grid: e.grid } : {}), library: e.id }, props: { ...base, ...props }, burst: opts.burst ?? { t: 0, count: e.kind === 'flipbook' ? 1 : 20 }, delay: opts.delay, offset: opts.offset });
  }
  set(key, value) { this.e[key] = value; return this; }
  json() { return structuredClone(this.e); }
}
const texRef = t => !t ? undefined : typeof t === 'string' ? (/^\d+$/.test(t) || t.startsWith('rbxassetid://') ? { assetId: t.replace(/\D/g, '') } : { src: t.replace(/^\/+/, '') }) : t;

export async function createCodex({ root = ROOT, url = process.env.CODEX_DESIGN_URL || 'http://127.0.0.1:4173', log = () => {} } = {}) {
  let browser = null, page = null, server = null, library = null;
  const P = (...a) => path.join(root, ...a);
  const assetIds = async () => { try { return await readJSON(P('vfx', 'asset-ids.json')); } catch { return {}; } };
  const cd = {
    root, url,
    // ---------------- Texture Studio ----------------
    texture: {
      nodes: () => Object.fromEntries(Object.entries(NODES).map(([k, d]) => [k, { category: d.cat, label: d.label, inputs: d.in ?? [], output: d.out, params: d.params.map(p => ({ key: p.key, type: p.type, default: p.default, min: p.min, max: p.max, options: p.options })) }])),
      categories: () => CATEGORIES, maps: () => MAPS, profiles: () => Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, { label: p.label, engine: p.engine, max: p.max, normal: p.normal, maps: p.maps }])), platforms: () => PLATFORMS,
      graph: (name, base) => new GraphBuilder(name, base),
      list: async () => (await readdir(P('textures')).catch(() => [])).filter(f => f.endsWith('.graph.json')).map(f => f.slice(0, -11)),
      load: async name => readJSON(P('textures', `${name}.graph.json`)),
      save: async graph => { const g = plain(graph), id = slugOf(g.name); await writeJSON(P('textures', `${id}.graph.json`), g); return { id, file: `textures/${id}.graph.json`, page: `${url}/texture?material=${id}` }; },
      check: graph => checkGraph(plain(graph)), prune: graph => pruneGraph(plain(graph)),
      evaluate: async (graph, { size = 256, seed } = {}) => { const g = plain(graph); return evaluate(g, { size, seed: seed ?? g.seed, loadGraph: n => readJSON(P('textures', `${n}.graph.json`)) }); },
      /** → {issues (graph + PBR + seams), seams, derived, ms} */
      validate: async (graph, { size = 256 } = {}) => { const g = plain(graph), gi = checkGraph(g); if (gi.some(i => i.level === 'error')) return { ok: false, issues: gi }; const r = await cd.texture.evaluate(g, { size }); const issues = [...gi, ...validatePBR(r.maps, size)]; return { ok: !issues.some(i => i.level === 'error'), issues, seams: Object.fromEntries(['baseColor', 'height', 'roughness'].filter(k => r.maps[k]).map(k => [k, +seamScore(r.maps[k], size).score.toFixed(3)])), derived: r.derived, ms: r.ms }; },
      /** Writes PNG previews of chosen maps → {map: file} */
      preview: async (graph, { size = 256, maps = ['baseColor', 'normal', 'roughness', 'height'], outDir } = {}) => { const g = plain(graph), r = await cd.texture.evaluate(g, { size }), dir = outDir ?? P('exports', 'texture', slugOf(g.name), 'preview'), out = {}; await mkdir(dir, { recursive: true }); for (const m of maps) if (r.maps[m]) { const f = path.join(dir, `${m}.png`); await writeFile(f, png(toRGBA(r.maps[m], size), size)); out[m] = f; } return out; },
      /** Engine export → {dir, files, report}. profiles: ids from profiles() or 'all'. */
      export: async (graph, { size = 1024, profiles = ['roblox-surfaceappearance'], platform = 'pc', outDir, save = true } = {}) => {
        const g = plain(graph), list = profiles === 'all' ? Object.keys(PROFILES) : [profiles].flat(), r = await cd.texture.evaluate(g, { size }), name = slugOf(g.name), ids = Object.fromEntries(Object.entries(await assetIds()).filter(([k]) => k.startsWith('texture:')).map(([k, v]) => [k.slice(8), v]));
        const { files, report } = exportMaterial(name, r.maps, size, list, { deflate: b => deflateSync(b, { level: 6 }), platform, assetIds: ids }), dir = outDir ?? P('exports', 'texture', name), written = [];
        for (const [k, v] of Object.entries(files)) { const f = path.join(dir, k); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, v); written.push(f); }
        if (save) await cd.texture.save(g);
        return { dir, files: written, report, derived: r.derived, issues: validatePBR(r.maps, size) };
      },
      atlas: async (names, { size = 2048, profiles = ['all-maps'], padding } = {}) => { const mats = []; for (const n of names) { const g = await cd.texture.load(n), r = await cd.texture.evaluate(g, { size: Math.min(1024, size / Math.ceil(Math.sqrt(names.length))) }); mats.push({ name: n, maps: r.maps, size: r.size }); } const A = atlas(mats, size, { padding: padding ?? Math.max(2, size / 256) }), { files } = exportMaterial('atlas', A.maps, size, profiles, { deflate: b => deflateSync(b) }), dir = P('exports', 'texture', 'atlas'); for (const [k, v] of Object.entries(files)) { await mkdir(path.dirname(path.join(dir, k)), { recursive: true }); await writeFile(path.join(dir, k), v); } await writeJSON(path.join(dir, 'atlas.uv.json'), { size, rects: A.rects }); return { dir, rects: A.rects }; },
    },
    // ---------------- VFX Studio (Roblox only) ----------------
    vfx: {
      layerTypes: () => LAYER_TYPES, defaults: () => VFX_DEFAULTS, textureKinds: () => Object.fromEntries(Object.entries(TEX_KINDS).map(([k, v]) => [k, v.label + (v.flipbook ? ' (flipbook)' : '')])),
      _libraryIndex: () => new Map([...(library?.effects ?? []), ...(library?.particles ?? [])].map(e => [e.id, e])),
      /** Library search: {query, tag, kind:'flipbook'|'particle', limit} */
      library: ({ query = '', tag, kind, limit = 50 } = {}) => [...(library?.effects ?? []), ...(library?.particles ?? [])].filter(e => (!kind || e.kind === kind) && (!tag || e.tags.includes(tag)) && (!query || `${e.name} ${e.tags.join(' ')} ${e.pack}`.toLowerCase().includes(query.toLowerCase()))).slice(0, limit).map(({ id, name, kind, tags, layout, grid, texture, license, suggest }) => ({ id, name, kind, tags, layout, grid, texture, license, suggest })),
      effect: (name, base) => new EffectBuilder(cd, name, base),
      list: async () => (await readdir(P('vfx')).catch(() => [])).filter(f => f.endsWith('.vfx.json')).map(f => f.slice(0, -9)),
      load: async id => readJSON(P('vfx', `${id}.vfx.json`)),
      save: async effect => { const e = plain(effect), id = slugOf(e.name); await writeJSON(P('vfx', `${id}.vfx.json`), e); return { id, file: `vfx/${id}.vfx.json`, page: `${url}/vfx?effect=${id}` }; },
      /** AI fallback art: procedural texture/flipbook → vfx/textures/<name>.png and a texture ref for layers. */
      drawTexture: async spec => { const img = generateImage(spec), name = spec.name ?? specName(spec), f = P('vfx', 'textures', `${name}.png`); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, png(img.data, img.width, img.height)); return { src: `vfx/textures/${name}.png`, generated: spec, ...(spec.grid && TEX_KINDS[spec.kind]?.flipbook ? { grid: spec.grid } : {}) }; },
      validate: async (effect, opts = {}) => { const ids = await assetIds(), image = Object.fromEntries(Object.entries(ids).filter(([k]) => !k.startsWith('decal:'))), issues = validateEffect(plain(effect), { assets: image, ...opts }); return { ok: !issues.some(i => i.level === 'error'), issues }; },
      timeline: effect => { const { events, duration } = buildEffect(plain(effect)); return { duration, events }; },
      luau: async effects => { const list = [effects].flat().map(plain), ctrl = await readFile(P('src/rbx/vfx-controller.luau'), 'utf8'), ids = await assetIds(); return generateLuau(list, { controller: ctrl, textures: texList(list, ids) }); },
      /** Roblox package → files in exports/vfx/: <Name>.luau (CONFIG + builder + API), .rbxm, .rbxmx, runtime, importer, manifest.
       *  {luauOnly, placeholder, upload (asks nobody: only call after the user agreed), save} */
      export: async (effects, { luauOnly = false, placeholder = false, upload = false, save = true, outDir } = {}) => {
        const list = [effects].flat().map(plain); if (save) for (const e of list) await cd.vfx.save(e);
        let ids = await assetIds();
        if (upload) { for (const r of new Map(list.flatMap(textureRefs).filter(r => r.src && !ids[r.key] && !ids['decal:' + r.key]).map(r => [r.key, r])).values()) { const res = await cd.roblox.upload(P(r.src), { name: `VFX ${path.basename(r.src, '.png')}` }); if (res.imageId) ids[r.key] = res.imageId; else ids['decal:' + r.key] = res.decalId; log(`uploaded ${r.src}`); } await writeJSON(P('vfx', 'asset-ids.json'), ids); }
        const image = Object.fromEntries(Object.entries(ids).filter(([k]) => !k.startsWith('decal:'))), issues = list.flatMap(e => validateEffect(e, { assets: image }).map(i => ({ effect: e.name, ...i })));
        const blocking = issues.filter(i => i.level === 'error' && !((placeholder || luauOnly) && i.code === 'missing-asset-id'));
        if (blocking.length) return { ok: false, issues, files: [] };
        const ctrl = await readFile(P('src/rbx/vfx-controller.luau'), 'utf8'), tex = texList(list, ids), base = list.length > 1 ? 'CodexVFX' : safeName(list[0].name), dir = outDir ?? P('exports', 'vfx'), files = [];
        await mkdir(dir, { recursive: true }); const w = async (n, d) => { await writeFile(path.join(dir, n), d); files.push(path.join(dir, n)); };
        await w(`${base}.luau`, generateLuau(list, { controller: ctrl, textures: tex }));
        if (!luauOnly) { const pkg = buildPackage(list, { assets: image, controller: ctrl, manifest: { textures: tex } }); await w(`${base}.rbxm`, toRBXM(pkg)); await w(`${base}.rbxmx`, toRBXMX(pkg)); await w('VFXStudio.luau', ctrl); await w('CodexVFX_Importer.luau', await readFile(P('src/rbx/vfx-importer.luau'), 'utf8')); }
        await w(`${base}.manifest.json`, JSON.stringify({ effects: list.map(e => e.name), textures: tex, missing: tex.filter(t => !t.imageId && !t.decalId).map(t => t.file) }, null, 1));
        return { ok: true, files, issues, missingIds: tex.filter(t => !t.imageId && !t.decalId).map(t => t.file) };
      },
    },
    // ---------------- GFX Studio (headless browser on the workshop) ----------------
    gfx: {
      presets: async () => (await import('../gfx.js').catch(() => null))?.GFX_PRESETS ? Object.keys((await import('../gfx.js')).GFX_PRESETS) : (await gfxPage()).evaluate(() => window.codexDesign.gfxPresets),
      /** Render one or more presets for a project → [{preset, file, width, height}] in exports/gfx/. format:'exr' → HDR beauty pass. */
      render: async (slug, options = {}) => { const page = await gfxPage(slug), presets = [options.preset ?? 'card'].flat(), out = []; await mkdir(P('exports', 'gfx'), { recursive: true });
        for (const preset of presets) { const exr = options.format === 'exr', r = await page.evaluate(([o, e]) => e ? window.codexDesign.gfxEXR(o) : window.codexDesign.gfx(o), [{ ...options, preset, watermark: options.watermark ?? null }, exr]); const f = P('exports', 'gfx', `${slug}.gfx-${preset}.${exr ? 'exr' : 'png'}`); await writeFile(f, exr ? Buffer.from(r.base64, 'base64') : markPNG(Buffer.from(r.base64, 'base64'))); out.push({ preset, file: f, width: r.width, height: r.height }); } return out; },
      showcase: async (slug, options = {}) => cd.gfx.render(slug, { ...options, preset: ['hero-render', 'studio-premium', 'clay', 'wireframe-pro', 'topology-inspection', 'material-breakdown'] }),
      video: async (slug, options = {}) => { const page = await gfxPage(slug); return page.evaluate(o => window.codexDesign.gfxVideo(o), options); },
      stats: async slug => { const page = await gfxPage(slug); return page.evaluate(() => window.codexDesign.inspect?.() ?? null); },
    },
    // ---------------- UV unwrapping + baking (meshes from .glb/.gltf/.obj or BufferGeometry) ----------------
    uv: {
      load: file => loadGeometry(path.resolve(root, file)),
      /** Smart UV project → {file (.glb with new UVs), stats}. */
      unwrap: async (input, { angle = 66, margin = 0.004, out } = {}) => { const g = typeof input === 'string' ? await loadGeometry(path.resolve(root, input)) : input, u = smartUV(g, { angle, margin }), stats = { charts: u.userData.uvCharts, ...uvStats(u) };
        const file = out ?? P('exports', 'uv', `${typeof input === 'string' ? path.basename(input, path.extname(input)) : 'mesh'}.autouv.glb`); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, geometryToGLB(u)); return { file, stats, geometry: typeof input === 'string' ? undefined : u }; },
      stats: async input => uvStats(typeof input === 'string' ? await loadGeometry(path.resolve(root, input)) : input),
    },
    bake: {
      maps: () => BAKE_MAPS,
      /** High → low bake → PNG (+ optional EXR) maps in exports/bake/<name>/. low without UVs is auto-unwrapped first. */
      highToLow: async ({ high, low, size = 1024, cage = 0.02, ao = 16, maps = BAKE_MAPS, padding = 4, autoUV = true, exr = false, name } = {}) => {
        const hi = typeof high === 'string' ? await loadGeometry(path.resolve(root, high)) : high; let lo = typeof low === 'string' ? await loadGeometry(path.resolve(root, low)) : low;
        let unwrapped = false; if (!lo.attributes.uv && autoUV) { lo = smartUV(lo); unwrapped = true; }
        const r = bakeHighToLow({ high: hi, low: lo, size, cage, ao, maps, padding }), id = slugOf(name ?? (typeof low === 'string' ? path.basename(low, path.extname(low)) : 'bake')), dir = P('exports', 'bake', id), files = [];
        await mkdir(dir, { recursive: true });
        for (const m of maps) if (r[m]) { const f = path.join(dir, `${id}_${m}.png`); await writeFile(f, png(toRGBA(r[m], size), size)); files.push(f); if (exr) { const ch = r[m].c === 3 ? { R: new Float32Array(size * size), G: new Float32Array(size * size), B: new Float32Array(size * size) } : { Y: Float32Array.from(r[m].d) }; if (r[m].c === 3) for (let k = 0; k < size * size; k++) { ch.R[k] = r[m].d[k * 3]; ch.G[k] = r[m].d[k * 3 + 1]; ch.B[k] = r[m].d[k * 3 + 2]; } const e = path.join(dir, `${id}_${m}.exr`); await writeFile(e, writeEXR({ width: size, height: size, channels: ch, type: m === 'height' ? 'float' : 'half' })); files.push(e); } }
        if (unwrapped) { const f = path.join(dir, `${id}_low.autouv.glb`); await writeFile(f, geometryToGLB(lo)); files.push(f); }
        return { dir, files, stats: r.stats, unwrapped };
      },
    },
    // ---------------- Roblox ----------------
    roblox: {
      test: async () => (await import('../../scripts/roblox-cloud.mjs')).introspectKey((await (await import('../../scripts/settings.mjs')).loadSettings()).roblox.apiKey),
      /** Publishes to the user's Roblox account. Only call after the user said yes. */
      upload: async (file, { name, type } = {}) => (await import('../../scripts/roblox-cloud.mjs')).uploadAsset({ file, name, assetType: type }),
      assetIds, setAssetIds: async patch => { const cur = await assetIds(); for (const [k, v] of Object.entries(patch)) { if (v === null) delete cur[k]; else cur[k] = String(v).replace(/\D/g, ''); } await writeJSON(P('vfx', 'asset-ids.json'), cur); return cur; },
    },
    /** Releases the headless browser and any server this SDK started. */
    close: async () => { await browser?.close().catch(() => {}); browser = page = null; if (server) { server.kill(); server = null; } },
  };
  try { library = await readJSON(P('assets', 'vfx', 'library.json')); } catch { library = { effects: [], particles: [] }; }

  async function ensureServer() {
    try { if ((await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
    log('starting workshop server…'); server = spawn(process.execPath, [P('server.mjs')], { cwd: root, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 250)); try { if ((await fetch(url + '/api/health')).ok) return; } catch {} }
    throw new Error('Workshop server did not start (npm start)');
  }
  let currentSlug = null;
  async function gfxPage(slug) {
    await ensureServer();
    if (!browser) { const { launchBrowser } = await import('../../scripts/browser.mjs'); ({ browser } = await launchBrowser()); page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); }
    if (slug && slug !== currentSlug) { await page.goto(`${url}/?project=${slug}`); await page.waitForFunction(() => window.codexDesign?.ready, null, { timeout: 60000 }); currentSlug = slug; }
    else if (!currentSlug) { await page.goto(url); await page.waitForFunction(() => window.codexDesign?.ready, null, { timeout: 60000 }); currentSlug = '(default)'; }
    return page;
  }
  return cd;
}
function texList(list, ids) {
  return list.flatMap(e => (e.layers ?? []).filter(L => L.enabled !== false && L.texture && !L.texture.assetId).map(L => { const n = safeName(L.name ?? L.type), key = textureKey(L.texture);
    return { effect: safeName(e.name), layer: n, key: `${safeName(e.name)}.${n}`, texture: key, file: L.texture.src, imageId: ids[key] ?? null, decalId: ids['decal:' + key] ?? null, path: `Effects/${safeName(e.name)}/` + (L.type === 'emitter' ? `Root/${n}Att/${n}` : L.type === 'mesh' ? `${n}/Mesh` : `Root/${n}`) }; }));
}
export default createCodex;
