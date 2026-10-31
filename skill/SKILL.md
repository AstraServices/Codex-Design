---
name: codex-design-3d
description: Create procedural 3D models, bone rigs, weighted meshes and exportable animations with the local Codex Design Three.js workshop, including Roblox-style studded parts (StudTrain studs), voxel stud models and a surface painter for any mesh (baked rim/glow/vignette looks, AI-designed color gradients, AO, Stud Nature style), GFX product cards / icons / thumbnails / covers with watermark (19 presets), AI-authored PBR materials exported up to 4K, SIMP engineering topology optimization with a quad mesher, smart quad topology, Roblox material presets, textures, extruded icons from the bundled icon packs, Roblox Highlight (fill + outline) and Edge Outlines that are baked into GLB/glTF and driven in Roblox by a generated CodexOutline Luau script, plus a smart QEM LOD optimizer (skin/UV/crease aware, LOD chains) and topology quality scoring/fixing. Use for code-authored 3D assets, GLB/glTF delivery, Roblox-ready models and browser model previews without Blender; not for 2D website or Roblox ScreenGui UI design.
---

# Codex Design 3D

The installed workshop is `C:/Users/astra/CodexDesign`. Read its `AGENTS.md`, `docs/TRAINING.md` (index + behavior rules) and the relevant `Train/<area>/TRAIN.md`, plus `docs/AUTHORING.md`, before authoring an asset; read `docs/RESEARCH.md` only for architectural or format decisions. Respect another workspace explicitly chosen by the user; do not silently move its existing project.

Create the actual geometry, rig and animation the user requested. Work through the shared engine instead of writing a new viewer/exporter per request. There is no separate model-generation API: Codex writes a model recipe, and Three.js constructs it.

## Behavior rules (strict)

- **No Highlight / Edge Outline / glow / sticker outline unless the user asks** or the requested style explicitly needs it; if you think it would help, ask in one line first.
- **No animation clips on static props** (plants, bamboo, trees, rocks, furniture, buildings, tools, weapons, food, gems): no jiggle, sway, bob or spin unless asked. Offer motion instead of adding it.
- Stud = StudTrain (`'train'`, `'train-mixed'`), never Kek unless named. Stylized Roblox props get depth from the baked look + light gradient, not outlines.
- **Gradients and textures are designed per model** — no presets. A blue sign gets a gradient you design (e.g. radial teal → blue → purple from a corner), not flat blue.

## Workflow

1. Create/edit `projects/<slug>.js` and its JSON manifest (`npm.cmd run new -- <slug>` scaffolds without overwriting). `export async function build(k)` adds to `k.root` and `k.clips`. Use named parts and parameterized dimensions; `k.THREE` for custom geometry.
2. Rigid articulation: bone-parented geometry. Continuous deformation: `k.skin` with normalized influences. Animation: `k.clip`, `k.sample`, `k.rotation` or native tracks; a frame callback alone does not export.
3. Look and surface:
   - **Texture rules (strict):** (a) never use the icon pack unless the user asks for icons/the icon pack; (b) if the user says stud / stud texture / studded, use StudTrain: `await k.part(name,[w,h,d],color,{surface,top:'train'})` (default; `'train-mixed'` = stud + inlet), or for voxel / stud-on-every-face models `await k.voxels(...)` / `await k.block(...)` then `await k.gradient('Asset')`; never Kek or the round procedural `'studs'`/`'inlet'` unless requested; (c) otherwise build your own procedural textures (`k.robloxMaterial`, `k.pixelTexture` + `k.normalFromHeight`, `k.pbr`, colors) and do not pull library images.
   - Part sizes in whole studs (`k.STUD` = 0.28 m); use `top:'smooth'` or `'none'` when no studs are wanted.
   - Materials: `k.robloxMaterial('WoodPlanks',{color})` (22 presets), `await k.texture(...)`, `await k.pbr({...})`, `k.pixelTexture`, `k.worldUV(mesh)` for stud-unit tiling.
   - Icons only on request: `npm.cmd run assets -- "<words>" --kind icon`, then `await k.iconBadge(name,query,{size,depth})`, `k.iconPlane` or `k.decal`. Respect pack licenses printed by the search.
   - **Surface system (docs/TRAINING.md §1):** `await k.voxels(name,{size,fill}|{rows,palette})`, `await k.block(...)`, `await k.paint(anyMesh,{look,studs,gradient,painter,occlusion})`, then `await k.gradient('Asset','light')` and your own color gradients `{stops,type,from/to|center,space,mode}`. Look = 'default' (measured), 'flat' or your own object (every LOOK_DEFAULTS key; no named looks; glow-edge example in Train/StudveGradientVideo/TRAIN.md).
   - **PBR you write:** `k.pbrSurface({height,albedo,roughness,metalness},{size,repeat})` from `k.tex.*`, or model-aware `painter` in `k.paint`. 4K export: `npm.cmd run texture -- textures/<name>.js --size 4096`.
   - **Engineering topology optimization:** `k.topologyPart(name,{case,volfrac,nelx,nely,size,thickness,mesher:'quad'})` (watertight quad mesher). **Smart topology:** `k.smartTopology('auto'|'animation'|'subdivision'|'game'|'print')` — context-aware (quads where they matter, triangles kept on static hard-surface/game/print); OBJ keeps quads.
4. Highlight vs. outline — **only when the user asks** (both export into the file, not preview-only):
   - Roblox Highlight = fill tint + silhouette outline: `k.highlight(target,{FillColor,FillTransparency,OutlineColor,OutlineTransparency,DepthMode})`; `FillTransparency:1` = outline only. Glow is a separate optional extra; do not add it unless asked.
   - Edge Outline = lines on silhouette and hard edges, fill off by default: `k.edges(target,{color,thickness,creaseAngle})`.
5. `npm.cmd run inspect -- <slug>` for compact counts, textures, highlights, edge outlines and warnings (`--topology` / `--details` for mesh flow). Avoid putting mesh arrays in context.
   - **Request routing (strict):** "optimize the model" → optimize it yourself in the recipe (fewer segments where curvature allows, merge/remove hidden faces, instancing, reuse geometry, density only at silhouette/curvature/joints) and verify with `--quality`; do not use the site's LOD tools for this. "Smart topology" / "akıllı topoloji" → use the site's smart topology feature (`k.quality()`/`--quality`, `k.fixTopology()`/Smart fix, Quads view). LOD tools only when LOD is explicitly requested.
   - Topology quality: `--quality` scores 0–100 (quad dominance, n-gon fans, poles incl. poles inside joints, density, triangle quality, manifold, ≥3 edge loops per skinned joint). Improve weak criteria in the recipe; `k.fixTopology()` only does shape-preserving cleanup/flips/relax.
   - LOD: `await k.lod({reduction:0.5,maxError:0.015})` (QEM; UV/crease/skin-weight aware, stops at the error budget; works on skinned meshes), or export `--lod 0.5` / `--lod-chain` (LOD0–3). Add `--cull` for far LODs of models made of many small parts. Report achieved reduction and error honestly; beyond ~75% the silhouette breaks.
6. The preview is hybrid CPU + GPU: GPU renders, worker threads run LOD/audits/quality so the page does not stutter (`window.codexDesign.hardware()`). Viewer lighting: contrast rig with orbit-following key/fill/rim, fitted shadows, contact shadow and SSAO. Presets `studio` (default), `dramatic`, `soft`, `sunset`, `roblox`, `classic` via the ☀ menu / key `L`, `?light=`, manifest `"lighting"`, or `png --light <preset>`. Viewer-only: exports carry materials, not lights.
7. **Always show the preview:** `npm.cmd run preview -- <slug>` starts the workshop on `http://127.0.0.1:4173` if needed and opens `http://127.0.0.1:4173/?project=<slug>` in the default browser (`--no-open` just prints the URL). If a browser tool is available, also open that URL yourself and check silhouette, pose, motion, highlights and outlines. Files reload live.
8. GFX (site ✧ GFX Studio or CLI; video: `--video mp4|gif --clips "A,B"|all --mode sequence|together --crossfade 0.3 --turntable 360`, seamless + anchored by default; `--bg-image photo.jpg`): `npm.cmd run gfx -- <slug> --preset <name>|all --title "…" --tag "…" --subtitle "…" --footer "…" [--watermark "…" --wm-position bottom-right --wm-opacity 0.35]` → `exports/<slug>.gfx-<preset>.png`; 19 presets (`--list`): card, card-dark, card-color, social, cover, banner, icon, icon-rarity, icon-minimal, thumbnail(-sunset/-night), showcase, podium, blueprint, halftone, turnaround, sticker, transparent. Watermark defaults live in `gfx.config.json` (saved from the ✧ GFX dialog, key `G`). Offer a GFX card with finished props.
9. For Roblox delivery read `docs/ROBLOX.md` and export `npm.cmd run export -- <slug> roblox`: extract the ZIP and import its external-resource `model.gltf`. The package contains PNG textures, material mapping, native editable animation saves and a Studio installer. For a single GLB/glTF use `--target roblox` (shared bone palette, rigid children skinned, bind-space geometry, texture transforms baked to UV0). GLB/glTF download buttons and CLI default to Roblox; `--target generic` selects generic export.
10. Generic export: `npm.cmd run export -- <slug> glb` (also `gltf`, `obj`, `stl`, `json`, `png`, `lua`). Highlights/edges bake by default (`--highlights full|outline|none`). For Roblox also export `lua` → `exports/<slug>.outline.lua` (CodexOutline Script/ModuleScript). Verify the delivered file with `http://127.0.0.1:4173/?import=exports/<slug>.glb&baked=1`.
11. Engine changes: `npm.cmd test` and `npm.cmd run test:browser`. New assets: inspect, export, view and validate the GLB rather than hardcoding tests for the recipe.

## Prompts written with PROMPT.md

`PROMPT.md` in the workshop is a brief another AI reads to turn a user's words (no reference images) into a concept
and a model prompt. Such a prompt has numbered sections: `0. Görsel tarif (niyet)` (the visual intent, which wins on
conflicts), identity/slug, size in studs, parts table, surface (look object, studs), ordered gradient specs, rig/clips,
effects (explicit "yok" = do not add), parameters, budget, delivery, "Yapma" list and acceptance criteria. Build exactly
that: create the slug, follow the parts table and gradient order, add only the effects and clips it lists, then check
every acceptance item before delivery. If the prompt asks for something the engine cannot do, or names a look preset
other than `'default'`/`'flat'`, say so and use the closest supported spec.

## Delivery / constraints

- Roblox: do not promise that a model import creates AnimSaves. Modern ACE saves use ServerStorage sequences plus AnimSaves ObjectValue references; use the generated installer or Animation Editor glTF import. Publishing IDs is separate. Native saves support bone translation/rotation, not animated scale/morphs. HDR base colors are clamped to glTF 0–1 with export warnings; do not claim exact HDR-preview matching. Bind all meshes before posing; avoid negative bind scales. Incompatible UV channels/transforms require an atlas. If Studio is unavailable, report that only validation/reimport was verified.
- GLB/glTF keep PBR materials, embedded textures, skeletons, skins, clips, and highlight/edge settings (`CODEX_highlight`, `CODEX_edges`) plus baked outline/fill/edge geometry that renders in any engine in standards-compatible viewers without a Highlight instance; verify Roblox import separately. Prefer GLB.
- `AlwaysOnTop` x-ray cannot be represented by geometry; baked shells behave like `Occluded`. Say so when relevant.
- OBJ+MTL ZIP and STL are static posed exports with base colors only. FBX import exists; FBX export does not. Do not relabel files.
- This is procedural authoring, not a text-to-mesh neural model, sculpt package or automatic retopology/autorig service. Explain the specific gap if a request needs one.
- Keep assets local unless the user asks to publish. No Blender or paid AI API is required.
- Return the preview URL and clickable links to the export files; include a rendered preview for finished visual assets.
