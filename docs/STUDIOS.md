# Codex Design studios (v0.8 custom)

AIs can drive every studio from code without clicking: see `docs/API.md` (SDK, `npm run codex`, `/api/sdk`).

Three studios share the workshop server (`npm start`, `http://127.0.0.1:4173`), its palette and its settings:

| Page | URL | Files (shared by every agent) | CLI |
|---|---|---|---|
| 3D Workshop + GFX Studio 2.0 | `/` (GFX dialog: key `G`, or `/?project=<slug>&gfx=1`) | `projects/<slug>.js/.json` | `npm run gfx`, `npm run export` |
| Texture Studio | `/texture?material=<id>` | `textures/<id>.graph.json` | `npm run texture -- textures/<id>.graph.json` |
| VFX Studio (Roblox only) | `/vfx?effect=<id>` | `vfx/<id>.vfx.json`, `vfx/textures/`, `vfx/asset-ids.json` | `npm run vfx`, `npm run roblox:upload` |

Settings (⚙ in every header, key `,`) live in `codex.settings.json` (git-ignored): Roblox Open Cloud API key (write-only
from the page), creator type + id, upload behaviour, language, texture/VFX/GFX defaults. The server never returns the key.

## Texture Studio

A material is a node graph. The AI writes the JSON; the page reloads it live.

```json
{ "name": "volcanic-rock", "seed": 7, "normalStrength": 6, "metalness": 0,
  "nodes": [ { "id": "cracks", "type": "cracks", "params": { "scale": 5 }, "x": 40, "y": 190 },
             { "id": "albedo", "type": "blend", "params": { "mode": "mix" }, "inputs": { "a": "rock", "b": "lava", "mask": "cracks" } } ],
  "outputs": { "baseColor": "albedo", "height": "height", "roughness": "rough", "emissive": "glow" } }
```

- Nodes (`src/texture/graph.js` → `NODES`): Noise (perlin, fbm, simplex, ridged, turbulence, worley/voronoi — all with
  domain warp), Patterns (cracks, scratches, erosion, gradient, shape/SDF, bricks/tiles, stones, hexagons, wood, fabric,
  stripes, dots), Roblox (studs: density, size, height, bevel, stud/inlet/tube, stagger), Input (value, color),
  Geometry (meshMask, curvature, ambientOcclusion, slope, heightMask), Filter (levels, invert, threshold, blur, sharpen,
  warp, transform), Stylized (pixelate, posterize, paletteLock), Normal (normalFromHeight OpenGL/DirectX, normalBlend),
  Color (colorRamp, hsv), Blend (blend: mix/add/subtract/multiply/screen/overlay/max/min/height, math), Weathering
  (edgeWear, dirt, dust, rust, moss, snow, ice, sand), Custom (glsl on the GPU, subgraph = reusable material function).
- Outputs: baseColor, normal, roughness, metalness, height, ao, emissive, opacity, curvature, thickness. Missing normal/AO/
  curvature/thickness are derived from height; the page lists what was derived.
- Every generator is periodic → seamless; the validator measures the wrap seam, albedo energy range, metalness
  binariness, roughness, normal validity. Same seed → same pixels. `✂ Optimize graph` removes nodes no output uses.
- 3D: sphere/cube/plane/cylinder/torus/rock or your GLB, Studio HDRI / Roblox-like / dramatic / flat light, channel views,
  UV checker, wireframe, tiling, A/B compare. 3D paint: brush, eraser, fill on baseColor/roughness/metalness layers,
  pen pressure, X symmetry, undo; merged into exports. Geometry masks: bake curvature/convex/concave/slope/up/height/AO
  from the mesh into UV space, then use the `meshMask` node (snow on tops, dirt in cavities, wear on edges).
- Export profiles (`src/texture/export.js`): Roblox SurfaceAppearance (ColorMap+alpha, NormalMap, RoughnessMap,
  MetalnessMap, ≤1024, `.rbxmx`), Roblox MaterialVariant, Unity URP/Built-in (MetallicSmoothness), Unity HDRP (MaskMap),
  Unreal 5 (ORM, DirectX normal), Godot 4 (ORMMaterial3D `.tres`), Blender (Principled maps), glTF 2.0 (`.gltf` plane,
  validator-clean), Specular/Glossiness, all-maps. Platform caps PC/console/mobile/VR/Roblox, GPU memory estimates.
  Atlas: several saved materials → one grid atlas + UV rects. Roblox upload writes ids into the `.rbxmx` + a Luau snippet.
- UV & baking (v0.8.1): **Auto UV** (smart project: charts by normal angle, folding charts split until flat → 0 overlaps,
  PCA-aligned, shelf-packed with one scale = uniform texel density; stats: islands, overlap, stretch, utilization,
  flipped) and **high → low-poly baking** (cage raycast into a BVH: tangent-space normal OpenGL, AO, height, curvature,
  position, padding/dilation) → use with the `bakedMap` node. Also via SDK (`cd.uv`, `cd.bake`) and `k.autoUV` in recipes.
- EXR: `exr-linear` profile (half color, 32-bit float height, linear). Not done: clone/smudge brushes, USD/FBX material
  files (use glTF), GPU-compressed files (engines compress on import; memory is estimated).
  produced by the engines on import (PNG is exported), USD/FBX material files are not written (use glTF).

## VFX Studio (Roblox only)

See `Train/VfxTrain/TRAIN.md` for the library, the layer format, Roblox rules and the export/import flow. Key facts:
- Three.js only previews. Exports: Luau code generator (CONFIG table + builder + runtime in one ModuleScript), `.rbxm`
  binary + `.rbxmx` XML (verified by deserializing in Roblox Studio), runtime controller, importer, textures, manifest, ZIP.
- Export → *Upload flipbooks/textures → write IDs into Luau → build ZIP*: one button with the API key field in the dialog.
- Validator errors block `.rbxm/.rbxmx` export unless *placeholders* are chosen; missing ids never block the Luau code
  (its CONFIG table is where ids go) and are listed in the manifest.

## GFX Studio 2.0

- **Long titles never get cut**: `titleFit` auto (shrink, then wrap to two balanced lines), shrink, wrap, off; `titleScale`
  0.4–1.8 (dialog: *Title size*, *Long titles*; CLI `--title-scale`, `--title-fit`; Settings → GFX defaults).
- Render modes (`renderMode`): beauty, clay, matcap, normal, wireframe, wire-overlay (solid + edges, works on skinned
  meshes), density (triangle density heatmap), uv (checker), roughness, metalness, emissive, depth.
- Presentation: `explode` (exploded view), `skeleton` (bone overlay), `stats` (triangles, vertices, meshes, materials,
  textures, bones, draw calls, GPU MB), `angle: 'auto'` (best silhouette from 36 directions), letterbox, 2×/4× output
  (≈4K/8K), PNG/WebP/JPEG download.
- New presets: hero-render, studio-premium, clay, wireframe-pro, topology-inspection, uv-inspection, material-breakdown,
  pbr-showcase, exploded-view, assembly, rig-showcase, animation-showcase (6-pose contact sheet), cinematic-turntable
  (pair with Video → turntable 360°), lod-comparison (LOD0–LOD3 with triangle counts), technical-blueprint, multi-angle-grid.
- **Automatic showcase**: dialog button or `npm run gfx -- <slug> --preset showcase` → hero-render, studio-premium, clay,
  wireframe-pro, topology-inspection, material-breakdown. After finishing a model, offer it (Settings → GFX).
- **Ray traced** (v0.8.1): `renderMode: 'pathtrace'` (presets `raytraced-hero`, `raytraced-dark`): CPU path tracer on
  all cores (BVH, multi-bounce GI, glossy/metal reflections, soft key-light shadows, emissive, ground contact shadows,
  edge-aware denoise, ACES). About 35 s for 800² at 16 spp on 12 cores; `spp`, `bounces`, `rtMaxSize` trade speed for quality.
  Materials: base/roughness/metalness/emissive maps; no refraction/subsurface/volumes yet.
- **EXR** (v0.8.1): GFX dialog format "EXR (HDR beauty pass)" or `cd.gfx.render(slug, {format:'exr'})`: float render target,
  no tone mapping, linear RGBA (values above 1 kept). The 2D card layout (text, backgrounds) stays PNG/WebP/JPEG.
