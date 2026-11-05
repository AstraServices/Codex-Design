# Training knowledge (index)

What Codex Design learned from `Train/`, as rules + measured numbers + engine features. Read this first, then the
`TRAIN.md` of the area you are working in. Nothing here is a neural network: "training" = written knowledge the AI
follows + engine code that encodes it. Say so if a user asks.

| Area | File | Engine |
|---|---|---|
| Stud textures | `Train/StudTrain/TRAIN.md` | `k.part`, `studs:'train'` |
| Stud Nature video (look measurements, 20 sharp frames) | `Train/StudveGradientVideo/TRAIN.md` | `look:'stud-nature'`, `k.voxels` |
| Gradients: surface light **and** designed color gradients | `Train/GradientTrain/TRAIN.md` | `k.gradient`, `gradient:` option |
| GFX Studio 2.0 (35 presets, auto-fit titles, clay/wire/density/UV modes, stats, auto showcase) | `Train/GfxTrain/TRAIN.md`, `docs/STUDIOS.md` | ✧ GFX Studio, `npm run gfx -- <slug> --preset showcase` |
| Simulator models (pets, eggs, tools), model packs | `Train/StudGradientModelKarisik/TRAIN.md` | `projects/cube-pet.js`, `projects/sim-egg.js` |
| PBR textures written by the AI | `Train/TextureTrainSenTrainleBurada/TRAIN.md` | `k.pbrSurface(def)`, `k.paint({painter})`, `npm run texture` |
| Texture Studio (node graphs → multi-engine PBR) | `docs/STUDIOS.md` | `/texture`, `textures/<name>.graph.json`, `npm run texture -- <graph> --profile …` |
| Roblox VFX (imported VFX packs, own flipbooks, Luau/RBXM export) | `Train/VfxTrain/TRAIN.md` | `/vfx`, `vfx/<id>.vfx.json`, `npm run vfx` |
| Topology (context-aware smart topology + SIMP) | `Train/TopologyTrain/TRAIN.md` | `k.smartTopology(intent)`, `k.topologyPart` |
| Reference sorting | `Train/catalog.json` | — |

## 0. Behavior rules (strict)

1. **No unrequested Highlight / Edge Outline / glow / sticker outline.** Only when asked or the requested style needs
   it; if you think it would help, ask in one line. Stud/gradient styles get depth from the baked look, never outlines.
2. **No unrequested animation.** Static props (plants, bamboo, trees, rocks, furniture, buildings, tools, weapons, food,
   gems, signs) get no clips: no jiggle, sway, bob, spin, idle. Offer motion; do not add it.
3. Studs come from StudTrain (`'train'`, `'train-mixed'`); Kek only when named.
4. **Gradients are designed per model** (stops, type, anchors, mode). There are no gradient presets. A colored object
   (sign, gem, pet, panel) should get a designed color gradient unless the user wants it flat.
5. **Textures are written per model** (material definition or painter). Examples exist to learn from, not to pick from.
6. Everything is adjustable by the AI (API) and on the site; nothing is locked to a preset.
7. Ask nothing the user already decided; pick the closest reference and say which.

## 1. The surface system (one pipeline for every baked look)

```
base color → designed color gradients → painter.albedo → StudTrain overlay → look (rim, glow, vignette, face
gradient, AO, grime, sheen, posterize…) → light gradients → atlas (+ ORM / normal / emissive maps)
```
- `await k.voxels(name,{fill|cells|rows+palette, voxel, look, studs, gradient, painter})` — greedy voxel mesh, exact AO.
- `await k.block(name,[w,h,d],color,{colors, look, studs, gradient, painter, at})` — one baked block.
- `await k.paint(target,{look, studs, gradient, painter, occlusion, crease, hardAngle, pxPerStud})` — **any mesh**:
  charts by face direction, rim only on hard edges (distance transform), skin weights kept, optional BVH AO.
- `await k.gradient(target, spec | 'light')` — stack another gradient; re-bakes. Plain meshes get painted first.
- `await k.look(target, name | {…})` — change the look later.
- Look: `'default'` (measured), `'flat'`, or **your own object** — every key of `LOOK_DEFAULTS` in `src/look.js`
  (rim/rimMode/rimLighten/rimSaturate/rimGain/rimLift, glow, vignette*, faceGradient, ao, grade, sheen, grooves, edgeNoise,
  grime, speckle, emissiveRim) plus `shade(ctx,color)` / `post(ctx,color)`. No named looks; copyable examples (incl. the
  bright "glow edge") are in `Train/StudveGradientVideo/TRAIN.md`. Rims follow real convex edges only (`concaveRims`,
  `colorEdges` to change that). Studs: `studs`, `studScale`, `studStrength`.
- Site: **Surface Look** panel (select a part → every parameter live + gradient JSON + Copy code), ✧ **GFX Studio**
  (live preview, video, watermark, background photo), **Export model** asks the format (GLB first; OBJ keeps quads),
  Smart topology with intent.
- Atlases: one texture per mesh, `pxPerStud` 32 by default, ≤ `maxAtlas` 2048 (use 1024 for Roblox-only props).

## 2. Model pack workflow (selling on Roblox / asset stores)

1. Theme + item list (kit checklists in the video/mixed TRAIN.md files). 2. One parameterized recipe per silhouette;
tiers via your own gradients and looks. 3. Same look + light gradient across the pack. 4. `npm run inspect -- <slug>
--quality` ≥ B; voxel/block meshes are quad-only. 5. Export GLB per item (+ `lua` only if highlights were requested).
6. GFX: `card` per item, `cover`, `icon`, `thumbnail`, `turnaround`, watermark on. 7. Keep Roblox limits: ≤ 20k tris
per mesh, textures ≤ 1024².

## 3. Roblox delivery checklist

Whole-stud sizes (1 stud = 0.28 m), Y up, pivot at the base center for props, one mesh + one atlas per prop where
possible, no highlight shells unless asked, GLB + GFX card + preview URL.
