# Train: topology (smart, context-aware) + engineering optimization

## Smart topology decides per mesh (it is not a triangle remover)
Quads matter for meshes that deform, get subdivided or go to a modeler (edge loops, predictable Catmull-Clark, UVs, loop
selection). Triangles are standard and harmless on static hard-surface props and in game-final / print meshes (GPUs and
engines triangulate anyway). So `k.smartTopology(intent)` (site: Smart fix + intent menu; CLI: `--topology <intent>`)
classifies every mesh and acts accordingly:

| Mesh kind (auto) | Detected by | `auto` action |
|---|---|---|
| deforming | skinned / morph targets | quad caps, quad-aware flips, relax flat areas |
| organic | smooth curvature | quad caps + relax (no shape change) |
| hard-surface | many sharp creases / flat faces | **no added geometry**: only slivers/degenerates fixed |

Intents: `auto`, `animation` (quad flow everywhere), `subdivision` (pair + quad caps + linear quad split → **100% quads**,
shape identical), `game` / `print` (cleanup only, triangles kept). The report says what was done and why, per mesh.
Quality scoring is weighted by kind (hard-surface: triangle quality and manifoldness count, quad share barely).

Diagonals: GLB/glTF are always triangles (format + engine standard). OBJ export keeps quads (paired triangles or the
explicit quad list from the split) → diagonals disappear in Blender/Maya. Quads view shows the quad wireframe.

## Engineering topology optimization (SIMP; CNN background)
- Minimize compliance at a volume fraction: `E = Emin + ρ^p (E0 − Emin)`, FE solve, filtered sensitivities, OC update
  (`src/topopt.js`). CNN literature: Sosnovik & Oseledets 2017, Banga et al. 2018, Yu et al. 2019, TOuNN 2021 — Codex runs
  real SIMP, no neural network.
- `k.topologyPart(name,{case|loads+supports, nelx, nely, volfrac, rmin, passive, size, thickness, mesher:'quad'|'extrude', upsample})`.
  Quad mesher: watertight, quality ≈ 80–90. GFX: `--preset blueprint`.

## Authoring rules
1. Prefer `k.quadSurface`, `k.voxels`, `k.block`, ring loops; radial segments multiple of 4.
2. ≥3 edge loops across every skinned joint.
3. "Optimize" = reduce segments / merge / remove hidden faces in the recipe; LOD tools only when LOD is asked for.
