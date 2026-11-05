# VfxTrain — Roblox VFX Studio knowledge

Source packs (imported from the user's Downloads with `npm run vfx:import -- <pack dirs>`, originals untouched):

| Pack | What it is | License (as recorded in `assets/vfx/library.json`) |
|---|---|---|
| `vfx-pack0` | CodeManu "VFX Free Pack": 22 hand-drawn effects, 30–40 frames each (anima, big-hit, blood-impact, charged, constellation, dithered-fire, elden-ring, electric-shield, explosion, explosion2, fast-pixel-fire, hyperspeed, impact, kabooms, magma, power-chords, puff-and-stars, small-hit, tentacles, the-vortex, wheel, worm) | CodeManu free pack; the same art ships as CC0 in the Brackeys bundle |
| `vfx-pack1` | 16-frame 512 px sequences: bonfire, butterfly, dizzy, fire-flies, gas-burner, green-portal, heal, leaves-falling, portals-v2, quest, quest-complete, shield-aura, smoke, sword-slash, torch | **Unknown** — no license file. Fine for tests and private places; ask before publishing a game/asset that uses them |
| `vfx-pack2` | Brackeys VFX bundle: 14 realistic 8×8 flipbooks (fire, flame, explosion, cloud, wispy smoke) + predrawn sheets + 93 single particle textures (circle, dirt, flame, flare, light, magic, muzzle, scorch, scratch, slash, smoke, spark, spotlight, star, symbol, trace, twirl, window) | CC0 (Picster, Kenney, Thomas Iché, CodeManu) |

Every flipbook is already Roblox-ready: 1024×1024, `Grid4x4` (16 cells of 256 px) or `Grid8x8` (64 cells of 128 px),
frames resampled in time, aspect kept, resampled in premultiplied alpha (no dark fringes), black-background art converted
to straight alpha, grey smoke whitened so `Color` tints it, pixel art scaled with nearest neighbour.
`library.json` lists per effect: `layout`, `grid`, `sourceFrames`, `duration`, `tags`, `license`, and `suggest`
(LightEmission, LightInfluence, FlipbookMode, FlipbookFramerate, lifetime) — start from it, then tune.

## How the AI makes an effect (order is mandatory)

1. **Search the library first** (`assets/vfx/library.json`, tags: fire, explosion, impact, magic, electric, smoke, heal, ui, nature, speed, light).
   Prefer `vfx-pack0` over the duplicate `vfx-pack2` predrawn sheets (more source frames). Respect licenses:
   unknown-license art (`vfx-pack1`) only after telling the user.
2. **Draw your own when nothing fits** — wrong style, license, resolution, non-Roblox flipbook, poor animation — with the
   texture generator (`src/vfx/texgen.js`, VFX Studio → *Draw your own*): glow, ring, spark, star, flare, smoke, dust,
   slash, electric, shockwave, explosion, fire, magicCircle, orb, trail, beamNoise; single 256 px or Grid4x4/8x8 flipbooks.
   Generated PNGs live in `vfx/textures/` and are uploadable like library art.
3. Compose layers in `vfx/<id>.vfx.json` (one file per effect, shared by every agent). Only Roblox classes:
   `emitter` (ParticleEmitter), `beam`, `trail`, `light` (Point/Spot/SurfaceLight), `mesh` (Part Ball/Cylinder/Block,
   Neon/ForceField, optional uploaded mesh id), `highlight`, `post` (Bloom/ColorCorrection/Blur/DepthOfField).
   Property names are the Roblox names; sequences are `[[t, value, envelope?], …]`, colours `"#hex"` or `[[t,"#hex"],…]`,
   ranges `[min,max]`. Emission: `{mode:"burst", bursts:[{t,count}]}` or `{mode:"continuous", duration}`; timing via
   `delay`, property animation via `anim:[{prop, from, to, time, style, dir}]` (Roblox EasingStyle/Direction).
4. Validate (`npm run vfx -- <id> --validate` or the page): unsupported properties/shaders, flipbook layout vs atlas grid,
   lifetime order/range, light range ≤ 60, missing attachments, **missing asset ids (never silent)**, particle budget
   (≤ 400 PC, ≤ 150 mobile), emitter/light counts.
5. Preview at `http://127.0.0.1:4173/vfx?effect=<id>` (Roblox-behaviour simulator: drag, acceleration, spread, sequences
   with envelopes, squash, orientation modes, LightEmission additive blend, flipbook modes). Check it, then export.

## Roblox rules that matter

- Texture max 1024²; flipbook layouts `Grid2x2/4x4/8x8` everywhere, `Custom` (FlipbookSizeX/Y) only on recent clients.
- `FlipbookMode.OneShot` spans each particle's lifetime (framerate ignored); Loop/PingPong/Random use `FlipbookFramerate`.
- Glows: `LightEmission 1, LightInfluence 0`. Smoke/dust: `LightEmission 0, LightInfluence ≈ 0.5–1`.
- `ParticleEmitter.TimeScale` is capped at 1: the runtime's `SetSpeed > 1` speeds the timeline, not the particles.
- Decal id ≠ image id. Open Cloud image uploads create Decals; Texture properties need the image id. The upload code
  resolves it when Roblox allows; otherwise the generated Luau / importer resolves decals on the server (InsertService).
- Shaders do not exist in Roblox: bake looks into textures/flipbooks; never export something as if Roblox supported it.

## Export (all Roblox-native)

`npm run vfx -- <id>|all [--luau-only] [--placeholder] [--upload]` or VFX Studio → Export:
- `<Name>.luau` — **the Luau code generator**: one ModuleScript; a `CONFIG.Textures` table at the top (per layer:
  paste image or decal ids; Codex fills them after an upload), it rebuilds the exact same effect and returns the API.
- `<Name>.rbxm` (binary) + `<Name>.rbxmx` (XML) — CodexVFX folder (ModuleScript VFXStudio + Effects templates + Manifest).
  Both formats were verified by deserializing in Roblox Studio.
- `VFXStudio.luau` runtime, `CodexVFX_Importer.luau` (command bar: resolves decal ids, lists missing uploads), textures, manifest.
- Runtime API: `VFX.Play(name, {Position|CFrame|Parent(BasePart/Attachment/Bone/Model), Offset, Scale, Speed, Color, Quality, Loop, Duration})`
  → handle; `Stop, Pause, Resume, SetSpeed, SetScale, SetColor, Preload, Destroy, StopAll, List`; server `PlayForAll, PlayFor, PlayNear`
  (RemoteEvent; clients require the module once). Pooling, auto cleanup, distance culling and quality scaling are built in.

## "Import it into Roblox" (strict flow, see AGENTS.md)

1. Check the Roblox Studio MCP (`list_roblox_studios`). **No Studio / no MCP** → ask: *“Roblox Studio bağlantısı göremedim.
   Doğrudan Roblox'a yükleyip ID'leri atayayım mı?”* — on yes: upload (Open Cloud key from Settings), write ids into the
   Luau CONFIG / .rbxm, give the files.
2. **Studio connected** → ask: *“Studio bağlantısı var. Modelleri/efektleri Roblox'a yükleyip sonra açık olan place'e
   yüklememi ister misin?”* — on yes: upload, then insert into the open place (CodexVFX → ReplicatedStorage), test playback.
3. If Studio blocks something (HTTP allowlist, file access, permissions), tell the user exactly what to allow — e.g.
   *“Studio `127.0.0.1:4173` adresini engelledi; Assistant/MCP HTTP izinlerine bu adresi ekle”* — and continue with the
   inline fallback instead of failing silently.
