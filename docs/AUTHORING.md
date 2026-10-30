# Code → model → rig → motion → export

Each asset is two files in `projects/`. The JSON manifest contains `name`, `description`, `module`, `parameters`, `controls`. A control is either `{type:'color',label}` or `{type:'number',label,min,max,step}`. The module exports `build(k)`; asynchronous builds are supported. Add content to `k.root`, clips to `k.clips`. Do not create a renderer, camera, lights or UI per model.

```js
export function build(k) {
  const body = k.group('Body', { at: [0, 0.6, 0] });
  k.mesh('Shell', 'roundedBox', [1, 1, 1, 3, 0.1],
    k.material(k.parameters.color), { parent: body });
  k.clip('Hover', 3, [k.sample(body, 'position', 3, 24,
    t => [0, 0.6 + Math.sin(t * Math.PI * 2 / 3) * 0.1, 0])]);
}
```

## Geometry / materials

`k.mesh(name, typeOrBufferGeometry, args, material, options)` adds a shadow-casting mesh. Options: `parent`, `at:[x,y,z]`, `rotate:[x,y,z]` in radians, `scale:number|[x,y,z]`. `k.group` and `k.bone` take the same options. Names must be unique identifiers beginning with a letter/underscore; animation targets use them.

`k.material(color, {roughness,metalness,emissive,emissiveIntensity,...})` returns MeshStandardMaterial. For transmission/clearcoat use `new k.THREE.MeshPhysicalMaterial(...)`. Materials and textures follow Three.js semantics. Color strings are interpreted through Three.js color management.

| Geometry | Arguments |
|---|---|
| box | width, height, depth, optional segment counts |
| roundedBox | width, height, depth, bevel segments, radius |
| sphere | radius, widthSegments, heightSegments |
| cylinder | radiusTop, radiusBottom, height, radialSegments, heightSegments |
| cone | radius, height, radialSegments |
| capsule | radius, length, capSegments, radialSegments |
| torus | radius, tubeRadius, radialSegments, tubularSegments |
| icosahedron | radius, detail |
| lathe | array of [radius,y] profile points, radialSegments |
| tube | array of [x,y,z] curve points, pathSegments, radius, radialSegments, closed |
| extrude | array of [x,y] outline points, options object |

Use `k.geometry(type,args)` for an unattached geometry. Arbitrary topology and mathematical surfaces are supported by passing your own `THREE.BufferGeometry` or any Three geometry to `mesh`. UVs, indexed triangles, normals and morph attributes remain under author control. `k.mergeGeometries` is exposed for batching compatible attributes. Avoid gratuitous subdivisions; instance repeated detail when appropriate.

`k.csg(name, a, b, 'subtract'|'union'|'intersect')` replaces two static single-material operands with a result at the root. Transforms are baked into world space. Attach the result to an intended parent using `parent.attach(result)`. Inputs must be watertight and two-manifold. Inspect the result; precision issues mean this is not a guaranteed CAD solid kernel. Keep operands simple and avoid coplanar cutters.

## Rig / deformation

Rigid parts can be parented to `k.bone` nodes. This is an articulated rig, but it does not bend the geometry. For bending:

```js
const b0 = k.bone('Base');
const b1 = k.bone('Tip', {parent:b0, at:[0,1,0]});
const geo = k.geometry('cylinder',[0.1,0.2,2,16,24]);
geo.translate(0,1,0);
k.skin('FlexibleBody',geo,k.material('#78c7b0'),[b0,b1],v => {
  const w = Math.min(1, Math.max(0, v.y / 2));
  return [[0,1-w],[1,w]];
});
```

The callback supplies 1–4 `[boneIndex,weight]` influences per vertex. Kit validates indices and normalizes weights. Geometry, skeleton and mesh must share a meaningful bind space; finish rest transforms and add bones before binding. Do not move skeleton parents afterwards to compensate for a broken bind. `kelp.js` shows a continuous chain; `courier.js` combines rigid armor and a weighted appendage. Automatic rig inference / universal human autorig is not implemented.

## Exportable animation

- `k.clip(name, durationSeconds, tracks)` registers a clip.
- `k.track(nodeOrName, 'position'|'scale'|'quaternion'|'morphTargetInfluences', times, values)` creates a typed keyframe track. Values may be flat arrays or arrays of tuples. For multiple morph channels construct the appropriate Three.NumberKeyframeTrack with indexed property paths yourself.
- `k.rotation(node, times, eulerTuples)` converts Euler radians to quaternion tracks.
- `k.sample(node, 'rotation'|property, duration, fps, time => tuple)` bakes a mathematical movement into tracks at authoring time.

Use local coordinates relative to parents. Keep rest positions in position tracks (e.g. Hips.y=1.45 plus the offset). For full spins, sample intermediate orientations to avoid quaternion shortest-path collapse. Procedural time functions run once to generate keyframes; the exported file therefore reproduces movement without our runtime. glTF supports TRS/weights tracks; camera effects, arbitrary material uniforms and JS callbacks are not portable animation channels.

The viewer stops the mixer to restore rest transforms before animated export, then restores the selected clip/time. OBJ and STL bake the displayed pose, including skinning and morphs. They discard the rig and clips by design. OBJ MTL export preserves base color/opacity, not PBR textures. Three.js JSON can be loaded by `ObjectLoader`; clips are in the top-level `animations` array.

## Iterate with little context

1. `npm run new -- my-asset`, then edit only its recipe and manifest.
2. `npm run inspect -- my-asset`: warnings, dimensions, triangle/mesh/material counts, bones and clips.
3. Run/view the workshop at `http://127.0.0.1:4173/?project=my-asset`. File changes rebuild the active model.
4. `npm run export -- my-asset glb` and `npm run export -- my-asset png`.
5. Inspect silhouette and motion. For changed exporter/rig behavior run the relevant tests and validate output with gltf-validator.

`window.codexDesign` exposes `ready`, `stats()`, `load(id)`, `root`, `clips`, `setTime(seconds)`, `playClip(name)`, `frame()`, `export(format)` and `exportBase64(format)` for automated app tests. The command line uses this same browser export path, so it is not a second implementation.

There is no AI model or API key inside the viewer. Codex authors code through the conversation. The server stays on 127.0.0.1, accepts its own origin for writes, saves only declared parameter keys, and never needs mesh arrays pasted into chat.

## Intelligent topology authoring and optimization

`k.quadSurface((u,v)=>[x,y,z], {uSegments:24,vSegments:32})` builds a regular UV grid with consistent quad flow, normals and UVs. WebGL receives two triangles per quad. The geometry retains `userData.sourceQuads` for author inspection; it does not claim the GLB contains quad polygons. For cylindrical flow repeat the circumference endpoints and add explicit caps if needed. `projects/kelp.js` demonstrates regular longitudinal rings, cap closure and weighting. Extra rings belong at bending joints; allocate density by curvature rather than uniformly oversampling the whole object.

`k.audit()` returns `{total, meshes, recommendations, scope}`. Measures: triangles, raw GPU vertices, position-welded vertices, edge count, open boundaries, non-manifold edges (>2 adjacent faces), winding conflicts, degenerate/duplicate/skinny triangles, connected components, minimum triangle quality, average triangulated valence and authored quads. Quality is `4√3 × area / sum(edgeLength²)`; below 0.08 is marked skinny. Welding for analysis uses a scale-relative tolerance to ignore UV/normal splits. This is an edge-connectivity analysis per mesh, not proof of vertex-manifoldness, absence of self-intersections, or deformation quality.

`npm run inspect -- my-asset --topology` prints a compact report; `--details` includes all meshes. Use it to decide whether to close boundaries, remove overlapping faces, redistribute rings, or lower segments in the author recipe. Open sheets may be intentional; do not blindly cap all reported borders. Dense enough joint flow and meaningful silhouette take priority over a low triangle counter.

`await k.optimize({ratio:0.6,error:0.005})` runs in an async build. It welds vertices only when every stored attribute is exactly equal, removes near-zero-area faces, then applies attribute-aware Meshoptimizer reduction to static meshes. Normals/UVs/colors contribute to the simplification error, UV/normal discontinuities and open borders constrain collapses. Material groups are processed separately and all vertex attributes compacted with the same remap. Index-only simplification does not invent skin weights. Weighted meshes get weld/cleanup only; morph/custom draw-range/interleaved cases are skipped with a reason. Reports include before/after counts and the simplifier's relative error; the algorithm can stop above the requested ratio to respect constraints.

The viewport `Topology` overlay colors amber borders, pink non-manifold edges and purple winding conflicts; positions follow skin deformation. Diagnostic helpers live outside the asset export root. The browser optimizer supports one-step undo, leaving source unchanged. For saved source, call the optimizer in the recipe. For a delivery-only variant: `npm run export -- my-asset glb --ratio 0.6`. Test visual silhouette, UVs, materials and all clips after reduction. This is constrained cleanup/decimation plus better source authoring, not automatic semantic retopology.

## Textures, studs and Roblox materials

All UV-tiling helpers use **one UV unit = one stud** (`k.STUD` = 0.28 m).

| Call | Result |
|---|---|
| `await k.part(name,[w,h,d],color,{surface,top,bottom,studs,material,...placement})` | Box Part with per-face materials `[top, sides, bottom]`; UVs scaled to studs. `surface` = any Roblox material for the sides; `top` defaults to the real library stud texture `'kek'` (also `'square'`, `'square-mixed'`, `'universal-hd'`, `'stud-3'`), or `'smooth'`, `'none'`, or the round procedural `'studs'`/`'inlet'` (only when asked); `studs:'mesh'` merges real stud cylinders on top. Materials are shared per look within one build. |
| `await k.studMaterial(color,{style,normalScale,brighten})` | Stud surface material. Library styles (`kek`, `square`, `square-mixed`, `universal-hd`, `stud-3`) tile by their stud count and get a normal map derived from their shading. WebP styles decode in the browser only (Node uses a grey placeholder). |
| `k.robloxMaterial(name,{color,tile})` | Enum.Material look-alike with deterministic detail and normal maps. `tile` = studs per texture repeat. `Neon` and `ForceField` are emissive; `Glass`, `Ice` and `ForceField` are translucent. `material.userData.robloxMaterial` records the name. |
| `k.worldUV(meshOrGeometry, tile=k.STUD)` | Box-projected UVs, so any mesh tiles at a constant density. |
| `await k.texture(src,{repeat,offset,rotation,srgb,nearest,wrap})` | Loads a library path (`'library/…'`, `'kek-ui-essentials/kek_stud.png'`), a project-relative `new URL('x.png', import.meta.url)` or a URL. |
| `await k.pbr({color,map,normalMap,roughnessMap,metalnessMap,aoMap,emissiveMap,alphaMap,repeat,...})` | Textured MeshStandardMaterial. |
| `k.pixelTexture(w,h,(u,v,x,y)=>[r,g,b,a])`, `k.dataTexture`, `k.normalFromHeight(heights,w,h,strength)`, `k.noise`, `k.fbm` | Textures painted in code (deterministic, exported as PNG). |

In the browser, generated textures are backed by a canvas so GLTFExporter can embed them. In Node they are DataTextures, so `inspect` and the tests run headless.

## Bundled icon/texture library: only on request

`npm run assets -- "golden coin" --kind icon` searches `assets/index.json`. Rebuild the index with `npm run assets:index` after adding files. `--studs`, `--materials` and `--packs` list the stud styles, the material presets and the pack licenses. In code: `await k.findAssets(query,{kind,limit})`, and `await k.asset(query)` returns the best path.

- `await k.iconBadge(name, queryOrPath, {size,depth,bevel,sideColor,emissive,...placement})` traces the icon's alpha (marching squares, holes supported), extrudes it and maps the icon onto the front and back caps. The sides take the icon's outline color.
- `await k.iconPlane(name, queryOrPath, {size,emissive,...placement})` makes a double-sided cutout card.
- `await k.decal(name, target, src, {at, normal, size:[w,h], depth, spin})` projects an image onto a static mesh. It is offset along the normals, so it does not z-fight in other engines.

Texture rules: use library icons only when the user asks for icons or the icon pack. When the user asks for studs, use a real library stud texture (`'kek'` default), not the round procedural one. Otherwise author your own textures procedurally (`k.robloxMaterial`, `k.pixelTexture`, `k.normalFromHeight`, `k.pbr`).

## Roblox Highlight

```js
k.highlight('Chest', {FillColor:[255,0,0], FillTransparency:0.5, OutlineColor:[255,255,255], OutlineTransparency:0, DepthMode:'AlwaysOnTop'});
k.highlight('Door', {fillTransparency:1, outlineColor:'#000000', depthMode:'Occluded'}); // outline only
```

The target is an object name, an object, or `'Asset'` for the whole model. Descendants are included, like a Highlight parented to a Model. Defaults match Roblox: red fill at 0.5, white outline, AlwaysOnTop. Optional extras: `outlineWidth` (px; also sets the baked thickness), `glow` (px), `glowColor`, `glowTransparency`, `fillStyle:'solid'|'fresnel'|'stripes'` and `pulse:{speed,amount}`. Do not nest highlights parent/child; Roblox renders that unreliably.

The viewer works in screen space like Roblox. It renders the adornee into a mask, uses an exact distance transform for a constant-pixel outline, and compares depth for `Occluded`. Click a part to select it. The inspector edits highlights live and copies recipe code.

## Edge Outline

```js
k.edges('Asset', {color:'#000000', thickness:2, creaseAngle:30});       // every part, lines only
k.edges('Crate', {color:'#ffffff', fill:true, fillColor:'#ff4040', fillTransparency:0.7});
```

Draws lines on the silhouette, on edges sharper than `creaseAngle`, and at depth breaks between overlapping parts. `silhouette` and `creases` toggle each line type. `depthMode` is `'Occluded'` (default) or `'AlwaysOnTop'`. `worldThickness` overrides the baked strip width in meters.

## What the export contains

| Data | GLB / glTF |
|---|---|
| Exact settings | `CODEX_highlight` / `CODEX_edges` node extensions (+ `extras`). Re-importing restores them: the shells hide and the live effect returns. |
| Highlight outline | `<Mesh>_HighlightOutline`: inverted hull (inflated along averaged normals, winding flipped), unlit via `KHR_materials_unlit`. |
| Highlight fill | `<Mesh>_HighlightFill`: thin translucent unlit overlay (omitted with `--highlights outline`). |
| Glow (if set) | `<Mesh>_HighlightGlow`: a wider, faint hull. |
| Edge outline | `<Mesh>_EdgeLines` square strips on crease edges plus a `<Mesh>_EdgeSilhouette` hull; `_EdgeFill` is optional. |
| Roblox runtime | Scene `extras.codexHighlightLuau`, and `npm run export -- <slug> lua` writes `CodexOutline` (Script or ModuleScript). It styles the shells as Neon/SmoothPlastic with no collision, shadows or queries, and provides `SetOutline`, `SetFill`, `SetGlow`, `SetEnabled`, `Pulse` and `StopPulse`. `Options.UseRobloxHighlight=true` adds native Highlights as well. |

Skinned meshes get skinned shells bound to the same skeleton, so outlines follow the animation. `?import=exports/<slug>.glb&baked=1` previews only the baked geometry.

## Smart LOD optimizer

`await k.lod({reduction, maxError=0.015, creaseAngle=40, preserveCreases=true, cullDetails=false, normals:'auto'})` reduces every mesh under the root (persistent in the recipe). It is Garland–Heckbert quadric error metrics with these production rules:

- **Edge collapse order:** the cheapest collapse goes first. Flat areas cost ~0, so they go first; silhouette and high-curvature areas go last. Candidate positions are the endpoints or the midpoint, so attributes interpolate exactly.
- **Attributes:** UV error is measured against each surrounding face's affine UV map (Hoppe 1999), so evenly mapped areas collapse freely. UV seams are locked. Normals and colors add a penalty.
- **Hard edges:** split (hard) normals are detected (`estimateNormalCrease`). They are kept as crease constraints, and the normals are rebuilt after reduction (`creasedNormals`); flat-shaded meshes stay flat. Crease and open-border vertices can only slide along their own line.
- **Skinning:** influences blend on collapse (top 4, normalized). Differences in skin weight are penalized, so rigid spans reduce before joint loops.
- **Safety:** collapses must pass the link condition (including UV-seam twins, so the result stays manifold), must not flip any face, and must not create slivers. The run stops when `maxError` (a fraction of the mesh diagonal) would be exceeded, even if `reduction` is not reached.
- **Detail culling:** `cullDetails:true` removes the smallest detached parts (≤8% of the size) when edge collapse cannot reach the budget.
- **Ladder:** `LOD_LEVELS` = LOD0 100%, LOD1 50%, LOD2 25% (+culling), LOD3 12% (+culling).

Morph-target meshes are skipped. The result reports per-mesh triangles, `relativeError`, culled triangles and `hitErrorLimit`.

## Topology quality and smart fix

`k.quality()` / `npm run inspect -- <slug> --quality` returns `{score, grade, criteria, totals, joints, tips, meshes}`:

| Criterion | Measure |
|---|---|
| quads | share of triangles that pair into near-rectangular, coplanar virtual quads (target ≥85%) |
| ngons | flat triangulated polygons or star caps with ≥5 real corners (cylinder/disc caps) |
| poles | valence ≠4 in the quad graph; 3 = N-pole, 5 = E-pole, 6+ = high; poles where skin weight is blended count double |
| density | crease-free vertices whose incident edge lengths jump >6× |
| triangles | thin (quality <0.08), degenerate and duplicate faces |
| manifold | non-manifold or inconsistently wound edges |
| joints | per parent→child bone blend zone: number of vertex rings along the bone axis (≥3 required) |

`k.fixTopology()` cleans degenerate and duplicate faces, flips edges only between coplanar triangles (Delaunay or valence improvement), and tangentially relaxes vertices in flat regions. The relaxed vertices are re-projected onto the original one-ring, and UVs, normals and skin weights are re-interpolated barycentrically. The shape stays identical. It does not retopologize: missing loops must be authored.

The viewer's **Quads** view shows the virtual-quad wireframe (diagonals hidden) with pole markers: blue N-pole, orange E-pole, red 6+, magenta pole inside a joint.

## Hybrid CPU + GPU preview

`src/worker-pool.js` (`geometryPool()`) runs `simplify` (QEM + culling + audit), `audit` and `quality` on module workers; `optimizeLODAsync(root, opts, pool.simplify)` and `analyzeQualityAsync(root, pool.quality)` mirror the sync APIs exactly. `server.mjs` resolves bare imports through the page's import map so workers can load the same modules. `cachedAudit`/`primeAudit` (topology.js) cache audits per geometry. The renderer asks for the high-performance GPU and adapts its render scale under load.

## Viewer lighting

`src/lighting.js` `LightingRig`: camera-relative key/fill/rim lights that follow the orbit, hemisphere + environment kept low for contrast, a shadow camera fitted to the model bounds, a contact-shadow blob and SSAO (16-sample hemisphere AO from the resolved scene depth, applied in the highlight compositor's output pass before tone mapping; it also darkens the shadow floor for contact occlusion). Presets in `LIGHTING_PRESETS`: `studio`, `dramatic`, `soft`, `sunset`, `roblox`, `classic`. Selection: ☀ menu, key `L`, `?light=`, manifest `"lighting"`, `window.codexDesign.lighting(nameOrOverrides)`, `npm run export -- <slug> png --light <preset>`. Viewer-only; exports do not include lights.

## Surface system (v0.6: `src/look.js`, `src/paint.js`, `src/bake.js`)

`renderAtlas(charts, options)` is the one renderer. Charts come from `quadCharts` (voxels/blocks: exact edges, voxel AO)
or `meshCharts` (any geometry: triangles grouped by dominant axis + crease angle, projected on the axis plane; hard
edges — open borders or creases ≥ `hardAngle` — are rasterized as seeds of an exact Euclidean distance transform, so
`ctx.edge` is the distance to a real edge). Per texel: base color → color gradients (`only`/`where` filters) →
`painter.albedo` → StudTrain overlay → `shadeTexel` (look) → light gradients; optional ORM / normal (from
`painter.height`) / emissive maps. Charts are shelf-packed (`pxPerStud`, shrinking until ≤ `maxAtlas`) and dilated.
Voxel faces keep one rectangle per merged face but are tessellated on the voxel grid (`tessellate`, default true).
`k.paint` stores `userData.codexSurface` (source geometry, colors, options, gradient stack) so later calls re-bake;
`occlusion:true` adds BVH vertex AO (three-mesh-bvh) from the whole model.

## Procedural PBR (`src/pbr.js`, `src/texlab.js`)

`generatePBR(def,{size,seed,color,tint})` takes YOUR definition `{height(u,v,seed), albedo(ctx), roughness(ctx), metalness?, emissive?, normal?, metal?}` (or an example name) returns RGBA arrays (v-up rows) for albedo, normal (OpenGL), roughness, metalness, ao, height; `packORM` builds the glTF ORM map; `k.pbrSurface(preset,{size,repeat,...materialProps})` returns a MeshStandardMaterial with map, normalMap and ORM bound to roughness/metalness/ao. CLI: `npm run texture -- <preset|all|--list> [--size 256…4096] [--seed] [--color --tint]`.

## SIMP topology optimization (`src/topopt.js`)

`topologyOptimize({nelx,nely,volfrac,penal=3,rmin=1.5,iterations=60,case|loads+supports,passive})` → `{density (rows top→bottom), compliance, volume, iterations, history}`. Grid coordinates: x right 0…nelx, y up 0…nely, loads/supports on nodes. `k.topologyPart(name,{...,size,thickness,threshold,color,mesher:'quad'|'extrude',upsample})`: `'quad'` (default) builds a watertight quad-dominant solid with marching squares on the density grid (`densityMesh`); `'extrude'` traces the outline (`fieldShapes`) and extrudes it; `object.topology` keeps the solver result.

## GFX (`src/gfx.js`, `src/app-gfx.js`, `scripts/gfx.mjs`)

`renderModel` renders the loaded model through the workshop renderer and lights at 2× supersampling with every non-asset scene object hidden and a transparent clear; `composeGFX` crops to the alpha bounds and composes background (radial/linear/accent/rarity, rays, clouds, bokeh, grids, halftone, spotlight, podium), shadows, optional sticker outline, layout text, rarity frame, multi-view sheets and the watermark (`drawWatermark`) by preset (`GFX_PRESETS`, 19). Defaults: `gfx.config.json` (`/api/gfx-config`) < manifest `gfx` < call options. Viewer-only lights; the export file is a PNG.
