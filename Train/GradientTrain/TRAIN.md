# Train: gradients (two separate features)

Gradient in Codex Design means **two different things**. Use both deliberately.

## 1. Surface light (rim + vignette + model light gradient)

From `Examples/*_diff.png` (32 transparent 512² renders) and `Examples/image*.png`:
- Model-wide light gradient, top light → bottom dark. Pine: mean luminance 89 (top band) → 34 (base), ≈2.5×.
  `k.gradient('Asset','light')` = `{mode:'light', bottom:0.5, top:1.12}`; tune bottom/top per model.
- Per face: bright rim, glow falloff, slightly darker center, small up-gradient, AO under overhangs → `look`.
- Measured palettes (for reference, not presets): leaves `#1c5821 #227323 #2a8c27`, bush/grass `#103b16 #2b8c27
  #46c938`, cactus `#1f401d #438525 #81c939`, bark `#191112 #5d2b1d #8b4934`, warm wood `#603926 #995f39 #c38148`,
  sand rock `#6a523b #a28561 #d6cdac`, dark rock `#201c19 #5c4832 #876b48`, blue stone `#1e2547 #465280 #7281b6`,
  bone `#30292a #887c7c #d6cbc8`.

## 2. Color gradients designed for the model (the user's main ask)

A blue sign should not be flat blue. The AI **designs** the gradient for each object; there are no named presets.
Example from the user (teal glow lower-left → deep purple upper-right):

```js
await k.block('Board', [W, H, D], '#2060d0', { look:'soft-bevel', studs:'none',
  gradient: { type:'radial', center:'bottom-left', axis:'z', radius:1.2,
              stops:[[0,'#33c3c9'],[0.45,'#2e7da3'],[0.75,'#2f4f8f'],[1,'#3b1a72']] } });
```

Spec (all optional except stops/colors):
- `type`: `linear` (from/to or direction or axis), `radial` (around center, ignoring `axis`), `spherical`, `angular`
  (around axis), `normal` (by facing direction), `noise` (organic patches), `edge` (rim → center), `face` (per face).
- `from`/`to`/`center`: `[x,y,z]` or words over the bounds: `'bottom-left'`, `'top-right-front'`, `'center'`, `'top'`.
- `space`: `'part'` (this mesh's bounds; default when passed to k.voxels/k.block/k.paint), `'model'` (whole asset;
  default for k.gradient), `'world'`.
- `mode`: `replace` (default), `tint` (keeps light/dark, swaps hue), `multiply`, `overlay`, `screen`, `soft-light`,
  `light`. `amount` 0–1 mixes. `ease` (`linear|smooth|ease-in|ease-out`), `curve`, `steps` (banded toon ramps),
  `repeat` (`clamp|repeat|mirror`), `radius` (× bounds diagonal) or `radiusMeters`.
- `only: ['#2a8e28']` limits a gradient to texels of that base color (multi-color voxel models: leaves vs trunk);
  `where: ctx => ctx.worldNormal.y > 0.5` for any custom mask.
- Gradients **stack** in call order and are re-baked into the atlas: color gradients go first, then studs and the look,
  then light gradients.

## How to design a good gradient (rules)

1. Pick a light direction story: glow where the light/emissive source is (corner, top, center of a gem).
2. 3–4 stops: highlight (light, more saturated or shifted toward cyan/yellow), base, shadow (darker, shifted toward
   blue/purple), optional deep accent. Shift hue, not just brightness: teal → blue → indigo → purple.
3. Keep value contrast ≥ 2× between the extreme stops for small props, ~1.5× for big flat boards.
4. Radial from a corner for signs/panels, linear bottom→top for plants/trees/pillars, angular for crystals and
   rarity "secret" tiers, normal-based for top-lit rocks (`type:'normal', direction:[0,1,0]`), noise for moss/rust patches.
5. Combine with a look: `soft-bevel` or `clean` on large gradient panels so the rim does not fight the ramp.
