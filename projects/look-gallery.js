// Look gallery: one surface system, each object with its own look object and gradient (no presets).
// Static props only: no animation, no highlight.
export async function build(k) {
  const S = k.STUD, gap = 3.2;
  // 1 · Mushroom, measured default look: cap with a radial gradient from the crown (hot red → deep crimson), spotted.
  await k.voxels('Mushroom', { size: [9, 10, 9], at: [-gap * 2, 0, 0], look: 'default',
    fill: (x, y, z) => { const dx = x - 4, dz = z - 4, r = Math.hypot(dx, dz); if (y < 4) return r < 1.6 ? '#efe2c8' : null; const cap = 4.6 - (y - 4) * 0.75; if (r > cap) return null; return (x * 7 + y * 3 + z * 5) % 11 === 0 && y > 5 ? '#ffffff' : '#d8202c'; },
    gradient: { type: 'spherical', center: 'top', radius: 0.7, stops: [[0, '#ff5a3c'], [0.6, '#c3121f'], [1, '#5a0410']], mode: 'tint' } });
  // 2 · Crystal, dark faces with emissive edges on a smooth faceted mesh, angular gradient around its axis.
  const crystal = k.mesh('Crystal', 'cylinder', [0.05, 0.75, 2.4, 6, 1], k.material('#4fd2ff'), { at: [-gap, 1.2, 0] });
  await k.paint(crystal, { look: { rim: 1, rimWidth: 0.06, rimLighten: 0.6, glow: 0.4, glowWidth: 0.25, vignette: 0.35, brightness: 0.7, saturation: 1.2, emissiveRim: 0.8 }, gradient: { type: 'angular', axis: 'y', stops: [[0, '#4fd2ff'], [0.5, '#b04fff'], [1, '#4fd2ff']] } });
  // 3 · Crate, worn: chipped rims, grime at the bottom; wood ramp bottom → top.
  await k.block('Crate', [6 * S, 6 * S, 6 * S], '#a0662e', { at: [0, 3 * S, 0], look: { rim: 0.5, rimWidth: 0.08, edgeNoise: 0.9, grime: 0.3, speckle: 0.06, ao: 0.65, saturation: 0.95 }, studs: 'train',
    gradient: { type: 'linear', from: 'bottom', to: 'top', stops: [[0, '#5c3214'], [1, '#c98a48']] } });
  // 4 · Coin, glossy (one model-space sheen band): pixel-art rim + face, gold ramp from the lower-left.
  await k.voxels('Coin', { at: [gap, 0, 0], voxel: S * 0.6, depth: 2, look: { rim: 0.6, rimWidth: 0.05, rimLighten: 0.45, vignette: 0.12, sheen: 0.35, sheenDir: [1, 1, 0], sheenOffset: 0.55, sheenWidth: 0.1, saturation: 1.1 }, studs: 'none',
    rows: ['..####..', '.#oooo#.', '#oo##oo#', '#o#oo#o#', '#o#oo#o#', '#oo##oo#', '.#oooo#.', '..####..'], palette: { '#': '#c98a12', o: '#ffd34d' },
    gradient: { type: 'radial', center: 'bottom-left', axis: 'z', radius: 1.1, stops: [[0, '#fff4b0'], [0.5, '#ffc21a'], [1, '#a35d00']], mode: 'tint' } });
  // 5 · Cloud, pastel with a soft vertical ramp.
  await k.voxels('Cloud', { at: [gap * 2, 1, 0], look: { rim: 0.5, rimLighten: 0.5, rimSaturate: 0.6, vignette: 0.06, lift: 0.1, saturation: 0.85, ao: 0.3 }, studs: 'train',
    fill: (x, y, z) => { const v = (x - 5) ** 2 / 25 + (y - 2) ** 2 / 6 + (z - 3) ** 2 / 9; const b = (x - 3) ** 2 / 6 + (y - 3.2) ** 2 / 6 + (z - 3) ** 2 / 6; return v < 1 || b < 1 ? '#ffffff' : null; }, size: [11, 6, 7],
    gradient: { type: 'linear', from: 'bottom', to: 'top', stops: [[0, '#b9c8ff'], [1, '#ffffff']] } });
  await k.gradient('Asset', 'light');
}
