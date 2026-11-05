// Codex Design SDK demo: everything an AI can do from code, no UI clicks.
//   npm run codex -- run examples/sdk-demo.mjs
// Results also appear in the studios (textures/, vfx/ files reload live in the open pages).
export default async function demo(cd) {
  const report = {};

  // 1) Texture Studio: build a seamless ice material as a node graph, validate, export for Roblox + Unreal + EXR
  const g = cd.texture.graph('sdk-ice-crystal').set('description', 'SDK demo: cracked blue ice with frosted edges').set('seed', 11).set('normalStrength', 5);
  const cells = g.node('worley', { scale: 6, mode: 'edge', warp: 0.06 }, {}, 'cells');
  const cracks = g.node('cracks', { scale: 6, width: 0.035, warp: 0.06 }, {}, 'cracks');
  const frost = g.node('fbm', { scale: 10, octaves: 6 }, {}, 'frost');
  const height = g.node('blend', { mode: 'multiply', opacity: 0.4 }, { a: g.node('levels', { inHigh: 0.4 }, { in: cells }, 'plates'), b: frost }, 'height');
  const ice = g.node('colorRamp', { stops: [[0, '#1d4f7a'], [0.6, '#5fb3e6'], [1, '#d9f3ff']] }, { in: height }, 'iceColor');
  const white = g.node('color', { color: '#eefaff' }, {}, 'white');
  const albedo = g.node('blend', { mode: 'mix' }, { a: ice, b: white, mask: g.node('weathering', { kind: 'snow', amount: 0.5 }, { height }, 'snow') }, 'albedo');
  g.output('baseColor', albedo).output('height', height).output('roughness', g.node('levels', { outLow: 0.05, outHigh: 0.4 }, { in: cracks }, 'rough'));
  report.textureValidate = await cd.texture.validate(g, { size: 128 });
  const tex = await cd.texture.export(g, { size: 512, profiles: ['roblox-surfaceappearance', 'unreal', 'exr-linear'] });
  report.textureExport = { dir: tex.dir, files: tex.files.length, report: tex.report.map(r => `${r.profile} ${r.size}² ${r.maps.join('/')}`) };

  // 2) VFX Studio: library flipbook + AI-drawn shockwave + light → validate → Luau/RBXM package
  const smoke = cd.vfx.library({ tag: 'smoke', kind: 'flipbook', limit: 1 })[0];
  const ring = await cd.vfx.drawTexture({ kind: 'shockwave', grid: 4, color: '#9fe3ff', seed: 3 });
  const fx = cd.vfx.effect('SdkFrostNova').set('description', 'SDK demo: frost nova').set('duration', 1)
    .fromLibrary(smoke.id, { Size: [[0, 3], [1, 9]], Color: '#cfefff', Transparency: [[0, 0.2], [1, 1]] }, { name: 'Mist', burst: { t: 0, count: 6 } })
    .emitter({ name: 'Ring', texture: ring, props: { Lifetime: [0.5, 0.5], Speed: [0, 0], Size: [[0, 2], [1, 14]], FlipbookLayout: 'Grid4x4', FlipbookMode: 'OneShot', LightEmission: 1, LightInfluence: 0, Orientation: 'VelocityPerpendicular', EmissionDirection: 'Top' }, burst: { t: 0, count: 1 } })
    .light({ name: 'Glow', props: { Color: '#8fdcff', Brightness: 5, Range: 20 }, duration: 0.5, anim: [{ prop: 'Brightness', from: 5, to: 0, time: 0.5 }] });
  report.vfxValidate = (await cd.vfx.validate(fx)).issues.map(i => `${i.level}:${i.code}`);
  const pkg = await cd.vfx.export(fx, { placeholder: true });
  report.vfxExport = { ok: pkg.ok, files: pkg.files.map(f => f.split(/[\\/]/).pop()), missingIds: pkg.missingIds.length };

  // 3) UV + bake: unwrap a mesh without UVs (from an OBJ written on the fly), bake a bumpy high-poly onto it
  const THREE = await import('three'), { writeFile, mkdir } = await import('node:fs/promises'), path = await import('node:path');
  const objOf = geo => { const p = geo.attributes.position, i = geo.index.array; let s = ''; for (let k = 0; k < p.count; k++) s += `v ${p.getX(k)} ${p.getY(k)} ${p.getZ(k)}\n`; for (let k = 0; k < i.length; k += 3) s += `f ${i[k] + 1} ${i[k + 1] + 1} ${i[k + 2] + 1}\n`; return s; };
  const low = new THREE.IcosahedronGeometry(1, 2), high = new THREE.IcosahedronGeometry(1, 30), hp = high.attributes.position;
  for (let k = 0; k < hp.count; k++) { const v = new THREE.Vector3().fromBufferAttribute(hp, k).normalize(); v.multiplyScalar(1 + 0.05 * Math.sin(v.x * 14) * Math.sin(v.y * 14) * Math.sin(v.z * 14)); hp.setXYZ(k, v.x, v.y, v.z); }
  const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js'), dir = path.join(cd.root, 'exports', 'bake', 'sdk-src'); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'low.obj'), objOf(mergeVertices(low.deleteAttribute('uv').deleteAttribute('normal')))); await writeFile(path.join(dir, 'high.obj'), objOf(mergeVertices(high.deleteAttribute('uv').deleteAttribute('normal'))));
  const uv = await cd.uv.unwrap('exports/bake/sdk-src/low.obj'); report.autoUV = uv.stats;
  const bake = await cd.bake.highToLow({ high: 'exports/bake/sdk-src/high.obj', low: uv.file, size: 256, cage: 0.04, ao: 8, name: 'sdk-asteroid' }); report.bake = { ...bake.stats, files: bake.files.length };

  // 4) GFX Studio (headless): hero card + HDR EXR of a workshop project
  const projects = (await (await fetch(cd.url + '/api/projects').catch(() => null))?.json?.()) ?? [];
  const slug = projects.find(p => p.id === 'bamboo-stalk')?.id ?? projects[0]?.id;
  if (slug) { const r = await cd.gfx.render(slug, { preset: ['hero-render', 'clay'], title: 'SDK Demo' }); const e = await cd.gfx.render(slug, { preset: 'transparent', format: 'exr' }); report.gfx = [...r, ...e].map(x => `${x.preset} ${x.width}×${x.height} ${x.file.split(/[\\/]/).pop()}`); }
  return report;
}
