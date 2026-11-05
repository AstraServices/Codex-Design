# Codex Design SDK (code API for AIs)

The studios keep their UI. The SDK gives AIs the same engines as code, so a model can build, validate, export and
render by running a script. Everything it creates lands in the shared files (`textures/`, `vfx/`, `projects/`,
`exports/`), and the open studio pages reload it live. The API is a helper for the AI, not a replacement for the UI.

## Three ways in

| Way | Use | Example |
|---|---|---|
| Script runner | multi-step jobs | `npm run codex -- run my-job.mjs` with `export default async (cd, args) => { … }` |
| One call | quick single action | `npm run codex -- call texture.validate '[{"name":"x","nodes":[…],"outputs":{…}}]'` |
| HTTP | tools that cannot spawn Node | `POST http://127.0.0.1:4173/api/sdk/<area>/<op>` with a JSON array of arguments |
| Import | inside your own Node code | `import { createCodex } from './src/sdk/codex.mjs'` |

`npm run codex -- help` lists every call. `examples/sdk-demo.mjs` uses all areas in one script (about 7 s).
`roblox.upload` is not available over HTTP, and every Roblox upload needs the user's yes (see AGENTS.md).

## Areas

**texture**: `nodes()`, `categories()`, `maps()`, `profiles()`, `platforms()`, `graph(name)`, `list()`, `load(name)`,
`save(graph)`, `check(graph)`, `prune(graph)`, `evaluate(graph,{size})`, `validate(graph,{size})`,
`preview(graph,{maps,size})`, `export(graph,{size, profiles, platform})`, `atlas(names,{size})`.

`graph(name)` returns a builder: `const id = g.node(type, params, inputs, id?)`, `g.output(map, id)`, `g.set(key, value)`, `g.json()`.
Profiles: `roblox-surfaceappearance`, `roblox-materialvariant`, `unity-urp`, `unity-hdrp`, `unreal`, `godot`, `blender`,
`gltf`, `specgloss`, `exr-linear`, `all-maps`.

**vfx**: `library({query, tag, kind})`, `effect(name)`, `list()`, `load(id)`, `save(effect)`, `drawTexture(spec)`,
`validate(effect)`, `timeline(effect)`, `luau(effects)`, `export(effects,{luauOnly, placeholder, upload})`,
`layerTypes()`, `defaults()`, `textureKinds()`.

`effect(name)` returns a builder with these layer methods: `.emitter({name, texture, props, burst|continuous, delay, offset})`,
`.fromLibrary(id, props, {name, burst})`, `.beam()`, `.trail()`, `.light({cls, props, anim})`,
`.mesh({shape, material, size, anim})`, `.highlight()`, `.post({cls})`, `.set()`, `.json()`.
A texture can be a library/generated reference, a file path, or a Roblox id (`'123'`).

**uv**: `load(file)` reads `.glb/.gltf/.obj` into a geometry. `unwrap(fileOrGeometry,{angle, margin})` writes an
auto-UV `.glb` and returns its stats. `stats(fileOrGeometry)` returns islands, overlap, stretch, utilization,
texel density and flipped triangles. On a workshop model, use `k.autoUV(mesh|name, opts)` in the recipe instead.

**bake**: `highToLow({high, low, size, cage, ao, maps, padding, autoUV, exr})` writes normal, AO, height, curvature and
position maps (PNG, plus EXR on request) to `exports/bake/<name>/`. A low mesh without UVs is unwrapped first.

**gfx**: `presets()`, `render(slug,{preset | [presets], title, renderMode, …, format:'exr'})`, `showcase(slug)`,
`video(slug, opts)`. GFX runs headless Chromium on the workshop and starts the server if it is not running.

**roblox**: `test()` checks the key and its scopes. `upload(file,{name,type})` asks for consent first.
`assetIds()` and `setAssetIds(patch)` read and write the shared id map in `vfx/asset-ids.json`.

## Example

```js
export default async cd => {
  const g = cd.texture.graph('mossy-bricks');
  const b = g.node('bricks', { rows: 8, cols: 4 }), moss = g.node('weathering', { kind: 'moss' }, { height: b });
  g.output('height', b).output('baseColor', g.node('blend', { mode: 'mix' }, { a: g.node('colorRamp', {}, { in: b }), b: g.node('color', { color: '#4f7a2a' }), mask: moss }));
  await cd.texture.export(g, { size: 1024, profiles: ['roblox-surfaceappearance', 'unreal'] });   // now visible at /texture?material=mossy-bricks
  const fx = cd.vfx.effect('MossPuff').fromLibrary('vfx-pack2/cloud-01', { Color: '#9fdc6a' });
  return cd.vfx.export(fx, { luauOnly: true });                                                   // exports/vfx/MossPuff.luau
};
```
