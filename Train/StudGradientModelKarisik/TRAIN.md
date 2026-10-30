# Train: simulator models (pets, eggs, tools, weapons) — sorted by Codex

Sorted list: `../catalog.json`. The `*_diff.png` files are byte-identical to `GradientTrain/Examples`.

## Cube pets (865, 8658, 78568, 9789, attachments_screenshot) → `projects/cube-pet.js`
- Body: rounded cube, width : height : depth ≈ 1 : 0.9 : 0.9, corner radius ≈ 16% of width. Head = body (face on front).
- Eyes: two discs ≈ 32% of face width each, upper half, gap ≈ 8%; white ring, iris (species color), pupil, two highlights
  (big top-left, small bottom-right, slightly emissive). Nose: tiny dark triangle under the eyes.
- Ears by species: cat = short 4-sided cones on the top corners with a lighter inner ear; bunny = tall rounded slabs;
  bear = round discs. Legs: 4 stubs ≈ 18–22% of body height at the corners. Tail: small sphere/fluff at the back.
- Color: designed fur gradient (shade at back/bottom → base → light at top-front) + a lighter belly/face patch
  (radial from bottom-front, smooth ease). Low rim, almost no vignette (soft vinyl toy).
- Tiers keep the mesh: ice (faceted crystal overlay, light blue, sparkles), gold (yellow→orange, glow in GFX), rainbow
  (angular gradient), shadow/void (dark + emissive rim). GFX: `showcase` / `icon-rarity`.

## Eggs (543256) → `projects/sim-egg.js`
- Ovoid ≈ 1.3× taller than wide, widest low (lathe profile with radius × (1 − 0.18·t)), 32 segments.
- Themes = surface written with the painter + attachments: tech (panels, glowing core), ice (crystal shards around the base),
  galaxy (indigo→violet gradient, nebula fbm, round stars, orbit ring), demon (horns, dark facets, magenta cracks), amethyst
  (crystal cluster), angel (white, gold trim, wings, gem), dragon (red scales, horns, wings), nature (green, vines, flower),
  candy (pink stripes, lollipop), lava (dark plates + glowing emissive cracks via Voronoi edges).

## Tools & weapons (343, 5775, 75474, 769, 8679, 879, 23525, 5985, 45, 7457, 5435)
- Pickaxe: thick crescent head (≈ 2.4× handle width, tips curl down), center ornament (gem/emblem/gear), short thick handle
  with 2–4 wraps, pommel. Themes: void (purple + glowing spots), galaxy (constellation lines), steampunk (gears), nature
  (leaves), ruby, lava (cracks), candy (stripes, rainbow handle), cosmic (glowing gem), angel (wings). Icon renders of these
  use dark outlines — use the GFX sticker/outline only for icon sheets when the user wants that style.
- Swords: one blade silhouette, tiered colors, emissive edges/tips at high tiers. Guns: voxel or low-poly, elemental variants.
- Fishing rods: long thin props in a row — keep handles thick enough to read at thumbnail size.

## Simulator item language (what sells)
- Tier ladders: one silhouette in 8–15 tiers (wood/stone/iron → gold/crystal → elemental with emissive edges, bigger heads,
  spikes/wings). One parameterized recipe + gradients/looks you design per tier.
- Presentation: rows of variants on dark navy/purple (`showcase`), icon sheets on white, covers with big titles, animated
  turntables (`--video mp4 --turntable 360`).

## Model pack workflow
1. Theme + 20–100 items (kit checklist in `../StudveGradientVideo/TRAIN.md`). 2. One recipe per silhouette with parameters.
3. Same look + light gradient across the pack; per-item gradients. 4. Quality ≥ B. 5. GLB per item. 6. GFX card per item,
cover, icon, thumbnail, turntable video, watermark on.
