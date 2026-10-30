# Train: GFX (presentation images and videos)

The four images here (a third party's "Stud Street Props" cards) were studied for mood only; Codex layouts are original.

## Site: ✧ GFX Studio (header button or key `G`)
Live preview (half size) while editing; Render full size / Download PNG / Render all presets.
- Preset & text: 19 presets, angle, title, tag, eyebrow, footer, accent, rarity.
- Layout & background: model size, offset X/Y, vignette, background type + 3 colors, rays, sparkles, shadow
  (float/drop/hard/none), **background photo** (cover/contain, zoom, blur, darken), sticker outline (only on request).
- Watermark: text and/or logo, 9 positions or tiled, opacity, size, rotation, color, outline; Save as default →
  `gfx.config.json` (also used by the CLI).
- Animated: MP4 (H.264) or GIF, fps, clip checkboxes, mode (sequence / together / all / none), crossfade, speed, loops,
  **seamless loop**, turntable degrees, duration, width. Framing is **anchored**: camera and crop are measured over the
  whole motion first, so the model never slides. ffmpeg is bundled (`ffmpeg-static`), no install.

## AI API / CLI
- `window.codexDesign.gfx(options)` → PNG base64; `gfxVideo(options)` → `{file, frames, bytes}`; `animationPlan(plan)`.
- Video options: `video:{format:'mp4'|'gif', fps, duration, width, turntable, anchor:true}`,
  `animation:{clips:'all'|name|[names], mode:'sequence'|'together', crossfade, speed, loops, weights, seamless:true}` or `null`.
- Background photo: `bgImage:{src|image, fit, zoom, blur, darken, tint, tintAmount, x, y, opacity}`.
- CLI: `npm run gfx -- <slug> --preset <name>|all [--title ..] [--watermark ".." --wm-*] [--bg-image photo.jpg --bg-fit cover
  --bg-blur 8 --bg-darken 0.3] [--video mp4|gif --fps 30 --clips "Run,Attack"|all --mode sequence|together --crossfade 0.3
  --loops 2 --turntable 360 --no-seamless --no-animation]`. `--list` shows presets.
- Every preset field is overridable (bg, rays, bokeh, glow, grid, fill, offsetX/Y, floatShadow, dropShadow, hardShadow,
  outline, frame, views, modelArea, …): presets are starting points, not limits.

## Presets (19)
card, card-dark, card-color, social, cover, banner, icon, icon-rarity, icon-minimal, thumbnail, thumbnail-sunset,
thumbnail-night, showcase, podium, blueprint, halftone, turnaround, sticker, transparent.

## Rules
- No sticker outline or glow unless asked (or the preset is sticker/halftone).
- Model pack sell sheet: `card` per item, `cover`, `icon`, `thumbnail`, `turnaround`, and a seamless turntable MP4/GIF;
  watermark on everything that leaves the machine.
