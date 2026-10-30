# Codex Design 3D

This workspace is a local procedural modeling and animation engine, not a website design brief. Produce the requested 3D asset and actual export files. Use Three.js; Blender is not part of the workflow.

- **Read `docs/TRAINING.md` first**, then the `Train/<area>/TRAIN.md` you need (StudTrain studs, Stud Nature video measurements, gradients, GFX, simulator items/model packs, AI-written PBR textures, topology). `Train/catalog.json` sorts the reference images.
- Read `docs/AUTHORING.md` for the compact modeling API. Reuse `src/kit.js`, the viewer and exporters; change the shared engine only when the asset needs a missing capability.
- Put each asset in `projects/<slug>.js` with a matching JSON manifest. `build(k)` adds geometry and clips to the kit. Use deterministic code and named components.
- Build meaningful silhouettes and modeled detail. Do not substitute a fixed template or keyword-based generator for the user's requested model.
- Animate through `AnimationClip` tracks. A requestAnimationFrame visual effect alone is not an exportable animation. Use real `SkinnedMesh` weights when a mesh must bend. Rigid armor may be parented to bones.
- Mesh topology, units and export needs depend on the user's request. Default to meters, Y up, +Z forward; avoid negative scale for mirrored parts.
- `npm run inspect -- <slug>` reports compact asset stats (incl. textures, highlights, edge outlines) without screenshots or geometry dumps.
- For topology-sensitive work, use `npm run inspect -- <slug> --topology`. `--details` adds all per-mesh reports. Start organic deforming surfaces with `k.quadSurface` or explicit ring loops, with extra density near joints/curvature. Audit edge connectivity and triangle quality; revise geometry flow in the recipe instead of treating decimation as retopology.
- `await k.optimize({ratio:0.6,error:0.005})` performs exact full-attribute weld, degenerate cleanup and constrained static reduction. Make build async when using it. Weighted and morph meshes are protected from reduction. CLI export accepts `--ratio 0.6` for a reduced delivery variant.

## Behavior rules (strict)

- **Highlights / Edge Outlines / glow / GFX sticker outlines: never on your own.** Only when the user asks, or the requested style explicitly needs it. If you think one would help, ask in one line first. Most models (and the whole stud/gradient style) must have none.
- **Animation: never on your own.** Static props (plants, bamboo, trees, rocks, furniture, buildings, tools, weapons, food, gems) get no clips: no jiggle, sway, bob, spin, idle. Animate only when asked, or for characters/creatures/mechanisms whose purpose is to move. Offer motion; do not add it.
- **Gradients are designed per model, never picked from presets** (there are none). Two features: (1) surface light: look (rim/glow/vignette/AO) + `k.gradient('Asset','light')`; (2) color gradients you design: `{stops, type:'linear'|'radial'|'spherical'|'angular'|'normal'|'noise'|'edge'|'face', from/to/center ('bottom-left'…), space, mode, amount}`. A colored object (e.g. a blue sign) should not be flat unless asked.
- **Textures are written per model**: `k.pbrSurface({height, albedo, roughness, metalness})` built from `k.tex` (texlab) or model-aware `k.paint(mesh,{painter:{albedo,roughness,metalness,height,emissive}})`. The PBR examples are for learning, not a catalog.

## Topology quality and LOD

**Which tool for which request (strict):**
- "optimize the model" / "make it lighter" / "reduce polys" → **you optimize it yourself in the recipe**: fewer radial/height segments where curvature allows, merge co-planar parts, remove hidden faces and invisible detail, reuse shared geometry/materials, instancing for repeats, keep density only at silhouette, curvature and joints. Then verify with `npm run inspect -- <slug> --quality`. Do not reach for the site's LOD slider, `k.lod` or `--lod` for this.
- "smart topology" / "akıllı topoloji" → use the site's smart topology feature: `k.quality()` / `--quality` for the score, `k.fixTopology()` / the "Smart fix" button, and the Quads view.
- LOD tools (`k.lod`, `--lod`, `--lod-chain`, the LOD slider) only when the user explicitly asks for LOD / LOD levels / the LOD optimizer.

- `npm run inspect -- <slug> --quality` scores topology 0–100 (A–F): quad dominance, n-gon fans, pole placement (poles inside skinned joints are flagged), even density, triangle quality, manifoldness, and ≥3 edge loops across every skinned joint. Fix low criteria in the recipe (ring/quad flow, more loops at joints) before delivery.
- Smart LOD (QEM edge collapse; UV-, normal-, crease-, border- and skin-weight-aware; manifold- and flip-safe; stops at an error budget): `await k.lod({reduction:0.5,maxError:0.015})` in a recipe (persistent), the workshop's LOD slider (live preview, exports use it), or `npm run export -- <slug> glb --lod 0.5 [--max-error 0.015] [--cull]`. `--lod-chain` writes LOD0–LOD3 GLBs. Skinned meshes are reduced too: weights are blended, joint loops protected.
- `--cull` / "Cull tiny parts" removes the smallest detached parts for far LODs (needed for models built from many small pieces). Beyond ~75% reduction the silhouette starts to collapse; use those levels only at distance.
- `k.fixTopology()` / "Smart fix": removes bad faces, Delaunay-flips edges only on flat areas, relaxes flat-region vertices along the surface (UV/weights re-interpolated). It never changes the shape; it cannot invent edge loops: real retopology stays in the recipe.

## Texture rules (follow strictly)

1. **Icon pack: only on request.** Never use `assets/library` icons (`k.iconBadge`, `k.iconPlane`, `k.decal` with library icons) unless the user explicitly asks for an icon, emblem from the pack or the icon pack. Do not add them on your own initiative.
2. **"Stud" / "stud texture" / studded / brick look → StudTrain stud texture.** `k.part(..., {top:'train'})` is the default (`'train-mixed'` = stud + inlet checker). For voxel/stud-on-every-face models use `k.voxels` / `k.block` (StudTrain overlay baked per face). Do **not** use Kek (`'kek'`, `'stud-3'`) unless the user names Kek; `'square'` / `'square-mixed'` / `'universal-hd'` only on request. Check them with `npm run assets -- --studs`. Do **not** use the round procedural `'studs'` / `'inlet'` styles unless the user asks for round/procedural studs. `studs:'mesh'` (real 3D stud cylinders) only when real geometry studs are requested.
3. **Otherwise make your own textures.** When the user does not mention the icon pack or studs, do not pull images from the library: build the look procedurally with `k.robloxMaterial(...)` presets, `k.pixelTexture(w,h,fn)` + `k.normalFromHeight(...)`, `await k.pbr({...})` and vertex/material colors, tuned to the model.

## Roblox look: studs, materials, textures

- `await k.part(name,[w,h,d],color,{surface,top,bottom,studs})` makes a Roblox-style Part. Sizes in meters; one stud is `k.STUD` (0.28 m), so use whole-stud sizes (`8*k.STUD`). `top`: a library stud texture (default `'train'` = StudTrain; `'train-mixed'`; Kek/other library studs only on request), `'smooth'`, `'none'`, or the procedural round `'studs'`/`'inlet'` (only on request). `studs:'mesh'` adds real stud cylinders.
- Use stud surfaces only when the user asks for studs/a studded/brick look (`top:'none'` or `'smooth'` otherwise). Otherwise keep surfaces smooth or use `k.robloxMaterial(name,{color})` (`SmoothPlastic, Plastic, Neon, Metal, DiamondPlate, CorrodedMetal, Foil, Glass, Wood, WoodPlanks, Brick, Cobblestone, Concrete, Slate, Granite, Marble, Pebble, Sand, Grass, Ice, Fabric, ForceField`). Tiling textures need stud-unit UVs: `k.part` does this; otherwise call `k.worldUV(mesh)`.
- `await k.texture(path,{repeat})`, `await k.pbr({map,normalMap,...})`, `k.pixelTexture(w,h,fn)` and `k.normalFromHeight` cover custom textures. Generated textures are deterministic and embed in GLB/glTF.

## Surface system, PBR, topology optimization, GFX (v0.6)

- `await k.voxels(name,{size,fill}|{cells}|{rows,palette,depth},{look,studs,gradient,painter,voxel})`: greedy voxel mesh, exact AO, StudTrain studs on every face, everything baked into one atlas.
- `await k.block(name,[w,h,d],color,{colors,look,studs,gradient,painter,at})`; `await k.paint(target,{look,studs,gradient,painter,occlusion})` for **any** mesh (rims only on hard edges, skin kept); `await k.gradient(target,spec|'light')` stacks + re-bakes; `await k.look(target,name|{…})`.
- Look: `'default'` (measured), `'flat'` or your own object with any `LOOK_DEFAULTS` key (no named looks; examples incl. the bright glow edge in `Train/StudveGradientVideo/TRAIN.md`). Rims only on convex edges. Site: Surface Look panel edits every parameter live.
- PBR: `k.pbrSurface(def,{size,repeat})`, `k.tex.*` building blocks; `npm run texture -- textures/<name>.js --size 4096` exports full map sets. Example: `textures/mossy-castle-stone.js`.
- Topology: `k.smartTopology('auto'|'animation'|'subdivision'|'game'|'print')` classifies each mesh (deforming/organic/hard-surface) and only adds quads where they matter; `subdivision` gives 100% quads, shape unchanged. OBJ export keeps quads; GLB stays triangulated. `k.topologyPart(...)` = SIMP with a watertight quad mesher. CLI: `npm run export -- <slug> obj --topology subdivision`.
- GFX: ✧ GFX Studio on the site (live preview, background photo, watermark, MP4/GIF with clip sequence/together, crossfade, seamless loop, turntable, anchored framing; ffmpeg bundled). 19 presets (`npm run gfx -- <slug> --list`), watermark (`--watermark "…" --wm-position … --wm-opacity … --wm-size … --wm-rotation … --wm-tile --wm-image logo.png`, defaults in `gfx.config.json` saved from the ✧ GFX dialog). Offer a GFX card when delivering a finished prop. No sticker outline unless asked or the preset is sticker/halftone.
- Workshop sidebar: Workspace / Asset Library tabs; hiding a model (×) only hides it from the sidebar (`workspace.json`), the Asset Library restores it.

## Icon pack: only when the user asks

`assets/library/` holds the bundled UI packs (gvesster icon packs, RhosGFX vector icons, UI Icon Pack Catalog, Kek UI essentials, UI Resources). Search with `npm run assets -- "<words>" [--kind icon|texture|effect]`; licenses print with the results.

- Use an icon only when the user asks for icons / the icon pack (see Texture rules). Never decorate parts with icons on your own.
- `await k.iconBadge(name,'Golden Coin',{size,depth})` extrudes an icon's silhouette into a 3D badge; `k.iconPlane` makes a flat cutout; `k.decal(name,target,src,{at,normal,size})` projects an image onto a static mesh.
- RhosGFX icons are for the user's own games only; UI Icon Pack Catalog is reference-only unless the user confirms rights. Prefer gvesster packs for commercial work.

## Roblox Highlight and Edge Outline (preview AND export)

Both are real asset data, not viewer-only effects.

- **Highlight** = Roblox Highlight: fill tint + silhouette outline. `k.highlight(target,{FillColor,FillTransparency,OutlineColor,OutlineTransparency,DepthMode})` (camelCase also works). `FillTransparency:1` turns the fill off for outline-only. Glow (`glow`) and `fillStyle`/`pulse` are optional extras; do not add glow unless asked.
- **Edge Outline** = lines on silhouette and hard edges (classic Roblox part outlines). `k.edges(target,{color,thickness,creaseAngle,fill:false})`. Fill is off by default.
- Export: GLB/glTF carry `CODEX_highlight` / `CODEX_edges` node extensions (exact settings, re-importable) and baked geometry: inverted-hull outline, fill overlay and edge strips (`<Part>_HighlightOutline`, `_HighlightFill`, `_EdgeLines`, `_EdgeSilhouette`). Skinned parts get skinned shells. The baked geometry renders in any glTF viewer/engine and in Roblox without a Highlight instance. `npm run export -- <slug> lua` writes `CodexOutline`, a Luau Script/ModuleScript that styles and controls those shells in Roblox (recolor, toggle, pulse). `--highlights outline` drops fill shells; `--highlights none` exports settings only.
- AlwaysOnTop (seeing through walls) cannot be stored in glTF geometry; the baked shells behave like `Occluded`. Say so when it matters.

## Hybrid CPU + GPU preview (no stutter)

The browser preview splits the work so the page never freezes: the GPU (high-performance adapter requested) only renders, while QEM LOD, detail culling, topology audits and quality scoring run on a pool of module workers (`src/worker-pool.js`, `src/geometry-worker.js`, one per spare CPU core, max 6) with results identical to the synchronous code. Audits are cached per geometry. Under GPU load the render scale drops in 0.25 steps and climbs back when frames are fast (not in automated runs). The viewport footer shows the GPU, CPU worker count and render scale; `window.codexDesign.hardware()` reports them. Keep new heavy geometry work in the worker pool, not on the main thread.

## Viewer lighting

The workshop renders with a contrast lighting rig (`src/lighting.js`): a strong key, cool fill and bright rim that follow the orbit, low ambient/environment, a shadow frustum fitted to the model, a contact shadow, and screen-space ambient occlusion in the compositor. Presets: `studio` (default), `dramatic`, `soft`, `sunset`, `roblox`, `classic` (old flat look). Switch with the ☀ menu or key `L`, `?light=<preset>` in the URL, `"lighting": "<preset>"` in a project manifest, `window.codexDesign.lighting('dramatic')` or `{preset, exposure, env, ao, key:[color,intensity,dir], ...}` overrides, and `npm run export -- <slug> png --light dramatic`. This is viewer lighting only; exported GLB/glTF files carry materials, not the viewer's lights.

## Preview: always show the result

After creating or changing a model, start the local workshop and open the preview yourself:

```
npm run preview -- <slug>
```

This starts `server.mjs` on `http://127.0.0.1:4173` if it is not running, opens `http://127.0.0.1:4173/?project=<slug>` in the default browser and prints the URL (`--no-open` only prints). If you have an in-app/browser tool, open the same URL there and look at it. File changes reload live. To check what an exported file really contains, open `http://127.0.0.1:4173/?import=exports/<slug>.glb&baked=1` (baked geometry only, as other engines see it). Give the user the preview URL and links to the export files (and a GFX card for finished props: `npm run gfx -- <slug>`).

## Export / verify

- `npm run export -- <slug> glb` writes the animated asset to `exports/`. PNG, glTF, OBJ ZIP, STL, Three.js JSON and `lua` are supported. For visual QA use PNG or the browser; do not mistake a successful script for a verified render.
- New engine behavior: run `npm test` and `npm run test:browser`. Asset-only edits: inspect, export, view the rendered asset and validate the GLB as appropriate. Use `docs/RESEARCH.md` for format constraints and research.
- GLB/glTF preserve PBR materials, textures, rig, clips, highlights and edge outlines. OBJ/MTL and STL bake a static pose. FBX import exists; FBX export is not implemented. State limitations accurately.
- No separate AI API is required: the Codex conversation writes recipes to disk; live reload updates the browser. Never claim an autonomous text-to-mesh service runs in the viewer.

## Roblox delivery updates

Read `docs/ROBLOX.md` for Roblox export/rig/texture/animation work. Prefer the `roblox` ZIP target; use `--target roblox` for standalone GLB/glTF. Do not promise automatic AnimSaves or scale/morph support. Validate external resources and inspect a reimport, then test in Studio when available.
