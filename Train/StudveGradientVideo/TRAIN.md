# Train: Stud Nature Pack video (stud + voxel + gradient look)

Source: `Stud Nature Pack 100 Assets (1).mp4` (1920×1080, 62.5 s, Roblox Studio fly-through).
- `frames/`: 20 sharp stills (2 fps sampling, edge-variance ranking).
- `frames_hd/`: 33 **enhanced** stills (4 fps sampling, 40 sharpest distinct moments, median denoise → 2× Lanczos →
  unsharp mask ×2 → contrast 1.06; 3840×1896). Use these for detail work.

## Measurements

| Element | Measurement | Look parameter |
|---|---|---|
| Rim | lighter than the face, thin (~0.07–0.1 stud), on **convex** edges only | `rim`, `rimWidth`, `rimSoftness` |
| Rim color | lighter + hue-kept: crate `(110,57,18)` → `(209,153,79)`; stone ≈80 → ≈141 luminance; **yellow/gold rims get more saturated, stone rims go grey-white** | `rimMode:'hsl'`, `rimLighten`, `rimSaturate`, `rimHue` |
| Glow | short falloff after the rim (117 → 87 on stone over ~0.15 stud) | `glow`, `glowWidth`, `glowColor` |
| Face center | slightly darker (≈90 → 77) | `vignette`, `vignetteStart/End/Power/Color` |
| Concave corners | dark AO, **no** rim | `ao`, `aoColor` (voxels: exact; meshes: `occlusion:true`) |
| Studs | StudTrain squares on every face; **size depends on material**: wood beams ≈2 studs per voxel, stone 1 per voxel with low contrast | `studs`, `studScale`, `studStrength` |
| Planks | wood beams/trunks have groove seams with a light lip along the long axis | `grooves`, `grooveEvery`, `grooveWidth`, `grooveLip`, `grooveDir` |
| Grass caps | stone cliffs carry a green top layer (1 voxel) with its own rim | voxel color layer on top |
| Model gradient | darker base → brighter top | `k.gradient('Asset','light')` |
| Outlines/highlights | none | never add them for this style |

## The look is fully custom (no presets)

`look` = `'default'` (the measured values above), `'flat'`, or **your own object**: every key of `LOOK_DEFAULTS`
(`src/look.js`) plus `shade(ctx, color)` (replace shading entirely) and `post(ctx, color)` (last step). The site's
**Surface Look** panel exposes the same keys live for the selected part, with Copy code. Example objects to start
from (copy and change, they are not built in):

```js
const measured   = {};                                                          // = 'default'
const glowEdge   = { rimMode:'gain', rimGain:1.75, rimLift:0.16, rim:0.82, rimWidth:0.085, glow:0.32, glowWidth:0.2, vignette:0.2 }; // the bright v0.6 look the user likes
const glowSoft   = { rimMode:'gain', rimGain:1.4, rimLift:0.08, rim:0.6, rimWidth:0.07, glow:0.18, glowWidth:0.15, vignette:0.18 }; // same idea, not neon
const softBevel  = { rim:0.45, rimWidth:0.06, rimLighten:0.25, glow:0.08, vignette:0.1, faceGradient:0.1 };
const toon       = { rim:1, rimWidth:0.1, rimSoftness:0.1, glow:0, vignette:0.22, posterize:5, saturation:1.15 };
const glossy     = { rim:0.6, rimLighten:0.45, vignette:0.12, sheen:0.35, sheenDir:[1,1,0], sheenOffset:0.55, sheenWidth:0.1 };
const neonEdge   = { rim:1, rimLighten:0.6, glow:0.4, glowWidth:0.25, vignette:0.35, brightness:0.7, saturation:1.2, emissiveRim:0.8 };
const worn       = { rim:0.5, rimWidth:0.08, edgeNoise:0.9, grime:0.3, speckle:0.06, ao:0.65, saturation:0.95 };
const pastel     = { rim:0.5, rimLighten:0.5, rimSaturate:0.6, vignette:0.06, lift:0.1, saturation:0.85, ao:0.3 };
const woodBeam   = { rim:0.65, rimSaturate:1.15, grooves:0.35, grooveEvery:1, grooveDir:'long', vignette:0.12 }; // + studScale:2
const stoneBlock = { rim:0.6, rimSaturate:0.4, rimLighten:0.45, vignette:0.18, ao:0.6 };                          // + studStrength:0.5
const goldPiece  = { rim:0.75, rimSaturate:1.3, rimLighten:0.4, glow:0.15, sheen:0.2 };
```
Rules: keep rims off flat seams (voxel rims follow regions automatically); `concaveRims:true` only if you want the
stylized glowing inner corners; `colorEdges:false` on voxels to drop rims between colors of one surface.

## Asset grammar seen in the pack

- 1 voxel = 1 stud. Organic outlines are stair-stepped voxels; flat items (keys, coins, signs, leaves) are 1–2 voxels
  thick (`k.voxels({rows, palette, depth})` pixel art); volumes (fruit, canopies, rocks) are filled.
- Watertight voxels: connect pixel-art cells by edges, not only by corners. Voxel faces are tessellated on the voxel grid,
  so `npm run inspect -- <slug> --quality` should read A/B.
- Same silhouette, many colors: trees in green, lime, cyan, magenta, yellow — variants via your own gradients.
- Mixed styles per object: gems are smooth faceted and glossy (`k.mesh` + `k.paint`).
- Kit checklist for a nature/treasure/market pack: round/pine/palm/branching trees, bushes, grass tufts, flowers,
  mushrooms, rocks/cliffs with grass caps, chest (navy iron bands + gold corner blocks), crate, barrel, log, fence, bench,
  sign, market stall (striped awning, fruit trays), fountain, anvil, hammer, pickaxe, shovel, key, coin, gold bar, crown,
  trophy, gem, magnet, apple, banana, pear, pumpkin, melon, leaderboard board.

## Recipe skeleton

```js
const tree = await k.voxels('Tree', { size:[9,14,9], fill:(x,y,z)=>/* voxel math */, look:'default' });
await k.gradient('Tree', { type:'linear', from:'bottom', to:'top', space:'part', mode:'tint', amount:0.55, only:['#2a8e28'], stops:[[0,'#0f3b16'],[0.55,'#2a8e28'],[1,'#9be35a']] });
await k.gradient('Asset', 'light');
```
