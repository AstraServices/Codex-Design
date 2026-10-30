// Gradient sign: the board is not flat blue: a radial color gradient designed for this sign (teal glow from the
// lower-left corner → blue → deep purple top-right, from the user's reference), a soft bevel rim on the board edges,
// a pixel-art spider emblem extruded in voxels, and wooden posts painted with the stud-nature look + AO.
// Static prop: no animation, no highlight.
export async function build(k) {
  const p = k.parameters, S = k.STUD, W = 14 * S, H = 7 * S;
  await k.block('Board', [W, H, 0.75 * S], p.base, {
    studs: 'none', look: { rim: 0.55, rimWidth: 0.05, rimLighten: 0.28, glow: 0.08, vignette: 0.08, faceGradient: 0.03 }, at: [0, 2.2, 0],
    gradient: { type: 'radial', center: 'bottom-left', axis: 'z', radius: 1.2, stops: [[0, p.glow], [0.45, '#2e7da3'], [0.75, '#2f4f8f'], [1, p.deep]] },
  });
  await k.block('Frame', [W + S * 0.6, S * 0.5, S], '#6a3a22', { look: 'default', at: [0, 2.2 + H / 2 + S * 0.2, 0] });
  // Spider emblem: 13×9 pixel art, 1 voxel deep. Legs are stair-stepped (edge-connected) so the voxel mesh stays watertight.
  await k.voxels('Spider', {
    rows: ['##.........##', '.##..#.#..##.', '..##.###.##..', '...#######...', '#####o#o#####', '...#######...', '..##.###.##..', '.##.......##.', '##.........##'].map(r => r.replace(/x/g, '#').replace(/o/g, 'e')),
    palette: { '#': p.emblem, e: '#ff3b5c' }, voxel: S * 0.42, studs: 'none', look: { rim: 0.45, rimWidth: 0.04, rimLighten: 0.25, vignette: 0.05 },
    gradient: { type: 'linear', from: 'bottom', to: 'top', stops: [[0, '#05060f'], [1, '#2a2f55']] },
    at: [0, 2.2 - 9 * S * 0.42 / 2, 0.38 * S],
  });
  for (const [i, x] of [[0, -W / 2 + S], [1, W / 2 - S]].map(([i, x]) => [i, x])) await k.block(`Post${i}`, [S, 2.2 + H / 2 - 0.05, S], '#7a4426', { look: 'default', studs: 'train', at: [x, (2.2 + H / 2) / 2 - 0.4, -S * 0.9] });
  await k.gradient('Asset', 'light', {});
}
