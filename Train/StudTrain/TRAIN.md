# Train: StudTrain stud textures

- `studTexture.png`, `universal_stud.png`: 256×256 RGBA **overlays**, 4×4 studs (64 px each). Transparent with a dark
  (black, α 0.3–0.6) lower-right bevel and a white (α 0.3–0.4) upper-left bevel per rounded-square stud. They behave like
  a Roblox `Texture` over a colored Part. `universal_stud` alternates studs and inlets.
- Library copies: `assets/library/studtrain/stud_overlay*.png` (raw, used by the baker) and `stud_train*.png`
  (pre-composited on grey for tinting materials).
- Styles: `'train'` (default everywhere), `'train-mixed'`. Kek and other library studs only when the user names them.

## Where studs go
- Roblox Part look: top only → `await k.part(name,[w,h,d],color)` (default `top:'train'`).
- Voxel / stud-nature look: every face → `k.voxels`, `k.block` (default `studs:'train'`).
- Any mesh: `await k.paint(mesh,{studs:'train'})` (aligned per chart; best on flat faces).
- Strength: `studStrength` 0–1 (default 0.9). Big gradient panels/signs usually look better with `studs:'none'`.

## Rules
- 1 stud = `k.STUD` (0.28 m). Size parts and voxels in whole studs so studs never get cut.
- Never stretch studs; never mix round procedural studs with StudTrain on one model.
