# Train: PBR textures (the AI writes its own)

No texture library to pick from. For every model the AI writes the material it needs, in one of two ways:

## A. Tileable material (any resolution up to 4096²)
A definition = small functions built from `src/texlab.js` (`k.tex` in recipes):

```js
import { bricks, fbm, ridged, cells, ramp, mix, warp } from '../src/texlab.js';
export default {
  name: 'my-material', normal: 6,            // normal strength
  height(u, v, seed) { /* 0–1 or {h, id, mask} */ },
  albedo(c)   { /* c = {u,v,h,id,mask,cavity(<0 in crevices),edge(>0 on convex edges),n(noise)} → [r,g,b] */ },
  roughness(c){ /* 0–1 */ }, metalness(c) { /* optional */ }, emissive(c) { /* optional [r,g,b] */ },
};
```
- Recipe: `k.pbrSurface(def, {size:1024, repeat:2})` + `k.worldUV(mesh, meters)` for constant texel density.
- Export 4K maps: save as `textures/<name>.js`, run `npm run texture -- textures/<name>.js --size 4096`
  → albedo, normal (OpenGL +Y), roughness, metalness, AO, height, ORM (+ emissive) and `material.json`
  (glTF + Roblox SurfaceAppearance mapping). Example: `textures/mossy-castle-stone.js`.
- Worked examples to learn from (not to pick): `npm run texture -- --list` (stone wall, cobblestone, bark, planks,
  brick, painted metal, rusty metal, gold, fabric, forest ground, sand, ice, lava).

## B. Model-aware texture (painted on this exact mesh)
`await k.paint(mesh, { painter: { albedo(ctx, color), roughness(ctx), metalness(ctx), emissive(ctx), height(ctx), bump } })`.
`ctx` knows the model: `world`/`part` position, `worldNormal`, `edge` (studs to the nearest hard edge), `edgeRel`,
`modelY` (0 bottom → 1 top), `ao` (with `occlusion:true`), `s,t` (position inside the face), plus `noise`, `fbm`,
`smooth`, `mix`, `rgb` helpers. Use it for: worn paint only on real edges, dirt/moss at the bottom, snow on
up-facing faces (`worldNormal.y`), rust in cavities (`ao`), glowing runes on one face.

## Texture artist rules
1. Height first; color comes from height, cavity and edges. 2. Albedo without baked light (30–240 sRGB), metals use
reflectance color. 3. Roughness varies: cavities rougher, worn edges smoother. 4. Metalness 0 or 1 except worn transitions.
5. Break repetition: domain warp + per-cell id variation. 6. Texel density: Roblox imports ≤1024² per map; use 512–1024 for
props, 2K–4K only for hero/sale texture sets.


## Texture Studio (v0.8)

Materials are now node graphs (`textures/<name>.graph.json`, see `docs/STUDIOS.md`). Write the graph instead of a one-off
script: noise/pattern generators → masks (weathering, slope, height, curvature, mesh masks) → colorRamp/blend → outputs
(baseColor, height, roughness, metalness, emissive, opacity). Normal/AO/curvature derive from height. Check the page's
validation (seams, albedo range, metal binariness), then export per engine profile. `textures/volcanic-rock.graph.json`
is the worked example (dark basalt, glowing orange cracks, Roblox-compatible).
