// Texture Studio, VFX Studio and Roblox serializer tests (Node, no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { inst, T, add } from '../src/rbx/instances.js';
import { toRBXM, readRBXM } from '../src/rbx/rbxm.js';
import { toRBXMX } from '../src/rbx/rbxmx.js';
import { buildEffect, buildPackage, validateEffect, textureRefs } from '../src/rbx/vfx-build.js';
import { generateLuau } from '../src/rbx/vfx-luau.js';
import { evaluate, seamScore, validatePBR, checkGraph, pruneGraph, NODES, heightToNormal } from '../src/texture/graph.js';
import { exportMaterial, PROFILES, atlas } from '../src/texture/export.js';

const fx = JSON.parse(await readFile(new URL('../vfx/ice-explosion.vfx.json', import.meta.url), 'utf8'));
const controller = await readFile(new URL('../src/rbx/vfx-controller.luau', import.meta.url), 'utf8');
const ids = Object.fromEntries(textureRefs(fx).map((r, i) => [r.key, String(1000 + i)]));

test('RBXM: header, chunks, classes and referents', () => {
  const a0 = inst('Attachment', 'A0'), a1 = inst('Attachment', 'A1', { CFrame: T.cframe([0, 4, 0]) }), part = inst('Part', 'P', { size: T.vec3([1, 2, 3]), Color3uint8: T.color3u8('#ff8000') }, [a0, a1]);
  add(part, inst('Beam', 'B', { Attachment0: T.ref(a0), Attachment1: T.ref(a1), Width0: T.float(2), Transparency: T.numseq([[0, 0], [1, 1]]), Color: T.colseq('#ffffff') }));
  const bin = toRBXM(inst('Folder', 'Root', {}, [part])), info = readRBXM(bin);
  assert.equal(new TextDecoder().decode(bin.subarray(0, 8)), '<roblox!');
  assert.equal(info.instances, 5); assert.deepEqual(info.chunks.slice(0, 1), ['META']); assert.equal(info.chunks.at(-1), 'END');
  assert.deepEqual(info.classes.map(c => c.name).sort(), ['Attachment', 'Beam', 'Folder', 'Part']);
  assert.ok(info.classes.find(c => c.name === 'Beam').props.includes('Attachment0'));
});

test('VFX effect builds valid RBXM + RBXMX with every texture id', () => {
  assert.deepEqual(validateEffect(fx, { assets: ids }).filter(i => i.level === 'error'), []);
  const pkg = buildPackage([fx], { assets: ids, controller }), xml = toRBXMX(pkg), info = readRBXM(toRBXM(pkg));
  assert.match(xml, /<Item class="ModuleScript"/); assert.match(xml, /rbxassetid:\/\/1000/); assert.match(xml, /<NumberSequence name="Size">/);
  assert.ok(info.classes.some(c => c.name === 'ParticleEmitter' && c.count === 3));
  const { events, duration } = buildEffect(fx, { assets: ids }); assert.ok(events.length > 5); assert.ok(duration >= 1.2);
});

test('VFX validator blocks what Roblox cannot do', () => {
  const bad = structuredClone(fx); bad.layers[0].props.Glow = 2; bad.layers.push({ type: 'shader', name: 'X' }); bad.layers[1].props.Lifetime = [3, 1];
  const codes = validateEffect(bad, { assets: ids }).filter(i => i.level === 'error').map(i => i.code);
  for (const c of ['unsupported-prop', 'type', 'lifetime-order']) assert.ok(codes.includes(c), c);
  assert.ok(validateEffect(fx).some(i => i.code === 'missing-asset-id'), 'missing ids are never silent');
});

test('Luau generator: CONFIG table, builder, runtime and no JS leftovers', () => {
  const lua = generateLuau([fx], { controller, textures: [{ key: 'IceExplosion.Flash', imageId: '42' }] });
  assert.match(lua, /local CONFIG = \{/); assert.match(lua, /\["IceExplosion\.Flash"\] = "rbxassetid:\/\/42"/); assert.match(lua, /\["IceExplosion\.Shards"\] = ""/);
  assert.match(lua, /local EffectsFolder = BuildEffects\(\)/); assert.match(lua, /Enum\.ParticleFlipbookLayout\.Grid8x8/); assert.match(lua, /function VFX\.Play/);
  assert.doesNotMatch(lua, /undefined|NaN|\[object Object\]/);
  assert.ok(lua.indexOf('local function tex(') < lua.indexOf('local EFFECTS = {'), 'tex() is defined before the data table uses it');
});

test('Texture graph: seamless, deterministic, PBR-valid, prunable', async () => {
  const g = JSON.parse(await readFile(new URL('../textures/volcanic-rock.graph.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkGraph(g).filter(i => i.level === 'error'), []);
  const a = await evaluate(g, { size: 64 }), b = await evaluate(g, { size: 64 });
  assert.deepEqual(a.maps.baseColor.d, b.maps.baseColor.d, 'same seed → same pixels');
  for (const m of ['baseColor', 'height', 'roughness']) assert.ok(seamScore(a.maps[m], 64).score > 0.8, `${m} tiles`);
  assert.ok(!validatePBR(a.maps, 64).some(i => i.level === 'error'));
  assert.deepEqual(pruneGraph(g).removed, ['edges']);
  for (const [type, def] of Object.entries(NODES)) if (!def.in && type !== 'meshMask' && type !== 'subgraph') { const r = await evaluate({ nodes: [{ id: 'n', type }], outputs: { height: 'n' } }, { size: 16 }); assert.ok(r.maps.height.d.every(Number.isFinite), type); }
});

test('Normal maps: OpenGL up = +green, DirectX flips', () => {
  const S = 16, h = { c: 1, d: new Float32Array(S * S).map((_, k) => 1 - Math.floor(k / S) / S) }; // higher towards the top row
  const gl = heightToNormal(h, S, 8, 'opengl'), dx = heightToNormal(h, S, 8, 'directx'), k = (8 * S + 8) * 3 + 1;
  assert.ok(gl.d[k] < 0.5 && dx.d[k] > 0.5, 'slope rising upward tilts the OpenGL normal down (green < 0.5) and DirectX the other way');
});

test('Export profiles: every engine gets its maps and material file', async () => {
  const g = JSON.parse(await readFile(new URL('../textures/volcanic-rock.graph.json', import.meta.url), 'utf8')), r = await evaluate(g, { size: 64 });
  const { files, report } = exportMaterial('rock', r.maps, 64, Object.keys(PROFILES), { deflate: b => deflateSync(b) });
  for (const f of ['roblox-surfaceappearance/rock_ColorMap.png', 'roblox-surfaceappearance/rock.rbxmx', 'unreal/rock_ORM.png', 'godot/rock.tres', 'gltf/rock.gltf', 'unity-hdrp/rock_MaskMap.png', 'specgloss/rock_Specular.png']) assert.ok(files[f], f);
  assert.match(new TextDecoder().decode(files['roblox-surfaceappearance/rock.rbxmx']), /class="SurfaceAppearance"/);
  assert.equal(report.find(x => x.profile === 'roblox-surfaceappearance').size, 64);
  const A = atlas([{ name: 'a', maps: r.maps, size: 64 }, { name: 'b', maps: r.maps, size: 64 }], 128); assert.equal(A.rects.length, 2);
});

// ---------- v0.8.1: SDK, auto UV, baking, EXR ----------
import * as THREE from 'three';
import { smartUV, uvStats } from '../src/uv.js';
import { bakeHighToLow } from '../src/bake-hilo.js';
import { writeEXR, readEXR, toHalf } from '../src/exr.js';
import { createCodex } from '../src/sdk/codex.mjs';
import { generateImage } from '../src/vfx/texgen.js';

test('Auto UV: no overlaps, no flips, all attributes kept', () => {
  for (const g of [new THREE.BoxGeometry(1, 2, 3), new THREE.TorusKnotGeometry(1, 0.3, 96, 12), new THREE.CylinderGeometry(0.5, 0.5, 3, 24, 3)]) {
    const u = smartUV(g), s = uvStats(u);
    assert.equal(s.overlap, 0); assert.equal(s.flipped, 0); assert.ok(u.attributes.normal && u.attributes.uv && u.index);
    for (let i = 0; i < u.attributes.uv.count; i++) { const x = u.attributes.uv.getX(i), y = u.attributes.uv.getY(i); assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1); }
  }
});

test('High → low bake: tangent normals, AO, coverage', () => {
  const high = new THREE.IcosahedronGeometry(1, 12), p = high.attributes.position;
  for (let k = 0; k < p.count; k++) { const v = new THREE.Vector3().fromBufferAttribute(p, k).normalize(); v.multiplyScalar(1 + 0.05 * Math.sin(v.x * 12)); p.setXYZ(k, v.x, v.y, v.z); }
  high.computeVertexNormals(); const r = bakeHighToLow({ high, low: smartUV(new THREE.IcosahedronGeometry(1, 1)), size: 64, cage: 0.05, ao: 4 });
  assert.ok(r.stats.coverage > 0.3); let min = 1, spread = 0; for (let k = 0; k < 64 * 64; k++) { min = Math.min(min, r.normal.d[k * 3 + 2]); spread = Math.max(spread, Math.abs(r.normal.d[k * 3] - 0.5)); }
  assert.ok(min >= 0.5, 'normals face outward'); assert.ok(spread > 0.05, 'detail transferred');
});

test('EXR: valid header, half and float, value round trip', async () => {
  assert.equal(toHalf(1), 0x3c00); assert.equal(toHalf(-2), 0xc000); assert.equal(toHalf(65504), 0x7bff);
  const R = new Float32Array([0, 0.5, 2, 1000]), bin = writeEXR({ width: 2, height: 2, channels: { R, A: new Float32Array(4).fill(1) }, type: 'float' }), info = readEXR(bin);
  assert.deepEqual(info, { width: 2, height: 2, channels: ['A', 'R'], type: 'float', compression: 0 });
  const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js'), L = new EXRLoader(); L.setDataType(THREE.FloatType);
  const t = L.parse(writeEXR({ width: 2, height: 1, channels: { R: new Float32Array([1.5, 3]), G: new Float32Array(2), B: new Float32Array(2), A: new Float32Array([1, 1]) } }).buffer); assert.equal(t.data[0], 1.5); assert.equal(t.data[4], 3);
});

test('SDK: texture + VFX + UV from code, files the studios read', async () => {
  const cd = await createCodex();
  try {
    const g = cd.texture.graph('sdk-test-tiles'); const b = g.node('bricks', { rows: 6, cols: 3 }); g.output('height', b).output('baseColor', g.node('colorRamp', {}, { in: b }));
    const v = await cd.texture.validate(g, { size: 64 }); assert.ok(v.ok); assert.ok(v.seams.height > 0.9);
    assert.throws(() => g.node('nope'), /Unknown texture node/);
    const fx = cd.vfx.effect('SdkTestFx').emitter({ name: 'Spark', texture: '123', props: { Lifetime: [0.2, 0.4] } }).light({ props: { Range: 10 } });
    assert.ok((await cd.vfx.validate(fx)).ok); assert.match(await cd.vfx.luau(fx), /\["SdkTestFx\.Spark"\]|rbxassetid:\/\/123|VFX\.Play/);
    assert.ok(cd.vfx.library({ tag: 'fire' }).length > 3);
    assert.equal(generateImage({ kind: 'ring', grid: 4 }).width, 1024);
    const u = await cd.uv.unwrap(new THREE.BoxGeometry(1, 1, 1), { out: cd.root + '/exports/uv/sdk-test.glb' }); assert.equal(u.stats.overlap, 0);
    const back = await cd.uv.load('exports/uv/sdk-test.glb'); assert.ok(back.attributes.uv && back.index.count === 36);
  } finally { await cd.close(); }
});
