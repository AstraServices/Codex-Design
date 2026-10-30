# Roblox transfer

Use `npm.cmd run export -- <slug> roblox` for Studio delivery. Extract the resulting
`exports/<slug>.roblox.zip` before importing `model.gltf`. Keep `textures/` and
`buffers/` beside it. This target does not upload or publish assets.

The package has external images (including split roughness/metalness maps), a
material/mesh manifest, native `AnimSaves.rbxmx` KeyframeSequences and
`InstallAnimSaves.lua`. The installer adapts Pose hierarchies to the actual
imported MeshParts, stores sequences in ServerStorage, and creates ObjectValue
references in the rig's AnimSaves folder, plus an AnimationController/Animator
when needed. Select the imported rig Model and inserted AnimSaves folder together
before running the installer in Studio's Command Bar. Existing AnimSaves is never
overwritten. The source folder remains as `AnimSaves_Source`.

For a single file use `npm.cmd run export -- <slug> glb --target roblox` or
`gltf --target roblox`. The CLI and download buttons default to the Roblox profile. Use
`--target generic` or choose General glTF engines for generic export. The Roblox profile uses a common, ordered bone palette for every skin,
world bind-space geometry and identity mesh transforms. Rigid bone children are
converted to one-joint skins; animated rigid groups/objects become bones. Bone
rest transforms come from inverse bind matrices, not a display pose. Inconsistent
bind poses stop export with the offending bone's name.

Roblox material import can differ from the preview. The profile bakes common
texture repeat/offset/rotation into UV0 instead of relying on
KHR_texture_transform. Differently transformed maps or nonzero UV channels must
first be baked to one shared atlas; the exporter reports these explicitly.
Do not silently remove a texture or return a flat gray placeholder. If image
upload fails, use the manifest and external PNGs to assign SurfaceAppearance
ColorMap, NormalMap, RoughnessMap and MetalnessMap after upload. Respect the
manifest's base color factor; ORM is packed G=roughness/B=metalness and must not
be assigned directly as a grayscale SurfaceAppearance map.

Units are meters; the kit uses 0.28 meters per Roblox stud. Import at the matching
scale (3.571428571 studs/meter). Native save translation values use that scale.
Do not auto-scale a creature as a humanoid. Check the resulting bounds in studs.

Animations in a glTF do not automatically imply an AnimSaves folder. Animation
Editor's file importer can import glTF clips, or the package installer can install
local editable saves. Publishing animation asset IDs is a separate Studio action
requiring the correct owner permissions. Runtime games should use published IDs.

Native saves sample translation/quaternion bone animation at 30 FPS, including the
final frame. `clip.userData.loop` and optional numeric `priority` control the save.
Scale/morph tracks cannot be represented by Roblox Pose CFrames and currently stop
native save generation. Author bone translation/rotation equivalents for Roblox;
do not claim squash/scale/morph fidelity. Animated SkinnedMesh node transforms
must be moved onto bones. Keep stable name-based tracks, unique bone names, no
negative bind scales, and bind every mesh before posing the rig. FBX export is
still not implemented.

Verification: run `npm.cmd test` and `npm.cmd run test:browser`. For real assets,
validate the exported glTF including external resources, reimport it, compare
deformed world-space vertices at several clip times, inspect texture images and
render the reimport. Final Studio verification must check bind pose, head/jaw,
fins/teeth, material mapping, units and every clip. If no Studio is connected,
state that limitation; Three.js round trips cannot prove Roblox importer behavior.

Sources checked 2026-10-30:
- [Studio Importer](https://create.roblox.com/docs/studio/importer)
- [Animation Editor / local saves](https://create.roblox.com/docs/animation/editor)
- [Bone reference](https://create.roblox.com/docs/reference/engine/classes/Bone)
- [Animation Clip Editor glTF support](https://devforum.roblox.com/t/full-release-animation-clip-editor-improved-importing-and-gltf-support/4260501)

Older brighten-enabled materials could contain linear base colors above 1, which violates glTF baseColorFactor limits. All GLB/glTF exporters now clone and clamp these factors to 0–1 and record codexExportWarnings; the source material remains unchanged. Extremely bright previews may therefore differ. The legacy megalodon-abyss gill animation now uses outward translation instead of unsupported bone scaling.
